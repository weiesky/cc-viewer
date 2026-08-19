/**
 * TerminalWriteQueue —— xterm 写缓冲队列，TerminalPanel + ScratchTerminal 共享。
 *
 * 设计目标（仅一个核心优化 + 防回归）：
 *   1) 解决原实现 `_writeBuffer = _writeBuffer.slice(N)` 的 O(n²) 字符串切片
 *      —— 大流量（/resume 1MB+）下每帧复制整个剩余 buffer，导致 794ms self
 *      + GC +56%。改用「string[] queue + offset 指针」算法，整体 O(n)。
 *   2) 每帧仅 write 一个 chunk，节奏与原实现等价：
 *      - 不做 single-frame multi-chunk drain（会让 /resume 滚动从平滑变跳顿）
 *      - 不设 MAX_BYTES_PER_FRAME（tab 切回时主线程暴吃 200ms）
 *
 * 消化力自适应（AIMD，Windows DOM 渲染器洪泛掉帧治理）：
 *   - chunk 尺寸动态 ∈ [4KB, 32KB]（构造 opts.initialChunkBytes 设初值，默认 32KB）。
 *     依据 xterm write(data, callback) 的解析完成回调计时：单 chunk 耗时 >24ms
 *     减半（把原子解析单元压进帧预算），<8ms 连续 3 次 +4KB。快机稳定 32KB
 *     （现状零变化），慢机收敛 4~8KB。
 *   - callback 安全边界（旧注释「dispose 时 callback 丢 → 永久死锁」的根治版）：
 *     callback 仅用于计时与 outstanding 记账，**永不门控写出**；唯一软背压是
 *     outstanding > 2×chunk 时跳过本帧（仍续约 rAF），且只在「本 epoch 已观察到
 *     callback 正常回调」（_cbSeen）后才启用——mock/不回调的终端行为零变化；
 *     配 500ms fail-open（callback 失联即清账恢复写），只会 fail-open 不会
 *     fail-closed。reset()/dispose() 时 epoch++ 丢弃旧回调（terminal.reset 不清
 *     xterm WriteBuffer，resync 后旧 cb 仍会到达，防串台污染计时）。
 *
 * 顺带修复（既有缺陷）：
 *   - UTF-16 surrogate pair 在 32KB 边界硬切 → emoji 显示为 �。
 *     新算法在切片末位检测 high surrogate，优先回退 1 让下轮带出整对；
 *     回退会变 0 时改前进 1（保证整对完整，轻微超 CHUNK_SIZE 可接受）。
 *   - terminal.write 抛异常（罕见，dispose 中途 / WebGL contextLoss）
 *     → 原实现 buf 已清丢失。新实现 try/catch 内回滚 head/offset，停续约
 *     rAF 防死循环；下次 push 时重新触发，数据尽量不丢。
 *   - unmount 数据丢失（既有 bug）：drain() 同步排空 buffer 给 xterm。
 *
 * 不做的事（避免功能退化）：
 *   - 不改变 ScratchTerminal 是否分帧（原本无分帧，保持）
 *   - 不处理 D3 同步 _flushWrite 调用点的字节序问题（既有 bug，超出范围）
 *   - 不引入异步 callback / Promise，保持 rAF 同步语义
 *
 * 积压自保（Windows ConPTY 洪泛防卡死）：
 *   - ConPTY 把 TUI 输出转译成全屏重绘序列，入速可远超 rAF 32KB/帧（≈2MB/s）的出速，
 *     queue 无界堆积 → 内存膨胀 → GC 长停顿 → 页面卡死（极端 renderer OOM）。
 *   - 积压超 highWaterBytes（默认 2MB ≈ 1 秒待写量）时从 head「整项」丢弃回落到
 *     trimTargetBytes（默认 512KB），只动 head/offset 指针、绝不从项中间切；
 *     序列可被 PTY 分块切到相邻两项，故丢弃后对保留的新 head 项做锚点推进
 *     （offset 跳到下一个 ESC / LF 之后，见 _maybeTrim doc）防孤儿序列尾巴
 *     按字面渲染。丢弃后下一帧先写黄字提示（前缀 \x18 CAN
 *     中止半截转义 + \x1b[?2026l 退出可能被撕裂配对的同步输出模式），依赖洪泛流
 *     自带的全屏重绘自愈，
 *     不调 term.reset()（保 scrollback、避免 WebGL 重建抖动）。
 *   - 单次 /resume 1MB+ push 低于水位不会误触；每帧节奏不变
 *     （不踩 tab 切回暴吃 / /resume 跳顿坑）。
 *   - reset()：清空队列但保持可用（服务端 data-resync 对齐时用，区别于 dispose 终态）；
 *     同时把 chunk 复位到构造初值（平台保守初值，慢机由 AIMD 再收敛）并取消在途 rAF。
 */

