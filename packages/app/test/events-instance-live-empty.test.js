/**
 * Live-instance empty view — /events liveness-aware cold load (2026-10-10).
 *
 * A NEWLY created workspace's claude PTY is alive but has not sent its first
 * request yet, so it legitimately owns NO session dir. Pre-fix, viewing it via
 * `?project=<p>&instance=<i>` hit the instance-no-session guard, which
 *   1. emitted sid-not-found → the client toasted "switch timed out" and
 *      detached back to the bound project, and
 *   2. STILL cold-loaded `getLiveLogSource()` — the BOUND project's current
 *      session — on BOTH the legacy wire and the v3 wire (`_v3Src`), a real
 *      cross-project bleed.
 * Post-fix the guard is liveness-aware (listLivePtys): a LIVE instance gets an
 * EMPTY view instead (load_start{total:0} → load_end, no chunks) and stays
 * attached to the per-project live feed, which streams the first turn in place
 * the moment the PTY writes its first session dir. Only a DEAD instance keeps
 * the explicit sid-not-found posture.
 *
 * These exercise the REAL events.js → pty-manager wiring (static import), same
 * as events-samename-cwd.test.js. Data-safety: PTYs are mocked
 * (_setPtyImportForTests); sessions are hand-built under mkdtemp; CCV_LOG_DIR
 * is isolated and set BEFORE importing findcc.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';

// CCV_LOG_DIR / CLAUDE_CONFIG_DIR MUST be set BEFORE importing findcc (its LOG_DIR is
// resolved once at module load). CLAUDE_CONFIG_DIR also pins CONTEXT_WINDOW_FILE
// (<dir>/context-window.json) inside the sandbox.
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-liveempty-'));
process.env.CCV_LOG_DIR = join(tmpDir, 'LOG');
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

const { eventsRoutes } = await import('../server/routes/events.js');
const interceptor = await import('../server/interceptor.js');
const { initForWorkspace } = interceptor;
const ptyMgr = await import('../server/pty-manager.js');
const { spawnClaude, _setPtyImportForTests, _resetForTests, listLivePtys } = ptyMgr;

// Bound project (has a session — the pre-fix bleed source) and the viewed
// foreign project projB (starts with NO sessions at all). projC is a SECOND
// empty foreign project reserved for the over-application case so that case's
// mid-suite history seeding can never make the earlier cases' "projB is empty"
// assumption order-dependent.
const boundDir = join(tmpDir, 'boundProj');
const dirB = join(tmpDir, 'b', 'projB');
const dirC = join(tmpDir, 'c', 'projC');
mkdirSync(boundDir, { recursive: true });
mkdirSync(dirB, { recursive: true });
mkdirSync(dirC, { recursive: true });

// Minimal controllable mock pty (same shape as events-samename-cwd.test.js).
function makeImport(spawned) {
  return () => ({
    spawn(command, args, opts) {
      const exitHandlers = [];
      let killed = false;
      const inst = {
        pid: 61000 + spawned.length,
        command, args, opts,
        write() {}, resize() {},
        kill() { if (!killed) { killed = true; for (const cb of [...exitHandlers]) cb({ exitCode: 0 }); } },
        onData() {}, onExit(cb) { exitHandlers.push(cb); },
      };
      spawned.push(inst);
      return inst;
    },
  });
}

/** Hand-build a main-turn session dir under <project>'s pool. */
function seed(project, sid, { startTs, instance, cwd }) {
  const dir = join(tmpDir, 'LOG', project, 'sessions', sid);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({
    wireFormat: 2, sessionId: sid, project, startTs, instance, cwd,
  }));
  const lines = [
    JSON.stringify({ ph: 'meta', wireFormat: 2, sessionId: sid }),
    JSON.stringify({ ph: 'req', seq: 1, rid: 'r1', kind: 'main', ts: startTs, url: 'u' }),
    JSON.stringify({ ph: 'done', seq: 1, rid: 'r1', ts: startTs, status: 'ok' }),
  ];
  writeFileSync(join(dir, 'journal.jsonl'), lines.join('\n') + '\n');
}
const iso = (n) => new Date(Date.UTC(2026, 9, 10, 6, 0, n)).toISOString();

// A MainAgent wire entry (same shape as api-events-gap.test.js) — the bound
// project's live v2 session is seeded with this so the pre-fix fallthrough
// would REALLY stream bound content into the projB view (regression signal).
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
async function seedBoundLive(interceptor, entries) {
  const w = interceptor._v2Writer;
  w.resetSessions();
  const sid = '20000000-0000-4000-8000-000000000001';
  for (const e of entries) {
    e.body.metadata = { user_id: JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: sid }) };
    const h = w.ingestRequest(e, e.body.messages);
    w.ingestCompletion(h, e);
  }
  await w.flush();
}

