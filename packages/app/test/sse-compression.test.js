// Coverage target: wire compression end-to-end on the three negotiated routes
// (/events, /api/local-log, /api/requests) plus the log-watcher broadcast path.
// The load-bearing assertion is FRAME BYTE-EQUALITY: the brotli-decoded stream
// must equal the plaintext stream byte-for-byte, including every one-shot frame
// (server_config / load_start / load_end / context_window) — this is the
// regression net against a bare res.write leaking into a compressed response.
// Pattern mirrors test/api-events-gap.test.js (env before dynamic import,
// fixtures via interceptor._v2Writer, handlers invoked with fake req/res).
import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import zlib from 'node:zlib';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-sse-compression-'));
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
      tools: [{ name: 'Bash', description: 'run shell commands '.repeat(50) }],
      messages: [{ role: 'user', content: 'hi '.repeat(200) }],
    },
    response: { body: { usage: { input_tokens: inputTokens, output_tokens: 10 } } },
  };
}

/** Collecting fake res: keeps raw Buffers (compressed bytes must not be stringified). */
function makeRes() {
  const res = new EventEmitter();
  res.statusCode = 0;
  res.headers = null;
  res.chunks = [];
  res.ended = false;
  res.destroyed = false;
  res.writable = true;
  res.writeHead = (code, headers) => { res.statusCode = code; res.headers = headers || {}; return res; };
  res.write = (c) => { if (c != null) res.chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))); return true; };
  res.end = (c) => { if (c != null) res.write(c); res.ended = true; res.emit('finish'); return res; };
  res.body = () => Buffer.concat(res.chunks);
  res.on('error', () => {});
  return res;
}

const makeReq = (headers = {}) => { const req = new EventEmitter(); req.headers = headers; return req; };
const url = (pathname, query = {}) => ({ pathname, searchParams: new URLSearchParams(query) });
const tick = () => new Promise((resolve) => setImmediate(resolve));
/** Wall-clock wait (tick-count deadlines flake under parallel-suite CPU load). */
async function until(cond, ms = 10000) {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) await tick();
}

let events, requests, localLog, sendToClients, interceptor;

before(async () => {
  interceptor = await import('../server/interceptor.js');
  interceptor.initForWorkspace(join(tmpDir, 'cproj'), { forceNew: true });
  const eventsMod = await import('../server/routes/events.js');
  const logsMod = await import('../server/routes/logs.js');
  const watcher = await import('../server/lib/log-watcher.js');
  const find = (routes, p, m) => routes.find((r) => r.path === p && r.method === m).handler;
  events = find(eventsMod.eventsRoutes, '/events', 'GET');
  requests = find(eventsMod.eventsRoutes, '/api/requests', 'GET');
  localLog = logsMod.logsRoutes.find((r) => r.path === '/api/local-log').handler;
  sendToClients = watcher.sendToClients;
});

after(() => { rmSync(tmpDir, { recursive: true, force: true }); });
afterEach(() => { delete process.env.CCV_WIRE_COMPRESSION; });

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

const eventsDeps = (over = {}) => ({
  turnEndDebounceMs: 1234,
  DEFAULT_EVENTS_LIMIT: 400,
  SSE_BACKPRESSURE_TIMEOUT_MS: 1000,
  pendingMajorUpdate: null,
  clients: [],
  ...over,
});

