// 内容分类与过滤规则
// ChatView（对话模式）和 AppHeader（用户 Prompt 弹窗）共用此模块，确保过滤逻辑一致。
// MainAgent / Teammate 判断也收敛于此，供全局统一调用。

// ============== 请求体辅助 ==============

const SUBAGENT_SYSTEM_RE = /command execution specialist|file search specialist|planning specialist|general-purpose agent|security monitor|performing a web search/i;

// cc_version 2.1.181+：CLI 在 billing header 显式标注子代理（cc_is_subagent=true）；真·主代理省略此字段（从不为 =false）。
// 这类子代理继承完整 "You are Claude Code" prompt + Edit/Bash/Agent 工具，会误中轻量 MainAgent 启发式，故须显式排除。
// 结尾 \b 锚定：仅匹配 `=true`（其后为 `;` / 空白 / 串尾），避免 `=truex` 之类误匹配。
const SUBAGENT_BILLING_RE = /cc_is_subagent=true\b/;

// Teammate 检测：system prompt 中包含 Agent Teammate Communication 标记（外部进程 teammate）
const TEAMMATE_SYSTEM_RE = /running as an agent in a team|Agent Teammate Communication/i;

// Native teammate 检测（同进程内 Agent 子代理），独立模块便于版本兼容
// Extensioned for server-side reuse (see requestType.js header note).
import { isNativeTeammate, extractNativeTeammateName } from './teammateDetector.js';

// ============== 跨会话 / teammate「协议通知」识别 ==============
// harness 把跨会话 / teammate 通知作为 role=user 文本注入主会话。既有逻辑只认 <teammate-message>
// 包裹形态与 "Another Claude session sent a message:" 前缀；这里补「裸协议 JSON」形态 + 新版 caveat 文案，
// 统一归类为 teammate 状态气泡（非用户手输）。type 白名单与 ChatMessage 的 ui.teammate.${type} 渲染一致。
export const INTER_SESSION_NOTIFICATION_TYPES = new Set([
  'idle_notification', 'shutdown_request', 'shutdown_response',
  'shutdown_approved', 'teammate_terminated',
  'plan_approval_request', 'plan_approval_response',
]);

// harness 注入的「跨会话包裹文本」标记（英文固定）。
const INTER_SESSION_LEAD_RE = /^Another Claude session sent a message:/i;
// 尾部 caveat（新旧两种措辞）。刻意不用 /m：`(^|\n)` 提供行首锚定，`$` 表整串结尾——多行 caveat 会一并
// 剥到空行 / 串尾，不会因 lazy + /m 只剥首行；行首锚定避免误伤用户正文中段引用此句。
const INTER_SESSION_CAVEAT_RES = [
  /(^|\n)This came from another Claude session[\s\S]*?(?=\n\n|$)/i,
  /(^|\n)IMPORTANT: This is NOT from your user[\s\S]*?(?=\n\n|$)/i,
];

// 花括号配对扫描出顶层 {...} 候选 JSON 段（跳过字符串字面量内的花括号 / 转义），返回 { raw, start, end }
// 区间，供调用方一次性区间拼接剔除（不逐个 replace，避免 O(n²)）。用配对而非 [^{}]* 正则以正确处理嵌套。
function scanTopLevelJsonObjects(s) {
  if (typeof s !== 'string' || s.indexOf('{') === -1) return [];
  const out = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}' && depth > 0) { depth--; if (depth === 0 && start >= 0) { out.push({ raw: s.slice(start, i + 1), start, end: i + 1 }); start = -1; } }
  }
  return out;
}

// 识别 s 中的白名单协议通知 JSON：返回 { statuses:[{type,from}], rest }，rest = 剔除这些 JSON 后的剩余文本。
// 单次扫描 + 区间拼接（O(n)）：避免对每个命中 JSON 做整串 replace 造成 O(n²)（评审 S1），同时统一原先
// replace/split-join 两套剔除写法。非白名单 / 解析失败的 {...} 原样保留在 rest 中。
function extractProtocolNotifications(s) {
  const statuses = [];
  let rest = '', cursor = 0;
  for (const { raw, start, end } of scanTopLevelJsonObjects(s)) {
    let j;
    try { j = JSON.parse(raw); } catch { continue; }
    if (j && typeof j.type === 'string' && INTER_SESSION_NOTIFICATION_TYPES.has(j.type)) {
      statuses.push({ type: j.type, from: (typeof j.from === 'string' && j.from) ? j.from : null });
      rest += s.slice(cursor, start);
      cursor = end;
    }
  }
  rest += s.slice(cursor);
  return { statuses, rest };
}

