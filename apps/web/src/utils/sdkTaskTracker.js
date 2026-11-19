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

import { publish as publishTaskUpdate, clearTasks as clearTaskStore, persistSnapshot as persistTaskSnapshot, restoreSnapshot as restoreTaskSnapshot, clearPersistedSnapshot } from './taskStore.js';
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
// Authoritative-epoch marker: set when applySnapshot applies a server snapshot
// (even an empty one), so restoreFromStorage can distinguish "no data yet"
// from "server authoritatively said empty" and skip the restore.
let _snapshotLanded = false;
let _snapshotSid = null;
// Restored-seed marker: set when restoreFromStorage seeds _tasks from a
// localStorage checkpoint. While set, the tracker's content is UNVERIFIED
// seed data, not live server data — so (a) the _publish it triggers must not
// persist (writing the seed straight back would be a no-op anyway, but a
// subsequent empty authoritative snapshot must not echo an empty write that
// destroys the checkpoint), and (b) an empty authoritative snapshot for the
// SAME session keeps the restored rows instead of wiping them (the user asked
// for refresh-survival: a refreshed panel keeps its last-known tasks rather
// than going blank the moment the server replays an already-drained table).
let _restoredSeed = false;

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

function _publish({ persist = true } = {}) {
  const tasks = [..._tasks.values()];
  publishTaskUpdate({ sessionId: _sessionId, tasks });
  // Debounce persistence: high-frequency task_progress frames would otherwise
  // trigger a synchronous localStorage write on every frame. Trailing 500ms
  // ensures the final state is persisted without hammering storage.
  // Seed publishes (from restoreFromStorage) skip persistence: they are not
  // live data, and persisting them risks an empty-authoritative-snapshot echo
  // wiping the very checkpoint the next refresh needs.
  if (persist) _schedulePersist();
}

let _persistTimer = null;
function _schedulePersist() {
  if (_persistTimer) clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => {
    _persistTimer = null;
    persistTaskSnapshot(_ownerKey);
  }, 500);
}
// Cancel any pending debounced persist. Called by the reset paths (clear /
// resetForSession / resetForView) so a trailing 500ms write scheduled just
// before the reset can't fire AFTER clearPersistedSnapshot and resurrect the
// very checkpoint the reset was supposed to delete.
function _cancelPersist() {
  if (_persistTimer) { clearTimeout(_persistTimer); _persistTimer = null; }
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

  // A live sdk-task frame means the server has real activity for this view —
  // the tracker is no longer running on a restored seed, so persistence resumes
  // (subsequent _publish calls persist normally). Placed after the owner/session
  // boundary resets above so a same-owner live frame merges into the seed.
  _restoredSeed = false;

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
        // Keep the original start stamp so the active-agents card's elapsed
        // clock doesn't reset on an idempotent re-fire.
        if (!Number.isFinite(existing.createdAt)) existing.createdAt = Date.now();
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
        // Agent-identity fields for the active-agents card. toolUseId joins the
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
  _cancelPersist();
  const oldSid = _sessionId;
  _tasks = new Map();
  _sessionId = null;
  _ownerKey = null;
  _snapshotLanded = false;
  _snapshotSid = null;
  _restoredSeed = false;
  clearTaskStore();
  if (oldSid) clearPersistedSnapshot(oldSid);
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
  _cancelPersist();
  _tasks = new Map();
  _sessionId = null;
  _ownerKey = null;
  _snapshotLanded = false;
  _snapshotSid = null;
  _restoredSeed = false;
  clearTaskStore();
  // Do NOT clearPersistedSnapshot here — a view switch is not a session death.
  // The persisted checkpoint survives so a future refresh of this workspace
  // can still restore it. Only resetForSession/clear (terminal boundaries)
  // delete the checkpoint.
}

/**
 * Reset on a session boundary WITHIN the same workspace (review: stale-card).
 * /clear or an in-place resume/fork replaces the session but may emit no sdk-task
 * frame for a while; without a reset the previous session's in_progress agents
 * would linger in the store (the card never auto-hides). ChatView calls this
 * when sdk-session-state reports a sessionId different from the last one it
 * saw. The next sdk-task frame re-seeds via the owner/session-change branch.
 */
export function resetForSession() {
  _cancelPersist();
  const oldSid = _sessionId;
  _tasks = new Map();
  _sessionId = null;
  _ownerKey = null;
  _snapshotLanded = false;
  _snapshotSid = null;
  _restoredSeed = false;
  clearTaskStore();
  if (oldSid) clearPersistedSnapshot(oldSid);
}

/**
 * Reconcile the tracker to the server's authoritative sdk-task table (WS reconnect
 * replay of `sdk-task-snapshot`). The live relay is delta-only — a frame lost in a
 * WS gap is unrecoverable from the stream alone — so on reconnect the server sends
 * its bounded table and the client REPLACES its view. This is the authoritative
 * source: it both resurrects tasks whose started-frame was missed AND (critically)
 * drops tasks the server no longer tracks (a lost terminal frame, or a session the
 * server switched away from), so the active-agents card can no longer linger.
 *
 * Tasks with `skipTranscript === true` are ambient/housekeeping and excluded, same
 * as the live task_started path.
 *
 * @param {object} frame - { sessionId, cwd, instanceKey, tasks: Array<server task> }
 */
