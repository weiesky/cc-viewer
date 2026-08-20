// Coverage target: the 4 surviving handlers in server/routes/events.js + sseUpdateBadgeFrame
// (wire-v2 1.7.0: /api/register-log and /api/resume-choice are GONE — asserted below).
//   sseUpdateBadgeFrame —— pure SSE frame formatting
//   GET  /events            events       —— server_config / update badge / load_start/chunk/end /
//                              context_window (from mainAgent) / context_window fallback (file) /
//                              limit param / clients push + close cleanup
//   GET  /api/requests      requests     —— streamed JSON array output
//   (/api/entries/page removed in 1.7.0 P3 — absence pinned below)
//   POST /api/turn-end-notify turnEndNotify —— 403 non-local / 403 bad token / 200 / 400 bad json / 16KB cap
// Pattern: create the temp LOG_DIR and set env BEFORE any dynamic import; the live read
// source is getLiveLogSource() (the current v2 session dir), so fixtures are seeded through
// interceptor._v2Writer (a fresh session id per seed call keeps tests isolated), then the
// handlers are invoked directly (EventEmitter fake req + collecting res).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-api-events-gap-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

function mainAgentEntry(ts, inputTokens, extra = {}) {
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
    ...extra,
  };
}

// A non-MainAgent (subagent) entry: no mainAgent flag, system text without
// "You are Claude Code" — the adapter re-derives mainAgent=false for it.
function subAgentEntry(ts, inputTokens) {
  return {
    timestamp: ts,
    url: 'https://api.anthropic.com/v1/messages',
    method: 'POST',
    status: 200,
    body: {
      model: 'claude-opus-4-8',
      system: [{ type: 'text', text: 'You are a helper subagent' }],
      tools: [{ name: 'Bash' }],
      messages: [{ role: 'user', content: 'hi' }],
    },
    response: { body: { usage: { input_tokens: inputTokens, output_tokens: 10 } } },
  };
}

/** 收集型 res（亦 EventEmitter，支持 res.on('close'/'error') 兜底 + write/end 收集 SSE 帧） */
function makeRes() {
  const res = new EventEmitter();
  res.statusCode = 0;
  res.headers = null;
  res.chunks = [];
  res.ended = false;
  res.destroyed = false;
  res.writable = true;
  res.writeHead = (code, headers) => { res.statusCode = code; res.headers = headers || {}; return res; };
  res.write = (c) => { if (c != null) res.chunks.push(Buffer.isBuffer(c) ? c.toString('utf-8') : String(c)); return true; };
  res.end = (c) => { if (c != null) res.chunks.push(Buffer.isBuffer(c) ? c.toString('utf-8') : String(c)); res.ended = true; res.emit('finish'); return res; };
  res.on('error', () => {});
  return res;
}
function bodyStr(res) { return res.chunks.join(''); }

/** 解析 SSE 帧块（event/data） */
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

function url(pathname, query = {}) {
  const sp = new URLSearchParams(query);
  return { pathname, searchParams: sp };
}

let events, sseUpdateBadgeFrame, requests, turnEndNotify;
let interceptor, eventsMod;

before(async () => {
  interceptor = await import('../server/interceptor.js');
  interceptor.initForWorkspace(join(tmpDir, 'evproj'), { forceNew: true });

  eventsMod = await import('../server/routes/events.js');
  sseUpdateBadgeFrame = eventsMod.sseUpdateBadgeFrame;
  const find = (p, m) => eventsMod.eventsRoutes.find((r) => r.path === p && r.method === m).handler;
  events = find('/events', 'GET');
  requests = find('/api/requests', 'GET');
  turnEndNotify = find('/api/turn-end-notify', 'POST');
});

after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