import { diagCount, diagSet, diagEwma } from './termDiag.js';
import { now } from './monotime.js';

const CHUNK_SIZE = 32 * 1024;        // 自适应上限（= 原固定值，快机行为不变）
const CHUNK_MIN = 4 * 1024;          // 自适应下限
const ADAPT_SLOW_MS = 24;            // 单 chunk 解析耗时超此值 → 减半
const ADAPT_FAST_MS = 8;             // 低于此值连续 ADAPT_FAST_STREAK 次 → +4KB
const ADAPT_FAST_STREAK = 3;
const ADAPT_STEP_UP = 4 * 1024;
const CB_FAIL_OPEN_MS = 500;         // callback 失联超此值清账恢复写（fail-open）
const GC_THRESHOLD_HEAD = 64;        // queue 头部消费指针超 64 项触发压缩
const GC_CONSUMED_RATIO = 2;         // head×2 > 总项数（已消费过半）也触发（防长尾占内存）
const GC_RATIO_MIN_HEAD = 8;         // 比例触发的最小 head（避免小队列频繁 slice）
const HIGH_WATER_BYTES = 2 * 1024 * 1024;  // 积压上限：超过即丢最旧整项
const TRIM_TARGET_BYTES = 512 * 1024;      // 丢弃后回落的目标水位（留迟滞带防抖）
// 丢弃提示：\x18 (CAN) 中止 xterm 解析器中可能残留的半截转义序列；随后 \x1b[?2026l
// 幂等退出 DEC 2026 同步输出模式——直通态下 Claude Code 自发的 ?2026h/?2026l 可能分属
// 不同队列项，trim 撕裂配对会让渲染停到 xterm 内置 1s 超时（静默尾部场景更久）才自愈。
const TRIM_NOTICE = '\x18\x1b[?2026l\r\n\x1b[33m[cc-viewer] output trimmed (renderer behind)\x1b[0m\r\n';
// 带内复位（替代带外 terminal.reset()）：reset() API 立即清解析器状态，但 xterm 内部
// WriteBuffer 里已 write 未解析的字节会在 reset **之后**继续解析——它们的起点是解析暂停点
// （可能在序列正中间），ground state 下半截序列按字面渲染成 `0;134m` 类残片并永久留在
// scrollback 里。改为把复位作为字节流推进写队列，按序排在残留内容之后，解析器状态全程连续。
// 各字节职责（关键：组合内**无任何序列清 scrollback**，重连/resync 后历史可上拉）：
//   \x07 BEL    —— 若解析器停在 OSC payload 中，终结之（ground 态下是无声 bell，无害）
//   \x18 CAN    —— 若停在 CSI/ESC 中，中止之 → GROUND（零残片防线**全靠这两字节**，非靠 RIS）
//   \x1b[2J ED2 —— 仅清可视区（scrollOnEraseInDisplay 默认 false=就地擦除，不滚入历史），
//                  给重连/反压 resync 的快照一块干净视口，避免与陈旧当前帧重叠重复
//   \x1b[H CUP  —— 光标归位视口左上（替代 RIS 的光标复位）
//   \x1b[!p DECSTR —— 软复位 SGR/modes/charset（替代 RIS 的属性复位），不动任何 buffer
// 历史曾用 \x1bc RIS（= Terminal.reset()，新建 Buffer 连 scrollback 一起清空）——已弃：
// 它让每次 ws 重连 / 反压 resync 都把用户历史清成只剩一屏、上拉不到。已用真实 xterm 6.0
// headless 验证：本组合保留 scrollback 且对半截序列零残片（test/terminal-pipeline-oracle）。
export const INBAND_RESET = '\x07\x18\x1b[2J\x1b[H\x1b[!p';

