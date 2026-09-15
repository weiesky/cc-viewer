// System 文本随主模型热切换 + (sessionId, model) 静态化（live 层）。
//
// 背景：启动期注入（--system-prompt-file / --append-system-prompt-file）只在 spawn 时
// 生效；代理热切换主模型后 system 文本无法跟随。本模块在代理层提供运行时改写：
//   - 切换模型时按新模型重选 system 文本（override 与 append 可并存）；
//   - 按 (projectKey, sessionId, model) 固化：同一 session 内同一模型下文本字节级
//     不变，KV-cache 破坏仅限切换那一次；
//   - 启动模型的条目直接 seed 自启动期注入的 entries 字节（launch-config 发布），
//     绝不重新渲染 —— 消除 spawn→首请求的 ${git.*}/${time.*} 漂移窗口，也保住
//     Bind A 内容匹配与 resume pin。
//
// 失败哲学（对齐 system-prompt-snapshots.js）：所有公开函数 total（出错返回
// null/false，绝不 throw）——缓存丢失只意味着退化为不改写，绝不阻断请求。
//
// 磁盘布局：<LOG_DIR>/<projectKey>/system-prompt-snapshots/live/<sessionId>.json
//   { v:1, byModel: { [model]: { override, append, createdAt } } }
// system-prompt-snapshots.gc() 非递归、只看 <uuid>.json，与 live/ 子目录互不干扰；
// live 的 GC 由本模块自带（惰性，seed/生成路径触发）。
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { reportSwallowed } from '@ccv/core/error-report';
import { LOG_DIR } from '../../findcc.js';
import { renameSyncWithRetry } from './file-api.js';
import { matchModelPrompt, MODEL_PROMPT_DIR, readModelPrompt } from './model-system-prompts.js';
import { matchBuiltinModelPrompt, isBuiltinDisabled } from './builtin-model-prompts.js';
import { SYSTEM_PROMPT_FILE, APPEND_SYSTEM_PROMPT_FILE, isNonEmptyFile } from './system-prompt-files.js';
import { createSystemPrompt, toSystemPromptVariableSnapshot, fromSystemPromptVariableSnapshot } from './create_system_prompt.js';

const LIVE_DIR_NAME = 'live';
const LIVE_GC_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_LIVE_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_BYTES = 256 * 1024; // 对齐 snapshots 的 MAX_ENTRY_CONTENT_BYTES
const TEMPLATE_VARIABLE_RE = /\$\{[^}]+\}/;
// Anthropic billing-header 前缀块标记：override 整段替换时保留的非注入 block 之一
// （CLI 把它放在 system 数组首块承载 cc_version/cc_entrypoint 等计费/分类元数据；
// 保留它还连带保住 cc_is_subagent=true 标记 → 日志侧分类不受改写影响）。
const BILLING_HEADER_PREFIX = 'x-anthropic-billing-header:';
// CLI 官方身份行（整块独立、带 ephemeral 断点，实测 wire 3 块形态 [billing, identity,
// persona] 的第 2 块）。override 整段替换保留它（D1：与启动形态一致，override 会话
// 首请求零改写、KV-cache 复用）。整块精确匹配 —— 实测真实 wire 身份块恒为整块精确
// （CLI 37/37、SDK 52/52 blob），而 subagent persona（"You are a file search specialist…"）
// 只含片段、整块不等，自定义 persona（"You are k3…"）更不会整块等于。两块文案均为实测值：
const CLI_IDENTITY_TEXTS = [
  "You are Claude Code, Anthropic's official CLI for Claude.",      // CLI 主会话（37 blob 实测整块）
  "You are a Claude agent, built on Anthropic's Claude Agent SDK.", // SDK 主会话（52 blob 实测整块）
];

// 整体开关：CCV_DISABLE_LIVE_SYSTEM_PROMPT=1 关闭 live 改写（CCV_DISABLE_AUTO_SYSTEM_PROMPT
// 在启用门处另查 —— 用户显式关掉自动注入时也不应在请求时回补）。
export const DISABLE_LIVE_ENV = 'CCV_DISABLE_LIVE_SYSTEM_PROMPT';