// Seed the LIVE v2 session (the read source of /events, /api/requests and the
// default-file /api/entries/page): a fresh session id per call so each test
// sees exactly its own entries — getLiveLogSource() follows the latest sid.
let sidCounter = 0;
async function seedV2(entries) {
  const w = interceptor._v2Writer;
  w.resetSessions();
  const sid = `10000000-0000-4000-8000-${String(++sidCounter).padStart(12, '0')}`;
  for (const e of entries) {
    e.body.metadata = { user_id: JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: sid }) };
    const h = w.ingestRequest(e, e.body.messages);
    w.ingestCompletion(h, e);
  }
  await w.flush();
}

// ---------------------------------------------------------------------------
describe('removed routes (wire-v2 1.7.0)', () => {
  it('register-log and resume-choice are no longer routed', () => {
    assert.equal(eventsMod.eventsRoutes.find((r) => r.path === '/api/register-log'), undefined);
    assert.equal(eventsMod.eventsRoutes.find((r) => r.path === '/api/resume-choice'), undefined);
  });
});

// ---------------------------------------------------------------------------
describe('sseUpdateBadgeFrame', () => {
  it('returns a formatted SSE frame when pending is set', () => {
    const frame = sseUpdateBadgeFrame({ version: '1.7.0', source: 'npm' });
    assert.equal(frame, 'event: update_major_available\ndata: {"version":"1.7.0","source":"npm"}\n\n');
  });
  it('returns null when pending is falsy', () => {
    assert.equal(sseUpdateBadgeFrame(null), null);
    assert.equal(sseUpdateBadgeFrame(undefined), null);
  });
});

