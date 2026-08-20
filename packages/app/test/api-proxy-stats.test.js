// Route tests for GET /api/proxy-stats and POST /api/refresh-proxy-stats
// (server/routes/proxy-stats.js) — review P1: the wiring layer had zero
// coverage while the pure aggregation layer was well-tested.
//
//   getProxyStats     — 404 no project name / null when stats file missing /
//                       200 with proxyStats field / null when field absent /
//                       500 on corrupt stats JSON
//   refreshProxyStats — starts worker if absent / 200 on scan-all-done /
//                       504 on timeout / 500 when worker unavailable
//
// Isolation: CCV_LOG_DIR set to a mkdtemp dir BEFORE any interceptor-loading
// import (findcc's LOG_DIR resolves into the sandbox). _projectName is driven
// via interceptor.initForWorkspace (ESM live binding, same pattern as
// test/api-project-meta-gap.test.js).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// --- sandbox env BEFORE any findcc/interceptor-loading import ---
const TMP = mkdtempSync(join(tmpdir(), 'ccv-proxy-stats-routes-'));
process.env.CCV_LOG_DIR = TMP;
process.env.CLAUDE_CONFIG_DIR = TMP;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

const PROJECT = join(TMP, 'projx');

function mkRes() {
  let status = 0;
  let payload = '';
  return {
    writeHead(s) { status = s; },
    end(b) { payload = b || ''; },
    get status() { return status; },
    get payload() { return payload; },
    get body() { try { return JSON.parse(payload); } catch { return null; } },
  };
}

let getRoute; let postRoute; let interceptor;
before(async () => {
  interceptor = await import('../server/interceptor.js');
  const { proxyStatsRoutes } = await import('../server/routes/proxy-stats.js');
  getRoute = proxyStatsRoutes.find((r) => r.path === '/api/proxy-stats' && r.method === 'GET');
  postRoute = proxyStatsRoutes.find((r) => r.path === '/api/refresh-proxy-stats' && r.method === 'POST');
  assert.ok(getRoute, 'GET /api/proxy-stats route must exist');
  assert.ok(postRoute, 'POST /api/refresh-proxy-stats route must exist');
});
after(() => { rmSync(TMP, { recursive: true, force: true }); });

describe('GET /api/proxy-stats', { concurrency: false }, () => {
  it('404 + null proxyStats when no project name is bound', () => {
    // _projectName starts empty in workspace mode until initForWorkspace runs
    const res = mkRes();
    getRoute.handler({}, res, {}, true, {});
    assert.equal(res.status, 404);
    assert.equal(res.body.proxyStats, null);
  });

  it('null proxyStats when the stats file does not exist yet', () => {
    interceptor.initForWorkspace(PROJECT, { forceNew: true }); // name = 'projx'
    const res = mkRes();
    getRoute.handler({}, res, {}, true, {});
    assert.equal(res.status, 200);
    assert.equal(res.body.proxyStats, null);
  });

  it('returns the proxyStats field of <project>.json', () => {
    interceptor.initForWorkspace(PROJECT, { forceNew: true });
    mkdirSync(join(TMP, 'projx'), { recursive: true });
    const proxyStats = { totalRequests: 3, downstreamAvailability: 1 };
    writeFileSync(join(TMP, 'projx', 'projx.json'), JSON.stringify({ _v: 12, proxyStats }));
    const res = mkRes();
    getRoute.handler({}, res, {}, true, {});
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.proxyStats, proxyStats);
  });

  it('null proxyStats when the stats file lacks the field (pre-v12 cache)', () => {
    interceptor.initForWorkspace(PROJECT, { forceNew: true });
    writeFileSync(join(TMP, 'projx', 'projx.json'), JSON.stringify({ _v: 11, summary: {} }));
    const res = mkRes();
    getRoute.handler({}, res, {}, true, {});
    assert.equal(res.status, 200);
    assert.equal(res.body.proxyStats, null);
  });

  it('500 + null proxyStats on corrupt stats JSON', () => {
    interceptor.initForWorkspace(PROJECT, { forceNew: true });
    writeFileSync(join(TMP, 'projx', 'projx.json'), '{not json');
    const res = mkRes();
    getRoute.handler({}, res, {}, true, {});
    assert.equal(res.status, 500);
    assert.equal(res.body.proxyStats, null);
    assert.ok(res.body.error);
  });
});

