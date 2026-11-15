/**
 * ws-mux 背压泵单测 —— 2026-11 背压重构（自包含 pump 替代共享 gate）。
 *
 * 覆盖 ws-mux.js 的新状态机（packages/app/server/lib/ws-mux.js 头部"Backpressure"块）：
 *   - sticky-behind 回归：队列排空后无 gate poll 时，后续写入仍会驱动 pump 并发 drain
 *   - 无 gate resume 也会 drain（pump 是唯一驱动）
 *   - lost-wakeup：write 后同 tick 附着的 awaitDrain 不会错过 drain
 *   - F1 看门狗：ws.send 成功不算进展 —— buffered 不降的卡死客户端 ~30s 被 1011 杀
 *   - F2 drain 时机：buffered > HIGH 顶点拥堵期不发 drain（防生产者回灌队列）
 *   - 进度感知：buffered 持续下降不杀；冻结后才杀
 *   - 有界冲刷：每 tick ≤ FLUSH_BUDGET、FIFO 保序；单帧 > FLUSH_BUDGET 也逐帧发出
 *   - 控制绕行：ping/pong/open-ack 越过排队数据帧
 *   - 字节核算：多字节内容按 Buffer.byteLength 计入 queuedBytes
 *   - teardown：重置 _behind/queue/queuedBytes，不留 pump timer
 *   - 心跳 reap 容错：inbound 静默但 buffered 在降 → 不 reap
 *
 * 关键：FakeWs.send 按发送字节增长 bufferedAmount（由驱动函数排空），否则复现不了
 * sticky 状态，也测不了看门狗的"进展 = buffered 下降"语义。
 */
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  encodeFrame,
  createStreamMuxServer,
  WS_MUX_PUMP_MS,
  WS_MUX_FLUSH_BUDGET_BYTES,
  WS_MUX_STALL_MS,
} from '../server/lib/ws-mux.js';

const HIGH_WATER = 1024 * 1024;

// ── fakes ────────────────────────────────────────────────────────────────────

/**
 * A fake ws whose send() APPENDS to bufferedAmount (like a real socket whose kernel
 * buffer is not draining). The test drives drainage by lowering bufferedAmount and
 * ticking the pump. This is what lets us reproduce the wedged-client state.
 */
class FakeWs extends EventEmitter {
  constructor() {
    super();
    this.readyState = 1;
    this.bufferedAmount = 0;
    this.sent = [];                  // decoded frames handed to ws.send
    this.closedWith = null;
  }
  send(text) { this.sent.push(JSON.parse(text)); this.bufferedAmount += Buffer.byteLength(text, 'utf8'); }
  close(code, reason) { this.readyState = 3; this.closedWith = { code, reason }; this.emit('close'); }
  receive(obj) { this.emit('message', typeof obj === 'string' ? obj : encodeFrame(obj)); }
  // test helper: drain n bytes from the kernel buffer (client consumed them)
  drain(n) { this.bufferedAmount = Math.max(0, this.bufferedAmount - n); }
}

class FakeWss extends EventEmitter {
  constructor() { super(); this.closed = false; }
  close() { this.closed = true; }
}

function makeServer(over = {}) {
  const wss = new FakeWss();
  const reports = [];
  const mux = createStreamMuxServer({
    WebSocketServer: function () { return wss; },
    serveStream: over.serveStream || ((sink) => { over._capture && over._capture(sink); return { dispose() {} }; }),
    reportSwallowed: (tag, err, extra) => reports.push({ tag, err, extra }),
    ...over,
  });
  return { mux, wss, reports };
}

const dataFrames = (ws) => ws.sent.filter((f) => f.type === 'frame');

