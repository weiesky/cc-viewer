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
 * Frame loss: the live sdk-task relay is delta-only — between snapshots a
 * missed task_started means later frames for that taskId are dropped. On WS
 * (re)connect the server replays its bounded authoritative table and
 * applySnapshot reconciles the client view (resurrecting tasks whose start
 * frame was lost, dropping ones the server no longer tracks).
 * Session switches reset the tracker via AppBase's clear points and via
 * the sessionId-change guard inside applyFrame.
 */

import { publish as publishTaskUpdate, clearTasks as clearTaskStore } from './taskStore.js';
import { AGENT_TASK_TYPES } from './activeAgents.js';
import { AGENT_PROMPT_SNIPPET_LEN } from '@ccv/core/contentFilter';

/** @type {Map<string, object>} */
let _tasks = new Map();
let _sessionId = null;
// Workspace owner of the current checklist (review P2-5). The server routes
// cwd-tagged sdk-task frames only to clients viewing that workspace and does not
// replay them; a single module-global tracker with no owner would otherwise show
// the previous workspace's checklist on a view switch and drop frames belonging
// to the workspace that actually emitted them.
let _ownerKey = null;

function _frameOwner(frame) {
  const cwd = typeof frame.cwd === 'string' ? frame.cwd : '';
  const inst = typeof frame.instanceKey === 'string' ? frame.instanceKey : '';
  return (cwd || inst) ? `${cwd}::${inst}` : null;
}

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
  // Workspace-owner boundary (review P2-5): a frame from a DIFFERENT workspace
  // than the one whose tasks we're showing means a view switch — the displayed
  // checklist no longer belongs here. Reset+publish empty so the new workspace
  // starts clean instead of briefly showing the previous project's tasks.
  const owner = _frameOwner(frame);
  if (owner && owner !== _ownerKey) {
    _ownerKey = owner;
    _tasks = new Map();
    _sessionId = null;
    _publish();
  }

  if (frame.sessionId && frame.sessionId !== _sessionId) {
    _tasks = new Map();
    _sessionId = frame.sessionId;
    _publish();
  }

  switch (subtype) {
    case 'task_started': {
      if (frame.skipTranscript) return;
      // Batch reset (review P2-5): when every tracked task is already terminal,
      // a new task_started opens a fresh turn's batch — drop the previous
      // turn's residue so the HUD never opens as "✓ 3/4" with stale dots and
      // _tasks can't grow unboundedly across turns (hook-path parity: the PTY
      // path resets the checklist on every new user prompt).
      if (_tasks.size > 0 && [..._tasks.values()].every(t => t.status === 'completed' || t.status === 'failed')) {
        _tasks = new Map();
      }
      const existing = _tasks.get(taskId);
      if (existing) {
        // Idempotent re-fire: refresh mutable fields and reset status
        // (a task id may be reused after session reset or completion).
        if (frame.description != null) existing.subject = frame.description;
        if (frame.summary != null) existing.description = frame.summary;
        if (frame.taskType != null) existing.taskType = frame.taskType;
        // Refresh the agent-identity fields when the re-fire frame carries them
        // (conditional merge: the server only forwards fields that are present, so
        // a field absent from the frame keeps its previous value). They join the
        // MainAgent's Agent tool_use for the real name.
        if (frame.toolUseId != null) existing.toolUseId = frame.toolUseId;
        if (AGENT_TASK_TYPES.has(frame.taskType) && typeof frame.prompt === 'string') {
          existing.promptSnippet = frame.prompt.slice(0, AGENT_PROMPT_SNIPPET_LEN);
        }
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
        // Agent-identity fields for the active-agents strip. toolUseId joins the
        // MainAgent's Agent/Task tool_use block (exact match) for the real
        // name/subagent_type; promptSnippet is the prompt-prefix fallback. Only
        // agent taskTypes carry a prompt worth retaining (bounded).
        toolUseId: frame.toolUseId != null ? frame.toolUseId : null,
        promptSnippet: (AGENT_TASK_TYPES.has(frame.taskType) && typeof frame.prompt === 'string')
          ? frame.prompt.slice(0, AGENT_PROMPT_SNIPPET_LEN)
          : null,
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
  _ownerKey = null;
  clearTaskStore();
}

/**
 * Reset for a VIEWED-workspace switch (review P2-1). The tracker only learns the
 * owner from the NEXT sdk-task frame, so on a switch to a workspace with no task
 * activity the previous workspace's checklist would otherwise linger on screen
 * indefinitely. AppBase calls this on channel activation in SDK mode so the HUD
 * clears immediately instead of waiting (possibly forever) for a new frame.
 * The new owner's first frame re-seeds the tracker via the owner-change branch.
 */
export function resetForView() {
  _tasks = new Map();
  _sessionId = null;
  _ownerKey = null;
  clearTaskStore();
}

/**
 * Reset on a session boundary WITHIN the same workspace (review: stale-strip).
 * /clear or an in-place resume/fork replaces the session but may emit no sdk-task
 * frame for a while; without a reset the previous session's in_progress agents
 * would linger in the store (strip never auto-hides, focus never clears). ChatView
 * calls this when sdk-session-state reports a sessionId different from the last one
 * it saw. The next sdk-task frame re-seeds via the owner/session-change branch.
 */
export function resetForSession() {
  _tasks = new Map();
  _sessionId = null;
  _ownerKey = null;
  clearTaskStore();
}

/**
 * Reconcile the tracker to the server's authoritative sdk-task table (WS reconnect
 * replay of `sdk-task-snapshot`). The live relay is delta-only — a frame lost in a
 * WS gap is unrecoverable from the stream alone — so on reconnect the server sends
 * its bounded table and the client REPLACES its view. This is the authoritative
 * source: it both resurrects tasks whose started-frame was missed AND (critically)
 * drops tasks the server no longer tracks (a lost terminal frame, or a session the
 * server switched away from), so the active-agents strip can no longer linger.
 *
 * Tasks with `skipTranscript === true` are ambient/housekeeping and excluded, same
 * as the live task_started path.
 *
 * @param {object} frame - { sessionId, cwd, instanceKey, tasks: Array<server task> }
 */
export function applySnapshot(frame) {
  if (!frame || typeof frame !== 'object' || !Array.isArray(frame.tasks)) return;
  const tasks = frame.tasks;
  const next = new Map();
  for (const t of tasks) {
    if (!t || t.taskId == null) continue;
    // Guard with `=== true` so a snapshot from an older server that lacks the
    // flag still seeds the task (absent ≠ ambient).
    if (t.skipTranscript === true) continue;
    const taskId = String(t.taskId);
    next.set(taskId, {
      taskId,
      subject: t.description ?? null,
      description: t.summary ?? null,
      activeForm: null,
      status: _mapStatus(t.status) || (t.terminal ? 'failed' : 'in_progress'),
      owner: null,
      teammateName: null,
      agentId: null,
      toolUseId: t.toolUseId != null ? t.toolUseId : null,
      promptSnippet: (AGENT_TASK_TYPES.has(t.taskType) && typeof t.promptSnippet === 'string')
        ? t.promptSnippet.slice(0, AGENT_PROMPT_SNIPPET_LEN)
        : null,
      taskType: t.taskType ?? null,
      createdAt: Date.now(),
      ...(t.usage ? { usage: t.usage } : {}),
    });
  }
  _tasks = next;
  if (frame.sessionId) _sessionId = frame.sessionId;
  // Adopt the snapshot's workspace ownership: the table it carries belongs to
  // this cwd/instanceKey, so the NEXT live frame from the same workspace must
  // not hit applyFrame's owner-change branch (a null/stale _ownerKey would wipe
  // everything just resurrected). A frame without owner info leaves it as-is.
  const owner = _frameOwner(frame);
  if (owner) _ownerKey = owner;
  _publish();
}

/** Test hook: restore pristine module state. */
export function __resetForTests() {
  clear();
}
