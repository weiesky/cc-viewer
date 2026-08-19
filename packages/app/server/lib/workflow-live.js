/**
 * Workflow Live (运行中逐帧)
 *
 * workflow run journal（<sessionDir>/workflows/<runId>.json）只在「完成时」一次性落盘，
 * 运行中拿不到。但运行中以下文件在持续增长，可据此实时推导面板：
 *   <sessionDir>/subagents/workflows/<runId>/
 *     ├─ agent-<id>.jsonl        子代理转写（持续增长）→ token / 工具数 / model / prompt
 *     ├─ agent-<id>.meta.json    {"agentType":...}
 *     └─ journal.jsonl           started / result 事件（带 agentId）→ running / done 判定
 *
 * 推导出的模型与 normalizeWorkflowJournal 同形。phases 由 parsePhasesFromScript 从生成脚本
 * （workflows/scripts/<name>-<runId>.js 顶部 meta.phases）文本解析填充——运行中即可显示阶段列；
 * 但 agent 的 phaseIndex 运行中仍为 null（无权威 agent→phase 映射），故前端按「有 phases 但无
 * agent 带 numeric phaseIndex」走扁平 agent 列表，完成后由权威的 <runId>.json 快照接管 phase 分组。
 *
 * token 口径：input + output + cache_creation（运行中单调增；与完成快照略有出入，完成时被
 * 权威值替换）。工具数与快照一致（统计 tool_use 块）。
 */

import { existsSync, readFileSync, statSync, readdirSync, realpathSync, openSync, readSync, closeSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { getClaudeConfigDir } from '../../findcc.js';
import { findTranscriptPath } from './session-transcript-reader.js';
import { _RUN_ID_RE as RUN_ID_RE } from './workflow-journal.js';

const MAX_AGENT_BYTES = 64 * 1024 * 1024;
const LABEL_MAX = 80;
const PROMPT_PREVIEW_MAX = 600;  // 头部菱形 hover 预览的 prompt 截断长度（与 journal promptPreview 量级一致）
const MAX_SCRIPT_BYTES = 2 * 1024 * 1024;  // 脚本超过此大小只读头部 SCRIPT_HEAD_BYTES（meta 恒在文件最前）
const SCRIPT_HEAD_BYTES = 256 * 1024;      // 超大脚本时读取的头部字节数，足够覆盖 meta 块
const MAX_PHASES = 50;                       // 解析出的 phases 项数上限（防御异常脚本）
const PHASES_CACHE_MAX = 256;                // _phasesCache 条目上限（防长跑服务端无界增长）

function projectsDir() {
  return process.env.CCV_PROJECTS_DIR || join(getClaudeConfigDir(), 'projects');
}

/** sessionId(+hint) → <sessionDir>/subagents/workflows/<runId>（可能不存在）。 */
export function resolveRunDir(sessionId, projectHint, runId) {
  if (!sessionId || !runId) return null;
  // 与完成态 journal 同一 runId 校验：拒绝含路径分隔符/`..` 的 runId，防穿越到其他 run/session 目录。
  if (!RUN_ID_RE.test(runId)) return null;
  const transcript = findTranscriptPath(sessionId, projectHint);
  if (!transcript) return null;
  return join(dirname(transcript), sessionId, 'subagents', 'workflows', runId);
}

function isInsideProjectsDir(realPath) {
  let root;
  try { root = realpathSync(projectsDir()); } catch { return false; }
  return realPath === root || realPath.startsWith(root + sep);
}

/**
 * 从 workflows/scripts/<name>-<runId>.js 反推 workflowName + 脚本绝对路径（运行中即可拿到）。
 * 一次 readdirSync 同时给出 name 与 scriptPath，供 phases 解析复用，避免重复扫目录。
 * @returns {{ name: string, scriptPath: string|null }}
 */
function deriveWorkflowScript(sessionDir, runId) {
  try {
    const scriptsDir = join(sessionDir, 'workflows', 'scripts');
    const suffix = `-${runId}.js`;
    for (const f of readdirSync(scriptsDir)) {
      if (f.endsWith(suffix)) {
        return { name: f.slice(0, -suffix.length), scriptPath: join(scriptsDir, f) };
      }
    }
  } catch {}
  return { name: '', scriptPath: null };
}

/**
 * 从一个对象/数组字面量起始的开括号位置，做「字符串感知」的括号配对扫描，
 * 返回配平的闭括号下标（含）；不配平返回 -1。
 * 进入 '...' / "..." 串态时不计括号、并处理 `\` 转义，故 detail 文本里的
 * `]` `}` `'` 都不会破坏配对。
 */
function _matchBalanced(text, openIdx) {
  const open = text[openIdx];
  const close = open === '[' ? ']' : '}';
  let depth = 0, inStr = false, quote = '', esc = false;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === quote) inStr = false;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = true; quote = ch; continue; }
    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 反转义 JS 单/双引号字符串字面量的内容（仅常见序列；够用且安全）。 */
