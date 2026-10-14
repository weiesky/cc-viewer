/**
 * ws-mux 单测 —— /ws/mux 对话通道多路复用（协议骨架，阶段 A）
 *
 * 覆盖：
 *   - 帧编解码 encodeFrame/decodeFrame（往返 / 坏帧 → null）
 *   - parseSseFrame（两种形状 / 多行 data 拼接 / 未知字段行 / 无 data → null）
 *   - validateOpenParams 矩阵（streamId / qs 形状）
 *   - open/close 生命周期（ack 先于 frame / 重复 id→4409 / 超限→4429 / 未知 id 忽略 / dispose 幂等）
 *   - 心跳 25s ping / 60s reap / pong 续期
 *   - 背压（gate offer 永入队不丢帧 / resume 广播 drain / queue 超 cap 关 socket / end() 只关该流）
 *   - sink shim 对 SSE 广播热路径的字节等价（_safeSseWrite / filterClientsByScope）
 */
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  encodeFrame,
  decodeFrame,
  parseSseFrame,
  validateOpenParams,
  createStreamMuxServer,
  MUX_CODES,
} from '../server/lib/ws-mux.js';
import { sendToClients, sendEventToClients } from '../server/lib/log-watcher.js';
import { filterClientsByScope } from '../server/lib/v2/view-router.js';

// ── fakes ────────────────────────────────────────────────────────────────────

class FakeWs extends EventEmitter {
  constructor() {
    super();
    this.readyState = 1;             // OPEN
    this.bufferedAmount = 0;
    this.sent = [];                  // encoded strings handed to ws.send
    this.closedWith = null;
    this.terminated = false;
  }
  send(text) { this.sent.push(text); }
  close(code, reason) { this.readyState = 3; this.closedWith = { code, reason }; this.emit('close'); }
  terminate() { this.terminated = true; this.readyState = 3; this.emit('close'); }
  // test helper: deliver an inbound frame object
  receive(obj) { this.emit('message', typeof obj === 'string' ? obj : encodeFrame(obj)); }
}

class FakeWss extends EventEmitter {
  constructor() { super(); this.closed = false; }
  close() { this.closed = true; }
}

function makeServer(over = {}) {
  const wss = new FakeWss();
  const reports = [];
  const serveCalls = [];
  const mux = createStreamMuxServer({
    WebSocketServer: function () { return wss; },
    serveStream: over.serveStream || ((sink, qs) => { serveCalls.push({ sink, qs }); return { dispose() { this.disposed = true; } }; }),
    reportSwallowed: (tag, err, extra) => reports.push({ tag, err, extra }),
    ...over,
  });
  return { mux, wss, reports, serveCalls };
}

function connect(mux) {
  const ws = new FakeWs();
  mux._server.emit('connection', ws, {});
  return ws;
}

const decoded = (ws) => ws.sent.map((s) => JSON.parse(s));

// ── codec ────────────────────────────────────────────────────────────────────

describe('ws-mux frame codec', () => {
  it('encode/decode round-trips', () => {
    const o = { type: 'frame', streamId: 'a', seq: 3, name: null, data: '{"x":1}' };
    assert.deepEqual(decodeFrame(encodeFrame(o)), o);
  });
  it('decodeFrame returns null on bad JSON / non-object / missing type', () => {
    assert.equal(decodeFrame('{not json'), null);
    assert.equal(decodeFrame('[1,2]'), null);
    assert.equal(decodeFrame('{"nostream":1}'), null);
    assert.equal(decodeFrame('"just a string"'), null);
  });
});

describe('parseSseFrame', () => {
  it('bare data frame → name:null', () => {
    assert.deepEqual(parseSseFrame('data: {"a":1}'), { name: null, data: '{"a":1}' });
  });
  it('named frame', () => {
    assert.deepEqual(parseSseFrame('event: load_end\ndata: {}'), { name: 'load_end', data: '{}' });
  });
  it('joins multiple data lines with newline', () => {
    assert.deepEqual(parseSseFrame('data: a\ndata: b'), { name: null, data: 'a\nb' });
  });
  it('strips one leading space after the colon', () => {
    assert.deepEqual(parseSseFrame('data:{}'), { name: null, data: '{}' });
  });
  it('returns null when no data field', () => {
    assert.equal(parseSseFrame('event: onlyname'), null);
  });
  it('reports drift on unexpected field line', () => {
    const reports = [];
    parseSseFrame('data: {}\nretry: 100', (tag, err, extra) => reports.push({ tag, extra }));
    assert.equal(reports.length, 1);
    assert.equal(reports[0].tag, 'ws.mux.parse');
  });
});

