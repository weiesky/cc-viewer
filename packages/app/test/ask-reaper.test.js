// Unit tests for server/lib/ask/ask-reaper.js — the waiter-liveness reaper that resolves
// short-poll AskUserQuestion entries whose hook process (ask-bridge) died without
// notifying the server (e.g. the ask was declined at the CLI → SIGTERM).
//
// The module is fully deps-injected and imports only the pure ask-constants module,
// so no LOG_DIR isolation is required: markCancelled/loadAskStore are stubbed.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reapDeadAskWaiters, sweepOrphanedDiskAsks } from '../server/lib/ask/ask-reaper.js';

const LIVENESS = 90_000;
const INTERVAL = 30_000;
const T0 = 1_000_000_000; // deterministic base "now"

function makeDeps(over = {}) {
  const cancelled = [];
  const broadcasts = [];
  const notifiedPoll = [];
  const parentMsgs = [];
  return {
    _cancelled: cancelled, _broadcasts: broadcasts, _notifiedPoll: notifiedPoll, _parentMsgs: parentMsgs,
    pendingAskHooks: new Map(),
    shortPollListeners: new Map(),
    askWaiterLastPoll: new Map(),
    markCancelled: async (id, reason) => { cancelled.push({ id, reason }); return true; },
    loadAskStore: () => ({}),
    notifyShortPollCancel: (id, reason) => notifiedPoll.push({ id, reason }),
    broadcastCancelled: (id, reason) => broadcasts.push({ id, reason }),
    notifyParentPending: (msg) => parentMsgs.push(msg),
    livenessMs: LIVENESS,
    reapIntervalMs: INTERVAL,
    ...over,
  };
}

function shortPollEntry(over = {}) {
  return { questions: [{ question: 'q' }], res: null, timer: null, createdAt: T0 - LIVENESS - 1, shortPoll: true, ...over };
}