// 解析「裸协议通知」文本块（不含 <teammate-message> 包裹——包裹形态由 classifyUserContent 主路径处理）。
// 返回 { statuses:[{type,from}], rest } 或 null。必须带 harness 标记（前缀 / caveat）才认定为通知（见下）。
export function parseInterSessionNotification(text) {
  if (typeof text !== 'string') return null;
  let body = text.trim();
  if (!body) return null;
  // 去 <teammate-message> 包裹，避免与 classifyUserContent 主路径重复计入
  body = body.replace(/<teammate-message[\s\S]*?<\/teammate-message>/gi, '').trim();
  if (!body) return null;

  const hadLead = INTER_SESSION_LEAD_RE.test(body);
  let work = hadLead ? body.replace(INTER_SESSION_LEAD_RE, '') : body;
  let hadCaveat = false;
  for (const cr of INTER_SESSION_CAVEAT_RES) {
    if (cr.test(work)) { hadCaveat = true; work = work.replace(cr, ''); }
  }
  // 必须带 harness 标记（"Another Claude session…" 前缀 或 caveat 段）才认定为通知。真实跨会话通知一定
  // 带其一（裸 <teammate-message> 包裹形态由 classifyUserContent 主路径单独处理）；据此，用户「整段粘贴一坨
  // 协议形 JSON」绝不会被误判隐藏——彻底消除 over-filter 向量（评审 S2/F2，对齐用户「别过滤正常请求」诉求）。
  if (!hadLead && !hadCaveat) return null;

  const { statuses, rest } = extractProtocolNotifications(work);
  if (statuses.length === 0) return null;
  return { statuses, rest: rest.trim() };
}

/**
 * 提取请求体中的 system prompt 文本
 */
export function getSystemText(body) {
  const system = body?.system;
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) {
    return system.map(s => (s && s.text) || '').join('');
  }
  return '';
}

// WeakMap cache for isTeammate — avoids redundant getSystemText + regex per request
const _isTeammateCache = new WeakMap();

/**
 * 判断请求是否为 Teammate 子进程的请求。
 * 支持两种检测：interceptor ���式（req.teammate 字段）和 proxy 模式（system prompt 标记）。
 * 全局唯一入口，与 isMainAgent 同级。
 */
export function isTeammate(req) {
  if (!req) return false;
  const cached = _isTeammateCache.get(req);
  if (cached !== undefined) return cached;
  // 【最高优先级】wire agent 身份信号（x-claude-code-agent-id / cc_is_subagent，
  // 见 agent-id.js）。自 Claude Code 2.1.199 起普通 subagent 也被授予 SendMessage
  // 工具，isNativeTeammate 的 SendMessage 判据不再可靠——这两个信号是硬判据：
  //  - 持久化 agent 命名形态（name@session-…）→ 一定是 Teammate；
  //  - 持久化 agent 匿名 hex 形态 → 一定是 SubAgent（否决下方 SendMessage 判据）；
  //  - cc_is_subagent=true（CLI 自报 billing 标记，2.1.181+）→ 一定是 SubAgent。
  const agent = req.agent;
  if (agent) {
    if (agent.named) { _isTeammateCache.set(req, true); return true; }
    _isTeammateCache.set(req, false); return false;
  }
  const sysText = getSystemText(req.body || {});
  if (SUBAGENT_BILLING_RE.test(sysText)) { _isTeammateCache.set(req, false); return false; }
  // interceptor 模式：通过 process.argv 写入的 teammate 字段
  if (req.teammate) { _isTeammateCache.set(req, true); return true; }
  // native teammate：同进程内 Agent 子代理（system prompt 包含 "You are a Claude agent"）
  if (isNativeTeammate(req)) {
    // 注入 teammate 字段供下游 requestType.js 的 formatTeammateLabel 使用。
    // 持久化的 wire agent 名（x-claude-code-agent-id，见 agent-id.js）优先——
    // 它不依赖窗口内的注册表，冷加载/时序缺失时名字仍可靠。
    if (!req.teammate) {
      req.teammate = req.agent?.agentName || extractNativeTeammateName(req) || null;
    }
    _isTeammateCache.set(req, true);
    return true;
  }
  // proxy 模式：通过 system prompt 检测（外部进程 teammate）
  const result = TEAMMATE_SYSTEM_RE.test(sysText);
  _isTeammateCache.set(req, result);
  return result;
}

