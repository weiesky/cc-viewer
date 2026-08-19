// Wire format 协议详见 docs/WIRE_FORMAT.md（applyInPlaceLastMsgReplace 信号驱动短路是其客户端唯一消费方）
import { isSessionBoundary, isPostClearCheckpoint } from '../../../../packages/app/src/utils/clearCheckpoint.js';
import { getEffectiveModel } from './effectiveModel.js';

/**
 * 给一组 messages 赋 `_timestamp` 和 `_generatedTs`。
 *
 * 背景：cc-viewer 通过下一次 API 请求的 body.messages 才能感知到上一次的 assistant 响应。
 * 旧逻辑给所有新增 message 统一赋 `entry.timestamp`，导致 assistant msg 的 _timestamp 是
 * "下一次 request 的 ts"，bubble 显示时间晚一拍。helpers.js:resolveProducerModelInfo 用
 * `idx-1` hack 修了 model icon，但 bubble 时间标签没修。
 *
 * 修法：保留 `_timestamp` 语义不变（仍然是 "carrier entry's ts"，所有现有消费者依赖此），
 * 给 assistant 角色的新增 message 额外赋 `_generatedTs = prevMainAgentTs`（生成时 entry 的 ts），
 * ChatMessage 显示 bubble 时优先用 `_generatedTs ?? _timestamp`。
 *
 * @param {Array} messages 当前 entry 的 messages 数组（in-place mutate）
 * @param {Array} prevMessages 上一次 mainAgentSessions 的 last session.messages
 * @param {boolean} isNewSession 是否触发新 session（postClearCheckpoint / 用户切换 / 长度骤降）
 * @param {number} prevCount prevMessages.length（缓存）
 * @param {string} currentTs 当前 entry.timestamp
 * @param {string|null} prevMainAgentTs 上一次 mainAgent entry 的 timestamp，无则 null
 * @returns {Array} messages（原数组引用）
 */
export function assignMessageTimestamps(messages, prevMessages, isNewSession, prevCount, currentTs, prevMainAgentTs) {
  if (!Array.isArray(messages)) return messages;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m) continue;
    if (!isNewSession && i < prevCount && prevMessages[i] && prevMessages[i]._timestamp) {
      // 历史 message：继承 prev 的 _timestamp 和 _generatedTs（如有）
      m._timestamp = prevMessages[i]._timestamp;
      if (prevMessages[i]._generatedTs) {
        m._generatedTs = prevMessages[i]._generatedTs;
      }
    } else if (!m._timestamp) {
      // 新增 message：赋 currentTs；assistant 角色额外赋 _generatedTs
      m._timestamp = currentTs;
      if (m.role === 'assistant' && prevMainAgentTs) {
        m._generatedTs = prevMainAgentTs;
      }
    } else if (m.role === 'assistant' && !m._generatedTs && prevMainAgentTs) {
      // 已有 _timestamp 但缺 _generatedTs（混合输入：部分 entry 来自旧版本）：补 _generatedTs
      // Synthetic v2 messages carry their own _generatedTs (stamped by the
      // normalizer), so they never reach this branch.
      m._generatedTs = prevMainAgentTs;
    }
  }
  return messages;
}

/**
 * 解析 bubble 对应的"生产请求 ts" —— 双向映射 msg ↔ request 的 lookup key。
 *
 * 语义对齐：
 *   - assistant msg：体现"哪次 API 调用 *生成* 此 response" → `_generatedTs` (= 上一次 mainAgent ts，
 *     即真正产出该 content 的 request 的 ts)。fallback 到 `_timestamp` 兼容旧 cache / 首条 entry。
 *   - user / 其他 role：体现"哪次 API 调用 *承载* 此 input" → `_timestamp` (carrier，本就 = 该请求自身 ts)。
 *
 * 用途：
 *   - ChatView reqIdx = tsToIndex[resolveBubbleProducerTs(msg)] —— "查看请求"按钮跳到 producer
 *   - ChatView 网络报文→对话反向跳转 highlight 的 tsItemMap key 走 m.props.displayTs || m.props.timestamp
 *     （assistant bubble 已收 displayTs={msg._generatedTs}，等价 producer ts）
 *
 * 不影响：`_timestamp` 作 carrier 语义（resolveModelInfo / 时间排序 / dedup key 等消费者保持不变）。
 *
 * @param {object} msg lastSession.messages[i]
 * @returns {string|null}
 */
