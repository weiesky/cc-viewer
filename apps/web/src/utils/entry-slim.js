/**
 * Entry Slim — 流式接收剪枝模块
 *
 * 老格式日志每条 MainAgent entry 包含累积的完整 messages，
 * 480MB 文件 JSON.parse 后在浏览器中膨胀到 ~1.2GB → OOM。
 *
 * 核心机制：同 session 内只保留最新一条 MainAgent 的完整 messages 与 body 大字段，
 * 前一条立即释放。被剪枝的 entry 记录 _fullEntryIndex 供按需还原。
 *
 * v2: 除 messages 外，body.system / body.metadata / body.tool_choice 也参与 slim。
 *     - body.tools: 不再 slim（见下方 §tools 修复）。tools 完整保留，由 v3 pool 去重控内存。
 *     - body.system: 每个 text block 仅保留前 SYSTEM_TEXT_KEEP_PREFIX 字符
 *     - body.metadata: 仅保留 user_id（slim session boundary 检测依赖）
 *     - body.tool_choice: 直接删除
 *   兼顾：保留 isMainAgent / isNativeTeammate / classifyRequest 等 read path 所需的 shape。
 *   单条 MainAgent entry 节省 ~250–300KB，全 session 累计节省 ~50% 渲染进程堆内存。
 *
 * 导出：
 * - createEntrySlimmer(isMainAgentFn): 批量剪枝器（历史日志加载，process + finalize）
 * - createIncrementalSlimmer(isMainAgentFn): 增量剪枝器（实时 SSE,无需 finalize）
 * - restoreSlimmedEntry(entry, requests): 按需还原被剪枝的 entry
 */

// system text 每个 block 保留的前缀长度（字符数）。
// 必须足够覆盖现有的 system text 检测关键词（contentFilter.js / teammateDetector.js）：
//   - "You are Claude Code"        ~50 字符内
//   - "You are a Claude agent"     ~50 字符内
//   - SUBAGENT_SYSTEM_RE: "command execution specialist | file search specialist
//     | planning specialist | general-purpose agent"
//   - cc_version=X.Y.Z (extractCcVersion)
// 假设：所有上述检测器消费的关键词都在 system block 前 2KB 内。新增依赖 system text
// 更长前缀的检测器时，同步上调此常数。2048 字符相对原始 ~50KB 节省 ~96%。
export const SYSTEM_TEXT_KEEP_PREFIX = 2048;

// ─── intern pools (v3) ──────────────────────────────────────────────────────
// 1.6.237 实测：每个 session 的"最后一条" MainAgent 仍保留完整 body.tools（fullEntry
// 不被 slim），678 个 fullEntry 各持一份 ~250KB tools 描述 ≈ 170MB 浪费。
// v3 修正：所有 entry（含 fullEntry）的 body.tools / body.system 走 module-level pool
// 共享同一引用。signature 命中时直接替换为 pool ref，pool 内是完整原始数据。
// pool 容量上限防御异常输入；正常 cc-viewer session 内 tools/system 配置稳定，
// pool 实测 size 通常 < 5。FIFO eviction 见 _internOrAdd。
const _MAX_INTERN_POOL_SIZE = 200;
const _toolsPool = new Map();   // sig → tools array (full, shared)
const _systemPool = new Map();  // sig → system array (full, shared)

// v5: messages 内 tool_result block.content 走 readResultPool 同一池化逻辑。
// SubAgent / Teammate entry 不被 slim，body.messages 中 inline 嵌入的 Read/Bash 等
// tool_result 跨多个 SubAgent run 是同一份内容重复。v4 已 dedup 派生层（toolResultMap.resultText），
// v5 补 raw payload（req.body.messages[*].content[*].content）这一关键缺口。
// internToolResultIfPooled 的命中信号是 lazy-clone 决策的关键：JS string === 是值比较，
// 普通 internToolResult 返回的 ref 无法用于 ref-不变性判断。
import { internToolResultIfPooled } from './readResultPool.js';
import { isCompactContinuation } from '../../../../packages/app/src/utils/clearCheckpoint.js';

function _toolsSig(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return '';
  // 't:' 前缀让 tools / system / readResult 三套 sig 命名空间正交，
  // 避免未来如果共用同一个 pool 时碰撞。
  let sig = 't:' + tools.length;
  for (const t of tools) {
    sig += '|' + (t?.name || '') + ':' + (t?.description?.length || 0);
  }
  return sig;
}

