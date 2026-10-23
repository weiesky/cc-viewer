// Tests for packages/app/server/lib/scheduled-task-store.js — locked CRUD, atomic
// claim (multi-process mutual exclusion), finalize CAS, catch-up/missed, stale sweep,
// prefs storage + legacy read-only fallback + runs split.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  prefsFilePath, legacyTasksFilePath, readScheduledTasks, createTask, updateTask, deleteTask,
  claimTask, finalizeTask, sweepStaleClaims, listTasks,
} from '../server/lib/scheduled-task-store.js';
import { readScheduledTaskRuns, runsFilePath } from '../server/lib/scheduled-task-runs-store.js';

let root;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ccv-st-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const MIN = 60_000;
const DAY = 24 * 3600 * 1000;
function draft(over = {}) {
  return {
    project: 'proj', cwd: '/tmp/proj', prompt: 'do the thing', mode: 'inject',
    schedule: { kind: 'daily', time: '09:00' }, enabled: true, ...over,
  };
}
function readPrefs() { return JSON.parse(readFileSync(prefsFilePath(root), 'utf-8')); }

test('createTask: validates prompt/mode/schedule, computes nextRunAt, stores in prefs without runs', async () => {
  const now = Date.now();
  const r = await createTask(root, draft(), now);
  assert.equal(r.ok, true);
  assert.ok(r.task.id.startsWith('st_'));
  assert.ok(r.task.nextRunAt > now);
  assert.equal(r.task.claim, null);
  assert.equal('runs' in r.task, false);
  // Persisted under preferences.json scheduledTasks, with runs nowhere in the task.
  const prefs = readPrefs();
  assert.ok(Array.isArray(prefs.scheduledTasks.tasks));
  assert.equal(prefs.scheduledTasks.tasks[0].id, r.task.id);
  assert.equal('runs' in prefs.scheduledTasks.tasks[0], false);
  // invalids
  assert.equal((await createTask(root, draft({ prompt: '  ' }), now)).reason, 'invalid_prompt');
  assert.equal((await createTask(root, draft({ mode: 'nope' }), now)).reason, 'invalid_mode');
  assert.equal((await createTask(root, draft({ schedule: { kind: 'cron', expr: 'bad' } }), now)).reason, 'invalid_schedule');
  assert.equal((await createTask(root, draft({ schedule: { kind: 'once', at: now - 1 } }), now)).reason, 'once_in_past');
});

test('createTask: enforces per-project limit of 50', async () => {
  const now = Date.now();
  for (let i = 0; i < 50; i++) {
    assert.equal((await createTask(root, draft(), now)).ok, true, `task ${i}`);
  }
  const r = await createTask(root, draft(), now);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'task_limit');
  assert.equal((await createTask(root, draft({ project: 'other', cwd: '/tmp/other' }), now)).ok, true);
});

test('readScheduledTasks: missing prefs → empty; corrupt prefs → corrupt:true', async () => {
  assert.deepEqual(readScheduledTasks(root), { version: 1, tasks: [], corrupt: false, legacy: false });
  writeFileSync(prefsFilePath(root), 'not json');
  const r = readScheduledTasks(root);
  assert.equal(r.corrupt, true);
  assert.deepEqual(r.tasks, []);
});

test('readScheduledTasks: malformed scheduledTasks shape → corrupt:true, no legacy fallback', async () => {
  // Key present but invalid + a valid legacy file: must NOT fall back (tombstone semantics).
  writeFileSync(legacyTasksFilePath(root), JSON.stringify({ version: 1, tasks: [{ id: 'st_old', prompt: 'x' }] }));
  for (const bad of [null, [], {}, { version: 2, tasks: [] }, { version: 1, tasks: 'oops' }]) {
    writeFileSync(prefsFilePath(root), JSON.stringify({ scheduledTasks: bad }));
    const r = readScheduledTasks(root);
    assert.equal(r.corrupt, true, `shape ${JSON.stringify(bad)} is corrupt`);
    assert.equal(r.legacy, false);
  }
});

