/**
 * SDK task tracker
 *
 * In SDK mode, Claude Code hooks never fire (no CCVIEWER_PORT), so the
 * TaskProgressHud's only data source (task-bridge → /api/task-event → SSE
 * task_update) is completely dormant. This module consumes the server-relayed
 * WS `sdk-task` frames (task_started/task_progress/task_notification/
 * task_updated from sdk-manager.js) and rebuilds a taskStore-compatible
 * snapshot on the client side so the HUD works in SDK mode too.
 *
 * Differences from the hook path:
 * - The hook path maintains a full snapshot server-side (task-state.js) and
 *   broadcasts wholesale replacements over SSE; this module merges deltas
 *   client-side and publishes full snapshots to taskStore after each frame.
 * - The SDK status vocabulary differs from the HUD's, so a mapping is applied
 *   (running→in_progress; the failed/killed/stopped terminal states→failed).
 * - Tasks with `skipTranscript` are background/ambient tasks (not user-visible
 *   TODO items) and are excluded from the checklist.
 *
 * Frame loss: sdk-task is delta-only with no snapshot replay, but the HUD is
 * an ephemeral display — only future tasks self-heal on new frame arrival;
 * a missed task_started means later frames for that taskId are dropped.
 * Session switches reset the tracker via AppBase's clear points and via
 * the sessionId-change guard inside applyFrame.
 */

import { publish as publishTaskUpdate, clearTasks as clearTaskStore } from './taskStore.js';

/** @type {Map<string, object>} */
let _tasks = new Map();
let _sessionId = null;

// SDK status vocabulary → HUD status mapping. The HUD renders four states
// (pending / in_progress / completed / failed); the SDK terminal failures
// (failed / killed / stopped) all surface as `failed` so a background task that
// did not succeed is never shown as a clean completion.
// task_updated.patch.status: pending|running|completed|failed|killed
// task_notification.status: completed|failed|stopped
const STATUS_MAP = new Map([
  ['pending', 'pending'],
  ['running', 'in_progress'],
  ['completed', 'completed'],
  ['failed', 'failed'],
  ['killed', 'failed'],
  ['stopped', 'failed'],
]);

function _mapStatus(sdkStatus) {
  return STATUS_MAP.get(sdkStatus) || null;
}

function _publish() {
  const tasks = [..._tasks.values()];
  publishTaskUpdate({ sessionId: _sessionId, tasks });
}

/**
 * Apply one sdk-task WS frame (the camelCase relay payload from sdk-manager).
 * @param {object} frame - { subtype, sessionId, taskId, ... }
 */
export function applyFrame(frame) {
  if (!frame || typeof frame !== 'object') return;
  const { subtype, taskId } = frame;
  if (!taskId) return;

  // Session boundary: a new sessionId means the previous session's tasks are
  // stale (resume/fork/clear within the same workspace). Reset before merging,
  // and publish the emptied snapshot immediately — otherwise a first frame that
  // does not merge (unknown taskId / skipTranscript) would leave the previous
  // session's checklist stuck on the HUD until some later publishable frame.
  if (frame.sessionId && frame.sessionId !== _sessionId) {
    _tasks = new Map();
    _sessionId = frame.sessionId;
    _publish();
  }

  switch (subtype) {
    case 'task_started': {
      if (frame.skipTranscript) return;
      const existing = _tasks.get(taskId);
      if (existing) {
        // Idempotent re-fire: refresh mutable fields and reset status
        // (a task id may be reused after session reset or completion).
        if (frame.description != null) existing.subject = frame.description;
        if (frame.summary != null) existing.description = frame.summary;
        if (frame.taskType != null) existing.taskType = frame.taskType;
        existing.status = 'in_progress';
        existing.createdAt = Date.now();
        _publish();
        return;
      }
      _tasks.set(taskId, {
        taskId,
        subject: frame.description ?? null,
        description: frame.summary ?? null,
        activeForm: null,
        status: 'in_progress',
        owner: null,
        teammateName: null,
        agentId: null,
        taskType: frame.taskType ?? null,
        createdAt: Date.now(),
      });
      _publish();
      break;
    }

    case 'task_progress': {
      const existing = _tasks.get(taskId);
      if (!existing) return;
      if (frame.lastToolName != null) existing.lastToolName = frame.lastToolName;
      if (frame.description != null) existing.subject = frame.description;
      _publish();
      break;
    }

    case 'task_updated': {
      const existing = _tasks.get(taskId);
      if (!existing) return;
      const patch = frame.patch;
      if (!patch || typeof patch !== 'object' || Object.keys(patch).length === 0) return;
      if (patch.status != null) {
        const mapped = _mapStatus(patch.status);
        if (mapped) existing.status = mapped;
      }
      if (patch.description != null) existing.subject = patch.description;
      if (patch.endTime != null) existing.endTime = patch.endTime;
      if (patch.error != null) existing.error = patch.error;
      if (patch.isBackgrounded != null) existing.isBackgrounded = patch.isBackgrounded;
      _publish();
      break;
    }

    case 'task_notification': {
      // Terminal state — map through the same vocabulary so failed/stopped
      // surface as `failed`, not a clean completion.
      const existing = _tasks.get(taskId);
      if (!existing) return;
      existing.status = _mapStatus(frame.status) || 'completed';
      if (frame.summary != null) existing.description = frame.summary;
      if (frame.usage != null) existing.usage = frame.usage;
      _publish();
      break;
    }

    // Unknown subtypes are ignored by design.
  }
}

/** Reset tracker state (session/workspace switch, cold load). */
export function clear() {
  _tasks = new Map();
  _sessionId = null;
  clearTaskStore();
}

/** Test hook: restore pristine module state. */
export function __resetForTests() {
  clear();
}