// ─── 启动判定发布（launch-config push，interceptor 消费）─────────────────────
// 拦截进程 = 生成进程（ccv run / PTY / SDK 的 parent hook），模块内直接传递。
// 这是启用门的唯一事实源：只有「ccv 启动时确实注入了内容且未被手动 flag/env 抑制」
// 的会话才启用 live 改写 —— 手动内联 --system-prompt 的用户绝不被覆盖。
let _launchInfo = null;

/**
 * 发布本次启动的 system 注入判定。launch-config 在 resolveLaunchSystemPrompt 末尾调用。
 * @param {{workspaceDir:string, resolvedModelId:string|null,
 *          entries:Array<{flag:string,content:string}>, pinned:boolean,
 *          suppressed:string|undefined, manualSystemPrompt:boolean}} info
 *        manualSystemPrompt：用户**手动**传了 --system-prompt / --system-prompt-file
 *        （值非 ccv 启动注入路径）——此类会话绝不被热切换覆盖（手动优先）。
 */
export function setLaunchSystemPromptInfo(info) {
  if (!info || typeof info !== 'object') { _launchInfo = null; return; }
  _launchInfo = {
    workspaceDir: typeof info.workspaceDir === 'string' ? info.workspaceDir : '',
    resolvedModelId: typeof info.resolvedModelId === 'string' ? info.resolvedModelId : null,
    entries: Array.isArray(info.entries)
      ? info.entries.filter(e => e && typeof e.content === 'string' && e.content.length > 0)
      : [],
    pinned: info.pinned === true,
    suppressed: typeof info.suppressed === 'string' ? info.suppressed : null,
    manualSystemPrompt: info.manualSystemPrompt === true,
    // IM worker（insideLogDir）等明确不允许 live 覆盖的场景 → allowLive:false。
    allowLive: info.allowLive !== false,
    // Per-launch cacheable variable snapshot (git/os/env/memory… minus time.date &
    // model.name). Stored on the single launchInfo slot so it is replaced on every
    // launch — a switched-model render uses THIS launch's workspaceDir and THIS
    // launch's snapshot, keeping the two in lock-step (no cross-workspace leak, no
    // stale read from a previous launch of the same workspace). The publisher passes
    // the raw collected set; we keep only the cacheable snapshot part. Null when the
    // launch collected nothing (no injection, or injected text had no `${...}`).
    variableSnapshot: (info.variableSnapshot && typeof info.variableSnapshot === 'object')
      ? toSystemPromptVariableSnapshot(info.variableSnapshot) : null,
  };
}

/** 当前启动判定（无 → null）。测试可用 setLaunchSystemPromptInfo(null) 复位。 */
export function getLaunchSystemPromptInfo() {
  return _launchInfo;
}

/**
 * live 改写的启用门（强行覆盖模式）：以热切换当前选中的模型为准，只要该模型有对应
 * system 文本（模型条目/builtin/sentinel）就在代理层注入/替换——包括启动阶段没有
 * 注入的情况（防止启动漏注入）。全部条件满足才启用：
 *  - CCV_DISABLE_LIVE_SYSTEM_PROMPT / CCV_DISABLE_AUTO_SYSTEM_PROMPT 均未设；
 *  - 启动判定存在且有 workspaceDir（选择/渲染需要工作区上下文）；
 *  - 未 suppressed、且用户没有手动传 --system-prompt（手动优先，绝不被覆盖）。
 * 注意：不再要求 entries 非空——启动没注入正是要强行覆盖的场景。
 */
export function liveSystemPromptEnabled(env = process.env) {
  if (env[DISABLE_LIVE_ENV] === '1') return false;
  if (env.CCV_DISABLE_AUTO_SYSTEM_PROMPT === '1') return false;
  if (!_launchInfo || _launchInfo.suppressed) return false;
  if (_launchInfo.manualSystemPrompt) return false;
  if (_launchInfo.allowLive === false) return false; // IM worker 等：persona 不被覆盖
  return !!_launchInfo.workspaceDir;
}

// ─── 固化缓存（内存 + 磁盘）─────────────────────────────────────────────────

