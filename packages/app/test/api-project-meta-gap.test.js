/**
 * api-project-meta-gap.test.js — covers server/routes/project-meta.js handlers.
 *
 * install-method.test.js already covers getInstallMethod + the version-info success
 * path. Here we drive the remaining route handlers directly (no live server), using
 * a fake res that records { status, body } and a fake statsWorker EventEmitter:
 *
 *   projectName     — echoes interceptor._projectName
 *   projectDir      — echoes CCV_PROJECT_DIR / cwd
 *   versionInfo     — 200 version+installMethod (covered) / 500 on read failure
 *   projectStats    — 404 no name / 404 missing file / 200 file body / 500 on error
 *   allProjectStats — empty {} / aggregates per-project json / skips corrupt json
 *   refreshStats    — starts worker if absent / 200 on scan-all-done / 504 on timeout /
 *                     500 when worker unavailable
 *   cliMode         — reflects deps.isCliMode / isSdkMode / workspace flags
 *
 * Isolation: CCV_LOG_DIR + CCV_PROJECT_DIR set to mkdtemp dirs BEFORE importing the
 * route module (so findcc's LOG_DIR resolves into the sandbox). _projectName is driven
 * via interceptor.initForWorkspace (ESM live binding → project-meta sees the update).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// --- sandbox env BEFORE any findcc/interceptor-loading import ---
const TMP = mkdtempSync(join(tmpdir(), 'ccv-projmeta-'));
const LOG = join(TMP, 'logs');
const PROJECT = join(TMP, 'project');
mkdirSync(LOG, { recursive: true });
mkdirSync(PROJECT, { recursive: true });
process.env.CCV_LOG_DIR = LOG;
process.env.CCV_PROJECT_DIR = PROJECT;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

/** Fake res capturing the first writeHead status + the end() payload. */
function makeRes() {
  const res = {
    status: null,
    headers: null,
    body: '',
    writeHead(code, headers) { this.status = code; this.headers = headers; },
    end(payload) { this.body = payload || ''; },
    json() { return JSON.parse(this.body || '{}'); },
  };
  return res;
}

let routes, interceptor, LOG_DIR;
function route(path, method = 'GET') {
  const r = routes.find((x) => x.path === path && x.method === method);
  assert.ok(r, `route ${method} ${path} must exist`);
  return r.handler;
}

before(async () => {
  const mod = await import('../server/routes/project-meta.js');
  routes = mod.projectMetaRoutes;
  interceptor = await import('../server/interceptor.js');
  ({ LOG_DIR } = await import('../findcc.js'));
  assert.equal(LOG_DIR, LOG, 'findcc LOG_DIR must resolve into the sandbox');
});

after(() => { rmSync(TMP, { recursive: true, force: true }); });

describe('GET /api/project-name', () => {
  it('returns the empty project name in workspace mode (not yet selected)', () => {
    interceptor.resetWorkspace();
    const res = makeRes();
    route('/api/project-name')({}, res);
    assert.equal(res.status, 200);
    assert.deepEqual(res.json(), { projectName: '' });
  });

  it('reflects the project name after initForWorkspace (live binding)', () => {
    interceptor.initForWorkspace(PROJECT, { forceNew: true });
    const res = makeRes();
    route('/api/project-name')({}, res);
    assert.equal(res.status, 200);
    // basename(PROJECT) sanitized
    assert.equal(res.json().projectName, 'project');
  });
});

describe('GET /api/project-dir', () => {
  it('returns CCV_PROJECT_DIR', () => {
    const res = makeRes();
    route('/api/project-dir')({}, res);
    assert.equal(res.status, 200);
    assert.equal(res.json().dir, PROJECT);
  });

  it('falls back to cwd when CCV_PROJECT_DIR is unset', () => {
    const saved = process.env.CCV_PROJECT_DIR;
    delete process.env.CCV_PROJECT_DIR;
    try {
      const res = makeRes();
      route('/api/project-dir')({}, res);
      assert.equal(res.json().dir, process.cwd());
    } finally {
      process.env.CCV_PROJECT_DIR = saved;
    }
  });
});

