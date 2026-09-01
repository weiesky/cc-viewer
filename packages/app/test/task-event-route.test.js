/**
 * task-event-route.test.js — handler-level coverage for POST /api/task-event
 * (routes/events.js taskEventNotify), following the api-events-gap.test.js
 * pattern (EventEmitter fake req + collecting res, direct handler invocation).
 *
 * The guard stack (loopback-only → internal token → 16KB body cap → JSON
 * parse → deps dispatch) is the anti-spoof boundary of the task-event
 * endpoint; deps.onTaskEvent is the seam into the task-state reducer.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-task-event-route-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;

/** Collecting res (EventEmitter-based, mirrors api-events-gap makeRes). */
function makeRes() {
  const res = new EventEmitter();
  res.statusCode = 0;
  res.headers = null;
  res.chunks = [];
  res.ended = false;
  res.writeHead = (code, headers) => { res.statusCode = code; res.headers = headers || {}; return res; };
  res.write = (c) => { if (c != null) res.chunks.push(String(c)); return true; };
  res.end = (c) => { if (c != null) res.chunks.push(String(c)); res.ended = true; res.emit('finish'); return res; };
  res.on('error', () => {});
  return res;
}
function bodyStr(res) { return res.chunks.join(''); }
function url(pathname) { return { pathname, searchParams: new URLSearchParams() }; }

let taskEventNotify;
before(async () => {
  const eventsMod = await import('../server/routes/events.js');
  taskEventNotify = eventsMod.eventsRoutes.find((r) => r.path === '/api/task-event' && r.method === 'POST')?.handler;
});
after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

const TOKEN = 'task-bridge-token';
function makeDeps() {
  const calls = [];
  return {
    calls,
    INTERNAL_TOKEN: TOKEN,
    onTaskEvent: (payload) => { calls.push(payload); },
  };
}

function post({ isLocal = true, headers = { 'x-ccviewer-internal': TOKEN }, body = '' } = {}, deps = makeDeps()) {
  const req = new EventEmitter();
  req.headers = headers;
  req.destroy = () => { req.destroyed = true; };
  const res = makeRes();
  return new Promise((resolve) => {
    res.on('finish', () => resolve(res));
    taskEventNotify(req, res, url('/api/task-event'), isLocal, deps);
    if (body) req.emit('data', body);
    req.emit('end');
    if (!body) setImmediate(() => resolve(res));
  });
}

describe('POST /api/task-event (taskEventNotify)', () => {
  it('route is registered', () => {
    assert.ok(taskEventNotify, 'eventsRoutes must expose POST /api/task-event');
  });

  it('403 when not loopback', async () => {
    const res = await post({ isLocal: false });
    assert.equal(res.statusCode, 403);
    assert.match(JSON.parse(bodyStr(res)).error, /Loopback only/);
  });

  it('403 when bridge token is missing/invalid', async () => {
    const res = await post({ headers: { 'x-ccviewer-internal': 'wrong' } });
    assert.equal(res.statusCode, 403);
    assert.match(JSON.parse(bodyStr(res)).error, /Invalid bridge token/);
  });

  it('200 and dispatches the payload to deps.onTaskEvent', async () => {
    const deps = makeDeps();
    const payload = { hookEventName: 'TaskCreated', sessionId: 's1', taskId: '1', taskSubject: 'x' };
    const res = await post({ body: JSON.stringify(payload) }, deps);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(bodyStr(res)), { ok: true });
    assert.equal(deps.calls.length, 1);
    assert.deepEqual(deps.calls[0], payload);
  });

  it('400 on malformed JSON body (valid token)', async () => {
    const res = await post({ body: '{bad json' });
    assert.equal(res.statusCode, 400);
    assert.match(JSON.parse(bodyStr(res)).error, /malformed JSON/);
  });

  it('destroys the request and never responds when body exceeds 16KB', async () => {
    const req = new EventEmitter();
    req.headers = { 'x-ccviewer-internal': TOKEN };
    let destroyed = false;
    req.destroy = () => { destroyed = true; };
    const res = makeRes();
    taskEventNotify(req, res, url('/api/task-event'), true, makeDeps());
    req.emit('data', 'x'.repeat(16385));
    assert.equal(destroyed, true, 'req destroyed on oversize body');
    req.emit('end');
    assert.equal(res.ended, false, 'no response written after destroy');
  });

  it('still 200 when deps.onTaskEvent throws (hook must never see failure)', async () => {
    const deps = {
      INTERNAL_TOKEN: TOKEN,
      onTaskEvent: () => { throw new Error('reducer exploded'); },
    };
    const res = await post({ body: JSON.stringify({ hookEventName: 'TaskCompleted', taskId: '2' }) }, deps);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(bodyStr(res)), { ok: true });
  });

  it('tolerates missing deps.onTaskEvent (test/lite deps bags)', async () => {
    const res = await post({ body: JSON.stringify({ hookEventName: 'TaskCreated', taskId: '1' }) }, { INTERNAL_TOKEN: TOKEN });
    assert.equal(res.statusCode, 200);
  });
});