export class TerminalWriteQueue {
  /**
   * @param {() => any | null} getTerminal - 返回当前 xterm 实例（或 null）
   * @param {{ highWaterBytes?: number, trimTargetBytes?: number, initialChunkBytes?: number, onTrim?: () => void }} [opts]
   *   - 积压自保水位，移动端可传更小值（内存预算低）
   *   - initialChunkBytes：自适应 chunk 初值（Windows DOM 渲染器建议 16KB），
   *     运行期按消化耗时在 [CHUNK_MIN, CHUNK_SIZE] 内 AIMD 调节
   *   - onTrim：积压**实际丢弃**队列项时回调（每次 trim 触发，调用方自行节流）。
   *     整项丢弃不撕裂 ANSI/surrogate，但丢掉的内容对增量输出流不会自愈——
   *     调用方应借此向服务端发 resync-request 请求权威快照对齐。
   */
  constructor(getTerminal, opts) {
    this._getTerminal = getTerminal;
    this._queue = [];
    this._head = 0;          // 已完整消费的 queue 项数
    this._offset = 0;        // queue[head] 中已消费的字符偏移
    this._rafId = 0;         // 0 = 无定时器（避免 null vs number 歧义）
    this._unmounted = false;
    this._highWater = opts?.highWaterBytes || HIGH_WATER_BYTES;
    this._trimTarget = opts?.trimTargetBytes || TRIM_TARGET_BYTES;
    this._trimmedSinceFlush = false;
    this._onTrim = typeof opts?.onTrim === 'function' ? opts.onTrim : null;
    // ── 消化力自适应状态 ──
    const init = opts?.initialChunkBytes || CHUNK_SIZE;
    this._initialChunk = Math.max(CHUNK_MIN, Math.min(CHUNK_SIZE, init)); // reset() 复位基准
    this._chunkSize = this._initialChunk;
    this._fastStreak = 0;      // 连续快回调计数（AIMD 增窗）
    this._epoch = 0;           // reset/dispose 递增，丢弃旧 write callback
    this._outstanding = 0;     // 已写出未回调的字符数
    this._cbSeen = false;      // 本 epoch 是否观察到 callback 正常回调（门控前置条件）
    this._lastWriteSentAt = 0; // fail-open 计时基准
  }

  /** 单 chunk 解析耗时 → AIMD 调节 chunk 尺寸 */
  _adapt(dt) {
    if (dt > ADAPT_SLOW_MS) {
      this._chunkSize = Math.max(CHUNK_MIN, this._chunkSize >> 1);
      this._fastStreak = 0;
    } else if (dt < ADAPT_FAST_MS) {
      if (++this._fastStreak >= ADAPT_FAST_STREAK) {
        this._fastStreak = 0;
        this._chunkSize = Math.min(CHUNK_SIZE, this._chunkSize + ADAPT_STEP_UP);
      }
    } else {
      this._fastStreak = 0;
    }
    diagSet('chunkSize', this._chunkSize);
    diagEwma('cbLatencyEwma', dt);
  }

  /**
   * 异步写入（与原 _throttledWrite 等价入口）
   * @param {string} data
   */
  push(data) {
    if (!data || this._unmounted) return;
    if (typeof data !== 'string') return;   // 当前 cc-viewer 仅传 string
    this._queue.push(data);
    this._maybeTrim();
    this._schedule();
  }

  /**
   * 积压自保：超 highWater 时从 head 整项丢弃回落到 trimTarget。
   * 只推进 head/offset 指针（与 _flush 的消费语义完全一致），不从项中间切；
   * 但序列可被 PTY 分块切到相邻两项——被丢项若以半截转义序列结尾，保留的新
   * head 项开头就是孤儿尾巴（ground state 下被 xterm 按字面渲染成 `[9m`/
   * `2;8;145;178m` 类乱码，TRIM_NOTICE 的 \x18 只能中止解析器内的半截序列，
   * 管不了它）。故丢弃后对新 head 项做锚点推进：offset 跳到项内下一个 ESC
   * （全新序列起点）或 LF 之后——与服务端 ansi-safe-slice.js 同语义；窗口内
   * 无锚点则保持原样（纯文本无撕裂风险）。丢弃后置标记，下一帧 _flush 先写
   * TRIM_NOTICE 告知用户。
   */
  _maybeTrim() {
    let pending = this._pendingBytes();
    diagSet('writeQPendingBytes', pending);
    if (pending <= this._highWater) return;
    // 单项超大（如 >2MB /resume 快照）时下方循环一项都不会丢——此时不得置
    // trim 标记/计数，否则会给用户写假的 "output trimmed" 黄字（数据其实完整交付）
    const headBefore = this._head;
    // length-1：最新一项永不丢（单项超大如 /resume 快照时整段保留，终端必须呈现最新状态）
    while (this._head < this._queue.length - 1 && pending > this._trimTarget) {
      pending -= this._queue[this._head].length - this._offset;
      this._head++;
      this._offset = 0;
    }
    if (this._head === headBefore) return; // 实际什么都没丢 → 不报 trim
    // 锚点推进（见方法 doc）：跳过可能的孤儿序列尾巴。ESC 优先于 LF（与服务端一致），
    // 顺带跳过项首孤立低代理（配对的高代理在被丢项尾部）。
    const keptHead = this._queue[this._head];
    if (keptHead) {
      let anchor = -1;
      let afterLf = -1;
      const limit = Math.min(keptHead.length, 4096);
      for (let i = 0; i < limit; i++) {
        const c = keptHead.charCodeAt(i);
        if (c === 0x1b) { anchor = i; break; }
        if (c === 0x0a && afterLf === -1) afterLf = i + 1;
      }
      let off = anchor !== -1 ? anchor : (afterLf !== -1 ? afterLf : 0);
      const c0 = keptHead.charCodeAt(off);
      if (c0 >= 0xdc00 && c0 <= 0xdfff) off++;
      this._offset = off;
    }
    this._trimmedSinceFlush = true;
    diagCount('trimCount');
    // 通知调用方丢弃已发生（见构造 opts.onTrim doc）。回调异常不得污染 push 路径。
    if (this._onTrim) {
      try { this._onTrim(); } catch { }
    }
  }