describe('reapDeadAskWaiters', () => {
  it('spares an entry with a fresh poll timestamp', async () => {
    const deps = makeDeps();
    deps.pendingAskHooks.set('a1', shortPollEntry());
    deps.askWaiterLastPoll.set('a1', T0 - 1000);
    const out = await reapDeadAskWaiters(deps, { lastSweepAt: T0 - INTERVAL }, { now: T0 });
    assert.deepEqual(out.reaped, []);
    assert.ok(deps.pendingAskHooks.has('a1'));
    assert.equal(deps._cancelled.length, 0);
  });

  it('reaps a stale entry: cancels on disk, cleans memory, broadcasts, clears liveness', async () => {
    const deps = makeDeps({ loadAskStore: () => ({ a1: { id: 'a1', status: 'pending' } }) });
    const timer = setTimeout(() => { throw new Error('24h timer must be cleared by the reaper'); }, 50);
    deps.pendingAskHooks.set('a1', shortPollEntry({ timer }));
    deps.askWaiterLastPoll.set('a1', T0 - LIVENESS - 1);
    const out = await reapDeadAskWaiters(deps, { lastSweepAt: T0 - INTERVAL }, { now: T0 });
    await new Promise((r) => setTimeout(r, 80)); // would throw above if timer survived
    assert.deepEqual(out.reaped, ['a1']);
    assert.equal(deps.pendingAskHooks.has('a1'), false);
    assert.equal(deps.askWaiterLastPoll.has('a1'), false);
    assert.deepEqual(deps._cancelled, [{ id: 'a1', reason: 'hook waiter lost' }]);
    assert.deepEqual(deps._broadcasts, [{ id: 'a1', reason: 'hook waiter lost' }]);
    assert.deepEqual(deps._notifiedPoll, [{ id: 'a1', reason: 'hook waiter lost' }]);
    assert.deepEqual(deps._parentMsgs, [{ type: 'ask-hook-cancelled', id: 'a1' }]);
  });

  it('spares a stale-timestamped entry with a live unfinished shortPoll listener and refreshes it', async () => {
    const deps = makeDeps();
    deps.pendingAskHooks.set('a1', shortPollEntry());
    deps.askWaiterLastPoll.set('a1', T0 - LIVENESS - 1);
    deps.shortPollListeners.set('a1', new Set([{ finished: false }]));
    const out = await reapDeadAskWaiters(deps, { lastSweepAt: T0 - INTERVAL }, { now: T0 });
    assert.deepEqual(out.reaped, []);
    assert.equal(deps.askWaiterLastPoll.get('a1'), T0);
  });

  it('a finished listener does not count as liveness', async () => {
    const deps = makeDeps({ loadAskStore: () => ({ a1: { id: 'a1', status: 'pending' } }) });
    deps.pendingAskHooks.set('a1', shortPollEntry());
    deps.askWaiterLastPoll.set('a1', T0 - LIVENESS - 1);
    deps.shortPollListeners.set('a1', new Set([{ finished: true }]));
    const out = await reapDeadAskWaiters(deps, { lastSweepAt: T0 - INTERVAL }, { now: T0 });
    assert.deepEqual(out.reaped, ['a1']);
  });

  it('spares an entry whose POST socket is still open (plugin onAskRequest window)', async () => {
    const deps = makeDeps();
    deps.pendingAskHooks.set('a1', shortPollEntry({ res: { writableEnded: false, destroyed: false } }));
    // no liveness record at all — simulates the pre-ack placeholder phase
    const out = await reapDeadAskWaiters(deps, { lastSweepAt: T0 - INTERVAL }, { now: T0 });
    assert.deepEqual(out.reaped, []);
    assert.equal(deps.askWaiterLastPoll.get('a1'), T0);
  });

  it('never reaps long-poll entries regardless of staleness', async () => {
    const deps = makeDeps();
    deps.pendingAskHooks.set('lp', { questions: [{}], res: { writableEnded: true, destroyed: true }, timer: null, createdAt: 0, shortPoll: false });
    const out = await reapDeadAskWaiters(deps, { lastSweepAt: T0 - INTERVAL }, { now: T0 });
    assert.deepEqual(out.reaped, []);
    assert.ok(deps.pendingAskHooks.has('lp'));
  });

  it('disk row absent → cleans memory only, no cancel write, no broadcast', async () => {
    const deps = makeDeps({ loadAskStore: () => ({}) });
    deps.pendingAskHooks.set('a1', shortPollEntry());
    deps.askWaiterLastPoll.set('a1', T0 - LIVENESS - 1);
    const out = await reapDeadAskWaiters(deps, { lastSweepAt: T0 - INTERVAL }, { now: T0 });
    assert.deepEqual(out.reaped, ['a1']);
    assert.equal(deps.pendingAskHooks.has('a1'), false);
    assert.equal(deps._cancelled.length, 0);
    assert.equal(deps._broadcasts.length, 0);
  });

  it('markCancelled losing the race (returns false) → no broadcast/notify', async () => {
    const deps = makeDeps({
      loadAskStore: () => ({ a1: { id: 'a1', status: 'pending' } }),
      markCancelled: async () => false,
    });
    deps.pendingAskHooks.set('a1', shortPollEntry());
    deps.askWaiterLastPoll.set('a1', T0 - LIVENESS - 1);
    await reapDeadAskWaiters(deps, { lastSweepAt: T0 - INTERVAL }, { now: T0 });
    assert.equal(deps._broadcasts.length, 0);
    assert.equal(deps._notifiedPoll.length, 0);
    assert.equal(deps._parentMsgs.length, 0);
  });

  it('wake guard: a sweep gap > 3x interval re-baselines instead of reaping', async () => {
    const deps = makeDeps();
    deps.pendingAskHooks.set('a1', shortPollEntry());
    deps.askWaiterLastPoll.set('a1', T0 - 10 * LIVENESS);
    const state = { lastSweepAt: T0 - 4 * INTERVAL };
    const out = await reapDeadAskWaiters(deps, state, { now: T0 });
    assert.equal(out.rebaselined, true);
    assert.deepEqual(out.reaped, []);
    assert.equal(deps.askWaiterLastPoll.get('a1'), T0); // baseline actually written
    assert.equal(state.lastSweepAt, T0);
    // next sweep (normal gap) now sees a fresh timestamp → still spared
    const out2 = await reapDeadAskWaiters(deps, state, { now: T0 + INTERVAL });
    assert.deepEqual(out2.reaped, []);
  });

  it('falls back to entry.createdAt when no liveness record exists', async () => {
    const deps = makeDeps({ loadAskStore: () => ({ a1: { id: 'a1', status: 'pending' } }) });
    deps.pendingAskHooks.set('a1', shortPollEntry({ createdAt: T0 - LIVENESS - 5 }));
    const out = await reapDeadAskWaiters(deps, { lastSweepAt: T0 - INTERVAL }, { now: T0 });
    assert.deepEqual(out.reaped, ['a1']);
    const deps2 = makeDeps();
    deps2.pendingAskHooks.set('a2', shortPollEntry({ createdAt: T0 - 10 }));
    const out2 = await reapDeadAskWaiters(deps2, { lastSweepAt: T0 - INTERVAL }, { now: T0 });
    assert.deepEqual(out2.reaped, []);
  });

  it('GCs liveness records for ids no longer pending', async () => {
    const deps = makeDeps();
    deps.askWaiterLastPoll.set('gone', T0);
    await reapDeadAskWaiters(deps, { lastSweepAt: T0 - INTERVAL }, { now: T0 });
    assert.equal(deps.askWaiterLastPoll.has('gone'), false);
  });
});

