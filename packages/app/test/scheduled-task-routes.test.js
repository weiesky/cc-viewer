// Tests for packages/app/server/routes/scheduled-tasks.js — CRUD, preview, runs, auth.
// LOG_DIR is redirected to a temp dir BEFORE any import that loads findcc.
import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-sched-routes-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';
process.env.CCV_PROJECT_DIR = join(tmpDir, 'projA');

const { scheduledTasksRoutes } = await import('../server/routes/scheduled-tasks.js');
const { initForWorkspace } = await import('../server/interceptor.js');

after(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

function route(method, path) {
  return scheduledTasksRoutes.find(r => r.method === method && r.path === path).handler;
}
function callGet(handler, query = {}, deps = { clients: [], MAX_POST_BODY: 1 << 20 }) {
  let payload = '';
  let status = 0;
  const res = { writeHead(c) { status = c; }, end(b) { payload = b || ''; } };
  const url = new URL('http://localhost/x');
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  handler({ headers: {} }, res, url, true, deps);
  return { status, data: JSON.parse(payload || '{}') };
}
function callPost(handler, body, { isLocal = true, headers = {} } = {}, deps = { clients: [], MAX_POST_BODY: 1 << 20 }) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    req.headers = headers;
    let status = 0;
    const res = { writeHead(c) { status = c; }, end(b) { resolve({ status, data: JSON.parse(b || '{}') }); } };
    handler(req, res, new URL('http://localhost/x'), isLocal, deps);
    req.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
    req.emit('end');
  });
}

