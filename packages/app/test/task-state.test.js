/**
 * task-state.test.js — covers server/lib/task-state.js
 *
 * The reducer maintains the single shared task checklist fed by task-bridge
 * events (TaskCreated / TaskCompleted / PostToolUse TaskUpdate). Verified here:
 * the full status machine, idempotent re-fires, deleted-removal, re-open
 * transitions, teammate field tracking, unknown-id stubs, stable insertion
 * order, and reset semantics.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { applyTaskEvent, resetTasks, getTaskSnapshot, shouldResetTasks, __resetForTests } from '../server/lib/task-state.js';

beforeEach(() => __resetForTests());

const created = (over = {}) => ({
  hookEventName: 'TaskCreated',
  sessionId: 'sess-1',
  taskId: '1',
  taskSubject: 'Write tests',
  taskDescription: 'Cover the reducer',
  ...over,
});

const taskUpdate = (over = {}) => ({
  hookEventName: 'PostToolUse',
  toolName: 'TaskUpdate',
  sessionId: 'sess-1',
  taskId: '1',
  ...over,
});

describe('lib/task-state.js', () => {
  it('ignores malformed payloads', () => {
    applyTaskEvent(null);
    applyTaskEvent('junk');
    applyTaskEvent({});
    applyTaskEvent({ hookEventName: 'TaskCreated' }); // no taskId
    assert.equal(getTaskSnapshot().tasks.length, 0);
  });

  it('TaskCreated → pending task with subject/description; sessionId tracked', () => {
    applyTaskEvent(created());
    const snap = getTaskSnapshot();
    assert.equal(snap.sessionId, 'sess-1');
    assert.equal(snap.tasks.length, 1);
    assert.deepEqual({ ...snap.tasks[0], createdAt: 0, updatedAt: 0 }, {
      taskId: '1', subject: 'Write tests', description: 'Cover the reducer',
      activeForm: null, status: 'pending', owner: null,
      teammateName: null, agentId: null, createdAt: 0, updatedAt: 0,
    });
  });

  it('TaskCreated re-fire is idempotent: keeps status, refreshes text', () => {
    applyTaskEvent(created());
    applyTaskEvent(taskUpdate({ status: 'in_progress' }));
    applyTaskEvent(created({ taskSubject: 'Write tests v2' }));
    const [t] = getTaskSnapshot().tasks;
    assert.equal(t.status, 'in_progress', 're-fire must not reset to pending');
    assert.equal(t.subject, 'Write tests v2');
  });

  it('TaskUpdate patches status/owner/activeForm; TaskCompleted completes', () => {
    applyTaskEvent(created());
    applyTaskEvent(taskUpdate({ status: 'in_progress', owner: 'alice', activeForm: 'Writing tests' }));
    let [t] = getTaskSnapshot().tasks;
    assert.equal(t.status, 'in_progress');
    assert.equal(t.owner, 'alice');
    assert.equal(t.activeForm, 'Writing tests');
    applyTaskEvent({ hookEventName: 'TaskCompleted', sessionId: 'sess-1', taskId: '1', taskSubject: 'Write tests' });
    [t] = getTaskSnapshot().tasks;
    assert.equal(t.status, 'completed');
  });

  it('TaskUpdate status=deleted removes the task', () => {
    applyTaskEvent(created());
    applyTaskEvent(taskUpdate({ status: 'deleted' }));
    assert.equal(getTaskSnapshot().tasks.length, 0);
  });

  it('re-open transitions pass through (completed → in_progress → pending)', () => {
    applyTaskEvent(created());
    applyTaskEvent(taskUpdate({ status: 'completed' }));
    assert.equal(getTaskSnapshot().tasks[0].status, 'completed');
    applyTaskEvent(taskUpdate({ status: 'in_progress' }));
    assert.equal(getTaskSnapshot().tasks[0].status, 'in_progress');
    applyTaskEvent(taskUpdate({ status: 'pending' }));
    assert.equal(getTaskSnapshot().tasks[0].status, 'pending');
  });

  it('TaskUpdate with unknown taskId creates a stub (subject null)', () => {
    applyTaskEvent(taskUpdate({ taskId: '9', status: 'in_progress' }));
    const [t] = getTaskSnapshot().tasks;
    assert.equal(t.taskId, '9');
    assert.equal(t.status, 'in_progress');
    assert.equal(t.subject, null);
  });

  it('teammate events update the shared list and record teammateName', () => {
    applyTaskEvent(created());
    applyTaskEvent(taskUpdate({ status: 'in_progress', teammateName: 'worker-1', agentId: 'a1' }));
    const [t] = getTaskSnapshot().tasks;
    assert.equal(t.teammateName, 'worker-1');
    assert.equal(t.agentId, 'a1');
  });

  it('insertion order is stable across in-place updates', () => {
    applyTaskEvent(created({ taskId: '1', taskSubject: 'one' }));
    applyTaskEvent(created({ taskId: '2', taskSubject: 'two' }));
    applyTaskEvent(created({ taskId: '3', taskSubject: 'three' }));
    applyTaskEvent(taskUpdate({ taskId: '1', status: 'completed' }));
    applyTaskEvent(taskUpdate({ taskId: '3', status: 'in_progress' }));
    assert.deepEqual(getTaskSnapshot().tasks.map(t => t.taskId), ['1', '2', '3']);
  });

  it('TaskCompleted for an unknown taskId creates a completed stub', () => {
    applyTaskEvent({ hookEventName: 'TaskCompleted', sessionId: 'sess-1', taskId: '7', taskSubject: 'mystery' });
    const [t] = getTaskSnapshot().tasks;
    assert.equal(t.status, 'completed');
    assert.equal(t.subject, 'mystery');
  });

  it('subagent sessionId does not overwrite the main session tag', () => {
    applyTaskEvent(created({ sessionId: 'main-sess' }));
    applyTaskEvent(taskUpdate({ sessionId: 'sub-sess', agentId: 'a9', status: 'in_progress' }));
    assert.equal(getTaskSnapshot().sessionId, 'main-sess');
  });

  it('resetTasks clears the map and the session tag', () => {
    applyTaskEvent(created());
    resetTasks();
    const snap = getTaskSnapshot();
    assert.equal(snap.tasks.length, 0);
    assert.equal(snap.sessionId, null);
  });

  it('unknown hook events are ignored', () => {
    applyTaskEvent(created());
    applyTaskEvent({ hookEventName: 'TaskWhatever', sessionId: 'sess-1', taskId: '1', status: 'completed' });
    assert.equal(getTaskSnapshot().tasks[0].status, 'pending');
  });

  it('TaskCreated re-fire refreshes teammateName too', () => {
    applyTaskEvent(created());
    applyTaskEvent(created({ teammateName: 'worker-2' }));
    assert.equal(getTaskSnapshot().tasks[0].teammateName, 'worker-2');
  });

  describe('shouldResetTasks (session-boundary gate)', () => {
    it('resets on main-agent startup and clear', () => {
      assert.equal(shouldResetTasks({ source: 'startup' }, null), true);
      assert.equal(shouldResetTasks({ source: 'clear' }, 'sess-1'), true);
    });
    it('never resets for subagent/teammate events (agentId present)', () => {
      assert.equal(shouldResetTasks({ source: 'startup', agentId: 'a1' }, null), false);
      assert.equal(shouldResetTasks({ source: 'clear', agentId: 'a1' }, 'sess-1'), false);
      assert.equal(shouldResetTasks({ source: 'resume', sessionId: 'other', agentId: 'a1' }, 'sess-1'), false);
    });
    it('resume/fork to a DIFFERENT session resets; same session keeps the list', () => {
      assert.equal(shouldResetTasks({ source: 'resume', sessionId: 'sess-2' }, 'sess-1'), true);
      assert.equal(shouldResetTasks({ source: 'fork', sessionId: 'sess-2' }, 'sess-1'), true);
      assert.equal(shouldResetTasks({ source: 'resume', sessionId: 'sess-1' }, 'sess-1'), false);
      assert.equal(shouldResetTasks({ source: 'resume' }, 'sess-1'), false, 'no sessionId → cannot prove difference → keep');
    });
    it('ignores compact and malformed payloads', () => {
      assert.equal(shouldResetTasks({ source: 'compact' }, 'sess-1'), false);
      assert.equal(shouldResetTasks(null, 'sess-1'), false);
      assert.equal(shouldResetTasks({}, 'sess-1'), false);
    });
  });
});
