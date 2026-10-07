/**
 * Same-name session isolation — /events cold-load cwd scoping (2026-10-07).
 *
 * Two cross-dir same-basename projects (/a/proj, /b/proj) share ONE session pool
 * <LOG_DIR>/proj/sessions. When a FRESH instance (live, but no own main-turn
 * session yet) is viewed, the cold-load fallback must be scoped to THAT
 * instance's cwd — never serve the other same-name project's newest session.
 * The instance's cwd is resolved from the LIVE PTY record (listLivePtys), so
 * these exercise the REAL events.js → pty-manager wiring (static import, not an
 * injected dep) — the P0-a gap that would otherwise silently disable the filter.
 *
 * The fallback filter's own branches (keep-missing / same-cwd / empty-targetCwd)
 * are unit-covered in v2-session-select.test.js; this file pins the wiring.
 *
 * Data-safety: PTYs are mocked (_setPtyImportForTests); sessions are hand-built
 * under mkdtemp; CCV_LOG_DIR is isolated and set BEFORE importing findcc.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';

// CCV_LOG_DIR / CLAUDE_CONFIG_DIR MUST be set BEFORE importing findcc (its LOG_DIR is
// resolved once at module load). Workspace mode keeps initForWorkspace from booting a
// real HTTP server in tests.
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-samename-'));
process.env.CCV_LOG_DIR = join(tmpDir, 'LOG');
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

const { eventsRoutes } = await import('../server/routes/events.js');
const { initForWorkspace } = await import('../server/interceptor.js');
const ptyMgr = await import('../server/pty-manager.js');
const { spawnClaude, _setPtyImportForTests, _resetForTests, listLivePtys } = ptyMgr;

// Two REAL dirs, same basename "proj", in different parents → one shared pool.
const dirA = join(tmpDir, 'a', 'proj');
const dirB = join(tmpDir, 'b', 'proj');
mkdirSync(dirA, { recursive: true });
mkdirSync(dirB, { recursive: true });
const sessionsRoot = join(tmpDir, 'LOG', 'proj', 'sessions'); // shared basename pool

// Minimal controllable mock pty (same shape as branch-pty-manager.test.js).
function makeImport(spawned) {
  return () => ({
    spawn(command, args, opts) {
      const exitHandlers = [];
      let killed = false;
      const inst = {
        pid: 60000 + spawned.length,
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

/** Hand-build a session dir in the shared pool, stamped with instance + cwd. The
 *  `startTs` doubles as the identity marker: it surfaces verbatim as `oldestTs` in
 *  the load_start frame, so the test can tell WHICH session the cold load picked. */
function seed(sid, { startTs, instance, cwd }) {
  const dir = join(sessionsRoot, sid);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({
    wireFormat: 2, sessionId: sid, project: 'proj', startTs, instance, cwd,
  }));
  const lines = [
    JSON.stringify({ ph: 'meta', wireFormat: 2, sessionId: sid }),
    JSON.stringify({ ph: 'req', seq: 1, rid: 'r1', kind: 'main', ts: startTs, url: 'u' }),
    JSON.stringify({ ph: 'done', seq: 1, rid: 'r1', ts: startTs, status: 'ok' }),
  ];
  writeFileSync(join(dir, 'journal.jsonl'), lines.join('\n') + '\n');
}
const iso = (n) => new Date(Date.UTC(2026, 9, 7, 5, 0, n)).toISOString();
const TS_A = iso(9); // the OTHER project's newest session
const TS_B = iso(3); // THIS project's older session

const eventsHandler = eventsRoutes.find((r) => r.path === '/events' && r.method === 'GET').handler;
function mkRes() {
  const frames = [];
  const listeners = {};
  return {
    frames,
    writeHead() {}, setHeader() {}, flushHeaders() {},
    write(chunk) { frames.push(String(chunk)); return true; },
    on() {}, once() {}, removeListener() {},
    end() { (listeners.close || []).forEach((f) => f()); },
  };
}
function mkReq() { const req = new EventEmitter(); req.headers = {}; return req; }
function mkDeps() {
  return {
    MAX_POST_BODY: 1 << 20, clients: [], DEFAULT_EVENTS_LIMIT: 400,
    turnEndDebounceMs: 10000, wireV3: false, serverBuild: 'test',
    pendingMajorUpdate: null, getTaskSnapshot: () => null,
    SSE_BACKPRESSURE_TIMEOUT_MS: 100, ensureProjectFeed: () => {},
  };
}

let spawned;
before(async () => {
  // Bind an UNRELATED project so ?project=proj is a genuine foreign view (forces the
  // explicit cold-source branch in events.js).
  initForWorkspace(join(tmpDir, 'boundProj'), { forceNew: true });
  _resetForTests();
  spawned = [];
  _setPtyImportForTests(makeImport(spawned));
  // Seed the shared pool: A's session is NEWEST (so a whole-pool fallback would wrongly
  // pick it), B's is older. Each stamped with its owning instance + cwd, as the writer does.
  // (instance values are arbitrary here — the VIEWED instances below are fresh and own no
  // session, so the pick always goes through the cwd-scoped fallback.)
  seed('aaaa-newest', { startTs: TS_A, instance: 'ccv-' + 'a'.repeat(36), cwd: dirA });
  seed('bbbb-older', { startTs: TS_B, instance: 'ccv-' + 'b'.repeat(36), cwd: dirB });
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

/** Extract the cold-loaded session identity from the load_start frame's oldestTs. */
function pickedTs(res) {
  const f = res.frames.find((x) => x.includes('event: load_start'));
  if (!f) return null;
  try { return JSON.parse(f.split('data: ')[1]).oldestTs || null; } catch { return null; }
}

describe('/events cold-load same-name cwd scoping', () => {
  it('a fresh instance rooted at /b/proj falls back to /b/proj content, NOT the newest /a/proj session', async () => {
    const freshB = await spawnFresh(dirB);
    const res = mkRes();
    const parsedUrl = new URL(`/events?project=proj&instance=${freshB}&limit=400`, 'http://localhost');
    await eventsHandler(mkReq(), res, parsedUrl, true, mkDeps());
    assert.equal(pickedTs(res), TS_B, 'must cold-load the SAME-cwd (/b/proj) older session');
    assert.ok(!res.frames.join('').includes('sid-not-found'), 'must NOT mis-exclude history into sid-not-found');
  });

  it('a fresh instance rooted at /a/proj symmetrically serves /a/proj content', async () => {
    const freshA = await spawnFresh(dirA);
    const res = mkRes();
    const parsedUrl = new URL(`/events?project=proj&instance=${freshA}&limit=400`, 'http://localhost');
    await eventsHandler(mkReq(), res, parsedUrl, true, mkDeps());
    assert.equal(pickedTs(res), TS_A, 'must cold-load the SAME-cwd (/a/proj) newest session');
  });
});
