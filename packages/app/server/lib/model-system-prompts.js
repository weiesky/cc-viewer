import { readdirSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { isNonEmptyFile } from './file-api.js';

// 「按模型定制 system prompt」的文件夹与文件名语法。
// 全局目录 <LOG_DIR>/system_prompt/ 与工作区目录 <workspace>/system_prompt/ 各放一套；
// 启动时用「当前生效配置解析出的模型 id」(spawn-model-resolver.js：激活的三方 proxy profile
// 模型映射 > env > settings.json；无配置信号则不注入)做不区分大小写的子串匹配(条目名
// "OPUS" 命中 "claude-opus-4-8[1m]")，命中的文件整体取代工作区默认的 CC_SYSTEM.md /
// CC_APPEND_SYSTEM.md。
//
// Model-specific system prompt files. Two scopes share the same folder name
// (MODEL_PROMPT_DIR): global <LOG_DIR>/system_prompt/ and per-workspace
// <workspace>/system_prompt/. At spawn the model id resolved from the ACTIVE
// configuration (spawn-model-resolver.js — never from past usage records) is
// matched case-insensitively as a substring against entry names; a match fully
// replaces the workspace Default sentinels for that launch.
//
// Known limitations (by design):
// - An entry named "haiku" only matches when haiku is explicitly configured as
//   the main model (rare but legal); the old last-usage criterion filtered
//   /haiku/i and could never match it.
// - Opening ~/.claude/cc-viewer itself as the workspace makes both scopes the
//   same directory; harmless — the workspace scope short-circuits first.
export const MODEL_PROMPT_DIR = 'system_prompt';

// 条目名语法：首字符字母数字，其余允许 . _ -，总长 ≤64。禁止 `/` `\` 与前导点 → 无路径穿越。
// Entry-name grammar: first char alphanumeric, then [A-Za-z0-9._-], max 64 chars.
export const MODEL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

// 后缀编码该条目的模式(对齐 CC_SYSTEM.md / CC_APPEND_SYSTEM.md 命名惯例)：
// <NAME>_SYSTEM.md = 覆盖(override)，<NAME>_APPEND_SYSTEM.md = 追加(append)。
// The suffix encodes the entry's mode, mirroring the CC_* sentinel convention.
const OVERRIDE_SUFFIX = '_SYSTEM.md';
const APPEND_SUFFIX = '_APPEND_SYSTEM.md';

/**
 * 校验并规范化模型条目名：合法则返回全大写规范名，否则 null。
 * 统一大写落盘可根除大小写敏感/不敏感文件系统上的 "Opus" vs "OPUS" 碰撞，无需索引文件。
 * 拒绝以 `_APPEND` 结尾的名字(否则 `X_APPEND` 的 override 文件 `X_APPEND_SYSTEM.md`
 * 会被最长后缀优先的解析读成 `{X, append}`)；拒绝保留名 `DEFAULT`(UI 首个页签)。
 * Validate + canonicalize an entry name to UPPERCASE, or return null.
 *
 * @param {string} name
 * @returns {string|null}
 */
export function normalizeModelName(name) {
  if (typeof name !== 'string' || !MODEL_NAME_RE.test(name)) return null;
  const upper = name.toUpperCase();
  if (/_APPEND$/.test(upper)) return null;
  if (upper === 'DEFAULT') return null;
  return upper;
}

/**
 * 由条目名 + 模式得到文件名；名字非法时 throw(调用方应先各自校验)。
 * Build the on-disk filename for an entry; throws on invalid name.
 *
 * @param {string} name
 * @param {'override'|'append'} mode 非 'override' 一律按 'append' 处理(对齐 writeWorkspaceSystemText)
 * @returns {string} e.g. 'GEMINI3_SYSTEM.md'
 */
export function modelPromptFileName(name, mode) {
  const canonical = normalizeModelName(name);
  if (!canonical) throw new Error('invalid model prompt name');
  return canonical + (mode === 'override' ? OVERRIDE_SUFFIX : APPEND_SUFFIX);
}

/**
 * 解析文件名 → { name, mode } 或 null(非本语法文件)。
 * 最长后缀优先：先试 `_APPEND_SYSTEM.md` 再试 `_SYSTEM.md`；剥后缀得到的 stem 必须
 * 自身通过 normalizeModelName(空 stem、含非法字符、`_APPEND` 结尾一律拒绝)——
 * 在解析器内部再校验一次，read/match 路径就不可能被列表跳过之外的异类文件喂进来。
 * Parse a filename into { name, mode } (longest suffix first) or null.
 *
 * @param {string} fileName
 * @returns {{ name: string, mode: 'override'|'append' } | null}
 */
export function parseModelPromptFileName(fileName) {
  if (typeof fileName !== 'string') return null;
  let stem = null;
  let mode = null;
  if (fileName.endsWith(APPEND_SUFFIX)) {
    stem = fileName.slice(0, -APPEND_SUFFIX.length);
    mode = 'append';
  } else if (fileName.endsWith(OVERRIDE_SUFFIX)) {
    stem = fileName.slice(0, -OVERRIDE_SUFFIX.length);
    mode = 'override';
  } else {
    return null;
  }
  const name = normalizeModelName(stem);
  if (!name) return null;
  return { name, mode };
}

/**
 * 列出目录里的模型条目。仅统计「存在、普通文件、非空」且文件名符合语法的文件；
 * 目录缺失/不可读 → []。同名去重：override 压过 append(对齐 readWorkspaceSystemText
 * 的优先级)；同名同模式(大小写敏感文件系统上手工造出的重复)取字典序最小的文件名，保证确定性。
 * List model prompt entries in a directory.
 *
 * @param {string} dir
 * @returns {Array<{ name: string, mode: 'override'|'append', fileName: string }>} 按 name 排序
 */
export function listModelPrompts(dir) {
  if (!dir) return [];
  let files;
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }
  const byName = new Map();
  for (const fileName of files.slice().sort()) {
    const parsed = parseModelPromptFileName(fileName);
    if (!parsed) continue;
    if (!isNonEmptyFile(join(dir, fileName))) continue;
    const prev = byName.get(parsed.name);
    if (!prev) {
      byName.set(parsed.name, { name: parsed.name, mode: parsed.mode, fileName });
      continue;
    }
    // override 压过 append；同模式保留字典序最小(files 已排序，先到先得)。
    if (prev.mode === 'append' && parsed.mode === 'override') {
      byName.set(parsed.name, { name: parsed.name, mode: parsed.mode, fileName });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 读取某条目的文本(经 listModelPrompts 的去重/优先级规则挑出生效文件)。
 * Read one entry's effective text, or null when absent/unreadable.
 *
 * @param {string} dir
 * @param {string} name
 * @returns {{ name: string, mode: 'override'|'append', text: string } | null}
 */
export function readModelPrompt(dir, name) {
  const canonical = normalizeModelName(name);
  if (!canonical) return null;
  const entry = listModelPrompts(dir).find((e) => e.name === canonical);
  if (!entry) return null;
  try {
    return { name: entry.name, mode: entry.mode, text: readFileSync(join(dir, entry.fileName), 'utf-8') };
  } catch {
    return null;
  }
}

// 删除目录里「解析后同名」的全部文件——覆盖两种模式与大小写变体(大小写敏感文件系统上
// 手工创建的 Opus_SYSTEM.md 之类)。返回是否真的删掉了东西。
function removeAllVariants(dir, canonical) {
  let files;
  try {
    files = readdirSync(dir);
  } catch {
    return false;
  }
  let deleted = false;
  for (const fileName of files) {
    const parsed = parseModelPromptFileName(fileName);
    if (parsed && parsed.name === canonical) {
      try {
        rmSync(join(dir, fileName), { force: true });
        deleted = true;
      } catch { /* ignore */ }
    }
  }
  return deleted;
}

/**
 * 写入某条目：
 * - text 去空白后为空 → 删掉该名字全部变体(= 删除条目)，{ cleared:true }
 * - 否则 mkdir -p 目录；先删反向模式/大小写变体、再写目标文件(缩小「两份并存」中间态窗口，
 *   与 writeWorkspaceSystemText 的先删后写同理)。
 * Upsert an entry; empty text deletes it.
 *
 * @param {string} dir
 * @param {string} name
 * @param {'override'|'append'} mode
 * @param {string} text
 * @returns {{ name: string, mode: 'override'|'append', written: boolean, cleared: boolean }}
 */
export function writeModelPrompt(dir, name, mode, text) {
  if (!dir) throw new Error('no target directory');
  const canonical = normalizeModelName(name);
  if (!canonical) throw new Error('invalid model prompt name');
  const normMode = mode === 'override' ? 'override' : 'append';
  const raw = typeof text === 'string' ? text : '';

  if (raw.trim().length === 0) {
    removeAllVariants(dir, canonical);
    return { name: canonical, mode: normMode, written: false, cleared: true };
  }
  mkdirSync(dir, { recursive: true });
  const target = modelPromptFileName(canonical, normMode);
  // 先删同名其它变体(含反向模式与大小写变体)，再写目标文件。
  let files;
  try {
    files = readdirSync(dir);
  } catch {
    files = [];
  }
  for (const fileName of files) {
    if (fileName === target) continue;
    const parsed = parseModelPromptFileName(fileName);
    if (parsed && parsed.name === canonical) {
      try { rmSync(join(dir, fileName), { force: true }); } catch { /* ignore */ }
    }
  }
  writeFileSync(join(dir, target), raw, 'utf-8');
  return { name: canonical, mode: normMode, written: true, cleared: false };
}

/**
 * 删除某条目(全部模式/大小写变体)。
 * Delete an entry entirely.
 *
 * @param {string} dir
 * @param {string} name
 * @returns {{ deleted: boolean }}
 */
export function deleteModelPrompt(dir, name) {
  const canonical = normalizeModelName(name);
  if (!canonical) return { deleted: false };
  return { deleted: removeAllVariants(dir, canonical) };
}

/**
 * 在候选目录序列中为 modelId 匹配模型条目。
 * 匹配 = 双方都转小写后做子串包含("OPUS" 命中 "claude-opus-4-8[1m]")。
 * candidates 按「工作区在前」传入：工作区一旦有命中即短路，全局哪怕名字更长也不再看
 * (用户决策：工作区覆盖全局；名字长度只在同一 scope 内当消歧规则)。
 * 同 scope 多条命中：名字最长者胜("OPUS-4" 压过 "OPUS")，等长按字典序，确定性兜底。
 * Match modelId against candidate dirs (workspace-first short-circuit).
 *
 * @param {string|null} modelId e.g. 'claude-opus-4-8[1m]'
 * @param {Array<{ dir: string, scope: 'workspace'|'global' }>} candidates
 * @returns {{ path: string, fileName: string, name: string, mode: 'override'|'append', scope: 'workspace'|'global' } | null}
 */
// 模型 id 别名表：第三方代理常把模型名归一化成不带厂商前缀的简写（kimi profile 把
// `k3[1m]` 剥后缀后得到裸 `k3`），而条目名通常带前缀（KIMI / KIMI-K3）。别名在子串
// 匹配前把解析名展开成「所有等价拼写」，任一变体命中即算命中。key 与变体都是小写
// 完整词（精确等值，非子串），只在解析名**恰好等于** key 时展开，避免误放大。
// Model id aliases: third-party proxies often normalize model names to a bare
// shorthand (the kimi profile strips `k3[1m]` → `k3`), while entry names carry the
// vendor prefix (KIMI / KIMI-K3). Aliases expand the resolved id into every
// equivalent spelling before substring matching. Keys and variants are lowercase
// full words (exact equality, not substrings), so expansion only fires when the
// resolved id IS the bare shorthand — no accidental widening.
const MODEL_ID_ALIASES = {
  k3: ['k3', 'kimi-k3', 'kimi'],
};

// 展开模型 id 的全部等价小写拼写（无别名时就是单元素数组）。
// Expand a model id into every equivalent lowercase spelling.
function modelIdVariants(id) {
  return MODEL_ID_ALIASES[id] || [id];
}

// 供内置预设匹配复用的导出包装：入参任意大小写，先剥 `[1m]` 类方括号后缀
// （spawn 渲染管线对 model.name 做同样的剥离；上游 resolver 正常会剥，这里兜底），
// 再 toLowerCase 展开别名——避免大写 env（如 K3）或带后缀的裸名（k3[1m]）绕过别名表。
// 单一别名源，勿在别处复制 MODEL_ID_ALIASES。
// Exported wrapper for the built-in preset matcher: strips a trailing bracket suffix
// and lowercases before expanding, so uppercase ids (K3) or suffixed shorthands
// (k3[1m]) cannot bypass the alias table.
export function expandModelIdVariants(modelId) {
  if (!modelId || typeof modelId !== 'string') return [];
  const stripped = modelId.replace(/\s*\[[^\]]*\]$/, '').toLowerCase();
  return modelIdVariants(stripped);
}

export function matchModelPrompt(modelId, candidates) {
  if (!modelId || typeof modelId !== 'string') return null;
  if (!Array.isArray(candidates)) return null;
  // 与内置层（builtin-model-prompts.js）同一展开：剥 `[1m]` 类后缀 + lowercase + 别名。
  // 若用户层不剥后缀而内置层剥（k3[1m] + 用户有 KIMI-K3_SYSTEM.md），用户文件会
  // 静默 miss、内置反客为主 —— 违反「用户文件永远优先」，两层必须同语义。
  const variants = expandModelIdVariants(modelId);
  for (const cand of candidates) {
    if (!cand || !cand.dir) continue;
    const hits = listModelPrompts(cand.dir).filter((e) => {
      const entryName = e.name.toLowerCase();
      return variants.some((v) => v.includes(entryName));
    });
    if (!hits.length) continue;
    hits.sort((a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name));
    const e = hits[0];
    return { path: join(cand.dir, e.fileName), fileName: e.fileName, name: e.name, mode: e.mode, scope: cand.scope };
  }
  return null;
}
