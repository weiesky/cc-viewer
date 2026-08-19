/**
 * Portal 决策：判断 inline AskQuestionForm（在 ChatMessage 里渲染的某条 tool_use）
 * 是否应该 createPortal 到 ApprovalModal 的 askSlot。
 *
 * activeAskId 三种合法形态（与 server 端协议绑定，改一边必须改另一边）：
 *
 *   1. `toolu_xxx` — SDK 模式 / 新版 Claude Code 透传的真实 tool_use_id
 *      → 走 strict 匹配：activeAskId === toolId
 *
 *   2. `__ask__` — LEGACY 老 server（pre-Map 协议）的单槽占位
 *      → 走 owner 通配：仅 owner-idx 锁定的那条 ChatMessage（lastPendingAskId === toolId）命中
 *
 *   3. `ask_${ts}_${rnd}` — 老 Claude Code PreToolUse hook payload 不带 tool_use_id 时
 *      server.js 自生成的 fallback id（修复 modal 标题在但内容空白的根因）
 *      → 走 owner 通配：与 __ask__ 同语义
 *
 * 协议锚点：
 *   - server 端 fallback id 生成：server.js（搜索 `ask_${Date.now()}` 定位）
 *   - server 端 LEGACY 占位推送：server.js 推送 ask-hook-pending 事件时 id 为 '__ask__'
 *   - 前端 setState pendingAsk：src/components/chat/ChatView.jsx
 *
 * 改 server 端 fallback id 格式时，必须同步更新此文件的 isFallbackId 检测。
 */

const FALLBACK_ID_PREFIX = 'ask_';
const LEGACY_PLACEHOLDER_ID = '__ask__';

/**
 * True when the given pending-ask id is a placeholder that can never equal a real
 * tool_use id: the LEGACY single-slot '__ask__' or a server-generated 'ask_<ts>_<rnd>'
 * fallback id. Consumers (e.g. resolveAskQuestions) use this to apply the same
 * owner-wildcard semantics as shouldPortalAskForm on the legacy paths.
 */
export function isPlaceholderAskId(id) {
  return id === LEGACY_PLACEHOLDER_ID
    || (typeof id === 'string' && id.startsWith(FALLBACK_ID_PREFIX));
}

/**
 * @param {*} activeAskId   ApprovalPortalContext.Consumer 提供的 activeAskId（modal 当前 active ask 的 id）
 * @param {*} toolId        当前 ChatMessage 里 tool_use 块的 id（toolu_xxx）
 * @param {*} lastPendingAskId  ChatMessage 收到的 owner-idx 派生信号；非 owner 永远为 null
 * @returns {boolean} true 表示当前 ChatMessage 应该 portal 到 askSlot
 */
export function shouldPortalAskForm(activeAskId, toolId, lastPendingAskId) {
  if (activeAskId == null) return false;
  // strict：SDK / 新 Claude Code 真实 tool_use_id
  if (String(activeAskId) === String(toolId)) return true;
  // owner 通配：__ask__（LEGACY 老 server）∪ ask_*（server fallback）
  // 必须同时满足 owner-idx 锁定（lastPendingAskId === toolId），否则会让历史所有真实 toolId
  // 都被通配命中，重现旧的双份 portal bug
  if (isPlaceholderAskId(activeAskId) && lastPendingAskId === toolId) return true;
  return false;
}
