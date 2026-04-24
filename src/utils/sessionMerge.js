/**
 * 增量合并 mainAgent sessions。
 * - 同 session 更新：push 新消息（保持 messages 引用稳定）或 checkpoint 重建
 * - 新 session：追加新 session 对象
 * - Transient 过滤：极短消息跳过合并（仅批量加载场景）
 *
 * @param {Array} prevSessions - 当前 sessions 数组
 * @param {object} entry - 新的 mainAgent entry
 * @param {object} [options]
 * @param {boolean} [options.skipTransientFilter=false] - SSE 实时追加路径设为 true：
 *   实时流里每条 entry 都带完整 response，不会是"中间态"，transient 过滤会误伤真实的
 *   `/clear → hi` 短对话。仅在批量加载历史日志时保留该过滤（防中间态 entry 污染）。
 * @returns {Array} 更新后的 sessions 数组
 */
export function mergeMainAgentSessions(prevSessions, entry, options = {}) {
  const newMessages = entry.body.messages;
  const newResponse = entry.response;
  const userId = entry.body.metadata?.user_id || null;

  const entryTimestamp = entry.timestamp || null;

  if (prevSessions.length === 0) {
    return [{ userId, messages: newMessages, response: newResponse, entryTimestamp }];
  }

  const lastSession = prevSessions[prevSessions.length - 1];

  const prevMsgCount = lastSession.messages ? lastSession.messages.length : 0;
  const isNewConversation = prevMsgCount > 0 && newMessages.length < prevMsgCount * 0.5 && (prevMsgCount - newMessages.length) > 4;
  const sameUser = userId !== null && userId === lastSession.userId;

  if (!options.skipTransientFilter && isNewConversation && newMessages.length <= 4 && prevMsgCount > 4) {
    return prevSessions;
  }

  if (sameUser || (userId === lastSession.userId && !isNewConversation)) {
    const currentLen = prevMsgCount;
    const newLen = newMessages.length;

    if (newLen > currentLen) {
      // 增量追加：只 push 新增的消息，保持 messages 引用稳定（WeakMap 缓存命中）
      if (!lastSession.messages) lastSession.messages = [];
      for (let i = currentLen; i < newLen; i++) {
        if (!newMessages[i]._timestamp) newMessages[i]._timestamp = entryTimestamp;
        lastSession.messages.push(newMessages[i]);
      }
    } else if (newLen < currentLen) {
      // Checkpoint（/clear, /compact）：重建引用
      for (let i = 0; i < newMessages.length; i++) {
        if (!newMessages[i]._timestamp) newMessages[i]._timestamp = entryTimestamp;
      }
      lastSession.messages = newMessages;
    }
    // newLen === currentLen 时不动 messages（可能是 response 更新）

    lastSession.response = newResponse;
    lastSession.entryTimestamp = entryTimestamp;
    return [...prevSessions];
  } else {
    return [...prevSessions, { userId, messages: newMessages, response: newResponse, entryTimestamp }];
  }
}
