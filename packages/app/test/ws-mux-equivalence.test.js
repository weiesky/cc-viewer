/**
 * ws-mux-equivalence —— 「单工作区行为等价」的机制性证明（阶段 B 核心回归网）。
 *
 * serveEventStream 是 SSE 路由与 WS-mux 流共享的唯一播出实现。本测试分两层钉死等价性：
 *   1. 帧化等价：同一段 SSE 字节序列分别经 (a) SSE 明文 res 与 (b) WS-mux 的 MuxSink shim
 *      写，解析两侧产出为 (name, data) 列表，deepEqual —— shim 的分帧不引入任何差异。
 *   2. 播出等价：用同一份 v2 种子数据直调 serveEventStream 两次（SSE sink vs mux shim sink），
 *      断言两侧 (name, data) 帧序列一致（ping 心跳除外——它由各自传输层补充）。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-ws-mux-equiv-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

function mainAgentEntry(ts, inputTokens) {
  return {
    timestamp: ts,
    url: 'https://api.anthropic.com/v1/messages',
    method: 'POST',
    status: 200,
    mainAgent: true,
    body: {
      model: 'claude-opus-4-8',
      system: [{ type: 'text', text: 'You are Claude Code' }],
      tools: [{ name: 'Bash' }],
      messages: [{ role: 'user', content: 'hi' }],
    },
    response: { body: { usage: { input_tokens: inputTokens, output_tokens: 10 } } },
  };
}

let interceptor, eventsMod, wsMuxMod;

before(async () => {
  interceptor = await import('../server/interceptor.js');
  interceptor.initForWorkspace(join(tmpDir, 'evproj'), { forceNew: true });
  eventsMod = await import('../server/routes/events.js');
  wsMuxMod = await import('../server/lib/ws-mux.js');
});

after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

let sidCounter = 0;
async function seedV2(entries) {
  const w = interceptor._v2Writer;
  w.resetSessions();
  const sid = `20000000-0000-4000-8000-${String(++sidCounter).padStart(12, '0')}`;
  for (const e of entries) {
    e.body.metadata = { user_id: JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: sid }) };
    const h = w.ingestRequest(e, e.body.messages);
    w.ingestCompletion(h, e);
  }
  await w.flush();
}

function depsBase(clients) {
  return {
    turnEndDebounceMs: 1234,
    DEFAULT_EVENTS_LIMIT: 400,
    SSE_BACKPRESSURE_TIMEOUT_MS: 1000,
    pendingMajorUpdate: null,
    clients,
  };
}

function parseSseBytes(out) {
  const frames = [];
  for (const block of out.split('\n\n')) {
    if (!block.trim()) continue;
    let name = null;
    const data = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) name = line.slice(7);
      else if (line.startsWith('data: ')) data.push(line.slice(6));
    }
    frames.push([name, data.join('\n')]);
  }
  return frames;
}

/** SSE sink adapter over a collecting plaintext res (byte-faithful). */
function makeSseSink() {
  const res = new EventEmitter();
  res.destroyed = false; res.writable = true; res._wireEnc = undefined;
  res.chunks = [];
  res.write = (s) => { res.chunks.push(String(s)); return true; };
  res.end = () => { res.destroyed = true; res.emit('close'); };
  res.on('error', () => {});
  const sink = {
    registrable: res,
    write: (s) => res.write(s),
    alive: () => !res.destroyed && res.writable !== false,
    needsDrain: () => false,
    awaitDrain: () => Promise.resolve(),
    onClose: (dispose) => { res.on('close', dispose); res.on('error', dispose); },
  };
  return { sink, frames: () => parseSseBytes(res.chunks.join('')) };
}

/** A live MuxSink obtained from a real mux server over a fake socket (stub serveStream). */
function makeMuxSink() {
  const sent = [];
  const fakeWs = new EventEmitter();
  fakeWs.readyState = 1;
  fakeWs.bufferedAmount = 0;
  fakeWs.send = (t) => sent.push(JSON.parse(t));
  fakeWs.close = () => { fakeWs.readyState = 3; fakeWs.emit('close'); };
  fakeWs.on('error', () => {});
  let captured = null;
  const mux = wsMuxMod.createStreamMuxServer({
    WebSocketServer: function () { return new EventEmitter(); },
    serveStream: (sink) => { captured = sink; return { dispose() {} }; },   // capture only; we drive the real serveEventStream below
    reportSwallowed: () => {},
  });
  mux._server.emit('connection', fakeWs, {});
  fakeWs.emit('message', JSON.stringify({ type: 'open', streamId: 'eq1', qs: '' }));
  return {
    mux,
    sink: captured,
    frames: () => sent.filter((f) => f.type === 'frame').map((f) => [f.name, f.data]),
  };
}