export function resolveBubbleProducerTs(msg) {
  if (!msg) return null;
  if (msg.role === 'assistant') return msg._generatedTs || msg._timestamp || null;
  return msg._timestamp || null;
}

/**
 * 取会话的「稳定 id」—— 一致的会话身份。
 *
 * 首条消息的 `_timestamp`（= 会话起点 ts，首次赋值后不再变），它同时等于
 *   `entry._sessionId` / `AppBase._currentSessionId`（该会话为当前会话时）。
 *
 * 注意：**不要用 `session.entryTimestamp`** —— 它在每次 mergeMainAgentSessions 时被改写为
 * 最新 entry 的 ts（sessionMerge.js），会漂移，不能作身份。仅作 messages 缺失时的兜底。
 *
 * @param {object} session
 * @returns {string|null}
 */
export function getSessionStableId(session) {
  if (!session) return null;
  const first = session.messages && session.messages[0];
  return (first && first._timestamp) || session.sessionId || null;
}

/**
 * Latest-ACTIVITY timestamp of a session — the counterpart of getSessionStableId.
 * Stable id answers "which session is this?"; activity ts answers "when did this
 * session last receive an entry?". `entryTimestamp` is rewritten to the newest
 * merged entry's ts on every mergeMainAgentSessions call — that drift makes it
 * unusable as identity but exactly right for recency.
 *
 * ISO-8601 strings from toISOString() compare correctly with `<`/`>` (fixed-width
 * UTC).
 *
 * @param {object} session
 * @returns {string|null}
 */
export function getSessionActivityTs(session) {
  if (!session) return null;
  if (session.entryTimestamp) return session.entryTimestamp;
  const msgs = session.messages;
  const last = msgs && msgs.length ? msgs[msgs.length - 1] : null;
  return (last && last._timestamp) || getSessionStableId(session);
}

/**
 * Pick the session with the newest activity.
 *
 * Used by the "only show current session" pin to decide what "current" means.
 * mainAgentSessions is ordered by insertion, never by time — with interleaved
 * multi-terminal sessions or a truncated reconnect replay, the LAST list element
 * is frequently an old session, so "last element == current" does not hold.
 *
 * A null activity ts never wins over a real timestamp (a session missing every
 * timestamp source must not hijack the pick from a genuinely newer session).
 * Ties resolve to the LATER list position. When NO session has a usable
 * timestamp, degrade to the last element.
 *
 * @param {Array} sessions - mainAgentSessions
 * @returns {object|null}
 */
export function getLatestSessionByActivity(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) return null;
  let best = null;
  let bestTs = null;
  for (const s of sessions) {
    if (!s) continue;
    const ts = getSessionActivityTs(s);
    if (ts === null) continue;
    if (bestTs === null || ts >= bestTs) {
      best = s;
      bestTs = ts;
    }
  }
  if (best) return best;
  return sessions[sessions.length - 1] || null;
}

/**
 * Pure decision for adopting a server-side pin during hydrate (page load, project
 * switch, SSE reconnect) or a `session_pin` broadcast.
 *
 * The server pin is just a persisted pointer — after idle/restart it can point at
 * an older logical session (or have been poisoned by a client that derived a wrong
 * latest). When "only show current session" is ON and we can already derive the
 * latest session locally, the derived value is authoritative and a mismatching
 * remote value is rejected. When the toggle is off, or sessions haven't loaded yet
 * (no derived id), the remote value is adopted as-is.
 *
 * @param {*} remoteId - raw pinnedSessionId from the server (string|null|undefined)
 * @param {string|null} derivedLatestId - getSessionStableId(getLatestSessionByActivity(...))
 * @param {boolean} onlyCurrentSession - effective toggle value
 * @returns {{adopt: boolean, value: string|null}} adopt=false means "keep/derive
 *   locally"; value is then the derived latest for reference.
 */