// WeakMap cache for isMainAgent — avoids redundant regex/array work across call sites
const _isMainAgentCache = new WeakMap();

/**
 * 判断请求是否为 MainAgent 请求。
 * 包含 interceptor 标记校验 + 新旧架构检测，全局唯一入口。
 */
export function isMainAgent(req) {
  if (!req) return false;
  const cached = _isMainAgentCache.get(req);
  if (cached !== undefined) return cached;
  const result = _isMainAgentImpl(req);
  _isMainAgentCache.set(req, result);
  return result;
}

function _isMainAgentImpl(req) {
  if (!req) return false;

  // Teammate 子进程的请求不是 MainAgent，避免污染主会话视图
  if (isTeammate(req)) return false;

  // cc_is_subagent=true ⇒ 子代理，绝非 MainAgent（cc_version 2.1.181+）。须早于下方 req.mainAgent 短路，
  // 以覆盖「已落盘旧日志」里被服务端标成 mainAgent=true 的记录（向后兼容：旧日志/真·主代理无此 token）。
  if (SUBAGENT_BILLING_RE.test(getSystemText(req.body || {}))) return false;

  if (req.mainAgent) {
    // 排除被误标记的 SubAgent（旧日志兼容）
    const sysText = getSystemText(req.body || {});
    if (SUBAGENT_SYSTEM_RE.test(sysText)) return false;
    return true;
  }

  // 统一检测逻辑：支持新旧架构
  const body = req.body || {};
  if (!body.system || !Array.isArray(body.tools)) return false;

  const sysText = getSystemText(body);

  // 必须包含 MainAgent 身份标识
  if (!sysText.includes('You are Claude Code')) return false;

  // 排除 SubAgent
  if (SUBAGENT_SYSTEM_RE.test(sysText)) return false;

  // 新架构检测（v2.1.69+）：延迟工具加载机制
  const isSystemArray = Array.isArray(body.system);
  const hasToolSearch = body.tools.some(t => t.name === 'ToolSearch');

  if (isSystemArray && hasToolSearch) {
    // 检查第一条消息是否包含 <available-deferred-tools>
    const messages = body.messages || [];
    const firstMsgContent = messages.length > 0 ?
      (typeof messages[0].content === 'string' ? messages[0].content :
       Array.isArray(messages[0].content) ? messages[0].content.map(c => c.text || '').join('') : '') : '';
    if (firstMsgContent.includes('<available-deferred-tools>')) {
      return true;
    }
  }

  // v2.1.81+: 轻量 MainAgent 初始请求工具数可能 < 10，降低阈值兼容
  if (body.tools.length > 5) {
    const hasEdit = body.tools.some(t => t.name === 'Edit');
    const hasShell = body.tools.some(t => t.name === 'Bash' || t.name === 'PowerShell');
    const hasTaskOrAgent = body.tools.some(t => t.name === 'Task' || t.name === 'Agent');
    if (hasEdit && hasShell && hasTaskOrAgent) {
      return true;
    }
  }

  return false;
}

// /clear checkpoint 检测：抽到独立无依赖模块，便于 node --test 直接 import。
export { isPostClearCheckpoint, isCompactContinuation, isSessionBoundary } from './clearCheckpoint.js';

// ============== 文本内容过滤 ==============

/**
 * 判断文本是否为 Skill 加载内容
 */
export function isSkillText(text) {
  if (!text) return false;
  return /^Base directory for this skill:/i.test(text.trim());
}

