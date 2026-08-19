/**
 * PTY → WS 洪泛限流器（Windows ConPTY 洪泛防卡死，server 侧字节率上限）。
 *
 * 背景：pty-manager 的 setImmediate 合帧已把"消息数"压到每 tick 一条，但**字节量
 * 没有上限**——ConPTY 把 TUI 全屏对话框/重绘转译成 macOS forkpty 10~100 倍的字节流
 * （如 /theme 选择器开/关、全屏 TUI 重绘），ws-backpressure gate 只在慢网络
 * （bufferedAmount > 1MB）介入，快 LAN 上洪泛字节全量到达前端，xterm 逐帧解析渲染
 * 稠密 SGR+CJK 重绘把主线程打满。本器在发送侧限流：
 *
 *   - 直通态：leading-edge 微合并——空窗期首 chunk 立即 send（回显零延迟）并开
 *     ptCoalesceMs（默认 16ms）窗，同窗后续 chunk 并入 ptBuffer、到点合为一条 send
 *     （上限 2 条/窗 = 1000ms÷16ms×2 ≈125 msg/s）。低于洪泛阈值的持续小 chunk 流（/plugins 菜单导航
 *     等 ConPTY 重绘）每 chunk 单发会打出数百条 ws 消息/秒，客户端逐条 MessageEvent
 *     分发 + JSON.parse + xterm 主线程解析，**消息数风暴**即可锁死页面——字节率
 *     限流（下方限流态）封不住这个维度。字节率仍按固定 flushMs 桶统计，
 *     当前桶累计超 floodThresholdBytesPerWin → 进入限流态（ptBuffer 按序折入 pending）。
 *     打字回显 / 正常 token 流是稀疏 chunk，每条都走 leading 立即发，不受影响。
 *   - 限流态：chunk 剥掉自带的 DEC 2026 标记后追加进 pending（pending 内部因此
 *     **绝无 2026 标记**，截断永不切坏配对）；每 flushMs 把 pending 用单对
 *     SYNC_BEGIN/END 重新包裹成**一条** send 发出并清空（无论下游是否跳发，
 *     flush 后必清——下游 bpGate 跳发时由其 data-resync 快照对齐，不在这里重试）。
 *     发送前若 pending 超 flushBudgetBytes → findSafeSliceStart 截到尾部预算内：
 *     这是真正的速率上限（≈ flushBudgetBytes / flushMs ≈ 1.9MB/s），与前端
 *     TerminalWriteQueue 32KB/帧的消化速率同量级，洪泛期客户端入速 ≈ 出速不积压。
 *     pending 超 pendingCap → 同样截到 trimTo（flush 间隔内的内存上界）。中间全屏
 *     重绘帧 last-wins 可丢，ConPTY 重绘流自愈。findSafeSliceStart 只保 ANSI 边界、
 *     不保 2026 配对——配平靠剥标记+重包裹兜底，截断切坏配对会让 xterm 卡在同步
 *     缓冲态（黑屏）。scratch PTY 的 chunk 本就无 2026 标记，剥除为 no-op、重包裹
 *     无害（不支持的终端忽略该序列），两条路径共用同一实现。
 *   - 回落：连续 fallbackWins 个桶低于阈值 → flush 残余后回直通态。
 *   - reset()：清 pending + timer + 回直通态。bpGate onBehind/onResume 时必须调用：
 *     data-resync 快照（getOutputBuffer）是唯一真相源，残留 pending 若不清会把早于
 *     快照的旧字节回灌导致画面回退。
 *
 * 纯逻辑、时钟可注入（setTimer/clearTimer/now），便于单测。仿 ws-backpressure.js 惯例。
 */