export function resolveHydratedPin(remoteId, derivedLatestId, onlyCurrentSession) {
  const remote = (typeof remoteId === 'string' && remoteId) ? remoteId : null;
  if (!onlyCurrentSession) return { adopt: true, value: remote };
  if (!derivedLatestId) return { adopt: true, value: remote };
  return remote === derivedLatestId
    ? { adopt: true, value: remote }
    : { adopt: false, value: derivedLatestId };
}

/**
 * Async orchestration of one pin-hydrate round, extracted from AppBase._hydratePin
 * so the race-sensitive ordering is unit-testable without React:
 *
 *   1. Await the server pin; if this round was superseded (isCurrent() false —
 *      a newer hydrate started, e.g. project switch or another reconnect), bail
 *      out WITHOUT touching the gate: the newer round owns it.
 *   2. Decide via resolveHydratedPin. Adopt → adopt(value) only on change.
 *      Reject with the local pin ALREADY at the derived latest → persistLocal():
 *      the follow-latest self-heal below won't change state in that case, so it
 *      would never POST, and a poisoned server-side pin file would survive.
 *   3. finally (still current): clearGate() BEFORE selfHeal() — follow-latest
 *      early-outs while the gate is up, so the inverted order is a silent no-op
 *      and a stale pin would stick until the next stream activity.
 *
 * @param {object} deps
 * @param {() => Promise<*>} deps.fetchPin - resolves to raw remote pinnedSessionId
 * @param {() => boolean} deps.isCurrent - false when a newer hydrate superseded this one
 * @param {() => string|null} deps.getDerived - derived latest stable id (at resolve time)
 * @param {() => boolean} deps.effOnly - effective "only show current session" toggle
 * @param {() => string|null} deps.getLocalPin - current local pin state
 * @param {(value: string|null) => void} deps.adopt - apply a remote pin value locally
 * @param {() => void} deps.persistLocal - POST the current local pin to the server
 * @param {() => void} deps.clearGate - clear the "hydrate in flight" gate
 * @param {() => void} deps.selfHeal - re-run follow-latest (AppBase._maintainPinState)
 * @returns {Promise<void>}
 */
export async function runPinHydration({ fetchPin, isCurrent, getDerived, effOnly, getLocalPin, adopt, persistLocal, clearGate, selfHeal }) {
  try {
    const remote = await fetchPin();
    if (!isCurrent()) return;
    const r = resolveHydratedPin(remote, getDerived(), effOnly());
    if (r.adopt) {
      if (r.value !== getLocalPin()) adopt(r.value);
    } else if (getLocalPin() === r.value) {
      persistLocal();
    }
  } catch {
    // Network/JSON errors: nothing to adopt; fall through so the gate is cleared.
  } finally {
    if (isCurrent()) {
      clearGate();
      selfHeal();
    }
  }
}

/**
 * Batch-path boundary + timestamp state machine, extracted from
 * AppBase._processOneEntry so the session-segmentation logic is unit-testable
 * and shares isSessionBoundary with the live SSE path (_flushPendingEntries).
 * Two deliberate deltas vs the old inlined block: the shared predicate adds the
 * /compact exclusion the batch path lacked, and a truncation branch (below)
 * realigns the positional accumulators after a compact rewrite.
 *
 * Mutates `st` in place (same contract as before extraction):
 *   st.timestamps / st.generatedTimestamps - positional ts accumulators
 *   st.currentSessionId - stable id of the session being accumulated
 *   st.prevUserId / st.prevMainAgentTs - carry-over between entries
 * and stamps `_timestamp` / `_generatedTs` onto entry.body.messages.
 *
 * @param {object} st - batch accumulator state
 * @param {object} entry - mainAgent entry with body.messages array
 * @returns {void}
 */
