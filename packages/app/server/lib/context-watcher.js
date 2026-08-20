import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getClaudeConfigDir } from '../../findcc.js';
import { getModelMaxTokens, adaptContextWindow, sumUsageInputTokens, sumUsageContextTokens, getCalibrationModel } from '@ccv/core/context-rules';

export const CONTEXT_WINDOW_FILE = join(getClaudeConfigDir(), 'context-window.json');
export const CLAUDE_SETTINGS_FILE = join(getClaudeConfigDir(), 'settings.json');
// ~/.claude.json 是 claude code 的主配置（非 settings.json），存 projects[cwd].lastModelUsage
// 等。两者命名相似但层级和内容完全不同，不要混用。
export const CLAUDE_USER_CONFIG_FILE = join(homedir(), '.claude.json');

// Startup cache: read once, never re-read unless model changes
let _startupModelBase = null;   // e.g. 'opus-4-6'
let _startupContextSize = null; // e.g. 1000000

/**
 * Read context-window.json once at startup and cache model→size mapping.
 * Extracts model base name (e.g. 'opus-4-6') and context size from model.id (e.g. 'claude-opus-4-6[1m]').
 * @returns {{ modelId: string|null, contextSize: number }}
 */
export function readModelContextSize() {
  try {
    if (!existsSync(CONTEXT_WINDOW_FILE)) return { modelId: null, contextSize: 200000 };
    const raw = readFileSync(CONTEXT_WINDOW_FILE, 'utf-8');
    const data = JSON.parse(raw);
    const modelId = data?.model?.id || null;
    let contextSize = 200000;
    if (modelId) {
      // [Nk]/[Nm] 后缀与家族档位统一走共享规则表(@ccv/core/context-rules)
      contextSize = getModelMaxTokens(modelId);
      // Cache the base name → size mapping
      const base = modelId.toLowerCase().replace(/^claude-/i, '').replace(/\[.*\]/, '').trim();
      _startupModelBase = base;
      _startupContextSize = contextSize;
    }
    return { modelId, contextSize };
  } catch {
    return { modelId: null, contextSize: 200000 };
  }
}

/**
 * Get context size for a given API model name (e.g. 'claude-opus-4-6-20250514').
 * Uses startup cache to avoid re-reading the file.
 * Accepts either a bare model-name string (legacy path) or a full log entry.
 * Entry input resolves the model via getCalibrationModel (context-rules.js):
 * an explicit [Nk]/[Nm] suffix on the REQUEST model wins (the user's hot-switch
 * config intent, e.g. k3[1m]); otherwise the upstream response.body.model is
 * authoritative. The startup cache is request-side static info, stale after a
 * hot-switch, so entry resolution skips it and goes straight to the family
 * rules table. String input keeps legacy cache-first behavior unchanged.
 * @param {string|object} modelOrEntry - model name, or log entry with body/response
 * @returns {number} context window size in tokens
 */
export function getContextSizeForModel(modelOrEntry) {
  const isEntry = modelOrEntry !== null && typeof modelOrEntry === 'object';
  // Entry input: calibration-aware resolution (request [Nk]/[Nm] suffix wins,
  // else response model). Authoritative over the stale startup cache.
  if (isEntry) {
    const model = getCalibrationModel(modelOrEntry);
    return model ? getModelMaxTokens(model) : (_startupContextSize || 200000);
  }
  const apiModelName = modelOrEntry;
  if (!apiModelName) return _startupContextSize || 200000;
  const lower = apiModelName.toLowerCase();
  // Extract base: 'claude-opus-4-6-20250514' → 'opus-4-6'
  const base = lower.replace(/^claude-/i, '').replace(/-\d{8}$/, '').trim();
  // Match against startup cache
  if (_startupModelBase && base === _startupModelBase) {
    return _startupContextSize;
  }
  // 完整档位表见 @ccv/core/context-rules(与前端同源;含 haiku/旧 opus/3-opus 200K、
  // deepseek-v4 1M、kimi/moonshot 256K、gpt/deepseek 等三方档位,默认 200K)
  return getModelMaxTokens(apiModelName);
}

function pickBestModel(entries) {
  const withOneM = entries.find(([k]) => /\[1m\]/i.test(k));
  if (withOneM) return withOneM[0];
  entries.sort((a, b) => (b[1]?.costUSD || 0) - (a[1]?.costUSD || 0));
  return entries[0][0];
}

// Pick a model from one lastModelUsage record: drop aux (haiku) entries, then
// pickBestModel. Shared by both lookup strategies so the selection heuristic
// cannot silently diverge between them.
function modelFromUsage(lmu) {
  if (!lmu || typeof lmu !== 'object') return null;
  const entries = Object.entries(lmu).filter(([k]) => typeof k === 'string' && !/haiku/i.test(k));
  return entries.length ? pickBestModel(entries) : null;
}

