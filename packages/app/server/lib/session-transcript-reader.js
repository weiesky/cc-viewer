/**
 * Session Transcript Reader
 *
 * 从本地 Claude Code session 转写文件（<projectsDir>/<encoded-cwd>/<sessionId>.jsonl）
 * 按 tool_use.id 抽取 ExitPlanMode 的 input.plan / planFilePath。
 *
 * 用途：CC 2.x ExitPlanModeV2Tool 在 API 网线送 input:{}，plan 内容仅在 CC 客户端
 * normalizeToolInput 时写入 session 转写。cc-viewer 出 SSE/REST 前用本模块补全。
 *
 * 设计决策：
 * - 边界放置在 server egress 而非 fs.watch + 独立 SSE 事件——前端零改动 +
 *   tool_use.id 已在 wire 上同步可用；缺点是历史回放每次重扫，由 LRU + 文件大小
 *   上限 + miss TTL 兜住。
 * - projectsDir 走 findcc.getClaudeConfigDir()，与 CLAUDE_CONFIG_DIR 重定向对齐。
 * - 内存：流式 1MB 分块读 + 行级 indexOf 双子串预过滤 + 半写入行 try/catch 跳过。
 * - 缓存：transcript 路径 LRU(64) + tool_use input LRU(5000)；命中后用 mtime 校验
 *   detect transcript 被覆写。
 * - miss 短 TTL：30s 让 race（CC 还没 flush）后自动重试。
 */

import { existsSync, statSync, openSync, readSync, closeSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getClaudeConfigDir } from '../../findcc.js';

function projectsDir() {
  return process.env.CCV_PROJECTS_DIR || join(getClaudeConfigDir(), 'projects');
}

const READ_CHUNK_SIZE = 1024 * 1024;
const MAX_TRANSCRIPT_BYTES = 64 * 1024 * 1024;  // 异常 GB 级文件防御
const MISS_TTL_MS = 30 * 1000;                  // miss 路径短 TTL，让 race 后自动重试

const PATH_CACHE_MAX = 64;
const INPUT_CACHE_MAX = 5000;

const transcriptPathCache = new Map();   // key → { path, mtimeMs } | { path: null, expireAt }
const toolUseInputCache = new Map();     // `${path}:${tuId}` → { plan?, planFilePath? }（仅命中入缓存）
const toolUseResultCache = new Map();    // `${path}:${tuId}` → { runId?, taskId? }（仅命中入缓存）

function lruSet(map, key, value, max) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  if (map.size > max) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
}

function lruGet(map, key) {
  if (!map.has(key)) return undefined;
  const v = map.get(key);
  map.delete(key);
  map.set(key, v);
  return v;
}

function pickByMtime(arr) {
  return arr.reduce((a, b) => a.mtimeMs >= b.mtimeMs ? a : b);
}

/**
 * sessionId → 转写文件绝对路径。多匹配时按 entry.project 反向匹配编码目录尾段，
 * 仍多匹配取 mtimeMs 最大者。命中后 LRU(64) 缓存（带 mtime）；miss 短 TTL 缓存。
 *
 * @param {string} sessionId
 * @param {string} [projectHint] - interceptor 写入的 entry.project（basename of cwd, sanitized）
 * @returns {string | null}
 */
export function findTranscriptPath(sessionId, projectHint) {
  if (!sessionId) return null;
  const cacheKey = projectHint ? `${sessionId}|${projectHint}` : sessionId;
  const cached = lruGet(transcriptPathCache, cacheKey);
  if (cached) {
    if (cached.path === null) {
      // miss 缓存：TTL 内继续返回 null，过期则重新探测
      if (cached.expireAt && cached.expireAt > Date.now()) return null;
    } else {
      // hit 缓存：用 mtime 校验文件未被覆写
      try {
        const st = statSync(cached.path);
        if (st.isFile() && st.mtimeMs === cached.mtimeMs) return cached.path;
      } catch {}
      // mtime 变了或文件没了 → fall through 重扫
    }
  }

  const root = projectsDir();
  let dirs;
  try { dirs = readdirSync(root); }
  catch {
    lruSet(transcriptPathCache, cacheKey, { path: null, expireAt: Date.now() + MISS_TTL_MS }, PATH_CACHE_MAX);
    return null;
  }

  const matches = [];
  for (const d of dirs) {
    const p = join(root, d, `${sessionId}.jsonl`);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (!st.isFile()) continue;
    matches.push({ dir: d, path: p, mtimeMs: st.mtimeMs });
  }

  if (matches.length === 0) {
    lruSet(transcriptPathCache, cacheKey, { path: null, expireAt: Date.now() + MISS_TTL_MS }, PATH_CACHE_MAX);
    return null;
  }

  let chosen;
  if (matches.length === 1) {
    chosen = matches[0];
  } else if (projectHint) {
    const hint = String(projectHint);
    const hintMatch = matches.filter(m => m.dir.endsWith('-' + hint) || m.dir === hint);
    chosen = pickByMtime(hintMatch.length ? hintMatch : matches);
  } else {
    chosen = pickByMtime(matches);
  }

  lruSet(transcriptPathCache, cacheKey, { path: chosen.path, mtimeMs: chosen.mtimeMs }, PATH_CACHE_MAX);
  return chosen.path;
}