/**
 * 判断文本是否为系统注入文本（不应作为用户消息展示）
 */
/**
 * Strip known system/command tags from a text block, returning only user-authored content.
 * Used to extract user input embedded in system-reminder-wrapped blocks (e.g., /ultraplan).
 */
function stripSystemTags(text) {
  if (!text) return '';
  let out = text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '')
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/gi, '')
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/gi, '')
    .replace(/<command-name>[\s\S]*?<\/command-name>/gi, '')
    .replace(/<command-message>[\s\S]*?<\/command-message>/gi, '')
    .replace(/<command-args>[\s\S]*?<\/command-args>/gi, '')
    .replace(/<teammate-message[\s\S]*?<\/teammate-message>/gi, '')
    .replace(/<task-notification>[\s\S]*?<\/task-notification>/gi, '')
    // harness 注入队友消息轮的包裹文本：前缀行 + 尾部 IMPORTANT 免责段。
    // 尾段用 ^...m 多行锚定——段落必须起行才剥，用户正文中段引用该句不受影响；
    // 只锚定句首短语、不绑定其后的破折号/措辞（harness 微调标点不致尾段泄漏成 user 气泡）
    .replace(/^Another Claude session sent a message:\s*/i, '')
    .replace(/^IMPORTANT: This is NOT from your user\b[\s\S]*?(?=\n\n|$)/im, '');
  // 新版跨会话 caveat（多行安全：行首锚定，剥到空行 / 串尾）
  out = out.replace(/(^|\n)This came from another Claude session[\s\S]*?(?=\n\n|$)/i, '');
  // 裸协议通知 JSON（idle / shutdown_* / teammate_terminated / plan_approval_*，含嵌套）——单次扫描剔除
  // （O(n)，评审 S1）。与 <teammate-message> 包裹的协议 JSON 同类，剥离后二次回收只剩用户追加正文（无则空）
  out = extractProtocolNotifications(out).rest;
  return out.trim();
}

// Claude Code 内部合成 prompt 白名单（CLI 在主会话里合成的 recap/title/compact/topic/summary 查询，
// HTTP 层 role=user 但不是用户手输）。与 requestType.js 的 Synthetic 分类共用同一白名单，
// 在 isSystemText 里统一过滤 → ChatView / Mobile / DetailPanel / teamModalBuilder 全链路隐藏。
// 匹配 last user message 的起首（`^` 锚定 + trim），避免误伤用户引用原文。
// KEEP IN SYNC: packages/core/test/synthetic-classification.test.js 有 inline 副本。
export const SYNTHETIC_PROMPTS = [
  { subType: 'Recap',   pattern: /^The user stepped away and is coming back\. Recap in under/i },
  { subType: 'Title',   pattern: /^(Based on the above conversation, generate a|Please write a)\s+(short|concise)\s+title/i },
  { subType: 'Compact', pattern: /^(Your task is to create a detailed summary of the conversation|This session is being continued from a previous conversation)/i },
  { subType: 'Topic',   pattern: /^Analyze if this message indicates a new/i },
  { subType: 'Summary', pattern: /^Summarize this coding session/i },
];

export function isSyntheticPromptText(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  for (const { pattern } of SYNTHETIC_PROMPTS) {
    if (pattern.test(trimmed)) return true;
  }
  return false;
}

// UltraPlan 输入识别：UltraPlanModal / CLI /ultraplan 都会把 ultraplanTemplates.js
// 组装的 <system-reminder>[SCOPED INSTRUCTION]…</system-reminder> 模板前置到用户 prompt。
// 该 marker 仅由 ultraplanTemplates.js 产出，故可作为「本轮是 UltraPlan 输入」的可靠信号。
// stripSystemTags 会剥掉该块，所以必须在原始（未剥离）文本上判断；用负向前瞻确保 marker
// 出现在同一个 <system-reminder>…</system-reminder> 块内部（不跨过闭合标签），避免用户正文里
// 在某个无关 reminder 之后只是「提到」该短语时误判。
export function isUltraplanText(text) {
  if (!text || typeof text !== 'string') return false;
  return /<system-reminder>(?:(?!<\/system-reminder>)[\s\S])*?\[SCOPED INSTRUCTION\]/i.test(text);
}

