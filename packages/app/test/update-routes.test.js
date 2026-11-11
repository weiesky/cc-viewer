import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { updateRoutes } from '../server/routes/update.js';
import { UpdateJob } from '../server/lib/update-job.js';

function response() {
  return { status: null, body: '', writeHead(code) { this.status = code; }, end(body) { this.body = JSON.parse(body); this.writableEnded = true; } };
}
function route(path) { return updateRoutes.find(r => r.path === path); }
function job(status = 'idle') { return { getState: () => ({ status, version: '1.9.25' }), check: async () => ({ status: 'available' }), start: async () => ({ status: 'restart_required' }) }; }

describe('update routes', () => {
  it('requires admin and same-origin on reads and writes', async () => {
    for (const path of ['/api/update/status', '/api/update/check', '/api/update/start', '/api/update/restart']) {
      const res = response();
      await route(path).handler({ headers: {} }, res, {}, false, { updateJob: job() });
      assert.equal(res.status, 403);
    }
  });
  it('rejects cross-site requests even from loopback', async () => {
    const res = response();
    await route('/api/update/start').handler({ headers: { 'sec-fetch-site': 'cross-site' } }, res, {}, true, { updateJob: job() });
    assert.equal(res.status, 403);
  });
  it('starts only one explicit update job and returns state', async () => {
    let calls = 0;
    const deps = { canRestartProcess: true, updateJob: { ...job(), start: async () => { calls++; return { status: 'downloading' }; } } };
    const res = response();
    await route('/api/update/start').handler({ headers: {} }, res, {}, true, deps);
    assert.equal(res.status, 202);
    assert.equal(calls, 1);
  });
  it('returns the current state for a duplicate start without another job', async () => {
    let calls = 0;
    const res = response();
    const deps = { canRestartProcess: true, updateJob: { getState: () => ({ status: 'downloading' }), start: async () => { calls++; } } };
    await route('/api/update/start').handler({ headers: {} }, res, {}, true, deps);
    assert.equal(res.status, 200);
    assert.equal(calls, 0);
  });
  it('rejects a new update when this launch mode cannot restart', async () => {
    const res = response();
    await route('/api/update/start').handler({ headers: {} }, res, {}, true, { updateJob: job(), canRestartProcess: false });
    assert.equal(res.status, 409);
  });
  it('rejects restart until verified and when no launcher is registered', async () => {
    let res = response();
    await route('/api/update/restart').handler({ headers: {} }, res, {}, true, { updateJob: job('downloading') });
    assert.equal(res.status, 409);
    res = response();
    await route('/api/update/restart').handler({ headers: {} }, res, {}, true, { updateJob: job('restart_required') });
    assert.equal(res.status, 409);
  });
  it('confirms restart before invoking the registered process callback', async () => {
    let version;
    const updateJob = new UpdateJob();
    updateJob.setState({ status: 'restart_required', version: '1.9.25' });
    const res = response();
    await route('/api/update/restart').handler({ headers: {} }, res, {}, true, { updateJob, canRestartProcess: true, restartProcess: async v => { version = v; } });
    assert.equal(res.body.ok, true);
    assert.equal(version, '1.9.25');
    const second = response();
    await route('/api/update/restart').handler({ headers: {} }, second, {}, true, { updateJob, canRestartProcess: true, restartProcess: async () => { throw new Error('duplicate'); } });
    assert.equal(second.body.status, 'restarting', 'duplicate requests observe the one-shot restart');
  });
  it('does not launch updates while stopping', async () => {
    const res = response();
    await route('/api/update/start').handler({ headers: {} }, res, {}, true, { updateJob: job(), isRuntimeStopping: true });
    assert.equal(res.status, 409);
  });
});