// ---------------------------------------------------------------------------
describe('GET /events', () => {
  function eventsDeps(over = {}) {
    return {
      turnEndDebounceMs: 1234,
      DEFAULT_EVENTS_LIMIT: 400,
      SSE_BACKPRESSURE_TIMEOUT_MS: 1000,
      pendingMajorUpdate: null,
      clients: [],
      ...over,
    };
  }

  it('emits server_config first, then load_start/load_chunk*/load_end and a context_window', async () => {
    await seedV2([
      mainAgentEntry('2026-06-06T01:00:00.000Z', 111),
      mainAgentEntry('2026-06-06T01:01:00.000Z', 222),
    ]);
    const req = new EventEmitter();
    req.headers = {};
    const res = makeRes();
    const deps = eventsDeps();
    await events(req, res, url('/events'), true, deps);
    const out = bodyStr(res);
    const frames = parseFrames(out);
    // server_config 携带 turnEndDebounceMs
    const sc = frames.find((f) => f.event === 'server_config');
    assert.ok(sc, 'server_config emitted');
    assert.equal(JSON.parse(sc.data).turnEndDebounceMs, 1234);
    // load_start → load_chunk×2 → load_end
    assert.ok(frames.find((f) => f.event === 'load_start'));
    assert.equal(frames.filter((f) => f.event === 'load_chunk').length, 2);
    assert.ok(frames.find((f) => f.event === 'load_end'));
    // context_window 反映最后一条 mainAgent (222)
    const cw = frames.find((f) => f.event === 'context_window');
    assert.ok(cw, 'context_window emitted');
    assert.equal(JSON.parse(cw.data).total_input_tokens, 222);
    // 客户端被推入 clients 列表（load 全部完成后）
    assert.ok(deps.clients.includes(res), 'res pushed to clients after load');
  });

  it('补推 update badge frame when deps.pendingMajorUpdate is set', async () => {
    await seedV2([mainAgentEntry('2026-06-06T01:00:00.000Z', 50)]);
    const req = new EventEmitter(); req.headers = {};
    const res = makeRes();
    await events(req, res, url('/events'), true, eventsDeps({ pendingMajorUpdate: { version: '9.9.9', source: 'gh' } }));
    const frames = parseFrames(bodyStr(res));
    const badge = frames.find((f) => f.event === 'update_major_available');
    assert.ok(badge, 'update badge補推');
    assert.equal(JSON.parse(badge.data).version, '9.9.9');
  });

  it('honours an explicit ?limit and reports hasMore in load_start', async () => {
    await seedV2(Array.from({ length: 5 }, (_, i) => mainAgentEntry(`2026-06-06T01:0${i}:00.000Z`, 100 + i)));
    const req = new EventEmitter(); req.headers = {};
    const res = makeRes();
    await events(req, res, url('/events', { limit: '2' }), true, eventsDeps());
    const frames = parseFrames(bodyStr(res));
    const ls = frames.find((f) => f.event === 'load_start');
    const data = JSON.parse(ls.data);
    assert.ok('hasMore' in data, 'limit mode load_start carries hasMore');
    assert.equal(data.hasMore, true);
    assert.ok('oldestTs' in data);
  });

  it('removes res from clients on req close (cleanup)', async () => {
    await seedV2([mainAgentEntry('2026-06-06T01:00:00.000Z', 10)]);
    const req = new EventEmitter(); req.headers = {};
    const res = makeRes();
    const deps = eventsDeps();
    await events(req, res, url('/events'), true, deps);
    assert.ok(deps.clients.includes(res));
    req.emit('close');
    assert.equal(deps.clients.includes(res), false, 'res removed from clients on close');
  });

  it('task B: with NO current session, cold-load falls back to the latest prior session', async () => {
    // Seed a prior MAIN session, then reset so there is no current session
    // (getLiveLogSource() → currentSessionDir()=null → picker). The /events
    // cold-load must stream that prior session instead of an empty panel, and
    // derive context_window from ITS mainAgent — not the file fallback.
    await seedV2([
      mainAgentEntry('2026-06-06T02:00:00.000Z', 777),
      mainAgentEntry('2026-06-06T02:01:00.000Z', 888),
    ]);
    interceptor._v2Writer.resetSessions(); // dir persists on disk; _currentSid → null
    assert.equal(interceptor._v2Writer.currentSessionDir(), null, 'no current session after reset');

    const req = new EventEmitter(); req.headers = {};
    const res = makeRes();
    await events(req, res, url('/events'), true, eventsDeps());
    const frames = parseFrames(bodyStr(res));
    assert.equal(frames.filter((f) => f.event === 'load_chunk').length, 2, 'streams the prior session, not empty');
    const cw = frames.find((f) => f.event === 'context_window');
    assert.ok(cw, 'context_window from the fallback session mainAgent');
    assert.equal(JSON.parse(cw.data).total_input_tokens, 888, 'newest mainAgent of the fallback session');
  });

  it('falls back to context-window.json when the log has no MainAgent', async () => {
    // Only a subagent entry → no real mainAgent → CONTEXT_WINDOW_FILE fallback.
    // Clear prior on-disk sessions first: the sub-only current session has no
    // main turn, so getLiveLogSource() would otherwise fall back to an earlier
    // test's leftover main session (task B refresh fix) and read ITS mainAgent.
    rmSync(join(tmpDir, 'evproj', 'sessions'), { recursive: true, force: true });
    await seedV2([subAgentEntry('2026-06-06T01:00:00.000Z', 333)]);
    const cwFile = join(tmpDir, 'context-window.json');
    writeFileSync(cwFile, JSON.stringify({
      context_window: { total_input_tokens: 1000, total_output_tokens: 200 },
    }));
    const req = new EventEmitter(); req.headers = {};
    const res = makeRes();
    await events(req, res, url('/events'), true, eventsDeps());
    const frames = parseFrames(bodyStr(res));
    const cw = frames.find((f) => f.event === 'context_window');
    assert.ok(cw, 'fallback context_window emitted from file');
    const data = JSON.parse(cw.data);
    assert.equal(data.total_input_tokens, 1000);
    assert.ok('used_percentage' in data);
    // 清理 fallback 文件，避免影响后续用例
    rmSync(cwFile, { force: true });
  });
});

