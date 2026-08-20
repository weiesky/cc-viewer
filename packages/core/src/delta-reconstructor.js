// CLIENT-SAFE: no node deps. Home: @ccv/core (delta-reconstructor.js) — consumed by apps/web + packages/app. Do not add fs/process/node: imports.
/**
 * Delta Reconstructor — 增量日志重建模块
 *
 * Wire format 协议详见 docs/WIRE_FORMAT.md（mainAgent entry 形态判定 / 字段词典 / §3.7 完成序倒置）
 *
 * 将 delta 格式的日志条目重建为完整的 messages 数组。
 * 仅处理 mainAgent 条目；teammate（`entry.teammate` 字段，可能与 mainAgent:true 双标并存）
 * 与旧格式条目直接跳过——teammate 子进程与 leader 共写同一日志文件，其消息绝不能进入
 * mainAgent 的累积状态。
 *
 * 完成序倒置守卫（KEEP IN SYNC: server/interceptor.js `_seq` 写入点）：
 * entry 形态在请求发起时冻结，但按响应完成顺序落盘，burst 下文件序可能 ≠ 请求序。
 * 重建时跟踪 `_seq`/`_seqEpoch`：同 epoch 内 seq 小于已见最大值的条目判为乱序（stale），
 * 不进累积态并标记 `_staleReorder`（客户端 merge 入口据此跳过）；epoch 变化（进程重启 /
 * 换写进程）则重置基线。重建结果与 `_totalMessageCount` 不符时做完整性修复 / 标记
 * `_reconstructBroken`，防脏条目把整段对话二次拼接（mainAgent 整段重复 bug 根因）。
 *
 * 提供三种 API：
 * - reconstructEntries(entries): 批量重建，用于 readLogFile() 和 readLocalLog()
 * - reconstructSegment(segment, nextCheckpoint): 段级重建，用于流式分段处理
 * - createIncrementalReconstructor(): 有状态的增量重建器，用于 watcher 逐条重建
 */

/**
 * 判断一个条目是否为 checkpoint（应重置累积状态）。
 * 三种情况视为 checkpoint：
 * 1. 无 _deltaFormat 字段 → 旧格式全量条目
 * 2. _isCheckpoint === true → 显式 checkpoint
 * 3. _totalMessageCount === body.messages.length → 隐式 checkpoint（delta 长度 === 总长度）
 */
export function isCheckpointEntry(entry) {
  // 无 _deltaFormat：旧格式全量条目
  if (!entry._deltaFormat) return true;
  // 显式 checkpoint
  if (entry._isCheckpoint) return true;
  // 隐式 checkpoint：delta 长度等于总长度
  const msgs = entry.body?.messages;
  if (Array.isArray(msgs) && entry._totalMessageCount === msgs.length) return true;
  return false;
}

/**
 * 判断一个条目是否为需要重建的 delta 条目（mainAgent + _deltaFormat，排除 teammate）。
 * teammate 子进程的条目可能带 mainAgent:true 双标（system 含 "You are Claude Code"），
 * 必须显式排除，否则其 delta/checkpoint 会污染 leader 的累积状态。
 */
export function isDeltaEntry(entry) {
  return entry._deltaFormat && entry.mainAgent && !entry.teammate;
}

/**
 * 判断条目是否参与 mainAgent 累积状态（非 delta 的旧格式全量条目分支共用）。
 */
function _isMainAgentFullEntry(entry) {
  return entry.mainAgent && !entry.teammate && Array.isArray(entry.body?.messages);
}

// ============================================================================
// 完成序倒置守卫（_seq/_seqEpoch）
// ============================================================================

/**
 * seq 守卫状态机。st = { lastSeq: 0, lastEpoch: null }。
 * 返回：
 * - 'no-seq'：旧日志无 _seq，跳过检查（行为不变）
 * - 'stale' ：同 epoch 且 seq 小于已见最大值 → 乱序条目
 * - 'replay'：同 epoch 同 seq → 同条重发（日志轮转 race 等）
 * - 'ok'    ：按序条目（含 epoch 切换），st 已推进
 */
function _seqGuardCheck(entry, st) {
  const seq = entry._seq;
  if (typeof seq !== 'number') return 'no-seq';
  const epoch = entry._seqEpoch || null;
  if (st.lastEpoch !== null && epoch === st.lastEpoch) {
    if (seq < st.lastSeq) return 'stale';
    if (seq === st.lastSeq) return 'replay';
  }
  // 按序 / epoch 切换（进程重启 seq 归零、IM worker 等第二写进程）：推进基线。
  // 注意 epoch 是盲信的——任何未见过的 epoch 都视同"进程重启"重置基线，没有
  // "哪个 epoch 拥有 mainAgent 流"的概念。双写进程 interleave 时基线会被来回
  // rebase（短暂错误内容），由下一 checkpoint 自愈（≤CHECKPOINT_INTERVAL 条）。
  st.lastEpoch = epoch;
  st.lastSeq = seq;
  return 'ok';
}