  _schedule() {
    if (this._rafId || this._unmounted) return;
    this._rafId = requestAnimationFrame(() => this._flush());
  }

  _flush() {
    this._rafId = 0;
    if (this._unmounted) return;
    const term = this._getTerminal();
    if (!term) return;

    // 软背压：xterm 内未消化字节超 2×chunk 时跳过本帧（仍续约 rAF，队列不滞留）。
    // 仅在本 epoch 观察到 callback 正常回调后启用（mock/不回调的终端零变化）；
    // callback 失联超 CB_FAIL_OPEN_MS 即清账恢复写——只 fail-open 不 fail-closed。
    if (this._cbSeen && this._outstanding > 2 * this._chunkSize) {
      if (now() - this._lastWriteSentAt > CB_FAIL_OPEN_MS) {
        this._outstanding = 0;
        this._fastStreak = 0;
      } else {
        if (this._head < this._queue.length) this._schedule();
        return;
      }
    }

    // 积压丢弃过：先写提示行（独立于下方 out 的回滚语义；写失败保留标记下帧重试）
    if (this._trimmedSinceFlush) {
      try {
        term.write(TRIM_NOTICE);
        this._trimmedSinceFlush = false;
      } catch { /* 与下方 write 同等容错 */ }
    }

    // 取出最多 _chunkSize 字符到 out。每帧仅一次 write，节奏与原实现等价。
    // 指针快照须在消费循环**之前**（原实现误在循环后快照，write 抛错时恢复的是
    // 消费后指针 = 该 chunk 静默丢失，与下方注释的回滚契约相反——已修正）。
    const headBefore = this._head;
    const offsetBefore = this._offset;
    const CHUNK = this._chunkSize;
    let out = '';
    while (this._head < this._queue.length && out.length < CHUNK) {
      const head = this._queue[this._head];
      const offset = this._offset;
      const remaining = head.length - offset;
      const need = CHUNK - out.length;
      if (need <= 0) break;

      if (remaining <= need) {
        // 整段消费 head
        out += offset === 0 ? head : head.slice(offset);
        this._head++;
        this._offset = 0;
      } else {
        // 部分消费：从 offset 切出 need 字符
        let cut = offset + need;
        // UTF-16 surrogate 守卫：若末位是高代理，要么回退 1（下轮带出整对），
        // 要么前进 1（仅 1 char 时把整对带出，轻微超 CHUNK_SIZE）。
        const codeAtEnd = head.charCodeAt(cut - 1);
        if (codeAtEnd >= 0xD800 && codeAtEnd <= 0xDBFF) {
          if (cut - 1 > offset) {
            cut--;                      // 正常回退
          } else if (cut < head.length) {
            cut++;                      // 仅 1 char 高代理 → 前进带出整对
          }
          // else: head 末位的孤立高代理（数据本身坏的）→ 照原样发，xterm 会容错显示
        }
        out += head.slice(offset, cut);
        this._offset = cut;
      }
    }

    if (!out) return;

    // try/catch + 回滚：xterm.write 同步抛错时停续约 rAF 防死循环。
    // 数据保留语义：head/offset 是逻辑指针，queue 项本身没被 splice，
    // 回滚到 write 之前就能让下次 _flush 重新组装相同的 out 重试。
    // GC 在 write 成功后才执行（见下方），确保失败回滚永远有效。
    const epoch = this._epoch;
    const sentAt = now();
    this._outstanding += out.length;
    this._lastWriteSentAt = sentAt;
    try {
      // callback 仅做计时与记账（AIMD 输入），写出本身从不等待它
      term.write(out, () => {
        if (epoch !== this._epoch) return; // reset/dispose 后旧回调 → 丢弃防串台
        this._cbSeen = true;
        this._outstanding = Math.max(0, this._outstanding - out.length);
        this._adapt(now() - sentAt);
      });
    } catch {
      // 双向记账守恒：成功路径由 callback 减账，失败路径在此立即回滚——
      // 任何分支下 outstanding ≥0 且不累积。抛错后有意**不**续约 rAF
      // （write 持续抛时 rAF 会 60fps 空转），数据保留在队列，下次 push 重触发。
      this._head = headBefore;
      this._offset = offsetBefore;
      this._outstanding = Math.max(0, this._outstanding - out.length);
      return;
    }

    // 周期压缩 queue：write 成功后才 GC，避免 splice 已消费部分破坏失败回滚的有效性。
    // head 索引超 GC_THRESHOLD_HEAD / 头部已消费比例高时一次性回收。
    // （head++ 后 offset 必为 0，slice 后头部对齐到当前 head 的实际位置 0，
    //   不会破坏 _offset 与 head 的语义对应。）
    if (
      this._head > GC_THRESHOLD_HEAD ||
      (this._head > GC_RATIO_MIN_HEAD && this._head * GC_CONSUMED_RATIO > this._queue.length)
    ) {
      this._queue = this._queue.slice(this._head);
      this._head = 0;
    }

    if (this._head < this._queue.length) this._schedule();
  }

