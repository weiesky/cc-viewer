import { readdirSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { isNonEmptyFile } from './file-api.js';

// 「按模型定制 system prompt」的文件夹与文件名语法。
// 全局目录 <LOG_DIR>/system_prompt/ 与工作区目录 <workspace>/system_prompt/ 各放一套；
// 启动时用「当前生效配置解析出的模型 id」(spawn-model-resolver.js：激活的三方 proxy profile
// 模型映射 > env > settings.json；无配置信号则不注入)做分层段匹配——ident 链锁定家族
// (条目名 "OPUS" 命中 "claude-opus-4-8[1m]"，容忍厂商前缀)，版本号只排序消歧不否决；
// 段匹配全 miss 时回退旧子串。命中的文件整体取代工作区默认的 CC_SYSTEM.md / CC_APPEND_SYSTEM.md。
//
// Model-specific system prompt files. Two scopes share the same folder name
// (MODEL_PROMPT_DIR): global <LOG_DIR>/system_prompt/ and per-workspace
// <workspace>/system_prompt/. At spawn the model id resolved from the ACTIVE
// configuration (spawn-model-resolver.js — never from past usage records) is
// matched by layered segment matching: the ident chain pins the family (tolerating
// any vendor prefix), the version only ranks candidates and never vetoes, and a
// legacy substring predicate is the fallback. A match fully replaces the workspace
// Default sentinels for that launch.
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
 * 匹配 = 分层段匹配：ident 链锁定家族（"OPUS" 命中 "claude-opus-4-8[1m]"，容忍厂商前缀），
 * 版本号只排序消歧不否决；段匹配全 miss 时回退旧子串（保住非规范命名）。
 * candidates 按「工作区在前」传入：工作区一旦有命中即短路，全局哪怕名字更长也不再看
 * (用户决策：工作区覆盖全局；名字长度只在同一 scope 内当消歧规则)。
 * 同 scope 多条命中：先按版本贴近度(_score)，再段数、名字长、精确、字典序。
 * Match modelId against candidate dirs (workspace-first short-circuit).
 *
 * @param {string|null} modelId e.g. 'claude-opus-4-8[1m]'
 * @param {Array<{ dir: string, scope: 'workspace'|'global' }>} candidates
 * @returns {{ path: string, fileName: string, name: string, mode: 'override'|'append', scope: 'workspace'|'global' } | null}
 */
// 模型 id 别名表：第三方代理常把模型名归一化成不带厂商前缀的简写（kimi profile 把
// `k3[1m]` 剥后缀后得到裸 `k3`），而条目名通常带前缀（KIMI / KIMI-K3）。别名在段匹配
// 前把解析名展开成「所有等价拼写」，任一变体命中即算命中。key 与变体都是小写
// 完整词（精确等值，非子串），只在解析名**恰好等于** key 时展开，避免误放大。
// Model id aliases: third-party proxies often normalize model names to a bare
// shorthand (the kimi profile strips `k3[1m]` → `k3`), while entry names carry the
// vendor prefix (KIMI / KIMI-K3). Aliases expand the resolved id into every
// equivalent spelling before substring matching. Keys and variants are lowercase
// full words (exact equality, not substrings), so expansion only fires when the
// resolved id IS the bare shorthand — no accidental widening.
const MODEL_ID_ALIASES = {
  k3: ['k3', 'kimi-k3', 'kimi'],
  // deepseek 简写同理：代理/CLI 常把 `deepseek-v4-flash` 简写成 `deepseek-flash`。
  // DeepSeek shorthand: proxies/CLIs often shorten `deepseek-v4-flash` to `deepseek-flash`.
  'deepseek-flash': ['deepseek-flash', 'deepseek-v4-flash'],
};

// 展开模型 id 的全部等价小写拼写（无别名时就是单元素数组）。
// 用 hasOwn 查表：普通对象下 `MODEL_ID_ALIASES['constructor']` 会取到 Object 构造器，
// 让 .some 调用炸掉（模型 id 来自外部输入，不能信任）。
// Expand a model id into every equivalent lowercase spelling.
function modelIdVariants(id) {
  // A version/routing suffix identifies the same K3 family, not an unrelated
  // model. Keep the boundary so k30 and k3pro remain unmatched.
  const aliasId = /^k3(?:[.-]|$)/.test(id) ? 'k3' : id;
  return Object.hasOwn(MODEL_ID_ALIASES, aliasId) ? MODEL_ID_ALIASES[aliasId] : [id];
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

// ── 分层段匹配 ─────────────────────────────────────────────────────────────
// 模型 id 是「分段结构化标识」，不是不透明字符串：厂商前缀 + 家族名 + 版本 + 后缀。
// 纯子串在版本跳变（V4 → V4.1）或带厂商前缀（vendor/…）时断裂落空。这里把 id 切成
// token → segment（ident + 版本元组）再比较：ident 链锁定家族（必须命中），版本只用于
// 排序消歧、不否决命中——版本对不上时仍落回同家族条目，不掉兜底。
// 单一实现，勿在别处复制（builtin-model-prompts.js 经 export 复用）。
//
// Layered segment matching: a model id is structured (vendor prefix + family +
// version + suffix), not an opaque string. Tokenize → segment (ident + version
// tuple) → compare. The ident chain pins the family (must match); the version
// only ranks candidates, never vetoes a family hit, so an unknown version still
// lands on its family entry instead of the fallback.

const NUM_TOKEN_RE = /^[0-9]+$/;

/**
 * 把模型 id 切成小写 token 序列：版本字面量（含内部 `.` 分量）拆成独立数字，
 * 字母串原样保留，其余一切字符（/ - : _ 等）都当分隔符、不产生 token。
 * 白名单词法：`.` 的职责是版本分量分隔而非字段分隔；未来下划线命名自动正确。
 * Tokenize a model id: version literals split into numeric components, letter
 * runs kept, every other char is a separator.
 *
 * @param {string} id
 * @returns {string[]} e.g. 'vendor/DeepSeek-V4.1-Flash-1017' → ['vendor','deepseek','v','4','1','flash','1017']
 */
export function modelIdTokens(id) {
  if (!id || typeof id !== 'string') return [];
  const s = id.replace(/\s*\[[^\]]*\]$/, '').toLowerCase(); // 剥 [1m] 类后缀，沿用 expandModelIdVariants 语义
  const out = [];
  const re = /\d+(?:\.\d+)*|[a-z]+/g;
  let m;
  while ((m = re.exec(s))) {
    const t = m[0];
    if (NUM_TOKEN_RE.test(t[0])) {
      for (const n of t.split('.')) out.push(n); // 版本 → 独立数字分量
    } else {
      out.push(t);
    }
  }
  return out;
}

/**
 * 把 token 序列切段：每个字母串（ident）与其后连续数字合并为一个 segment
 * { ident, nums[] }；前导纯数字自成一段（ident: null）。
 * Group tokens into segments: an ident plus its trailing numeric run.
 *
 * @param {string[]} tokens
 * @returns {Array<{ ident: string|null, nums: string[] }>}
 */
export function modelIdSegments(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    if (NUM_TOKEN_RE.test(tokens[i])) {
      out.push({ ident: null, nums: [tokens[i]] });
      continue;
    }
    const seg = { ident: tokens[i], nums: [] };
    while (i + 1 < tokens.length && NUM_TOKEN_RE.test(tokens[i + 1])) seg.nums.push(tokens[++i]);
    out.push(seg);
  }
  return out;
}

