// CLIENT-SAFE: no node deps. Imported by src/ — do not add fs/process/node: imports.
// (Same contract as delta-reconstructor.js.)
//
// Shared session-boundary + reverse-anchor module — single source of truth for
// "where does a logical conversation start/align" used by BOTH sides:
//  - client: src/utils/clearCheckpoint.js (re-export shell), sessionMerge.js,
//    sessionManager.js, entry-slim.js, contentFilter.js
//  - server (wire-v2, S2+): conversation-store epoch routing and the read-side
//    materializer (docs/refactor/WIRE_FORMAT_V2.md §6/§9)
//
// Functions moved VERBATIM (comments included) from src/utils/clearCheckpoint.js
// (isPostClearCheckpoint / isCompactContinuation / isSessionBoundary) and
// src/utils/sessionMerge.js (messageFingerprint / findReverseAnchor) in wire-v2
// step S1 — see docs/refactor/WIRE_FORMAT_V2_PLAN.md. Do not fork copies; the
// intentionally-divergent bigDrop mirrors in entry-slim.js stay where they are.

/**
 * 检测一个 mainAgent entry 是否是 /clear 之后的首个 checkpoint。
 *
 * 单独抽成无依赖的模块（不引 contentFilter，避免 node --test 走 bare import 失败）。
 *
 * 必要条件三选三：
 *   1. entry._isCheckpoint === true（delta 重建器认为这是一个完整快照）
 *   2. body.messages.length 比 prevMessageCount 小（真正"缩短"，排除增量再快照）
 *   3. msg[0] 是 user 消息且含 `<command-name>/clear</command-name>` 标记
 *
 * 用于 _processEntries / sessionMerge 区分真实 /clear 起点 vs 普通 /compact 缩短。
 * /compact 的 msg[0] 是 summary，没有 /clear 标记，自然返回 false。
 *
 * @param {object} entry
 * @param {number} [prevMessageCount=0]
 * @returns {boolean}
 */
export function isPostClearCheckpoint(entry, prevMessageCount = 0) {
  if (!entry || entry._isCheckpoint !== true) return false;
  const msgs = entry.body && entry.body.messages;
  if (!Array.isArray(msgs) || msgs.length === 0) return false;
  if (prevMessageCount > 0 && msgs.length >= prevMessageCount) return false;
  const m0 = msgs[0];
  if (!m0 || m0.role !== 'user' || !Array.isArray(m0.content)) return false;
  for (let i = 0; i < m0.content.length; i++) {
    const block = m0.content[i];
    if (block && block.type === 'text' && typeof block.text === 'string' &&
        block.text.indexOf('<command-name>/clear</command-name>') !== -1) {
      return true;
    }
  }
  return false;
}

// /compact 摘要续写检测：CLI 在 /compact（手动或自动 auto-compact）后，把整段历史压成一条
// summary 作为新 msg[0] 重新起流。其 msg[0] 是 CLI 合成的 summary/continuation prompt，
// 匹配下面两种固定开头之一（与 contentFilter.js 的 Compact 合成 prompt 判据同源，此处内联
// 一份纯正则以保持本模块零依赖，可被 node --test 直接 bare import）。
//
// 用途：区分「大幅缩短的 mainAgent checkpoint」到底是——
//   (a) /compact 续写：msg[0] 命中本判据 → 属【同一会话延续】，不应触发新会话切换；
//   (b) 全新终端会话：msg[0] 是用户真实首个输入 → 不命中 → 属【新会话起点】。
// 在同机器多终端场景下 user_id（device_id+account_uuid）完全相同，无法据此区分会话，
// 故本判据是「大幅缩短」信号下把 /compact 和真·新会话拆开的唯一可靠依据。
const COMPACT_SUMMARY_RE = /^(Your task is to create a detailed summary of the conversation|This session is being continued from a previous conversation)/i;
export function isCompactContinuation(entry) {
  const msgs = entry && entry.body && entry.body.messages;
  if (!Array.isArray(msgs) || msgs.length === 0) return false;
  const m0 = msgs[0];
  if (!m0 || m0.role !== 'user') return false;
  let text = '';
  if (typeof m0.content === 'string') {
    text = m0.content;
  } else if (Array.isArray(m0.content)) {
    for (let i = 0; i < m0.content.length; i++) {
      const block = m0.content[i];
      if (block && block.type === 'text' && typeof block.text === 'string') {
        text += block.text;
      }
    }
  }
  return COMPACT_SUMMARY_RE.test(text.trimStart());
}