describe('validateOpenParams', () => {
  it('accepts a valid open', () => {
    const v = validateOpenParams({ streamId: 'abc-123_OK', qs: 'project=p&since=t' });
    assert.equal(v.ok, true);
    assert.equal(v.qs, 'project=p&since=t');
  });
  it('treats missing qs as empty', () => {
    assert.equal(validateOpenParams({ streamId: 'a' }).qs, '');
  });
  it('rejects bad streamId', () => {
    assert.equal(validateOpenParams({ streamId: '' }).ok, false);
    assert.equal(validateOpenParams({ streamId: 42 }).ok, false);
    assert.equal(validateOpenParams({ streamId: 'has space' }).ok, false);
  });
  it('rejects qs with leading ? or non-string', () => {
    assert.equal(validateOpenParams({ streamId: 'a', qs: '?x=1' }).ok, false);
    assert.equal(validateOpenParams({ streamId: 'a', qs: 7 }).ok, false);
  });
});

// ── lifecycle ────────────────────────────────────────────────────────────────

describe('ws-mux stream lifecycle', { concurrency: false }, () => {
  let m;
  beforeEach(() => { m = makeServer(); });
  afterEach(() => { m.mux.close(); });

  it('open → open-ack precedes any frame; qs passed verbatim to serveStream', () => {
    const ws = connect(m.mux);
    ws.receive({ type: 'open', streamId: 's1', qs: 'project=p&cc=2' });
    const frames = decoded(ws);
    assert.deepEqual(frames[0], { type: 'open-ack', streamId: 's1', epoch: frames[0].epoch, seq: 0 });
    assert.equal(m.serveCalls[0].qs, 'project=p&cc=2');
  });

  it('duplicate streamId → 4409 and the original stream stays alive', () => {
    const ws = connect(m.mux);
    ws.receive({ type: 'open', streamId: 's1', qs: '' });
    ws.receive({ type: 'open', streamId: 's1', qs: '' });
    const errs = decoded(ws).filter((f) => f.type === 'error');
    assert.equal(errs.length, 1);
    assert.equal(errs[0].code, MUX_CODES.DUPLICATE_STREAM);
    assert.equal(m.serveCalls.length, 1);
  });

  it('beyond MAX_STREAMS_PER_SOCKET → 4429', () => {
    const ws = connect(m.mux);
    for (let i = 0; i < 8; i++) ws.receive({ type: 'open', streamId: `s${i}`, qs: '' });
    ws.receive({ type: 'open', streamId: 's9', qs: '' });
    const errs = decoded(ws).filter((f) => f.type === 'error' && f.streamId === 's9');
    assert.equal(errs[0].code, MUX_CODES.TOO_MANY_STREAMS);
  });

  it('close for an unknown streamId is ignored', () => {
    const ws = connect(m.mux);
    ws.receive({ type: 'close', streamId: 'ghost' });
    assert.equal(decoded(ws).filter((f) => f.type === 'error').length, 0);
  });

  it('client close disposes exactly that stream (idempotent)', () => {
    let disposeCount = 0;
    const mm = makeServer({ serveStream: () => ({ dispose() { disposeCount++; } }) });
    const ws = connect(mm.mux);
    ws.receive({ type: 'open', streamId: 's1', qs: '' });
    ws.receive({ type: 'close', streamId: 's1' });
    ws.receive({ type: 'close', streamId: 's1' });
    assert.equal(disposeCount, 1);
    mm.mux.close();
  });

  it('socket close disposes every live stream exactly once', () => {
    let disposeCount = 0;
    const mm = makeServer({ serveStream: () => ({ dispose() { disposeCount++; } }) });
    const ws = connect(mm.mux);
    ws.receive({ type: 'open', streamId: 'a', qs: '' });
    ws.receive({ type: 'open', streamId: 'b', qs: '' });
    ws.emit('close');
    assert.equal(disposeCount, 2);
    mm.mux.close();
  });

  it('serveStream throwing → 4503 per-stream error, socket stays up', () => {
    const mm = makeServer({ serveStream: () => { throw new Error('boom'); } });
    const ws = connect(mm.mux);
    ws.receive({ type: 'open', streamId: 's1', qs: '' });
    const errs = decoded(ws).filter((f) => f.type === 'error');
    assert.equal(errs[0].code, MUX_CODES.SCOPE_UNAVAILABLE);
    assert.equal(ws.closedWith, null);
    mm.mux.close();
  });
});

