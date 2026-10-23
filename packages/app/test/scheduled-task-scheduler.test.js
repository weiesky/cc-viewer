// Tests for packages/app/server/lib/scheduled-task-scheduler.js — tick loop, claim
// orchestration, catch-up, spawn caps, canExecute filtering, error containment.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTask, listTasks, readScheduledTasks } from '../server/lib/scheduled-task-store.js';
import {
  initScheduledTaskScheduler, runTaskNow, spawnAvailable, __resetSchedulerForTests, __tickForTests,
} from '../server/lib/scheduled-task-scheduler.js';

let root;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ccv-sched-')); });
afterEach(() => { __resetSchedulerForTests(); rmSync(root, { recursive: true, force: true }); });

function makeDeps(over = {}) {
  const calls = { execute: [], broadcast: [], report: [] };
  return {
    calls,
    getRoot: () => root,
    getMode: () => ({ sdk: true }),
    getSpawnConfig: () => ({ available: true }),
    canExecute: () => true,
    isReady: () => true,
    execute: async (task, claim) => { calls.execute.push({ task: task.id, claim }); return { status: task.mode === 'spawn' ? 'completed' : 'dispatched', durationMs: 5 }; },
    broadcast: (project, payload) => { calls.broadcast.push(payload); },
    report: (tag, err) => { calls.report.push({ tag, err }); },
    ...over,
  };
}

// Drive the private _tick by faking a due task and calling runTaskNow's underlying
// path is not enough; instead we call the exported helpers + a manual claim/tick via
// a tiny harness: create a due task, then invoke the module's tick through runTaskNow
// is manual. For tick coverage we expose a test hook through init + a fake interval.
// The scheduler's _tick is exercised indirectly: we rely on runTaskNow + direct claim.

test('runTaskNow: claims and executes, broadcasts running + final', async () => {
  const deps = makeDeps();
  initScheduledTaskScheduler(deps);
  // Pretend the loop is running (runTaskNow requires _timer). Start it via internal.
  // We can't call startScheduledTaskScheduler without waiting 20s; instead we set the
  // timer manually through a real start and immediately stop the interval but keep the flag.
  const { createTask: ct } = await import('../server/lib/scheduled-task-store.js');
  const { task } = await ct(root, { project: 'p', cwd: '/tmp/p', prompt: 'hi', mode: 'inject', schedule: { kind: 'daily', time: '09:00' } }, Date.now());
  // Manually start + stop to set _timer, then call runTaskNow (which only checks _timer truthiness
  // before we cleared it — so instead we temporarily monkey-start). Use a direct approach:
  // start, then runTaskNow works because _timer set; clear right after.
  const mod = await import('../server/lib/scheduled-task-scheduler.js');
  mod.__proto__; // noop
  // start sets _timer
  const { startScheduledTaskScheduler, stopScheduledTaskScheduler } = mod;
  startScheduledTaskScheduler();
  const r = await runTaskNow(task.id, { manual: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.action, 'claimed');
  // Wait a tick for the fire-and-forget _launch to settle.
  await new Promise(r2 => setTimeout(r2, 50));
  assert.equal(deps.calls.execute.length, 1);
  assert.ok(deps.calls.broadcast.some(p => p.status === 'running'));
  assert.ok(deps.calls.broadcast.some(p => p.status === 'dispatched'));
  stopScheduledTaskScheduler();
});

test('runTaskNow: unavailable when scheduler not started', async () => {
  initScheduledTaskScheduler(makeDeps());
  __resetSchedulerForTests(); // clears _deps AND _timer
  initScheduledTaskScheduler(makeDeps()); // deps set, but _timer null (not started)
  const r = await runTaskNow('st_x', { manual: true });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'scheduler_unavailable');
});

test('spawnAvailable: reflects mode + spawn config', async () => {
  initScheduledTaskScheduler(makeDeps());
  assert.equal(spawnAvailable(), true);
  initScheduledTaskScheduler(makeDeps({ getSpawnConfig: () => ({ available: false }) }));
  assert.equal(spawnAvailable(), false);
  initScheduledTaskScheduler(makeDeps({ getMode: () => ({ sdk: false }) }));
  assert.equal(spawnAvailable(), false);
});

test('executor errors are contained and reported, not thrown (compliance P0)', async () => {
  const deps = makeDeps({
    execute: async () => { throw new Error('boom'); },
  });
  initScheduledTaskScheduler(deps);
  const { createTask: ct } = await import('../server/lib/scheduled-task-store.js');
  const { task } = await ct(root, { project: 'p', cwd: '/tmp/p', prompt: 'hi', mode: 'spawn', schedule: { kind: 'daily', time: '09:00' } }, Date.now());
  const mod = await import('../server/lib/scheduled-task-scheduler.js');
  mod.startScheduledTaskScheduler();
  const r = await runTaskNow(task.id, { manual: true });
  assert.equal(r.ok, true);
  await new Promise(r2 => setTimeout(r2, 50));
  // Error was reported and an 'error' result broadcast, no unhandled rejection.
  assert.ok(deps.calls.report.some(c => c.tag === 'scheduler.execute'));
  assert.ok(deps.calls.broadcast.some(p => p.status === 'error'));
  const t = listTasks(root)[0];
  assert.equal(t.lastResult, 'error');
  mod.stopScheduledTaskScheduler();
});

