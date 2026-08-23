// Wire format 协议详见 docs/WIRE_FORMAT.md（服务端 entry 形态 / 关键字段 / 已知特殊窗口）
// messageFingerprint / findReverseAnchor moved VERBATIM to the shared client-safe
// module @ccv/core/session-boundary (wire-v2 S1) — re-exported below so the
// existing test/consumer API of this module is unchanged.
import { isPostClearCheckpoint, messageFingerprint, findReverseAnchor } from '@ccv/core/session-boundary';
import { getEffectiveModel } from './effectiveModel.js';

export { messageFingerprint };

/**
 * merge 入口守卫（KEEP IN SYNC: @ccv/core/delta-reconstructor 标记写入点）：
 * 重建层标记的脏条目不得进入 mainAgentSessions 合并——
 *  - `_staleReorder`：完成序倒置的乱序条目（内容已被更新条目取代）；
 *  - `_reconstructBroken`：重建结果与 _totalMessageCount 不符且无法修复（拼接会翻倍/错位）；
 *  - 批量路径额外跳过 `inProgress`：孤立占位条目的 body.messages 是裸 delta 切片
 *    （批量 reconstructEntries 不为 inProgress 重建全量），merge 会触发 rebuild 截断。
 *    SSE 实时路径不拦 inProgress——watcher 增量重建器已为其拼出全量 messages，
 *    无 live-port 配置下"提问气泡请求时即显示"依赖这一行为。
 * AppBase 的 SSE 与批量两个 merge 入口、以及单测共用此谓词，防三处逻辑漂移。
 *
 * 批量路径的降级例外见 shouldDegradeBrokenMerge：当 broken 条目恰好是它那个
 * session 的唯一载体（slim 只留最后一条 main）时，其 messages 是可信前缀，
 * 降级合并比整会话空白更可取（会话打 _partialData 标记，ChatView 显示提示条）。
 *
 * @param {object} entry
 * @param {object} [options]
 * @param {boolean} [options.batch=false] - 批量（强刷/历史加载）路径
 * @returns {boolean} true = 该条目不应参与 session 合并
 */
export function isMergeBlockedEntry(entry, options = {}) {
  if (!entry) return true;
  if (entry._staleReorder || entry._reconstructBroken) return true;
  if (options.batch && entry.inProgress) return true;
  return false;
}

/**
 * 批量路径降级例外：broken 载体能否以"可信前缀"身份合并进 mainAgentSessions。
 *
 * 仅在两条安全路径放行（两条都只会走进 mergeMainAgentSessions 的创建分支，
 * 不会触发 anchor/rebuild 等可能翻倍的对齐逻辑）：
 *  - prevSessions 为空：会话直接创建，无对齐风险；
 *  - 双方都有 _seqEpoch 且不同：确定性会话边界，走 epochChanged append 分支
 *    （三部分守卫防 v1 无 epoch 的条目被误放行）。
 *
 * `_staleReorder` 明确不降级（流内稍后有权威副本自建会话）；inProgress 不降级
 * （批量下其 messages 是裸切片，不是可信前缀）。v1 / 无 epoch 会话的 broken
 * 载体也刻意不降级（放松守卫会让 broken 条目掉进同会话分支，错位前缀 → 翻倍）。
 *
 * @param {object} entry
 * @param {Array} prevSessions - 当前已合并的 sessions
 * @returns {boolean} true = 允许降级合并
 */
export function shouldDegradeBrokenMerge(entry, prevSessions) {
  if (!entry || !entry._reconstructBroken) return false;
  if (entry._staleReorder || entry.inProgress) return false;
  if (!Array.isArray(prevSessions) || prevSessions.length === 0) return true;
  const e = entry._seqEpoch;
  if (!e) return false; // v1 / epoch-less carriers never degrade
  // Reject when ANY already-merged session shares the entry's epoch (a same-
  // session broken carrier preceded by a healthy one must not degrade into the
  // same-session merge branch). Today batches are single-session per epoch, so
  // this is a defensive closure for future non-monotonic epoch streams.
  return prevSessions.every((s) => !s._seqEpoch || s._seqEpoch !== e);
}