/**
 * 单行扫描：行级双子串预过滤后 JSON.parse 抽取目标 ExitPlanMode 块的 input。
 *
 * @param {string} line
 * @param {string} toolUseId
 * @returns {{ ok: 'hit', value: { plan?: string, planFilePath?: string } }
 *         | { ok: 'unknown-shape' }
 *         | { ok: 'miss' }}
 */
function scanLineForToolUse(line, toolUseId) {
  if (!line) return { ok: 'miss' };
  if (line.indexOf('"name":"ExitPlanMode"') === -1) return { ok: 'miss' };
  if (line.indexOf(toolUseId) === -1) return { ok: 'miss' };

  let entry;
  try { entry = JSON.parse(line); } catch { return { ok: 'miss' }; }
  const content = entry?.message?.content;
  if (!Array.isArray(content)) return { ok: 'miss' };

  let unknownShape = false;
  for (const blk of content) {
    if (blk?.type !== 'tool_use' || blk?.name !== 'ExitPlanMode') continue;
    if (blk?.id !== toolUseId) continue;
    const inp = blk.input || {};
    const value = {};
    if (typeof inp.plan === 'string') value.plan = inp.plan;
    if (typeof inp.planFilePath === 'string') value.planFilePath = inp.planFilePath;
    if (value.plan || value.planFilePath) return { ok: 'hit', value };
    if (Object.keys(inp).length > 0) unknownShape = true;
  }
  return unknownShape ? { ok: 'unknown-shape' } : { ok: 'miss' };
}

/**
 * 流式扫 transcript 文件，按 tool_use.id 用传入的 scanLine 抽取目标字段。
 * 命中即 break；半写入行 try/catch 跳过。最大文件大小由 MAX_TRANSCRIPT_BYTES 兜底。
 *
 * @param {string} filePath
 * @param {string} toolUseId
 * @param {(line: string, toolUseId: string) => { ok: 'hit', value: object } | { ok: 'unknown-shape' } | { ok: 'miss' }} scanLine
 * @returns {{ result: object | null, unknownShape: boolean }}
 */
function scanTranscriptFile(filePath, toolUseId, scanLine) {
  let unknownShape = false;
  try {
    const fileSize = statSync(filePath).size;
    if (fileSize === 0) return { result: null, unknownShape: false };
    if (fileSize > MAX_TRANSCRIPT_BYTES) {
      try {
        process.stderr.write(`[enrichPlan] transcript too large (${fileSize} bytes > ${MAX_TRANSCRIPT_BYTES}); skipped\n`);
      } catch {}
      return { result: null, unknownShape: false };
    }
    const fd = openSync(filePath, 'r');
    const buf = Buffer.alloc(Math.min(READ_CHUNK_SIZE, fileSize));
    let offset = 0;
    let pending = '';
    try {
      while (offset < fileSize) {
        const toRead = Math.min(buf.length, fileSize - offset);
        const bytesRead = readSync(fd, buf, 0, toRead, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
        const text = pending + buf.toString('utf-8', 0, bytesRead);
        const lines = text.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) {
          const r = scanLine(line, toolUseId);
          if (r.ok === 'hit') return { result: r.value, unknownShape };
          if (r.ok === 'unknown-shape') unknownShape = true;
        }
      }
      if (pending) {
        const r = scanLine(pending, toolUseId);
        if (r.ok === 'hit') return { result: r.value, unknownShape };
        if (r.ok === 'unknown-shape') unknownShape = true;
      }
    } finally {
      closeSync(fd);
    }
  } catch {
    return { result: null, unknownShape };
  }
  return { result: null, unknownShape };
}

