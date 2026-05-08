import { isPostClearCheckpoint } from './clearCheckpoint.js';

/**
 * 计算消息的轻量内容指纹，用于「反向锚点」对齐：以 `newMessages[0]` 的 fp 为锚，
 * 从 `curMsgs` 末尾向头部反向扫，配合多块连续等价校验决定 append / no-op / rebuild。
 *
 * 关键点：
 *  - tool_use / tool_result 用 API 强保证唯一的 id 作主键，永不碰撞。
 *  - text / thinking 用 `length + first32 + last32` 三元组——比单纯 `slice(0, 64)`
 *    抗碰撞强得多（同前缀 `<system-reminder>...` / `<command-name>/...` 不会再误命中），
 *    但仍只触一次字符串切片，比哈希便宜。
 *  - 保持纯函数 / 同步 / 无副作用——`mergeMainAgentSessions` 在流式热路径每条 SSE 都会调用。
 */
function messageFingerprint(msg) {
  if (!msg || !msg.role) return '';
  const c = msg.content;
  if (typeof c === 'string') return `${msg.role}|s|${c.length}|${c.slice(0, 32)}|${c.slice(-32)}`;
  if (!Array.isArray(c) || c.length === 0) return `${msg.role}|empty`;
  const b = c[0];
  if (b.type === 'tool_use') return `${msg.role}|tu|${b.id || b.name || ''}`;
  if (b.type === 'tool_result') return `${msg.role}|tr|${b.tool_use_id || ''}`;
  if (b.type === 'text') {
    const t = b.text || '';
    return `${msg.role}|t|${t.length}|${t.slice(0, 32)}|${t.slice(-32)}`;
  }
  if (b.type === 'thinking') {
    const t = b.thinking || '';
    return `${msg.role}|th|${t.length}|${t.slice(0, 32)}|${t.slice(-32)}`;
  }
  return `${msg.role}|${b.type || 'unknown'}`;
}

/**
 * 反向锚点搜索：在 `curMsgs` 中从末尾向头部找一个位置 p，使得
 * `newMessages[0..L]` 的 fp 与 `curMsgs[p..p+L]` 的 fp **逐条**等价，
 * 其中 L = min(newLen, curLen - p)。返回最右（即最贴近末尾）的命中。
 *
 * 设计选择：
 *  - 反向扫起点为 `curLen - 1`，因为流式 / Plan Mode 窗口的真锚点几乎都贴近末尾，
 *    反向首个 fp0 命中即真锚点的概率最高，避免命中靠前的 fp 碰撞误锚点。
 *  - 多块连续等价校验：fp 加固后单条碰撞已罕见，多块连续碰撞概率近 0。
 *  - 复杂度：单候选 O(L)，最坏 O(curLen·newLen)，典型 K<200，比旧 O(K²) 正向 prefix-overlap
 *    平均更快、最坏同阶。
 *
 * @returns {{anchorIdx: number, overlapLen: number} | null}
 */
function findReverseAnchor(newMsgs, curMsgs) {
  const newLen = newMsgs.length;
  const curLen = curMsgs ? curMsgs.length : 0;
  if (newLen === 0 || curLen === 0) return null;
  const fp0 = messageFingerprint(newMsgs[0]);
  if (!fp0 || fp0.endsWith('|empty')) return null; // 空内容 fp 不可信，不当锚点
  for (let p = curLen - 1; p >= 0; p--) {
    if (messageFingerprint(curMsgs[p]) !== fp0) continue;
    const overlapLen = Math.min(newLen, curLen - p);
    let ok = true;
    for (let i = 1; i < overlapLen; i++) {
      if (messageFingerprint(newMsgs[i]) !== messageFingerprint(curMsgs[p + i])) {
        ok = false; break;
      }
    }
    if (ok) return { anchorIdx: p, overlapLen };
    // 验证失败（fp 加固后罕见）→ 继续向左找下一候选
  }
  return null;
}