export function isSystemText(text) {
  if (!text) return true;
  const trimmed = text.trim();
  if (!trimmed) return true;
  // 包含 plan 内容的文本块不应被过滤（即使开头有系统标签）
  if (/Implement the following plan:/i.test(trimmed)) return false;
  if (/^<[a-zA-Z_][\w-]*[\s>]/i.test(trimmed)) return true;
  if (/^\[SUGGESTION MODE:/i.test(trimmed)) return true;
  // Claude Code 输出截断时注入的系统消息
  if (/^Your response was cut off because it exceeded the output token limit/i.test(trimmed)) return true;
  // Skill 加载的文档内容
  if (/^Base directory for this skill:/i.test(trimmed)) return true;
  // CLI 内部合成 prompt（Recap/Title/Compact/Topic/Summary）
  if (isSyntheticPromptText(trimmed)) return true;
  // harness 注入的队友消息轮：包裹文本（前缀 + 尾部 IMPORTANT 段）非用户手输，
  // teammate 内容本身经 classifyUserContent 提取为 teammateBlocks 独立渲染
  if (/^Another Claude session sent a message:/i.test(trimmed)) return true;
  // 裸协议通知（直接以协议 JSON 起头、无 "Another Claude session" 前缀）：必须 parseInterSessionNotification
  // 命中白名单协议 JSON 才算系统文本——粘贴非协议 JSON / 含追加正文不会被误吞。caveat 是尾部 chrome
  // （真实形态总是 JSON 在前、caveat 在后），故「起头即 caveat」的块视为用户正文，防整段消失（评审 F1）；
  // 其 caveat chrome 在确为通知的块内由 parse / stripSystemTags 处理。
  if (trimmed.startsWith('{') && parseInterSessionNotification(trimmed)) return true;
  // 用户拒绝 tool / 中断 Claude 时 CLI 注入的占位 user message —— 与上方 "✗ 已拒绝" badge 语义重复
  // 涵盖历史变体："[Request interrupted by user for tool use]"、"[Request interrupted by user]"、"[Request interrupted...]"
  if (/^\[Request interrupted/i.test(trimmed)) return true;
  return false;
}

// 字符串型 user/assistant message 的「可显示正文」。忠实镜像 classifyUserContent 的两段语义
// （classifyUserContent 内「首过滤 + stripSystemTags 二次回收」两步），只是作用于字符串：
//   Pass1：非系统文本 → 原样返回（保留用户正文中段引用的成对标签，与当前行为逐字一致，零回归）；
//   Pass2：系统块（以 chrome 标签起首等被 isSystemText 判真）→ 剥掉已知 chrome 后再判，仍是真实正文则
//          返回剥离后正文，否则 ''（应隐藏）。
// 解决「系统标签起首 + 真实正文」字符串被 isSystemText 整条吞掉（数组路径有此回收，字符串路径原先没有）。
// 注意：用户手打未闭合 <system-reminder>（无配对）仍判系统文本而隐藏——沿用当前行为，本函数不改变它。
export function extractDisplayText(str) {
  if (typeof str !== 'string' || !str.trim()) return '';
  if (!isSystemText(str)) return str;                  // Pass1：已是用户文本，原样
  const recovered = stripSystemTags(str);               // Pass2：二次回收
  return (recovered && !isSystemText(recovered)) ? recovered : '';
}

/**
 * 从 user message 的 content 数组中分类提取各类文本块。
 * @param {Array} content — message.content 数组
 * @returns {{ commands: string[], textBlocks: Array, skillBlocks: Array, teammateBlocks: Array, taskNotificationBlocks: Array }}
 *   commands              — 提取到的 slash command 名称（如 "/clear"）
 *   textBlocks            — 过滤后的普通用户文本块（不含系统文本、command 块、skill 块）
 *   skillBlocks           — skill 加载的文本块
 *   teammateBlocks        — teammate-message 解析块
 *   taskNotificationBlocks — task-notification 解析块
 */
export function classifyUserContent(content) {
  if (!Array.isArray(content)) return { commands: [], textBlocks: [], skillBlocks: [], teammateBlocks: [], taskNotificationBlocks: [] };

  // Extract <teammate-message> blocks from user content
  const teammateBlocks = [];
  for (const b of content) {
    if (b.type !== 'text') continue;
    const text = b.text || '';
    const re = /<teammate-message\s+([^>]*)>([\s\S]*?)<\/teammate-message>/gi;
    let match;
    while ((match = re.exec(text)) !== null) {
      const attrs = match[1];
      const body = match[2].trim();
      const idMatch = attrs.match(/teammate_id="([^"]*)"/);
      const colorMatch = attrs.match(/color="([^"]*)"/);
      const summaryMatch = attrs.match(/summary="([^"]*)"/);
      const tmId = idMatch ? idMatch[1] : 'teammate';
      const tmColor = colorMatch ? colorMatch[1] : null;
      // JSON lifecycle signals → compact status bubble
      if (body.startsWith('{')) {
        try {
          const j = JSON.parse(body);
          if (j && j.type) {
            teammateBlocks.push({
              id: tmId, color: tmColor, summary: null,
              content: null, status: j.type, statusFrom: j.from || tmId,
            });
            continue;
          }
        } catch {}
      }
      teammateBlocks.push({
        id: tmId, color: tmColor,
        summary: summaryMatch ? summaryMatch[1] : null,
        content: body, status: null,
      });
    }
  }

  // 裸协议通知（未包 <teammate-message>）：harness 注入的 idle / shutdown_* / teammate_terminated /
  // plan_approval_* 等，提取为 teammate 状态气泡（与包裹形态同渲染）。按 status|from 去重，避免与上面
  // 包裹形态在「同块既有包裹又有裸 JSON」的极端场景下重复出气泡。
  const seenStatus = new Set(teammateBlocks.filter(t => t.status).map(t => `${t.status}|${t.statusFrom}`));
  for (const b of content) {
    if (b.type !== 'text') continue;
    const txt = b.text || '';
    if (!txt.includes('"type"')) continue; // 廉价早退：协议通知必含 JSON 的 "type"
    // 仅对「通知起头」的块出状态气泡（与 isSystemText 的隐藏条件对齐：前缀 lead 或 裸 JSON 起头）。
    // 用户在正文里引用 / 转贴整条通知（caveat 起头、prose 起头）→ 该块仍是 user 气泡，不再额外塞一个
    // 幽灵状态气泡，也不会双重渲染（评审 qa-A / auditor-F1）。
    const head = txt.trimStart();
    if (!head.startsWith('{') && !INTER_SESSION_LEAD_RE.test(head)) continue;
    const note = parseInterSessionNotification(txt);
    if (!note) continue;
    for (const s of note.statuses) {
      const from = s.from || 'teammate';
      const k = `${s.type}|${from}`;
      if (seenStatus.has(k)) continue;
      seenStatus.add(k);
      teammateBlocks.push({ id: from, color: null, summary: null, content: null, status: s.type, statusFrom: from });
    }
  }

  // Extract <task-notification> blocks from user content (early exit if none)
  const taskNotificationBlocks = [];
  const hasTaskNotification = content.some(b => b.type === 'text' && /<task-notification>/i.test(b.text || ''));
  if (hasTaskNotification) {
    for (const b of content) {
      if (b.type !== 'text') continue;
      const text = b.text || '';
      const tnRe = /<task-notification>([\s\S]*?)<\/task-notification>/gi;
      let tnMatch;
      while ((tnMatch = tnRe.exec(text)) !== null) {
        const inner = tnMatch[1];
        const field = (tag) => { const m = inner.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i')); return m ? m[1].trim() : null; };
        const usageBlock = inner.match(/<usage>([\s\S]*?)<\/usage>/i);
        let usage = null;
        if (usageBlock) {
          const uf = (tag) => { const m = usageBlock[1].match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i')); return m ? m[1].trim() : null; };
          usage = { totalTokens: Number(uf('total_tokens') || 0), toolUses: Number(uf('tool_uses') || 0), durationMs: Number(uf('duration_ms') || 0) };
        }
        taskNotificationBlocks.push({
          taskId: field('task-id'),
          status: field('status'),
          summary: field('summary'),
          result: field('result'),
          usage,
        });
      }
    }
  }

  const hasCommand = content.some(b => b.type === 'text' && /<command-message>/i.test(b.text || ''));

  // 提取 slash command 名称
  const commands = [];
  if (hasCommand) {
    for (const b of content) {
      if (b.type !== 'text') continue;
      const m = (b.text || '').match(/<command-name>\s*([^<]*)<\/command-name>/i);
      if (m) {
        const cmd = m[1].trim();
        commands.push(cmd.startsWith('/') ? cmd : `/${cmd}`);
      }
    }
  }

  // 过滤出非系统文本块
  let textBlocks = content.filter(b => b.type === 'text' && !isSystemText(b.text));

  // 二次提取：从被过滤的系统块中提取嵌入的用户文本
  // (e.g., /ultraplan 将 skill 指令和用户输入合并在同一 <system-reminder> 块中)
  // stripSystemTags 后再过一次 isSystemText —— 避免对 [Request interrupted ...] 这种纯标记
  // 文本（无可剥离 XML）误回收成用户气泡
  for (const b of content) {
    if (b.type !== 'text' || !isSystemText(b.text)) continue;
    const userText = stripSystemTags(b.text);
    if (userText && !isSystemText(userText)) {
      textBlocks.push({ ...b, text: userText });
    }
  }

  // 过滤掉 command 相关块
  if (hasCommand) {
    textBlocks = textBlocks.filter(b => !/<command-message>/i.test(b.text || ''));
  }

  // skill 文本（isSkillText）必然先被 isSystemText 的同一正则（"Base directory for this skill:"）
  // 过滤，textBlocks 两条进入路径（初次过滤/二次回收）都要求 !isSystemText，故 skill 块不可能
  // 出现在 textBlocks 中；保留 skillBlocks 键以维持返回 shape（ChatView/ImConversationModal 消费）。
  const skillBlocks = [];

  // 本轮是否为 UltraPlan 输入（原始文本仍含 <system-reminder>[SCOPED INSTRUCTION] marker，
  // 此时尚未被 stripSystemTags 剥离）。消费方（ChatView）据此在用户气泡上方渲染 [UltraPlan] 标签。
  const ultraplan = Array.isArray(content)
    && content.some(b => b && b.type === 'text' && isUltraplanText(b.text));

  return { commands, textBlocks, skillBlocks, teammateBlocks, taskNotificationBlocks, ultraplan };
}

/**
 * 从 teammate 请求的 messages 中提取名字。
 * 扫描 SendMessage 的 tool_result，查找 routing.sender 字段。
 */
export function extractTeammateName(body) {
  const msgs = body?.messages;
  if (!Array.isArray(msgs)) return null;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const content = msgs[i].content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type !== 'tool_result') continue;
      const items = Array.isArray(block.content) ? block.content : [block];
      for (const item of items) {
        const text = item.text || (typeof item.content === 'string' ? item.content : '');
        if (!text || !text.includes('"sender"')) continue;
        try {
          const parsed = JSON.parse(text);
          if (parsed?.routing?.sender) return parsed.routing.sender;
        } catch { /* not JSON, skip */ }
      }
    }
  }
  return null;
}

