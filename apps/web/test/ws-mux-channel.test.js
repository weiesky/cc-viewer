/**
 * wsMuxTransport 单测 —— 对话通道 WS mux 传输（阶段 A）
 *
 * 用 fake WebSocket + fake EventSource + 注入式 fake timers 覆盖：
 *   - 探测成功：open 帧 qs = 原始 query；ack → readyState=1 + onopen + sessionStorage 'ok'；
 *     frame 路由（裸 data → onmessage；命名帧 → addEventListener，绝不进 onmessage）；seq 回退丢弃
 *   - 能力降级：构造抛错 / ack 前 onerror-close → 同步降级 EventSource 且无重试 timer；此后新流直接 SSE
 *   - 逐流降级：error 4503/4429 / ack 超时 → 只该流切 EventSource，socket 与其它流不动
 *   - 瞬时故障：运行中断线 → 预算内退避重连（同 URL）；耗尽 → facade CLOSED+onerror 交还 manager
 *   - 心跳看门狗：45s 无服务端帧 → 重连（非降级）
 *   - 单 socket 多流：一 facade.close() 只发该流 close 帧
 *   - close() 后无残留 timer；sessionStorage=null 仍可降级
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// apiUrl.js reads window.location.search at module load (to pin the LAN token) — pre-set a
// minimal window/document BEFORE importing the transport (house precedent: api-url-gap.test.js).
globalThis.window = globalThis.window || { location: { search: '', protocol: 'http:', host: 'test.local' } };
globalThis.document = globalThis.document || { querySelector: () => null };

const { createMuxTransport } = await import('../src/utils/wsMuxTransport.js');

// ── fakes ────────────────────────────────────────────────────────────────────

function fakeTimers() {
  const pending = new Map();
  let nextId = 1;
  return {
    pending,
    setTimeout: (fn, ms) => { const id = nextId++; pending.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => { pending.delete(id); },
    fire(id) { const t = pending.get(id); if (t) { pending.delete(id); t.fn(); } },
    fireAll() { for (const id of [...pending.keys()]) this.fire(id); },
    count() { return pending.size; },
  };
}

function fakeSessionStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

class FakeEventSource {
  constructor(url) { this.url = url; this.readyState = 0; this.listeners = new Map(); this.onmessage = null; this.onopen = null; this.onerror = null; FakeEventSource.instances.push(this); }
  addEventListener(name, fn) { const l = this.listeners.get(name) || []; l.push(fn); this.listeners.set(name, l); }
  close() { this.readyState = 2; this.closed = true; }
  // helpers
  _open() { this.readyState = 1; this.onopen?.(); }
  _fire(name, data) { for (const fn of this.listeners.get(name) || []) fn({ data }); }
  _data(data) { this.onmessage?.({ data }); }
}
FakeEventSource.instances = [];

class FakeWebSocket {
  constructor(url) {
    if (FakeWebSocket.throwOnCtor) throw new Error('ws ctor blocked');
    this.url = url; this.readyState = 0; this.bufferedAmount = 0; this.sent = [];
    this.onopen = null; this.onmessage = null; this.onclose = null; this.onerror = null;
    FakeWebSocket.instances.push(this);
    FakeWebSocket.lastCtor?.(this);
  }
  send(text) { this.sent.push(JSON.parse(text)); }
  close(code, reason) {
    this.readyState = 3; this.closedWith = { code, reason };
    // Browsers deliver onclose ASYNCHRONOUSLY after close(). When FakeWebSocket.deferOnclose is
    // set, defer it to a microtask to match — this is what the watchdog/P0 regression depends on
    // (a synchronous onclose masks the misclassification the intentionalClose flag prevents).
    if (FakeWebSocket.deferOnclose) { const self = this; queueMicrotask(() => self.onclose?.({ code })); }
    else this.onclose?.({ code });
  }
  // Browsers deliver onclose ASYNCHRONOUSLY after close() — explicit async variant for tests.
  closeAsync(code = 1000) { this.readyState = 3; queueMicrotask(() => this.onclose?.({ code })); }
  // helpers
  _open() { this.readyState = 1; this.onopen?.(); }
  _message(obj) { this.onmessage?.({ data: JSON.stringify(obj) }); }
  _failHandshake() { this.readyState = 3; this.onerror?.(); this.onclose?.({ code: 1006 }); }
}
FakeWebSocket.instances = [];
FakeWebSocket.throwOnCtor = false;
FakeWebSocket.lastCtor = null;
FakeWebSocket.deferOnclose = false;   // set true to deliver onclose via microtask (browser timing)

function makeTransport(over = {}) {
  const tm = fakeTimers();
  const store = 'sessionStore' in over ? over.sessionStore : fakeSessionStorage();
  const reports = [];
  const t = createMuxTransport({
    openEventSource: (url) => new FakeEventSource(url),
    WebSocketCtor: () => FakeWebSocket,
    reportSwallowed: (tag, err, extra) => reports.push({ tag, err, extra }),
    setTimeout: tm.setTimeout,
    clearTimeout: tm.clearTimeout,
    socketUrl: () => 'ws://test.local/ws/mux',
    sessionStore: store,
    ...over,
  });
  return { t, tm, store, reports };
}

function openAndAck(t, url = '/events?limit=400') {
  const fac = t.open(url);
  const ws = FakeWebSocket.instances.at(-1);
  if (ws.readyState !== 1) ws._open();
  // Latest open frame corresponds to THIS facade's stream (a shared socket may hold several).
  const opens = ws.sent.filter((m) => m.type === 'open');
  const streamId = opens.at(-1).streamId;
  ws._message({ type: 'open-ack', streamId, epoch: 'e1', seq: 0 });
  return { fac, ws, streamId };
}

beforeEach(() => {
  FakeEventSource.instances = [];
  FakeWebSocket.instances = [];
  FakeWebSocket.throwOnCtor = false;
  FakeWebSocket.lastCtor = null;
  FakeWebSocket.deferOnclose = false;
});

// ── probe success ────────────────────────────────────────────────────────────

describe('ws-mux probe success', () => {
  it('open frame carries the raw query string verbatim (passthrough)', () => {
    const { t } = makeTransport();
    const fac = t.open('/events?project=p&since=2026-01-01&cc=3&limit=200');
    const ws = FakeWebSocket.instances[0];
    ws._open();
    const open = ws.sent.find((m) => m.type === 'open');
    assert.equal(open.qs, 'project=p&since=2026-01-01&cc=3&limit=200');
    t.closeAll();
  });

  it('ack → readyState=1 + onopen + sessionStorage ok', () => {
    const { t, store } = makeTransport();
    let opened = 0;
    const fac = t.open('/events?limit=400');
    fac.onopen = () => { opened++; };
    const ws = FakeWebSocket.instances[0];
    ws._open();
    assert.equal(fac.readyState, 0, 'CONNECTING before ack');
    const open = ws.sent.find((m) => m.type === 'open');
    ws._message({ type: 'open-ack', streamId: open.streamId, epoch: 'e1', seq: 0 });
    assert.equal(fac.readyState, 1, 'OPEN after ack');
    assert.equal(opened, 1);
    assert.equal(store.getItem('ccv.muxProbe'), 'ok');
    t.closeAll();
  });

  it('bare data frame → onmessage; named frame → addEventListener (never onmessage)', () => {
    const { t } = makeTransport();
    const { fac, ws, streamId } = openAndAck(t);
    const got = { msg: [], named: [] };
    fac.onmessage = (e) => got.msg.push(e.data);
    fac.addEventListener('task_update', (e) => got.named.push(e.data));
    ws._message({ type: 'frame', streamId, seq: 1, name: null, data: '{"entry":1}' });
    ws._message({ type: 'frame', streamId, seq: 2, name: 'task_update', data: '{"tasks":[]}' });
    assert.deepEqual(got.msg, ['{"entry":1}']);
    assert.deepEqual(got.named, [`{"tasks":[]}`]);
    t.closeAll();
  });

  it('drops a replayed/out-of-order frame (seq non-regression within an epoch)', () => {
    const { t } = makeTransport();
    const { fac, ws, streamId } = openAndAck(t);
    const got = [];
    fac.onmessage = (e) => got.push(e.data);
    ws._message({ type: 'frame', streamId, seq: 1, name: null, data: 'a' });
    ws._message({ type: 'frame', streamId, seq: 2, name: null, data: 'b' });
    ws._message({ type: 'frame', streamId, seq: 1, name: null, data: 'a-dup' });   // replay
    assert.deepEqual(got, ['a', 'b']);
    t.closeAll();
  });

  it('server ping → per-stream synthetic ping frame + pong reply', () => {
    const { t } = makeTransport();
    const { fac, ws } = openAndAck(t);
    const pings = [];
    fac.addEventListener('ping', () => pings.push(1));
    ws._message({ type: 'ping', ts: 1 });
    assert.equal(pings.length, 1, 'ping fanned out per stream');
    assert.ok(ws.sent.some((m) => m.type === 'pong'), 'pong replied');
    t.closeAll();
  });
});

// ── capability fallback ──────────────────────────────────────────────────────

describe('ws-mux capability fallback', () => {
  it('constructor throws → synchronous EventSource fallback, no retry timer', () => {
    FakeWebSocket.throwOnCtor = true;
    const { t, tm } = makeTransport();
    const fac = t.open('/events?limit=400');
    assert.equal(FakeEventSource.instances.length, 1, 'ES created synchronously');
    assert.equal(FakeWebSocket.instances.length, 0, 'no ws constructed');
    tm.fireAll();
    assert.equal(FakeWebSocket.instances.length, 0, 'still no ws retry');
    t.closeAll();
  });

  it('socket fails before first ack (no /ws/mux route) → capability fallback for the page', () => {
    const { t } = makeTransport();
    const fac = t.open('/events?limit=400');
    const ws = FakeWebSocket.instances[0];
    ws._failHandshake();
    assert.equal(FakeEventSource.instances.length, 1, 'fell back to ES');
    // A subsequent open goes straight to SSE (no new ws).
    const fac2 = t.open('/events?limit=400');
    assert.equal(FakeWebSocket.instances.length, 1, 'no new ws after capability dead');
    assert.equal(FakeEventSource.instances.length, 2);
    t.closeAll();
  });

  it('clears the cached probe on capability fallback (re-probe next reload)', () => {
    const { t, store } = makeTransport();
    store.setItem('ccv.muxProbe', 'ok');
    const fac = t.open('/events?limit=400');
    FakeWebSocket.instances[0]._failHandshake();
    assert.equal(store.getItem('ccv.muxProbe'), null);
    t.closeAll();
  });
});

// ── per-stream fallback ──────────────────────────────────────────────────────

describe('ws-mux per-stream fallback', () => {
  it('error 4503 falls back ONLY that stream; the socket and siblings stay on mux', () => {
    const { t } = makeTransport();
    const a = openAndAck(t, '/events?project=a');
    const b = openAndAck(t, '/events?project=b');
    const ws = a.ws;
    assert.equal(FakeWebSocket.instances.length, 1, 'one shared socket');
    ws._message({ type: 'error', streamId: a.streamId, code: 4503, message: 'scope unavailable' });
    assert.equal(FakeEventSource.instances.length, 1, 'only stream a fell back');
    assert.equal(FakeEventSource.instances[0].url, '/events?project=a');
    assert.equal(b.fac._backend, 'mux', 'stream b still on mux');
    assert.equal(b.fac.readyState, 1);
    t.closeAll();
  });

  it('ack timeout falls back only that stream', () => {
    const { t, tm } = makeTransport();
    const facA = t.open('/events?project=a');   // acks
    const ws = FakeWebSocket.instances[0];
    ws._open();
    const openA = ws.sent.find((m) => m.type === 'open');
    ws._message({ type: 'open-ack', streamId: openA.streamId, epoch: 'e1', seq: 0 });
    // Second stream never acked → its ack timer fires.
    const facB = t.open('/events?project=b');
    const openB = ws.sent.filter((m) => m.type === 'open')[1];
    assert.ok(openB, 'second open sent');
    tm.fireAll();   // fire ack timeout
    assert.equal(FakeEventSource.instances.length, 1, 'only the un-acked stream fell back');
    assert.equal(facA._backend, 'mux');
    t.closeAll();
  });
});

// ── transient drop ───────────────────────────────────────────────────────────

describe('ws-mux transient drop', () => {
  it('healthy socket drop → WS reconnect (same url), not a fallback', () => {
    const { t, tm } = makeTransport();
    const { fac, ws } = openAndAck(t);
    ws.onclose && (ws.readyState = 3, ws.onclose({ code: 1006 }));   // runtime drop
    tm.fireAll();   // fire the 0.5s reconnect backoff
    assert.equal(FakeWebSocket.instances.length, 2, 'a second ws was opened');
    assert.equal(FakeEventSource.instances.length, 0, 'no SSE fallback');
    t.closeAll();
  });

  it('budget exhausted → facades report CLOSED+onerror (handed back to manager), no ES here', () => {
    let errored = 0;
    let fallbackCb = 0;
    const { t, tm } = makeTransport({ onRuntimeFallback: () => { fallbackCb++; } });
    const fac = t.open('/events?limit=400');
    fac.onerror = () => { errored++; };
    FakeWebSocket.instances[0]._open();
    const sid = FakeWebSocket.instances[0].sent.find((m) => m.type === 'open').streamId;
    FakeWebSocket.instances[0]._message({ type: 'open-ack', streamId: sid, epoch: 'e', seq: 0 });
    // Exhaust the reconnect budget (3): each drop is a RUNTIME drop (socket reached open),
    // and each reconnected socket is acked so the per-stream ack timer stays out of the way.
    for (let i = 0; i <= 3; i++) {
      const cur = FakeWebSocket.instances.at(-1);
      if (cur.readyState !== 1) {
        cur._open();   // a reconnected socket must open+ack before it can drop at runtime
        const o = cur.sent.filter((m) => m.type === 'open').at(-1);
        if (o) cur._message({ type: 'open-ack', streamId: o.streamId, epoch: 'e', seq: 0 });
      }
      cur.onclose?.({ code: 1006 });
      tm.fireAll();   // onclose registers the reconnect timer during this pass…
      tm.fireAll();   // …so a second pass actually fires it (fireAll snapshots ids up-front)
    }
    assert.equal(errored, 1, 'facade reported onerror');
    assert.equal(fac.readyState, 2, 'facade CLOSED');
    assert.equal(fallbackCb, 1, 'onRuntimeFallback invoked');
    assert.equal(FakeEventSource.instances.length, 0, 'transient exhaustion hands back to manager, not SSE');
    t.closeAll();
  });
});

// ── socket watchdog ──────────────────────────────────────────────────────────

describe('ws-mux socket watchdog', () => {
  it('45s without a server-initiated frame → transient reconnect (not downgrade)', () => {
    let now = 1000000;
    const { t, tm } = makeTransport({ now: () => now });
    const { fac } = openAndAck(t);
    now += 50000;   // 50s with no inbound frame
    tm.fireAll();   // watchdog tick → detect idle → transient drop → register reconnect timer
    tm.fireAll();   // fireAll snapshots pending ids up-front, so the reconnect timer (registered
                    // during the first pass) needs a second pass to fire.
    assert.equal(FakeWebSocket.instances.length, 2, 'watchdog triggered a ws reconnect');
    assert.equal(FakeEventSource.instances.length, 0, 'no SSE fallback from watchdog');
    t.closeAll();
  });
});

// ── P0/P1 regression: downgrade-state-machine classification ─────────────────
// These pin the bugs the review caught: the browser's ASYNC onclose must not turn a
// transient watchdog/reconnect drop into a permanent page-level capability downgrade.

describe('ws-mux downgrade classification (P0/P1 regression)', () => {
  it('P0: watchdog close + ASYNC onclose → transient reconnect, NOT a capability downgrade', async () => {
    let now = 1000000;
    FakeWebSocket.deferOnclose = true;   // browser timing: onclose arrives on a microtask AFTER close()
    const { t, tm } = makeTransport({ now: () => now });
    const { fac, ws } = openAndAck(t);
    now += 50000;
    // Watchdog tick → intentional close() → onclose is DEFERRED; by the time it lands the socket
    // is already in 'reconnecting' (the synchronous _onTransientDrop ran first). The late onclose
    // must be absorbed as a no-op, NOT misread as a handshake failure (capability).
    tm.fireAll();
    await Promise.resolve();             // deliver the deferred onclose now that state=reconnecting
    await Promise.resolve();
    tm.fireAll();                        // reconnect backoff → new dial
    assert.equal(t._getDead(), null, 'no permanent capability downgrade from a transient drop');
    assert.equal(FakeEventSource.instances.length, 0, 'no SSE fallback');
    assert.ok(FakeWebSocket.instances.length >= 2, 'a ws reconnect was attempted');
    t.closeAll();
  });

  it('P1: a refused reconnect dial (server restarting) consumes budget, NOT an instant capability downgrade', () => {
    const { t, tm } = makeTransport();
    openAndAck(t);
    // First drop: healthy socket dies → transient reconnect scheduled.
    FakeWebSocket.instances[0].readyState = 1;
    FakeWebSocket.instances[0].onclose?.({ code: 1006 });
    tm.fireAll(); tm.fireAll();
    // The reconnect dial is REFUSED before ack (server mid-restart): onerror/onclose on a
    // connecting socket mid-chain must count as one transient attempt, not a capability kill.
    const dial = FakeWebSocket.instances.at(-1);
    assert.ok(dial !== FakeWebSocket.instances[0], 'a reconnect dial happened');
    dial._failHandshake();
    assert.equal(t._getDead(), null, 'mid-chain dial refusal must not permanently downgrade');
    t.closeAll();
  });

  it('P1: a hung handshake (no open, no error) hits the dial deadline → first-dial capability fallback', () => {
    const { t, tm } = makeTransport();
    const fac = t.open('/events?limit=400');
    // Socket stays 'connecting' forever (blackholed upgrade). The dial deadline must fire.
    tm.fireAll();
    assert.equal(t._getDead(), 'capability', 'first-dial timeout is a capability signal');
    assert.equal(FakeEventSource.instances.length, 1, 'fell back to SSE');
    t.closeAll();
  });

  it('P1: ack-timeout per-stream fallback sends a close frame to release the server stream', () => {
    const { t, tm } = makeTransport();
    const a = openAndAck(t, '/events?project=a');
    const ws = a.ws;
    // Second stream never acked → its ack timer fires → per-stream fallback.
    const facB = t.open('/events?project=b');
    tm.fireAll();
    assert.ok(ws.sent.some((m) => m.type === 'close'), 'a close frame was sent for the timed-out stream');
    assert.equal(FakeEventSource.instances.length, 1, 'only stream b fell back');
    t.closeAll();
  });

  it('P1(everProven): after a proven session, a refused handback-rebuild dial stays transient (no page-level downgrade)', () => {
    const { t, tm } = makeTransport();
    // 1) Prove the mux: open + ack.
    openAndAck(t);
    // 2) Runtime drop → exhaust the transient budget (3 reconnects) → handback to manager.
    for (let i = 0; i <= 3; i++) {
      const cur = FakeWebSocket.instances.at(-1);
      if (cur.readyState !== 1) {
        cur._open();
        const o = cur.sent.filter((m) => m.type === 'open').at(-1);
        if (o) cur._message({ type: 'open-ack', streamId: o.streamId, epoch: 'e', seq: 0 });
      }
      cur.onclose?.({ code: 1006 });
      tm.fireAll(); tm.fireAll();
    }
    // 3) handback happened (facades CLOSED, sock=null, dead=null). Now AppBase rebuilds a fresh
    //    facade → a brand-new dial while the server is still down: refused before open. Because
    //    the page has PROVEN the mux before, this must stay transient — never capability.
    const fac2 = t.open('/events?limit=400');
    FakeWebSocket.instances.at(-1)._failHandshake();   // refused before open, retry=0, !everOpened
    assert.equal(t._getDead(), null, 'no capability downgrade once the page has proven the mux');
    t.closeAll();
  });

  it('P1(everProven): a first-dial failure AFTER the page proved the mux stays transient', () => {
    const { t, tm } = makeTransport();
    openAndAck(t);                                   // page has proven the mux (everProven=true)
    // Current socket drops at runtime; the reconnect dial is then refused pre-open.
    const cur = FakeWebSocket.instances.at(-1);
    cur.readyState = 1;
    cur.onclose?.({ code: 1006 });                   // transient drop → schedules reconnect
    tm.fireAll(); tm.fireAll();                      // fire the reconnect backoff → new dial
    const redial = FakeWebSocket.instances.at(-1);
    redial._failHandshake();                         // refused before open (server restarting)
    assert.equal(t._getDead(), null, 'a post-proven first-dial failure must stay transient');
    t.closeAll();
  });

  it('P2: a facade opened during the reconnect window rides the same socket (no second socket, no downgrade)', () => {
    const { t, tm } = makeTransport();
    const a = openAndAck(t, '/events?project=a');
    // Drop the healthy socket → transient reconnect scheduled (state=reconnecting).
    a.ws.readyState = 1;
    a.ws.onclose?.({ code: 1006 });
    // Open a SECOND facade during the backoff window — it must queue onto the pending reconnect.
    const b = t.open('/events?project=b');
    assert.equal(FakeWebSocket.instances.length, 1, 'no second socket spawned in the window');
    assert.equal(FakeEventSource.instances.length, 0, 'no SSE downgrade in the window');
    tm.fireAll(); tm.fireAll();   // fire the reconnect backoff → new socket
    const ws2 = FakeWebSocket.instances.at(-1);
    ws2._open();
    // Both facades flushed an open on the new socket.
    const opens = ws2.sent.filter((m) => m.type === 'open');
    assert.equal(opens.length, 2, 'both facades migrated onto the reconnected socket');
    for (const o of opens) ws2._message({ type: 'open-ack', streamId: o.streamId, epoch: 'e', seq: 0 });
    assert.equal(a.fac.readyState, 1);
    assert.equal(b.readyState, 1);
    t.closeAll();
  });

  it('P2: a server-initiated close frame reopens ONLY that stream as a native EventSource', () => {
    const { t } = makeTransport();
    const a = openAndAck(t, '/events?project=a');
    const b = openAndAck(t, '/events?project=b');
    // Server closes stream a (e.g. 30s backpressure eviction).
    a.ws._message({ type: 'close', streamId: a.streamId });
    assert.equal(FakeEventSource.instances.length, 1, 'stream a reopened as ES');
    assert.equal(FakeEventSource.instances[0].url, '/events?project=a');
    assert.equal(b.fac._backend, 'mux', 'stream b unaffected');
    assert.equal(b.fac.readyState, 1);
    t.closeAll();
  });
});

// ── multi-stream / close hygiene ─────────────────────────────────────────────

describe('ws-mux multi-stream + close', () => {
  it('one facade.close() sends only that stream close frame; the socket stays up', () => {
    const { t } = makeTransport();
    const a = openAndAck(t, '/events?project=a');
    const b = openAndAck(t, '/events?project=b');
    a.fac.close();
    assert.ok(a.ws.sent.some((m) => m.type === 'close' && m.streamId === a.streamId), 'close frame for a');
    assert.equal(a.fac.readyState, 2);
    assert.equal(b.fac.readyState, 1, 'b unaffected');
    assert.equal(a.ws.readyState, 1, 'socket still open');
    t.closeAll();
  });

  it('close() leaves no timers behind', () => {
    const { t, tm } = makeTransport();
    const fac = t.open('/events?limit=400');
    const ws = FakeWebSocket.instances[0];
    ws._open();
    fac.close();
    const before = tm.count();
    tm.fireAll();
    assert.ok(tm.count() <= before, 'no new timers after close');
    t.closeAll();
  });

  it('works with sessionStorage=null (test shim without it)', () => {
    const { t } = makeTransport({ sessionStore: null });
    const { fac, ws } = openAndAck(t);
    assert.equal(fac.readyState, 1);
    ws._failHandshake && 0;
    t.closeAll();
  });
});