describe('scheduled-tasks routes', () => {
  before(() => { initForWorkspace(process.env.CCV_PROJECT_DIR, { forceNew: true }); });

  it('GET list: empty initially, includes serverTime/timezone/spawnAvailable', () => {
    const { status, data } = callGet(route('GET', '/api/scheduled-tasks'));
    assert.equal(status, 200);
    assert.deepEqual(data.tasks, []);
    assert.equal(typeof data.serverTime, 'number');
    assert.equal(typeof data.timezone, 'string');
    assert.equal('spawnAvailable' in data, true);
  });

  it('POST create → task persisted + broadcast; GET reads it back', async () => {
    const sent = [];
    const deps = { clients: [{ write(p) { sent.push(p); return true; } }], MAX_POST_BODY: 1 << 20 };
    const { status, data } = await callPost(route('POST', '/api/scheduled-tasks'), {
      prompt: 'review the code', mode: 'inject', schedule: { kind: 'daily', time: '09:00' }, enabled: true,
    }, {}, deps);
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.ok(data.task.id.startsWith('st_'));
    assert.ok(sent.some(p => /event: scheduled_tasks/.test(p) && /created/.test(p)));
    const list = callGet(route('GET', '/api/scheduled-tasks'), {}, deps);
    assert.equal(list.data.tasks.length, 1);
    assert.equal(list.data.tasks[0].prompt, 'review the code');
  });

  it('POST create: invalid schedule → 400 invalid_schedule', async () => {
    const { status, data } = await callPost(route('POST', '/api/scheduled-tasks'), {
      prompt: 'x', mode: 'inject', schedule: { kind: 'cron', expr: 'bad' },
    });
    assert.equal(status, 400);
    assert.equal(data.error, 'invalid_schedule');
  });

  it('POST create: spawn in non-SDK test env → 400 spawn_unavailable', async () => {
    const { status, data } = await callPost(route('POST', '/api/scheduled-tasks'), {
      prompt: 'x', mode: 'spawn', schedule: { kind: 'daily', time: '09:00' },
    });
    assert.equal(status, 400);
    assert.equal(data.error, 'spawn_unavailable');
  });

  it('write routes: cross-site Origin → 403 forbidden', async () => {
    const { status, data } = await callPost(route('POST', '/api/scheduled-tasks'), {
      prompt: 'x', mode: 'inject', schedule: { kind: 'daily', time: '09:00' },
    }, { headers: { origin: 'http://evil.example', host: 'localhost' } });
    assert.equal(status, 403);
    assert.equal(data.error, 'forbidden');
  });

  it('POST update: pause/resume + schedule edit', async () => {
    const created = await callPost(route('POST', '/api/scheduled-tasks'), {
      prompt: 'x', mode: 'inject', schedule: { kind: 'daily', time: '09:00' },
    });
    const id = created.data.task.id;
    const paused = await callPost(route('POST', '/api/scheduled-tasks/update'), { id, enabled: false });
    assert.equal(paused.data.task.enabled, false);
    const edited = await callPost(route('POST', '/api/scheduled-tasks/update'), { id, schedule: { kind: 'hourly', minute: 5 } });
    assert.equal(edited.data.task.schedule.kind, 'hourly');
  });

  it('POST delete: removes; deleting again → 404', async () => {
    const created = await callPost(route('POST', '/api/scheduled-tasks'), {
      prompt: 'x', mode: 'inject', schedule: { kind: 'daily', time: '09:00' },
    });
    const id = created.data.task.id;
    const del = await callPost(route('POST', '/api/scheduled-tasks/delete'), { id });
    assert.equal(del.status, 200);
    const again = await callPost(route('POST', '/api/scheduled-tasks/delete'), { id });
    assert.equal(again.status, 404);
  });

  it('POST preview: returns next fire times + serverTime/timezone', async () => {
    const { status, data } = await callPost(route('POST', '/api/scheduled-tasks/preview'), {
      schedule: { kind: 'daily', time: '09:00' },
    });
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.next) && data.next.length === 3);
    assert.ok(data.next.every(t => typeof t === 'number'));
    assert.equal(typeof data.timezone, 'string');
    const bad = await callPost(route('POST', '/api/scheduled-tasks/preview'), { schedule: { kind: 'cron', expr: 'bad' } });
    assert.equal(bad.status, 400);
  });

  it('GET runs: 404 for unknown task; recent runs for a real task', async () => {
    const missing = callGet(route('GET', '/api/scheduled-tasks/runs'), { id: 'st_nope' });
    assert.equal(missing.status, 404);
    const created = await callPost(route('POST', '/api/scheduled-tasks'), {
      prompt: 'x', mode: 'inject', schedule: { kind: 'daily', time: '09:00' },
    });
    const runs = callGet(route('GET', '/api/scheduled-tasks/runs'), { id: created.data.task.id });
    assert.equal(runs.status, 200);
    assert.ok(Array.isArray(runs.data.runs));
  });

  it('POST run: scheduler not initialized in test → 503 scheduler_unavailable', async () => {
    const created = await callPost(route('POST', '/api/scheduled-tasks'), {
      prompt: 'x', mode: 'inject', schedule: { kind: 'daily', time: '09:00' },
    });
    const { status, data } = await callPost(route('POST', '/api/scheduled-tasks/run'), { id: created.data.task.id });
    assert.equal(status, 503);
    assert.equal(data.error, 'scheduler_unavailable');
  });

  it('list tasks never carry runs/runCount; runs come from the runs file', async () => {
    const created = await callPost(route('POST', '/api/scheduled-tasks'), {
      prompt: 'with history', mode: 'inject', schedule: { kind: 'daily', time: '09:00' },
    });
    const id = created.data.task.id;
    // Seed a run directly in the runs store (scheduler isn't running in this test).
    const { appendRun } = await import('../server/lib/scheduled-task-runs-store.js');
    await appendRun(tmpDir, id, { status: 'completed', at: 1, finishedAt: 2, claimRunId: 'run_seed' });
    const list = callGet(route('GET', '/api/scheduled-tasks'));
    const t = list.data.tasks.find(x => x.id === id);
    assert.ok(t, 'task listed');
    assert.equal('runs' in t, false, 'list never embeds runs');
    assert.equal('runCount' in t, false, 'runCount removed');
    const runs = callGet(route('GET', '/api/scheduled-tasks/runs'), { id });
    assert.equal(runs.status, 200);
    assert.equal(runs.data.runs.length, 1);
    assert.equal(runs.data.runs[0].claimRunId, 'run_seed');
  });

  it('GET list: corrupt prefs → storeCorrupt:true', async () => {
    const { prefsFilePath } = await import('../server/lib/scheduled-task-store.js');
    const { writeFileSync, readFileSync } = await import('node:fs');
    const file = prefsFilePath(tmpDir);
    const saved = readFileSync(file, 'utf-8');
    try {
      writeFileSync(file, 'not json');
      const { status, data } = callGet(route('GET', '/api/scheduled-tasks'));
      assert.equal(status, 200);
      assert.equal(data.storeCorrupt, true);
    } finally {
      writeFileSync(file, saved);
    }
  });

  it('GET list: arbitrary ?project= for an unknown project returns summaries, not full prompts', async () => {
    // Seed a task under a project name that does not resolve (not bound, not registered,
    // no live instance) — the summary shape must apply even though rows exist.
    const { createTask } = await import('../server/lib/scheduled-task-store.js');
    const r = await createTask(tmpDir, {
      project: 'no-such-project', cwd: '/tmp/no-such-project', prompt: 'secret prompt text',
      mode: 'inject', schedule: { kind: 'daily', time: '09:00' }, enabled: true,
    }, Date.now());
    assert.equal(r.ok, true);
    const { data } = callGet(route('GET', '/api/scheduled-tasks'), { project: 'no-such-project' });
    assert.equal(data.tasks.length, 1, 'the unresolvable project still lists its task');
    assert.equal('prompt' in data.tasks[0], false, 'unknown project → summary-only shape');
    assert.equal(typeof data.tasks[0].promptSummary, 'string');
  });
});