function _systemSig(system) {
  if (Array.isArray(system)) {
    if (system.length === 0) return 'a:0';
    let sig = 'a:' + system.length;
    for (const b of system) {
      const text = b?.text || '';
      // 边界增强（CR P1 defensive）：cc-viewer 场景中 system block 跨 entry 通常同模板，
      // 仅前缀检测在长 text 后段差异时不足。加中段 50 字符显著降低误共享概率。
      const mid = text.length > 100 ? Math.floor(text.length / 2) : 0;
      sig += '|' + (b?.type || '') + ':' + text.length + ':' + text.slice(0, 50) + ':' + text.slice(mid, mid + 50);
    }
    return sig;
  }
  if (typeof system === 'string') {
    const mid = system.length > 100 ? Math.floor(system.length / 2) : 0;
    return 's:' + system.length + ':' + system.slice(0, 50) + ':' + system.slice(mid, mid + 50);
  }
  return '';
}

function _internOrAdd(pool, sig, value) {
  let pooled = pool.get(sig);
  if (pooled) return pooled;
  if (pool.size >= _MAX_INTERN_POOL_SIZE) {
    // FIFO eviction — 早期插入的优先丢；cc-viewer 场景 tools/system 配置稳定，pool
    // 实测命中率极高（典型 size <5），FIFO/LRU 等价；远期升级 LRU 时再换。
    pool.delete(pool.keys().next().value);
  }
  // 浅冻结 pool entries（CR P1 defensive）：防止 caller 拿到 ref 后 push/splice 污染
  // 所有共享该 ref 的 entry。Object.freeze 是浅层（数组顶层不可变，元素对象不冻结
  // 以避免影响 React 渲染期可能 mutate 内部字段——cc-viewer 实际不发生但保留余地）。
  if (Array.isArray(value)) Object.freeze(value);
  pool.set(sig, value);
  return value;
}

/**
 * 把 messages[*].content[*] 中的 tool_result block.content 字符串替换为 readResultPool
 * 共享引用。仅处理 string 形态的 content（minority array/object 形态原样透传）。
 *
 * 设计要点：
 * - lazy clone：只在至少有一个 block 命中 pool 替换时才 clone messages / content / block。
 *   未命中场景零开销，原数组直接返回。
 * - 浅 clone（{...block}）保留 _timestamp 等顶层字段；不冻结 messages 数组——
 *   AppBase.jsx:1170-1175 mutate `messages[i]._timestamp` 仍可工作。
 * - tool_result.content 字符串本身不可变（JS string primitive），多个 entry 共享 pool ref
 *   完全安全。
 *
 * @param {Array} messages
 * @returns {Array} 原数组（无变化）或浅 clone 后的新数组
 */
export function internMessagesToolResultBlocks(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;

  let newMessages = null;
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const content = msg?.content;
    if (!Array.isArray(content) || content.length === 0) continue;

    let newContent = null;
    for (let j = 0; j < content.length; j++) {
      const block = content[j];
      if (!block || block.type !== 'tool_result') continue;
      const c = block.content;
      // 仅 dedup string 形态。array 形态（含 text/image blocks）少见且结构复杂，留待后续。
      if (typeof c !== 'string') continue;
      // pooled = null 时为未命中（已注册到 pool 但调用方无需替换 ref——block 已持原始 ref，
      // 且原始 ref 也是 pool 持有的 ref，零浪费）；pooled 非 null 时是命中，原始 c 是独立分配
      // 副本，必须替换为 pool ref 才能让原副本可被 GC 回收。
      const pooled = internToolResultIfPooled(c);
      if (pooled !== null) {
        if (newContent === null) newContent = content.slice();
        newContent[j] = { ...block, content: pooled };
      }
    }

    if (newContent !== null) {
      if (newMessages === null) newMessages = messages.slice();
      newMessages[i] = { ...msg, content: newContent };
    }
  }

  return newMessages || messages;
}

/**
 * 把 entry.body.tools / body.system / body.messages 替换为 module-level pool 中的共享引用。
 * 在 entry 进入 state.requests 之前调用，所有路径（SSE flush / batch load /
 * IndexedDB cached restore）都应过一遍此函数。
 *
 * 返回新 entry 对象（如果 body 字段被替换）或原 entry（无变化时）。
 *
 * @param {object} entry
 * @returns {object}
 */
export function internEntryBigFields(entry) {
  if (!entry?.body) return entry;
  const body = entry.body;
  let newTools = body.tools;
  let newSystem = body.system;
  let newMessages = body.messages;
  let dirty = false;

  if (Array.isArray(body.tools) && body.tools.length > 0) {
    const sig = _toolsSig(body.tools);
    const pooled = _internOrAdd(_toolsPool, sig, body.tools);
    if (pooled !== body.tools) {
      newTools = pooled;
      dirty = true;
    }
  }

  if ((Array.isArray(body.system) && body.system.length > 0) || typeof body.system === 'string') {
    const sig = _systemSig(body.system);
    if (sig) {
      const pooled = _internOrAdd(_systemPool, sig, body.system);
      if (pooled !== body.system) {
        newSystem = pooled;
        dirty = true;
      }
    }
  }

  // v5: walk messages 内的 tool_result block.content 走通用 pool。
  // SubAgent / Teammate 不被 slim 路径，这是 raw payload 唯一的 dedup 入口。
  if (Array.isArray(body.messages) && body.messages.length > 0) {
    const interned = internMessagesToolResultBlocks(body.messages);
    if (interned !== body.messages) {
      newMessages = interned;
      dirty = true;
    }
  }

  if (dirty) {
    return {
      ...entry,
      body: { ...entry.body, tools: newTools, system: newSystem, messages: newMessages },
    };
  }
  return entry;
}