/**
 * 标记乱序条目并尽量就地补偿：accumulated 已包含更新的真值时，用其前缀
 * （= 截至该条目声称长度的最新内容）回填 body.messages，避免裸 delta 切片
 * 残留在请求详情面板中。
 * 返回 true 表示已补偿（messages 为一致全量），false 表示需后续 checkpoint 补偿。
 */
function _markStaleEntry(entry, accumulated) {
  entry._staleReorder = true;
  const total = entry._totalMessageCount;
  if (Array.isArray(entry.body?.messages) && total && accumulated.length >= total) {
    entry.body.messages = accumulated.slice(0, total);
    return true;
  }
  return false;
}

/**
 * delta 拼接后的完整性校验（重建长度 vs `_totalMessageCount`）。
 * - accumulated 超长（典型：旧日志无 _seq 时的倒置——checkpoint 先落、stale delta 后落）：
 *   slice 回 _totalMessageCount，并把 `st.poisoned` 置位。会话单调增长时该前缀 = 最新
 *   checkpoint 真值；但**缩短型 checkpoint（/compact、/clear）跨倒置时前缀是旧会话内容**
 *   （局部不可判定），因此基底必须视为不可信：调用方对后续 delta 一律标 _reconstructBroken
 *   冻结，直到下一 checkpoint 重置——否则毒化基底上长度全部自洽，永不自愈。
 *   本条目同时标 _staleReorder 让 merge 跳过。
 * - accumulated 不足（typ.: 倒置中先落盘的快 delta）：仅在基线已建立时标 _reconstructBroken
 *   ——server 重启 / 客户端 reconstructor 重建后的冷启动 delta 流没有基线，维持现状透传，
 *   否则会把正常增量全部误标导致视图冻结。
 * @param {{baselineSeen: boolean, poisoned: boolean}} st - 重建器完整性状态（原地更新）
 * 返回（可能被 slice 修复过的）accumulated。
 */
function _integrityCheck(entry, accumulated, st) {
  const total = entry._totalMessageCount;
  if (!total) return accumulated;
  if (accumulated.length > total) {
    accumulated = accumulated.slice(0, total);
    entry.body.messages = accumulated;
    entry._staleReorder = true;
    st.poisoned = true;
  } else if (accumulated.length < total && st.baselineSeen) {
    entry._reconstructBroken = true;
  }
  return accumulated;
}

/**
 * 单条条目的重建状态机核心 — 三个 API（批量/段级/增量）共用。
 * KEEP IN SYNC: server/interceptor.js `_seq` 写入点。
 *
 * 调用方约定：inProgress 条目必须在调用前自行处理（批量/段级跳过、增量重建副本不进
 * 累积态）——placeholder 与 completed 共享同一 _seq，先于守卫排除防 completed 被
 * "同 seq 重发"规则误吞。
 *
 * 经过本函数后 entry.body.messages 的三种终态：
 * 1. 全量重建 —— 正常 delta 拼接 / checkpoint 原样 / replay 幂等回写；
 * 2. 真值前缀 —— stale 就地补偿、超长 slice 修复（_staleReorder 置位，merge 跳过）；
 * 3. 裸 delta 切片待补偿 —— stale 就地补偿失败 / poisoned 冻结（_staleReorder 或
 *    _reconstructBroken 置位）：由第二遍 checkpoint 补偿回填，无第二遍的路径靠
 *    isMergeBlockedEntry 阻断 merge 兜底。
 *
 * @param {object} entry - 单条日志条目（原地修改）
 * @param {{accumulated: Array, intState: {baselineSeen: boolean, poisoned: boolean},
 *          seqState: {lastSeq: number, lastEpoch: string|null}}} ctx
 *   重建上下文；ctx.accumulated 由本函数重新赋值（调用方读 ctx 而非局部变量）。
 * @returns {boolean} true = 该条目断裂、需后续 checkpoint 第二遍补偿
 *   （批量/段级路径据此收集索引；增量路径无第二遍、忽略返回值）
 */