/**
 * Shared session-boundary predicate — the single source of truth for "does this
 * mainAgent entry start a NEW logical session?", used by BOTH the batch path
 * (applyBatchEntryTimestamps → _processOneEntry) and the live SSE path
 * (_flushPendingEntries). Keeping the two paths on one predicate guarantees the
 * session segmentation (and thus each session's stable id = messages[0]._timestamp)
 * is identical live and after a reload, which the "only show current session"
 * pin depends on.
 *
 * Rules:
 *   1. Post-/clear checkpoint → always a boundary (bypasses everything else).
 *   2. Big message-count drop (count < 50% of prev AND drop > 4) → boundary,
 *      UNLESS the entry is a /compact continuation. Slimmed entries have
 *      body.messages emptied, so isCompactContinuation() can no longer see the
 *      summary — the slimmer stamps `entry._compactContinuation` beforehand
 *      (entry-slim.js) and we trust that flag here.
 *   3. user_id change with an established previous session (prevCount > 0) →
 *      boundary (different device/account writing into the same log).
 *   4. (task B) v2 `_seqEpoch` change → boundary. A different session id is a
 *      definitive boundary the count/user heuristics miss when a SHORT prior
 *      session precedes the current one (cold-load fallback → live supersede).
 *      Three-part guard: only when BOTH sides carry an epoch and they differ,
 *      so v1 leftovers (no epoch) and epoch-less entries fall through unchanged.
 *
 * KEEP IN SYNC: the bigDrop formula (rule 2, minus the compact exclusion) is
 * mirrored in entry-slim.js's three slimmer predicates (process/finalize/
 * incremental), which stay intentionally divergent for restore-guard reasons —
 * tune the 0.5 ratio or the >4 drop threshold in all four places together.
 *
 * @param {object} entry - mainAgent entry (may be _slimmed)
 * @param {object} ctx
 * @param {number} ctx.prevCount - message count accumulated before this entry
 * @param {number} ctx.count - this entry's message count
 * @param {string|null} ctx.prevUserId - user_id of the previous entry/session
 * @param {string|null} ctx.userId - this entry's user_id
 * @param {string|null} [ctx.prevEpoch] - _seqEpoch of the previous session
 * @param {string|null} [ctx.epoch] - this entry's _seqEpoch
 * @returns {boolean}
 */
export function isSessionBoundary(entry, { prevCount, count, prevUserId, userId, prevEpoch, epoch }) {
  if (isPostClearCheckpoint(entry, prevCount)) return true;
  // Epoch change is a definitive boundary (bypasses count/user heuristics).
  if (epoch && prevEpoch && epoch !== prevEpoch) return true;
  const bigDrop = prevCount > 0 && count < prevCount * 0.5 && (prevCount - count) > 4;
  const compactLike = (entry && entry._compactContinuation === true) || isCompactContinuation(entry);
  if (bigDrop && !compactLike) return true;
  if (prevCount > 0 && prevUserId && userId && userId !== prevUserId) return true;
  return false;
}

/**
 * Equality normalization (wire-v2 S4 decision 2026-07-14): the CC client
 * migrates ttl-based cache_control breakpoints onto OLD messages
 * mid-conversation, rewriting string content in place into a block array
 * carrying cache_control. v1's delta format cannot express an in-place
 * old-message mutation, and no consumer depends on cache_control placement —
 * so EQUALITY judgements (verify's messagesDigest, the converter's exactFps)
 * normalize each message in two steps before comparing:
 *   1. string content → [{type:'text',text}] (unified form, so
 *      messageFingerprint's `s|` / `t|` markers no longer fork on migration);
 *   2. strip cache_control from top-level content blocks.
 * NEVER use this on the storage path — persisted events keep the wire verbatim.
 */