describe('sweepOrphanedDiskAsks', () => {
  const BOOT = T0 - 1000;
  function sweepDeps(over = {}) {
    return makeDeps({
      bootTime: BOOT,
      ownPid: 111,
      portRange: [7008, 7049],
      lsofImpl: () => 'p111\n', // only ourselves listening
      platform: 'darwin',
      loadAskStore: () => ({
        old: { id: 'old', status: 'pending', questions: [{ question: 'q' }], createdAt: BOOT - 60_000 },
        fresh: { id: 'fresh', status: 'pending', questions: [{ question: 'q' }], createdAt: BOOT + 500 },
        done: { id: 'done', status: 'answered', questions: [{ question: 'q' }], createdAt: BOOT - 60_000 },
        empty: { id: 'empty', status: 'pending', questions: [], createdAt: BOOT - 60_000 },
      }),
      ...over,
    });
  }

  it('cancels pre-boot pending disk orphans when this is the only instance', async () => {
    const deps = sweepDeps();
    const out = await sweepOrphanedDiskAsks(deps, { now: T0 });
    assert.equal(out.skipped, false);
    assert.deepEqual(out.swept, ['old']);
    assert.deepEqual(deps._cancelled, [{ id: 'old', reason: 'orphaned pending ask (owner instance gone)' }]);
    assert.equal(deps._broadcasts.length, 1);
  });

  it('skips entirely when another cc-viewer pid is listening', async () => {
    const deps = sweepDeps({ lsofImpl: () => 'p111\np222\n' });
    const out = await sweepOrphanedDiskAsks(deps, { now: T0 });
    assert.equal(out.skipped, true);
    assert.equal(deps._cancelled.length, 0);
  });

  it('skips when lsof throws, on win32, and when no lsofImpl is provided', async () => {
    const throwing = sweepDeps({ lsofImpl: () => { throw new Error('no lsof'); } });
    assert.equal((await sweepOrphanedDiskAsks(throwing, { now: T0 })).skipped, true);
    const win = sweepDeps({ platform: 'win32' });
    assert.equal((await sweepOrphanedDiskAsks(win, { now: T0 })).skipped, true);
    const noImpl = sweepDeps({ lsofImpl: undefined });
    assert.equal((await sweepOrphanedDiskAsks(noImpl, { now: T0 })).skipped, true);
  });

  it('never touches entries owned by this instance (present in memory)', async () => {
    const deps = sweepDeps();
    deps.pendingAskHooks.set('old', shortPollEntry());
    const out = await sweepOrphanedDiskAsks(deps, { now: T0 });
    assert.deepEqual(out.swept, []);
  });

  it('ignores malformed lsof lines (strict ^p\\d+$ parse)', async () => {
    const deps = sweepDeps({ lsofImpl: () => 'p111\nf12\ncwd\np\np-1\np0abc\n' });
    const out = await sweepOrphanedDiskAsks(deps, { now: T0 });
    assert.equal(out.skipped, false); // no OTHER valid pid found
    assert.deepEqual(out.swept, ['old']);
  });

  it('supports an async lsofImpl (production uses async exec) incl. rejection → skip', async () => {
    const deps = sweepDeps({ lsofImpl: async () => 'p111\n' });
    const out = await sweepOrphanedDiskAsks(deps, { now: T0 });
    assert.deepEqual(out.swept, ['old']);
    const rejecting = sweepDeps({ lsofImpl: async () => { throw new Error('lsof timed out'); } });
    assert.equal((await sweepOrphanedDiskAsks(rejecting, { now: T0 })).skipped, true);
  });
});

// Source invariants for the server.js glue that cannot be exercised without booting
// the full server (same style as test/pending-asks-filter.test.js): the custom-port
// gate must keep wrapping the boot-sweep arm, and the stop path must dispose both
// reaper timers (this repo has had leak-on-restart interval bugs before).
describe('server.js reaper wiring (source invariants)', () => {
  const src = readFileSync(new URL('../server/server.js', import.meta.url), 'utf-8');

  it('boot sweep is gated on custom CCV_START_PORT/CCV_MAX_PORT being absent', () => {
    assert.match(src, /const _customPortRange = !!\(process\.env\.CCV_START_PORT \|\| process\.env\.CCV_MAX_PORT\);/);
    assert.match(src, /if \(!_customPortRange\) \{\s*\n\s*_askOrphanSweepTimer = setTimeout\(/);
  });

  it('stop path clears both reaper timers', () => {
    assert.match(src, /clearInterval\(_askReaperTimer\);\s*\n\s*_askReaperTimer = null;/);
    assert.match(src, /clearTimeout\(_askOrphanSweepTimer\);\s*\n\s*_askOrphanSweepTimer = null;/);
  });

  it('reaper interval and sweep timeout are unref\'d (must not hold the process open)', () => {
    assert.match(src, /_askReaperTimer\.unref\(\);/);
    assert.match(src, /_askOrphanSweepTimer\.unref\(\);/);
  });
});