export function applyBatchEntryTimestamps(st, entry) {
  const messages = entry.body.messages;
  const count = entry._messageCount || messages.length;
  const userId = entry.body.metadata?.user_id || null;
  const timestamp = entry.timestamp || new Date().toISOString();

  const prevCount = st.timestamps.length;
  // Post-/clear checkpoints must always start a new session (bypass the transient
  // filter below), otherwise the first count=1 entry after a delta rebuild would
  // be swallowed and its _timestamp stolen by the next count>4 entry.
  const postClearCheckpoint = isPostClearCheckpoint(entry, prevCount);
  // V2 transcript synthetic entries pre-stamp per-message _timestamp/_generatedTs
  // with the real row timestamps; the positional overwrites below would flatten
  // every message to entry.timestamp, so they become protective for synthetics.
  const isSyntheticV2 = entry._syntheticV2 === true;
  const epoch = entry._seqEpoch || null;
  const epochChanged = !!(epoch && st.prevEpoch && epoch !== st.prevEpoch);
  // A synthetic v2 entry is a complete /clear-segmented session — always a new
  // session (its _seqEpoch is a definitive boundary marker), even when the
  // count-based heuristics would call it a continuation.
  const isNewSession = isSyntheticV2 || isSessionBoundary(entry, { prevCount, count, prevUserId: st.prevUserId, userId, prevEpoch: st.prevEpoch, epoch });
  // Transient protection: very short entries (<=4 msgs) after a long conversation
  // are usually in-flight requests (request body only, no response yet) and must
  // not reset the accumulated timestamps. Real /clear starts AND epoch changes
  // (task B: a definitive new session, even when short) are exempt.
  // A synthetic v2 entry is never transient — it is a complete /clear-segmented
  // session, so it must start a session even right after a long legacy one.
  const isTransient = !isSyntheticV2 && isNewSession && !postClearCheckpoint && !epochChanged && count <= 4 && prevCount > 4 && count < prevCount * 0.5;
  if (isNewSession && !isTransient) {
    st.currentSessionId = timestamp;
    st.timestamps = [];
    st.generatedTimestamps = [];
    st.prevMainAgentTs = null; // new session start: reset to avoid cross-session bleed
  } else if (st.currentSessionId === null) {
    st.currentSessionId = timestamp;
  } else if (entry._compactContinuation === true && count < st.timestamps.length) {
    // /compact continuation (same session, NOT a boundary): the conversation was
    // rewritten to a shorter message list. Truncate the positional accumulators so
    // messages appended after the compact get fresh timestamps — mirroring the live
    // path, where merge rebuilds lastSession.messages to the compact entry's list.
    // Without this, positions beyond `count` keep inheriting hours-old ts until the
    // conversation regrows past the pre-compact length.
    st.timestamps.length = count;
    st.generatedTimestamps.length = count;
  }
  // Extend the two parallel arrays; new positions take this entry's ts and record
  // the previous mainAgent ts as their "generated at" ts.
  // Note: role-gating happens in the inner loop (not at push time) — in the offline
  // batch path this entry may be _slimmed (body.messages=[]) with only _messageCount,
  // so messages[j] can be undefined here.
  for (let j = st.timestamps.length; j < count; j++) {
    st.timestamps.push(timestamp);
    st.generatedTimestamps.push(st.prevMainAgentTs || null);
  }
  if (messages.length > 0) {
    for (let j = 0; j < messages.length; j++) {
      const m = messages[j];
      if (!m) continue;
      if (!isSyntheticV2 || m._timestamp == null) m._timestamp = st.timestamps[j];
      if (m.role === 'assistant' && st.generatedTimestamps[j] && (!isSyntheticV2 || m._generatedTs == null)) {
        m._generatedTs = st.generatedTimestamps[j];
      }
    }
  }
  st.prevUserId = userId;
  st.prevEpoch = epoch; // carry v2 session epoch for the next entry's boundary check
  // Remember this entry's ts as the next entry's prevMainAgentTs.
  st.prevMainAgentTs = timestamp;
}