test('readScheduledTasks: malformed task entries are filtered out', async () => {
  writeFileSync(prefsFilePath(root), JSON.stringify({ scheduledTasks: { version: 1, tasks: [{ id: 'ok1' }, { noid: true }, null, { id: 'ok2' }] } }));
  const r = readScheduledTasks(root);
  assert.equal(r.corrupt, false);
  assert.deepEqual(r.tasks.map(t => t.id), ['ok1', 'ok2']);
});

test('legacy fallback: read-only, claim hidden, writers refuse without tombstoning', async () => {
  writeFileSync(legacyTasksFilePath(root), JSON.stringify({
    version: 1,
    tasks: [{ id: 'st_old', project: 'proj', cwd: '/tmp/proj', prompt: 'old', mode: 'inject', schedule: { kind: 'daily', time: '09:00' }, enabled: true, claim: { runId: 'run_x', at: 1, pid: 999999 }, runs: [{ id: 'run_1' }] }],
  }));
  const r = readScheduledTasks(root);
  assert.equal(r.legacy, true);
  assert.equal(r.tasks.length, 1);
  assert.equal(r.tasks[0].claim, null, 'legacy claim neutralized (no permanent "running" display)');
  assert.equal('runs' in r.tasks[0], false, 'legacy runs stripped at the read boundary');
  // Writers refuse and do NOT create the prefs key.
  assert.equal((await updateTask(root, 'st_old', { prompt: 'x' })).reason, 'task_not_found');
  assert.equal((await deleteTask(root, 'st_old')).reason, 'task_not_found');
  assert.equal((await claimTask(root, 'st_old', Date.now() + 10 * DAY)).reason, 'not-found');
  assert.deepEqual(await sweepStaleClaims(root), { swept: 0 });
  assert.equal(existsSync(prefsFilePath(root)), false, 'no tombstone written by refused writers');
  // createTask is the only writer allowed to create the key — legacy then disappears.
  assert.equal((await createTask(root, draft())).ok, true);
  const after = readScheduledTasks(root);
  assert.equal(after.legacy, false);
  assert.equal(after.tasks.length, 1);
  assert.notEqual(after.tasks[0].id, 'st_old');
});

test('writes are atomic: no .tmp- residue in either file', async () => {
  const now = Date.now();
  const { task } = await createTask(root, draft({ schedule: { kind: 'hourly', minute: 10 } }), now);
  const c = await claimTask(root, task.id, task.nextRunAt + 1000);
  await finalizeTask(root, task.id, c, { status: 'dispatched' }, now + 2000);
  const leftovers = readdirSync(root).filter(f => f.includes('.tmp-'));
  assert.deepEqual(leftovers, []);
});

test('updateTask: prompt edit does NOT reset schedule; schedule edit does', async () => {
  const now = Date.now();
  const { task } = await createTask(root, draft(), now);
  const origNext = task.nextRunAt;
  await updateTask(root, task.id, { prompt: 'edited prompt' }, now + 1000);
  let t = listTasks(root)[0];
  assert.equal(t.prompt, 'edited prompt');
  assert.equal(t.nextRunAt, origNext, 'prompt-only edit keeps nextRunAt');
  await updateTask(root, task.id, { schedule: { kind: 'hourly', minute: 5 } }, now + 2000);
  t = listTasks(root)[0];
  assert.equal(t.schedule.kind, 'hourly');
  assert.notEqual(t.nextRunAt, origNext, 'schedule edit recomputes next');
});

test('updateTask: pause then resume records skipped/paused run in the runs file', async () => {
  const now = Date.now();
  const { task } = await createTask(root, draft({ schedule: { kind: 'cron', expr: '* * * * *' } }), now);
  await updateTask(root, task.id, { enabled: false }, now);
  const later = now + 3 * MIN;
  await updateTask(root, task.id, { enabled: true }, later);
  const runs = readScheduledTaskRuns(root, task.id);
  const skipped = runs.find(r => r.status === 'skipped' && r.reason === 'paused');
  assert.ok(skipped, 'a skipped/paused run is recorded');
  assert.ok(skipped.missedCount >= 1);
  // The task itself carries no runs array.
  assert.equal('runs' in listTasks(root)[0], false);
});