const eventsHandler = eventsRoutes.find((r) => r.path === '/events' && r.method === 'GET').handler;
function mkRes() {
  const frames = [];
  return {
    frames,
    // `writable: true` mirrors a live socket: events.js gates load_chunk writes on
    // `res.destroyed || !res.writable`, so without this the `load_chunk === 0`
    // assertions below would vacuously pass even when content IS streamed.
    writable: true, destroyed: false,
    writeHead() {}, setHeader() {}, flushHeaders() {},
    write(chunk) { frames.push(String(chunk)); return true; },
    on() {}, once() {}, removeListener() {},
    end() {},
  };
}
function mkReq() { const req = new EventEmitter(); req.headers = {}; return req; }
function mkDeps(over = {}) {
  return {
    MAX_POST_BODY: 1 << 20, clients: [], DEFAULT_EVENTS_LIMIT: 400,
    turnEndDebounceMs: 10000, wireV3: false, serverBuild: 'test',
    pendingMajorUpdate: null, getTaskSnapshot: () => null,
    SSE_BACKPRESSURE_TIMEOUT_MS: 100, ensureProjectFeed: () => {},
    ...over,
  };
}
const frameNamed = (res, name) => res.frames.filter((f) => f.includes(`event: ${name}`));
const loadStart = (res) => {
  const f = frameNamed(res, 'load_start')[0];
  return f ? JSON.parse(f.split('data: ')[1]) : null;
};

let spawned;
before(async () => {
  initForWorkspace(boundDir, { forceNew: true });
  _resetForTests();
  spawned = [];
  _setPtyImportForTests(makeImport(spawned));
  // The bound project owns a LIVE session: pre-fix, the cold-load fallthrough
  // (legacy wire AND v3 `_v3Src`) would stream THIS content into the projB view
  // — the bleed these tests pin against. Seeding through the real v2 writer
  // also puts an owner.lock held by THIS process on the session dir, so the
  // viewed-side picker (skipForeignLive) rejects it even in the dead-instance
  // and over-application cases below.
  await seedBoundLive(interceptor, [mainAgentEntry(iso(1), 111)]);
  // A global context-window.json exists (as on a real machine): the empty view
  // must NOT push it — it would paint the bound project's usage onto projB.
  writeFileSync(join(tmpDir, 'context-window.json'), JSON.stringify({
    context_window: { total_input_tokens: 12345, total_output_tokens: 678 },
  }));
});

