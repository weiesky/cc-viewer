// Tests for packages/app/server/lib/scheduled-task-store.js — locked CRUD, atomic
// claim (multi-process mutual exclusion), finalize CAS, catch-up/missed, stale sweep.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  tasksFilePath, readScheduledTasks, createTask, updateTask, deleteTask,
  claimTask, finalizeTask, sweepStaleClaims, listTasks,
} from '../server/lib/scheduled-task-store.js';

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

test('createTask: validates prompt/mode/schedule, computes nextRunAt', async () => {
  const now = Date.now();
  const r = await createTask(root, draft(), now);
  assert.equal(r.ok, true);
  assert.ok(r.task.id.startsWith('st_'));
  assert.ok(r.task.nextRunAt > now);
  assert.equal(r.task.claim, null);
  assert.deepEqual(r.task.runs, []);
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
  // A different project is unaffected.
  assert.equal((await createTask(root, draft({ project: 'other', cwd: '/tmp/other' }), now)).ok, true);
});

test('readScheduledTasks: missing/corrupt → empty, malformed entries dropped', async () => {
  assert.deepEqual(readScheduledTasks(root).tasks, []);
  writeFileSync(tasksFilePath(root), 'not json');
  assert.deepEqual(readScheduledTasks(root).tasks, []);
  writeFileSync(tasksFilePath(root), JSON.stringify({ version: 1, tasks: [{ id: 'ok1' }, { noid: true }, null, { id: 'ok2' }] }));
  assert.deepEqual(readScheduledTasks(root).tasks.map(t => t.id), ['ok1', 'ok2']);
});