test('claimTask: due recurring task is claimed, schedule advanced inside the lock', async () => {
  const now = Date.now();
  const { task } = await createTask(root, draft({ schedule: { kind: 'hourly', minute: 10 } }), now);
  const dueNow = task.nextRunAt + 1000;
  const c = await claimTask(root, task.id, dueNow);
  assert.equal(c.ok, true);
  assert.equal(c.action, 'claimed');
  assert.ok(c.runId.startsWith('run_'));
  const t = listTasks(root)[0];
  assert.ok(t.claim && t.claim.runId === c.runId);
  assert.ok(t.nextBaseAt > dueNow || t.nextBaseAt === null, 'next advanced past this fire');
});

test('claimTask: not due / disabled / missing → not claimed', async () => {
  const now = Date.now();
  const { task } = await createTask(root, draft(), now);
  assert.equal((await claimTask(root, task.id, now)).ok, false);
  await updateTask(root, task.id, { enabled: false }, now);
  assert.equal((await claimTask(root, task.id, now + 10 * DAY)).reason, 'disabled');
  assert.equal((await claimTask(root, 'st_nope', now)).reason, 'not-found');
});

test('claimTask: concurrent claims — exactly one wins (multi-process exclusion)', async () => {
  const now = Date.now();
  const { task } = await createTask(root, draft({ schedule: { kind: 'hourly', minute: 10 } }), now);
  const dueNow = task.nextRunAt + 1000;
  const results = await Promise.all([
    claimTask(root, task.id, dueNow),
    claimTask(root, task.id, dueNow),
    claimTask(root, task.id, dueNow),
  ]);
  const wins = results.filter(r => r.ok && r.action === 'claimed');
  assert.equal(wins.length, 1, `exactly one claim wins, got ${JSON.stringify(results.map(r => r.reason || r.action))}`);
});

test('claimTask: recurring catch-up fires only the most recent occurrence', async () => {
  const now = Date.now();
  const { task } = await createTask(root, draft({ schedule: { kind: 'cron', expr: '* * * * *' } }), now);
  const later = now + 30 * MIN;
  const c = await claimTask(root, task.id, later);
  assert.equal(c.ok, true);
  assert.equal(c.catchUp, true);
  assert.ok(c.missedCount >= 1, `missedCount counts the gap, got ${c.missedCount}`);
});

test('claimTask: recurring stale (>7d) is missed, not fired; run recorded in runs file', async () => {
  const now = Date.now();
  const { task } = await createTask(root, draft({ schedule: { kind: 'cron', expr: '0 0 1 1 *' } }), now);
  const later = now + 300 * DAY;
  const c = await claimTask(root, task.id, later);
  assert.equal(c.ok, true);
  assert.equal(c.action, 'missed');
  const runs = readScheduledTaskRuns(root, task.id);
  assert.ok(runs.some(r => r.status === 'missed' && r.reason === 'stale'));
});

test('claimTask: once within window claims and disarms; stale once is missed', async () => {
  const now = Date.now();
  const at = now + 5 * MIN;
  const { task } = await createTask(root, draft({ schedule: { kind: 'once', at } }), now);
  const c = await claimTask(root, task.id, at + 1000);
  assert.equal(c.ok, true);
  assert.equal(c.action, 'claimed');
  const t = listTasks(root)[0];
  assert.equal(t.nextRunAt, null, 'once disarmed at claim');
  const { task: t2 } = await createTask(root, draft({ schedule: { kind: 'once', at: now + 5 * MIN } }), now);
  const c2 = await claimTask(root, t2.id, now + 8 * DAY);
  assert.equal(c2.action, 'missed');
});

