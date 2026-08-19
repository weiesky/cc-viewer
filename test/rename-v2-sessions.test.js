/**
 * Task C — rename-v2-sessions script pure helpers + planning
 * (scripts/rename-v2-sessions-with-ts.js).
 *
 * Only the pure/planning surface is unit-tested (the side-effecting main() runs
 * against the real LOG_DIR and is exercised manually in dry-run). Fixtures use
 * mkdtemp — never a real CCV_LOG_DIR.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isAlreadyMigrated, resolveStartTs, isLiveSession, planRenames } from '../scripts/rename-v2-sessions-with-ts.js';
import { compactLocalTs14 } from '../packages/app/server/lib/v2/layout.js';

let root;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ccv-rename-')); });
afterEach(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });

/** Build a session dir under root/<project>/sessions/<name>. */
function seed(project, name, { startTs = '2026-07-14T09:08:07.000Z', pid, reqTs, journal = true, journalMtime } = {}) {
  const dir = join(root, project, 'sessions', name);
  mkdirSync(dir, { recursive: true });
  const meta = { wireFormat: 2, sessionId: name.replace(/^\d{14}_/, ''), project, startTs };
  if (pid != null) meta.pid = pid;
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta));
  if (journal) {
    const lines = [JSON.stringify({ ph: 'meta', wireFormat: 2 })];
    if (reqTs) lines.push(JSON.stringify({ ph: 'req', seq: 1, kind: 'main', ts: reqTs }));
    writeFileSync(join(dir, 'journal.jsonl'), lines.join('\n') + '\n');
    if (journalMtime != null) utimesSync(join(dir, 'journal.jsonl'), journalMtime / 1000, journalMtime / 1000);
  }
  return dir;
}

const UUID = 'c1234567-89ab-4cde-8f01-23456789abcd';
const DEAD_PID = 2 ** 30; // reliably not a running pid
const frozenNow = () => Date.parse('2027-01-01T00:00:00.000Z'); // far future → nothing is "recently active"

describe('isAlreadyMigrated', () => {
  it('true for <14digits>_..., false for a bare UUID (dash at index 8)', () => {
    assert.equal(isAlreadyMigrated(`20260714090807_${UUID}`), true);
    assert.equal(isAlreadyMigrated(UUID), false);
    assert.equal(isAlreadyMigrated('20260714_090807'), false, '13 digits then _ is not 14');
    assert.equal(isAlreadyMigrated(`20260714090807_noid-1-2`), true);
  });
});

describe('resolveStartTs', () => {
  it('prefers meta.startTs', () => {
    const dir = seed('p', UUID, { startTs: '2026-05-01T10:00:00.000Z' });
    assert.equal(resolveStartTs(dir), '2026-05-01T10:00:00.000Z');
  });
  it('falls back to the first journal req ts when meta.startTs is absent', () => {
    const dir = seed('p', UUID, { startTs: '', reqTs: '2026-06-02T11:00:00.000Z' });
    assert.equal(resolveStartTs(dir), '2026-06-02T11:00:00.000Z');
  });
  it('falls back to dir mtime (always present) as the floor', () => {
    const dir = seed('p', UUID, { startTs: '', journal: false });
    const ts = resolveStartTs(dir);
    assert.ok(ts && !isNaN(Date.parse(ts)), 'a valid ISO from mtime');
  });
});

describe('isLiveSession', () => {
  it('live when meta.pid is the running process', () => {
    const dir = seed('p', UUID, { pid: process.pid });
    assert.equal(isLiveSession(dir, { now: frozenNow }), true);
  });
  it('not live for a dead pid + old journal', () => {
    const dir = seed('p', UUID, { pid: DEAD_PID, journalMtime: Date.parse('2026-01-01T00:00:00.000Z') });
    assert.equal(isLiveSession(dir, { now: frozenNow }), false);
  });
  it('live when the journal was touched within the threshold', () => {
    const dir = seed('p', UUID, { pid: DEAD_PID });
    // now == just after the journal write → within 5min window
    assert.equal(isLiveSession(dir, { now: () => Date.now() }), true);
  });
  it('EPERM from kill counts as live (cross-user)', () => {
    const dir = seed('p', UUID, { pid: 12345, journalMtime: Date.parse('2026-01-01T00:00:00.000Z') });
    const processKill = () => { const e = new Error('EPERM'); e.code = 'EPERM'; throw e; };
    assert.equal(isLiveSession(dir, { now: frozenNow, processKill }), true);
  });
});

describe('planRenames', () => {
  // Injected kill: process.pid is "alive" (live ccv), every other pid is dead.
  const opts = { now: frozenNow, processKill: (pid) => { if (pid !== process.pid) throw Object.assign(new Error(), { code: 'ESRCH' }); } };

  it('plans <ts>_<uuid> for a fresh bare session', () => {
    seed('proj', UUID, { startTs: '2026-07-14T09:08:07.000Z', pid: DEAD_PID });
    const { renames, skipped } = planRenames(root, opts);
    assert.equal(renames.length, 1);
    assert.equal(skipped.length, 0);
    assert.match(renames[0].to, /^\d{14}_c1234567-/);
    assert.ok(renames[0].to.endsWith(`_${UUID}`));
  });

  it('skips already-migrated (idempotent), live, and target-exists', () => {
    seed('proj', `20260714090807_${UUID}`, { pid: DEAD_PID });          // already migrated
    seed('proj', 'a0000000-0000-4000-8000-000000000001', { pid: process.pid }); // live (this pid)
    // bare + its target already present → target-exists skip. Compute the
    // target with the same local-time helper so the test is timezone-robust.
    const bareB = 'b0000000-0000-4000-8000-000000000002';
    const startB = '2026-07-14T09:08:07.000Z';
    seed('proj', bareB, { startTs: startB, pid: DEAD_PID });
    mkdirSync(join(root, 'proj', 'sessions', `${compactLocalTs14(startB)}_${bareB}`), { recursive: true });

    const { renames, skipped } = planRenames(root, opts);
    assert.equal(renames.length, 0, 'nothing renamed — all cases are skips');
    // (the pre-created target dir is itself scanned as an extra already-migrated;
    //  assert the distinct set of reasons.)
    const reasons = [...new Set(skipped.map((s) => s.reason))].sort();
    assert.deepEqual(reasons, ['already-migrated', 'live', 'target-exists']);
  });

  it('spans multiple projects and ignores non-project dirs', () => {
    seed('projA', UUID, { pid: DEAD_PID });
    seed('projB', 'a0000000-0000-4000-8000-000000000003', { pid: DEAD_PID });
    mkdirSync(join(root, 'not-a-project'), { recursive: true }); // no sessions/ → ignored
    writeFileSync(join(root, 'profile.json'), '{}'); // stray file → ignored
    const { renames } = planRenames(root, opts);
    assert.equal(renames.length, 2);
    assert.deepEqual([...new Set(renames.map((r) => r.project))].sort(), ['projA', 'projB']);
  });
});