const _memCache = new Map(); // `${projectKey}${sessionId}` → { byModel: {...} }
const MAX_MEM_ENTRIES = 64;  // 插入序淘汰，对齐 SingleFlight 的有界思路

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let _now = Date.now;
export function _setLiveDepsForTests({ now } = {}) {
  _now = typeof now === 'function' ? now : Date.now;
}
export function _resetLiveForTests() {
  _memCache.clear();
  _launchInfo = null;
  _now = Date.now;
}

function memKey(projectKey, sessionId) { return `${projectKey}${sessionId}`; }

function liveDirForKey(projectKey, logDir = LOG_DIR) {
  return projectKey ? join(logDir, projectKey, 'system-prompt-snapshots', LIVE_DIR_NAME) : '';
}

function sanitizeModelMap(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [model, rec] of Object.entries(raw)) {
    if (!model || model.length > 256) continue;
    if (!rec || typeof rec !== 'object') continue;
    const override = typeof rec.override === 'string' && rec.override.length > 0
      && Buffer.byteLength(rec.override, 'utf-8') <= MAX_TEXT_BYTES ? rec.override : null;
    const append = typeof rec.append === 'string' && rec.append.length > 0
      && Buffer.byteLength(rec.append, 'utf-8') <= MAX_TEXT_BYTES ? rec.append : null;
    if (!override && !append) continue;
    out[model] = { override, append, createdAt: typeof rec.createdAt === 'number' ? rec.createdAt : 0 };
  }
  return out;
}

function readLiveRecord(projectKey, sessionId, logDir) {
  try {
    if (!UUID_RE.test(String(sessionId || ''))) return null;
    const dir = liveDirForKey(projectKey, logDir);
    if (!dir) return null;
    const file = join(dir, `${sessionId}.json`);
    if (!existsSync(file)) return null;
    if (statSync(file).size > MAX_LIVE_FILE_BYTES) return null;
    const obj = JSON.parse(readFileSync(file, 'utf-8'));
    if (!obj || typeof obj !== 'object') return null;
    return { byModel: sanitizeModelMap(obj.byModel) };
  } catch (err) {
    reportSwallowed('sys-prompt-live.read', err);
    return null;
  }
}