// ============== Teammate 名称解析（prompt 内容匹配）==============

// 持久化注册表：Agent tool_use prompt 前缀 → teammate name
const _promptRegistry = new Map();
// Requests whose response has been scanned for Agent tool_use blocks. A request
// is only added once its response is present, so a spawn turn that completes
// LATE (it was in-flight and therefore excluded from the filtered array, then
// INSERTED mid-array on completion) still gets scanned — the old positional
// cursor skipped it forever. WeakSet cannot be cleared, so it is recreated on
// session switch.
let _registryScanned = new WeakSet();
// 用首条请求的 timestamp 标识会话，切换时自动 reset
let _registrySessionKey = null;

const PROMPT_PREFIX_LEN = 60;
const TM_TAG_RE = /<teammate-message[^>]*>/;

/**
 * 从 teammate 首条 user message 中提取 <teammate-message> 后的 prompt 内容。
 */
function _extractSpawnPrompt(req) {
  const msgs = req.body?.messages;
  if (!Array.isArray(msgs) || msgs.length === 0) return '';
  const first = msgs[0];
  const content = first.content;
  if (typeof content === 'string') {
    const m = TM_TAG_RE.exec(content);
    if (!m) return '';
    return content.slice(m.index + m[0].length).trimStart();
  }
  if (Array.isArray(content)) {
    for (const b of content) {
      if (b.type !== 'text' || !b.text) continue;
      const m = TM_TAG_RE.exec(b.text);
      if (!m) continue;
      return b.text.slice(m.index + m[0].length).trimStart();
    }
  }
  return '';
}