/**
 * 解析「仅展示当前会话」锁定下，实际传给 ChatView 的会话切片。
 *
 * 策略：把 mainAgentSessions 切到「以 pin 会话结尾」(`slice(0, idx+1)`)，让 pin 会话从
 * ChatView 视角就是最后一个会话 —— 所有 `si === length-1` 的既有逻辑（Last Response 卡片、
 * Ask/ExitPlanMode 审批 modal、分隔线）原样可用。常见情形（pin == 最新 / 未命中 / 未开）
 * 直接原样返回，行为与今天逐字节一致。
 *
 * @param {Array} mainAgentSessions
 * @param {string|null} pinnedTs - 记住的会话稳定 id；null = 未锁定
 * @param {boolean} onlyCurrentSession - 生效的「仅展示当前会话」开关
 * @returns {{ sessions: Array, upperBoundTs: (string|null) }}
 *   upperBoundTs：pin 在中段时为下一个会话的起点 ts（供 ChatView 截断更晚会话的 sub-agent /
 *   抑制 streaming 浮层）；其余情形为 null。
 *   Exception: a mid-list pinned session that is itself the latest-by-ACTIVITY is
 *   the CURRENT session (the pin follows recency, and list order is insertion
 *   order, not time order) — there is no strictly-newer session to bound against,
 *   so upperBoundTs is null. A non-null bound here would invert ChatView's
 *   "pin is on an older session" interpretation: it would suppress the live
 *   streaming overlay and truncate trailing sub-agents on the very session the
 *   user is watching.
 */
export function resolveDisplaySessions(mainAgentSessions, pinnedTs, onlyCurrentSession) {
  const sessions = Array.isArray(mainAgentSessions) ? mainAgentSessions : [];
  if (!onlyCurrentSession || pinnedTs == null || sessions.length === 0) {
    return { sessions, upperBoundTs: null };
  }
  const idx = sessions.findIndex(s => getSessionStableId(s) === pinnedTs);
  // 未命中（pin 会话已不在）/ 命中末尾 → 原样（回退到展示最新）
  if (idx === -1 || idx === sessions.length - 1) {
    return { sessions, upperBoundTs: null };
  }
  // 命中中段 → 切到「以 pin 会话结尾」；上界 = 下一个会话起点 ts，
  // 除非 pin 会话本身就是活动最新（= 当前会话，无更新会话可作上界）。
  const pinnedIsCurrent = getLatestSessionByActivity(sessions) === sessions[idx];
  return {
    sessions: sessions.slice(0, idx + 1),
    upperBoundTs: pinnedIsCurrent ? null : getSessionStableId(sessions[idx + 1]),
  };
}

/**
 * 信号驱动的 in-place last-msg replace 短路。
 *
 * 协议合同详见 `docs/WIRE_FORMAT.md` §3.3 SUGGESTION MODE 末位替换 + §2 关键字段词典
 * （`_inPlaceReplaceDetected` / `_isCheckpoint` 双信号必须齐发）。该文件是单一真理源，
 * 字段重命名 / 语义变更必须同时更新文档 + interceptor.js 写入点 + 本 helper + 双端回归测试
 * （`test/session-manager.test.js` + `test/session-manager.test.js`）。
 *
 * 双端 fp 函数互相独立、用途不同，**不要试图共用**：
 *  - 服务端 `server/lib/interceptor-core.js::fingerprintMsg` 用于 Plan C 检测末位 tail fp 异
 *  - 客户端 `src/utils/sessionMerge.js::messageFingerprint` 已升级为 `length + first32 + last32`
 *    三元组（旧格式 `slice(0,64)` 单条 fp 已淘汰）；用于反向锚点对齐时的多块 fp 等价校验。
 *
 * 客户端反向锚点算法（`src/utils/sessionMerge.js::findReverseAnchor`）在 newLen===currentLen
 * 且末位 fp 异时若 anchor 未命中会走整段 append（Plan Mode 全替换语义），这是合理的；本 helper
 * 是为了在服务端**已知是 in-place replace** 时跳过启发式合并直接替末位、保留前 N-1 条引用稳定，
 * 让 ChatView 的 WeakMap 缓存继续命中。
 *
 * 修法：直接消费服务端明确信号，不走 sessionMerge 启发式算法。命中时构造新 lastSession，前
 * N-1 条 message 元素引用复用（保留 _timestamp / _generatedTs 等所有 metadata），末位用
 * entry.body.messages[N-1]。返回 `{ applied: true, sessions }` 表示已短路；未命中返回
 * `{ applied: false }`，调用方走原 mergeMainAgentSessions 路径。
 *
 * 防回归（避开 1.6.249 拆 Layer 2 的两个坑）：
 *   - 不靠客户端 fp 启发式判断（直接看服务端明确信号 _inPlaceReplaceDetected:true）
 *   - 不覆盖整个 lastSession.messages（只替末位，保留前 N-1 引用）
 *
 * 守卫顺序（异常入参逐级 fallback 给 mergeMainAgentSessions 处理）：
 *   1. 信号未命中（_inPlaceReplaceDetected/_isCheckpoint 非 true）
 *   2. isNewSession（新 session 起点不应原地替换旧 session 末位）
 *   3. prevSessions / lastSession.messages 异常
 *   4. entry.body.messages 缺失
 *   5. N < 2（只有 1 条消息时 "前 N-1 条" 退化为空，等价完全替换 → 让原路径处理更安全）
 *   6. messages.length 与 lastSession.messages.length 不等
 *   7. entry.response 缺失（inProgress 状态不应被信号触发；服务端 Plan C 仅在 completed 写信号，
 *      此守卫是 belt+suspenders 防协议变化导致丢失 response 字段污染下游 ChatView Last Response）
 *
 * @param {Array} prevSessions
 * @param {object} entry — mainAgent entry，需含 _inPlaceReplaceDetected / _isCheckpoint / body.messages
 * @param {string} timestamp — entry 的 timestamp（用于赋新末位 message 的 _timestamp）
 * @param {boolean} isNewSession — 是否新 session 起点（true 时不短路，让原路径处理）
 * @returns {{ applied: boolean, sessions?: Array }}
 */
