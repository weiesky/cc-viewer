/**
 * WebSocket per-client 反压闸门（Windows ConPTY 洪泛防卡死，server 侧第一道闸）。
 *
 * 背景：node-pty 在 Windows 经 ConPTY 把 TUI 输出转译成全屏重绘序列，字节量可达
 * macOS forkpty 透传的 10~100 倍。onPtyData → ws.send 若不检查 ws.bufferedAmount，
 * 慢客户端的写缓冲会无限堆积（server 内存膨胀），且数据到前端也只是堆进写队列
 * 被丢弃。这里按 VS Code terminal / xterm.js flow-control 指南的思路做停发-追赶：
 *
 *   - offer()：每条 data 调用。bufferedAmount 越过 highWater → 进入 behind 态，
 *     返回 false（调用方跳发该条）；期间 pollMs 轮询 bufferedAmount。
 *   - 降回 lowWater 以下 → 退出 behind，调 onResume()（调用方发 data-resync +
 *     outputBuffer 快照让前端一步对齐，无需补发洪泛期间的全部数据）。
 *   - behind 持续超 timeoutMs（客户端网络硬断时 TCP close 可能数分钟后才到，
 *     bufferedAmount 永不下降）→ 调 onTimeout()（调用方 ws.terminate()，前端
 *     自动重连走全量 replay 恢复），并自行 dispose。
 *   - 高/低水位形成迟滞带，防止在阈值附近反复开关。
 *
 * 纯逻辑、零 ws 依赖（bufferedAmount 由 getter 注入），便于单测。
 */

const DEFAULT_HIGH_WATER = 1024 * 1024;  // 写缓冲超 1MB：客户端已明显消费不动
const DEFAULT_LOW_WATER = 256 * 1024;    // 降回 256KB 以下才恢复（迟滞带）
const DEFAULT_POLL_MS = 100;             // behind 期间轮询间隔，对终端延迟无感
const DEFAULT_TIMEOUT_MS = 60000;        // behind 超时：判定客户端死连接

/**
 * @param {object} opts
 * @param {() => number} opts.getBufferedAmount - 返回当前 ws.bufferedAmount
 * @param {(buffered: number) => void} opts.onResume - 退出 behind 时回调（发 data-resync）
 * @param {(buffered: number) => void} [opts.onBehind] - 进入 behind 时回调（observability 埋点）
 * @param {(buffered: number) => void} [opts.onTimeout] - behind 超时回调（建议 ws.terminate()）
 * @param {number} [opts.highWater]
 * @param {number} [opts.lowWater]
 * @param {number} [opts.pollMs]
 * @param {number} [opts.timeoutMs]
 * @returns {{ offer: () => boolean, isBehind: () => boolean, dispose: () => void }}
 */
export function createBackpressureGate({
  getBufferedAmount,
  onResume,
  onBehind,
  onTimeout,
  highWater = DEFAULT_HIGH_WATER,
  lowWater = DEFAULT_LOW_WATER,
  pollMs = DEFAULT_POLL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  let behind = false;
  let pollTimer = null;
  let behindSince = 0;
  let disposed = false;

  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const poll = () => {
    if (disposed) return;
    let buffered = 0;
    // poll 在 behind 中：读取失败按"未排空"保守处理（继续 hold，最终走超时断连）；
    // offer 在正常态：读取失败按 0 乐观放行（不因瞬时读取失败误杀活跃连接）。方向刻意相反。
    try { buffered = getBufferedAmount(); } catch { buffered = Infinity; }
    if (buffered <= lowWater) {
      behind = false;
      stopPolling();
      try { onResume(buffered); } catch {}
      return;
    }
    if (Date.now() - behindSince >= timeoutMs) {
      stopPolling();
      disposed = true;
      try { onTimeout?.(buffered); } catch {}
    }
  };

  return {
    /** 每条 data 调用：true = 可发；false = 跳发（behind 中） */
    offer() {
      if (disposed) return false;
      if (behind) return false;
      let buffered = 0;
      try { buffered = getBufferedAmount(); } catch { buffered = 0; }
      if (buffered > highWater) {
        behind = true;
        behindSince = Date.now();
        pollTimer = setInterval(poll, pollMs);
        // 进程退出不被轮询拖住（与 server.js 其余 interval 的 unref 约定一致）
        pollTimer.unref?.();
        try { onBehind?.(buffered); } catch {}
        return false;
      }
      return true;
    },
    isBehind() {
      return behind;
    },
    /** ws close 时调用，清掉轮询 interval */
    dispose() {
      disposed = true;
      stopPolling();
    },
  };
}