/**
 * 段比较：entry 首段（必须带 ident）在 id 段序列中起锚（容忍任意厂商前缀），逐段要求
 * ident 严格相等。版本不否决命中，只累计匹配得分。厂商前缀可能与家族同名
 * （deepseek/deepseek-v4-flash），首段 ident 在 id 里出现多次时逐处起锚、取最优，
 * 避免锚在厂商段上静默 miss。
 * 返回 { matched, score, exact } 或 null；exact = 版本与尾段都完全一致。
 * Compare segment lists: anchor on every occurrence of the entry's first ident
 * (a vendor prefix may repeat the family name), keep the best; ident equality is
 * required per segment; the version only scores, never vetoes.
 *
 * @param {Array<{ ident: string|null, nums: string[] }>} entrySegs
 * @param {Array<{ ident: string|null, nums: string[] }>} idSegs
 * @returns {{ matched: true, score: number, exact: boolean } | null}
 */
export function matchSegments(entrySegs, idSegs) {
  if (!entrySegs.length || entrySegs[0].ident === null) return null;
  let best = null;
  for (let start = 0; start < idSegs.length; start++) {
    if (idSegs[start].ident !== entrySegs[0].ident) continue;
    const r = matchSegmentsAt(entrySegs, idSegs, start);
    if (r && (!best || r.score > best.score || (r.score === best.score && r.exact))) best = r;
  }
  return best;
}

