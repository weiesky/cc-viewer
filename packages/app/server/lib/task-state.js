/**
 * task-state.js — in-memory reducer for the Claude Code task checklist.
 *
 * Maintains the single shared checklist of the session this cc-viewer process
 * hosts (fed by task-bridge.js via POST /api/task-event → deps.onTaskEvent).
 * The checklist is deliberately ONE map, not per-session: the main agent and
 * its teammates share the same task list in Claude Code, and each cc-viewer
 * server process only receives hooks from its own claude child tree
 * (CCVIEWER_PORT is injected per child). Cross-session leftovers are cleared
 * by resetTasks() on session boundaries (startup/clear from the MAIN agent —
 * see server.js onTaskSessionBoundary, which skips subagent events via
 * agentId).
 *
 * L1-lib: pure module, Node builtins only, no imports.
 */

/** @type {string|null} last seen main session id (SSE tagging only) */
let _sessionId = null;
/** @type {Map<string, object>} insertion order = stable display order */
const _tasks = new Map();

const VALID_STATUSES = new Set(['pending', 'in_progress', 'completed', 'deleted']);

function _touch(task) {
  task.updatedAt = Date.now();
  return task;
}

/**
 * Apply one normalized task event (the camelCase envelope task-bridge.js
 * POSTs). Unknown/malformed payloads are ignored.
 * @param {object} payload
 */
export function applyTaskEvent(payload) {
  if (!payload || typeof payload !== 'object') return;
  const { hookEventName } = payload;
  const taskId = payload.taskId != null ? String(payload.taskId) : null;
  // Validate BEFORE touching the session tag: a malformed/unknown event must
  // not move the shouldResetTasks comparison base.
  if (!taskId) return;
  if (payload.sessionId && !payload.agentId) _sessionId = payload.sessionId;

  if (hookEventName === 'TaskCreated') {
    const existing = _tasks.get(taskId);
    if (existing) {
      // Idempotent re-fire: keep the current status, refresh the text fields
      // and the teammate attribution (same field set as TaskCompleted).
      if (payload.taskSubject != null) existing.subject = payload.taskSubject;
      if (payload.taskDescription != null) existing.description = payload.taskDescription;
      if (payload.teammateName != null) existing.teammateName = payload.teammateName;
      _touch(existing);
      return;
    }
    _tasks.set(taskId, _touch({
      taskId,
      subject: payload.taskSubject ?? null,
      description: payload.taskDescription ?? null,
      activeForm: null,
      status: 'pending',
      owner: null,
      teammateName: payload.teammateName ?? null,
      agentId: payload.agentId ?? null,
      createdAt: Date.now(),
    }));
    return;
  }

  if (hookEventName === 'TaskCompleted') {
    const existing = _tasks.get(taskId) || _stub(taskId, payload);
    if (!_tasks.has(taskId)) _tasks.set(taskId, existing);
    existing.status = 'completed';
    if (payload.taskSubject != null) existing.subject = payload.taskSubject;
    if (payload.taskDescription != null) existing.description = payload.taskDescription;
    if (payload.teammateName != null) existing.teammateName = payload.teammateName;
    _touch(existing);
    return;
  }

  if (hookEventName === 'PostToolUse' && payload.toolName === 'TaskUpdate') {
    const status = VALID_STATUSES.has(payload.status) ? payload.status : null;
    if (status === 'deleted') {
      _tasks.delete(taskId);
      return;
    }
    const existing = _tasks.get(taskId) || _stub(taskId, payload);
    if (!_tasks.has(taskId)) _tasks.set(taskId, existing);
    // Patch only the fields present in the event; a TaskUpdate may carry any
    // subset (status flips, renames, owner claims). Re-opening a completed
    // task (completed → in_progress → pending) is valid and passed through.
    if (status) existing.status = status;
    if (payload.taskSubject != null) existing.subject = payload.taskSubject;
    if (payload.taskDescription != null) existing.description = payload.taskDescription;
    if (payload.activeForm != null) existing.activeForm = payload.activeForm;
    if (payload.owner != null) existing.owner = payload.owner;
    if (payload.teammateName != null) existing.teammateName = payload.teammateName;
    if (payload.agentId != null) existing.agentId = payload.agentId;
    _touch(existing);
    return;
  }
  // Unknown events (e.g. future Task* hooks) are ignored by design.
}

// Stub entry for updates that reference a task created before cc-viewer (or
// the hook chain) started watching — the frontend renders a placeholder.
function _stub(taskId, payload) {
  return _touch({
    taskId,
    subject: payload.taskSubject ?? null,
    description: payload.taskDescription ?? null,
    activeForm: payload.activeForm ?? null,
    status: 'pending',
    owner: payload.owner ?? null,
    teammateName: payload.teammateName ?? null,
    agentId: payload.agentId ?? null,
    createdAt: Date.now(),
  });
}

/** Clear the whole checklist (session boundary: startup/clear by main agent). */
export function resetTasks() {
  _tasks.clear();
  _sessionId = null;
}

/**
 * Session-boundary gate (pure, unit-tested): the shared checklist resets on
 * main-agent startup/clear, and on resume/fork to a DIFFERENT session (an
 * in-terminal /resume switches conversations — old tasks must not mix into
 * the resumed one; resuming the SAME session keeps the list). Subagent/
 * teammate processes inherit CCVIEWER_PORT and fire their own SessionStart
 * 'startup' events — those are identified by payload.agentId and must NOT
 * wipe the shared list.
 */
export function shouldResetTasks(payload, currentSessionId) {
  const { source, agentId, sessionId } = payload || {};
  if (agentId) return false;
  if (source === 'startup' || source === 'clear') return true;
  if ((source === 'resume' || source === 'fork') && sessionId && sessionId !== currentSessionId) return true;
  return false;
}

/** Full-snapshot view for SSE broadcast; insertion order preserved. */
export function getTaskSnapshot() {
  return { sessionId: _sessionId, tasks: [..._tasks.values()] };
}

/** Test hook: restore pristine module state. */
export function __resetForTests() {
  resetTasks();
}