describe('ws-mux backpressure pump', { concurrency: false }, () => {
  beforeEach(() => { mock.timers.enable({ apis: ['setInterval', 'Date'] }); });
  afterEach(() => { mock.timers.reset(); });

  function serverWithSink() {
    let sink = null;
    const m = makeServer({ serveStream: (s) => { sink = s; return { dispose() {} }; } });
    return { m, getSink: () => sink };
  }
  function connectCaptured(mux) {
    const ws = new FakeWs();
    mux._server.emit('connection', ws, {});
    ws.receive({ type: 'open', streamId: 's1', qs: '' });
    return ws;
  }

  it('sticky-behind regression: queue drains and drain fires even after the gate would have stopped polling', () => {
    const { m, getSink } = serverWithSink();
    const ws = connectCaptured(m.mux);
    const sink = getSink();
    ws.bufferedAmount = 5 * 1024 * 1024;      // > HIGH → behind, frames queue
    sink.write('data: {"n":1}\n\n');
    sink.write('data: {"n":2}\n\n');
    assert.equal(dataFrames(ws).length, 0, 'queued while behind');
    let drains = 0;
    sink.on('drain', () => drains++);
    // Client drains fully; the pump flushes and (queue empty + buffered<=LOW) exits behind.
    ws.bufferedAmount = 0;
    mock.timers.tick(WS_MUX_PUMP_MS);
    mock.timers.tick(WS_MUX_PUMP_MS);
    assert.deepEqual(dataFrames(ws).map((f) => f.data), ['{"n":1}', '{"n":2}'], 'flushed FIFO');
    assert.ok(drains >= 1, 'drain fired without any gate resume');
    // A subsequent write must go out synchronously (not re-queue): behind was cleared.
    sink.write('data: {"n":3}\n\n');
    assert.equal(dataFrames(ws).length, 3, 'post-drain write is synchronous (behind cleared)');
    m.mux.close();
  });

  it('lost-wakeup: awaitDrain attached AFTER a pressured write still resolves', async () => {
    const { m, getSink } = serverWithSink();
    const ws = connectCaptured(m.mux);
    const sink = getSink();
    ws.bufferedAmount = 5 * 1024 * 1024;
    sink.write('data: {"n":1}\n\n');            // queues → behind
    // Attach the waiter in the SAME tick (after the write returned false).
    const p = sink.awaitDrain();
    let resolved = false;
    p.then(() => { resolved = true; });
    await Promise.resolve();
    assert.equal(resolved, false, 'not resolved before any drain');
    ws.bufferedAmount = 0;                       // client drains
    mock.timers.tick(WS_MUX_PUMP_MS);            // pump flushes + emits drain
    await p;                                     // must resolve, not hang 30s
    assert.equal(resolved, true);
    m.mux.close();
  });

  it('F1 watchdog: a wedged client (buffered never drops) is killed ~STALL_MS even while pings bypass', () => {
    const { m, getSink } = serverWithSink();
    const ws = connectCaptured(m.mux);
    const sink = getSink();
    ws.bufferedAmount = 5 * 1024 * 1024;
    sink.write('data: {"n":1}\n\n');            // queued, behind
    // Freeze: the client never drains. Ping timer fires (bypasses queue) but must NOT
    // count as progress. Tick past the stall window.
    ws.bufferedAmount = 5 * 1024 * 1024;        // stays pinned (send() re-adds, we re-pin)
    for (let t = 0; t < WS_MUX_STALL_MS + 2 * WS_MUX_PUMP_MS; t += WS_MUX_PUMP_MS) {
      ws.bufferedAmount = Math.max(ws.bufferedAmount, 1024 * 1024); // never drains below HIGH
      mock.timers.tick(WS_MUX_PUMP_MS);
    }
    assert.ok(ws.closedWith, 'wedged socket closed');
    assert.equal(ws.closedWith.code, 1011);
    assert.match(ws.closedWith.reason, /backpressure-timeout/);
    m.mux.close();
  });

  it('progress-aware: a slow-but-draining client is NOT killed; freezing afterward IS killed', () => {
    const { m, getSink } = serverWithSink();
    const ws = connectCaptured(m.mux);
    const sink = getSink();
    // Slow-but-alive client behind: keep the queue non-empty (steady producer) while the
    // socket makes steady byte progress. The pump must never kill a draining client.
    ws.bufferedAmount = HIGH_WATER + 512 * 1024;
    for (let t = 0; t < 45_000; t += WS_MUX_PUMP_MS) {
      sink.write('data: {"n":2}\n\n');           // steady producer keeps the queue fed
      ws.drain(4 * 1024);                         // steady byte progress (buffered declines)
      ws.bufferedAmount = Math.max(ws.bufferedAmount, 512 * 1024); // hold a modest wedge
      mock.timers.tick(WS_MUX_PUMP_MS);
      assert.equal(ws.closedWith, null, `alive while draining (t=${t})`);
    }
    // Client freezes: producer stops, buffered pinned high, queue stuck → stall kill.
    for (let t = 0; t < WS_MUX_STALL_MS + 2 * WS_MUX_PUMP_MS; t += WS_MUX_PUMP_MS) {
      ws.bufferedAmount = Math.max(ws.bufferedAmount, HIGH_WATER + 1); // no byte progress
      mock.timers.tick(WS_MUX_PUMP_MS);
      if (ws.closedWith) break;
    }
    assert.ok(ws.closedWith, 'frozen client killed after progress stops');
    assert.equal(ws.closedWith.code, 1011);
    assert.match(ws.closedWith.reason, /backpressure-timeout/);
    m.mux.close();
  });

  it('bounded flush: each tick sends at most FLUSH_BUDGET (after a guaranteed first frame), FIFO order', () => {
    const { m, getSink } = serverWithSink();
    const ws = connectCaptured(m.mux);
    const sink = getSink();
    ws.bufferedAmount = 5 * 1024 * 1024;        // behind
    const chunk = 'x'.repeat(1024 * 1024);       // 1MiB frames
    for (let i = 0; i < 8; i++) sink.write(`data: ${chunk}\n\n`);
    assert.equal(dataFrames(ws).length, 0, 'all queued');
    ws.bufferedAmount = 0;                        // full headroom now
    // First tick: pump drains buffered→0, so it flushes up to the budget (4MiB) per tick.
    mock.timers.tick(WS_MUX_PUMP_MS);
    const afterFirst = dataFrames(ws).length;
    assert.ok(afterFirst > 0 && afterFirst < 8, `partial flush per tick (got ${afterFirst})`);
    // Keep ticking with a draining client until all 8 arrive, in order.
    let guard = 0;
    while (dataFrames(ws).length < 8 && guard++ < 20) { ws.drain(1024 * 1024 * 8); mock.timers.tick(WS_MUX_PUMP_MS); }
    assert.equal(dataFrames(ws).length, 8, 'all frames eventually delivered');
    const seqs = dataFrames(ws).map((f) => f.seq);
    assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), 'seq strictly increasing (FIFO)');
    m.mux.close();
  });

  it('a single frame larger than FLUSH_BUDGET is still sent (one frame per tick, never deadlocks)', () => {
    const { m, getSink } = serverWithSink();
    const ws = connectCaptured(m.mux);
    const sink = getSink();
    ws.bufferedAmount = 5 * 1024 * 1024;
    const big = 'y'.repeat(WS_MUX_FLUSH_BUDGET_BYTES + 1024 * 1024); // > budget
    sink.write(`data: ${big}\n\n`);
    assert.equal(dataFrames(ws).length, 0);
    ws.bufferedAmount = 0;
    mock.timers.tick(WS_MUX_PUMP_MS);
    assert.equal(dataFrames(ws).length, 1, 'oversized frame sent on its own tick');
    assert.ok(!ws.closedWith, 'no deadlock / no overflow close for a single big frame under the cap');
    m.mux.close();
  });

  it('control frames bypass the data queue: ping/pong/open-ack arrive while data is queued', () => {
    const { m, getSink } = serverWithSink();
    const ws = connectCaptured(m.mux);
    const sink = getSink();
    ws.bufferedAmount = 5 * 1024 * 1024;
    sink.write('data: {"n":1}\n\n');            // queued behind
    assert.equal(dataFrames(ws).length, 0);
    // client ping → server pong must go out immediately despite the queued data frame.
    ws.receive({ type: 'ping', ts: 123 });
    assert.ok(ws.sent.some((f) => f.type === 'pong'), 'pong bypasses the queue');
    // a second stream opened while behind gets its open-ack immediately.
    ws.receive({ type: 'open', streamId: 's2', qs: '' });
    assert.ok(ws.sent.some((f) => f.type === 'open-ack' && f.streamId === 's2'), 'open-ack bypasses the queue');
    // data frame still queued (not lost).
    assert.equal(dataFrames(ws).length, 0, 'data frame remains queued (order preserved)');
    m.mux.close();
  });

  it('queue accounting uses real UTF-8 bytes (multi-byte CJK counts 3x its char length)', () => {
    const { m, getSink } = serverWithSink();
    const ws = connectCaptured(m.mux);
    const sink = getSink();
    ws.bufferedAmount = 5 * 1024 * 1024;
    sink.write('data: "中"\n\n');               // 中 = 3 UTF-8 bytes, 1 UTF-16 unit
    const st = [...m.mux._sockets][0];
    const frameText = encodeFrame({ type: 'frame', streamId: 's1', seq: 1, name: null, data: '"中"' });
    assert.equal(st.queuedBytes, Buffer.byteLength(frameText, 'utf8'), 'queuedBytes in bytes, not chars');
    assert.ok(st.queuedBytes > frameText.length, 'byteLength > UTF-16 length for CJK');
    m.mux.close();
  });

  it('teardown resets backpressure state: needsDrain() goes false and no pump timer survives', () => {
    const { m, getSink } = serverWithSink();
    const ws = connectCaptured(m.mux);
    const sink = getSink();
    ws.bufferedAmount = 5 * 1024 * 1024;
    sink.write('data: {"n":1}\n\n');
    const st = [...m.mux._sockets][0];
    assert.ok(st._behind && st.pumpTimer, 'behind + pump armed while queued');
    ws.close(1001, 'gone');                      // triggers teardown
    assert.equal(st._behind, false);
    assert.equal(st.queuedBytes, 0);
    assert.equal(st.queue.length, 0);
    assert.equal(st.pumpTimer, null, 'pump timer cleared on teardown');
    assert.equal(sink.needsDrain(), false, 'needsDrain false after teardown');
    m.mux.close();
  });

  it('pump invariant: _behind ⇒ pumpTimer armed; after exit ⇒ not behind + empty queue + zero bytes', () => {
    const { m, getSink } = serverWithSink();
    const ws = connectCaptured(m.mux);
    const sink = getSink();
    ws.bufferedAmount = 5 * 1024 * 1024;
    sink.write('data: {"n":1}\n\n');
    const st = [...m.mux._sockets][0];
    assert.ok(st._behind, 'behind');
    assert.ok(st.pumpTimer, 'pump armed while behind');
    ws.bufferedAmount = 0;
    mock.timers.tick(WS_MUX_PUMP_MS);
    mock.timers.tick(WS_MUX_PUMP_MS);
    assert.equal(st._behind, false, 'exited behind after full drain');
    assert.equal(st.queue.length, 0);
    assert.equal(st.queuedBytes, 0);
    assert.equal(st.pumpTimer, null, 'pump disarmed after exit');
    m.mux.close();
  });

  it('heartbeat reap tolerates outbound progress: inbound-silent but draining socket is NOT reaped', () => {
    const { m, getSink } = serverWithSink();
    const ws = connectCaptured(m.mux);
    const sink = getSink();
    // Make inbound stale beyond the reap window, but keep the socket draining.
    const st = [...m.mux._sockets][0];
    ws.bufferedAmount = 5 * 1024 * 1024;
    sink.write('data: {"n":1}\n\n');
    // Simulate: no inbound frames for > 60s, but buffered keeps dropping (progress).
    st.lastInboundAt = st.lastInboundAt - 70_000; // force stale inbound
    for (let t = 0; t < 30_000; t += 25_000) {   // ping timer cadence is 25s
      ws.drain(256 * 1024);                       // outbound progress
      mock.timers.tick(25_000);
      assert.equal(ws.closedWith, null, 'not reaped while draining (outbound progress)');
    }
    m.mux.close();
  });

  it('F2 drain timing: while peak-congested (> HIGH) a drain is NOT emitted (producers must not reflood)', () => {
    const { m, getSink } = serverWithSink();
    const ws = connectCaptured(m.mux);
    const sink = getSink();
    ws.bufferedAmount = 5 * 1024 * 1024;         // way over HIGH
    sink.write('data: {"n":1}\n\n');
    let drains = 0;
    sink.on('drain', () => drains++);
    // Still over HIGH but falling a little each tick (some progress) — drain must NOT fire
    // until buffered is back at/below HIGH (headroom), else woken producers reflood.
    ws.bufferedAmount = 4 * 1024 * 1024;         // fell, but still > HIGH (1MiB)
    mock.timers.tick(WS_MUX_PUMP_MS);
    assert.equal(drains, 0, 'no drain while still over HIGH_WATER');
    ws.bufferedAmount = 512 * 1024;              // now ≤ HIGH and falling → headroom → drain
    mock.timers.tick(WS_MUX_PUMP_MS);
    assert.ok(drains >= 1, 'drain fires once there is real headroom');
    m.mux.close();
  });

  // Regression for the "progress measured AFTER the pump's own send" bug: with a continuously
  // non-empty queue, the flush refills the socket buffer to ~HIGH every tick, so a post-send
  // level sample never declines and a steadily-draining client would be false-killed. Progress
  // must be "the pump dequeued bytes this tick", not "the level dropped".
  it('a steadily-draining client with a continuously-fed queue is NEVER killed (progress = dequeued bytes)', () => {
    const { m, getSink } = serverWithSink();
    const ws = connectCaptured(m.mux);
    const sink = getSink();
    ws.bufferedAmount = HIGH_WATER + 256 * 1024;   // behind
    // Keep the queue non-empty (steady producer) and the client steadily draining so the
    // socket buffer hovers at/above HIGH — the pump dequeues every tick.
    for (let t = 0; t < 90_000; t += WS_MUX_PUMP_MS) {   // > 2×STALL_MS (the absolute ceiling)
      sink.write('data: {"n":2}\n\n');                    // keep the queue fed
      // Client drains enough each tick to stay just under/at HIGH after the pump refills.
      ws.bufferedAmount = HIGH_WATER;                     // pinned at the high-water mark (full buffer)
      mock.timers.tick(WS_MUX_PUMP_MS);
      assert.equal(ws.closedWith, null, `healthy draining client must not be killed (t=${t})`);
    }
    m.mux.close();
  });

  // Regression for "heartbeat clobbers lastBuffered → the pump's final drain is skipped →
  // lost wakeup". After the fix the pump's full-drain branch fires drain UNCONDITIONALLY, and
  // the ping timer no longer writes st.lastBuffered, so a waiter always wakes.
  it('no lost wakeup: a waiter entered mid-band is woken when the socket fully drains (drain fires unconditionally)', async () => {
    const { m, getSink } = serverWithSink();
    const ws = connectCaptured(m.mux);
    const sink = getSink();
    ws.bufferedAmount = HIGH_WATER + 256 * 1024;   // behind
    sink.write('data: {"n":1}\n\n');               // queued
    const p = sink.awaitDrain();
    let resolved = false;
    p.then(() => { resolved = true; });
    // Client drains the socket all the way to 0 in one step; the pump flushes the queued frame
    // (its send raises buffered), then on a later tick sees queue empty + buffered <= LOW and
    // must fire drain regardless of any intervening heartbeat sample.
    ws.bufferedAmount = 0;
    mock.timers.tick(WS_MUX_PUMP_MS);
    mock.timers.tick(WS_MUX_PUMP_MS);
    mock.timers.tick(WS_MUX_PUMP_MS);
    await p;
    assert.equal(resolved, true, 'waiter woken after full drain (no lost wakeup)');
    m.mux.close();
  });
});