test('finalizeTask: CAS — only the matching runId clears the claim and writes history', async () => {
  const now = Date.now();
  const { task } = await createTask(root, draft({ schedule: { kind: 'hourly', minute: 10 } }), now);
  const dueNow = task.nextRunAt + 1000;
  const c = await claimTask(root, task.id, dueNow);
  // A wrong runId must NOT clear the claim and must NOT append a run.
  const bad = await finalizeTask(root, task.id, { runId: 'run_other' }, { status: 'dispatched' }, dueNow + 500);
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'claim-superseded');
  assert.ok(listTasks(root)[0].claim, 'claim still held after mismatched finalize');
  assert.equal(readScheduledTaskRuns(root, task.id).length, 0, 'no run appended for a superseded finalize');
  // The right runId finalizes.
  const good = await finalizeTask(root, task.id, c, { status: 'dispatched', durationMs: 500 }, dueNow + 500);
  assert.equal(good.ok, true);
  const t = listTasks(root)[0];
  assert.equal(t.claim, null);
  assert.equal(t.lastResult, 'dispatched');
  const runs = readScheduledTaskRuns(root, task.id);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, 'dispatched');
  assert.equal(runs[0].claimRunId, c.runId);
});

test('finalizeTask: once completedAt written on success, not at claim', async () => {
  const now = Date.now();
  const at = now + 5 * MIN;
  const { task } = await createTask(root, draft({ schedule: { kind: 'once', at } }), now);
  assert.equal(task.completedAt, null);
  const c = await claimTask(root, task.id, at + 1000);
  assert.equal(listTasks(root)[0].completedAt, null, 'not completed at claim time');
  await finalizeTask(root, task.id, c, { status: 'dispatched' }, at + 2000);
  assert.ok(listTasks(root)[0].completedAt, 'completedAt set on successful finalize');
});

test('runs are capped at 20 and summary at 200 chars', async () => {
  const now = Date.now();
  const longPrompt = 'x'.repeat(500);
  const { task } = await createTask(root, draft({ prompt: longPrompt, schedule: { kind: 'hourly', minute: 10 } }), now);
  for (let i = 0; i < 25; i++) {
    const dueNow = (listTasks(root)[0].nextRunAt || now) + 1000;
    const c = await claimTask(root, task.id, dueNow + i * 3600_000 + i * MIN);
    if (!c.ok || c.action !== 'claimed') continue;
    await finalizeTask(root, task.id, c, { status: 'dispatched' }, dueNow + i * 3600_000 + i * MIN + 100);
  }
  const runs = readScheduledTaskRuns(root, task.id);
  assert.ok(runs.length <= 20, `runs capped, got ${runs.length}`);
  assert.ok(runs.every(r => r.summary.length <= 201), 'summary truncated');
});

test('sweepStaleClaims: reclaims a dead-pid claim as interrupted', async () => {
  const now = Date.now();
  const { task } = await createTask(root, draft({ schedule: { kind: 'hourly', minute: 10 } }), now);
  const dueNow = task.nextRunAt + 1000;
  await claimTask(root, task.id, dueNow);
  // Forge a dead-pid claim directly in prefs.
  const prefs = readPrefs();
  prefs.scheduledTasks.tasks[0].claim.pid = 999999;
  prefs.scheduledTasks.tasks[0].claim.at = now - 3 * 3600 * 1000;
  writeFileSync(prefsFilePath(root), JSON.stringify(prefs));
  const r = await sweepStaleClaims(root, now + 1);
  assert.ok(r.swept >= 1);
  const t = listTasks(root)[0];
  assert.equal(t.claim, null);
  const runs = readScheduledTaskRuns(root, task.id);
  assert.ok(runs.some(r2 => r2.reason === 'interrupted'));
});