// ── heartbeat ────────────────────────────────────────────────────────────────

describe('ws-mux heartbeat', { concurrency: false }, () => {
  beforeEach(() => { mock.timers.enable({ apis: ['setInterval', 'Date'] }); });
  afterEach(() => { mock.timers.reset(); });

  it('sends app-level ping every 25s', () => {
    const m = makeServer();
    const ws = connect(m.mux);
    mock.timers.tick(25000);
    assert.ok(decoded(ws).some((f) => f.type === 'ping'));
    m.mux.close();
  });

  it('reaps a socket with no inbound frame for 60s', () => {
    const m = makeServer();
    const ws = connect(m.mux);
    mock.timers.tick(25000);           // ping #1
    mock.timers.tick(25000);           // 50s elapsed, still under reap
    assert.equal(ws.closedWith, null);
    mock.timers.tick(25000);           // 75s > 60s reap
    assert.equal(ws.closedWith && ws.closedWith.code, 1001);
    m.mux.close();
  });

  it('an inbound pong renews liveness', () => {
    const m = makeServer();
    const ws = connect(m.mux);
    mock.timers.tick(40000);
    ws.receive({ type: 'pong', ts: 1 });
    mock.timers.tick(40000);           // 80s total but only 40s since pong
    assert.equal(ws.closedWith, null);
    m.mux.close();
  });
});

// ── sink shim / broadcast equivalence ───────────────────────────────────────

describe('ws-mux sink shim broadcast equivalence', { concurrency: false }, () => {
  it('sendToClients/sendEventToClients deliver identical (name,data) frames to SSE res and mux sink', async () => {
    const m = makeServer();
    const ws = connect(m.mux);
    // capture the live sink via serveStream
    let liveSink = null;
    m.mux; // noop
    const mm = makeServer({ serveStream: (sink) => { liveSink = sink; return { dispose() {} }; } });
    const ws2 = connect(mm.mux);
    ws2.receive({ type: 'open', streamId: 's1', qs: '' });

    // A fake SSE res (plaintext path: _wireEnc falsy → res.write)
    const sseWrites = [];
    const fakeRes = new EventEmitter();
    fakeRes.destroyed = false; fakeRes.writable = true; fakeRes._wireEnc = undefined;
    fakeRes.write = (s) => { sseWrites.push(s); return true; };
    fakeRes.end = () => { fakeRes.destroyed = true; };

    const clients = [fakeRes, liveSink];
    sendToClients(clients, { ts: 1, url: '/a' });
    sendEventToClients(clients, 'task_update', { tasks: [] });

    // SSE bytes
    assert.deepEqual(sseWrites, [`data: {"ts":1,"url":"/a"}\n\n`, `event: task_update\ndata: {"tasks":[]}\n\n`]);
    // WS frames decoded to the same (name, data) sequence
    const frames = decoded(ws2).filter((f) => f.type === 'frame');
    assert.deepEqual(frames.map((f) => [f.name, f.data]), [[null, `{"ts":1,"url":"/a"}`], ['task_update', `{"tasks":[]}`]]);
    assert.deepEqual(frames.map((f) => f.seq), [1, 2]);   // per-stream monotonic
    m.mux.close(); mm.mux.close();
  });

  it('filterClientsByScope routes by per-stream _ccvViewProject/_ccvViewInstance stamps', () => {
    const m = makeServer();
    const ws = connect(m.mux);
    const sinks = [];
    const mm = makeServer({ serveStream: (sink) => { sinks.push(sink); return { dispose() {} }; } });
    const wsA = connect(mm.mux);
    wsA.receive({ type: 'open', streamId: 'a', qs: '' });
    wsA.receive({ type: 'open', streamId: 'b', qs: '' });
    sinks[0]._ccvViewProject = 'proj-x';
    sinks[1]._ccvViewProject = 'proj-y';
    sinks[1]._ccvViewInstance = 'ccv-abc';

    const clients = [...sinks];
    const onlyX = filterClientsByScope(clients, 'proj-x', null, 'bound');
    assert.equal(onlyX.length, 1);
    assert.equal(onlyX[0].streamId, 'a');
    m.mux.close(); mm.mux.close();
  });

  it('shim._wireEnc stays falsy so sseWrite takes the plaintext write branch', () => {
    const m = makeServer();
    let liveSink = null;
    const mm = makeServer({ serveStream: (s) => { liveSink = s; return { dispose() {} }; } });
    const ws = connect(mm.mux);
    ws.receive({ type: 'open', streamId: 's1', qs: '' });
    assert.equal(liveSink._wireEnc, undefined);
    m.mux.close(); mm.mux.close();
  });
});

