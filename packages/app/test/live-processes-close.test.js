/**
 * POST /api/live-processes/close (server/routes/resume.js) + killPtyFor
 * (server/pty-manager.js) — the web multi-project tab bar's × button backend.
 *
 * Covers: admin gating (403 non-admin / 200 loopback), bad-json/missing-project
 * 400s, unknown-project 404, happy-path kill (record kept, process gone), and
 * the active-attachment re-anchor when the killed PTY was the active one.
 *
 * Fixture pattern mirrors resume-route.test.js (isolated CCV_LOG_DIR, direct
 * handler calls with a captured res); PTYs are fake (injected via
 * _setPtyImportForTests) — no real process is ever spawned.
 */
import { describe, it, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';

// Isolate LOG_DIR before importing anything that loads findcc/interceptor.
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-live-close-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';
// A developer-shell CCV_PROJECT_DIR would make the pre-existing cases below
// (no deps stubs) wander into the rebound branch — start from a known-empty
// bound dir; the rebound describe sets/restores it per case.
delete process.env.CCV_PROJECT_DIR;
// Same for the Electron multi-tab flag: a ccv Electron host shell carries
// CCV_ELECTRON_MULTITAB=1, which makes resume.js skip the rebound entirely and
// turns the rebound cases red for no real reason (api-workspaces.test.js:27
// clears it for the same reason).
delete process.env.CCV_ELECTRON_MULTITAB;

const { resumeRoutes } = await import('../server/routes/resume.js');
const ptyMgr = await import('../server/pty-manager.js');
const interceptor = await import('../server/interceptor.js');
const { projectKeyForCwd } = await import('../server/lib/system-prompt-snapshots.js');

after(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

const closeRoute = resumeRoutes.find((r) => r.method === 'POST' && r.path === '/api/live-processes/close');
assert.ok(closeRoute, 'POST /api/live-processes/close must be registered');
const postClose = closeRoute.handler;

function makeReq(body, { admin = true, headers } = {}) {
  const req = new EventEmitter();
  req.ccvIsAdmin = admin;
  req.headers = headers || {};
  // The handler listens for data/end; schedule the payload push after the
  // listeners attach (same posture as other route tests).
  process.nextTick(() => {
    req.emit('data', body);
    req.emit('end');
  });
  return req;
}

function callClose({ body = JSON.stringify({ project: '' }), isLocal = true, admin = true, headers, deps } = {}) {
  return new Promise((resolve) => {
    let status = 0;
    let payload = '';
    const res = {
      writeHead(code) { status = code; },
      end(b) { payload = b || ''; resolve({ status, body: JSON.parse(payload || '{}') }); },
    };
    const parsedUrl = new URL('/api/live-processes/close', 'http://localhost');
    postClose(makeReq(body, { admin, headers }), res, parsedUrl, isLocal, deps || { MAX_POST_BODY: 1 << 20 });
  });
}

// Minimal SSE-client stub: captures every written frame so tests can assert
// what the rebound broadcast sent (and did NOT send). Mirrors
// api-workspaces.test.js's makeClient().
function makeSseClient() {
  const frames = [];
  return {
    frames,
    write(chunk) { frames.push(String(chunk)); return true; },
    writableLength: 0,
  };
}

function reboundDeps(extra = {}) {
  return {
    MAX_POST_BODY: 1 << 20,
    clients: extra.clients || [],
    startLogWatch() { this._logWatch = (this._logWatch || 0) + 1; },
    startStatsWorker() { this._stats = (this._stats || 0) + 1; },
    startStreamingStatusTimer() { this._stream = (this._stream || 0) + 1; },
    ...extra,
  };
}

// A fake pty whose kill() marks it dead (killPtyTree may fail on a bogus pid —
// the _killPtyRecord fallback path then calls ptyProcess.kill()).
function makeFakePty(pid) {
  const p = {
    pid,
    killed: false,
    onData() {}, onExit() {}, resize() {}, write() {},
    kill() { p.killed = true; },
  };
  return p;
}

const fakes = [];
function fakePtyImport() {
  return {
    spawn: () => {
      const p = makeFakePty(40000 + fakes.length);
      fakes.push(p);
      return p;
    },
  };
}

const dirA = join(tmpDir, 'closeProjA');
const dirB = join(tmpDir, 'closeProjB');
mkdirSync(dirA, { recursive: true });
mkdirSync(dirB, { recursive: true });
const projA = projectKeyForCwd(dirA);
const projB = projectKeyForCwd(dirB);

beforeEach(async () => {
  ptyMgr._resetForTests();
  ptyMgr._setPtyImportForTests(fakePtyImport);
  fakes.length = 0;
  // Two live projects per case; B is active (the LAST completed spawn wins
  // the attachment), so closing A exercises the background-close path and
  // closing B the active-close re-anchor.
  await ptyMgr.spawnClaude(9999, dirA, [], 'claude');
  await ptyMgr.spawnClaude(9999, dirB, [], 'claude');
});

// Teardown parity with resume-route.test.js: never let a fake PTY record (or
// its timers) leak across files — _resetForTests kills records and clears the
// map/listeners, and the import seam goes back to the real node-pty.
afterEach(() => {
  ptyMgr._resetForTests();
  ptyMgr._setPtyImportForTests(null);
});

describe('POST /api/live-processes/close', () => {
  it('403s for a non-admin remote caller (no loopback, no ccvIsAdmin)', async () => {
    const { status, body } = await callClose({ body: JSON.stringify({ project: projA }), isLocal: false, admin: false });
    assert.equal(status, 403);
    assert.equal(body.ok, false);
    assert.equal(body.reason, 'forbidden');
    // Nothing killed.
    assert.equal(ptyMgr.listLivePtys().length, 2);
  });

  it('400s on bad json and on a missing project field', async () => {
    const bad = await callClose({ body: '{nope' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.reason, 'bad-json');
    const missing = await callClose({ body: JSON.stringify({}) });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.reason, 'missing-project');
  });

  it('404s for an unknown project', async () => {
    const { status, body } = await callClose({ body: JSON.stringify({ project: 'no-such-project' }) });
    assert.equal(status, 404);
    assert.equal(body.ok, false);
    assert.equal(body.reason, 'not-found');
    assert.equal(ptyMgr.listLivePtys().length, 2);
  });

  it('kills a background (non-active) project: 200, record kept, active untouched', async () => {
    // B is active (last spawn wins); closing A must not move the attachment.
    const { status, body } = await callClose({ body: JSON.stringify({ project: projA }) });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.project, projA);
    assert.equal(body.killedActive, false);

    const live = ptyMgr.listLivePtys();
    assert.equal(live.length, 1, 'only B survives');
    assert.equal(live[0].cwd, dirB);
    assert.equal(live[0].isActive, true, 'B stays the active attachment');
    // The record is kept (re-launch resumes cleanly): attach by project still
    // resolves, just not running.
    const att = ptyMgr.attachPtyFor({ project: projA });
    assert.equal(att.ok, true);
    assert.equal(att.running, false);
    // Restore the attachment to B for the next case's baseline.
    ptyMgr.attachPtyFor({ project: projB });
  });

  it('kills the ACTIVE project: 200, killedActive, re-anchors to the surviving record', async () => {
    const { status, body } = await callClose({ body: JSON.stringify({ project: projB }) });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.killedActive, true);

    const live = ptyMgr.listLivePtys();
    assert.equal(live.length, 1);
    assert.equal(live[0].cwd, dirA);
    assert.equal(live[0].isActive, true, 'the survivor becomes the active attachment');
    // The shared no-arg readers follow the re-anchor (terminal stays usable).
    assert.equal(ptyMgr.getPtyState().running, true);
  });

  it('killing the last live project leaves a dead-state attachment (no crash)', async () => {
    await callClose({ body: JSON.stringify({ project: projA }) });
    const { status, body } = await callClose({ body: JSON.stringify({ project: projB }) });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.killedActive, true);
    assert.equal(ptyMgr.listLivePtys().length, 0);
    assert.equal(ptyMgr.getPtyState().running, false, 'readers see the dead state');
  });

  it('a remote authenticated admin (ccvIsAdmin) may close', async () => {
    const { status, body } = await callClose({ body: JSON.stringify({ project: projA }), isLocal: false, admin: true });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(ptyMgr.listLivePtys().length, 1);
  });

  it('403s a cross-site browser request even from an admin (same-origin guard)', async () => {
    const { status, body } = await callClose({
      body: JSON.stringify({ project: projA }),
      headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    });
    assert.equal(status, 403);
    assert.equal(body.reason, 'forbidden');
    assert.equal(ptyMgr.listLivePtys().length, 2, 'nothing killed');
  });

  it('allows a cross-origin-lookalike Origin that matches the request origin (same-origin page)', async () => {
    const { status, body } = await callClose({
      body: JSON.stringify({ project: projA }),
      headers: { origin: 'http://localhost' },
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(ptyMgr.listLivePtys().length, 1);
  });
});

// Bound-project rebound (2026-10): closing the BOUND project must re-bind the
// server's workspace identity to a surviving live project and broadcast
// workspace_started(rebound:true), instead of leaving "当前项目" stuck on the
// just-closed name. CCV_PROJECT_DIR is process-global — every case saves and
// restores it so the rest of the file keeps its no-rebound baseline.
describe('POST /api/live-processes/close — bound-project rebound', () => {
  let savedDir;
  beforeEach(() => { savedDir = process.env.CCV_PROJECT_DIR; });
  afterEach(() => {
    if (savedDir === undefined) delete process.env.CCV_PROJECT_DIR;
    else process.env.CCV_PROJECT_DIR = savedDir;
  });

  it('closing the bound project rebinds to the survivor, broadcasts workspace_started(rebound), and updates CCV_PROJECT_DIR', async () => {
    // Bind the server to A (initForWorkspace is the only sanctioned way to set
    // _projectName in a test; api-project-meta-gap.test.js:79 precedent).
    interceptor.initForWorkspace(dirA, { forceNew: true });
    process.env.CCV_PROJECT_DIR = dirA;

    const client = makeSseClient();
    const deps = reboundDeps({ clients: [client] });
    const { status, body } = await callClose({ body: JSON.stringify({ project: projA }), deps });

    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.ok(body.rebound, 'response carries the rebound payload');
    assert.equal(body.rebound.project, projB);
    assert.equal(body.rebound.cwd, dirB);
    // The server's bound identity moved to the survivor.
    assert.equal(process.env.CCV_PROJECT_DIR, dirB, 'CCV_PROJECT_DIR follows the survivor');
    assert.equal(interceptor._projectName, projB, '_projectName re-read as the survivor');
    // Live-feed / stats / streaming timers re-established for the new bound project.
    assert.ok(deps._logWatch >= 1, 'startLogWatch called');
    // The broadcast went out with the rebound marker, and crucially did NOT
    // replay load_* frames (no project guard on the client → would cross-contaminate).
    const joined = client.frames.join('');
    assert.ok(joined.includes('event: workspace_started'), 'workspace_started broadcast');
    assert.ok(joined.includes('"rebound":true'), 'rebound marker present');
    assert.ok(!joined.includes('event: load_start'), 'no load_start replay');
    // The survivor is the only live project left, and it is B.
    const live = ptyMgr.listLivePtys();
    assert.equal(live.length, 1);
    assert.equal(live[0].cwd, dirB);
    // Restore the bound identity so the shared afterEach/file baseline is unaffected.
    interceptor.initForWorkspace(dirB, { forceNew: true });
  });

  it('closing a NON-bound parallel project does not rebind (rebound null, CCV_PROJECT_DIR unchanged)', async () => {
    interceptor.initForWorkspace(dirA, { forceNew: true });
    process.env.CCV_PROJECT_DIR = dirA;

    const client = makeSseClient();
    const deps = reboundDeps({ clients: [client] });
    const { status, body } = await callClose({ body: JSON.stringify({ project: projB }), deps });

    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.rebound, null, 'no rebound for a parallel-project close');
    assert.equal(process.env.CCV_PROJECT_DIR, dirA, 'CCV_PROJECT_DIR untouched');
    assert.equal(interceptor._projectName, projA, 'still bound to A');
    assert.ok(!client.frames.join('').includes('workspace_started'), 'no broadcast');
    interceptor.initForWorkspace(dirA, { forceNew: true });
  });

  it('a same-basename survivor gets a DIR-ONLY rebind (no resetSessions, but CCV_PROJECT_DIR follows + broadcast)', async () => {
    // Two projects with the SAME basename under different parents share one
    // projectKeyForCwd name. initForWorkspace's scoped resetSessions keys on the
    // sanitized name, so a full rebind would wipe the survivor's own bindings —
    // but CCV_PROJECT_DIR must still follow the survivor (file tree/git roots)
    // and clients must still re-scope, so a dir-only rebind + broadcast happens.
    const parent1 = join(tmpDir, 'twinP1');
    const parent2 = join(tmpDir, 'twinP2');
    const twinA = join(parent1, 'sameproj');
    const twinB = join(parent2, 'sameproj');
    mkdirSync(twinA, { recursive: true });
    mkdirSync(twinB, { recursive: true });

    ptyMgr._resetForTests();
    ptyMgr._setPtyImportForTests(fakePtyImport);
    await ptyMgr.spawnClaude(9999, twinA, [], 'claude');
    await ptyMgr.spawnClaude(9999, twinB, [], 'claude');

    interceptor.initForWorkspace(twinA, { forceNew: true });
    process.env.CCV_PROJECT_DIR = twinA;

    // A project-only close over two live same-basename records is ambiguous by
    // design (killPtyFor's 409 guard) — close the twinA instance by its key,
    // exactly as the header's × does once tabs carry instanceKeys.
    const twinAKey = ptyMgr.listLivePtys().find((p) => p.cwd === twinA)?.instanceKey;
    assert.ok(twinAKey, 'twinA instanceKey resolves');
    const client = makeSseClient();
    const deps = reboundDeps({ clients: [client] });
    const { status, body } = await callClose({ body: JSON.stringify({ project: 'sameproj', instanceKey: twinAKey }), deps });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    // Dir-only rebind: project name unchanged, but the bound ROOT and the
    // rebound payload follow the surviving twin's directory, and clients are told.
    assert.ok(body.rebound, 'dir-only rebind still reports a rebound');
    assert.equal(body.rebound.project, 'sameproj', 'project name unchanged (same basename)');
    assert.equal(body.rebound.cwd, twinB, 'rebound points at the surviving twin dir');
    assert.equal(process.env.CCV_PROJECT_DIR, twinB, 'CCV_PROJECT_DIR follows the survivor dir');
    assert.equal(interceptor._projectName, 'sameproj', 'project name unchanged (same basename)');
    assert.ok(client.frames.join('').includes('"rebound":true'), 'rebound broadcast sent');
    // The twinB record survives untouched.
    const live = ptyMgr.listLivePtys();
    assert.equal(live.length, 1);
    assert.equal(live[0].cwd, twinB);
    // Reset the bound identity so any case appended after this describe starts clean.
    interceptor.initForWorkspace(dirA, { forceNew: true });
  });

  it('a same-name twin still ALIVE in another dir forces a dir-only rebind (survivor\'s bindings are NOT wiped)', async () => {
    // bound = /a/sameproj; parallel same-name twin /b/sameproj STILL RUNNING;
    // a THIRD differently-named project /c/other is the survivor. A full
    // initForWorkspace(/c/other) would resetSessions('sameproj') and destroy the
    // still-running /b twin's bindings — so this must degrade to a dir-only
    // rebind to the survivor, leaving the twin's name space intact.
    const twinA = join(tmpDir, 'snA', 'sameproj');
    const twinB = join(tmpDir, 'snB', 'sameproj');
    const other = join(tmpDir, 'otherproj');
    mkdirSync(twinA, { recursive: true });
    mkdirSync(twinB, { recursive: true });
    mkdirSync(other, { recursive: true });

    ptyMgr._resetForTests();
    ptyMgr._setPtyImportForTests(fakePtyImport);
    await ptyMgr.spawnClaude(9999, twinA, [], 'claude');   // bound, will be closed
    await ptyMgr.spawnClaude(9999, twinB, [], 'claude');   // same-name twin, stays live
    await ptyMgr.spawnClaude(9999, other, [], 'claude');   // survivor (different name)

    interceptor.initForWorkspace(twinA, { forceNew: true });
    process.env.CCV_PROJECT_DIR = twinA;

    const twinAKey = ptyMgr.listLivePtys().find((p) => p.cwd === twinA)?.instanceKey;
    assert.ok(twinAKey, 'twinA instanceKey resolves');
    const client = makeSseClient();
    const deps = reboundDeps({ clients: [client] });
    const { status, body } = await callClose({ body: JSON.stringify({ project: 'sameproj', instanceKey: twinAKey }), deps });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    // Dir-only rebind to the survivor: CCV_PROJECT_DIR follows, but the
    // project name does NOT switch to 'otherproj' (that would wipe the twin).
    assert.ok(body.rebound, 'rebound still reported');
    assert.equal(process.env.CCV_PROJECT_DIR, other, 'CCV_PROJECT_DIR moved to the survivor');
    assert.equal(interceptor._projectName, 'sameproj', 'name NOT switched — the live twin keeps its bindings');
    // Both the twin and the survivor remain live.
    assert.equal(ptyMgr.listLivePtys().length, 2);
    // Reset.
    interceptor.initForWorkspace(dirA, { forceNew: true });
  });

  it('a bound close with NO survivor does not rebind or broadcast (rebound null)', async () => {
    // Only ONE live project, and it is the bound one — closing it leaves
    // nothing to rebind to, so the binding must stay put and no broadcast fires.
    ptyMgr._resetForTests();
    ptyMgr._setPtyImportForTests(fakePtyImport);
    await ptyMgr.spawnClaude(9999, dirA, [], 'claude');

    interceptor.initForWorkspace(dirA, { forceNew: true });
    process.env.CCV_PROJECT_DIR = dirA;

    const client = makeSseClient();
    const deps = reboundDeps({ clients: [client] });
    const { status, body } = await callClose({ body: JSON.stringify({ project: projA }), deps });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.rebound, null, 'no survivor → no rebound');
    assert.equal(process.env.CCV_PROJECT_DIR, dirA, 'CCV_PROJECT_DIR unchanged');
    assert.ok(!client.frames.join('').includes('workspace_started'), 'no broadcast');
    assert.equal(ptyMgr.listLivePtys().length, 0);
    interceptor.initForWorkspace(dirA, { forceNew: true });
  });

  it('a throwing startLogWatch still returns 200 (rebound applied, broadcast already sent)', async () => {
    // The broadcast precedes the feed/timer restarts, so a throwing side-effect
    // cannot strand the "binding moved but clients untold" half-applied state.
    interceptor.initForWorkspace(dirA, { forceNew: true });
    process.env.CCV_PROJECT_DIR = dirA;

    const client = makeSseClient();
    const deps = reboundDeps({
      clients: [client],
      startLogWatch() { throw new Error('boom'); },
    });
    const { status, body } = await callClose({ body: JSON.stringify({ project: projA }), deps });
    assert.equal(status, 200, 'the close itself never 500s on a rebind side-effect');
    assert.equal(body.ok, true);
    // The rebind already happened and the broadcast already went out.
    assert.equal(interceptor._projectName, projB);
    assert.ok(client.frames.join('').includes('"rebound":true'), 'broadcast already sent before the throw');
    interceptor.initForWorkspace(dirB, { forceNew: true });
  });

  it('Electron multi-tab skips the rebind entirely (no rebind, no broadcast, env untouched)', async () => {
    // Mirroring workspaces.js:56, the Electron MANAGER process does not own log
    // init — closing the bound project there must not rebind.
    interceptor.initForWorkspace(dirA, { forceNew: true });
    process.env.CCV_PROJECT_DIR = dirA;
    process.env.CCV_ELECTRON_MULTITAB = '1';
    try {
      const client = makeSseClient();
      const deps = reboundDeps({ clients: [client] });
      const { status, body } = await callClose({ body: JSON.stringify({ project: projA }), deps });
      assert.equal(status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.rebound, null, 'Electron multi-tab → no rebind');
      assert.equal(process.env.CCV_PROJECT_DIR, dirA, 'CCV_PROJECT_DIR untouched');
      assert.ok(!client.frames.join('').includes('workspace_started'), 'no broadcast');
    } finally {
      delete process.env.CCV_ELECTRON_MULTITAB;
      interceptor.initForWorkspace(dirA, { forceNew: true });
    }
  });
});