/**
 * v2.1.90+ Agent 模式：native teammate 的首条 user message 是 raw prompt（无 <teammate-message> 包装）。
 * 直接提取首条 user message 文本内容用于 prompt prefix 匹配。
 */
function _extractRawPrompt(req) {
  const msgs = req.body?.messages;
  if (!Array.isArray(msgs) || msgs.length === 0) return '';
  const first = msgs[0];
  const content = first.content;
  if (typeof content === 'string') return content.trimStart();
  if (Array.isArray(content)) {
    for (const b of content) {
      if (b.type === 'text' && b.text) return b.text.trimStart();
    }
  }
  return '';
}

/**
 * 预扫描 requests，通过匹配 MainAgent 的 Agent tool_use prompt
 * 与 native teammate 的首条消息内容，注入 req.teammate 名字。
 *
 * 必须在 classifyRequest 之前调用（classifyRequest 结果有 WeakMap 缓存）。
 * 版本兼容：已有 req.teammate（interceptor 模式）的请求不受影响。
 */
export function resolveTeammateNames(requests) {
  if (!Array.isArray(requests) || requests.length === 0) return;

  // 通过首条请求的 timestamp 检测会话切换，自动 reset
  const sessionKey = requests[0]?.timestamp || null;
  if (sessionKey !== _registrySessionKey) {
    _promptRegistry.clear();
    _registryScanned = new WeakSet();
    _registrySessionKey = sessionKey;
  }
  // Step 1: scan MainAgent responses for Agent tool_use blocks, building the
  // prompt-prefix → name map. Full walk with O(1) WeakSet skips; a request is
  // marked scanned ONLY when its response exists, so it is re-visited (cheap,
  // two property reads) until the response arrives, then scanned exactly once.
  // Map.set overwrites, so a re-scan is idempotent anyway.
  for (const req of requests) {
    if (_registryScanned.has(req)) continue;
    if (!req.mainAgent) { _registryScanned.add(req); continue; }
    const content = req.response?.body?.content;
    if (!req.response) continue;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type !== 'tool_use' || block.name !== 'Agent') continue;
        const inp = block.input;
        if (!inp || !inp.name || !inp.prompt) continue;
        const prefix = inp.prompt.trimStart().slice(0, PROMPT_PREFIX_LEN);
        if (prefix) _promptRegistry.set(prefix, inp.name);
      }
    }
    _registryScanned.add(req);
  }

  if (_promptRegistry.size === 0) return;

  // Step 2: 为缺少名字的 native/proxy teammate 注入 req.teammate
  for (const req of requests) {
    if (req.teammate) continue;
    if (!isNativeTeammate(req) && !TEAMMATE_SYSTEM_RE.test(getSystemText(req.body || {}))) continue;

    let prompt = _extractSpawnPrompt(req);
    // v2.1.90+ Agent 模式 fallback：无 <teammate-message> 时尝试 raw prompt
    if (!prompt && isNativeTeammate(req)) prompt = _extractRawPrompt(req);
    if (!prompt) continue;
    const prefix = prompt.slice(0, PROMPT_PREFIX_LEN);

    // 精确前缀匹配
    const name = _promptRegistry.get(prefix);
    if (name) {
      req.teammate = name;
      // 清除可能已缓存的 classifyRequest 结果（subType 为 null 的旧缓存）
      if (req._cachedTeammateName === null) req._cachedTeammateName = name;
    }
  }
}
