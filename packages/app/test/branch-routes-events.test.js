// Branch completion: server/routes/events.js — residual arms not reached by
// api-events-gap / events-deep / events-kv-context-scan / events-backpressure.
// wire-v2 (1.7.0): register-log / resume-choice routes and the v1 LOG_FILE are
// gone; the live read source is getLiveLogSource() (current v2 session dir).
// Covered here:
//   turnEndNotify: empty body → JSON {} arm; sessionId/ts/transcriptPath default arms
//   /events: ping write catch; incremental all-true path (projectMatch right arm);
//            load_chunk res.destroyed early-return; mainAgent ring skips the
//            newest candidate without usage (newest-first iteration arm)
//   (/api/entries/page removed in 1.7.0 P3)
//                JSON.parse throw inside entries.map → null filtered (via a legacy
//                v1 .jsonl file param — the file-param read path still accepts them)
//
// Isolation pattern (same as events-deep.test.js): cold-start mode — env / cwd
// must be set BEFORE importing the interceptor so the project binding resolves
// to the private tmp dir. CCV_PROXY_MODE=1 skips http patch + server autostart.
// Handlers are invoked directly (EventEmitter fake req + collecting res).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { tmpdir } from 'node:os';

// ── Cold-start isolation: env / cwd BEFORE importing the interceptor ─────────
const tmpRoot = mkdtempSync(join(tmpdir(), 'ccv-branch-events-'));
const logRoot = join(tmpRoot, 'logs');
const projectCwd = join(tmpRoot, 'evbranchproj');
mkdirSync(logRoot, { recursive: true });
mkdirSync(projectCwd, { recursive: true });
process.env.CCV_LOG_DIR = logRoot;
process.env.CLAUDE_CONFIG_DIR = logRoot;
process.env.CCV_PROXY_MODE = '1';        // skip http patch + server autostart
delete process.env.CCV_WORKSPACE_MODE;   // cold-start project binding from cwd
delete process.env.CCV_CLI_MODE;
delete process.env.CCV_IM_PLATFORM;
const origCwd = process.cwd();
process.chdir(projectCwd);

const projectName = basename(projectCwd).replace(/[^a-zA-Z0-9_\-\.]/g, '_');
const projectLogDir = join(logRoot, projectName);
mkdirSync(projectLogDir, { recursive: true });

const SEP = '\n---\n';

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
function serialize(entries) { return entries.map((e) => JSON.stringify(e)).join(SEP) + SEP; }

/** 收集型 res（EventEmitter，可注入 onWrite 行为） */
function makeRes(opts = {}) {
  const res = new EventEmitter();
  res.statusCode = 0;
  res.headers = null;
  res.chunks = [];
  res.ended = false;
  res.destroyed = false;
  res.writable = true;
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

let interceptor;
let events, turnEndNotify;
let eventsMod;

before(async () => {
  interceptor = await import('../server/interceptor.js');
  await interceptor._initPromise;
  assert.equal(interceptor._projectName, projectName);

  eventsMod = await import('../server/routes/events.js');
  const find = (p, m) => eventsMod.eventsRoutes.find((r) => r.path === p && r.method === m).handler;
  events = find('/events', 'GET');
  turnEndNotify = find('/api/turn-end-notify', 'POST');
  // wire-v2: register-log / resume-choice must no longer be routed
  assert.equal(eventsMod.eventsRoutes.find((r) => r.path === '/api/register-log'), undefined);
  assert.equal(eventsMod.eventsRoutes.find((r) => r.path === '/api/resume-choice'), undefined);
});

after(() => {
  process.chdir(origCwd);
  rmSync(tmpRoot, { recursive: true, force: true });
});

// Seed the LIVE v2 session (read source of /events and default-file
// the removed paging route): fresh session id per call so each test sees only its entries.
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

function eventsDeps(over = {}) {
  return {
    turnEndDebounceMs: 1234,
    DEFAULT_EVENTS_LIMIT: 400,
    SSE_BACKPRESSURE_TIMEOUT_MS: 30,
    pendingMajorUpdate: null,
    clients: [],
    ...over,
  };
}

// ---------------------------------------------------------------------------
describe('POST /api/turn-end-notify 默认臂', () => {
  const TOKEN = 'tok-branch';
  function depsT(calls) {
    return { INTERNAL_TOKEN: TOKEN, scheduleTurnEndBroadcast: (...a) => calls.push(a) };
  }

  it('空 body → JSON.parse 走 {} 臂，sessionId/ts/transcriptPath 取默认值', async () => {
    const calls = [];
    const req = new EventEmitter();
    req.headers = { 'x-ccviewer-internal': TOKEN };
    req.destroy = () => {};
    const res = makeRes();
    const beforeTs = Date.now();
    await new Promise((resolve) => {
      res.on('finish', resolve);
      turnEndNotify(req, res, url('/api/turn-end-notify'), true, depsT(calls));
      req.emit('end'); // 不发 data → body === '' → payload = {}
    });
    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 1);
    const [sid, ts, tp] = calls[0];
    assert.equal(sid, null, 'sessionId 默认 null');
    assert.equal(tp, null, 'transcriptPath 默认 null');
    assert.ok(typeof ts === 'number' && ts >= beforeTs, 'ts 默认 Date.now()');
  });
});