export function applySnapshot(frame) {
  if (!frame || typeof frame !== 'object' || !Array.isArray(frame.tasks)) return;
  const tasks = frame.tasks;
  const snapSid = frame.sessionId || _sessionId || null;
  // Refresh-survival guard: when the panel was just seeded from a persisted
  // checkpoint and the server's authoritative table for the SAME session comes
  // back EMPTY, keep the restored rows instead of wiping the panel blank. A
  // browser refresh does not kill the SDK process, but its task table may
  // already have drained to terminal-and-cleared — and the user asked for the
  // last-known tasks to stay visible across refresh. A NON-empty snapshot is
  // still fully authoritative and reconciles normally (drops stale rows, etc).
  // The epoch markers are still recorded so a later restore() for this session
  // is correctly skipped (the server has now spoken). The seed set _sessionId
  // to the restored session, so the same-session check compares against that.
  if (_restoredSeed && tasks.length === 0 && snapSid && snapSid === _sessionId) {
    _snapshotLanded = true;
    _snapshotSid = snapSid;
    // Adopt owner so the next live frame doesn't hit the owner-change wipe.
    const owner = _frameOwner(frame);
    if (owner) _ownerKey = owner;
    return;
  }
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
      // Snapshot replay resets the client clock: createdAt is "when this client
      // first saw the task" and the server's table carries no start timestamp, so
      // after a WS reconnect the card's elapsed restarts here. Carry the live
      // lastToolName through, though, so the doing pill survives the replay.
      createdAt: Date.now(),
      ...(typeof t.lastToolName === 'string' ? { lastToolName: t.lastToolName } : {}),
      ...(t.usage ? { usage: t.usage } : {}),
    });
  }
  _tasks = next;
  if (frame.sessionId) _sessionId = frame.sessionId;
  // Mark that the server has spoken authoritatively for this view. This lets
  // restoreFromStorage distinguish "no data yet" from "server said empty".
  _snapshotLanded = true;
  _snapshotSid = frame.sessionId || _sessionId || null;
  // Adopt the snapshot's workspace ownership: the table it carries belongs to
  // this cwd/instanceKey, so the NEXT live frame from the same workspace must
  // not hit applyFrame's owner-change branch (a null/stale _ownerKey would wipe
  // everything just resurrected). A frame without owner info leaves it as-is.
  const owner = _frameOwner(frame);
  if (owner) _ownerKey = owner;
  // A non-empty (or different-session) authoritative snapshot supersedes any
  // restored seed — the tracker is live again, so persistence may resume.
  _restoredSeed = false;
  _publish();
}

/**
 * Restore the tracker from a localStorage-persisted snapshot (browser refresh).
 * Seeds _tasks and _sessionId so ActiveAgentsBar can render immediately,
 * then the next applySnapshot / applyFrame reconciles with live server data.
 *
 * Guard: one-shot seed-only. If the tracker already has live data (e.g. the
 * server snapshot landed before this restore), the restore is skipped to
 * avoid overwriting authoritative state with stale localStorage data.
 * Additionally, if the server has already sent an authoritative snapshot for
 * this session (even an empty one), the restore is skipped — the server's
 * word is final.
 * No-op if there is nothing valid to restore for the given sessionId.
 *
 * @param {string} sessionId - the current session to restore tasks for.
 */
export function restoreFromStorage(sessionId) {
  // Seed-only: never overwrite live/authoritative data. If the tracker already
  // holds an UNVERIFIED restored seed (_restoredSeed), its store copy may have
  // been wiped by a boot-time clearTaskStore() that ran while the async sdkMode
  // flag was still false — republish it (without persisting) so the panel
  // recovers instead of staying blank until the next live frame. A verified
  // (non-seed) population is left untouched: live data needs no republish.
  if (_tasks.size > 0) {
    if (_restoredSeed && (!_sessionId || _sessionId === sessionId)) _publish({ persist: false });
    return;
  }
  // Authoritative-epoch guard: if the server already sent a snapshot for this
  // session (even empty), don't resurrect stale localStorage data.
  if (_snapshotLanded && _snapshotSid === sessionId) return;
  if (!sessionId) return;
  const restored = restoreTaskSnapshot(sessionId);
  if (!restored) return;
  const next = new Map();
  for (const t of restored.tasks) {
    if (!t || t.taskId == null) continue;
    // Normalize restored tasks: apply the same status whitelist as publish()
    // so a corrupted/tampered entry can't render as a phantom active agent.
    const status = (t.status && ['pending', 'in_progress', 'completed', 'failed'].includes(t.status))
      ? t.status : 'pending';
    next.set(String(t.taskId), { ...t, taskId: String(t.taskId), status });
  }
  if (next.size === 0) return;
  _tasks = next;
  _sessionId = restored.sessionId;
  // Restore the workspace owner so the first live frame doesn't hit the
  // owner-change branch and wipe the just-restored tasks.
  _ownerKey = restored.ownerKey || null;
  // Mark as unverified seed: the upcoming authoritative snapshot decides whether
  // these rows stay (empty same-session snapshot keeps them; a non-empty one
  // reconciles and clears this flag). The seed publish must NOT persist —
  // writing it back is a no-op, but a following empty snapshot echoing an empty
  // write would destroy the checkpoint the next refresh needs.
  _restoredSeed = true;
  _publish({ persist: false });
}

/**
 * True when the tracker holds SDK-mode state for the current view (live tasks
 * or a restored seed). Used by AppBase to keep the hook-path SSE task_update /
 * boot clearTaskStore from wiping the SDK checklist during the window where the
 * async `sdkMode` flag is still false (browser-refresh hydration lag). PTY mode
 * never sets tracker state, so this is a safe boot-time gate.
 */
export function hasSdkState() {
  return _tasks.size > 0 || _sessionId != null;
}

/** Test hook: restore pristine module state (volatile only, preserves storage). */
export function __resetForTests() {
  _cancelPersist();
  _tasks = new Map();
  _sessionId = null;
  _ownerKey = null;
  _snapshotLanded = false;
  _snapshotSid = null;
  _restoredSeed = false;
  clearTaskStore();
}
