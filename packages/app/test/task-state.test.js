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

import { applyTaskEvent, resetTasks, getTaskSnapshot, shouldResetTasks, shouldResetTasksOnPrompt, __resetForTests } from '../server/lib/task-state.js';

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

  describe('UserPromptSubmit (new-prompt reset)', () => {
    const prompt = (over = {}) => ({
      hookEventName: 'UserPromptSubmit',
      sessionId: 'sess-1',
      ...over,
    });

    it('main-session prompt clears the list and the session tag', () => {
      applyTaskEvent(created({ taskId: '1' }));
      applyTaskEvent(created({ taskId: '2', taskSubject: 'two' }));
      applyTaskEvent(prompt());
      const snap = getTaskSnapshot();
      assert.equal(snap.tasks.length, 0);
      assert.equal(snap.sessionId, null);
    });

    it('foreign-session prompt keeps the list and the session tag', () => {
      applyTaskEvent(created({ sessionId: 'main-sess' }));
      applyTaskEvent(prompt({ sessionId: 'other-sess' }));
      const snap = getTaskSnapshot();
      assert.equal(snap.tasks.length, 1, 'foreign prompt must not wipe the shared list');
      assert.equal(snap.sessionId, 'main-sess', 'foreign prompt must not move the session tag');
    });

    it('prompt carrying agentId never clears (defensive: agent_id not reliably present)', () => {
      applyTaskEvent(created());
      applyTaskEvent(prompt({ agentId: 'a1' }));
      assert.equal(getTaskSnapshot().tasks.length, 1);
    });

    it('prompt without sessionId never clears (cannot prove ownership)', () => {
      applyTaskEvent(created());
      applyTaskEvent(prompt({ sessionId: undefined }));
      applyTaskEvent({ hookEventName: 'UserPromptSubmit' });
      assert.equal(getTaskSnapshot().tasks.length, 1);
    });

    it('prompt on an empty list does not throw', () => {
      applyTaskEvent(prompt());
      assert.equal(getTaskSnapshot().tasks.length, 0);
    });

    it('after a prompt reset, a TaskUpdate rebuilds a stub for tasks the model still uses', () => {
      applyTaskEvent(created({ taskId: '5', taskSubject: 'keep working' }));
      applyTaskEvent(taskUpdate({ taskId: '5', status: 'in_progress' }));
      applyTaskEvent(prompt());
      assert.equal(getTaskSnapshot().tasks.length, 0);
      applyTaskEvent(taskUpdate({ taskId: '5', status: 'in_progress' }));
      const [t] = getTaskSnapshot().tasks;
      assert.equal(t.taskId, '5');
      assert.equal(t.status, 'in_progress');
      assert.equal(t.subject, null, 'stub semantics: text fields are not replayed');
    });

    it('shouldResetTasksOnPrompt truth table', () => {
      assert.equal(shouldResetTasksOnPrompt({ sessionId: 's' }, 's'), true);
      assert.equal(shouldResetTasksOnPrompt({ sessionId: 's' }, null), true);
      assert.equal(shouldResetTasksOnPrompt({ sessionId: 'x' }, 's'), false);
      assert.equal(shouldResetTasksOnPrompt({ agentId: 'a', sessionId: 's' }, 's'), false);
      assert.equal(shouldResetTasksOnPrompt({}, 's'), false);
      assert.equal(shouldResetTasksOnPrompt(null, 's'), false);
      // The !sessionId guard, independent of the session-equality column: with
      // no tracked session the equality check passes vacuously, so only this
      // guard keeps a task-less/foreign prompt from wiping the list.
      assert.equal(shouldResetTasksOnPrompt({}, null), false);
      assert.equal(shouldResetTasksOnPrompt({ agentId: 'a' }, null), false);
    });

    it('null-tag window: a teammate prompt after a reset still clears (documented accepted trade-off)', () => {
      // After a reset the session tag is null; a teammate TaskCreated carries
      // agentId so it does NOT re-tag (only main-agent events do). A teammate
      // UserPromptSubmit arriving in this window passes the gate (agent_id is
      // not reliably present on prompt events) and clears the shared list.
      // This locks the behavior so it is a conscious decision, not a surprise.
      applyTaskEvent(created({ sessionId: 'sess-A', taskId: '1' }));
      applyTaskEvent(prompt({ sessionId: 'sess-A' })); // main prompt → reset, tag = null
      assert.equal(getTaskSnapshot().sessionId, null);
      applyTaskEvent(created({ sessionId: 'sess-TM', agentId: 'tm-1', taskId: '2' })); // teammate task, tag stays null
      assert.equal(getTaskSnapshot().sessionId, null);
      applyTaskEvent(prompt({ sessionId: 'sess-TM' })); // teammate prompt, no agentId on the event
      assert.equal(getTaskSnapshot().tasks.length, 0,
        'documented: teammate prompt in the null-tag window clears the shared list');
    });
  });
});