// 在指定起锚位置比较一次；ident 链断裂返回 null。版本计分（排序只认 score 主键，数值刻意拉开）：
//   精确（entry 分量与 id 前缀逐位相等且等长）                          → 4
//   前缀（逐位相等但 id 版本更长，如 v{4} ⊑ v{4,1}）                      → 3
//   同 major、minor 分叉（glm-5.3 vs glm-5.4）                           → 2/(1+|Δminor|)
//     —— 同一条版本线，更接近的成员胜出：GLM-5.4 落 GLM-5.3 而非 GLM-5.2
//   跨 major（glm-5.3 vs glm-6）                                         → 1 + major×1e-3
//     —— 不否决，贴向最高 major 的同族条目：GLM-6 落 GLM-5.3 而非 GLM-5.2
//   完全对不上（ident 对齐但无任何版本可比）                              → 0（仍命中，不否决）
// 版本永不否决：ident 链已锁家族，分数再低也命中、由排序落到最贴近的同家族条目而非兜底。
function matchSegmentsAt(entrySegs, idSegs, start) {
  let score = 0;
  let exact = true;
  for (let k = 0; k < entrySegs.length; k++) {
    const e = entrySegs[k];
    const s = idSegs[start + k];
    if (!s || e.ident !== s.ident) return null;
    if (e.nums.length > 0) {
      let allEq = true;
      for (let n = 0; n < e.nums.length; n++) {
        if (e.nums[n] !== s.nums[n]) { allEq = false; break; }
      }
      if (allEq && e.nums.length === s.nums.length) {
        score += 4; // 逐位等长精确（allEq ⇒ major 必等，无跨 major 分支）
      } else if (allEq) {
        score += 3; exact = false; // 前缀（id 版本更长）
      } else if (e.nums[0] === s.nums[0]) {
        // 同 major、minor 分叉（相邻版本线）：按 minor 贴近度给分，越接近越高，量纲 (1,2]——
        // 恒大于任何「跨 major」分值 (0,1)，保证 major 匹配永远压过跨 major。分量缺省按 0 计。
        // GLM-5.4 落 GLM-5.3(1.5) 而非更旧的 GLM-5.2(≈1.33)。
        const gap = Math.abs(Number(e.nums[1] ?? 0) - Number(s.nums[1] ?? 0));
        score += 1 + 1 / (1 + gap);
        exact = false;
      } else {
        // 跨 major（不否决）：贴向「版本最高的同族条目」——模型 id 越新，越应落到同主线
        // 里最高的既有条目（GLM-6 → GLM-5.3 而非 GLM-5.2）；id 版本低于所有条目时同样取
        // 最高（族内兜底，避免老 id 拿到最旧 prompt）。分数随 entry 版本单调递增，量纲
        // (0,1)：恒小于任何「同 major」分值 (1,2]，故同 major 条目永远压过跨 major 条目。
        let entryVal = 0;
        let weight = 1;
        for (let n = 0; n < e.nums.length; n++) {
          entryVal += Number(e.nums[n] ?? 0) * weight;
          weight /= 10;
        }
        score += entryVal / (entryVal + 1);
        exact = false;
      }
    } else if (s.nums.length > 0) {
      exact = false; // entry 无版本而 id 有 → 不算精确
    }
  }
  if (start + entrySegs.length < idSegs.length) exact = false; // entry 后还有段
  return { matched: true, score, exact };
}