test('writes are atomic: no .tmp- residue', async () => {
  await createTask(root, draft(), Date.now());
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

test('updateTask: pause then resume records skipped/paused and does not back-fill', async () => {
  const now = Date.now();
  const { task } = await createTask(root, draft({ schedule: { kind: 'cron', expr: '* * * * *' } }), now);
  await updateTask(root, task.id, { enabled: false }, now);
  let t = listTasks(root)[0];
  assert.equal(t.enabled, false);
  // 3 minutes pass while paused.
  const later = now + 3 * MIN;
  await updateTask(root, task.id, { enabled: true }, later);
  t = listTasks(root)[0];
  assert.equal(t.enabled, true);
  const skipped = t.runs.find(r => r.status === 'skipped' && r.reason === 'paused');
  assert.ok(skipped, 'a skipped/paused run is recorded');
  assert.ok(skipped.missedCount >= 1);
});

test('claimTask: due recurring task is claimed, schedule advanced inside the lock', async () => {
  // hourly at minute 10. Create "just before" so nextRunAt is the next :10.
  const now = Date.now();
  const { task } = await createTask(root, draft({ schedule: { kind: 'hourly', minute: 10 } }), now);
  // Move "now" past nextRunAt.
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
  assert.equal((await claimTask(root, task.id, now)).ok, false); // not due yet
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
  // 30 minutes pass (30 missed fires).
  const later = now + 30 * MIN;
  const c = await claimTask(root, task.id, later);
  assert.equal(c.ok, true);
  assert.equal(c.catchUp, true);
  assert.ok(c.missedCount >= 1, `missedCount counts the gap, got ${c.missedCount}`);
});

test('claimTask: recurring stale (>7d) is missed, not fired', async () => {
  const now = Date.now();
  const { task } = await createTask(root, draft({ schedule: { kind: 'cron', expr: '0 0 1 1 *' } }), now);
  const later = now + 300 * DAY; // Jan 1 fire is ~10 months stale by October
  const c = await claimTask(root, task.id, later);
  assert.equal(c.ok, true);
  assert.equal(c.action, 'missed');
  const t = listTasks(root)[0];
  assert.ok(t.runs.some(r => r.status === 'missed' && r.reason === 'stale'));
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
  // stale once
  const { task: t2 } = await createTask(root, draft({ schedule: { kind: 'once', at: now + 5 * MIN } }), now);
  const c2 = await claimTask(root, t2.id, now + 8 * DAY);
  assert.equal(c2.action, 'missed');
});

test('finalizeTask: CAS — only the matching runId clears the claim and writes history', async () => {
  const now = Date.now();
  const { task } = await createTask(root, draft({ schedule: { kind: 'hourly', minute: 10 } }), now);
  const dueNow = task.nextRunAt + 1000;
  const c = await claimTask(root, task.id, dueNow);
  // A wrong runId must NOT clear the claim.
  const bad = await finalizeTask(root, task.id, { runId: 'run_other' }, { status: 'dispatched' }, dueNow + 500);
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'claim-superseded');
  assert.ok(listTasks(root)[0].claim, 'claim still held after mismatched finalize');
  // The right runId finalizes.
  const good = await finalizeTask(root, task.id, c, { status: 'dispatched', durationMs: 500 }, dueNow + 500);
  assert.equal(good.ok, true);
  const t = listTasks(root)[0];
  assert.equal(t.claim, null);
  assert.equal(t.lastResult, 'dispatched');
  assert.equal(t.runs.length, 1);
  assert.equal(t.runs[0].status, 'dispatched');
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
  const t = listTasks(root)[0];
  assert.ok(t.runs.length <= 20, `runs capped, got ${t.runs.length}`);
  assert.ok(t.runs.every(r => r.summary.length <= 201), 'summary truncated');
});

test('sweepStaleClaims: reclaims a dead-pid claim as interrupted', async () => {
  const now = Date.now();
  const { task } = await createTask(root, draft({ schedule: { kind: 'hourly', minute: 10 } }), now);
  const dueNow = task.nextRunAt + 1000;
  await claimTask(root, task.id, dueNow);
  // Forge a dead-pid claim.
  const file = tasksFilePath(root);
  const data = JSON.parse(readFileSync(file, 'utf-8'));
  data.tasks[0].claim.pid = 999999; // almost certainly dead
  data.tasks[0].claim.at = now - 3 * 3600 * 1000; // 3h ago
  writeFileSync(file, JSON.stringify(data));
  const r = await sweepStaleClaims(root, now + 1);
  assert.ok(r.swept >= 1);
  const t = listTasks(root)[0];
  assert.equal(t.claim, null);
  assert.ok(t.runs.some(r2 => r2.reason === 'interrupted'));
});

test('sweepStaleClaims: same pid but different boot generation is swept', async () => {
  const now = Date.now();
  const { task } = await createTask(root, draft({ schedule: { kind: 'hourly', minute: 10 } }), now);
  const dueNow = task.nextRunAt + 1000;
  await claimTask(root, task.id, dueNow, { instanceId: 'boot-A' });
  const r = await sweepStaleClaims(root, now + 1, { selfInstanceId: 'boot-B' });
  assert.ok(r.swept >= 1, 'a prior generation of THIS pid is reclaimed');
});

test('deleteTask: refuses to delete an actively-claimed task', async () => {
  const now = Date.now();
  const { task } = await createTask(root, draft({ schedule: { kind: 'hourly', minute: 10 } }), now);
  const dueNow = task.nextRunAt + 1000;
  await claimTask(root, task.id, dueNow);
  const d = await deleteTask(root, task.id, dueNow + 10);
  assert.equal(d.ok, false);
  assert.equal(d.reason, 'task_running');
  // Unclaimed deletes fine.
  const { task: t2 } = await createTask(root, draft(), now);
  assert.equal((await deleteTask(root, t2.id, now)).ok, true);
});

// ── UltraReview regression coverage ─────────────────────────────────────────

test('updateTask: editing prompt on an EXPIRED once task succeeds (P1-3)', async () => {
  const now = Date.now();
  const at = now + 5 * MIN;
  const { task } = await createTask(root, draft({ schedule: { kind: 'once', at } }), now);
  // Time passes past `at`; the UI sends the full (unchanged) schedule back on save.
  const later = at + 10 * MIN;
  const r = await updateTask(root, task.id, { prompt: 'edited', schedule: { kind: 'once', at } }, later);
  assert.equal(r.ok, true, `prompt edit on expired once must not be rejected: ${JSON.stringify(r)}`);
  assert.equal(listTasks(root)[0].prompt, 'edited');
  // But changing `at` to a past time IS still rejected.
  const bad = await updateTask(root, task.id, { schedule: { kind: 'once', at: later - 1000 } }, later);
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'once_in_past');
});

test('jitter: every-minute cron is capped at 30s; schedule change recomputes (P1-6/P2-1)', async () => {
  const now = Date.now();
  const { task } = await createTask(root, draft({ schedule: { kind: 'daily', time: '09:00' } }), now);
  const dailyJitter = task.jitterMs;
  assert.ok(dailyJitter <= 120000);
  // Change to every-minute: jitter must drop to ≤30s.
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
  const run = listTasks(root)[0].runs[0];
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

