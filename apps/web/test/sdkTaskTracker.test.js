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

import { applyFrame, clear, __resetForTests } from '../src/utils/sdkTaskTracker.js';
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
});
