/**
 * Entry Slim — 流式接收剪枝模块
 *
 * 老格式日志每条 MainAgent entry 包含累积的完整 messages，
 * 480MB 文件 JSON.parse 后在浏览器中膨胀到 ~1.2GB → OOM。
 *
 * 核心机制：同 session 内只保留最新一条 MainAgent 的完整 messages，
 * 前一条立即释放。被剪枝的 entry 记录 _fullEntryIndex 供按需还原。
 *
 * 导出：
 * - createEntrySlimmer(isMainAgentFn): 批量剪枝器（历史日志加载，process + finalize）
 * - createIncrementalSlimmer(isMainAgentFn): 增量剪枝器（实时 SSE，无需 finalize）
 * - restoreSlimmedEntry(entry, requests): 按需还原被剪枝的 entry
 */

/**
 * 创建流式剪枝器。
 *
 * 在 load_chunk 中对每条 entry 调用 process()，
 * 在 load_end 中调用 finalize() 设置 _fullEntryIndex。
 *
 * @param {Function} isMainAgentFn - (entry) => boolean
 * @returns {{ process, finalize }}
 */
export function createEntrySlimmer(isMainAgentFn) {
  let prevMainIdx = -1;
  let prevMsgCount = 0;
  let prevUserId = null;

  return {
    /**
     * 处理一条新 entry。
     * 副作用：可能剪枝 entries[prevMainIdx] 的 messages。
     *
     * @param {object} entry - 新接收的 entry
     * @param {Array} entries - 已累积的 entries 数组
     * @param {number} currentIdx - 当前 entry 将存入的索引
     * @returns {object} entry（原样返回）
     */
    process(entry, entries, currentIdx) {
      if (!isMainAgentFn(entry)) return entry;
      if (!entry.body || !Array.isArray(entry.body.messages) || entry.body.messages.length === 0) return entry;

      const count = entry.body.messages.length;
      const userId = entry.body.metadata?.user_id || null;

      // session 边界检测（同 mergeMainAgentSessions）
      const isNewSession = prevMsgCount > 0 && (
        (count < prevMsgCount * 0.5 && (prevMsgCount - count) > 4) ||
        (prevUserId && userId && userId !== prevUserId)
      );

      // 瞬态请求过滤（阈值与 App.jsx _flushPendingEntries 保持一致：>4）
      if (isNewSession && count <= 4 && prevMsgCount > 4) {
        return entry;
      }

      if (isNewSession) {
        prevMainIdx = currentIdx;
        prevMsgCount = count;
        prevUserId = userId;
        return entry;
      }

      // 同 session：剪枝前一条 MainAgent 的 messages
      if (prevMainIdx >= 0 && prevMainIdx < entries.length) {
        const prev = entries[prevMainIdx];
        if (prev.body?.messages?.length > 0) {
          const pCount = prev.body.messages.length;
          const startIdx = prev._prevMsgCount || 0;
          const idxArr = [];
          for (let j = startIdx; j < pCount; j++) idxArr.push(j);

          prev._messageCount = pCount;
          prev._messagesIndex = idxArr;
          prev._slimmed = true;
          prev.body.messages = [];
        }
      }

      entry._prevMsgCount = prevMsgCount;
      prevMainIdx = currentIdx;
      prevMsgCount = count;
      prevUserId = userId;
      return entry;
    },

    /**
     * 流结束后调用：为所有被剪枝的 entry 设置 _fullEntryIndex。
     * @param {Array} entries
     */
    finalize(entries) {
      // 正向扫描每个 session，找到最后一条有完整 messages 的 MainAgent
      let sessionSlimmed = []; // 当前 session 内被剪枝的 entry 索引
      let currentFullIdx = -1;
      let pCount = 0;
      let pUserId = null;

      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const isSlimmed = e._slimmed;
        const hasMsgs = e.body?.messages?.length > 0;

        // 跳过非 MainAgent
        if (!isSlimmed && !hasMsgs) continue;
        if (!isSlimmed && !isMainAgentFn(e)) continue;

        const count = e._messageCount || e.body?.messages?.length || 0;
        const userId = e.body?.metadata?.user_id || null;

        const isNew = pCount > 0 && (
          (count < pCount * 0.5 && (pCount - count) > 4) ||
          (pUserId && userId && userId !== pUserId)
        );
        if (isNew && count <= 4 && pCount > 10) continue;

        if (isNew) {
          // 上一个 session 结束：回填 _fullEntryIndex
          for (const idx of sessionSlimmed) {
            entries[idx]._fullEntryIndex = currentFullIdx;
          }
          sessionSlimmed = [];
          currentFullIdx = -1;
          pCount = 0;
        }

        if (isSlimmed) {
          sessionSlimmed.push(i);
        }
        if (hasMsgs || !isSlimmed) {
          currentFullIdx = i;
        }
        pCount = count;
        pUserId = userId;
      }

      // 最后一个 session
      for (const idx of sessionSlimmed) {
        entries[idx]._fullEntryIndex = currentFullIdx;
      }
    }
  };
}