// ── backpressure ─────────────────────────────────────────────────────────────

describe('ws-mux backpressure', { concurrency: false }, () => {
  beforeEach(() => { mock.timers.enable({ apis: ['setInterval', 'Date'] }); });
  afterEach(() => { mock.timers.reset(); });

  it('gate offer NEVER drops frames: queued while behind, flushed in order on resume', () => {
    const m = makeServer();
    const ws = connect(m.mux);
    let liveSink = null;
    const mm = makeServer({ serveStream: (s) => { liveSink = s; return { dispose() {} }; } });
    const ws2 = connect(mm.mux);
    ws2.receive({ type: 'open', streamId: 's1', qs: '' });

    ws2.bufferedAmount = 5 * 1024 * 1024;   // over highWater → behind
    const before = decoded(ws2).length;
    liveSink.write('data: {"n":1}\n\n');
    liveSink.write('data: {"n":2}\n\n');
    // While behind, frames are queued not sent
    assert.equal(decoded(ws2).length, before);
    // Drop below lowWater → gate poll resumes → queue flushed FIFO
    ws2.bufferedAmount = 0;
    mock.timers.tick(200);
    const frames = decoded(ws2).filter((f) => f.type === 'frame');
    assert.deepEqual(frames.map((f) => f.data), ['{"n":1}', '{"n":2}']);
    m.mux.close(); mm.mux.close();
  });

  it('queue overflow closes the whole socket (memory safety net)', () => {
    const m = makeServer();
    let liveSink = null;
    const mm = makeServer({ serveStream: (s) => { liveSink = s; return { dispose() {} }; } });
    const ws = connect(mm.mux);
    ws.receive({ type: 'open', streamId: 's1', qs: '' });
    ws.bufferedAmount = 5 * 1024 * 1024;    // behind
    liveSink.write('data: ' + 'x'.repeat(9 * 1024 * 1024) + '\n\n');   // > 8MB cap
    assert.ok(ws.closedWith, 'socket closed on queue overflow');
    m.mux.close(); mm.mux.close();
  });

  it('sink.end() ends only that stream, not the socket', () => {
    let liveSink = null;
    const mm = makeServer({ serveStream: (s) => { liveSink = s; return { dispose() {} }; } });
    const ws = connect(mm.mux);
    ws.receive({ type: 'open', streamId: 's1', qs: '' });
    liveSink.end();
    assert.equal(liveSink.destroyed, true);
    assert.equal(ws.closedWith, null, 'socket not closed by per-stream end()');
    mm.mux.close();
  });

  it('a dead stream is evicted from clients by _safeSseWrite', () => {
    let liveSink = null;
    const mm = makeServer({ serveStream: (s) => { liveSink = s; return { dispose() {} }; } });
    const ws = connect(mm.mux);
    ws.receive({ type: 'open', streamId: 's1', qs: '' });
    liveSink.destroyed = true; liveSink.writable = false;
    const clients = [liveSink];
    sendToClients(clients, { ts: 1 });
    assert.equal(clients.length, 0, 'dead shim removed from clients');
    mm.mux.close();
  });
});

// ── real-socket integration (handleUpgrade over a live http server + real ws) ──