describe('GET /api/version-info', () => {
  it('returns 200 with version + a known installMethod', () => {
    const res = makeRes();
    route('/api/version-info')({}, res);
    assert.equal(res.status, 200);
    const j = res.json();
    assert.match(j.version, /^\d+\.\d+\.\d+/);
    assert.ok(['electron', 'brew', 'npm'].includes(j.installMethod));
  });
});

describe('GET /api/project-stats', () => {
  it('returns 404 when there is no project name', () => {
    interceptor.resetWorkspace();
    const res = makeRes();
    route('/api/project-stats')({}, res);
    assert.equal(res.status, 404);
    assert.match(res.json().error, /No project name/);
  });

  it('returns 404 when the stats file is missing', () => {
    interceptor.initForWorkspace(PROJECT, { forceNew: true }); // name = 'project'
    const res = makeRes();
    route('/api/project-stats')({}, res);
    assert.equal(res.status, 404);
    assert.match(res.json().error, /Stats file not found/);
  });

  it('returns 200 with the raw stats file body when present', () => {
    interceptor.initForWorkspace(PROJECT, { forceNew: true }); // name = 'project'
    const projDir = join(LOG, 'project');
    mkdirSync(projDir, { recursive: true });
    const payload = JSON.stringify({ totalSessions: 7, totalCost: 1.23 });
    writeFileSync(join(projDir, 'project.json'), payload);
    const res = makeRes();
    route('/api/project-stats')({}, res);
    assert.equal(res.status, 200);
    assert.equal(res.body, payload, 'streams the file verbatim');
    assert.deepEqual(res.json(), { totalSessions: 7, totalCost: 1.23 });
  });

  it('returns 500 when reading the stats file throws (path is a directory)', () => {
    // Project name 'eisdir' whose stats "file" is actually a directory: existsSync
    // passes but readFileSync raises EISDIR → caught → 500 with err.message.
    interceptor.initForWorkspace(join(TMP, 'eisdir'), { forceNew: true });
    const projDir = join(LOG, 'eisdir');
    mkdirSync(join(projDir, 'eisdir.json'), { recursive: true }); // a DIR named like the stats file
    const res = makeRes();
    route('/api/project-stats')({}, res);
    assert.equal(res.status, 500);
    assert.equal(typeof res.json().error, 'string');
  });
});

describe('GET /api/all-project-stats', () => {
  it('aggregates valid per-project json and skips corrupt ones', () => {
    // Build a clean LOG dir layout: alpha (valid), beta (valid), gamma (corrupt), file (ignored)
    const a = join(LOG, 'alpha'); mkdirSync(a, { recursive: true });
    writeFileSync(join(a, 'alpha.json'), JSON.stringify({ sessions: 1 }));
    const b = join(LOG, 'beta'); mkdirSync(b, { recursive: true });
    writeFileSync(join(b, 'beta.json'), JSON.stringify({ sessions: 2 }));
    const g = join(LOG, 'gamma'); mkdirSync(g, { recursive: true });
    writeFileSync(join(g, 'gamma.json'), '{ broken json'); // corrupt → skipped
    const d = join(LOG, 'delta'); mkdirSync(d, { recursive: true }); // no json → skipped

    const res = makeRes();
    route('/api/all-project-stats')({}, res);
    assert.equal(res.status, 200);
    const all = res.json();
    assert.deepEqual(all.alpha, { sessions: 1 });
    assert.deepEqual(all.beta, { sessions: 2 });
    assert.equal('gamma' in all, false, 'corrupt json must be skipped, not crash');
    assert.equal('delta' in all, false, 'dir without stats json is absent');
  });
});