// ---------------------------------------------------------------------------
describe('GET /api/requests', () => {
  it('streams a JSON array of raw entries', async () => {
    await seedV2([
      mainAgentEntry('2026-06-06T01:00:00.000Z', 1),
      mainAgentEntry('2026-06-06T01:01:00.000Z', 2),
    ]);
    const res = makeRes();
    await requests({ headers: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Content-Type'], 'application/json');
    const arr = JSON.parse(bodyStr(res));
    assert.ok(Array.isArray(arr));
    assert.equal(arr.length, 2);
    assert.equal(arr[0].response.body.usage.input_tokens, 1);
    assert.equal(arr[1].response.body.usage.input_tokens, 2);
  });
});

// ---------------------------------------------------------------------------
describe('GET /api/entries/page (removed in 1.7.0 P3)', () => {
  it('route is gone from eventsRoutes', () => {
    assert.equal(eventsMod.eventsRoutes.find((r) => r.path === '/api/entries/page'), undefined);
  });
});

// ---------------------------------------------------------------------------
describe('POST /api/turn-end-notify', () => {
  const TOKEN = 'secret-bridge-token';
  function depsT() {
    return {
      INTERNAL_TOKEN: TOKEN,
      scheduleTurnEndBroadcast: (...args) => { depsT._calls = (depsT._calls || []); depsT._calls.push(args); },
    };
  }

  function postT({ isLocal = true, headers = {}, body = '' } = {}, deps) {
    const req = new EventEmitter();
    req.headers = headers;
    req.destroy = () => { req.destroyed = true; };
    const res = makeRes();
    return new Promise((resolve) => {
      res.on('finish', () => resolve(res));
      turnEndNotify(req, res, url('/api/turn-end-notify'), isLocal, deps);
      if (body) req.emit('data', body);
      req.emit('end');
      // 无 body 时也要 resolve（end 立即触发）
      if (!body) setImmediate(() => { if (!res.ended) resolve(res); else resolve(res); });
    });
  }

  it('403 when not loopback', async () => {
    const res = await postT({ isLocal: false }, depsT());
    assert.equal(res.statusCode, 403);
    assert.match(JSON.parse(bodyStr(res)).error, /Loopback only/);
  });

  it('403 when bridge token is missing/invalid', async () => {
    const res = await postT({ headers: { 'x-ccviewer-internal': 'wrong' } }, depsT());
    assert.equal(res.statusCode, 403);
    assert.match(JSON.parse(bodyStr(res)).error, /Invalid bridge token/);
  });

  it('200 and schedules a broadcast with the valid token', async () => {
    depsT._calls = [];
    const deps = depsT();
    const res = await postT({
      headers: { 'x-ccviewer-internal': TOKEN },
      body: JSON.stringify({ sessionId: 's1', ts: 999, transcriptPath: '/p' }),
    }, deps);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(bodyStr(res)), { ok: true });
    assert.equal(depsT._calls.length, 1, 'scheduleTurnEndBroadcast called once');
    assert.deepEqual(depsT._calls[0], ['s1', 999, '/p']);
  });

  it('400 on malformed JSON body (valid token)', async () => {
    const res = await postT({ headers: { 'x-ccviewer-internal': TOKEN }, body: '{bad json' }, depsT());
    assert.equal(res.statusCode, 400);
    assert.match(JSON.parse(bodyStr(res)).error, /malformed JSON/);
  });

  it('destroys the request and never responds when body exceeds 16KB', async () => {
    const deps = depsT();
    const req = new EventEmitter();
    req.headers = { 'x-ccviewer-internal': TOKEN };
    let destroyed = false;
    req.destroy = () => { destroyed = true; };
    const res = makeRes();
    turnEndNotify(req, res, url('/api/turn-end-notify'), true, deps);
    req.emit('data', 'x'.repeat(16385));
    assert.equal(destroyed, true, 'req destroyed on oversize body');
    req.emit('end');
    // truncated 路径 return 前不写响应
    assert.equal(res.ended, false, 'no response written after destroy');
  });
});