describe('ws-mux handleUpgrade over a real socket', { concurrency: false }, () => {
  it('upgrade → open → open-ack → frame flows over a real WebSocket', async () => {
    const { createServer } = await import('node:http');
    const { WebSocket, WebSocketServer } = await import('ws');
    let liveSink = null;
    const mux = createStreamMuxServer({
      WebSocketServer,
      serveStream: (sink) => { liveSink = sink; return { dispose() {} }; },
      reportSwallowed: () => {},
    });
    const httpServer = createServer();
    httpServer.on('upgrade', (req, socket, head) => mux.handleUpgrade(req, socket, head));
    await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
    const port = httpServer.address().port;

    const frames = [];
    const timeout = setTimeout(() => reject(new Error('integration timeout')), 5000);
    await new Promise((resolve, reject) => {
      const c = new WebSocket(`ws://127.0.0.1:${port}/ws/mux`);
      c.on('open', () => c.send(JSON.stringify({ type: 'open', streamId: 'int1', qs: 'limit=400' })));
      c.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        frames.push(msg);
        if (msg.type === 'open-ack') {
          // Server pushes a frame through the live sink; the client must receive it framed.
          liveSink.write('event: task_update\ndata: {"tasks":[]}\n\n');
        }
        if (msg.type === 'frame') { c.close(); resolve(); }
      });
      c.on('error', reject);
    });
    clearTimeout(timeout);

    assert.equal(frames[0].type, 'open-ack');
    assert.equal(frames[0].streamId, 'int1');
    const frame = frames.find((f) => f.type === 'frame');
    assert.equal(frame.name, 'task_update');
    assert.equal(frame.data, '{"tasks":[]}');
    assert.ok(frame.seq >= 1);

    mux.close();
    await new Promise((r) => httpServer.close(r));
  });
});

// ── P1/P2 regression: close visibility + awaitDrain wakeup + listener hygiene ──

describe('ws-mux close semantics (P1/P2 regression)', { concurrency: false }, () => {
  it('closeStream emits sink close → an in-flight awaitDrain resolves (no 30s hang)', async () => {
    let liveSink = null;
    const m = makeServer({ serveStream: (s) => { liveSink = s; return { dispose() {} }; } });
    const ws = connect(m.mux);
    ws.receive({ type: 'open', streamId: 's1', qs: '' });
    let resolved = false;
    const p = liveSink.awaitDrain().then(() => { resolved = true; });
    // Server closes the stream (e.g. backpressure eviction path) while a write is awaiting drain.
    liveSink.end();
    await p;   // must resolve via 'close', not the 30s timeout
    await new Promise((r) => setImmediate(r));
    assert.equal(resolved, true, 'awaitDrain woke on stream close');
    m.mux.close();
  });

  it('awaitDrain leaves no stale drain/close listeners behind', async () => {
    let liveSink = null;
    const m = makeServer({ serveStream: (s) => { liveSink = s; return { dispose() {} }; } });
    const ws = connect(m.mux);
    ws.receive({ type: 'open', streamId: 's1', qs: '' });
    const baseClose = liveSink.listenerCount('close');
    const baseDrain = liveSink.listenerCount('drain');
    // Resolve via drain several times.
    for (let i = 0; i < 5; i++) {
      const p = liveSink.awaitDrain();
      liveSink.emit('drain');
      await p;
    }
    assert.equal(liveSink.listenerCount('drain'), baseDrain, 'no drain listener accumulation');
    assert.equal(liveSink.listenerCount('close'), baseClose, 'no close listener accumulation');
    m.mux.close();
  });

  it('a server-initiated stream close notifies the client with a close frame (socket up)', async () => {
    let liveSink = null;
    const m = makeServer({ serveStream: (s) => { liveSink = s; return { dispose() {} }; } });
    const ws = connect(m.mux);
    ws.receive({ type: 'open', streamId: 's1', qs: '' });
    // Simulate the 30s-backpressure eviction calling end() on the shim (a server-side close).
    // end() emits 'close' on a microtask (to not reorder vs sibling clients during a broadcast
    // loop), so flush the microtask queue before asserting the close frame went out.
    liveSink.end();
    await new Promise((r) => setImmediate(r));
    const closeFrames = decoded(ws).filter((f) => f.type === 'close' && f.streamId === 's1');
    assert.equal(closeFrames.length, 1, 'client is told the stream closed');
    assert.equal(ws.closedWith, null, 'socket itself stays up (siblings unaffected)');
    m.mux.close();
  });
});