describe('GET /events wire compression', () => {
  it('br-negotiated stream decodes byte-identical to the plaintext stream', async () => {
    await seedV2([mainAgentEntry('2026-07-16T01:00:00.000Z', 111), mainAgentEntry('2026-07-16T01:01:00.000Z', 222)]);

    const plainRes = makeRes();
    await events(makeReq({}), plainRes, url('/events'), true, eventsDeps());
    const plainText = plainRes.body().toString();
    assert.match(plainText, /event: load_end/);
    plainRes.emit('close');

    const brRes = makeRes();
    await events(makeReq({ 'accept-encoding': 'gzip, deflate, br, zstd' }), brRes, url('/events'), true, eventsDeps());
    assert.equal(brRes.headers['Content-Encoding'], 'br');
    assert.equal(brRes.headers['Vary'], 'Accept-Encoding');
    // Deterministic decode: end the encoder to finalize the stream, then
    // decompress synchronously. Polling a brotli *decoder* for output is fragile
    // under CI CPU load — zlib works on the libuv threadpool, so a fixed number
    // of event-loop turns is not a guarantee and the decode can come back empty.
    const enc = brRes._wireEnc;
    assert.ok(enc, 'br encoder exists');
    const compressedLen = brRes.body().length;
    enc.end();
    await until(() => brRes.ended);
    const decoded = zlib.brotliDecompressSync(brRes.body()).toString();
    brRes.emit('close');

    assert.equal(decoded, plainText); // every one-shot frame went through the encoder
    assert.ok(compressedLen < Buffer.byteLength(plainText) / 2, 'compression actually shrank the stream');
  });

  it('CCV_WIRE_COMPRESSION=off forces plaintext even with br offered', async () => {
    process.env.CCV_WIRE_COMPRESSION = 'off';
    await seedV2([mainAgentEntry('2026-07-16T02:00:00.000Z', 111)]);
    const res = makeRes();
    await events(makeReq({ 'accept-encoding': 'br' }), res, url('/events'), true, eventsDeps());
    assert.equal(res.headers['Content-Encoding'], undefined);
    assert.match(res.body().toString(), /event: load_end/);
    res.emit('close');
  });

  it('live broadcast reaches br and plaintext clients with the same frame', async () => {
    await seedV2([mainAgentEntry('2026-07-16T03:00:00.000Z', 111)]);
    const deps = eventsDeps();
    const plainRes = makeRes();
    await events(makeReq({}), plainRes, url('/events'), true, deps);
    const brRes = makeRes();
    await events(makeReq({ 'accept-encoding': 'br' }), brRes, url('/events'), true, deps);
    assert.equal(deps.clients.length, 2);

    const plainMark = plainRes.chunks.length;
    const entry = { timestamp: '2026-07-16T03:01:00.000Z', url: 'x', body: { messages: [] } };
    sendToClients(deps.clients, entry);
    await tick();
    const expected = `data: ${JSON.stringify(entry)}\n\n`;
    const plainTail = Buffer.concat(plainRes.chunks.slice(plainMark)).toString();
    assert.equal(plainTail, expected);

    // Deterministic decode: end the encoder to finalize the compressed stream,
    // then decompress synchronously. The polling-based decodeBr() is fragile
    // under CI CPU constraints (Node 24 zlib timing differs from local).
    const enc = brRes._wireEnc;
    assert.ok(enc, 'br encoder exists');
    // Wait for the scheduled flush to push the broadcast frame into the encoder's
    // internal pipeline (setImmediate in scheduleFlush). Without this, end() can
    // drain a still-empty encoder buffer and the broadcast frame never appears.
    await until(() => brRes.chunks.length > 0);
    enc.end();
    // Wait for the pipe to drain: end() sends FINISH through encoder -> pipe -> res.
    await until(() => brRes.ended);
    const decompressed = zlib.brotliDecompressSync(Buffer.concat(brRes.chunks)).toString();
    assert.ok(decompressed.includes(expected), 'compressed client received the broadcast frame');
    plainRes.emit('close');
    brRes.emit('close');
  });
});

describe('broadcast backpressure on compressed clients', () => {
  it('a >16KB live frame does not permanently stamp _sseBackpressureSince (healthy client not killed)', async () => {
    const deps = eventsDeps();
    const brRes = makeRes();
    await events(makeReq({ 'accept-encoding': 'br' }), brRes, url('/events'), true, deps);
    assert.equal(deps.clients.length, 1);

    // Large frame overflows the encoder's 16KB writable buffer → write() false
    // → _sseBackpressureSince stamped; the reset must arm on the ENCODER's
    // drain (the socket never backpressured), else the 30s timeout would kill
    // this healthy client on the next large frame.
    const bigEntry = { timestamp: '2026-07-16T06:00:00.000Z', url: 'x', body: { messages: [{ role: 'user', content: 'z'.repeat(64 * 1024) }] } };
    sendToClients(deps.clients, bigEntry);
    await until(() => brRes._sseBackpressureSince === 0);
    assert.ok(!brRes._sseBackpressureSince, 'backpressure stamp cleared via encoder drain');
    assert.equal(deps.clients.length, 1, 'healthy compressed client stays connected');
    brRes.emit('close');
  });
});

describe('GET /api/requests wire compression', () => {
  it('br body decodes to the identical JSON array', async () => {
    await seedV2([mainAgentEntry('2026-07-16T04:00:00.000Z', 111), mainAgentEntry('2026-07-16T04:01:00.000Z', 222)]);
    const plainRes = makeRes();
    await requests(makeReq({}), plainRes, url('/api/requests'), true, eventsDeps());
    const brRes = makeRes();
    await requests(makeReq({ 'accept-encoding': 'br' }), brRes, url('/api/requests'), true, eventsDeps());
    await until(() => brRes.ended);
    assert.equal(zlib.brotliDecompressSync(brRes.body()).toString(), plainRes.body().toString());
    assert.ok(Array.isArray(JSON.parse(plainRes.body().toString())));
  });
});

describe('GET /api/local-log wire compression', () => {
  it('br SSE snapshot decodes byte-identical to plaintext (v1 file path)', async () => {
    const fileName = 'compress-fixture.jsonl';
    const lines = [
      JSON.stringify({ timestamp: '2026-07-16T05:00:00.000Z', url: 'u1', body: { messages: [{ role: 'user', content: 'a'.repeat(500) }] } }),
      JSON.stringify({ timestamp: '2026-07-16T05:01:00.000Z', url: 'u2', body: { messages: [{ role: 'user', content: 'a'.repeat(500) }] } }),
    ];
    writeFileSync(join(tmpDir, fileName), lines.join('\n') + '\n');

    const plainRes = makeRes();
    await localLog(makeReq({}), plainRes, url('/api/local-log', { file: fileName }));
    const brRes = makeRes();
    await localLog(makeReq({ 'accept-encoding': 'br' }), brRes, url('/api/local-log', { file: fileName }));
    await until(() => brRes.ended);
    assert.equal(brRes.headers['Content-Encoding'], 'br');
    assert.equal(zlib.brotliDecompressSync(brRes.body()).toString(), plainRes.body().toString());
    assert.match(plainRes.body().toString(), /event: load_end/);
  });
});
