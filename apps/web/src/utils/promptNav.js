import { getSlashCommandLabel } from './slashCommandLabels.js';

// buildPromptNavItems：从「当前可见项」与权威的 mainAgentSessions 计算用户 Prompt 导航的数据项。
// 纯函数（无 React/DOM），渲染留在 ChatView——便于单测覆盖会话边界标记、去重与无 ts 容错。
//
// @param {Array<{props?:{role?:string,text?:string,timestamp?:string|null}}>} visible 当前渲染项
// @param {Array<{messages?:Array<{_timestamp?:string}>}>} mainAgentSessions 权威会话数组
// @returns {Array<{display:string, visibleIdx:number, timestamp:string|null, sessionIdx:number|null, newSession?:boolean}>}
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
    if (!props || props.role !== 'user') continue;
    const raw = props.text || '';
    if (!raw) continue;
    // 清理图片标记，只保留文字部分用于导航列表显示
    const cleaned = raw
      .replace(/\[Image(?:\s*#\d+)?(?::?\s*source)?:\s*[^\]]+\]/gi, '')
      .replace(/"\/tmp\/cc-viewer-uploads\/[^"]+"/g, '')
      .trim();
    if (!cleaned) continue;
    // 内置 slash 命令(/theme /clear …)在 nav 列表里也显示本地化标签，与主气泡保持一致；
    // 未命中白名单的命令/普通文本走原文。
    const text = getSlashCommandLabel(cleaned) || cleaned;
    const key = text.substring(0, 100);
    if (seen.has(key)) continue;
    seen.add(key);
    const display = text.length > 80 ? text.substring(0, 80) + '...' : text;
    // 使用 visible 索引作为定位标识（兼容无 timestamp 的遗留消息）
    const sessionIdx = (props.timestamp != null && tsToSession.has(props.timestamp))
      ? tsToSession.get(props.timestamp) : null;
    prompts.push({ display, visibleIdx: i, timestamp: props.timestamp || null, sessionIdx });
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
