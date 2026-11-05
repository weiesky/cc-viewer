/**
 * wire-v2 sharding (2026-11) — ROUTE-level coverage for the "load earlier
 * history" streams. v2-shard-routes.test.js pins the READER
 * (readV2ShardEntries); this file pins the two SSE routes over it:
 *
 *   /events?sid=<uuid>&shardBefore=<seq>
 *     - load_start carries shard {prepend:true, oldestSeq, hasMore, partIndex}
 *     - each entry ships as its own one-element load_chunk, then load_end
 *     - the stream returns without registering a live client
 *     - shardBefore = 0/invalid falls through to the normal cold load
 *   /api/local-log?file=v2:...&shardBefore=<seq>
 *     - same shard branch over the read-only local-log view
 *
 * Deterministic fixture: a real V2Writer (shardPrompts seam = 3) produces a
 * session with frozen parts/<N>/ shards; the routes run against in-memory
 * req/res shims (no network). Env/cwd isolation mirrors
 * events-attach-buffer.test.js (CCV_PROXY_MODE=1, project cwd, CCV_LOG_DIR).
 */
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';

const tmpRoot = mkdtempSync(join(tmpdir(), 'ccv-shard-routes-'));
const logRoot = join(tmpRoot, 'logs');
const projectCwd = join(tmpRoot, 'shardrouteproj');
mkdirSync(logRoot, { recursive: true });
mkdirSync(projectCwd, { recursive: true });
process.env.CCV_LOG_DIR = logRoot;
process.env.CCV_PROXY_MODE = '1';
delete process.env.CCV_WORKSPACE_MODE;
delete process.env.CCV_CLI_MODE;
delete process.env.CCV_IM_PLATFORM;
const origCwd = process.cwd();
process.chdir(projectCwd);
// Plaintext wire: the in-memory res shim is not a zlib target, and the frame
// assertions read raw bytes.
process.env.CCV_WIRE_COMPRESSION = 'off';

const projectName = basename(projectCwd).replace(new RegExp('[^a-zA-Z0-9_\\-.]', 'g'), '_');
mkdirSync(join(logRoot, projectName), { recursive: true });

const SID = 'c1234567-89ab-4cde-8f01-23456789abcd';
const userIdOf = (sid) => JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: sid });
const textMsg = (role, text) => ({ role, content: [{ type: 'text', text }] });

let tsCounter = 0;
function nextTs() { return new Date(Date.UTC(2026, 6, 14, 5, 0, 0, ++tsCounter)).toISOString(); }
function mainEntry(messages) {
  return {
    timestamp: nextTs(), project: projectName,
    url: 'https://api.anthropic.com/v1/messages?beta=true', method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { model: 'claude-fable-5', system: [{ type: 'text', text: 'sys' }], tools: [{ name: 'Bash' }], metadata: { user_id: userIdOf(SID) }, messages },
    response: null, duration: 0, isStream: false, isHeartbeat: false, isCountTokens: false,
    mainAgent: true, requestId: `rid_${++tsCounter}`,
  };
}
function fire(entry) {
  const w = interceptor._v2Writer;
  const h = w.ingestRequest(entry, entry.body.messages);
  if (h) {
    w.ingestCompletion(h, { ...entry, response: { status: 200, headers: {}, body: { content: [], stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 7 } } }, duration: 1 });
  }
  return h;
}
/** One NEW user-prompt turn onto the running conversation. */
function fireTurn(msgs) {
  msgs.push(textMsg('assistant', `a${msgs.length}`), textMsg('user', `u${msgs.length}`));
  fire(mainEntry([...msgs]));
}

const SHARD_PROMPTS = 3;
/** Build a session with `shardCount` frozen shards + a live active tail. */
async function seedShardedSession(shardCount = 1) {
  const w = interceptor._v2Writer;
  w.resetSessions();
  const msgs = [textMsg('user', 'turn 1')];
  fire(mainEntry([...msgs])); // prompt 1
  for (let shard = 0; shard < shardCount; shard++) {
    for (let i = 0; i < SHARD_PROMPTS; i++) fireTurn(msgs);
    await w.flush();
    await new Promise((r) => setImmediate(r));
    await w.flush();
  }
  fireTurn(msgs); // one final prompt on the active tail
  await w.flush();
  await new Promise((r) => setImmediate(r));
  await w.flush();
}

let interceptor, eventsMod, logsMod, resolveSessionDirName;

before(async () => {
  interceptor = await import('../server/interceptor.js');
  await interceptor._initPromise;
  assert.equal(interceptor._projectName, projectName);
  // Shrink the shard threshold via the writer seam (env-free, per feature contract).
  interceptor._v2Writer._shardPrompts = SHARD_PROMPTS;
  eventsMod = await import('../server/routes/events.js');
  logsMod = await import('../server/routes/logs.js');
  ({ resolveSessionDirName } = await import('../server/lib/v2/session-select.js'));
});

after(() => {
  process.chdir(origCwd);
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
});