after(() => {
  try { _setPtyImportForTests(null); } catch {}
  try { _resetForTests(); } catch {}
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

/** Spawn a fresh live PTY rooted at `cwd` and return its instanceKey. */
async function spawnFresh(cwd) {
  await spawnClaude(9000, cwd, [], '/bin/echo');
  const live = listLivePtys().filter((p) => p.cwd === cwd);
  return live[live.length - 1].instanceKey; // the just-spawned record for this cwd
}

describe('/events live-instance empty view', () => {
  it('a LIVE instance with no session dir gets an empty view, NOT sid-not-found, and NO bound-project bleed', async () => {
    const freshB = await spawnFresh(dirB);
    const res = mkRes();
    const feedCalls = [];
    const deps = mkDeps({ ensureProjectFeed: (p) => feedCalls.push(p) });
    const parsedUrl = new URL(`/events?project=projB&instance=${freshB}&limit=400`, 'http://localhost');
    await eventsHandler(mkReq(), res, parsedUrl, true, deps);
    assert.ok(!res.frames.join('').includes('sid-not-found'), 'live instance must NOT be flagged sid-not-found');
    const ls = loadStart(res);
    assert.ok(ls, 'load_start must be sent');
    assert.equal(ls.total, 0, 'empty view cold-loads zero entries');
    assert.equal(ls.incremental, false);
    assert.equal(ls.empty, true, 'the empty-view flag lets the client drop any stale cached snapshot');
    assert.equal(frameNamed(res, 'load_chunk').length, 0, 'no bound-project chunks may bleed through');
    assert.equal(frameNamed(res, 'v2_requests').length, 0, 'no bound-project rows may bleed through the adapter either');
    assert.ok(frameNamed(res, 'load_end').length > 0, 'load_end must follow (clears the client switch overlay)');
    assert.equal(frameNamed(res, 'context_window').length, 0, 'global context-window.json must NOT be pushed onto the empty view');
    assert.equal(frameNamed(res, 'kv_cache_content').length, 0, 'no cached-content frame either (empty mainAgent ring)');
    assert.ok(deps.clients.includes(res), 'client must join the broadcast list (live feed delivery)');
    assert.equal(res._ccvViewProject, 'projB');
    assert.equal(res._ccvViewInstance, freshB);
    assert.ok(feedCalls.includes('projB'), 'the per-project live feed must be started for the viewed project');
  });

  it('wireV3 variant: the v3 cold source is pinned empty too (no v2_requests / v3 frames / v3Bytes)', async () => {
    const freshB = await spawnFresh(dirB);
    const res = mkRes();
    const parsedUrl = new URL(`/events?project=projB&instance=${freshB}&limit=400`, 'http://localhost');
    await eventsHandler(mkReq(), res, parsedUrl, true, mkDeps({ wireV3: true }));
    assert.ok(!res.frames.join('').includes('sid-not-found'));
    assert.equal(frameNamed(res, 'v2_requests').length, 0, 'bound project rows must NOT bleed over the v3 wire');
    assert.equal(frameNamed(res, 'v3_conv').length, 0);
    assert.equal(frameNamed(res, 'v3_resp').length, 0);
    const ls = loadStart(res);
    assert.ok(ls);
    assert.equal(ls.total, 0);
    assert.ok(!('v3Bytes' in ls), 'the v3 load_start shape must not appear on the empty view');
  });

  it('incremental variant: ?since&cc= on the empty view reports an empty delta', async () => {
    const freshB = await spawnFresh(dirB);
    const res = mkRes();
    const since = encodeURIComponent(iso(2));
    const parsedUrl = new URL(`/events?project=projB&instance=${freshB}&since=${since}&cc=1`, 'http://localhost');
    await eventsHandler(mkReq(), res, parsedUrl, true, mkDeps());
    assert.ok(!res.frames.join('').includes('sid-not-found'));
    const ls = loadStart(res);
    assert.ok(ls);
    assert.equal(ls.total, 0);
    assert.equal(ls.incremental, true);
    assert.equal(ls.empty, true, 'the empty delta is flagged so the client invalidates the restored cache');
    assert.equal(frameNamed(res, 'load_chunk').length, 0);
  });

  it('a DEAD instance keeps the explicit sid-not-found posture, still with NO bound-project bleed', async () => {
    const res = mkRes();
    const dead = 'ccv-' + 'f'.repeat(36); // well-formed but never spawned
    const parsedUrl = new URL(`/events?project=projB&instance=${dead}&limit=400`, 'http://localhost');
    await eventsHandler(mkReq(), res, parsedUrl, true, mkDeps());
    const frames = res.frames.join('');
    assert.ok(frames.includes('sid-not-found'), 'dead instance must still be flagged');
    assert.ok(frames.includes('"reason":"instance-no-session"'));
    // The dead branch is pinned empty too (emptyLiveView = instanceNoSession): the
    // client detaches on the frame above, and the wire carries NO bound content.
    assert.equal(frameNamed(res, 'load_chunk').length, 0, 'dead instance must NOT stream the bound project either');
    const ls = loadStart(res);
    assert.ok(ls && ls.total === 0, 'dead instance cold-loads an empty view');
    assert.equal(ls.empty, true, 'the empty-view flag is set so the client drops any stale cached snapshot');
  });

  it('over-application guard: a LIVE instance whose project HAS history still cold-loads it', async () => {
    // projC (not projB) so this mid-suite seeding can never break the earlier
    // cases' "projB is empty" assumption (decouples the suite from run order).
    seed('projC', 'cccc-older', { startTs: iso(3), instance: 'ccv-' + 'c'.repeat(36), cwd: dirC });
    const freshC = await spawnFresh(dirC);
    const res = mkRes();
    const parsedUrl = new URL(`/events?project=projC&instance=${freshC}&limit=400`, 'http://localhost');
    await eventsHandler(mkReq(), res, parsedUrl, true, mkDeps());
    assert.ok(!res.frames.join('').includes('sid-not-found'), 'history must not be mis-excluded into sid-not-found');
    const ls = loadStart(res);
    assert.ok(ls && ls.total > 0, 'existing project history must still cold-load');
    assert.equal(ls.oldestTs, iso(3), 'the seeded projC session is the cold-load pick');
    assert.ok(!ls.empty, 'a history-bearing view is NOT flagged empty');
  });
});