function writeLiveRecord(projectKey, sessionId, byModel, logDir) {
  try {
    const dir = liveDirForKey(projectKey, logDir);
    if (!dir) return false;
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${sessionId}.json`);
    const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
    try {
      writeFileSync(tmp, JSON.stringify({ v: 1, byModel }));
      renameSyncWithRetry(tmp, file);
    } catch (err) {
      try { unlinkSync(tmp); } catch { /* already absent */ }
      throw err;
    }
    return true;
  } catch (err) {
    reportSwallowed('sys-prompt-live.write', err);
    return false;
  }
}

/**
 * 取 (projectKey, sessionId, model) 的固化条目。内存 → 磁盘 → null。
 * 返回 { override, append } | null（override/append 至少一个非空）。
 */
export function getLiveEntry(projectKey, sessionId, model, { logDir } = {}) {
  try {
    if (!projectKey || !UUID_RE.test(String(sessionId || '')) ||
        typeof model !== 'string' || !model) return null;
    const key = memKey(projectKey, sessionId);
    let rec = _memCache.get(key);
    if (!rec) {
      rec = readLiveRecord(projectKey, sessionId, logDir);
      if (rec) {
        _memCache.set(key, rec);
        if (_memCache.size > MAX_MEM_ENTRIES) {
          const first = _memCache.keys().next().value;
          _memCache.delete(first);
        }
      }
    }
    const entry = rec && rec.byModel[model];
    if (!entry) return null;
    return { override: entry.override, append: entry.append };
  } catch (err) {
    reportSwallowed('sys-prompt-live.get', err);
    return null;
  }
}

/**
 * 写入/合并 (projectKey, sessionId, model) 的固化条目（内存 + 磁盘）。
 */
export function putLiveEntry(projectKey, sessionId, model, entry, { logDir } = {}) {
  try {
    if (!projectKey || !UUID_RE.test(String(sessionId || '')) ||
        typeof model !== 'string' || !model) return false;
    const clean = sanitizeModelMap({ [model]: entry });
    if (!clean[model]) return false;
    const key = memKey(projectKey, sessionId);
    const rec = _memCache.get(key) || readLiveRecord(projectKey, sessionId, logDir) || { byModel: {} };
    rec.byModel[model] = clean[model];
    // 写路径也要淘汰：长驻 proxy 进程按 session 累积，MAX_MEM_ENTRIES 上界对 put 同样生效。
    if (_memCache.has(key)) _memCache.delete(key); // 重插以刷新插入序（近似 LRU）
    _memCache.set(key, rec);
    if (_memCache.size > MAX_MEM_ENTRIES) {
      const first = _memCache.keys().next().value;
      _memCache.delete(first);
    }
    writeLiveRecord(projectKey, sessionId, rec.byModel, logDir);
    gcLive(projectKey, logDir);
    return true;
  } catch (err) {
    reportSwallowed('sys-prompt-live.put', err);
    return false;
  }
}

/** 惰性 GC：只扫 live/ 子目录，30 天龄期。transcript 消失判断留给 snapshots 主 GC。 */
export function gcLive(projectKey, logDir) {
  try {
    const dir = liveDirForKey(projectKey, logDir);
    if (!dir || !existsSync(dir)) return 0;
    const cutoff = _now() - LIVE_GC_AGE_MS;
    let removed = 0;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      const file = join(dir, name);
      try {
        if (statSync(file).mtimeMs < cutoff) { unlinkSync(file); removed++; }
      } catch { /* best-effort */ }
    }
    return removed;
  } catch (err) {
    reportSwallowed('sys-prompt-live.gc', err);
    return 0;
  }
}

/** 本 session 已知的全部注入文本（剥离用）：launch entries + 缓存里所有模型的条目。 */
export function knownInjectedTexts(projectKey, sessionId, { logDir } = {}) {
  const texts = [];
  if (_launchInfo) {
    for (const e of _launchInfo.entries) texts.push(e.content);
  }
  try {
    const key = memKey(projectKey, sessionId);
    const rec = _memCache.get(key) || readLiveRecord(projectKey, sessionId, logDir);
    if (rec) {
      for (const m of Object.values(rec.byModel)) {
        if (m.override) texts.push(m.override);
        if (m.append) texts.push(m.append);
      }
    }
  } catch (err) {
    reportSwallowed('sys-prompt-live.known', err);
  }
  return texts;
}

// ─── 选择 + 渲染（仅非启动模型调用；同步小文件读 + 纯字符串渲染，无现场子进程）──
// 渲染用「启动期按 launchInfo 发布的变量快照」+ 实时 time/model —— 绝不现场跑 git。

function renderIfTemplated(text, modelId, cwd, variablesFactory) {
  if (!TEMPLATE_VARIABLE_RE.test(text)) return text;
  // 三级取数：
  //  ① variablesFactory 仅测试 seam（显式传入才生效）。生产默认是下方的快照解析器,
  //     永不 spawn —— 切勿恢复 `|| createSystemPromptVariables` 兜底:那会让生产路径
  //     在 fetch hook 同步段跑 git(单仓库最多 8 次 spawnSync × 15s),冻结整个 server。
  //  ② 启动期发布的 _launchInfo.variableSnapshot → 快照 + 实时 time/model。
  //  ③ 无快照(启动无注入 / 注入文本无 ${...} / pinned-resume)→ fromSnapshot(null),
  //     合成空串骨架,${git.*} 渲染为空串(不是 keep 字面量)。
  // cwd 参数只有 ① 级会用到;快照路径下快照已含 environment.cwd/memory.dir,忽略 cwd。
  if (typeof variablesFactory === 'function') {
    const overrides = {};
    if (modelId) overrides.model = { name: String(modelId).replace(/\[1m\]$/, '') };
    const variables = variablesFactory(overrides, { cwd });
    return createSystemPrompt(text, { variables, missingVariableMode: 'keep' });
  }
  const snapshot = _launchInfo && _launchInfo.variableSnapshot ? _launchInfo.variableSnapshot : null;
  const variables = fromSystemPromptVariableSnapshot(snapshot, { modelId });
  return createSystemPrompt(text, { variables, missingVariableMode: 'keep' });
}

function readSentinel(dir, fileName) {
  const p = join(dir, fileName);
  if (!isNonEmptyFile(p)) return null;
  try {
    const t = readFileSync(p, 'utf-8');
    return t.trim().length > 0 ? t : null;
  } catch (err) {
    // 文件非空但读失败（权限/竞态删除）→ 放弃该 sentinel；有诊断价值，不静默。
    reportSwallowed('sys-prompt-live.sentinel', err);
    return null;
  }
}

/**
 * 为 modelId 选择 { override, append } 文本（override/append 可并存，至少一个非空才有意义）。
 * 优先级：workspace 模型条目 → global 模型条目 → builtin preset（墓碑感知）→
 * 默认 sentinel（CC_SYSTEM.md / CC_APPEND_SYSTEM.md，各自独立存在判断）。
 * 模型条目命中时「整体取代」sentinel（对齐 buildSystemPromptFileArgs:90 语义）。
 * 全部失败/无配置 → null。
 *
 * @param {string} modelId
 * @param {{ workspaceDir: string, globalModelDir?: string|null,
 *          variablesFactory?: Function }} opts
 * @returns {{ override: string|null, append: string|null } | null}
 */
export function selectEntriesForModel(modelId, opts = {}) {
  try {
    const { workspaceDir, globalModelDir = null, variablesFactory } = opts;
    if (typeof modelId !== 'string' || !modelId || !workspaceDir) return null;
    const cwd = workspaceDir;

    // 1. 用户模型条目（workspace → global）
    const wsDir = join(workspaceDir, MODEL_PROMPT_DIR);
    const candidates = [{ dir: wsDir, scope: 'workspace' }];
    if (globalModelDir) candidates.push({ dir: globalModelDir, scope: 'global' });
    const match = matchModelPrompt(modelId, candidates);
    if (match) {
      const dir = match.scope === 'workspace' ? wsDir : globalModelDir;
      const rec = dir ? readModelPrompt(dir, match.name) : null;
      const text = rec && typeof rec.text === 'string' ? rec.text : null;
      if (text == null) return null; // 列出后读失败 → 安全降级
      const rendered = renderIfTemplated(text, modelId, cwd, variablesFactory);
      return match.mode === 'override' ? { override: rendered, append: null } : { override: null, append: rendered };
    }

    // 2. builtin preset（墓碑感知）
    try {
      const builtin = matchBuiltinModelPrompt(modelId);
      if (builtin && !isBuiltinDisabled(builtin.name, join(workspaceDir, MODEL_PROMPT_DIR), globalModelDir)) {
        const rendered = renderIfTemplated(builtin.text, modelId, cwd, variablesFactory);
        return builtin.mode === 'override' ? { override: rendered, append: null } : { override: null, append: rendered };
      }
    } catch (err) {
      reportSwallowed('sys-prompt-live.builtin', err);
    }

    // 3. 默认 sentinel（两份可并存）
    const override = readSentinel(workspaceDir, SYSTEM_PROMPT_FILE);
    const append = readSentinel(workspaceDir, APPEND_SYSTEM_PROMPT_FILE);
    if (!override && !append) return null;
    return {
      override: override ? renderIfTemplated(override, modelId, cwd, variablesFactory) : null,
      append: append ? renderIfTemplated(append, modelId, cwd, variablesFactory) : null,
    };
  } catch (err) {
    reportSwallowed('sys-prompt-live.select', err);
    return null;
  }
}

// ─── 应用（保形态 + 幂等剥离）───────────────────────────────────────────────

function blockText(b) { return (b && typeof b.text === 'string') ? b.text : ''; }

/** 该 block 文本是否为 Anthropic billing-header 前缀块（行首即标记，无前导空白）。 */
export function isBillingHeaderText(text) {
  return typeof text === 'string' && text.startsWith(BILLING_HEADER_PREFIX);
}

/** 该 block 文本是否为 CLI/SDK 官方身份行。整块精确等于常量才保留 —— 实测真实 wire
 * 身份块恒为整块精确（37/37 blob），而 subagent persona（"You are a file search
 * specialist for Claude Code, Anthropic's official CLI…"）只含身份行片段、整块不等。
 * 不能用 startsWith：「身份行 + 追加内容」的块会被误留，让追加的 persona 逃过整段替换。
 * SDK 身份行常量从不在块开头（实测 SDK persona 是 "You are Claude Code, built on…"），
 * startsWith 本就识别不到，故精确匹配不损失 SDK 场景（其 persona 块本就该被替换）。
 * 导出供 append 守卫复用：保留块（billing/身份行）在 append 路径同样「永不并入」。 */
export function isCliIdentityText(text) {
  return typeof text === 'string' && CLI_IDENTITY_TEXTS.some(t => text === t);
}

// 保留 billing 块但把 text 截到首行：CC ≥2.1.181 会把 persona 夹进同一 block
// （`x-anthropic-billing-header: …;\nYou are Claude Code…`），整块保留会让官方 persona
// 逃过整段替换。对本机实测 wire（0/55071 多行 billing 块）是 no-op。
function preservedBillingBlock(block) {
  const t = blockText(block);
  const nl = t.indexOf('\n');
  return nl === -1 ? block : { ...block, text: t.slice(0, nl) };
}

// 取 blocks 里最靠后的 cache_control（含 ttl）：override 整段替换 / append 弹尾块时把断点
// 继承到新注入块，避免 ttl 被静默降级（P1-2）、值在下一轮读写一致（稳定不动点）。
function lastCacheControl(blocks) {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const cc = blocks[i] && blocks[i].cache_control;
    if (cc && typeof cc === 'object') return cc;
  }
  return null;
}

/**
 * 从尾部剥离已知注入文本，得到 base blocks。已知文本按长度降序逐个尝试：
 * 尾部 text block 的文本以「\n + 注入文本」结尾、或整个 block 等于注入文本时剥除。
 * 剥不出来（用户/CLI 改过 system）→ null（调用方跳过改写，安全降级）。
 *
 * @param {Array} blocks 原始 system 数组
 * @param {string[]} knownTexts 已知注入文本（launch entries + 缓存条目）
 * @returns {Array|null}
 */
export function deriveBaseBlocks(blocks, knownTexts) {
  if (!Array.isArray(blocks)) return null;
  const out = blocks.slice();
  const known = (knownTexts || []).filter(t => typeof t === 'string' && t.length > 0)
    .sort((a, b) => b.length - a.length);
  // 迭代到不动点：override+append 并存时注入形态是「override + '\n' + append」——
  // append 在尾部，剥掉它之后 override 才暴露为新尾。单趟扫描只会剥掉尾部那一条，
  // 残留的 override 下一轮再被拼一次（逐轮累积、KV-cache 每请求击穿）。多趟直到
  // 一轮内无任何剥离为止；每个已知文本全程最多剥一次（同一文本不会被注入两次）。
  const used = new Set();
  for (;;) {
    let strippedAny = false;
    for (let i = 0; i < known.length; i++) {
      if (used.has(i) || out.length === 0) continue;
      const last = out[out.length - 1];
      const lastText = blockText(last);
      if (!lastText) break;
      const t = known[i];
      if (lastText === t) {
        // 整个尾 block 就是注入文本 → 移除该 block（保留其余 block 的 cache_control）
        out.pop();
        used.add(i);
        strippedAny = true;
      } else if (lastText.length > t.length && lastText.endsWith(t) &&
          lastText[lastText.length - t.length - 1] === '\n') {
        // 尾 block = base + '\n' + 注入文本 → 剥回 base（保留 block 其余字段如 cache_control）
        const stripped = lastText.slice(0, lastText.length - t.length - 1);
        out[out.length - 1] = { ...last, text: stripped };
        used.add(i);
        strippedAny = true;
      }
    }
    if (!strippedAny) break;
  }
  return out;
}

/**
 * 应用固化条目到 system 值。保形态：数组输入 → 数组输出，字符串输入 → 字符串输出。
 * override 与 append 语义不同（对齐启动管线：--system-prompt-file 整段替换、
 * --append-system-prompt-file 追加到默认之后）：
 *   - override → 真整段替换：只保留 billing-header 前缀块，其余（CLI 官方 persona 等
 *     非 ccv 注入 block）全部移除，override 文本放入带 cache_control 断点的新尾块。
 *   - append   → 尾部拼接：deriveBase 剥离已知注入后并入尾 block（保留其 cache_control）。
 * 幂等：apply(apply(x)) === apply(x)（序列化相等 → 返回 null）。
 *
 * @param {string|Array} systemValue 原始 body.system
 * @param {{override:string|null, append:string|null}} entry 固化条目
 * @param {string[]} knownTexts 已知注入文本（幂等剥离用）
 * @returns {string|Array|null} 新 system 值；无变化/无法安全应用 → null
 */
export function applyLiveSystem(systemValue, entry, knownTexts = []) {
  try {
    if (!entry || (entry.override == null && entry.append == null)) return null;
    if (entry.override != null) {
      return _applyLiveOverride(systemValue, entry.override, entry.append);
    }
    return _applyLiveAppend(systemValue, entry.append, knownTexts);
  } catch (err) {
    reportSwallowed('sys-prompt-live.apply', err);
    return null;
  }
}

/**
 * override 整段替换：只保留「CLI 自有的非注入块」——billing-header 前缀块（计费/分类
 * 元数据）与 CLI 官方身份行块（D1：与启动 wire 形态 [billing, identity, persona] 一致，
 * override 会话首请求零改写、KV-cache 复用）——其余 block（第三方 persona / 上一次
 * override 注入）全部替换为 override 文本，放入继承 ephemeral 断点的新尾块（对齐 CLI
 * 把动态段放入缓存断点的行为）。
 * 幂等：输出只依赖（保留块, override文本, 断点），与待替换块无关 → 二次 apply 序列化
 * 相等 → null。无需 knownTexts 剥离：旧 override 随其余块一起被丢，模型切换永不累积。
 */
function _applyLiveOverride(systemValue, override, append) {
  // 目标注入文本：override 已含 append 时不重复拼接
  const injected = (append != null && !override.includes(append))
    ? override + '\n' + append
    : override;
  if (typeof injected !== 'string' || injected.length === 0) return null;

  if (typeof systemValue === 'string') {
    // 字符串形态：保留首部的 billing 行与 CLI 官方身份行（与数组形态 D1 一致 —— 真实
    // CLI 恒发数组、字符串形态 0 条，但接入方（SDK/第三方）若发字符串，两形态语义须
    // 一致，避免身份行在字符串形态被误丢）。按 \n 逐行识别保留行，其余整段替换。
    const lines = systemValue.split('\n');
    const keptLines = [];
    let i = 0;
    if (i < lines.length && isBillingHeaderText(lines[i])) { keptLines.push(lines[i]); i++; }
    if (i < lines.length && isCliIdentityText(lines[i])) { keptLines.push(lines[i]); i++; }
    const target = [...keptLines, injected].join('\n');
    return target === systemValue ? null : target;
  }
  if (!Array.isArray(systemValue)) return null;

  // 保留 billing 前缀块（截首行防多行夹带）与 CLI 官方身份行块，其余替换。
  // 撞车防护（review 第二轮 P1-3）：注入文本 injected 若恰命中保留判据（override 文本 ==
  // 官方身份常量、或以 billing 前缀开头），上一轮产出的注入尾块会被误判为「保留块」进
  // kept，同时 injected 又拼一次 → 每请求 +1 块无限累积。判据：块文本恰等于 injected 时
  // 优先视为「上一次注入」（进 dropped 被替换），不进 kept —— 真实的 billing/身份块文本
  // 与 override 注入文本完全相同的概率本就极低（这正是触发累积的同一条件）。
  const kept = [];
  const dropped = [];
  for (const b of systemValue) {
    const t = blockText(b);
    if (b && t === injected) { dropped.push(b); continue; } // 上一次注入 → 待替换，不保留
    if (b && isBillingHeaderText(t)) kept.push(preservedBillingBlock(b));
    else if (b && isCliIdentityText(t)) kept.push(b);
    else dropped.push(b);
  }
  const cc = lastCacheControl(dropped) || lastCacheControl(systemValue) || { type: 'ephemeral' };
  const target = [...kept, { type: 'text', text: injected, cache_control: cc }];
  // 幂等短路：proxy 已整段替换 / 二次 apply → 序列化相等 → null
  if (JSON.stringify(target) === JSON.stringify(systemValue)) return null;
  return target;
}

/**
 * append 尾部拼接：deriveBase 剥离已知注入后并入尾 block（保留其 cache_control）。
 * 与启动管线 --append-system-prompt-file 语义一致（追加到默认之后，不替换）。
 */
function _applyLiveAppend(systemValue, append, knownTexts) {
  const injected = append;
  if (typeof injected !== 'string' || injected.length === 0) return null;

  if (typeof systemValue === 'string') {
    // 字符串形态：deriveBase 剥离已知注入后拼接。deriveBase 对纯 base（无已知注入）
    // 原样返回，二次应用时注入文本被剥掉 → 幂等。
    const baseBlocks = deriveBaseBlocks([{ type: 'text', text: systemValue }], knownTexts);
    if (!baseBlocks) return null;
    const baseText = baseBlocks.map(blockText).join('');
    const target = baseText ? baseText + '\n' + injected : injected;
    return target === systemValue ? null : target;
  }

  if (!Array.isArray(systemValue)) return null;
  const baseBlocks = deriveBaseBlocks(systemValue, knownTexts);
  if (!baseBlocks) return null;
  // 安全降级（对齐 deriveBaseBlocks JSDoc 承诺）：system 里本有一条已知注入文本、但
  // 剥离没能去掉它（如 append 不在尾部）→ 再拼接会产生重复注入且成稳定不动点。
  // 判据：derive 后仍有 block 的文本以「\n + t + (\n|结尾)」或等于 t 的形态含某条已知
  // 文本——即它作为**独立段**存在于 block 中。不能用裸「子串包含」——短注入文本可能是
  // base 词的子串（如 'T0' 含于 'BASE'），会误伤。
  if (knownTexts.length > 0) {
    for (const t of knownTexts) {
      if (typeof t !== 'string' || t.length === 0) continue;
      for (const b of baseBlocks) {
        const bt = blockText(b);
        if (!bt) continue;
        if (bt === t) return null; // 整段即注入
        // 作为中间/尾部独立段存在：'\n'+t 且其后是 '\n' 或结尾
        const needle = '\n' + t;
        let from = 0;
        for (;;) {
          const idx = bt.indexOf(needle, from);
          if (idx === -1) break;
          const after = idx + needle.length;
          if (after === bt.length || bt[after] === '\n') return null; // 剥不出 → 放弃改写
          from = idx + 1;
        }
      }
    }
  }

  // 组装：尾 block 是可并入的 text 块（且非「保留块」——billing 前缀块 / CLI 身份行块）则
  // 把注入文本并入（保留其 cache_control），否则新增尾部 block 并带 cache_control（对齐 CLI
  // 把动态段放入缓存断点的行为）。
  // 先读断点（deriveBaseBlocks 可能已把带断点的尾块弹掉），继承到新尾块而非永久丢失（P1-2）。
  const inheritedCc = lastCacheControl(systemValue);
  const out = baseBlocks.slice();
  const last = out[out.length - 1];
  let newSystem;
  // 保留块（billing 前缀块 + CLI 身份行块）永不并入（review 第二轮 P1-2）：
  //  - billing：override 后 wire 仅剩 [billing] 时切 append，若并进 billing 块，之后任何
  //    override 都会因「前缀匹配」把这段 append 历史当元数据保留 → 永久泄漏。
  //  - 身份行：[billing, identity, persona] 切 append 时 persona 被 deriveBaseBlocks 剥离、
  //    identity 成新尾块，若并进 identity，切回 override 时 === 精确匹配失配 → 身份块被当
  //    persona 丢弃，此后该会话永久失去 CLI 身份块（违背 D1 首请求零改写）。
  if (last && last.type === 'text' && typeof last.text === 'string' &&
      !isBillingHeaderText(last.text) && !isCliIdentityText(last.text)) {
    const merged = { ...last, text: last.text ? last.text + '\n' + injected : injected };
    if (merged.cache_control == null && inheritedCc != null) merged.cache_control = inheritedCc;
    out[out.length - 1] = merged;
    newSystem = out;
  } else {
    newSystem = [...out, { type: 'text', text: injected, cache_control: inheritedCc || { type: 'ephemeral' } }];
  }
  // 无变化检测（幂等短路）：序列化比较
  if (JSON.stringify(newSystem) === JSON.stringify(systemValue)) return null;
  return newSystem;
}
