/**
 * sdkTaskTracker-persist.test.js — browser-refresh persistence for the SDK
 * active-agents panel.
 *
 * Covers the restore/persist interplay between sdkTaskTracker and taskStore's
 * localStorage checkpointing, specifically the "double refresh" regression:
 * a refresh seeds the panel from localStorage, then the server's authoritative
 * (already-drained) empty snapshot must NOT wipe the panel AND must NOT echo an
 * empty write that destroys the checkpoint the NEXT refresh needs.
 *
 * localStorage is mocked in-process (node:test, no jsdom). The tracker's persist
 * is debounced 500ms; tests flush it via the exported-for-tests helpers or by
 * waiting past the debounce window.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── In-memory localStorage mock ─────────────────────────────────────────────
class MockStorage {
  constructor() { this._m = new Map(); }
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }
  setItem(k, v) { this._m.set(String(k), String(v)); }
  removeItem(k) { this._m.delete(k); }
  clear() { this._m.clear(); }
  get size() { return this._m.size; }
}

let origLocalStorage;
let tracker;
let store;

// Flush the tracker's 500ms debounced persist by waiting past the window.
function flushPersist() {
  return new Promise((resolve) => setTimeout(resolve, 560));
}

before(async () => {
  origLocalStorage = globalThis.localStorage;
  globalThis.localStorage = new MockStorage();
  tracker = await import('../src/utils/sdkTaskTracker.js');
  store = await import('../src/utils/taskStore.js');
});

after(() => {
  if (origLocalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = origLocalStorage;
});

beforeEach(() => {
  globalThis.localStorage.clear();
  tracker.__resetForTests();
  store.__resetForTests();
});

/** Simulate a browser refresh: wipe volatile module state, keep localStorage. */
function simulateRefresh() {
  tracker.__resetForTests(); // volatile-only reset; preserves localStorage
  store.__resetForTests();
}

const AGENT_FRAME = {
  subtype: 'task_started',
  taskId: 'a1',
  sessionId: 's1',
  description: 'Explore the codebase',
  taskType: 'local_agent',
  toolUseId: 'toolu_1',
  prompt: 'find things',
  cwd: '/w/a',
  instanceKey: 'inst-a',
};