/**
 * 增量合并 mainAgent sessions。
 *
 * 核心算法：反向锚点对齐。以 `newMessages[0]` 为锚点，从 `lastSession.messages` 末尾
 * 反向扫；命中后多块连续 fp 等价校验。三种结果：
 *  - 命中且 overlapLen === newLen：流式 no-op / suffix subset，messages 引用稳定（保 WeakMap 缓存）。
 *  - 命中且 overlapLen <  newLen：push `newMessages[overlapLen..]`，引用稳定。
 *  - 未命中：newLen<curLen → rebuild（/compact summary）；newLen===curLen → 整段 append（Plan Mode 全新片段）；
 *           newLen>curLen → 最深公共前缀扩展（截断到 fp 分叉点 L 后 push [L..]）——中断后 replay
 *           丢 partial 的分叉形态由此保住排在分叉点的用户消息；无分叉时退化为旧的 push tail。
 *  - 降级 partial 基底（lastSession._partialData）且 anchor 未命中：任何长度的全量条目都整段替换
 *    （partial 前缀有中段缺口、不可信，push tail 会翻倍）。
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
  // Task B — v2 session identity. `_seqEpoch` = "v2:<sid>" (adapter, main
  // entries only). When it changes, this is unambiguously a DIFFERENT session,
  // regardless of user_id or message count — a definitive boundary that the
  // heuristics below (same-user merge, transient filter) would otherwise miss
  // when a short prior session precedes the current one (the cold-load
  // fallback → live supersede case). null-safe: v1 leftovers have no epoch.
  const seqEpoch = entry._seqEpoch || null;

  const entryTimestamp = entry.timestamp || null;
  // Session-level model identity: ChatView falls back to it when per-message producer resolution
  // is null (e.g. the session's carrier entry is still in-flight and filtered out) — prevents the
  // "MainAgent" + generic-avatar flash on carried-over history. Latest wins: an inProgress carrier
  // stamps body.model, completion re-stamps the authoritative response.body.model.
  const entryModel = getEffectiveModel(entry);

  if (prevSessions.length === 0) {
    return [{
      userId, messages: newMessages, response: newResponse, entryTimestamp, model: entryModel, _seqEpoch: seqEpoch,
      // Degraded-broken carrier: truthful prefix with a mid-session hole. Only
      // the create branches carry it (a same-session merge onto a partial base
      // is defused by the whole-replace below); ChatView renders the banner.
      ...(entry._partialData === true && { _partialData: true }),
    }];
  }

  const lastSession = prevSessions[prevSessions.length - 1];

  const prevMsgCount = lastSession.messages ? lastSession.messages.length : 0;
  const isNewConversation = prevMsgCount > 0 && newMessages.length < prevMsgCount * 0.5 && (prevMsgCount - newMessages.length) > 4;
  const sameUser = userId !== null && userId === lastSession.userId;
  // Three-part guard (NEVER two-part): only split when BOTH sides carry an
  // epoch and they differ — `undefined !== "v2:x"` would wrongly split a v1
  // leftover or a main-looking sub that lacks _seqEpoch.
  const epochChanged = !!(seqEpoch && lastSession._seqEpoch && seqEpoch !== lastSession._seqEpoch);

  // /clear 后的首个 checkpoint：始终是新会话起点。
  // 同 device 下 sameUser 永远 true，否则会被下面的 same-session 分支吞掉；
  // 也不能被 transient 过滤掉（即便 newMessages.length === 1）。
  // epoch 变化语义等同 post-clear（确定性会话边界），走同一 append 分支且绕过
  // 下方 transient 过滤（短的新会话也不能被丢弃，否则与 batch 腿分歧）。
  if (isPostClearCheckpoint(entry, prevMsgCount) || epochChanged) {
    for (let i = 0; i < newMessages.length; i++) {
      if (!newMessages[i]._timestamp) newMessages[i]._timestamp = entryTimestamp;
    }
    return [...prevSessions, {
      userId, messages: newMessages, response: newResponse, entryTimestamp, model: entryModel, _seqEpoch: seqEpoch,
      ...(entry._partialData === true && { _partialData: true }),
    }];
  }

  if (!options.skipTransientFilter && isNewConversation && newMessages.length <= 4 && prevMsgCount > 4) {
    return prevSessions;
  }

  if (sameUser || (userId === lastSession.userId && !isNewConversation)) {
    const curLen = prevMsgCount;
    const newLen = newMessages.length;
    if (!lastSession.messages) lastSession.messages = [];

    // fp 缓存：预算 newMessages 的 fp 数组一次，传给 findReverseAnchor 避免多块连续校验
    // 时反复调用 messageFingerprint（流式 5000+ 次/秒 SSE 路径节省 25-100ms 累计延迟）。
    // curFpsCache 与 findReverseAnchor 共享：anchor miss 时等长分支的对位比较直接复用
    // 反向扫已经算过的 curMsgs fp，零重复计算。
    const newFps = newLen > 0 ? newMessages.map(messageFingerprint) : null;
    const curFpsCache = new Array(curLen);
    const anchor = findReverseAnchor(newMessages, lastSession.messages, newFps, curFpsCache);

    if (anchor) {
      const tailStart = anchor.overlapLen;
      // tailStart === newLen：流式 no-op / suffix subset，messages 引用不动。
      if (tailStart < newLen) {
        for (let i = tailStart; i < newLen; i++) {
          if (!newMessages[i]._timestamp) newMessages[i]._timestamp = entryTimestamp;
          lastSession.messages.push(newMessages[i]);
        }
      }
      // Anchor 对齐成功：新全量条目与 partial 前缀吻合，数据已恢复完整。
      delete lastSession._partialData;
    } else if (lastSession._partialData) {
      // 降级合并的 partial 会话（中段缺口，前缀不可信）：anchor 未命中时任何
      // 同长/更长的全量条目都是权威真值，整段替换而非前缀扩展——否则会 push 出
      // 尾部重复（partial 里已含 416..418，新全量 419 会被 append 一遍）。
      for (let i = 0; i < newLen; i++) {
        if (!newMessages[i]._timestamp) newMessages[i]._timestamp = entryTimestamp;
      }
      lastSession.messages = newMessages;
      delete lastSession._partialData;
    } else if (newLen < curLen) {
      // /compact summary 等真重建：替换 messages 引用。
      for (let i = 0; i < newLen; i++) {
        if (!newMessages[i]._timestamp) newMessages[i]._timestamp = entryTimestamp;
      }
      lastSession.messages = newMessages;
    } else if (newLen === curLen) {
      // 等长且 anchor 未命中：两种形态必须区分（docs/WIRE_FORMAT.md §3.1 / §3.7）——
      // (a) Plan Mode 全新短窗口：内容与累积历史无关，整段 append 保留历史；
      // (b) 同会话近似拷贝：末位原地替换 / 中段编辑，但服务端信号缺失（完成序倒置让无信号
      //     的 stale checkpoint 后落盘、或旧日志无信号）。此形态整段 append 会让对话翻倍
      //     （mainAgent 整段重复 bug 的翻倍终点），必须替换。
      let aligned = 0;
      // 严格多数（非简单 plurality）：对位 fp 相等数 ≥ floor(N/2)+1 才判近似拷贝→替换。
      // 近似拷贝逐位几乎全等；Plan Mode 新窗口对位相等 ≈ 0。取严格多数是替换误判的
      // 安全边界——N=2→需 2 条全等、N=3→2、N=4→3；宁可对"一半相同"的模糊形态保守
      // append（残余形态：末位短暂陈旧），也不冒错杀新窗口历史的风险。调阈值前先想清
      // 反例：近拷贝带 1 条中段编辑（N=2 时 1/2 不足多数 → append → 翻倍回归）。
      const STRICT_MAJORITY = Math.floor(newLen / 2) + 1;
      for (let i = 0; i < newLen && aligned < STRICT_MAJORITY; i++) {
        let cfp = curFpsCache[i];
        if (cfp === undefined) {
          cfp = messageFingerprint(lastSession.messages[i]);
          curFpsCache[i] = cfp;
        }
        if (newFps[i] === cfp) aligned++;
      }
      if (aligned >= STRICT_MAJORITY) {
        // 近似拷贝 → 整段替换（等价于无信号版 in-place replace）。
        // 引用更换会使 ChatView WeakMap 渲染缓存失效一次性重渲染，预期内。
        for (let i = 0; i < newLen; i++) {
          if (!newMessages[i]._timestamp) newMessages[i]._timestamp = entryTimestamp;
        }
        lastSession.messages = newMessages;
      } else {
        // Plan Mode 2-msg 全替换窗口，整段 append。
        for (let i = 0; i < newLen; i++) {
          if (!newMessages[i]._timestamp) newMessages[i]._timestamp = entryTimestamp;
          lastSession.messages.push(newMessages[i]);
        }
      }
    } else {
      // newLen > curLen 且 anchor (单点 newMsgs[0]) 未命中：最深公共前缀扩展——
      // 逐位找双方 fp 相等的最长前缀 L，截断到 L 后 push newMessages[L..]。
      // 中断场景（Esc/Stop/排队消息"立即追加"）：客户端会话尾部是被打断的 partial
      // assistant，而下一轮 wire replay 丢弃该 partial、在 curLen-1 处放的是排队的
      // user prompt——anchor 因窗口末位失配而 miss，旧的"严格前缀扩展"只 push
      // [curLen..]，会把排在 curLen-1 的用户消息永久丢掉（prompt 不渲染、回复变孤儿）。
      // 退化性质：无分叉时 L===curLen（与旧行为逐字节等价）；零公共前缀时 L=0 →
      // 整段内容为 wire 真相（内容上等价于 _partialData / newLen<curLen 分支的整段替换；
      // 本分支为原地截断+push，messages 引用保持稳定，保住 WeakMap 渲染缓存）。
      let L = 0;
      const limit = Math.min(curLen, newLen);
      while (L < limit) {
        let cfp = curFpsCache[L];
        if (cfp === undefined) {
          cfp = messageFingerprint(lastSession.messages[L]);
          curFpsCache[L] = cfp;
        }
        if (newFps[L] !== cfp) break;
        L++;
      }
      lastSession.messages.length = L;
      for (let i = L; i < newLen; i++) {
        if (!newMessages[i]._timestamp) newMessages[i]._timestamp = entryTimestamp;
        lastSession.messages.push(newMessages[i]);
      }
    }

    lastSession.response = newResponse;
    lastSession.entryTimestamp = entryTimestamp;
    if (entryModel) lastSession.model = entryModel; // latest wins; model-less entries keep the stamp
    return [...prevSessions];
  } else {
    return [...prevSessions, {
      userId, messages: newMessages, response: newResponse, entryTimestamp, model: entryModel, _seqEpoch: seqEpoch,
      ...(entry._partialData === true && { _partialData: true }),
    }];
  }
}