function _stepReconstruct(entry, ctx) {
  if (!isDeltaEntry(entry)) {
    // 非 delta 条目（旧格式 / teammate）：如果是 mainAgent 旧格式，重置累积状态
    if (_isMainAgentFullEntry(entry)) {
      ctx.accumulated = [...entry.body.messages];
      ctx.intState.baselineSeen = true;
      ctx.intState.poisoned = false;
    }
    return false;
  }

  const msgs = entry.body?.messages;
  if (!Array.isArray(msgs)) return false;

  // 完成序倒置守卫
  const verdict = _seqGuardCheck(entry, ctx.seqState);
  if (verdict === 'replay') {
    // 同条重发（日志轮转 race 等）：幂等回写全量（不重复累积）
    entry.body.messages = ctx.accumulated;
    if (entry._totalMessageCount && ctx.accumulated.length !== entry._totalMessageCount) {
      entry._staleReorder = true;
      return true;
    }
    return false;
  }
  if (verdict === 'stale') {
    // 就地补偿失败 → 交给后续 checkpoint 反向修复
    return !_markStaleEntry(entry, ctx.accumulated);
  }

  if (isCheckpointEntry(entry)) {
    // checkpoint：用当前 messages 重置累积状态（毒化态随之解除）
    ctx.accumulated = [...msgs];
    ctx.intState.baselineSeen = true;
    ctx.intState.poisoned = false;
  } else if (ctx.intState.poisoned) {
    // 基底不可信（缩短型 checkpoint 跨倒置被 slice 修复过）：冻结到下一 checkpoint，
    // 交给补偿用后续 checkpoint 回填真值
    entry._reconstructBroken = true;
    return true;
  } else {
    // delta：拼接到累积数组，挂载重建后的完整 messages
    ctx.accumulated = [...ctx.accumulated, ...msgs];
    entry.body.messages = ctx.accumulated;
    ctx.accumulated = _integrityCheck(entry, ctx.accumulated, ctx.intState);
    if (entry._staleReorder || entry._reconstructBroken ||
        (entry._totalMessageCount && ctx.accumulated.length !== entry._totalMessageCount)) {
      return true; // 含 slice 修复条目：后续 checkpoint 存在时回填为真值前缀
    }
  }
  return false;
}

/**
 * 批量重建 — 用于 readLogFile() 和 readLocalLog()。
 * 输入已去重的条目数组，输出重建后的条目数组（原地修改 body.messages）。
 * 非 mainAgent delta 条目不受影响。
 *
 * @param {Array} entries - 已去重、按时间顺序排列的条目数组
 * @returns {Array} 重建后的条目数组（同一引用，原地修改）
 */
export function reconstructEntries(entries) {
  // 第一遍：正向重建
  const ctx = {
    accumulated: [],
    intState: { baselineSeen: false, poisoned: false },
    seqState: { lastSeq: 0, lastEpoch: null },
  };
  const broken = []; // 记录重建失败的条目索引（用于第二遍补偿）

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    // 跳过 inProgress 条目：孤立的 inProgress（请求超时未完成）在 dedup 后残留，
    // 其 delta 与后续 completed 条目重复，双重累积会导致 accumulated 偏移
    if (entry.inProgress) continue;
    if (_stepReconstruct(entry, ctx)) broken.push(i);
  }

  // 第二遍：补偿修复 — 用后续最近的 checkpoint 回填断裂的条目
  if (broken.length > 0) {
    _compensateBrokenEntries(entries, broken);
  }

  return entries;
}

/**
 * 用候选全量条目（checkpoint/旧格式，排除 teammate）补偿一条断裂条目。
 * 内容已是真值前缀，清除标记让批量 merge 正常消费。
 * @returns {boolean} true = 已补偿
 */
function _tryRepairFromCandidate(brokenEntry, expectedCount, candidate) {
  if (!candidate.mainAgent || candidate.teammate || !Array.isArray(candidate.body?.messages)) return false;
  // V2 transcript synthetic entries are never a valid repair source for legacy
  // delta rows — their messages are a different conversation's content.
  if (candidate._syntheticV2) return false;
  const candidateMsgs = candidate.body.messages;
  const candidateTotal = candidate._totalMessageCount || candidateMsgs.length;
  const isFullEntry = !candidate._deltaFormat || isCheckpointEntry(candidate);
  if (isFullEntry && candidateTotal >= expectedCount) {
    brokenEntry.body.messages = candidateMsgs.slice(0, expectedCount);
    delete brokenEntry._staleReorder;
    delete brokenEntry._reconstructBroken;
    return true;
  }
  return false;
}

/**
 * 补偿修复：对断裂的 delta 条目，从后续最近的 checkpoint 中提取完整 messages 回填。
 * checkpoint 包含截至该点的完整历史，可以据此反推之前条目的 messages。
 * @param {object|null} [nextCheckpoint] - 数组内向后查找失败时的额外候选
 *   （段级调用方传入段外的下一 checkpoint，最后一段可为 null）
 */