describe('sdkTaskTracker persistence (browser refresh)', () => {
  it('persists live tasks to localStorage after the debounce window', async () => {
    tracker.applyFrame(AGENT_FRAME);
    await flushPersist();
    const raw = globalThis.localStorage.getItem('ccv_activeAgents:s1');
    assert.ok(raw, 'checkpoint written');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.sessionId, 's1');
    assert.equal(parsed.tasks.length, 1);
    assert.equal(parsed.tasks[0].taskId, 'a1');
  });

  it('restores the panel from localStorage on refresh (seed)', async () => {
    tracker.applyFrame(AGENT_FRAME);
    await flushPersist();
    simulateRefresh();
    assert.deepEqual(store.getTasks(), [], 'volatile state wiped by refresh');

    tracker.restoreFromStorage('s1');
    const tasks = store.getTasks();
    assert.equal(tasks.length, 1, 'restored from checkpoint');
    assert.equal(tasks[0].taskId, 'a1');
    assert.equal(tasks[0].subject, 'Explore the codebase');
  });

  it('DOUBLE REFRESH: empty authoritative snapshot keeps the restored panel and the checkpoint', async () => {
    // Session s1 has a live task, persisted.
    tracker.applyFrame(AGENT_FRAME);
    await flushPersist();

    // ── First refresh ──
    simulateRefresh();
    tracker.restoreFromStorage('s1');          // seed from checkpoint
    assert.equal(store.getTasks().length, 1, 'first refresh restores panel');
    // Server replays its (already-drained) authoritative EMPTY table.
    tracker.applySnapshot({ sessionId: 's1', cwd: '/w/a', instanceKey: 'inst-a', tasks: [] });
    // Panel must keep the restored rows (user asked: refresh keeps the panel).
    assert.equal(store.getTasks().length, 1, 'empty snapshot must NOT wipe the restored panel');
    // Crucially, the seed publish + empty snapshot must not have destroyed the checkpoint.
    await flushPersist();
    assert.ok(globalThis.localStorage.getItem('ccv_activeAgents:s1'), 'checkpoint survives first refresh');

    // ── Second refresh ──
    simulateRefresh();
    tracker.restoreFromStorage('s1');
    assert.equal(store.getTasks().length, 1, 'second refresh still restores (checkpoint survived)');
  });

  it('a NON-empty authoritative snapshot reconciles normally and resumes persistence', async () => {
    tracker.applyFrame(AGENT_FRAME);
    await flushPersist();
    simulateRefresh();
    tracker.restoreFromStorage('s1');
    assert.equal(store.getTasks().length, 1);

    // Server replays a non-empty table with a DIFFERENT live task — authoritative.
    tracker.applySnapshot({
      sessionId: 's1', cwd: '/w/a', instanceKey: 'inst-a',
      tasks: [{ taskId: 'b2', taskType: 'local_agent', status: 'running', description: 'Live now', toolUseId: 'toolu_2' }],
    });
    const ids = store.getTasks().map((t) => t.taskId);
    assert.deepEqual(ids, ['b2'], 'reconciled to the server table, stale seed dropped');
    await flushPersist();
    const parsed = JSON.parse(globalThis.localStorage.getItem('ccv_activeAgents:s1'));
    assert.deepEqual(parsed.tasks.map((t) => t.taskId), ['b2'], 'live snapshot persisted');
  });

  it('a live frame after restore resumes persistence (seed mode exits)', async () => {
    tracker.applyFrame(AGENT_FRAME);
    await flushPersist();
    simulateRefresh();
    tracker.restoreFromStorage('s1');
    // A real live frame arrives for the same session/workspace.
    tracker.applyFrame({ subtype: 'task_progress', taskId: 'a1', sessionId: 's1', cwd: '/w/a', instanceKey: 'inst-a', lastToolName: 'Bash' });
    await flushPersist();
    const parsed = JSON.parse(globalThis.localStorage.getItem('ccv_activeAgents:s1'));
    assert.equal(parsed.tasks[0].lastToolName, 'Bash', 'live update persisted after seed mode exits');
  });

  it('resetForSession clears the checkpoint so a dead session does not restore', async () => {
    tracker.applyFrame(AGENT_FRAME);
    await flushPersist();
    assert.ok(globalThis.localStorage.getItem('ccv_activeAgents:s1'));

    tracker.resetForSession(); // session boundary — checkpoint deleted
    assert.equal(globalThis.localStorage.getItem('ccv_activeAgents:s1'), null, 'checkpoint cleared');

    simulateRefresh();
    tracker.restoreFromStorage('s1');
    assert.deepEqual(store.getTasks(), [], 'nothing to restore for a cleared session');
  });

  it('a pending debounced persist cannot resurrect a checkpoint cleared by resetForSession', async () => {
    tracker.applyFrame(AGENT_FRAME);
    // Do NOT flush — the 500ms debounce is still pending when the session resets.
    tracker.resetForSession();
    assert.equal(globalThis.localStorage.getItem('ccv_activeAgents:s1'), null);
    await flushPersist(); // fire the trailing write, if it was not cancelled
    assert.equal(globalThis.localStorage.getItem('ccv_activeAgents:s1'), null, 'trailing persist was cancelled by the reset');
  });

  it('restoreFromStorage skips when the server already spoke authoritatively (empty) for this session', async () => {
    tracker.applyFrame(AGENT_FRAME);
    await flushPersist();
    simulateRefresh();
    // Server snapshot (empty) lands BEFORE restore.
    tracker.applySnapshot({ sessionId: 's1', cwd: '/w/a', instanceKey: 'inst-a', tasks: [] });
    tracker.restoreFromStorage('s1');
    assert.deepEqual(store.getTasks(), [], 'restore skipped — server said empty for this session');
  });

  it('hasSdkState() is true after a restore seed and false on a pristine tracker', async () => {
    assert.equal(tracker.hasSdkState(), false, 'pristine tracker has no SDK state');
    tracker.applyFrame(AGENT_FRAME);
    await flushPersist();
    simulateRefresh();
    assert.equal(tracker.hasSdkState(), false, 'refresh wiped volatile state');
    tracker.restoreFromStorage('s1');
    assert.equal(tracker.hasSdkState(), true, 'restored seed counts as SDK state (boot gate)');
  });

  it('HYDRATION WIPE: a boot clearTaskStore() after the seed is recovered by the sdkMode-flip re-restore', async () => {
    // Regression for the reported bug: on refresh, the WS replay seeds the panel,
    // then AppBase's boot activation / SSE connect runs while sdkMode is still
    // false and blanks the store. When sdkMode flips true, componentDidUpdate
    // calls restoreFromStorage again — it must REPUBLISH the retained seed, not
    // no-op on `_tasks.size > 0`.
    tracker.applyFrame(AGENT_FRAME);
    await flushPersist();

    simulateRefresh();
    tracker.restoreFromStorage('s1');           // WS sdk-session-state replay seeds
    assert.equal(store.getTasks().length, 1, 'seeded');
    // Authoritative empty snapshot for the same session: kept (refresh-survival).
    tracker.applySnapshot({ sessionId: 's1', cwd: '/w/a', instanceKey: 'inst-a', tasks: [] });
    assert.equal(store.getTasks().length, 1, 'empty snapshot keeps seed');

    store.clearTasks();                          // boot wipe (sdkMode still false)
    assert.deepEqual(store.getTasks(), [], 'boot cleared the store');

    tracker.restoreFromStorage('s1');           // sdkMode flips true → recovery
    assert.equal(store.getTasks().length, 1, 'recovery republishes the retained seed');
    assert.equal(store.getTasks()[0].taskId, 'a1');
  });

  it('recovery republish does NOT persist (seed stays unverified; checkpoint not echoed)', async () => {
    tracker.applyFrame(AGENT_FRAME);
    await flushPersist();
    simulateRefresh();
    tracker.restoreFromStorage('s1');
    tracker.applySnapshot({ sessionId: 's1', cwd: '/w/a', instanceKey: 'inst-a', tasks: [] });
    store.clearTasks();
    tracker.restoreFromStorage('s1');            // republish seed
    await flushPersist();
    const parsed = JSON.parse(globalThis.localStorage.getItem('ccv_activeAgents:s1'));
    assert.equal(parsed.tasks[0].taskId, 'a1', 'checkpoint intact, not overwritten by an echo');
  });

  it('restoreFromStorage drops label-less seed rows (subject==null && description==null)', async () => {
    // Write a checkpoint directly with a degraded row (no subject, no description)
    // alongside a healthy one. The restore filter must drop the degraded row —
    // a TERMINAL label-less row renders on the HUD as a bare "#id" with no live
    // update coming to relabel it; it is replay/checkpoint residue, not a live
    // in-flight stub.
    globalThis.localStorage.setItem('ccv_activeAgents:s1', JSON.stringify({
      sessionId: 's1',
      tasks: [
        { taskId: 'ok', subject: 'Find dispatch', description: null, status: 'in_progress' },
        { taskId: 'ghost', subject: null, description: null, status: 'completed' },
        { taskId: 'sum', subject: null, description: 'Find dispatch of non-interactive local commands', status: 'completed' },
      ],
      ownerKey: null,
      ts: Date.now(),
    }));
    simulateRefresh();
    tracker.restoreFromStorage('s1');
    const ids = store.getTasks().map((t) => t.taskId);
    assert.deepEqual(ids, ['ok', 'sum'],
      'label-less ghost dropped; subject-bearing and description-bearing rows kept');
    const sum = store.getTasks().find((t) => t.taskId === 'sum');
    assert.equal(sum.subject, null);
    assert.equal(sum.description, 'Find dispatch of non-interactive local commands',
      'HUD label falls back to description → renders the summary text');
  });

  it('restoreFromStorage treats empty-string subject/description as label-less on TERMINAL rows', async () => {
    // Truthy guard parity with applySnapshot: `subject: ''` is falsy, so a
    // terminal row with no other label renders a bare "#id" — the filter must
    // treat it as label-less too.
    globalThis.localStorage.setItem('ccv_activeAgents:s1', JSON.stringify({
      sessionId: 's1',
      tasks: [
        { taskId: 'ok', subject: 'Real', description: null, status: 'in_progress' },
        { taskId: 'empty_subj', subject: '', description: null, status: 'completed' },
        { taskId: 'empty_desc', subject: null, description: '', status: 'completed' },
        { taskId: 'ws_subj', subject: '   ', description: null, status: 'completed' },
      ],
      ownerKey: null,
      ts: Date.now(),
    }));
    simulateRefresh();
    tracker.restoreFromStorage('s1');
    assert.deepEqual(store.getTasks().map((t) => t.taskId), ['ok'],
      'terminal rows with empty / whitespace-only labels are treated as label-less');
  });

  it('an all-label-less checkpoint restores as empty (hasSdkState stays false)', async () => {
    globalThis.localStorage.setItem('ccv_activeAgents:s1', JSON.stringify({
      sessionId: 's1',
      tasks: [{ taskId: 'ghost', subject: null, description: null, status: 'completed' }],
      ownerKey: null,
      ts: Date.now(),
    }));
    simulateRefresh();
    tracker.restoreFromStorage('s1');
    assert.deepEqual(store.getTasks(), [], 'no displayable row → nothing restored');
    assert.equal(tracker.hasSdkState(), false, 'empty restore does not mark SDK state');
  });
});