/**
 * 按 sessionId + tool_use.id 查 ExitPlanMode 的 input.plan / planFilePath。
 * 仅缓存命中；miss 路径靠 findTranscriptPath 的短 TTL miss 缓存兜底。
 *
 * @param {string} sessionId
 * @param {string} toolUseId
 * @param {string} [projectHint]
 * @returns {{ plan?: string, planFilePath?: string } | null}
 */
export function lookupToolUseInput(sessionId, toolUseId, projectHint) {
  if (!sessionId || !toolUseId) return null;
  const filePath = findTranscriptPath(sessionId, projectHint);
  if (!filePath || !existsSync(filePath)) return null;

  const cacheKey = `${filePath}:${toolUseId}`;
  const cached = lruGet(toolUseInputCache, cacheKey);
  if (cached) return cached;

  const { result, unknownShape } = scanTranscriptFile(filePath, toolUseId, scanLineForToolUse);

  if (!result && unknownShape) {
    try {
      process.stderr.write(`[enrichPlan] schema drift: ExitPlanMode tool_use ${toolUseId} has input but no plan/planFilePath (sid=${sessionId})\n`);
    } catch {}
  }

  if (result) lruSet(toolUseInputCache, cacheKey, result, INPUT_CACHE_MAX);
  return result;
}

/**
 * 单行扫描：找 type:"user" 行里 tool_use_id 匹配的 tool_result 块，
 * 取该行顶层 toolUseResult 的 { runId, taskId }（Workflow 工具的 async_launched 结果）。
 *
 * @param {string} line
 * @param {string} toolUseId
 * @returns {{ ok: 'hit', value: { runId?: string, taskId?: string } }
 *         | { ok: 'unknown-shape' }
 *         | { ok: 'miss' }}
 */
function scanLineForToolUseResult(line, toolUseId) {
  if (!line) return { ok: 'miss' };
  if (line.indexOf('"runId":') === -1) return { ok: 'miss' };
  if (line.indexOf(toolUseId) === -1) return { ok: 'miss' };

  let entry;
  try { entry = JSON.parse(line); } catch { return { ok: 'miss' }; }
  const content = entry?.message?.content;
  if (!Array.isArray(content)) return { ok: 'miss' };

  const matched = content.some(blk => blk?.type === 'tool_result' && blk?.tool_use_id === toolUseId);
  if (!matched) return { ok: 'miss' };

  const tur = entry.toolUseResult;
  if (!tur || typeof tur !== 'object') return { ok: 'miss' };
  const value = {};
  if (typeof tur.runId === 'string') value.runId = tur.runId;
  if (typeof tur.taskId === 'string') value.taskId = tur.taskId;
  if (value.runId || value.taskId) return { ok: 'hit', value };
  return { ok: 'unknown-shape' };
}

/**
 * 按 sessionId + tool_use.id 查 Workflow 工具结果的 { runId, taskId }。
 * runId 直接对应 journal 文件名 `<sessionDir>/workflows/<runId>.json`。
 * 仅缓存命中；miss 路径靠 findTranscriptPath 的短 TTL miss 缓存兜底。
 *
 * @param {string} sessionId
 * @param {string} toolUseId
 * @param {string} [projectHint]
 * @returns {{ runId?: string, taskId?: string } | null}
 */
export function lookupToolUseResult(sessionId, toolUseId, projectHint) {
  if (!sessionId || !toolUseId) return null;
  const filePath = findTranscriptPath(sessionId, projectHint);
  if (!filePath || !existsSync(filePath)) return null;

  const cacheKey = `${filePath}:${toolUseId}`;
  const cached = lruGet(toolUseResultCache, cacheKey);
  if (cached) return cached;

  const { result } = scanTranscriptFile(filePath, toolUseId, scanLineForToolUseResult);
  if (result) lruSet(toolUseResultCache, cacheKey, result, INPUT_CACHE_MAX);
  return result;
}

/** 测试用：清掉三个 LRU。 */
export function clearCache() {
  transcriptPathCache.clear();
  toolUseInputCache.clear();
  toolUseResultCache.clear();
}