function _compensateBrokenEntries(entries, brokenIndices, nextCheckpoint = null) {
  for (const brokenIdx of brokenIndices) {
    const brokenEntry = entries[brokenIdx];
    const expectedCount = brokenEntry._totalMessageCount;
    if (!expectedCount) continue;

    // 向后查找最近的 checkpoint 或旧格式全量条目（排除 teammate）
    let repaired = false;
    for (let j = brokenIdx + 1; j < entries.length; j++) {
      if (_tryRepairFromCandidate(brokenEntry, expectedCount, entries[j])) {
        repaired = true;
        break;
      }
    }
    if (!repaired && nextCheckpoint) {
      _tryRepairFromCandidate(brokenEntry, expectedCount, nextCheckpoint);
    }
  }
}

/**
 * 段级重建 — 用于流式分段处理。
 * 对一个 checkpoint 边界内的段进行正向重建，如有 broken 条目则用 nextCheckpoint 反向修复。
 * 段内条目数通常 ≤ CHECKPOINT_INTERVAL(10)，内存开销可控。
 *
 * @param {Array} segment - 段内条目数组（段首应为 checkpoint/旧格式条目）
 * @param {object|null} nextCheckpoint - 下一个 checkpoint 条目（用于反向修复），最后一段可为 null
 * @param {{lastSeq: number, lastEpoch: string|null}} [sharedSeqState] - 跨段共享的 seq 守卫状态。
 *   流式分段调用方（log-stream）必须按文件维度传入同一对象：乱序的 stale checkpoint 自己就是
 *   段边界，若每段独立建 seqState 它会以 fresh 基线被判 'ok' 漏检。不传时退化为段内独立状态
 *   （仅适合单段调用）。
 * @returns {Array} 重建后的段条目数组（原地修改）
 */
export function reconstructSegment(segment, nextCheckpoint, sharedSeqState) {
  const ctx = {
    accumulated: [],
    intState: { baselineSeen: false, poisoned: false },
    seqState: sharedSeqState || { lastSeq: 0, lastEpoch: null },
  };
  const broken = [];

  for (let i = 0; i < segment.length; i++) {
    const entry = segment[i];
    if (entry.inProgress) continue;
    if (_stepReconstruct(entry, ctx)) broken.push(i);
  }

  // 补偿修复：先在段内向后查找，再用 nextCheckpoint
  if (broken.length > 0) {
    _compensateBrokenEntries(segment, broken, nextCheckpoint);
  }

  return segment;
}

/**
 * 创建有状态的增量重建器 — 用于 watcher 逐条重建。
 * 每次调用 reconstruct(entry) 处理一条新条目。
 *
 * @returns {{ reconstruct: (entry: object) => object, reset: () => void }}
 */
export function createIncrementalReconstructor() {
  // accumulated：mainAgent 累积 messages；
  // baselineSeen：自创建/reset 后是否见过 checkpoint/旧格式全量条目；
  // poisoned：accumulated 被 slice 修复过（基底不可信），冻结到下一 checkpoint
  const ctx = {
    accumulated: [],
    intState: { baselineSeen: false, poisoned: false },
    seqState: { lastSeq: 0, lastEpoch: null },
  };

  return {
    /**
     * 重建单条条目。
     * - 非 delta 条目：如果是 mainAgent 旧格式，更新累积状态，原样返回
     * - 乱序条目（_seq 守卫）：不进累积态，标 _staleReorder 后返回
     * - checkpoint：重置累积状态，原样返回
     * - delta：拼接重建 + 完整性校验，修改 body.messages 后返回
     *
     * @param {object} entry - 单条日志条目
     * @returns {object} 重建后的条目（同一引用）
     */
    reconstruct(entry) {
      // inProgress 条目：用 accumulated 副本重建 messages，但不更新 accumulated 本身，
      // 也不参与 seq 守卫（placeholder 与 completed 共享同一 _seq，先于守卫跳过，
      // 防 completed 被"同 seq 重发"规则误吞）。
      // 这样客户端收到完整 messages（避免 delta 闪烁），
      // 而后续 completed 条目仍能基于正确的 accumulated 重建。
      if (entry.inProgress) {
        if (isDeltaEntry(entry) && !isCheckpointEntry(entry)) {
          const msgs = entry.body?.messages;
          if (Array.isArray(msgs)) {
            entry.body.messages = [...ctx.accumulated, ...msgs];
          }
        }
        return entry;
      }

      // 忽略 needs-compensation 返回值：增量路径是实时流、无法回看后续 checkpoint
      // 做第二遍补偿。stale 仅靠 _markStaleEntry 就地回填；未补偿条目带
      // _staleReorder/_reconstructBroken 标记，由客户端 isMergeBlockedEntry 阻断 merge。
      _stepReconstruct(entry, ctx);
      return entry;
    },

    /**
     * 重置累积状态（用于 full_reload 等场景）。
     */
    reset() {
      ctx.accumulated = [];
      ctx.intState.baselineSeen = false;
      ctx.intState.poisoned = false;
      ctx.seqState.lastSeq = 0;
      ctx.seqState.lastEpoch = null;
    }
  };
}