describe('POST /api/refresh-stats', () => {
  it('returns 500 when no worker exists and one cannot be started', () => {
    const res = makeRes();
    let started = false;
    const deps = {
      statsWorker: null,
      startStatsWorker() { started = true; /* fails to produce a worker */ },
    };
    route('/api/refresh-stats', 'POST')({}, res, {}, true, deps);
    assert.equal(started, true, 'attempts to start the worker');
    assert.equal(res.status, 500);
    assert.match(res.json().error, /Stats worker not available/);
  });

  it('starts a worker if absent, posts scan-all, and 200s on scan-all-done', async () => {
    const worker = new EventEmitter();
    worker.postMessage = (msg) => { worker._lastMsg = msg; };
    let startCalled = false;
    const deps = {
      statsWorker: null,
      startStatsWorker() { startCalled = true; deps.statsWorker = worker; },
    };
    const res = makeRes();
    route('/api/refresh-stats', 'POST')({}, res, {}, true, deps);
    assert.equal(startCalled, true);
    // It should have posted a scan-all message with the LOG_DIR
    assert.equal(worker._lastMsg.type, 'scan-all');
    assert.equal(worker._lastMsg.logDir, LOG_DIR);
    // Simulate worker completion
    worker.emit('message', { type: 'scan-all-done' });
    // give the handler a tick to write the response
    await new Promise((r) => setImmediate(r));
    assert.equal(res.status, 200);
    assert.deepEqual(res.json(), { ok: true });
    assert.equal(worker.listenerCount('message'), 0, 'onDone listener removed after completion');
  });

  it('ignores unrelated worker messages and only completes on scan-all-done', async () => {
    const worker = new EventEmitter();
    worker.postMessage = () => {};
    const deps = { statsWorker: worker, startStatsWorker() {} };
    const res = makeRes();
    route('/api/refresh-stats', 'POST')({}, res, {}, true, deps);
    worker.emit('message', { type: 'progress', pct: 50 }); // ignored
    await new Promise((r) => setImmediate(r));
    assert.equal(res.status, null, 'no response yet on unrelated message');
    worker.emit('message', { type: 'scan-all-done' });
    await new Promise((r) => setImmediate(r));
    assert.equal(res.status, 200);
  });

  it('returns 504 when the worker never finishes (timeout fires)', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const worker = new EventEmitter();
    worker.postMessage = () => {};
    const deps = { statsWorker: worker, startStatsWorker() {} };
    const res = makeRes();
    route('/api/refresh-stats', 'POST')({}, res, {}, true, deps);
    // Advance past the 30s timeout without emitting scan-all-done
    t.mock.timers.tick(30001);
    assert.equal(res.status, 504);
    assert.match(res.json().error, /timed out/);
    assert.equal(worker.listenerCount('message'), 0, 'onDone listener removed on timeout');
  });

  it('returns 500 when startStatsWorker throws', () => {
    const res = makeRes();
    const deps = {
      statsWorker: null,
      startStatsWorker() { throw new Error('spawn failed'); },
    };
    route('/api/refresh-stats', 'POST')({}, res, {}, true, deps);
    assert.equal(res.status, 500);
    assert.match(res.json().error, /spawn failed/);
  });
});

describe('GET /api/cli-mode', () => {
  it('reflects deps cli/sdk/workspace flags (workspace gated on !workspaceLaunched)', () => {
    const res = makeRes();
    route('/api/cli-mode')({}, res, {}, true, {
      isCliMode: true, isSdkMode: false, isWorkspaceMode: true, workspaceLaunched: false,
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json(), { cliMode: true, sdkMode: false, workspaceMode: true });
  });

  it('workspaceMode is false once the workspace has launched', () => {
    const res = makeRes();
    route('/api/cli-mode')({}, res, {}, true, {
      isCliMode: false, isSdkMode: true, isWorkspaceMode: true, workspaceLaunched: true,
    });
    assert.deepEqual(res.json(), { cliMode: false, sdkMode: true, workspaceMode: false });
  });
});