// 段匹配消歧排序：版本贴近度(score) > 段数多 > 名字长 > 精确(exact) > 字典序。
// score 已编码「同主线 > 跨主线精确」的权重（见 matchSegments 注释），故 score 是主键，
// exact 退为最终 tiebreak（同分时精确版更具体）。两层共用（内置层条目 name=match 大写、
// 长度与 matchLower 恒等，故直接读 name）。
// Segment-match disambiguation: version proximity (score) > segment count > exact.
// Shared by both layers; entries must carry _score/_exact/_segCount plus a name field.
export function segmentHitRank(a, b) {
  if (a._score !== b._score) return b._score - a._score;
  if (a._segCount !== b._segCount) return b._segCount - a._segCount;
  if (a.name.length !== b.name.length) return b.name.length - a.name.length;
  if (a._exact !== b._exact) return a._exact ? -1 : 1;
  return a.name.localeCompare(b.name);
}

// 在候选条目里为每个 variant 取最优段匹配（best-of-variants），返回带排序字段的命中数组。
// 两层共用，消除「逐条目 × 逐变体取 best」的重复实现。
// Collect the best segment hit per entry across every id variant. Shared by both layers.
export function collectSegmentHits(entries, idSegsList, getEntrySegs) {
  const hits = [];
  for (const e of entries) {
    const entrySegs = getEntrySegs(e);
    let best = null;
    for (const idSegs of idSegsList) {
      const r = matchSegments(entrySegs, idSegs);
      if (r && (!best || r.score > best.score || (r.score === best.score && r.exact))) best = r;
    }
    if (best) hits.push({ ...e, _exact: best.exact, _score: best.score, _segCount: entrySegs.length });
  }
  return hits;
}

// 旧子串命中谓词：段匹配全 miss 时的兜底，保住官方用户非规范命名（OPU、4-8 等）。
// 两层共用——内置层同样回退（vendor 前缀可能与家族同名导致段匹配锚错起点时，子串仍能救回）。
// Legacy substring predicate, kept as the fallback so non-canonical names still hit.
export function substringHits(variants, entries) {
  return entries.filter((e) => {
    const key = (e.matchLower || e.name.toLowerCase());
    return variants.some((v) => v.includes(key));
  });
}

export function matchModelPrompt(modelId, candidates) {
  if (!modelId || typeof modelId !== 'string') return null;
  if (!Array.isArray(candidates)) return null;
  // 与内置层（builtin-model-prompts.js）同一展开：剥 `[1m]` 类后缀 + lowercase + 别名。
  // 若用户层不剥后缀而内置层剥（k3[1m] + 用户有 KIMI-K3_SYSTEM.md），用户文件会
  // 静默 miss、内置反客为主 —— 违反「用户文件永远优先」，两层必须同语义。
  const variants = expandModelIdVariants(modelId);
  const idSegsList = variants.map((v) => modelIdSegments(modelIdTokens(v)));
  for (const cand of candidates) {
    if (!cand || !cand.dir) continue;
    const entries = listModelPrompts(cand.dir);
    // 主路径：段匹配（ident 锁家族，版本排序消歧不否决）。
    let hits = collectSegmentHits(entries, idSegsList, (e) => modelIdSegments(modelIdTokens(e.name)));
    if (hits.length) {
      hits.sort(segmentHitRank);
      const e = hits[0];
      return { path: join(cand.dir, e.fileName), fileName: e.fileName, name: e.name, mode: e.mode, scope: cand.scope };
    }
    // 兜底：旧子串（保住官方用户非规范命名 OPU / 4-8 等，两层同语义）。
    hits = substringHits(variants, entries);
    if (!hits.length) continue;
    hits.sort((a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name));
    const e = hits[0];
    return { path: join(cand.dir, e.fileName), fileName: e.fileName, name: e.name, mode: e.mode, scope: cand.scope };
  }
  return null;
}