const SYNC_BEGIN = '\x1b[?2026h';
const SYNC_END = '\x1b[?2026l';
// 全局替换两种标记。pty-manager flushBatch 只在首尾各加一对，但限流态 pending 由
// 多个 chunk 拼接而成，内部会出现多对交替——统一剥净再整体包一对。
const SYNC_MARKS_RE = /\x1b\[\?2026[hl]/g;

// 默认常量可经 CCV_FLOOD_* 环境变量覆盖（仿 CCV_FORCE_POLL 先例），便于 Windows
// 实机排障时调参而不改源码。严格十进制白名单：parseInt 遇非数字字符即截停——
// '1e9' 解析成 1、'0x10' 解析成 0，静默生效远比回落默认值危险，非纯数字一律回落。
// 位数上限 15（< Number.MAX_SAFE_INTEGER）：超长数字串 parseInt 溢出为 Infinity 会
// 穿透 v>0 判断，setTimeout(fn, Infinity) 被 Node 钳到 1ms——33ms 桶宽静默变 1ms。
// 导出供 server.js 等复用（knob 解析逻辑收敛在此，不再各处内联）。
export function envInt(name, fallback) {
  const s = (process.env[name] ?? '').trim();
  if (!/^\d{1,15}$/.test(s)) return fallback;
  const v = parseInt(s, 10);
  return v > 0 ? v : fallback;
}

// 同 envInt 但接受 0（0 = 关闭该功能的逃生口，envInt 的 v>0 会把 0 误回落默认值）。
export function envIntAllowZero(name, fallback) {
  const s = (process.env[name] ?? '').trim();
  if (!/^\d{1,15}$/.test(s)) return fallback;
  return parseInt(s, 10);
}

const DEFAULT_FLUSH_MS = envInt('CCV_FLOOD_FLUSH_MS', 33);                       // 限流态合并窗口 = 字节率统计桶宽
const DEFAULT_FLOOD_THRESHOLD = envInt('CCV_FLOOD_THRESHOLD', 8 * 1024);         // 单桶超 8KB（≈256KB/s）判定洪泛
const DEFAULT_FALLBACK_WINS = envInt('CCV_FLOOD_FALLBACK_WINS', 3);              // 连续 N 个低于阈值的桶才回直通（迟滞）
const DEFAULT_PENDING_CAP = envInt('CCV_FLOOD_PENDING_CAP', 256 * 1024);         // 限流态 pending 上限（flush 间隔内的内存上界）
const DEFAULT_TRIM_TO = envInt('CCV_FLOOD_TRIM_TO', 128 * 1024);                 // pendingCap 截断后保留的尾部量
// 单次 flush 发送预算 = 真速率上限：64KB / 33ms ≈ 1.9MB/s，与前端 32KB/帧消化速率同量级
const DEFAULT_FLUSH_BUDGET = envInt('CCV_FLOOD_FLUSH_BUDGET', 64 * 1024);
// 直通态微合并窗口：低于洪泛阈值的持续小 chunk 流（如 /plugins 菜单导航的 ConPTY 重绘）
// 每 chunk 单发会打出每秒数百条 ws 消息——客户端每条都付 MessageEvent 分发 + JSON.parse +
// xterm 主线程同步解析，**消息数风暴**（非字节率）即可锁死页面（xterm.js#3368）。
// leading-edge 立即发（回显零延迟）+ 同窗后续合并 trailing 一条
// → 上限 2 条/窗 ≈125 msg/s（1000ms ÷ 16ms × 2 条）。0 = 禁用。
const DEFAULT_PT_COALESCE_MS = envIntAllowZero('CCV_FLOOD_PT_COALESCE_MS', 16);

/**
 * @param {object} opts
 * @param {(data: string) => void} opts.send - 实际发送回调（调用方在内部接 bpGate + ws.send）
 * @param {(buf: string, rawStart: number) => number} opts.findSafeSliceStart - ANSI 安全截断（pty-manager 导出）
 * @param {(buffered: number) => void} [opts.onFloodStart] - 进入限流态（observability 埋点）
 * @param {() => void} [opts.onFloodEnd] - 回落直通态
 * @param {(droppedChars: number) => void} [opts.onTruncate] - 本轮洪泛**实际丢过字节**且已回落直通时触发
 *   （紧随 onFloodEnd 之后，每轮洪泛至多一次，携带累计丢弃量）。安全切片只保证残片不上屏，
 *   被截掉的中段对增量 TUI 流（macOS/Linux forkpty）不会自愈——调用方应在此用权威快照
 *   （getOutputBuffer → data-resync）对齐客户端画面。洪泛进行中不触发：中途 resync 快照
 *   立刻过期且加重负载，回落时一次终态对齐即可。reset()/dispose() 清零累计（resync 路径
 *   自身就是快照对齐，无需重复触发）。
 * @param {number} [opts.flushMs]
 * @param {number} [opts.floodThresholdBytesPerWin]
 * @param {number} [opts.fallbackWins]
 * @param {number} [opts.pendingCap]
 * @param {number} [opts.trimTo]
 * @param {number} [opts.flushBudgetBytes]
 * @param {number} [opts.ptCoalesceMs] - 直通态微合并窗口（0 = 禁用，每 chunk 单发）
 * @param {(fn: Function, ms: number) => any} [opts.setTimer] - 测试注入
 * @param {(t: any) => void} [opts.clearTimer] - 测试注入
 * @returns {{ offer: (chunk: string) => void, reset: () => void, dispose: () => void, isFlooding: () => boolean }}
 */
export function createFloodCoalescer({
  send,
  findSafeSliceStart,
  onFloodStart,
  onFloodEnd,
  onTruncate,
  flushMs = DEFAULT_FLUSH_MS,
  floodThresholdBytesPerWin = DEFAULT_FLOOD_THRESHOLD,
  fallbackWins = DEFAULT_FALLBACK_WINS,
  pendingCap = DEFAULT_PENDING_CAP,
  trimTo = DEFAULT_TRIM_TO,
  flushBudgetBytes = DEFAULT_FLUSH_BUDGET,
  ptCoalesceMs = DEFAULT_PT_COALESCE_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let flooding = false;
  let pending = '';
  let winBytes = 0;       // 当前桶累计字节（直通态由 offer 累计，限流态由 flush 结算）
  let calmWins = 0;       // 连续低于阈值的桶数
  let droppedChars = 0;   // 本轮洪泛累计实际丢弃的字符数（>0 时回落触发 onTruncate）
  let flushTimer = null;  // 限流态周期 flush；直通态下亦作为桶边界 timer（见 offer）
  let ptBuffer = '';      // 直通态微合并缓冲（窗口开启期间到达的后续 chunk）
  let ptTimer = null;     // 直通态微合并窗口 timer（16ms），与 flushTimer（33ms 字节桶）并存、职责正交
  let disposed = false;

  const stopTimer = () => {
    if (flushTimer) {
      clearTimer(flushTimer);
      flushTimer = null;
    }
  };

  const stopPtTimer = () => {
    if (ptTimer) {
      clearTimer(ptTimer);
      ptTimer = null;
    }
  };

  // 微合并窗口到点：缓冲非空则一条发出，窗口关闭（不自动续约——下一 chunk 重新 leading 立即发）。
  // ptBuffer 不剥 SYNC 标记：terminal 路径每 chunk 经 pty-manager flushBatch 已自配平（拼接守恒），
  // scratch 路径 chunk 本就无标记（拼接平凡守恒）；只有洪泛路径（有截断）才需要剥。
  const onPtFlush = () => {
    ptTimer = null;
    if (disposed || flooding || !ptBuffer) return;
    const out = ptBuffer;
    ptBuffer = '';
    try { send(out); } catch { }
  };

  // 直通态的桶边界：到点清零计数。无流量时 timer 不存在，零常驻开销。
  const armPassthroughWindow = () => {
    if (flushTimer) return;
    flushTimer = setTimer(() => {
      flushTimer = null;
      winBytes = 0;
    }, flushMs);
    flushTimer.unref?.();
  };

  const flushPending = () => {
    if (!pending) return;
    // 单次 flush 发送预算 = 真正的速率上限：超预算截到尾部（last-wins），
    // 保证洪泛期送达客户端的字节率 ≤ flushBudgetBytes/flushMs，与前端消化速率同量级。
    if (pending.length > flushBudgetBytes) {
      const rawStart = pending.length - flushBudgetBytes;
      const safeStart = findSafeSliceStart(pending, rawStart);
      droppedChars += safeStart;
      pending = pending.slice(safeStart);
    }
    const merged = SYNC_BEGIN + pending + SYNC_END;
    pending = '';
    try { send(merged); } catch { }
  };

  const onFloodTick = () => {
    flushTimer = null;
    if (disposed || !flooding) return;
    // 本桶结算：低于阈值累计 calm 桶数，连续 fallbackWins 个即回落
    if (winBytes <= floodThresholdBytesPerWin) {
      calmWins++;
    } else {
      calmWins = 0;
    }
    winBytes = 0;
    flushPending();
    if (calmWins >= fallbackWins) {
      flooding = false;
      calmWins = 0;
      try { onFloodEnd?.(); } catch { }
      // 本轮洪泛丢过字节 → 回落后通知一次终态对齐（见 opts.onTruncate doc）。
      // 置零在调用**前**：回调内若同步 reset()/re-offer 不会重复触发。
      if (droppedChars > 0) {
        const dropped = droppedChars;
        droppedChars = 0;
        try { onTruncate?.(dropped); } catch { }
      }
      return; // 不再续约 timer，回直通
    }
    flushTimer = setTimer(onFloodTick, flushMs);
    flushTimer.unref?.();
  };

  return {
    /** 每条 PTY chunk 调用。直通态立即 send；限流态进 pending 等周期 flush。 */
    offer(chunk) {
      if (disposed || !chunk) return;
      winBytes += chunk.length;   // 缓冲与直发都全量计账：微合并不致盲洪泛判定
      if (!flooding) {
        if (winBytes > floodThresholdBytesPerWin) {
          // 进入限流态：当前 chunk 是压垮桶的那条，连同微合并缓冲中未发的旧 chunk
          // 按序一并纳入 pending（已 leading 发出的部分不回收——量级在阈值内）。
          // 注意 stopTimer 只清 flushTimer，ptTimer 须显式清，否则残留窗口会在洪泛
          // 期间触发 onPtFlush（虽有 flooding 守卫兜底，仍以显式清为准）。
          flooding = true;
          calmWins = 0;
          stopTimer();
          stopPtTimer();
          pending = (ptBuffer + chunk).replace(SYNC_MARKS_RE, '');
          ptBuffer = '';
          flushTimer = setTimer(onFloodTick, flushMs);
          flushTimer.unref?.();
          try { onFloodStart?.(winBytes); } catch { }
          return;
        }
        armPassthroughWindow();
        if (ptCoalesceMs > 0) {
          // 微合并：窗口开启（ptTimer 在跑）→ 追加缓冲不发；窗口关闭 → leading 立即发
          // （单次回显零延迟）并开窗。上限 2 条/窗（leading + trailing flush）。
          if (ptTimer) {
            ptBuffer += chunk;
            return;
          }
          ptTimer = setTimer(onPtFlush, ptCoalesceMs);
          ptTimer.unref?.();
        }
        try { send(chunk); } catch { }
        return;
      }
      pending += chunk.replace(SYNC_MARKS_RE, '');
      // 单 chunk 可超 cap：pty-manager 每 tick 合帧，一个 tick（如 /resume 重放）可达数百 KB，
      // 故该分支并非不可达——它是 flush 间隔内的内存上界，与 flushPending 的速率预算各司其职。
      if (pending.length > pendingCap) {
        const rawStart = pending.length - trimTo;
        const safeStart = findSafeSliceStart(pending, rawStart);
        droppedChars += safeStart;
        pending = pending.slice(safeStart);
      }
    },
    /** bpGate onBehind/onResume 时调用：resync 快照是唯一真相源，清掉旧 pending/ptBuffer 防回灌。 */
    reset() {
      stopTimer();
      stopPtTimer();
      pending = '';
      ptBuffer = '';
      winBytes = 0;
      calmWins = 0;
      flooding = false;
      droppedChars = 0; // resync 路径调用本方法，快照即对齐，不再补发 onTruncate
    },
    isFlooding() {
      return flooding;
    },
    /** ws close 时调用，终态。 */
    dispose() {
      disposed = true;
      stopTimer();
      stopPtTimer();
      pending = '';
      ptBuffer = '';
      droppedChars = 0;
    },
  };
}