/**
 * 增量合并 mainAgent sessions。
 *
 * 核心算法：反向锚点对齐。以 `newMessages[0]` 为锚点，从 `lastSession.messages` 末尾
 * 反向扫；命中后多块连续 fp 等价校验。三种结果：
 *  - 命中且 overlapLen === newLen：流式 no-op / suffix subset，messages 引用稳定（保 WeakMap 缓存）。
 *  - 命中且 overlapLen <  newLen：push `newMessages[overlapLen..]`，引用稳定。
 *  - 未命中：newLen<curLen → rebuild（/compact summary）；否则整段 append（Plan Mode 全新片段）。
 *
 * 顶部守卫（isPostClearCheckpoint / userId / transient filter）维持 1.6.245 行为不变。
 *
 * @param {Array} prevSessions
 * @param {object} entry
 * @param {object} [options]
 * @param {boolean} [options.skipTransientFilter=false] - SSE 实时追加路径设为 true。
 * @returns {Array}
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

  // /clear 后的首个 checkpoint：始终是新会话起点。
  // 同 device 下 sameUser 永远 true，否则会被下面的 same-session 分支吞掉；
  // 也不能被 transient 过滤掉（即便 newMessages.length === 1）。
  if (isPostClearCheckpoint(entry, prevMsgCount)) {
    for (let i = 0; i < newMessages.length; i++) {
      if (!newMessages[i]._timestamp) newMessages[i]._timestamp = entryTimestamp;
    }
    return [...prevSessions, { userId, messages: newMessages, response: newResponse, entryTimestamp }];
  }

  if (!options.skipTransientFilter && isNewConversation && newMessages.length <= 4 && prevMsgCount > 4) {
    return prevSessions;
  }

  if (sameUser || (userId === lastSession.userId && !isNewConversation)) {
    const curLen = prevMsgCount;
    const newLen = newMessages.length;
    if (!lastSession.messages) lastSession.messages = [];

    const anchor = findReverseAnchor(newMessages, lastSession.messages);

    if (anchor) {
      const tailStart = anchor.overlapLen;
      // tailStart === newLen：流式 no-op / suffix subset，messages 引用不动。
      if (tailStart < newLen) {
        for (let i = tailStart; i < newLen; i++) {
          if (!newMessages[i]._timestamp) newMessages[i]._timestamp = entryTimestamp;
          lastSession.messages.push(newMessages[i]);
        }
      }
    } else if (newLen < curLen) {
      // /compact summary 等真重建：替换 messages 引用。
      for (let i = 0; i < newLen; i++) {
        if (!newMessages[i]._timestamp) newMessages[i]._timestamp = entryTimestamp;
      }
      lastSession.messages = newMessages;
    } else if (newLen === curLen) {
      // 等长且 anchor 未命中：Plan Mode 2-msg 全替换窗口，整段 append。
      for (let i = 0; i < newLen; i++) {
        if (!newMessages[i]._timestamp) newMessages[i]._timestamp = entryTimestamp;
        lastSession.messages.push(newMessages[i]);
      }
    } else {
      // newLen > curLen 且 anchor 未命中：保守回退至 1.6.244 之前的"严格前缀扩展"语义——
      // 只 push newMessages[curLen..]。fp 加固后真正存在重叠的窗口必被 anchor 命中走上面分支；
      // 这里 anchor 未命中意味着确实无重叠（罕见，仅艺测/再快照场景），保留旧推 tail 行为防回归。
      for (let i = curLen; i < newLen; i++) {
        if (!newMessages[i]._timestamp) newMessages[i]._timestamp = entryTimestamp;
        lastSession.messages.push(newMessages[i]);
      }
    }

    lastSession.response = newResponse;
    lastSession.entryTimestamp = entryTimestamp;
    return [...prevSessions];
  } else {
    return [...prevSessions, { userId, messages: newMessages, response: newResponse, entryTimestamp }];
  }
}