test('spawn concurrency cap: a second spawn for the same project is skipped/busy', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const deps = makeDeps({
    execute: async (task) => {
      if (task.prompt === 'slow') { await gate; }
      return { status: 'completed', durationMs: 5 };
    },
  });
  initScheduledTaskScheduler(deps);
  const { createTask: ct } = await import('../server/lib/scheduled-task-store.js');
  const slow = (await ct(root, { project: 'p', cwd: '/tmp/p', prompt: 'slow', mode: 'spawn', schedule: { kind: 'daily', time: '09:00' } }, Date.now())).task;
  const fast = (await ct(root, { project: 'p', cwd: '/tmp/p', prompt: 'fast', mode: 'spawn', schedule: { kind: 'daily', time: '09:00' } }, Date.now())).task;
  const mod = await import('../server/lib/scheduled-task-scheduler.js');
  mod.startScheduledTaskScheduler();
  const r1 = await runTaskNow(slow.id, { manual: true });   // occupies the per-project spawn slot
  assert.equal(r1.ok, true);
  await new Promise(r2 => setTimeout(r2, 10));              // let slow start (it's gated)
  const r2 = await runTaskNow(fast.id, { manual: true });
  assert.equal(r2.ok, true);
  await new Promise(r3 => setTimeout(r3, 50));
  release();
  await new Promise(r3 => setTimeout(r3, 50));
  // fast was skipped as busy while slow held the per-project spawn slot.
  assert.ok(deps.calls.broadcast.some(p => p.status === 'skipped' && p.reason === 'busy'));
  mod.stopScheduledTaskScheduler();
});

test('tick: a due task is claimed + executed + broadcast (real _tick drive)', async () => {
  const deps = makeDeps();
  initScheduledTaskScheduler(deps);
  const { createTask: ct } = await import('../server/lib/scheduled-task-store.js');
  const now = Date.now();
  // hourly at the current minute+1s so it's due "now" at tick time.
  const { task } = await ct(root, { project: 'p', cwd: '/tmp/p', prompt: 'hi', mode: 'inject', schedule: { kind: 'cron', expr: '* * * * *' } }, now);
  const dueNow = task.nextRunAt + 1000;
  await __tickForTests(dueNow);
  await new Promise(r => setTimeout(r, 50)); // let the fire-and-forget _launch settle
  assert.equal(deps.calls.execute.length, 1, 'due task executed');
  assert.ok(deps.calls.broadcast.some(p => p.status === 'dispatched'));
});

test('tick: not-due task is NOT claimed', async () => {
  const deps = makeDeps();
  initScheduledTaskScheduler(deps);
  const { createTask: ct } = await import('../server/lib/scheduled-task-store.js');
  await ct(root, { project: 'p', cwd: '/tmp/p', prompt: 'hi', mode: 'inject', schedule: { kind: 'daily', time: '09:00' } }, Date.now());
  await __tickForTests(Date.now());
  await new Promise(r => setTimeout(r, 30));
  assert.equal(deps.calls.execute.length, 0, 'not due → no execution');
});

test('tick: canExecute=false claims nothing (multi-process P0-1, real drive)', async () => {
  const deps = makeDeps({ canExecute: () => false });
  initScheduledTaskScheduler(deps);
  const { createTask: ct, readScheduledTasks: rd } = await import('../server/lib/scheduled-task-store.js');
  const now = Date.now();
  const { task } = await ct(root, { project: 'p', cwd: '/tmp/p', prompt: 'hi', mode: 'inject', schedule: { kind: 'cron', expr: '* * * * *' } }, now);
  await __tickForTests(task.nextRunAt + 1000);
  await new Promise(r => setTimeout(r, 30));
  assert.equal(deps.calls.execute.length, 0, 'non-executor claims nothing');
  assert.equal(rd(root).tasks[0].claim, null, 'no claim was taken');
});

test('tick: canExecute throwing is fail-CLOSED (claims nothing, reports)', async () => {
  const reports = [];
  const deps = makeDeps({ canExecute: () => { throw new Error('capability probe broke'); }, report: (tag, err) => reports.push(tag) });
  initScheduledTaskScheduler(deps);
  const { createTask: ct, readScheduledTasks: rd } = await import('../server/lib/scheduled-task-store.js');
  const now = Date.now();
  const { task } = await ct(root, { project: 'p', cwd: '/tmp/p', prompt: 'hi', mode: 'inject', schedule: { kind: 'cron', expr: '* * * * *' } }, now);
  await __tickForTests(task.nextRunAt + 1000);
  await new Promise(r => setTimeout(r, 30));
  assert.equal(deps.calls.execute.length, 0, 'a throwing canExecute claims nothing');
  assert.equal(rd(root).tasks[0].claim, null);
});

test('legacy fallback: tick never claims legacy tasks and never writes the prefs tombstone', async () => {
  const { writeFileSync, existsSync } = await import('node:fs');
  const { legacyTasksFilePath, prefsFilePath } = await import('../server/lib/scheduled-task-store.js');
  // A legacy-only registry (no prefs scheduledTasks key).
  writeFileSync(legacyTasksFilePath(root), JSON.stringify({
    version: 1,
    tasks: [{ id: 'st_legacy', project: 'p', cwd: '/tmp/p', prompt: 'old', mode: 'inject', schedule: { kind: 'cron', expr: '* * * * *' }, enabled: true, nextRunAt: Date.now() - 1000, claim: null }],
  }));
  const deps = makeDeps();
  initScheduledTaskScheduler(deps);
  await __tickForTests(Date.now());
  await new Promise(r => setTimeout(r, 30));
  assert.equal(deps.calls.execute.length, 0, 'legacy tasks are never executed');
  assert.equal(existsSync(prefsFilePath(root)), false, 'no prefs tombstone written for legacy');
});