/**
 * 按需还原被剪枝的 entry 的 messages（不修改原始 entry）。
 *
 * @param {object} entry - 被剪枝的 entry（_slimmed === true）
 * @param {Array} requests - state.requests 数组
 * @returns {object} 还原后的 entry（新对象）或原样返回
 */
export function restoreSlimmedEntry(entry, requests) {
  if (!entry._slimmed || entry._fullEntryIndex == null) return entry;
  const fullEntry = requests[entry._fullEntryIndex];
  if (!fullEntry?.body?.messages) return entry;
  if (fullEntry.body.messages.length < entry._messageCount) return entry;
  return {
    ...entry,
    _slimmed: false,
    _fullEntryIndex: undefined,
    body: {
      ...entry.body,
      messages: fullEntry.body.messages.slice(0, entry._messageCount),
      system: fullEntry.body.system,
    }
  };
}

/**
 * 创建增量剪枝器（实时 SSE 链路）。
 *
 * 与批量剪枝器的区别：无需 finalize，每条 MainAgent entry 到达时
 * 立即 slim 上一条并设置 _fullEntryIndex 指向当前 entry。
 *
 * 在 _flushPendingEntries 的 new entry 路径（requests.push）中调用 processEntry；
 * 在 dedup 路径（requests[existingIndex] = entry）中调用 onDedup。
 *
 * @param {Function} isMainAgentFn - (entry) => boolean
 * @returns {{ processEntry, onDedup }}
 */
export function createIncrementalSlimmer(isMainAgentFn) {
  let prevMainIdx = -1;
  let prevMsgCount = 0;
  let prevUserId = null;
  const sessionSlimmedIndices = new Set();

  return {
    /**
     * 处理一条新 entry（仅在 new entry 路径调用，dedup 路径不调用）。
     * 副作用：可能剪枝 requests[prevMainIdx] 的 messages，并更新所有已剪枝 entry 的 _fullEntryIndex。
     *
     * @param {object} entry - 新到达的 entry
     * @param {Array} requests - state.requests 数组（slim 前的快照）
     * @param {number} currentIdx - entry 将存入的索引（= requests.length）
     * @returns {object} entry（原样返回）
     */
    processEntry(entry, requests, currentIdx) {
      if (!isMainAgentFn(entry)) return entry;
      if (!entry.body?.messages?.length) return entry;

      const count = entry.body.messages.length;
      const userId = entry.body.metadata?.user_id || null;

      // session 边界检测（与 batch slimmer / mergeMainAgentSessions 一致）
      const isNewSession = prevMsgCount > 0 && (
        (count < prevMsgCount * 0.5 && (prevMsgCount - count) > 4) ||
        (prevUserId && userId && userId !== prevUserId)
      );

      // 瞬态请求过滤（阈值与 App.jsx _flushPendingEntries 保持一致：>4）
      if (isNewSession && count <= 4 && prevMsgCount > 4) {
        return entry;
      }

      if (isNewSession) {
        sessionSlimmedIndices.clear();
        prevMainIdx = currentIdx;
        prevMsgCount = count;
        prevUserId = userId;
        return entry;
      }

      // 前向 slim：剪枝上一条 MainAgent
      // 注意：必须 clone entry 再修改，不能 in-place mutate。
      // requests 数组是 [...prev.requests] 浅拷贝，元素仍与 React 上一次 state 共享引用，
      // 直接 mutate 会导致 React 渲染中途看到 messages=[] 的中间态，引起对话闪烁。
      if (prevMainIdx >= 0 && prevMainIdx < requests.length) {
        const orig = requests[prevMainIdx];
        if (orig.body?.messages?.length > 0) {
          const cloned = { ...orig, body: { ...orig.body }, _messageCount: orig.body.messages.length, _slimmed: true, _fullEntryIndex: currentIdx };
          cloned.body.messages = [];
          requests[prevMainIdx] = cloned;
          sessionSlimmedIndices.add(prevMainIdx);
        }
      }

      // 全量回填：更新本 session 内所有已剪枝 entries 的 _fullEntryIndex
      // 同样需要 clone，避免 mutate React state 中的共享引用
      for (const idx of sessionSlimmedIndices) {
        if (requests[idx]._fullEntryIndex !== currentIdx) {
          requests[idx] = { ...requests[idx], _fullEntryIndex: currentIdx };
        }
      }

      entry._prevMsgCount = prevMsgCount;
      prevMainIdx = currentIdx;
      prevMsgCount = count;
      prevUserId = userId;
      return entry;
    },

    /**
     * dedup 替换时调用：从 sessionSlimmedIndices 移除被替换的索引，
     * 防止全量回填时污染非 slimmed entry。
     *
     * @param {number} existingIndex - 被 dedup 替换的索引
     */
    onDedup(existingIndex) {
      sessionSlimmedIndices.delete(existingIndex);
    },
  };
}