export function applyInPlaceLastMsgReplace(prevSessions, entry, timestamp, isNewSession) {
  // 诊断挂钩：守卫拒绝路径计数 + verbose trace（gated by globalThis.__CCV_SESSIONMERGE_TRACE__）。
  // 用户报告"复制翻车"再现时打开 trace 即可定位是信号缺失 / 哪条守卫拦了。计数挂在函数对象上，
  // 控制台直接读 applyInPlaceLastMsgReplace.fallbackCount / .appliedCount 拿快照；
  // 也可通过 globalThis.__CCV_DIAGNOSTICS__.sessionMerge 拿到统一 namespace 视图（与未来其他诊断挂钩共存）。
  const _trace = (typeof globalThis !== 'undefined' && globalThis.__CCV_SESSIONMERGE_TRACE__ === true);
  // 整体 try-catch 包裹：诊断挂钩永不应抛（fallbackCount 若被外部 Object.freeze、
  // entry getter 抛错、console 在 SSR 不可用 等异常都不应污染主路径）。
  const _bumpFb = (reason) => {
    try {
      const _fb = applyInPlaceLastMsgReplace.fallbackCount;
      // 加 cap 防 attacker 故意触发 fallback 让计数器无界膨胀（见 perf-security review P1）。
      // 9999 已足够区分"罕见 vs 频发"；超过 cap 的精确计数对诊断价值有限。
      const cur = _fb[reason] || 0;
      if (cur < 9999) _fb[reason] = cur + 1;
      if (_trace) {
        // eslint-disable-next-line no-console
        console.warn(`[sessionMerge.trace] applyInPlaceLastMsgReplace fallback: ${reason}`, {
          ts: entry && entry.timestamp,
          hasSignal: entry && entry._inPlaceReplaceDetected === true,
          isCheckpoint: entry && entry._isCheckpoint === true,
          msgLen: entry && entry.body && Array.isArray(entry.body.messages) ? entry.body.messages.length : null,
          lastSessionLen: Array.isArray(prevSessions) && prevSessions.length > 0 && prevSessions[prevSessions.length - 1] && Array.isArray(prevSessions[prevSessions.length - 1].messages) ? prevSessions[prevSessions.length - 1].messages.length : null,
        });
      }
    } catch { /* never throw from diagnostic path */ }
  };

  // 老 jsonl 兼容策略：1.6.250 之前 / 1.6.250 ship 后 interceptor 漏检 race 期间写入的
  // entry 不会带 `_inPlaceReplaceDetected` 字段，本 helper 直接 fallback。客户端不做"事后
  // 回填"——已污染的 mainAgentSessions 内存翻倍只能靠用户刷新浏览器重读 jsonl 全量重建
  // 来清理（重建路径用 sessionMerge prefix-overlap，此时旧 entry 都已乱序到位，不会再翻倍）。
  // 注意：这条早返回（无信号）是绝大多数 entry 的正常路径，不计入 fallbackCount，
  // 否则计数器会被 SSE 高频流量淹没，掩盖真正"信号到达但守卫拒绝"的异常路径。
  if (!entry || entry._inPlaceReplaceDetected !== true || entry._isCheckpoint !== true) {
    return { applied: false };
  }
  if (isNewSession) { _bumpFb('new-session'); return { applied: false }; }
  if (!Array.isArray(prevSessions) || prevSessions.length === 0) { _bumpFb('no-prev-sessions'); return { applied: false }; }
  const lastSession = prevSessions[prevSessions.length - 1];
  if (!lastSession || !Array.isArray(lastSession.messages)) { _bumpFb('no-last-session-messages'); return { applied: false }; }
  const messages = entry.body && Array.isArray(entry.body.messages) ? entry.body.messages : null;
  if (!messages || messages.length < 2) { _bumpFb('messages-too-short'); return { applied: false }; }
  if (messages.length !== lastSession.messages.length) { _bumpFb('length-mismatch'); return { applied: false }; }
  // entry.response 缺失（inProgress 等异常）→ fallback，避免 newLastSession.response=undefined
  // 污染下游 ChatView Last Response 渲染。服务端 Plan C 仅在 completed 写信号，正常情况这条守卫
  // 不会命中；保留作为协议变更时的防御层。
  if (!entry.response) { _bumpFb('response-missing'); return { applied: false }; }

  const N = messages.length;
  const stitched = lastSession.messages.slice(0, N - 1);
  const newLastMsg = messages[N - 1];
  if (newLastMsg && !newLastMsg._timestamp) newLastMsg._timestamp = timestamp;
  stitched.push(newLastMsg);
  const newLastSession = {
    userId: lastSession.userId,
    messages: stitched,
    response: entry.response,
    entryTimestamp: timestamp,
    // Carry the session-level model stamp (see mergeMainAgentSessions): this path bypasses the
    // merge and rebuilds the session object — dropping the stamp would re-bake the whole session
    // with the "MainAgent" fallback. entry.response is guaranteed by the guard above, so
    // getEffectiveModel is authoritative here; fall back to the previous stamp.
    model: getEffectiveModel(entry) || lastSession.model || null,
    // Preserve the v2 session epoch (task B) — this path clones the session, and
    // dropping it would make the next entry's epoch-boundary check read undefined.
    _seqEpoch: lastSession._seqEpoch,
  };
  // 末位替换：返回新 sessions 数组保持原顺序、prev 长度不变。
  // 下游 ChatView _sessionItemCache[last] 按 index 索引该 session，依赖 index 恒定不能错位。
  // appliedCount 加 cap 防长期累积溢出（实际 9999 远超调试需要）。
  if (applyInPlaceLastMsgReplace.appliedCount < 9999) applyInPlaceLastMsgReplace.appliedCount++;
  return { applied: true, sessions: [...prevSessions.slice(0, -1), newLastSession] };
}

// 诊断计数：信号到达但守卫拒绝时分类累加；apply 成功时单独累加。
// 调试时直接在 console 读：applyInPlaceLastMsgReplace.fallbackCount / .appliedCount。
// 各计数器加 cap=9999 防 attacker 故意触发 fallback 让计数器无界膨胀。
applyInPlaceLastMsgReplace.fallbackCount = Object.create(null);
applyInPlaceLastMsgReplace.appliedCount = 0;

// 统一 namespace（perf-security review P2）：未来其他诊断挂钩可挂到 __CCV_DIAGNOSTICS__
// 而不是直接污染 globalThis 命名空间。当前仅暴露 sessionMerge 路径，避免与其他库冲突。
if (typeof globalThis !== 'undefined') {
  if (!globalThis.__CCV_DIAGNOSTICS__) globalThis.__CCV_DIAGNOSTICS__ = Object.create(null);
  globalThis.__CCV_DIAGNOSTICS__.sessionMerge = {
    get fallbackCount() { return applyInPlaceLastMsgReplace.fallbackCount; },
    get appliedCount() { return applyInPlaceLastMsgReplace.appliedCount; },
  };
}
