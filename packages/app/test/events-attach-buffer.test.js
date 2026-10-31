// Integration coverage for the /events attach buffer (server/lib/attach-buffer.js
// wired into routes/events.js serveEventStream): closes the cold-load→clients.push
// broadcast-loss window that stalled the FIRST turn of a fresh `ccv --sdk`.
//
// Deterministic window injection: `events(req, res, ...)` runs synchronously up to
// its first await (the cold read). The moment it is CALLED (not awaited) the attach
// buffer proxy is already registered in deps.clients. Broadcasting into
// deps.clients at that point lands in the window — then awaiting the handler flushes
// those frames through the real sink after load_end.
//
// Isolation pattern mirrors events-deep.test.js (env/cwd before importing the
// interceptor, CCV_PROXY_MODE=1 to skip the http patch + server autostart).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';

const tmpRoot = mkdtempSync(join(tmpdir(), 'ccv-events-attachbuf-'));
const logRoot = join(tmpRoot, 'logs');
const projectCwd = join(tmpRoot, 'attachbufproj');
mkdirSync(logRoot, { recursive: true });
mkdirSync(projectCwd, { recursive: true });
process.env.CCV_LOG_DIR = logRoot;
process.env.CCV_PROXY_MODE = '1';
delete process.env.CCV_WORKSPACE_MODE;
delete process.env.CCV_CLI_MODE;
delete process.env.CCV_IM_PLATFORM;
const origCwd = process.cwd();
process.chdir(projectCwd);

const SANITIZE = new RegExp('[^a-zA-Z0-9_\\-.]', 'g');
const projectName = basename(projectCwd).replace(SANITIZE, '_');
mkdirSync(join(logRoot, projectName), { recursive: true });

function mainAgentEntry(tstamp, inputTokens, extra = {}) {
  return {
    timestamp: tstamp,
    url: 'https://api.anthropic.com/v1/messages',
    method: 'POST', status: 200, mainAgent: true,
    body: { model: 'claude-opus-4-8', system: [{ type: 'text', text: 'sys' }], tools: [{ name: 'Bash' }], messages: [{ role: 'user', content: 'hi' }] },
    response: { body: { usage: { input_tokens: inputTokens, output_tokens: 10 } } },
    ...extra,
  };
}

function makeRes(opts = {}) {
  const res = new EventEmitter();
  res.statusCode = 0; res.headers = null; res.chunks = []; res.ended = false;
  res.destroyed = false; res.writable = true;
  res.writeHead = (code, headers) => { res.statusCode = code; res.headers = headers || {}; return res; };
  res.write = (c) => {
    const s = c == null ? '' : (Buffer.isBuffer(c) ? c.toString('utf-8') : String(c));
    if (opts.onWrite) { const r = opts.onWrite(s, res); if (r !== undefined) return r; }
    res.chunks.push(s);
    return true;
  };
  res.end = (c) => { if (c != null) res.chunks.push(Buffer.isBuffer(c) ? c.toString('utf-8') : String(c)); res.ended = true; res.emit('finish'); return res; };
  res.on('error', () => {});
  return res;
}
function bodyStr(res) { return res.chunks.join(''); }
function parseFrames(out) {
  const frames = [];
  for (const block of out.split('\n\n')) {
    if (!block.trim()) continue;
    const ev = { event: 'message', data: '' };
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) ev.event = line.slice(7);
      else if (line.startsWith('data: ')) ev.data += line.slice(6);
    }
    frames.push(ev);
  }
  return frames;
}
function url(pathname, query = {}) { return { pathname, searchParams: new URLSearchParams(query) }; }

let interceptor, eventsMod, events, sendEventToClients, sendEventRawToClients;

let wsMuxMod;

before(async () => {
  interceptor = await import('../server/interceptor.js');
  await interceptor._initPromise;
  assert.equal(interceptor._projectName, projectName);
  eventsMod = await import('../server/routes/events.js');
  const lw = await import('../server/lib/log-watcher.js');
  sendEventToClients = lw.sendEventToClients;
  sendEventRawToClients = lw.sendEventRawToClients;
  events = eventsMod.eventsRoutes.find(r => r.path === '/events' && r.method === 'GET').handler;
  wsMuxMod = await import('../server/lib/ws-mux.js');
});

