/**
 * events.js `useIncremental` gate (multi-project, 2026-10): a foreign
 * `?project=` (a parallel-project VIEW) may resume incrementally via
 * `?project=<p>&since=<lastTs>` — the gate no longer requires the project to
 * be the bound one. This is the server half of the "instant switch back" fix.
 *
 * Exercises the REAL /events handler with a stubbed response + deps, asserting
 * the emitted load_start frame carries incremental:true for a foreign project
 * + since. Fixture pattern mirrors resume-route.test.js (isolated CCV_LOG_DIR).
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-events-incr-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

const { eventsRoutes } = await import('../server/routes/events.js');
const { initForWorkspace } = await import('../server/interceptor.js');

// Bind 'boundProj' so a DIFFERENT ?project= is a genuine foreign view.
initForWorkspace(join(tmpDir, 'boundProj'), { forceNew: true });
// The foreign project exists on disk (its sessions dir is empty — the
// incremental flag is decided before any content is read).
mkdirSync(join(tmpDir, 'foreignProj', 'sessions'), { recursive: true });

after(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

const eventsHandler = eventsRoutes.find((r) => r.path === '/events' && r.method === 'GET').handler;

/** Capture every SSE frame the handler writes, then close on load_end. */
function mkRes() {
  const frames = [];
  const listeners = {};
  return {
    frames,
    writeHead() {},
    setHeader() {},
    flushHeaders() {},
    write(chunk) { frames.push(String(chunk)); return true; },
    on() {}, once() {}, removeListener() {},
    end() { (listeners.close || []).forEach((f) => f()); },
    // events.js pushes res into deps.clients after cold load — harmless here.
  };
}

/** The handler attaches req.on('close') — give it an EventEmitter. */
function mkReq() {
  const req = new EventEmitter();
  req.headers = {};
  return req;
}

function mkDeps(res) {
  return {
    MAX_POST_BODY: 1 << 20,
    clients: [],
    DEFAULT_EVENTS_LIMIT: 400,
    turnEndDebounceMs: 10000,
    wireV3: false,
    serverBuild: 'test',
    pendingMajorUpdate: null,
    getTaskSnapshot: () => null,
    SSE_BACKPRESSURE_TIMEOUT_MS: 100,
    // Only what the /events cold-load path touches for an empty foreign project.
  };
}

describe('/events useIncremental gate (multi-project)', () => {
  it('foreign ?project= + since + cc → load_start carries incremental:true (was forced full-reload)', async () => {
    const res = mkRes();
    const since = '2026-10-04T00:00:00.000Z';
    const parsedUrl = new URL(`/events?project=foreignProj&since=${encodeURIComponent(since)}&cc=42`, 'http://localhost');
    await eventsHandler(mkReq(), res, parsedUrl, true, mkDeps(res));
    const loadStart = res.frames.find((f) => f.includes('event: load_start'));
    assert.ok(loadStart, 'a load_start frame must be emitted');
    assert.ok(loadStart.includes('"incremental":true'), `foreign project must resume incrementally: ${loadStart}`);
  });

  it('bound project + since + cc → still incremental:true (legacy parity)', async () => {
    const res = mkRes();
    const since = '2026-10-04T00:00:00.000Z';
    const parsedUrl = new URL(`/events?project=boundProj&since=${encodeURIComponent(since)}&cc=42`, 'http://localhost');
    await eventsHandler(mkReq(), res, parsedUrl, true, mkDeps(res));
    const loadStart = res.frames.find((f) => f.includes('event: load_start'));
    assert.ok(loadStart);
    assert.ok(loadStart.includes('"incremental":true'), `bound project parity: ${loadStart}`);
  });

  it('foreign ?project= WITHOUT since → full (incremental:false), unchanged', async () => {
    const res = mkRes();
    const parsedUrl = new URL('/events?project=foreignProj&limit=400', 'http://localhost');
    await eventsHandler(mkReq(), res, parsedUrl, true, mkDeps(res));
    const loadStart = res.frames.find((f) => f.includes('event: load_start'));
    assert.ok(loadStart);
    assert.ok(loadStart.includes('"incremental":false'), `no since ⇒ full cold load: ${loadStart}`);
  });

  it('since present but cc=0 → full (guard preserved)', async () => {
    const res = mkRes();
    const since = '2026-10-04T00:00:00.000Z';
    const parsedUrl = new URL(`/events?project=foreignProj&since=${encodeURIComponent(since)}&cc=0`, 'http://localhost');
    await eventsHandler(mkReq(), res, parsedUrl, true, mkDeps(res));
    const loadStart = res.frames.find((f) => f.includes('event: load_start'));
    assert.ok(loadStart);
    assert.ok(loadStart.includes('"incremental":false'), `cc=0 must stay full: ${loadStart}`);
  });
});