// ---------------------------------------------------------------------------
describe('POST /api/session-start-notify（/resume 会话切换信号）', () => {
  const TOKEN = 'tok-branch';
  const notifyHandler = () => eventsMod.eventsRoutes.find((r) => r.path === '/api/session-start-notify' && r.method === 'POST').handler;
  function depsS(calls) {
    return { INTERNAL_TOKEN: TOKEN, onSessionStartNotify: (p) => calls.push(p) };
  }
  function drive({ isLocal = true, token = TOKEN, body = null, deps }) {
    const req = new EventEmitter();
    req.headers = token === undefined ? {} : { 'x-ccviewer-internal': token };
    req.destroy = () => {};
    const res = makeRes();
    return new Promise((resolve) => {
      res.on('finish', () => resolve(res));
      notifyHandler()(req, res, url('/api/session-start-notify'), isLocal, deps);
      if (body !== null) req.emit('data', body);
      req.emit('end');
    });
  }

  it('非 loopback → 403，回调不触发', async () => {
    const calls = [];
    const res = await drive({ isLocal: false, deps: depsS(calls) });
    assert.equal(res.statusCode, 403);
    assert.equal(calls.length, 0);
  });

  it('token 不符 → 403', async () => {
    const calls = [];
    const res = await drive({ token: 'wrong', deps: depsS(calls) });
    assert.equal(res.statusCode, 403);
    assert.equal(calls.length, 0);
  });

  it('坏 JSON → 400', async () => {
    const calls = [];
    const res = await drive({ body: '{{nope', deps: depsS(calls) });
    assert.equal(res.statusCode, 400);
    assert.equal(calls.length, 0);
  });

  it('合法载荷 → 200 且原样递交 deps.onSessionStartNotify', async () => {
    const calls = [];
    const payload = { source: 'resume', sessionId: 's1', transcriptPath: '/t/orig.jsonl', cwd: '/w', ts: 1 };
    const res = await drive({ body: JSON.stringify(payload), deps: depsS(calls) });
    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], payload);
  });

  it('回调抛异常 → 被吞（reportSwallowed），仍 200', async () => {
    const res = await drive({
      body: JSON.stringify({ source: 'resume' }),
      deps: { INTERNAL_TOKEN: TOKEN, onSessionStartNotify: () => { throw new Error('boom'); } },
    });
    assert.equal(res.statusCode, 200);
  });
});

// ---------------------------------------------------------------------------
describe('GET /events 写路径 + 扫描分支', () => {
  it('ping write catch：ping write 抛被吞', async (t) => {
    await seedV2([mainAgentEntry('2026-06-06T01:00:00.000Z', 10)]);
    t.mock.timers.enable({ apis: ['setInterval'] });
    const req = new EventEmitter(); req.headers = {};
    const res = makeRes({ onWrite(s) { if (s.startsWith('event: ping')) throw new Error('ping pipe gone'); } });
    const deps = eventsDeps();
    await events(req, res, url('/events'), true, deps);
    // 触发 30s ping 回调 → res.write 抛 → catch 吞掉，不抛穿
    assert.doesNotThrow(() => t.mock.timers.tick(30000));
    req.emit('close'); // clearInterval
    t.mock.timers.reset();
  });

  it('incremental 全真路径：projectMatch 右臂 + since/limit 三元 true 臂', async () => {
    await seedV2([
      mainAgentEntry('2026-06-06T01:00:00.000Z', 1),
      mainAgentEntry('2026-06-06T01:01:00.000Z', 2),
      mainAgentEntry('2026-06-06T01:02:00.000Z', 3),
    ]);
    const req = new EventEmitter(); req.headers = {};
    const res = makeRes();
    const deps = eventsDeps();
    // since=有效 ISO & cc>0 & project===_projectName & 日期有效 → useIncremental=true
    await events(req, res, url('/events', {
      since: '2026-06-06T01:00:30.000Z', cc: '1', project: projectName,
    }), true, deps);
    const frames = parseFrames(bodyStr(res));
    const ls = frames.find((f) => f.event === 'load_start');
    assert.ok(ls, 'load_start 存在');
    const lsData = JSON.parse(ls.data);
    assert.equal(lsData.incremental, true, 'incremental 模式标记');
    assert.equal('hasMore' in lsData, false, 'incremental 不附 hasMore（useLimit=false）');
    const chunks = frames.filter((f) => f.event === 'load_chunk');
    assert.ok(chunks.length >= 1, 'incremental 流式 load_chunk');
  });

  it('load_chunk res.destroyed 早退', async () => {
    await seedV2([mainAgentEntry('2026-06-06T01:00:00.000Z', 5), mainAgentEntry('2026-06-06T01:01:00.000Z', 6)]);
    const req = new EventEmitter(); req.headers = {};
    const res = makeRes();
    res.destroyed = true; // 进入流回调即早退
    const deps = eventsDeps();
    await events(req, res, url('/events'), true, deps);
    const frames = parseFrames(bodyStr(res));
    assert.equal(frames.filter((f) => f.event === 'load_chunk').length, 0, 'destroyed 时无 load_chunk');
  });

  it('mainAgent ring newest-first: newest candidate without usage is skipped', async () => {
    // Entry B (newest) completes WITHOUT usage → the ring loop continues to the
    // older candidate A, whose usage feeds context_window (newest-first arm).
    const a = mainAgentEntry('2026-06-06T01:00:00.000Z', 77);
    const b = mainAgentEntry('2026-06-06T01:01:00.000Z', 0);
    b.response = { body: { content: [] } }; // no usage
    await seedV2([a, b]);
    const req = new EventEmitter(); req.headers = {};
    const res = makeRes();
    await events(req, res, url('/events'), true, eventsDeps());
    const frames = parseFrames(bodyStr(res));
    const cw = frames.find((f) => f.event === 'context_window');
    assert.ok(cw, 'context_window from the older ring candidate');
    assert.equal(JSON.parse(cw.data).total_input_tokens, 77);
  });
});

// ---------------------------------------------------------------------------