test('sweepStaleClaims: same pid but different boot generation is swept', async () => {
  const now = Date.now();
  const { task } = await createTask(root, draft({ schedule: { kind: 'hourly', minute: 10 } }), now);
  const dueNow = task.nextRunAt + 1000;
  await claimTask(root, task.id, dueNow, { instanceId: 'boot-A' });
  const r = await sweepStaleClaims(root, now + 1, { selfInstanceId: 'boot-B' });
  assert.ok(r.swept >= 1, 'a prior generation of THIS pid is reclaimed');
});

test('reclaim: once task with a recorded terminal run restores terminal state (no double-run)', async () => {
  const now = Date.now();
  const at = now + 5 * MIN;
  const { task } = await createTask(root, draft({ schedule: { kind: 'once', at } }), now);
  const c = await claimTask(root, task.id, at + 1000);
  // Simulate finalize crash: run recorded, claim never cleared (kill claim pid + age it).
  const { appendRun } = await import('../server/lib/scheduled-task-runs-store.js');
  await appendRun(root, task.id, { status: 'completed', at: c.at, finishedAt: at + 2000, claimRunId: c.runId });
  const prefs = readPrefs();
  prefs.scheduledTasks.tasks[0].claim.pid = 999999;
  prefs.scheduledTasks.tasks[0].claim.at = now - 3 * 3600 * 1000;
  writeFileSync(prefsFilePath(root), JSON.stringify(prefs));
  await sweepStaleClaims(root, now + 1);
  const t = listTasks(root)[0];
  assert.equal(t.claim, null);
  assert.equal(t.lastResult, 'completed', 'terminal state restored from runs, not marked interrupted');
  assert.ok(t.completedAt, 'completedAt restored');
  const runs = readScheduledTaskRuns(root, task.id);
  assert.equal(runs.filter(r => r.reason === 'interrupted').length, 0, 'no misleading interrupted marker');
});

test('deleteTask: refuses an actively-claimed task; deletes runs with the task', async () => {
  const now = Date.now();
  const { task } = await createTask(root, draft({ schedule: { kind: 'hourly', minute: 10 } }), now);
  const dueNow = task.nextRunAt + 1000;
  const c = await claimTask(root, task.id, dueNow);
  const d = await deleteTask(root, task.id, dueNow + 10);
  assert.equal(d.ok, false);
  assert.equal(d.reason, 'task_running');
  await finalizeTask(root, task.id, c, { status: 'dispatched' }, dueNow + 100);
  assert.equal(readScheduledTaskRuns(root, task.id).length, 1);
  assert.equal((await deleteTask(root, task.id, dueNow + 200)).ok, true);
  assert.deepEqual(readScheduledTaskRuns(root, task.id), [], 'runs deleted with the task');
});

test('updateTask: editing prompt on an EXPIRED once task succeeds (P1-3)', async () => {
  const now = Date.now();
  const at = now + 5 * MIN;
  const { task } = await createTask(root, draft({ schedule: { kind: 'once', at } }), now);
  const later = at + 10 * MIN;
  const r = await updateTask(root, task.id, { prompt: 'edited', schedule: { kind: 'once', at } }, later);
  assert.equal(r.ok, true, `prompt edit on expired once must not be rejected: ${JSON.stringify(r)}`);
  assert.equal(listTasks(root)[0].prompt, 'edited');
  const bad = await updateTask(root, task.id, { schedule: { kind: 'once', at: later - 1000 } }, later);
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'once_in_past');
});

test('jitter: every-minute cron is capped at 30s; schedule change recomputes (P1-6/P2-1)', async () => {
  const now = Date.now();
  const { task } = await createTask(root, draft({ schedule: { kind: 'daily', time: '09:00' } }), now);
  const dailyJitter = task.jitterMs;
  assert.ok(dailyJitter <= 120000);
  await updateTask(root, task.id, { schedule: { kind: 'cron', expr: '* * * * *' } }, now + 1000);
  const t = listTasks(root)[0];
  assert.ok(t.jitterMs <= 30000, `every-minute jitter must be ≤30s, got ${t.jitterMs}`);
});