export function normalizeMsgForEquality(msg) {
  try {
    if (!msg || typeof msg !== 'object') return msg;
    let c = msg.content;
    if (typeof c === 'string') {
      c = [{ type: 'text', text: c }];
    } else if (Array.isArray(c)) {
      let changed = false;
      const out = c.map((b) => {
        if (b && typeof b === 'object' && b.cache_control !== undefined) {
          changed = true;
          const { cache_control, ...rest } = b;
          return rest;
        }
        return b;
      });
      if (!changed) return msg; // common path: no allocation
      c = out;
    } else {
      return msg;
    }
    return { ...msg, content: c };
  } catch {
    return msg; // malicious getter etc.: fall back to the original, same policy as messageFingerprint
  }
}

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
export function messageFingerprint(msg) {
  // 异常隔离：用户提供的 msg.content 可能含恶意 getter（`{ get text() { throw } }`），
  // 整段 try-catch 让单条 entry 异常不级联污染整个流式合并路径。返回空串作"匿名 fp"，
  // 调用方 findReverseAnchor 看到 !fp0 || endsWith('|empty') 会拒当锚点，安全 fallback。
  try {
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
  } catch {
    return '';
  }
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
 *  - 复杂度：单候选 O(L)，最坏 O(curLen·newLen)，典型 K<200。
 *  - **fp 双向缓存**：newFps + curFpsCache 都缓存，让反向扫多候选场景下同一 curMsgs[p]
 *    只算一次 fp（perf-security review P2，长 session 5000+/s SSE 路径节省 ~50% fp 调用）。
 *
 * @param {Array} newMsgs - 新消息数组
 * @param {Array} curMsgs - 累积消息数组
 * @param {Array<string>} [newFps] - 预计算的 newMsgs fp 数组缓存
 * @param {Array<string>} [sharedCurFpsCache] - 调用方共享的 curMsgs fp 懒缓存（anchor miss 后
 *   等长分支的对位比较可复用，避免对同一 curMsgs 重算 fp）
 * @returns {{anchorIdx: number, overlapLen: number} | null}
 */
export function findReverseAnchor(newMsgs, curMsgs, newFps, sharedCurFpsCache) {
  const newLen = newMsgs.length;
  const curLen = curMsgs ? curMsgs.length : 0;
  if (newLen === 0 || curLen === 0) return null;
  const fp0 = newFps ? newFps[0] : messageFingerprint(newMsgs[0]);
  // 空内容 fp 不当锚点：role|empty 在 curMsgs 多处可能命中（连续多条空 content 消息），
  // 反向扫到第一个 role|empty 会误锚到错误位置，导致 overlapLen 计算偏差。
  // 若 newMsgs[0..N-1] 是"newMsgs[0] 空 + 后续有效"的混合序列：放弃以 newMsgs[0] 为锚点，
  // 由调用方 fallback 路径（newLen<curLen → rebuild / newLen===curLen → 等长内容感知 /
  // newLen>curLen → push tail）兜底；这条防线保的是"全 empty 新序列误复用旧 curMsgs 末尾"。
  if (!fp0 || fp0.endsWith('|empty')) return null;
  // curMsgs fp 懒缓存：sparse Array 仅记录被访问过的位置，避免上来就 map 整段长 session
  // （curLen 可能 > 5000，但实际访问命中的 p 通常 < 50 个）。
  const curFpsCache = sharedCurFpsCache || new Array(curLen);
  const curFpAt = (idx) => {
    let v = curFpsCache[idx];
    if (v === undefined) {
      v = messageFingerprint(curMsgs[idx]);
      curFpsCache[idx] = v;
    }
    return v;
  };
  for (let p = curLen - 1; p >= 0; p--) {
    if (curFpAt(p) !== fp0) continue;
    const overlapLen = Math.min(newLen, curLen - p);
    let ok = true;
    for (let i = 1; i < overlapLen; i++) {
      // 边界安全：i < overlapLen ≤ newLen ≤ newFps.length，必不越界（newFps 在调用处
      // 用 newMessages.map 整体生成）。这里 newFps 仅作命中加速缓存，传入与否语义等价。
      const newFpI = newFps ? newFps[i] : messageFingerprint(newMsgs[i]);
      if (newFpI !== curFpAt(p + i)) {
        ok = false; break;
      }
    }
    if (ok) return { anchorIdx: p, overlapLen };
    // 验证失败（fp 加固后罕见）→ 继续向左找下一候选；curFpsCache 让重叠候选区域复用 fp。
  }
  return null;
}