// A live MuxSink over a fake socket (mirrors ws-mux-equivalence.test.js): captures the
// per-stream shim so we can drive serveEventStream on the WS-mux transport directly.
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
    serveStream: (sink) => { captured = sink; return { dispose() {} }; },
    reportSwallowed: () => {},
  });
  mux._server.emit('connection', fakeWs, {});
  fakeWs.emit('message', JSON.stringify({ type: 'open', streamId: 'ab1', qs: 'limit=400' }));
  return {
    mux,
    sink: captured,
    frames: () => sent.filter((f) => f.type === 'frame').map((f) => [f.name, f.data]),
  };
}

after(() => {
  process.chdir(origCwd);
  rmSync(tmpRoot, { recursive: true, force: true });
});

let sidCounter = 0;
async function seedV2(entries) {
  const w = interceptor._v2Writer;
  w.resetSessions();
  const sid = `40000000-0000-4000-8000-${String(++sidCounter).padStart(12, '0')}`;
  for (const e of entries) {
    e.body.metadata = { user_id: JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: sid }) };
    const h = w.ingestRequest(e, e.body.messages);
    w.ingestCompletion(h, e);
  }
  await w.flush();
  return sid;
}

function eventsDeps(over = {}) {
  return {
    turnEndDebounceMs: 1234, DEFAULT_EVENTS_LIMIT: 400, SSE_BACKPRESSURE_TIMEOUT_MS: 50,
    pendingMajorUpdate: null, clients: [], wireV3: true, ...over,
  };
}

// A row delta frame in the exact wire shape the live feed emits (v2_requests_delta).
function rowDeltaFrame(sessionId, seq) {
  return { sessionId, seq, timestamp: '2026-06-06T02:00:00.000Z', url: 'https://api.anthropic.com/v1/messages', method: 'POST', mainAgent: true, kind: 'main', evt: 'req' };
}