describe('ws-mux sink framing equivalence', () => {
  it('shim write() frames a byte sequence identically to the SSE plaintext res', () => {
    const sse = makeSseSink();
    const mux = makeMuxSink();
    // The exact byte shapes the codebase emits (incl. a load_chunk split across 3 writes).
    const script = [
      ['event: load_chunk\ndata: [', '{"entry":1}', ']\n\n'],
      ['data: {"ts":1,"url":"/a"}\n\n'],
      ['event: task_update\ndata: {"tasks":[]}\n\n'],
      ['event: load_end\ndata: {}\n\n'],
    ];
    for (const parts of script) for (const p of parts) { sse.sink.write(p); mux.sink.write(p); }
    assert.deepEqual(mux.frames(), sse.frames());
    mux.mux.close();
    mux.mux._sockets.forEach((st) => { st.pingTimer && clearInterval(st.pingTimer); });
  });
});

describe('serveEventStream: SSE sink vs WS-mux sink frame equivalence', () => {
  it('produces the identical (name, data) frame sequence on both transports', async () => {
    await seedV2([
      mainAgentEntry('2026-06-06T01:00:00.000Z', 111),
      mainAgentEntry('2026-06-06T01:01:00.000Z', 222),
    ]);
    const params = eventsMod.paramsFromParsedUrl({ searchParams: new URLSearchParams('limit=400') });

    const sseClients = [];
    const sse = makeSseSink();
    await eventsMod.serveEventStream(sse.sink, params, depsBase(sseClients));

    const wsClients = [];
    const mux = makeMuxSink();
    await eventsMod.serveEventStream(mux.sink, params, depsBase(wsClients));

    const sseFrames = sse.frames().filter(([n]) => n !== 'ping');
    const wsFrames = mux.frames().filter(([n]) => n !== 'ping');
    assert.ok(sseFrames.length > 0, 'sse produced frames');
    assert.deepEqual(wsFrames, sseFrames, 'WS-mux frame sequence must equal SSE frame sequence');
    mux.mux.close();
  });
});

// P1 regression: the entry-registered close hook + the closed-guard on the broadcast push.
// A client that disconnects MID-cold-load must neither leak its pingTimer nor be pushed.
describe('serveEventStream: mid-stream close (push guard + entry dispose)', () => {
  it('a sink whose close fires during the cold load is NOT pushed into deps.clients', async () => {
    await seedV2([mainAgentEntry('2026-06-06T01:00:00.000Z', 111)]);
    const params = eventsMod.paramsFromParsedUrl({ searchParams: new URLSearchParams('limit=400') });
    const clients = [];
    const sse = makeSseSink();
    const res = sse.sink.registrable;   // makeSseSink returns {sink, frames}; the res IS the registrable
    // Fire close as soon as the entry hook is registered (before any cold-load frame lands).
    // The entry-registered dispose must mark the stream closed so the push guard skips it.
    const origOnClose = sse.sink.onClose;
    sse.sink.onClose = (dispose) => {
      origOnClose(dispose);
      // Close synchronously on registration: deterministic (does not depend on which frame
      // lands first). alive() goes false, the cold loop short-circuits, the push guard holds.
      res.destroyed = true;
      res.emit('close');
    };
    await eventsMod.serveEventStream(sse.sink, params, depsBase(clients));
    assert.equal(clients.length, 0, 'a sink closed before the broadcast push is not registered');
  });

  it('dispose() before the push clears the pingTimer and splices the registrable out', async () => {
    await seedV2([mainAgentEntry('2026-06-06T01:02:00.000Z', 333)]);
    const params = eventsMod.paramsFromParsedUrl({ searchParams: new URLSearchParams('limit=400') });
    const clients = [];
    const sse = makeSseSink();
    const handle = await eventsMod.serveEventStream(sse.sink, params, depsBase(clients));
    assert.equal(clients.length, 1, 'healthy sink pushed after history');
    handle.dispose();
    assert.equal(clients.length, 0, 'dispose splices the registrable out');
    handle.dispose();   // idempotent
    assert.equal(clients.length, 0);
  });
});
