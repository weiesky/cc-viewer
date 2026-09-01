/**
 * taskStore.test.js — covers src/utils/taskStore.js
 *
 * Plain node:test (no jsdom/React), same style as workflowStore.test.js:
 * publish replaces the snapshot wholesale, status normalization, subscribe /
 * unsubscribe, clearTasks semantics. Display order is the server's insertion
 * order (creation order, matching the TUI) — the store deliberately does NOT
 * re-sort.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  publish, subscribe, getSnapshot, getTasks, clearTasks, __resetForTests,
} from '../src/utils/taskStore.js';

beforeEach(() => __resetForTests());

describe('utils/taskStore.js', () => {
  it('starts empty', () => {
    assert.deepEqual(getSnapshot(), { sessionId: null, tasks: [] });
    assert.deepEqual(getTasks(), []);
  });

  it('publish replaces the snapshot wholesale and notifies subscribers', () => {
    const seen = [];
    const unsub = subscribe((snap) => seen.push(snap));
    publish({ sessionId: 's1', tasks: [{ taskId: '1', status: 'pending', subject: 'a' }] });
    publish({ sessionId: 's1', tasks: [] });
    unsub();
    publish({ sessionId: 's2', tasks: [{ taskId: '2', status: 'completed' }] });
    assert.equal(seen.length, 2, 'unsubscribed listener must not fire');
    assert.equal(seen[0].tasks.length, 1);
    assert.equal(seen[1].tasks.length, 0);
    assert.equal(getSnapshot().sessionId, 's2');
    assert.equal(getTasks()[0].taskId, '2');
  });

  it('rejects malformed payloads without touching the snapshot', () => {
    publish({ sessionId: 's1', tasks: [{ taskId: '1', status: 'pending' }] });
    publish(null);
    publish('junk');
    publish({ sessionId: 's2' }); // no tasks array
    publish({ tasks: 'not-an-array' });
    assert.equal(getSnapshot().sessionId, 's1');
    assert.equal(getTasks().length, 1);
  });

  it('drops entries with unknown status (incl. deleted) or missing taskId', () => {
    publish({
      sessionId: 's1',
      tasks: [
        { taskId: '1', status: 'bogus', subject: 'x' },
        { taskId: 2, status: 'in_progress' },
        { taskId: '3', status: 'deleted' }, // server filters pre-broadcast; wire break → drop
        { taskId: '4', subject: 'no status' }, // absent → default pending
        { status: 'pending' }, // no taskId → dropped
        null,
      ],
    });
    const tasks = getTasks();
    assert.deepEqual(tasks.map(t => t.taskId), ['2', '4'], 'unknown/deleted status and taskId-less entries dropped');
    assert.equal(tasks[0].taskId, '2', 'numeric taskId stringified');
    assert.equal(tasks[1].status, 'pending', 'absent status defaults to pending');
  });

  it('clearTasks empties the store; no-op notify when already empty', () => {
    let calls = 0;
    subscribe(() => { calls += 1; });
    clearTasks();
    assert.equal(calls, 0, 'already empty → no notification');
    publish({ sessionId: 's1', tasks: [{ taskId: '1', status: 'pending' }] });
    assert.equal(calls, 1);
    clearTasks();
    assert.equal(calls, 2);
    assert.deepEqual(getSnapshot(), { sessionId: null, tasks: [] });
  });

  it('preserves server insertion order (creation order = TUI order), never re-sorts', () => {
    publish({
      sessionId: 's1',
      tasks: [
        { taskId: '1', status: 'completed' },
        { taskId: '2', status: 'pending' },
        { taskId: '3', status: 'in_progress' },
      ],
    });
    assert.deepEqual(getTasks().map(t => t.taskId), ['1', '2', '3']);
  });
});