describe('events attach buffer: cold-load window no longer loses live deltas', () => {
  it('registers the buffer proxy synchronously on call, before the first await', async () => {
    await seedV2([mainAgentEntry('2026-06-06T01:00:00.000Z', 100)]);
    const req = new EventEmitter(); req.headers = {};
    const res = makeRes();
    const deps = eventsDeps();
    // Call (do NOT await): serveEventStream runs synchronously to its first await,
    // so the proxy must already be in deps.clients at this point.
    const p = events(req, res, url('/events'), true, deps);
    const proxy = deps.clients.find(c => c && c._ccvAttachBuffer === true);
    assert.ok(proxy, 'attach buffer proxy registered synchronously in the cold-load window');
    assert.equal(deps.clients.includes(res), false, 'real res NOT registered before load_end (anti-flicker preserved)');
    await p;
    // After the handler completes: proxy swapped out, real res registered.
    assert.equal(deps.clients.some(c => c && c._ccvAttachBuffer === true), false, 'proxy removed after flush');
    assert.equal(deps.clients.includes(res), true, 'real res registered after load_end');
    req.emit('close');
  });

  it('replays a v2_requests_delta broadcast that lands inside the window, after load_end', async () => {
    const sid = await seedV2([mainAgentEntry('2026-06-06T01:00:00.000Z', 100)]);
    const req = new EventEmitter(); req.headers = {};
    const res = makeRes();
    const deps = eventsDeps();
    const p = events(req, res, url('/events'), true, deps);
    // Inject a live delta INTO the window (the proxy is the only client right now).
    sendEventToClients(deps.clients, 'v2_requests_delta', rowDeltaFrame(sid, 7));
    await p;
    const frames = parseFrames(bodyStr(res));
    const loadEndIdx = frames.findIndex(f => f.event === 'load_end');
    const deltaIdx = frames.findIndex(f => f.event === 'v2_requests_delta');
    assert.ok(loadEndIdx !== -1, 'load_end present');
    assert.ok(deltaIdx !== -1, 'window delta was replayed to the client (pre-fix it was lost)');
    assert.ok(deltaIdx > loadEndIdx, 'replayed delta arrives AFTER load_end (anti-flicker ordering)');
    const deltas = frames.filter(f => f.event === 'v2_requests_delta');
    assert.equal(deltas.length, 1, 'window delta replayed exactly once');
    req.emit('close');
  });

  it('replays a raw v3_conv line broadcast in the window (sessionId-stamped)', async () => {
    const sid = await seedV2([mainAgentEntry('2026-06-06T01:00:00.000Z', 100)]);
    const req = new EventEmitter(); req.headers = {};
    const res = makeRes();
    const deps = eventsDeps();
    const p = events(req, res, url('/events'), true, deps);
    // v3_conv native forward shape: {"sessionId":...,"channel":...,"line":<raw conv event>}
    const convLine = JSON.stringify({ t: 'append', seq: 42, msgs: [{ role: 'assistant', content: 'live chunk' }] });
    sendEventRawToClients(deps.clients, 'v3_conv', `{"sessionId":${JSON.stringify(sid)},"channel":"main","line":${convLine}}`);
    await p;
    const frames = parseFrames(bodyStr(res));
    const loadEndIdx = frames.findIndex(f => f.event === 'load_end');
    // The cold bundle ALSO emits v3_conv frames (array-shaped `{lines:[...]}`) BEFORE
    // load_end, so a bare `event === 'v3_conv'` findIndex hits the cold frame, not the
    // replay. Match the replayed SINGLE-LINE envelope `{line:{...seq:42}}` instead.
    const convIdx = frames.findIndex((f) => {
      if (f.event !== 'v3_conv') return false;
      let d; try { d = JSON.parse(f.data); } catch { return false; }
      return d && d.line && Number.isInteger(d.line.seq) && d.line.seq === 42;
    });
    assert.ok(convIdx !== -1, 'window v3_conv line replayed');
    assert.ok(convIdx > loadEndIdx, 'replayed conv arrives after load_end');
    req.emit('close');
  });

  it('skips a replayed v3_conv frame the cold bundle already covered (no duplicate messages)', async () => {
    // Seed one completed main turn so the cold bundle carries its conv lines.
    const sid = await seedV2([mainAgentEntry('2026-06-06T01:00:00.000Z', 100)]);
    const req = new EventEmitter(); req.headers = {};
    const res = makeRes();
    const deps = eventsDeps();
    const p = events(req, res, url('/events'), true, deps);
    // Replay a conv line whose seq the cold bundle already includes (seq 1 = the first req).
    const dupConvLine = JSON.stringify({ t: 'snapshot', seq: 1, msgs: [{ role: 'user', content: 'hi' }] });
    sendEventRawToClients(deps.clients, 'v3_conv', `{"sessionId":${JSON.stringify(sid)},"channel":"main","line":${dupConvLine}}`);
    await p;
    const frames = parseFrames(bodyStr(res));
    const convFrames = frames.filter(f => f.event === 'v3_conv');
    // The cold bundle's own conv payload is a `lines` ARRAY frame; the replayed single
    // `line` frame for an already-covered seq must be skipped (not appended again).
    const singleLineDupes = convFrames.filter((f) => {
      let d; try { d = JSON.parse(f.data); } catch { return false; }
      return d && d.line && Number.isInteger(d.line.seq) && d.line.seq === 1;
    });
    assert.equal(singleLineDupes.length, 0, 'covered conv line NOT replayed (would double messages client-side)');
    req.emit('close');
  });

  it('overflow: a tiny byte cap degrades to dropping the window but still registers the client', async () => {
    const sid = await seedV2([mainAgentEntry('2026-06-06T01:00:00.000Z', 100)]);
    const req = new EventEmitter(); req.headers = {};
    const res = makeRes();
    const deps = eventsDeps({ attachBufferMaxBytes: 8 });
    const p = events(req, res, url('/events'), true, deps);
    sendEventToClients(deps.clients, 'v2_requests_delta', rowDeltaFrame(sid, 9)); // exceeds 8 bytes
    await p;
    const frames = parseFrames(bodyStr(res));
    assert.equal(frames.find(f => f.event === 'v2_requests_delta'), undefined, 'overflowed window not replayed (degrades to pre-fix)');
    assert.ok(frames.find(f => f.event === 'load_end'), 'cold load still completed');
    assert.equal(deps.clients.includes(res), true, 'real client still registered after overflow');
    assert.equal(deps.clients.some(c => c && c._ccvAttachBuffer === true), false);
    req.emit('close');
  });

  it('mid-cold-load close: dispose removes the proxy and nothing is written after close', async () => {
    await seedV2([mainAgentEntry('2026-06-06T01:00:00.000Z', 100)]);
    const req = new EventEmitter(); req.headers = {};
    const res = makeRes();
    const deps = eventsDeps();
    const p = events(req, res, url('/events'), true, deps);
    // Close while in the window: dispose must splice the proxy (and the real res never registers).
    res.emit('close');
    await p;
    assert.equal(deps.clients.length, 0, 'no client (proxy or real) left after mid-load close');
    assert.equal(deps.clients.some(c => c && c._ccvAttachBuffer === true), false);
  });

  it('no window traffic → byte-identical frame sequence to a clean cold load', async () => {
    await seedV2([mainAgentEntry('2026-06-06T01:00:00.000Z', 100)]);
    const req = new EventEmitter(); req.headers = {};
    const res = makeRes();
    const deps = eventsDeps();
    await events(req, res, url('/events'), true, deps);
    const frames = parseFrames(bodyStr(res));
    // Cold load shape unchanged: load_start … load_end, no stray replayed frames.
    assert.ok(frames.find(f => f.event === 'load_start'), 'load_start present');
    assert.ok(frames.find(f => f.event === 'load_end'), 'load_end present');
    assert.equal(frames.find(f => f.event === 'v2_requests_delta'), undefined, 'no delta when nothing landed in the window');
    req.emit('close');
  });

  it('ws-mux transport: a window delta is replayed after load_end on the mux sink too', async () => {
    // The attach buffer flushes through sink.write — the SAME egress on SSE and WS-mux —
    // so the WS-mux transport (the browser default) must replay the window identically.
    const sid = await seedV2([mainAgentEntry('2026-06-06T01:00:00.000Z', 100)]);
    const clients = [];
    const deps = eventsDeps({ clients });
    const mux = makeMuxSink();
    try {
      const params = eventsMod.paramsFromParsedUrl({ searchParams: new URLSearchParams('limit=400') });
      const p = eventsMod.serveEventStream(mux.sink, params, deps);
      // Inject a live delta into the window (the mux shim's registrable is the per-stream
      // shim, and the attach buffer proxy sits in clients alongside it during cold load).
      sendEventToClients(clients, 'v2_requests_delta', rowDeltaFrame(sid, 11));
      await p;
      const frames = mux.frames().filter(([n]) => n !== 'ping');
      const loadEndIdx = frames.findIndex(([n]) => n === 'load_end');
      const deltaIdx = frames.findIndex(([n]) => n === 'v2_requests_delta');
      assert.ok(loadEndIdx !== -1, 'load_end present on the mux stream');
      assert.ok(deltaIdx !== -1, 'window delta replayed on the mux stream');
      assert.ok(deltaIdx > loadEndIdx, 'replayed delta arrives after load_end on mux too');
      assert.equal(frames.filter(([n]) => n === 'v2_requests_delta').length, 1, 'replayed exactly once');
    } finally {
      mux.mux.close();
      if (mux.mux._sockets) mux.mux._sockets.forEach((st) => { st.pingTimer && clearInterval(st.pingTimer); });
    }
  });
});