function makeRes() {
  const res = new EventEmitter();
  res.statusCode = 0; res.headers = null; res.chunks = []; res.ended = false;
  res.destroyed = false; res.writable = true;
  res.writeHead = (code, headers) => { res.statusCode = code; res.headers = headers || {}; res.headersSent = true; return res; };
  res.write = (c) => { res.chunks.push(Buffer.isBuffer(c) ? c.toString('utf-8') : String(c)); return true; };
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
function eventsDeps(over = {}) {
  return { turnEndDebounceMs: 1234, DEFAULT_EVENTS_LIMIT: 400, SSE_BACKPRESSURE_TIMEOUT_MS: 50, pendingMajorUpdate: null, clients: [], wireV3: true, ...over };
}

let eventsHandler, localLogHandler;
beforeEach(async () => {
  if (!eventsHandler) eventsHandler = eventsMod.eventsRoutes.find((r) => r.path === '/events' && r.method === 'GET').handler;
  if (!localLogHandler) localLogHandler = logsMod.logsRoutes.find((r) => r.path === '/api/local-log' && r.method === 'GET').handler;
  await seedShardedSession(1);
});

describe('/events?sid&shardBefore (route level)', () => {
  it('serves the frozen shard: load_start shard frame, per-entry chunks, load_end, no live client', async () => {
    // Cursor into the newest frozen shard: seq 1 (beforeSeq-1 = 0 → first shard).
    const req = new EventEmitter(); req.headers = {};
    const res = makeRes();
    const deps = eventsDeps();
    await eventsHandler(req, res, url('/events', { sid: SID, shardBefore: '2', limit: '400' }), true, deps);
    const frames = parseFrames(bodyStr(res));
    const start = frames.find((f) => f.event === 'load_start');
    assert.ok(start, 'load_start present');
    const startData = JSON.parse(start.data);
    assert.ok(startData.shard && typeof startData.shard === 'object', 'load_start carries a shard block');
    assert.equal(startData.shard.prepend, true, 'shard frame is marked prepend (client must not reset baseline)');
    assert.equal(typeof startData.shard.partIndex, 'number');
    assert.ok(startData.shard.oldestSeq === null || startData.shard.oldestSeq > 0, 'oldestSeq cursor shape');
    const chunks = frames.filter((f) => f.event === 'load_chunk');
    assert.ok(chunks.length > 0, 'shard entries delivered as load_chunk frames');
    for (const c of chunks) {
      const arr = JSON.parse(c.data);
      assert.ok(Array.isArray(arr) && arr.length === 1, 'one entry per chunk');
    }
    assert.ok(frames.find((f) => f.event === 'load_end'), 'load_end present');
    assert.equal(deps.clients.includes(res), false, 'the real res never becomes a live client on a shard stream');
    req.emit('close');
  });

  it('shardBefore=abc (invalid) falls through to the normal cold load', async () => {
    const req = new EventEmitter(); req.headers = {};
    const res = makeRes();
    const deps = eventsDeps();
    await eventsHandler(req, res, url('/events', { sid: SID, shardBefore: 'abc', limit: '400' }), true, deps);
    const frames = parseFrames(bodyStr(res));
    const start = frames.find((f) => f.event === 'load_start');
    assert.ok(start, 'normal cold load_start present');
    const startData = JSON.parse(start.data);
    // Normal cold load: no prepend flag (a baseline, not a shard page).
    assert.ok(!startData.shard || startData.shard.prepend !== true, 'not treated as a shard prepend load');
    req.emit('close');
  });

  it('cold load on a sharded session exposes the initial shard cursor (hasMore + oldestSeq + sid)', async () => {
    const req = new EventEmitter(); req.headers = {};
    const res = makeRes();
    const deps = eventsDeps();
    await eventsHandler(req, res, url('/events', { sid: SID, limit: '400' }), true, deps);
    const frames = parseFrames(bodyStr(res));
    const start = frames.find((f) => f.event === 'load_start');
    const startData = JSON.parse(start.data);
    assert.ok(startData.shard, 'sharded session cold load carries the cursor');
    assert.equal(startData.shard.hasMore, true);
    assert.ok(startData.shard.oldestSeq > 0, 'cursor points past the newest frozen cut');
    assert.equal(startData.shard.sid, SID, 'cursor carries the session UUID for the follow-latest view');
    assert.ok(!startData.shard.prepend, 'initial cursor is not a prepend load');
    req.emit('close');
  });
});

describe('/api/local-log?file=v2:...&shardBefore (route level)', () => {
  it('serves the frozen shard over the read-only local-log view', async () => {
    const dirName = resolveSessionDirName(join(logRoot, projectName), SID);
    assert.ok(dirName, 'session dir resolvable for the v2 ref');
    const req = new EventEmitter(); req.headers = {};
    const res = makeRes();
    await localLogHandler(req, res, url('/api/local-log', { file: `v2:${projectName}/${dirName}`, shardBefore: '2' }), true, {});
    const frames = parseFrames(bodyStr(res));
    const start = frames.find((f) => f.event === 'load_start');
    assert.ok(start, 'load_start present');
    const startData = JSON.parse(start.data);
    assert.ok(startData.shard && startData.shard.prepend === true, 'local-log shard load is marked prepend');
    assert.ok(frames.filter((f) => f.event === 'load_chunk').length > 0, 'entries delivered');
    assert.ok(frames.find((f) => f.event === 'load_end'), 'load_end present');
    req.emit('close');
  });

  it('local-log cold load on a sharded session exposes the initial shard cursor', async () => {
    const dirName = resolveSessionDirName(join(logRoot, projectName), SID);
    assert.ok(dirName, 'session dir resolvable for the v2 ref');
    const req = new EventEmitter(); req.headers = {};
    const res = makeRes();
    await localLogHandler(req, res, url('/api/local-log', { file: `v2:${projectName}/${dirName}` }), true, {});
    const frames = parseFrames(bodyStr(res));
    const start = frames.find((f) => f.event === 'load_start');
    assert.ok(start, 'load_start present');
    const startData = JSON.parse(start.data);
    assert.ok(startData.shard && startData.shard.hasMore === true && startData.shard.oldestSeq > 0,
      'local-log exposes the same initial cursor');
    req.emit('close');
  });
});
