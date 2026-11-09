/**
 * sdkTaskTracker.test.js — covers src/utils/sdkTaskTracker.js
 *
 * Plain node:test (no jsdom/React), same style as taskStore.test.js.
 * Verifies that sdk-task WS frames are correctly merged into taskStore-compatible
 * snapshots: status mapping, skipTranscript filtering, patch semantics, idempotent
 * re-fire with status reset, session-boundary reset, and clear/reset lifecycle.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { applyFrame, applySnapshot, clear, __resetForTests } from '../src/utils/sdkTaskTracker.js';
import { getSnapshot, getTasks, __resetForTests as resetTaskStore } from '../src/utils/taskStore.js';

beforeEach(() => {
  __resetForTests();
  resetTaskStore();
});

describe('utils/sdkTaskTracker.js', () => {
  it('starts empty', () => {
    assert.deepEqual(getTasks(), []);
  });

  it('task_started adds a task as in_progress', () => {
    applyFrame({ subtype: 'task_started', taskId: 't1', sessionId: 's1', description: 'Fix the bug', summary: 'Detailed fix' });
    const tasks = getTasks();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].taskId, 't1');
    assert.equal(tasks[0].subject, 'Fix the bug');
    assert.equal(tasks[0].description, 'Detailed fix');
    assert.equal(tasks[0].status, 'in_progress');
    assert.equal(getSnapshot().sessionId, 's1');
  });

  it('task_started with skipTranscript is ignored', () => {
    applyFrame({ subtype: 'task_started', taskId: 't1', sessionId: 's1', description: 'Background', skipTranscript: true });
    assert.deepEqual(getTasks(), []);
  });

  it('task_started re-fire resets status to in_progress', () => {
    applyFrame({ subtype: 'task_started', taskId: 't1', sessionId: 's1', description: 'Original' });
    applyFrame({ subtype: 'task_updated', taskId: 't1', sessionId: 's1', patch: { status: 'completed' } });
    assert.equal(getTasks()[0].status, 'completed');
    // Re-fire: new task batch reuses the same id
    applyFrame({ subtype: 'task_started', taskId: 't1', sessionId: 's1', description: 'Reworked' });
    assert.equal(getTasks()[0].status, 'in_progress');
    assert.equal(getTasks()[0].subject, 'Reworked');
  });

  it('task_started retains toolUseId and a bounded promptSnippet for agent tasks', () => {
    const longPrompt = 'p'.repeat(5000);
    applyFrame({ subtype: 'task_started', taskId: 'a1', sessionId: 's1', description: 'Explore', taskType: 'local_agent', toolUseId: 'toolu_1', prompt: longPrompt });
    const t = getTasks()[0];
    assert.equal(t.toolUseId, 'toolu_1');
    assert.equal(t.promptSnippet.length, 1024);
    assert.equal(t.promptSnippet, longPrompt.slice(0, 1024));
  });

  it('task_started does not retain prompt for non-agent tasks', () => {
    applyFrame({ subtype: 'task_started', taskId: 'b1', sessionId: 's1', description: 'Run tests', taskType: 'local_bash', toolUseId: 'toolu_2', prompt: 'npm test' });
    const t = getTasks()[0];
    assert.equal(t.toolUseId, 'toolu_2');
    assert.equal(t.promptSnippet, null);
  });

  it('task_started re-fire refreshes toolUseId/promptSnippet for a reused taskId', () => {
    // NO terminal state in between: re-firing while the task is still in_progress
    // hits the `existing` branch directly (a completed task would instead trigger
    // the all-terminal batch reset and rebuild via the new-task path).
    applyFrame({ subtype: 'task_started', taskId: 'a1', sessionId: 's1', description: 'Old', taskType: 'local_agent', toolUseId: 'toolu_old', prompt: 'old prompt' });
    applyFrame({ subtype: 'task_started', taskId: 'a1', sessionId: 's1', description: 'New', taskType: 'local_agent', toolUseId: 'toolu_new', prompt: 'new prompt' });
    const tasks = getTasks();
    assert.equal(tasks.length, 1, 're-fire reuses the same task slot (no new row)');
    assert.equal(tasks[0].toolUseId, 'toolu_new');
    assert.equal(tasks[0].promptSnippet, 'new prompt');
    assert.equal(tasks[0].subject, 'New');
  });

  it('task_started re-fire keeps prior toolUseId/promptSnippet when the new frame omits them', () => {
    // Conditional-merge semantics: fields absent from the re-fire frame retain
    // their previous values (the server only forwards fields that are present).
    applyFrame({ subtype: 'task_started', taskId: 'a1', sessionId: 's1', description: 'Old', taskType: 'local_agent', toolUseId: 'toolu_old', prompt: 'old prompt' });
    applyFrame({ subtype: 'task_started', taskId: 'a1', sessionId: 's1', description: 'New', taskType: 'local_agent' });
    const t = getTasks()[0];
    assert.equal(t.toolUseId, 'toolu_old', 'omitted toolUseId is retained');
    assert.equal(t.promptSnippet, 'old prompt', 'omitted prompt is retained');
  });

  it('task_updated applies status patch with mapping', () => {
    applyFrame({ subtype: 'task_started', taskId: 't1', sessionId: 's1', description: 'Task' });
    applyFrame({ subtype: 'task_updated', taskId: 't1', sessionId: 's1', patch: { status: 'completed' } });
    assert.equal(getTasks()[0].status, 'completed');
  });

  it('task_updated maps running to in_progress', () => {
    applyFrame({ subtype: 'task_started', taskId: 't1', sessionId: 's1', description: 'Task' });
    applyFrame({ subtype: 'task_updated', taskId: 't1', sessionId: 's1', patch: { status: 'pending' } });
    assert.equal(getTasks()[0].status, 'pending');
    applyFrame({ subtype: 'task_updated', taskId: 't1', sessionId: 's1', patch: { status: 'running' } });
    assert.equal(getTasks()[0].status, 'in_progress');
  });

  it('task_updated maps failed to failed (not completed)', () => {
    applyFrame({ subtype: 'task_started', taskId: 't1', sessionId: 's1', description: 'Task' });
    applyFrame({ subtype: 'task_updated', taskId: 't1', sessionId: 's1', patch: { status: 'failed' } });
    assert.equal(getTasks()[0].status, 'failed');
  });

  it('task_updated maps killed to failed', () => {
    applyFrame({ subtype: 'task_started', taskId: 't1', sessionId: 's1', description: 'Task' });
    applyFrame({ subtype: 'task_updated', taskId: 't1', sessionId: 's1', patch: { status: 'killed' } });
    assert.equal(getTasks()[0].status, 'failed');
  });

  it('task_updated applies description patch', () => {
    applyFrame({ subtype: 'task_started', taskId: 't1', sessionId: 's1', description: 'Old' });
    applyFrame({ subtype: 'task_updated', taskId: 't1', sessionId: 's1', patch: { description: 'New desc' } });
    assert.equal(getTasks()[0].subject, 'New desc');
  });

  it('task_updated with empty patch is a no-op', () => {
    applyFrame({ subtype: 'task_started', taskId: 't1', sessionId: 's1', description: 'Task' });
    applyFrame({ subtype: 'task_updated', taskId: 't1', sessionId: 's1', patch: {} });
    assert.equal(getTasks().length, 1);
  });

  it('task_updated with unknown status keeps previous status', () => {
    applyFrame({ subtype: 'task_started', taskId: 't1', sessionId: 's1', description: 'Task' });
    applyFrame({ subtype: 'task_updated', taskId: 't1', sessionId: 's1', patch: { status: 'unknown_xyz' } });
    assert.equal(getTasks()[0].status, 'in_progress'); // unchanged
  });

  it('task_notification marks task as completed', () => {
    applyFrame({ subtype: 'task_started', taskId: 't1', sessionId: 's1', description: 'Task' });
    applyFrame({ subtype: 'task_notification', taskId: 't1', sessionId: 's1', status: 'completed', summary: 'Done' });
    const tasks = getTasks();
    assert.equal(tasks[0].status, 'completed');
    assert.equal(tasks[0].description, 'Done');
  });

  it('task_notification with failed maps to failed', () => {
    applyFrame({ subtype: 'task_started', taskId: 't1', sessionId: 's1', description: 'Task' });
    applyFrame({ subtype: 'task_notification', taskId: 't1', sessionId: 's1', status: 'failed' });
    assert.equal(getTasks()[0].status, 'failed');
  });

  it('task_notification with stopped maps to failed', () => {
    applyFrame({ subtype: 'task_started', taskId: 't1', sessionId: 's1', description: 'Task' });
    applyFrame({ subtype: 'task_notification', taskId: 't1', sessionId: 's1', status: 'stopped' });
    assert.equal(getTasks()[0].status, 'failed');
  });

  it('task_notification with completed maps to completed', () => {
    applyFrame({ subtype: 'task_started', taskId: 't1', sessionId: 's1', description: 'Task' });
    applyFrame({ subtype: 'task_notification', taskId: 't1', sessionId: 's1', status: 'completed', summary: 'Done' });
    assert.equal(getTasks()[0].status, 'completed');
    assert.equal(getTasks()[0].description, 'Done');
  });

  it('task_progress reads subject from description (not summary)', () => {
    applyFrame({ subtype: 'task_started', taskId: 't1', sessionId: 's1', description: 'Task' });
    applyFrame({ subtype: 'task_progress', taskId: 't1', sessionId: 's1', lastToolName: 'Bash', description: 'Right', summary: 'Wrong' });
    const tasks = getTasks();
    assert.equal(tasks[0].lastToolName, 'Bash');
    assert.equal(tasks[0].subject, 'Right');
  });

  it('STATUS_MAP is a Map: a prototype-chain key does not resolve to a status', () => {
    applyFrame({ subtype: 'task_started', taskId: 't1', sessionId: 's1', description: 'Task' });
    // With a plain object map, '__proto__'/'constructor' would look up the
    // prototype chain and yield a truthy non-status — a Map does not.
    applyFrame({ subtype: 'task_updated', taskId: 't1', sessionId: 's1', patch: { status: '__proto__' } });
    applyFrame({ subtype: 'task_updated', taskId: 't1', sessionId: 's1', patch: { status: 'constructor' } });
    assert.equal(getTasks()[0].status, 'in_progress');
    assert.equal(getTasks().length, 1);
  });

  it('frames for unknown taskId are ignored', () => {
    applyFrame({ subtype: 'task_updated', taskId: 'nope', sessionId: 's1', patch: { status: 'completed' } });
    applyFrame({ subtype: 'task_progress', taskId: 'nope', sessionId: 's1', lastToolName: 'Bash' });
    applyFrame({ subtype: 'task_notification', taskId: 'nope', sessionId: 's1', status: 'completed' });
    assert.deepEqual(getTasks(), []);
  });

  it('multiple tasks maintain insertion order', () => {
    applyFrame({ subtype: 'task_started', taskId: 't1', sessionId: 's1', description: 'First' });
    applyFrame({ subtype: 'task_started', taskId: 't2', sessionId: 's1', description: 'Second' });
    applyFrame({ subtype: 'task_started', taskId: 't3', sessionId: 's1', description: 'Third' });
    const tasks = getTasks();
    assert.equal(tasks.length, 3);
    assert.equal(tasks[0].taskId, 't1');
    assert.equal(tasks[1].taskId, 't2');
    assert.equal(tasks[2].taskId, 't3');
  });

  it('sessionId change resets tasks', () => {
    applyFrame({ subtype: 'task_started', taskId: 't1', sessionId: 's1', description: 'Old session' });
    applyFrame({ subtype: 'task_started', taskId: 't2', sessionId: 's1', description: 'Also old' });
    assert.equal(getTasks().length, 2);
    // New session starts — old tasks must be wiped
    applyFrame({ subtype: 'task_started', taskId: 't1', sessionId: 's2', description: 'New session' });
    const tasks = getTasks();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].subject, 'New session');
    assert.equal(getSnapshot().sessionId, 's2');
  });

  it('sessionId change publishes the emptied snapshot even when the frame does not merge', () => {
    applyFrame({ subtype: 'task_started', taskId: 't1', sessionId: 's1', description: 'Old session' });
    assert.equal(getTasks().length, 1);
    // First frame of the new session is a non-merging one (unknown taskId):
    // the store must still be cleared, not left showing the stale session.
    applyFrame({ subtype: 'task_updated', taskId: 'ghost', sessionId: 's2', patch: { status: 'completed' } });
    assert.deepEqual(getTasks(), []);
    assert.equal(getSnapshot().sessionId, 's2');
  });

  it('sessionId change publishes the emptied snapshot for a skipTranscript first frame', () => {
    applyFrame({ subtype: 'task_started', taskId: 't1', sessionId: 's1', description: 'Old session' });
    applyFrame({ subtype: 'task_started', taskId: 'bg', sessionId: 's2', description: 'Ambient', skipTranscript: true });
    assert.deepEqual(getTasks(), []);
    assert.equal(getSnapshot().sessionId, 's2');
  });

  it('same sessionId does not reset tasks', () => {
    applyFrame({ subtype: 'task_started', taskId: 't1', sessionId: 's1', description: 'First' });
    applyFrame({ subtype: 'task_started', taskId: 't2', sessionId: 's1', description: 'Second' });
    assert.equal(getTasks().length, 2);
  });

  it('clear resets all state', () => {
    applyFrame({ subtype: 'task_started', taskId: 't1', sessionId: 's1', description: 'Task' });
    clear();
    assert.deepEqual(getTasks(), []);
    assert.equal(getSnapshot().sessionId, null);
  });

  it('null/undefined/malformed frames are ignored', () => {
    applyFrame(null);
    applyFrame(undefined);
    applyFrame({});
    applyFrame({ subtype: 'task_started' }); // no taskId
    assert.deepEqual(getTasks(), []);
  });

  it('sessionId tracks the latest frame', () => {
    applyFrame({ subtype: 'task_started', taskId: 't1', sessionId: 's1', description: 'Task' });
    assert.equal(getSnapshot().sessionId, 's1');
  });

  describe('applySnapshot (authoritative reconnect reconcile)', () => {
    it('resurrects a task whose started-frame was missed AND drops one the server no longer tracks', () => {
      // Client saw only t_live; server also has t_missed (its frame was lost) and has
      // since dropped t_stale (its terminal frame was lost client-side).
      applyFrame({ subtype: 'task_started', taskId: 't_live', sessionId: 's1', description: 'Live' });
      applyFrame({ subtype: 'task_started', taskId: 't_stale', sessionId: 's1', description: 'Stale' });

      applySnapshot({
        sessionId: 's1',
        tasks: [
          { taskId: 't_live', taskType: 'local_agent', toolUseId: 'toolu_live', status: 'running', description: 'Live', promptSnippet: 'p' },
          { taskId: 't_missed', taskType: 'in_process_teammate', toolUseId: 'toolu_missed', status: 'running', description: 'Missed', promptSnippet: 'q' },
        ],
      });

      const ids = getTasks().map((t) => t.taskId).sort();
      assert.deepEqual(ids, ['t_live', 't_missed'], 'stale dropped, missed resurrected');
      assert.equal(getSnapshot().sessionId, 's1');
      const missed = getTasks().find((t) => t.taskId === 't_missed');
      assert.equal(missed.status, 'in_progress');
      assert.equal(missed.toolUseId, 'toolu_missed');
      assert.equal(missed.promptSnippet, 'q');
    });

    it('a live frame from the snapshot\'s own workspace keeps the resurrected tasks', () => {
      // Regression: the snapshot must adopt cwd/instanceKey ownership. Otherwise
      // the next live frame's owner-change branch sees owner !== _ownerKey (null)
      // and wipes everything the snapshot just restored.
      applySnapshot({
        cwd: '/w/a', instanceKey: 'inst-a', sessionId: 's1',
        tasks: [
          { taskId: 't1', taskType: 'local_agent', toolUseId: 'toolu_1', status: 'running', description: 'A', promptSnippet: 'p' },
          { taskId: 't2', taskType: 'in_process_teammate', status: 'running', description: 'B' },
        ],
      });
      assert.deepEqual(getTasks().map((t) => t.taskId), ['t1', 't2']);
      applyFrame({ subtype: 'task_progress', taskId: 't1', cwd: '/w/a', instanceKey: 'inst-a', sessionId: 's1', lastToolName: 'Bash', description: 'working' });
      const tasks = getTasks();
      assert.deepEqual(tasks.map((t) => t.taskId), ['t1', 't2'], 'same-workspace frame must not reset');
      assert.equal(tasks[0].lastToolName, 'Bash');
      assert.equal(tasks[0].subject, 'working');
      assert.equal(getSnapshot().sessionId, 's1');
      // A frame from a DIFFERENT workspace still resets (owner-change branch).
      applyFrame({ subtype: 'task_progress', taskId: 't1', cwd: '/w/b', instanceKey: 'inst-b', sessionId: 's1' });
      assert.deepEqual(getTasks(), []);
    });

    it('excludes skipTranscript entries but keeps tasks from servers without the flag', () => {
      applySnapshot({
        sessionId: 's1',
        tasks: [
          { taskId: 't_visible', taskType: 'local_agent', status: 'running', description: 'Visible' },
          { taskId: 't_ambient', taskType: 'local_agent', status: 'running', description: 'Ambient', skipTranscript: true },
        ],
      });
      assert.deepEqual(getTasks().map((t) => t.taskId), ['t_visible']);
    });

    it('maps terminal statuses so a resurrected-then-finished agent is not revived as active', () => {
      applySnapshot({
        sessionId: 's1',
        tasks: [{ taskId: 't_done', taskType: 'local_agent', status: 'completed', terminal: true, description: 'Done' }],
      });
      const t = getTasks().find((x) => x.taskId === 't_done');
      assert.equal(t.status, 'completed');
    });

    it('ignores malformed snapshots', () => {
      applyFrame({ subtype: 'task_started', taskId: 't1', sessionId: 's1', description: 'Keep' });
      applySnapshot(null);
      applySnapshot({});
      applySnapshot({ tasks: 'nope' });
      assert.deepEqual(getTasks().map((t) => t.taskId), ['t1'], 'unchanged on malformed input');
    });
  });
});
