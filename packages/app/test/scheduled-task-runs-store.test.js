// Tests for packages/app/server/lib/scheduled-task-runs-store.js — per-task cap,
// id/claimRunId idempotency, self-heal on corrupt, delete, concurrency, no tmp residue.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runsFilePath, readScheduledTaskRuns, appendRun, appendRuns, deleteRunsForTask,
  findRunByClaimId, MAX_RUNS,
} from '../server/lib/scheduled-task-runs-store.js';

let root;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ccv-str-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

test('appendRun creates the file at 0600 and reads back oldest→newest', async () => {
  await appendRun(root, 'st_a', { status: 'completed', at: 1, finishedAt: 2, claimRunId: 'run_1' });
  await appendRun(root, 'st_a', { status: 'error', at: 3, finishedAt: 4, claimRunId: 'run_2' });
  const runs = readScheduledTaskRuns(root, 'st_a');
  assert.equal(runs.length, 2);
  assert.equal(runs[0].claimRunId, 'run_1');
  assert.equal(runs[1].status, 'error');
  assert.ok(runs[0].id.startsWith('run_'));
  assert.equal((statSync(runsFilePath(root)).mode & 0o777), 0o600);
});

test('per-task isolation + cap at MAX_RUNS (oldest evicted)', async () => {
  await appendRuns(root, [
    ...Array.from({ length: MAX_RUNS + 5 }, (_, i) => ({ taskId: 'st_a', run: { status: 'completed', at: i, finishedAt: i } })),
    { taskId: 'st_b', run: { status: 'missed', at: 0, finishedAt: 0 } },
  ]);
  const a = readScheduledTaskRuns(root, 'st_a');
  const b = readScheduledTaskRuns(root, 'st_b');
  assert.equal(a.length, MAX_RUNS);
  assert.equal(a[0].at, 5); // first 5 evicted
  assert.equal(b.length, 1);
});

test('idempotency: same run id or same claimRunId is not appended twice', async () => {
  await appendRun(root, 'st_a', { id: 'run_x', status: 'completed', at: 1, finishedAt: 2, claimRunId: 'run_c1' });
  await appendRun(root, 'st_a', { id: 'run_x', status: 'completed', at: 1, finishedAt: 2, claimRunId: 'run_c1' });
  // A retry of the same claim with a NEW run id must also be skipped (claimRunId dedupe).
  await appendRun(root, 'st_a', { status: 'interrupted', at: 2, finishedAt: 3, claimRunId: 'run_c1' });
  const runs = readScheduledTaskRuns(root, 'st_a');
  assert.equal(runs.length, 1);
});

test('findRunByClaimId returns only terminal runs', async () => {
  await appendRun(root, 'st_a', { status: 'completed', at: 1, finishedAt: 2, claimRunId: 'run_c1' });
  assert.equal(findRunByClaimId(root, 'st_a', 'run_c1').status, 'completed');
  assert.equal(findRunByClaimId(root, 'st_a', 'run_missing'), null);
  assert.equal(findRunByClaimId(root, 'st_a', ''), null);
});

test('corrupt file self-heals on next append and old data is discarded', async () => {
  writeFileSync(runsFilePath(root), 'not json');
  await appendRun(root, 'st_a', { status: 'completed', at: 1, finishedAt: 2 });
  const runs = readScheduledTaskRuns(root, 'st_a');
  assert.equal(runs.length, 1);
});

test('deleteRunsForTask removes only that task', async () => {
  await appendRuns(root, [
    { taskId: 'st_a', run: { status: 'completed', at: 1, finishedAt: 1 } },
    { taskId: 'st_b', run: { status: 'completed', at: 2, finishedAt: 2 } },
  ]);
  await deleteRunsForTask(root, 'st_a');
  assert.deepEqual(readScheduledTaskRuns(root, 'st_a'), []);
  assert.equal(readScheduledTaskRuns(root, 'st_b').length, 1);
});

test('concurrent appends serialize without lost updates', async () => {
  await Promise.all(Array.from({ length: 10 }, (_, i) =>
    appendRun(root, 'st_a', { status: 'completed', at: i, finishedAt: i })));
  assert.equal(readScheduledTaskRuns(root, 'st_a').length, 10);
});

test('no .tmp- residue left behind', async () => {
  await appendRun(root, 'st_a', { status: 'completed', at: 1, finishedAt: 1 });
  const strays = readdirSync(root).filter(f => f.includes('.tmp-'));
  assert.deepEqual(strays, []);
});

test('readScheduledTaskRuns never throws on missing file/unknown task', () => {
  assert.deepEqual(readScheduledTaskRuns(root, 'st_nope'), []);
});
