import { getSlashCommandLabel } from './slashCommandLabels.js';

// buildPromptNavItems：从「当前可见项」与权威的 mainAgentSessions 计算用户 Prompt 导航的数据项。
// 纯函数（无 React/DOM），渲染留在 ChatView——便于单测覆盖会话边界标记、去重与无 ts 容错。
//
// Besides plain user prompts (role==='user', kind:'prompt'), it also scans each assistant
// bubble's content blocks and surfaces ExitPlanMode (kind:'plan') and AskUserQuestion
// (kind:'ask') cards, interleaved in document (= chronological) order. Both are full-display
// tools, so their bubble is never folded by mergeToolRuns in minimal-chat and always keeps a
// stable top-level visibleIdx that can be scrolled to directly. A user prompt ChatView flagged
// with props.isUltraplan is tagged kind:'ultraplan' so the nav can badge it like the Plan/Ask cards.
//
// @param {Array<{props?:{role?:string,text?:string,content?:Array,timestamp?:string|null}}>} visible 当前渲染项
// @param {Array<{messages?:Array<{_timestamp?:string}>}>} mainAgentSessions 权威会话数组
// @returns {Array<{display:string, visibleIdx:number, timestamp:string|null, sessionIdx:number|null, newSession?:boolean, kind:'prompt'|'plan'|'ask'|'ultraplan'}>}

// Interactive card tools the nav locates (EnterPlanMode is only a mode-entry marker with no
// content, so it is not collected).
const NAV_TOOL_KIND = { ExitPlanMode: 'plan', AskUserQuestion: 'ask' };

// Truncate display text: same 80-char + ellipsis rule as plain prompts.
function truncateDisplay(text) {
  return text.length > 80 ? text.substring(0, 80) + '...' : text;
}

// Resolve the session index for an item via its carrier timestamp (shared by the user and
// assistant branches).
function sessionIdxOf(props, tsToSession) {
  return (props.timestamp != null && tsToSession.has(props.timestamp))
    ? tsToSession.get(props.timestamp) : null;
}

// Extract the nav title for an ExitPlanMode card: the first markdown heading / first non-empty
// line of input.plan. Returns '' when absent — the renderer falls back to a localized label.
function planDisplayOf(input) {
  if (!input || typeof input.plan !== 'string') return '';
  const lines = input.plan.split('\n');
  for (const line of lines) {
    const t = line.replace(/^#+\s*/, '').trim();
    if (t) return truncateDisplay(t);
  }
  return '';
}

// Extract the nav title for an AskUserQuestion card: the first non-empty question text (during
// streaming questions can still be a hollow shell, in which case '' is returned and the
// renderer falls back to a localized label).
function askDisplayOf(input) {
  const qs = input && Array.isArray(input.questions) ? input.questions : [];
  for (const q of qs) {
    const t = q && typeof q.question === 'string' ? q.question.trim() : '';
    if (t) return truncateDisplay(t);
  }
  return '';
}

export function buildPromptNavItems(visible, mainAgentSessions) {
  if (!Array.isArray(visible) || visible.length === 0) return [];

  // 会话分界：用权威的 mainAgentSessions 把每条 prompt 的 _timestamp 映射到所属 session 序号。
  // 不依赖主视图的 <Divider>（其在角色过滤时会被滤掉），保证导航里始终能标出会话边界。
  const sessions = mainAgentSessions || [];
  const tsToSession = new Map();
  for (let si = 0; si < sessions.length; si++) {
    const msgs = sessions[si] && sessions[si].messages;
    if (!Array.isArray(msgs)) continue;
    for (const m of msgs) {
      const ts = m && m._timestamp;
      if (ts != null && !tsToSession.has(ts)) tsToSession.set(ts, si);
    }
  }

  const prompts = [];
  const seen = new Set();
  for (let i = 0; i < visible.length; i++) {
    const props = visible[i] && visible[i].props;
    if (!props) continue;

    // Assistant bubble: scan content for ExitPlanMode / AskUserQuestion card blocks. Each block
    // yields one nav entry (visibleIdx points at the owning bubble, so scrolling lands on it).
    // No dedup here — one entry per block; the render key disambiguates same-bubble duplicates.
    if (props.role === 'assistant') {
      const content = Array.isArray(props.content) ? props.content : null;
      if (!content) continue;
      const sessionIdx = sessionIdxOf(props, tsToSession);
      for (const block of content) {
        if (!block || block.type !== 'tool_use') continue;
        const kind = NAV_TOOL_KIND[block.name];
        if (!kind) continue;
        const display = kind === 'plan' ? planDisplayOf(block.input) : askDisplayOf(block.input);
        prompts.push({ display, visibleIdx: i, timestamp: props.timestamp || null, sessionIdx, kind });
      }
      continue;
    }

    if (props.role !== 'user') continue;
    const raw = props.text || '';
    if (!raw) continue;
    // 清理图片标记，只保留文字部分用于导航列表显示
    const cleaned = raw
      .replace(/\[Image(?:\s*#\d+)?(?::?\s*source)?:\s*[^\]]+\]/gi, '')
      .replace(/"\/tmp\/cc-viewer-uploads\/[^"]+"/g, '')
      .trim();
    if (!cleaned) continue;
    // UltraPlan prompt: ChatView already computed isUltraplan and attached it to the element at
    // render time (the text itself has been stripped of the system-reminder template, so a
    // text-based isUltraplanText check would not match here) — read the prop directly. props.text
    // is the clean task blurb, used as-is for the nav title.
    const isUltra = props.isUltraplan === true;
    // 内置 slash 命令(/theme /clear …)在 nav 列表里也显示本地化标签，与主气泡保持一致；
    // 未命中白名单的命令/普通文本走原文。
    const text = getSlashCommandLabel(cleaned) || cleaned;
    const key = text.substring(0, 100);
    if (seen.has(key)) continue;
    seen.add(key);
    const display = truncateDisplay(text);
    // 使用 visible 索引作为定位标识（兼容无 timestamp 的遗留消息）
    const sessionIdx = sessionIdxOf(props, tsToSession);
    prompts.push({ display, visibleIdx: i, timestamp: props.timestamp || null, sessionIdx, kind: isUltra ? 'ultraplan' : 'prompt' });
  }

  // 标记跨 session 的 prompt（其前插入会话分隔线）。session 未知（无 ts）的 prompt 不打断链路。
  let lastSessionIdx = null;
  for (const p of prompts) {
    if (p.sessionIdx == null) continue;
    if (lastSessionIdx != null && p.sessionIdx !== lastSessionIdx) p.newSession = true;
    lastSessionIdx = p.sessionIdx;
  }

  return prompts;
}
