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

const { resumeRoutes } = await import('../server/routes/resume.js');
const ptyMgr = await import('../server/pty-manager.js');
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

function callClose({ body = JSON.stringify({ project: '' }), isLocal = true, admin = true, headers } = {}) {
  return new Promise((resolve) => {
    let status = 0;
    let payload = '';
    const res = {
      writeHead(code) { status = code; },
      end(b) { payload = b || ''; resolve({ status, body: JSON.parse(payload || '{}') }); },
    };
    const parsedUrl = new URL('/api/live-processes/close', 'http://localhost');
    postClose(makeReq(body, { admin, headers }), res, parsedUrl, isLocal, { MAX_POST_BODY: 1 << 20 });
  });
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