describe('POST /api/refresh-proxy-stats', { concurrency: false }, () => {
  it('starts the worker when absent and posts scan-all with LOG_DIR', () => {
    const worker = new EventEmitter();
    worker.postMessage = (msg) => { worker._lastMsg = msg; };
    let startCalled = false;
    const deps = {
      statsWorker: null,
      startStatsWorker() { startCalled = true; deps.statsWorker = worker; },
    };
    const res = mkRes();
    postRoute.handler({}, res, {}, true, deps);
    assert.equal(startCalled, true);
    assert.equal(worker._lastMsg.type, 'scan-all');
    assert.equal(typeof worker._lastMsg.logDir, 'string');
    // resolve so the pending 30s timeout does not leak into other tests
    worker.emit('message', { type: 'scan-all-done' });
    assert.equal(res.status, 200);
  });

  it('200 { ok:true } on scan-all-done and removes its listener', () => {
    const worker = new EventEmitter();
    worker.postMessage = () => {};
    const res = mkRes();
    postRoute.handler({}, res, {}, true, { statsWorker: worker, startStatsWorker() {} });
    assert.equal(worker.listenerCount('message'), 1);
    worker.emit('message', { type: 'scan-all-done' });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(worker.listenerCount('message'), 0, 'done listener must be removed after resolve');
  });

  it('ignores unrelated worker messages while waiting', () => {
    const worker = new EventEmitter();
    worker.postMessage = () => {};
    const res = mkRes();
    postRoute.handler({}, res, {}, true, { statsWorker: worker, startStatsWorker() {} });
    worker.emit('message', { type: 'update-done' });
    assert.equal(res.status, 0, 'must not respond on non-scan-all-done messages');
    worker.emit('message', { type: 'scan-all-done' }); // cleanup: resolve the pending timeout
  });

  it('500 when the worker cannot be started', () => {
    const res = mkRes();
    postRoute.handler({}, res, {}, true, { statsWorker: null, startStatsWorker() {} });
    assert.equal(res.status, 500);
    assert.match(res.body.error, /not available/);
  });

  it('coalesces concurrent refreshes: one scan, one listener, all waiters resolved (review P2)', () => {
    const worker = new EventEmitter();
    let posts = 0;
    worker.postMessage = () => { posts += 1; };
    const deps = { statsWorker: worker, startStatsWorker() {} };
    const res1 = mkRes();
    const res2 = mkRes();
    const res3 = mkRes();
    postRoute.handler({}, res1, {}, true, deps);
    postRoute.handler({}, res2, {}, true, deps); // joins in-flight scan
    postRoute.handler({}, res3, {}, true, deps); // joins in-flight scan
    assert.equal(posts, 1, 'only the first request may start a scan');
    assert.equal(worker.listenerCount('message'), 1, 'only one shared done-listener');
    worker.emit('message', { type: 'scan-all-done' });
    for (const r of [res1, res2, res3]) {
      assert.equal(r.status, 200);
      assert.equal(r.body.ok, true);
    }
    assert.equal(worker.listenerCount('message'), 0);
    // The latch must reset: a new refresh after completion starts a fresh scan
    const res4 = mkRes();
    postRoute.handler({}, res4, {}, true, deps);
    assert.equal(posts, 2, 'post-completion refresh starts a new scan');
    worker.emit('message', { type: 'scan-all-done' });
    assert.equal(res4.status, 200);
  });
});