function _unescapeStr(s) {
  return s.replace(/\\(['"`\\nrt])/g, (_, c) =>
    c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c);
}

/**
 * 在一段对象字面量文本里抽取 `key: '...'`（字符串感知，处理转义）。无则 null。
 * key 前要求边界字符（`{` / `,` / 空白 / 串首），避免 subtitle/subdetail 等更长键名
 * 子串命中 title/detail。
 */
function _extractStrField(objText, key) {
  const re = new RegExp(`(?:^|[{,\\s])${key}\\s*:\\s*(['"\`])`);
  const m = re.exec(objText);
  if (!m) return null;
  const quote = m[1];
  let i = m.index + m[0].length, esc = false, out = '';
  for (; i < objText.length; i++) {
    const ch = objText[i];
    if (esc) { out += ch; esc = false; continue; }
    if (ch === '\\') { out += ch; esc = true; continue; }
    if (ch === quote) return _unescapeStr(out);
    out += ch;
  }
  return null;
}

/**
 * 纯文本解析 workflow 脚本顶部 `export const meta = { ... phases: [{title, detail?}, ...] }`。
 * 绝不 import/eval 脚本（执行不可信代码）。输出与 normalizeWorkflowJournal 同形：
 *   [{ index:(从1), title:string, detail:string('' if missing) }]
 * 任何异常/不匹配/无 phases 一律返回 []。
 */
export function parsePhasesFromScript(scriptText) {
  if (typeof scriptText !== 'string' || !scriptText) return [];
  // 框定 meta 块（meta 恒为顶部纯字面量）
  const metaKey = scriptText.match(/export\s+const\s+meta\s*=\s*\{/);
  if (!metaKey) return [];
  const metaOpen = scriptText.indexOf('{', metaKey.index);
  const metaClose = _matchBalanced(scriptText, metaOpen);
  if (metaClose === -1) return [];
  const metaBody = scriptText.slice(metaOpen, metaClose + 1);

  // 在 meta 内定位 phases 数组（字符串感知配对，detail 内的 `]` 不影响）
  const phasesKey = metaBody.match(/phases\s*:\s*\[/);
  if (!phasesKey) return [];
  const arrOpen = metaBody.indexOf('[', phasesKey.index);
  const arrClose = _matchBalanced(metaBody, arrOpen);
  if (arrClose === -1) return [];
  const arrBody = metaBody.slice(arrOpen + 1, arrClose);

  // 逐项切出 {...} 对象（字符串感知配对），抽 title/detail
  const phases = [];
  let i = 0;
  while (i < arrBody.length && phases.length < MAX_PHASES) {
    const objOpen = arrBody.indexOf('{', i);
    if (objOpen === -1) break;
    const objClose = _matchBalanced(arrBody, objOpen);
    if (objClose === -1) break;
    const objText = arrBody.slice(objOpen, objClose + 1);
    const title = _extractStrField(objText, 'title');
    if (title !== null) {
      phases.push({ index: phases.length + 1, title, detail: _extractStrField(objText, 'detail') || '' });
    }
    i = objClose + 1;
  }
  return phases;
}

// scriptPath → { mtimeMs, size, phases }。脚本运行中不可变，命中即跳过读盘+解析；
// edit-then-resume（mtime/size 变）则重解析。size 上限淘汰防长跑无界增长。
const _phasesCache = new Map();

/** 安全读取并（带缓存地）解析脚本 phases。失败/越界一律 []。 */
function readPhasesCached(scriptPath) {
  if (!scriptPath) return [];
  let real;
  try { real = realpathSync(scriptPath); } catch { return []; }
  if (!isInsideProjectsDir(real)) return [];

  let mtimeMs, size;
  try { ({ mtimeMs, size } = statSync(real)); } catch { return []; }

  const hit = _phasesCache.get(real);
  if (hit && hit.mtimeMs === mtimeMs && hit.size === size) return hit.phases;

  let text = '';
  try {
    if (size <= MAX_SCRIPT_BYTES) {
      text = readFileSync(real, 'utf-8');
    } else {
      const fd = openSync(real, 'r');
      try {
        const buf = Buffer.allocUnsafe(SCRIPT_HEAD_BYTES);
        const n = readSync(fd, buf, 0, SCRIPT_HEAD_BYTES, 0);
        text = buf.subarray(0, n).toString('utf-8');
      } finally { closeSync(fd); }
    }
  } catch { return []; }

  const phases = parsePhasesFromScript(text);
  if (_phasesCache.size >= PHASES_CACHE_MAX) _phasesCache.clear();
  _phasesCache.set(real, { mtimeMs, size, phases });
  return phases;
}

/** 测试辅助：清空 phases 解析缓存。 */
export function __clearPhasesCacheForTests() {
  _phasesCache.clear();
}

// 每文件增量解析缓存：filePath → { mtimeMs, size, offset, partial(Buffer), acc }。
// agent-*.jsonl 是 append-only：仅从上次 offset 续读新增字节、按行喂入累加器 acc，
// 避免每帧对正在增长的活跃 agent 文件做 O(size) 全量重读（partial 以字节保留，
// 跨读边界的不完整行/多字节 UTF-8 字符不被切坏，只在换行符处解码）。
const _agentParseCache = new Map();

function _newAcc() {
  return { tokens: 0, toolCalls: 0, lastToolName: '', model: '', prompt: '', startedAt: null, lastProgressAt: null };
}

function _accSnapshot(acc) {
  return {
    tokens: acc.tokens, toolCalls: acc.toolCalls, lastToolName: acc.lastToolName,
    model: acc.model, prompt: acc.prompt, startedAt: acc.startedAt, lastProgressAt: acc.lastProgressAt,
  };
}

function _applyLine(acc, line) {
  if (!line) return;
  let o;
  try { o = JSON.parse(line); } catch { return; }
  const ts = Date.parse(o.timestamp || '');
  if (!Number.isNaN(ts)) {
    if (acc.startedAt === null) acc.startedAt = ts;
    acc.lastProgressAt = ts;
  }
  const msg = o.message;
  if (!msg) return;
  if (o.type === 'user' && !acc.prompt && typeof msg.content === 'string') acc.prompt = msg.content;
  if (typeof msg.model === 'string' && msg.model) acc.model = msg.model;
  const u = msg.usage;
  if (u) acc.tokens += (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0);
  if (Array.isArray(msg.content)) {
    for (const b of msg.content) {
      if (b && b.type === 'tool_use') { acc.toolCalls++; if (b.name) acc.lastToolName = b.name; }
    }
  }
}

function parseAgentFile(filePath) {
  let st;
  try { st = statSync(filePath); } catch { return null; }
  const { mtimeMs, size } = st;

  const cached = _agentParseCache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs && cached.size === size) {
    return _accSnapshot(cached.acc);   // 未变 → 直接返回快照，不读盘
  }
  if (size > MAX_AGENT_BYTES) return _newAcc();

  // 可续读：缓存存在且文件未被截断/轮转（size 未回退到 offset 之前）→ 从 offset 增量读；否则从头读。
  let acc, offset, partial;
  if (cached && cached.acc && size >= cached.offset) {
    acc = cached.acc; offset = cached.offset; partial = cached.partial || Buffer.alloc(0);
  } else {
    acc = _newAcc(); offset = 0; partial = Buffer.alloc(0);
  }

  let chunk = Buffer.alloc(0);
  try {
    if (size > offset) {
      const fd = openSync(filePath, 'r');
      try {
        const len = size - offset;
        const buf = Buffer.allocUnsafe(len);
        let read = 0;
        while (read < len) {
          const n = readSync(fd, buf, read, len - read, offset + read);
          if (n <= 0) break;
          read += n;
        }
        chunk = buf.subarray(0, read);
        offset += read;
      } finally { closeSync(fd); }
    }
  } catch {
    return _accSnapshot(acc);   // 读失败 → 返回已累计，不更新缓存（下次重试）
  }

  // 只解码到「最后一个换行符」为止；其后不完整行以字节留到下次（避免切坏多字节字符）。
  const combined = chunk.length ? Buffer.concat([partial, chunk]) : partial;
  const lastNL = combined.lastIndexOf(0x0A);
  let newPartial;
  if (lastNL === -1) {
    newPartial = combined;
  } else {
    const complete = combined.subarray(0, lastNL).toString('utf-8');
    for (const line of complete.split('\n')) _applyLine(acc, line);
    newPartial = combined.subarray(lastNL + 1);
  }

  _agentParseCache.set(filePath, { mtimeMs, size, offset, partial: newPartial, acc });
  return _accSnapshot(acc);
}

function readResumeJournal(runDir) {
  const started = new Set();
  const done = new Set();
  try {
    const lines = readFileSync(join(runDir, 'journal.jsonl'), 'utf-8').split('\n');
    for (const line of lines) {
      if (!line) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      if (!o.agentId) continue;
      if (o.type === 'started') started.add(o.agentId);
      else if (o.type === 'result') done.add(o.agentId);
    }
  } catch {}
  return { started, done };
}

function labelFromPrompt(prompt, agentType) {
  if (prompt) {
    const firstLine = prompt.split('\n').map(s => s.trim()).find(Boolean) || '';
    if (firstLine) return firstLine.length > LABEL_MAX ? firstLine.slice(0, LABEL_MAX) + '…' : firstLine;
  }
  return agentType || '';
}

/**
 * 从 runDir 实时推导面板模型（与 normalizeWorkflowJournal 同形，phases 为空）。
 * 无 agent 文件 → null。
 */
export function deriveLiveJournal(runDir, runId) {
  if (!runDir || !existsSync(runDir)) return null;
  let real;
  try { real = realpathSync(runDir); } catch { return null; }
  if (!isInsideProjectsDir(real)) return null;

  let files;
  try { files = readdirSync(runDir); } catch { return null; }
  const agentFiles = files.filter(f => f.startsWith('agent-') && f.endsWith('.jsonl'));
  if (agentFiles.length === 0) return null;

  const { done } = readResumeJournal(runDir);
  // sessionDir = runDir 上溯三级（runId → workflows → subagents → sessionDir）
  const sessionDir = dirname(dirname(dirname(runDir)));
  const { name: workflowName, scriptPath } = deriveWorkflowScript(sessionDir, runId);
  // 运行中从生成脚本文本解析 meta.phases 填充阶段列（权威 <runId>.json 落盘后由完成快照接管）。
  const phases = readPhasesCached(scriptPath);

  const agents = [];
  let totalTokens = 0, totalToolCalls = 0;
  for (const f of agentFiles) {
    const agentId = f.slice('agent-'.length, -'.jsonl'.length);
    const parsed = parseAgentFile(join(runDir, f));
    if (!parsed) continue;
    let agentType = '';
    try { agentType = JSON.parse(readFileSync(join(runDir, `agent-${agentId}.meta.json`), 'utf-8')).agentType || ''; } catch {}
    // agent 文件存在即已启动（排队中尚无文件），故非 done 一律 running
    const state = done.has(agentId) ? 'done' : 'running';
    totalTokens += parsed.tokens;
    totalToolCalls += parsed.toolCalls;
    agents.push({
      index: null,
      label: labelFromPrompt(parsed.prompt, agentType),
      phaseIndex: null,
      phaseTitle: '',
      agentId,
      agentType,
      model: parsed.model,
      state,
      tokens: parsed.tokens,
      toolCalls: parsed.toolCalls,
      durationMs: (parsed.startedAt && parsed.lastProgressAt) ? (parsed.lastProgressAt - parsed.startedAt) : null,
      lastToolName: parsed.lastToolName,
      lastToolSummary: '',
      // 头部菱形 hover 用：实时态取首条 user prompt 截断；尾部 resultPreview 待完成快照(journal)补。
      promptPreview: parsed.prompt
        ? (parsed.prompt.length > PROMPT_PREVIEW_MAX ? parsed.prompt.slice(0, PROMPT_PREVIEW_MAX) + '…' : parsed.prompt)
        : '',
      resultPreview: '',
      startedAt: parsed.startedAt,
      lastProgressAt: parsed.lastProgressAt,
    });
  }

  agents.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
  const allDone = agents.length > 0 && agents.every(a => a.state === 'done');
  const startTime = agents.reduce((min, a) => (a.startedAt && (min === null || a.startedAt < min)) ? a.startedAt : min, null);

  return {
    runId: runId || '',
    taskId: '',
    workflowName,
    summary: '',
    status: allDone ? 'finishing' : 'running',
    durationMs: null,
    agentCount: agents.length,
    totalTokens,
    totalToolCalls,
    defaultModel: '',
    startTime,
    phases,
    agents,
    live: true,
  };
}