test('claimTask result carries `at` so runs record start time + duration (P2-2)', async () => {
  const now = Date.now();
  const { task } = await createTask(root, draft({ schedule: { kind: 'hourly', minute: 10 } }), now);
  const dueNow = task.nextRunAt + 1000;
  const c = await claimTask(root, task.id, dueNow);
  assert.equal(c.ok, true);
  assert.equal(typeof c.at, 'number', 'claim carries at');
  await finalizeTask(root, task.id, c, { status: 'dispatched' }, dueNow + 700);
  const run = readScheduledTaskRuns(root, task.id)[0];
  assert.equal(run.at, dueNow, 'run.at = claim time');
  assert.equal(run.durationMs, 700, 'durationMs derived from claim.at');
});

test('once skipped(busy)/failed does NOT mark completedAt; it disables the task (P1-2)', async () => {
  const now = Date.now();
  const at = now + 5 * MIN;
  const { task } = await createTask(root, draft({ schedule: { kind: 'once', at } }), now);
  const c = await claimTask(root, task.id, at + 1000);
  await finalizeTask(root, task.id, c, { status: 'skipped', reason: 'busy' }, at + 2000);
  const t = listTasks(root)[0];
  assert.equal(t.completedAt, null, 'skipped is not a completion');
  assert.equal(t.enabled, false, 'a spent once task disables itself');
});

test('mutateScheduledTasks preserves unrelated prefs keys (themeColor/auth/forks)', async () => {
  writeFileSync(prefsFilePath(root), JSON.stringify({ themeColor: 'dark', auth: { enabled: true }, prefsByProject: { '/x': {} } }));
  const r = await createTask(root, draft(), Date.now());
  assert.equal(r.ok, true);
  const prefs = readPrefs();
  assert.equal(prefs.themeColor, 'dark');
  assert.deepEqual(prefs.auth, { enabled: true });
  assert.deepEqual(prefs.prefsByProject, { '/x': {} });
  assert.ok(Array.isArray(prefs.scheduledTasks.tasks));
});

test('corrupt prefs → strict writers refuse, file bytes preserved', async () => {
  writeFileSync(prefsFilePath(root), 'not json');
  await assert.rejects(createTask(root, draft(), Date.now()), /corrupt/i);
  assert.equal(readFileSync(prefsFilePath(root), 'utf-8'), 'not json', 'corrupt bytes preserved');
});

test('malformed scheduledTasks shape → writes refuse (no silent reset)', async () => {
  writeFileSync(prefsFilePath(root), JSON.stringify({ scheduledTasks: { version: 1, tasks: 'oops' } }));
  await assert.rejects(createTask(root, draft(), Date.now()), /malformed|corrupt/i);
  const prefs = readPrefs();
  assert.equal(prefs.scheduledTasks.tasks, 'oops', 'malformed state untouched');
});

test('runs file is not created until a run actually happens', async () => {
  await createTask(root, draft(), Date.now());
  assert.equal(existsSync(runsFilePath(root)), false, 'no runs file on bare create');
});

test('finalizeTask: runs append failure keeps the claim (runs_unavailable), no state write', async () => {
  const now = Date.now();
  const { task } = await createTask(root, draft({ schedule: { kind: 'hourly', minute: 10 } }), now);
  const c = await claimTask(root, task.id, task.nextRunAt + 1000);
  // Make the runs path unwritable (a directory where the file should be).
  const { mkdirSync, rmSync } = await import('node:fs');
  rmSync(runsFilePath(root), { force: true });
  mkdirSync(runsFilePath(root));
  const r = await finalizeTask(root, task.id, c, { status: 'dispatched' }, now + 2000);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'runs_unavailable', 'claim must NOT be released when the run cannot be recorded');
  const t = listTasks(root)[0];
  assert.ok(t.claim, 'claim still held');
  assert.equal(t.lastResult, null, 'no terminal state written');
  rmSync(runsFilePath(root), { recursive: true, force: true });
});