/**
 * 测试辅助：清空 intern pools。仅用于单元测试隔离。
 */
export function _resetInternPoolsForTest() {
  _toolsPool.clear();
  _systemPool.clear();
}

/**
 * 测试辅助：观察 pool 当前状态（仅 size）。
 */
export function _getInternPoolStatsForTest() {
  return { toolsPoolSize: _toolsPool.size, systemPoolSize: _systemPool.size };
}

/**
 * 把一个 body 的大字段降级为占位 shape，返回**新 body 对象**（不 mutate 原 body）。
 * 调用方拿到新 body 后需自行赋值给 entry，例如 `entry.body = slimBodyBigFields(entry.body)`
 * （批量路径）或在 clone 中嵌入（增量路径，避免 React 渲染中间态）。
 * Export 仅用于单元测试；运行时调用方应使用 createEntrySlimmer / createIncrementalSlimmer。
 *
 * @param {object} body
 * @returns {object} 新 body 对象
 */
export function slimBodyBigFields(body) {
  if (!body) return body;
  const next = { ...body, messages: [] };

  // §tools 修复：body.tools 不再降级。
  // 旧逻辑把非末位请求的 tools 降级为 [{name}]，并在 restoreSlimmedEntry 时从末位
  // fullEntry 继承 tools。在 tools_search 等"tools 列表逐请求变化"的场景下，这会让所有
  // 历史请求都显示最后一条的 tools、变化时机彻底丢失。这里完整保留 tools（next 已从
  // body 浅拷贝携带原引用）：internEntryBigFields 先把 tools 走 module-level pool 按内容
  // 签名去重，相同 tools 共享同一引用、内存仍有界；不同 tools 各自保留，才能还原真实变化。

  if (Array.isArray(body.system)) {
    next.system = body.system.map(blk => {
      if (!blk || typeof blk !== 'object') return blk;
      if (blk.type === 'text' && typeof blk.text === 'string' && blk.text.length > SYSTEM_TEXT_KEEP_PREFIX) {
        const slimBlock = { ...blk, text: blk.text.slice(0, SYSTEM_TEXT_KEEP_PREFIX) };
        return slimBlock;
      }
      return blk;
    });
  } else if (typeof body.system === 'string' && body.system.length > SYSTEM_TEXT_KEEP_PREFIX) {
    next.system = body.system.slice(0, SYSTEM_TEXT_KEEP_PREFIX);
  }

  if (body.metadata && typeof body.metadata === 'object') {
    next.metadata = body.metadata.user_id ? { user_id: body.metadata.user_id } : {};
  }

  if ('tool_choice' in next) delete next.tool_choice;

  return next;
}

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
  let prevEpoch = null; // task B: v2 _seqEpoch — a change is a definitive session boundary (never slim across it)

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
      const epoch = entry._seqEpoch || null;
      // Three-part guard (never two-part): only when BOTH sides carry an epoch.
      const epochChanged = !!(epoch && prevEpoch && epoch !== prevEpoch);

      // Preserve the /compact-continuation signal BEFORE this entry can be slimmed
      // by a later one: once body.messages is emptied, isCompactContinuation() can
      // no longer see the summary msg[0], and isSessionBoundary (clearCheckpoint.js)
      // would misread the big count drop as a new-terminal session on batch reload.
      entry._compactContinuation = isCompactContinuation(entry);

      // session 边界检测（同 mergeMainAgentSessions）
      // KEEP IN SYNC (semantics): isSessionBoundary in clearCheckpoint.js is the
      // shared predicate for session segmentation. This copy intentionally stays
      // divergent (no compact exclusion): if the slimmer treated a /compact
      // continuation as same-session, the pre-compact entry would be slimmed with
      // _fullEntryIndex pointing at the shorter compact entry, and
      // restoreSlimmedEntry's guard (fullEntry.messages.length < _messageCount)
      // would permanently fail to restore it.
      const isNewSession = prevMsgCount > 0 && (
        (count < prevMsgCount * 0.5 && (prevMsgCount - count) > 4) ||
        (prevUserId && userId && userId !== prevUserId) ||
        epochChanged
      );

      // 瞬态请求过滤（阈值与 App.jsx _flushPendingEntries 保持一致：>4）
      // epoch 变化=确定性新会话，即便短也不可当瞬态丢弃（task B，与 sessionManager 一致）。
      if (isNewSession && !epochChanged && count <= 4 && prevMsgCount > 4) {
        return entry;
      }

      if (isNewSession) {
        prevMainIdx = currentIdx;
        prevMsgCount = count;
        prevUserId = userId; prevEpoch = epoch;
        return entry;
      }

      // 同 session：剪枝前一条 MainAgent 的 messages 与 body 大字段
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
          // 批量路径：原代码就是 in-place mutate prev.body.messages = []，
          // 这里同样 in-place 替换 body 各大字段。entries 数组在 _batchSlim 阶段
          // 还未传给 React，无渲染中间态风险。
          prev.body = slimBodyBigFields(prev.body);
        }
      }

      entry._prevMsgCount = prevMsgCount;
      prevMainIdx = currentIdx;
      prevMsgCount = count;
      prevUserId = userId; prevEpoch = epoch;
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

        // KEEP IN SYNC (semantics): intentionally divergent from isSessionBoundary
        // (clearCheckpoint.js) — see the comment on the process() predicate above.
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
  // 从 fullEntry 还原被 slim 降级的大字段；entry.body 自身的非 big-field（model、max_tokens、stream 等）保留。
  const fullBody = fullEntry.body;
  // messages 是累积量：fullEntry 的 messages 前缀 slice 即本 entry 的原始 messages。
  // system / metadata / tool_choice 仍被 slim 降级，故从 fullEntry 还原。
  // tools 不在此还原（§tools 修复）：slim 已不降级 tools，entry 自身的 body.tools
  // 即该请求真实的（pool 完整）tools；从 fullEntry 取会错误继承末位请求的 tools。
  return {
    ...entry,
    _slimmed: false,
    _fullEntryIndex: undefined,
    body: {
      ...entry.body,
      messages: fullBody.messages.slice(0, entry._messageCount),
      system: fullBody.system,
      metadata: fullBody.metadata,
      tool_choice: fullBody.tool_choice,
    },
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
  let prevEpoch = null; // task B: v2 _seqEpoch — a change is a definitive session boundary (never slim across it)
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
      const epoch = entry._seqEpoch || null;
      // Three-part guard (never two-part): only when BOTH sides carry an epoch.
      const epochChanged = !!(epoch && prevEpoch && epoch !== prevEpoch);

      // Preserve the /compact-continuation signal before slimming — same rationale
      // as createEntrySlimmer.process(): incrementally-slimmed entries can be
      // re-ingested by the batch pipeline on a warm-cache reconnect, where
      // isSessionBoundary needs this flag because messages are gone.
      entry._compactContinuation = isCompactContinuation(entry);

      // session 边界检测（与 batch slimmer / mergeMainAgentSessions 一致）
      // KEEP IN SYNC (semantics): intentionally divergent from isSessionBoundary
      // (clearCheckpoint.js) — see the comment on createEntrySlimmer.process().
      const isNewSession = prevMsgCount > 0 && (
        (count < prevMsgCount * 0.5 && (prevMsgCount - count) > 4) ||
        (prevUserId && userId && userId !== prevUserId) ||
        epochChanged
      );

      // 瞬态请求过滤（阈值与 App.jsx _flushPendingEntries 保持一致：>4）
      // epoch 变化=确定性新会话，即便短也不可当瞬态丢弃（task B，与 sessionManager 一致）。
      if (isNewSession && !epochChanged && count <= 4 && prevMsgCount > 4) {
        return entry;
      }

      if (isNewSession) {
        sessionSlimmedIndices.clear();
        prevMainIdx = currentIdx;
        prevMsgCount = count;
        prevUserId = userId; prevEpoch = epoch;
        return entry;
      }

      // 前向 slim：剪枝上一条 MainAgent 的 messages 与 body 大字段
      // 注意：必须 clone entry 再修改，不能 in-place mutate。
      // requests 数组是 [...prev.requests] 浅拷贝，元素仍与 React 上一次 state 共享引用，
      // 直接 mutate 会导致 React 渲染中途看到 messages=[] 的中间态，引起对话闪烁。
      if (prevMainIdx >= 0 && prevMainIdx < requests.length) {
        const orig = requests[prevMainIdx];
        if (orig.body?.messages?.length > 0) {
          const cloned = {
            ...orig,
            body: slimBodyBigFields(orig.body),
            _messageCount: orig.body.messages.length,
            _slimmed: true,
            _fullEntryIndex: currentIdx,
          };
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
      prevUserId = userId; prevEpoch = epoch;
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