// Single definition of key canonicalization used on BOTH sides of every
// comparison below (cwd and projects key), so the two can never drift apart.
const stripTrailingSlash = (p) => p.replace(/\/+$/, '');

/**
 * 读 ~/.claude.json 里 projects[cwd].lastModelUsage，挑出 cwd 下"用得最多/最显式"的模型。
 * 给 cc-viewer UI 血条 calibration 在启动期(lastMainAgent 仅有 haiku init ping 时)
 * 提供一个比"auto → 200K"更贴合 claude 自己默认行为的兜底。
 *
 * lastModelUsage 结构：{ [modelId]: { costUSD, inputTokens, outputTokens, ... } }
 * 没有 timestamp 字段（claude code 只累加 usage 不打时间戳），所以"最近"用以下代理：
 *   1) 去掉 haiku-*（辅助模型，从来不是主 model）
 *   2) 任一带 [1m] 后缀 → 直接返回（用户显式 opt-in 1M context 的强信号）
 *   3) 否则按 costUSD 倒序，取第一（用得最多 ≈ 当前主用）
 *
 * 任何 IO / 解析异常返回 null；调用方应当作"没找到偏好"处理（auto 走冷启动 1M）。
 *
 * @param {string} cwd - 绝对路径；尾部斜杠 / symlink / 大小写差异会被归一化后匹配
 * @param {string} [filePath] - 可选注入文件路径，默认 CLAUDE_USER_CONFIG_FILE；单测用
 * @returns {string|null} model id（含 [1m] 后缀，例 "claude-opus-4-7[1m]"）或 null
 */
export function readClaudeProjectModel(cwd, filePath = CLAUDE_USER_CONFIG_FILE) {
  try {
    if (!cwd || typeof cwd !== 'string') return null;
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    const projects = data?.projects;
    if (!projects || typeof projects !== 'object') return null;

    // Claude Code keys projects by its own getcwd() (canonical), but the cwd we
    // receive from spawnClaude may differ (macOS /tmp→/private/tmp symlinks,
    // trailing slashes, or case on case-insensitive filesystems).
    let normalized = cwd;
    try { normalized = realpathSync(cwd); } catch { /* path doesn't exist → use cwd as-is */ }

    // Strategy 1: exact key match — raw cwd first (any key that matched before
    // normalization existed keeps matching), then the realpath'd form. When a
    // usage record exists for this exact path, decide from it alone: haiku-only
    // means "no preference here", not "go search other projects' keys".
    let exactHit = false;
    for (const key of new Set([stripTrailingSlash(cwd), stripTrailingSlash(normalized)])) {
      const lmu = projects[key]?.lastModelUsage;
      if (!lmu || typeof lmu !== 'object') continue;
      exactHit = true;
      const model = modelFromUsage(lmu);
      if (model) return model;
    }
    if (exactHit) return null;

    // Strategy 2: case-insensitive fallback. Default macOS/Windows filesystems
    // are case-insensitive, so a stale-cased key (e.g. after a directory rename)
    // still refers to the same directory. Only reached when no exact key had a
    // usage record, so it can never override an exact match. Note this folds
    // case on darwin unlike norm/normDir elsewhere in the repo (which are
    // win32-only): those guard file access, this only rescues a display hint,
    // so a false positive on a case-sensitive APFS volume is low-stakes.
    if (process.platform === 'darwin' || process.platform === 'win32') {
      const lower = stripTrailingSlash(normalized).toLowerCase();
      const matchKey = Object.keys(projects).find((k) => stripTrailingSlash(k).toLowerCase() === lower);
      if (matchKey) return modelFromUsage(projects[matchKey]?.lastModelUsage);
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Build a context_window SSE event payload from API usage data.
 * @param {object} usage - API response usage object
 * @param {number} contextSize - total context window size in tokens
 * @returns {object|null} context_window event data, or null if usage missing
 */
export function buildContextWindowEvent(usage, contextSize) {
  if (!usage) return null;
  // 分子口径与前端血条同源(context-rules):输入侧含嵌套 cache_creation 容错,total 含末轮 output
  const inputTokens = sumUsageInputTokens(usage);
  const outputTokens = usage.output_tokens || 0;
  const totalTokens = sumUsageContextTokens(usage);
  // 自适应纠偏(共享规则,纠偏判定只用输入侧用量,详见 context-rules.adaptContextWindow)
  const effectiveSize = adaptContextWindow(contextSize, inputTokens);
  const usedPct = Math.round((totalTokens / effectiveSize) * 100);
  return {
    total_input_tokens: inputTokens,
    total_output_tokens: outputTokens,
    context_window_size: effectiveSize,
    current_usage: usage,
    used_percentage: usedPct,
    remaining_percentage: 100 - usedPct,
  };
}