  /**
   * 同步排空（unmount 前调用，防最后 16ms 数据丢失）。
   * 只 write 一次合并 buffer，失败静默吞掉（已经在 unmount 路径上）。
   */
  drain() {
    if (this._unmounted) return;
    const term = this._getTerminal();
    if (!term) return;
    // trim 后 rAF 尚未跑就 unmount：提示行也要随排空写出，不静默吞掉
    if (this._trimmedSinceFlush) {
      this._trimmedSinceFlush = false;
      try { term.write(TRIM_NOTICE); } catch { /* unmount 路径，吞掉 */ }
    }
    if (this._head >= this._queue.length) return;
    let out = '';
    while (this._head < this._queue.length) {
      const head = this._queue[this._head];
      out += this._offset === 0 ? head : head.slice(this._offset);
      this._head++;
      this._offset = 0;
    }
    if (out) {
      try { term.write(out); } catch { /* unmount 路径，吞掉 */ }
    }
  }

  /**
   * 清空队列但保持可用（服务端 data-resync 对齐时用，区别于 dispose 的终态）。
   * epoch++ 丢弃在途旧 write callback（terminal.reset 不清 xterm WriteBuffer）；
   * chunk 复位到构造初值（保留平台保守初值：Windows 16KB / 其余 32KB——
   * 快机 resync 后快照重放不必从 4KB 爬坡，慢机由 AIMD 重新收敛）；取消在途 rAF。
   */
  reset() {
    if (this._unmounted) return;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = 0;
    }
    this._queue.length = 0;
    this._head = 0;
    this._offset = 0;
    this._trimmedSinceFlush = false;
    this._epoch++;
    this._outstanding = 0;
    this._cbSeen = false;
    this._fastStreak = 0;
    this._chunkSize = this._initialChunk;
  }

  /**
   * 释放资源。dispose 后 push 静默忽略，rAF 取消，在途 callback 按 epoch 丢弃。
   */
  dispose() {
    this._unmounted = true;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = 0;
    }
    this._queue.length = 0;
    this._head = 0;
    this._offset = 0;
    this._epoch++;
    this._outstanding = 0;
  }

  /** 测试用 —— 返回当前队列剩余字节数 */
  _pendingBytes() {
    let total = 0;
    for (let i = this._head; i < this._queue.length; i++) {
      total += this._queue[i].length;
    }
    return total - this._offset;
  }
}

// 暴露常量给测试 / 外部参考（不要在生产代码读这些，行为是不变的契约）
TerminalWriteQueue.CHUNK_SIZE = CHUNK_SIZE;
TerminalWriteQueue.CHUNK_MIN = CHUNK_MIN;
TerminalWriteQueue.GC_THRESHOLD_HEAD = GC_THRESHOLD_HEAD;
TerminalWriteQueue.HIGH_WATER_BYTES = HIGH_WATER_BYTES;
TerminalWriteQueue.TRIM_TARGET_BYTES = TRIM_TARGET_BYTES;
TerminalWriteQueue.TRIM_NOTICE = TRIM_NOTICE;
TerminalWriteQueue.CB_FAIL_OPEN_MS = CB_FAIL_OPEN_MS;
