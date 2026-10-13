/**
 * task-state.js — in-memory reducer for the Claude Code task checklist.
 *
 * Per-workspace (2026-10): the checklist is bucketed by producer scope
 * ('' = the bound project — the legacy singleton bucket; a parallel workspace
 * gets its own bucket) so two concurrent claudes' task lists never clobber
 * each other over SSE. Within a bucket the original single-map semantics are
 * preserved: the main agent and its teammates share one list, cleared at
 * session boundaries.
 *
 * The bucket KEY is computed by the caller (server.js's hook-payload scope
 * resolver) — this module stays import-free (L1-lib, boundary gate) and never
 * sees pty-manager. Callers that pass no bucket get the legacy '' bucket, so
 * the single-workspace behavior is byte-identical.
 *
 * L1-lib: pure module, Node builtins only, no imports.
 */

/** @type {Map<string, {sessionId: string|null, tasks: Map<string, object>, lastUsedAt: number}>} */
const _buckets = new Map();
const _BUCKET_CAP = 16;

const VALID_STATUSES = new Set(['pending', 'in_progress', 'completed', 'deleted']);

function _normKey(bucket) {
  return (typeof bucket === 'string' && bucket) ? bucket : '';
}

/** Get (or create) one scope's bucket. LRU-capped; the '' bucket is never
 *  evicted (it is the legacy singleton view). */
function _bucketFor(bucket) {
  const k = _normKey(bucket);
  let b = _buckets.get(k);
  if (b) {
    _buckets.delete(k);
    _buckets.set(k, b);
    return b;
  }
  b = { sessionId: null, tasks: new Map(), lastUsedAt: Date.now() };
  _buckets.set(k, b);
  while (_buckets.size > _BUCKET_CAP) {
    let evicted = false;
    for (const [bk] of _buckets) {
      if (bk === '') continue; // never evict the bound bucket
      _buckets.delete(bk);
      evicted = true;
      break;
    }
    if (!evicted) break;
  }
  return b;
}

function _touch(task) {
  task.updatedAt = Date.now();
  return task;
}

/**
 * Apply one normalized task event (the camelCase envelope task-bridge.js
 * POSTs). Unknown/malformed payloads are ignored.
 * @param {object} payload
 * @param {string} [bucket] - producer scope key ('' = bound, the legacy view)
 */
export function applyTaskEvent(payload, bucket = '') {
  if (!payload || typeof payload !== 'object') return;
  const b = _bucketFor(bucket);
  b.lastUsedAt = Date.now();
  const { hookEventName } = payload;
  // New-prompt reset. MUST stay above the taskId guard (this event has no
  // task_id) and MUST NOT move the sessionId tag — a foreign/malformed prompt
  // event must not change the shouldResetTasks comparison base. resetTasks()
  // nulls the tag anyway, so the next TaskCreated re-tags the session.
  if (hookEventName === 'UserPromptSubmit') {
    if (shouldResetTasksOnPrompt(payload, b.sessionId)) resetTasks(bucket);
    return;
  }
  const taskId = payload.taskId != null ? String(payload.taskId) : null;
  // Validate BEFORE touching the session tag: a malformed/unknown event must
  // not move the shouldResetTasks comparison base.
  if (!taskId) return;
  if (payload.sessionId && !payload.agentId) b.sessionId = payload.sessionId;

  if (hookEventName === 'TaskCreated') {
    const existing = b.tasks.get(taskId);
    if (existing) {
      // Idempotent re-fire: keep the current status, refresh the text fields
      // and the teammate attribution (same field set as TaskCompleted).
      if (payload.taskSubject != null) existing.subject = payload.taskSubject;
      if (payload.taskDescription != null) existing.description = payload.taskDescription;
      if (payload.teammateName != null) existing.teammateName = payload.teammateName;
      _touch(existing);
      return;
    }
    b.tasks.set(taskId, _touch({
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
    const existing = b.tasks.get(taskId) || _stub(taskId, payload);
    if (!b.tasks.has(taskId)) b.tasks.set(taskId, existing);
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
      b.tasks.delete(taskId);
      return;
    }
    const existing = b.tasks.get(taskId) || _stub(taskId, payload);
    if (!b.tasks.has(taskId)) b.tasks.set(taskId, existing);
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

/** Clear ONE bucket's checklist (session boundary: startup/clear by main agent). */
export function resetTasks(bucket = '') {
  const b = _bucketFor(bucket);
  b.tasks.clear();
  b.sessionId = null;
}

/** Tear down every bucket (server stop/start cycles). */
export function resetAllTasks() {
  _buckets.clear();
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

/**
 * New-prompt reset gate (pure, unit-tested). Claude Code fires
 * UserPromptSubmit on every user prompt (queued-message drains included) with
 * NO task_id; the previous turn's checklist is stale by definition, so the
 * shared list resets and the model's next TaskUpdate rebuilds whatever it is
 * still working on (stub semantics).
 * Conservative guards: a teammate/subagent process inherits CCVIEWER_PORT and
 * POSTs to the same /api/task-event, so only a prompt bearing the session we
 * are already tracking may wipe the shared list. (agent_id is NOT reliably
 * present on this event — the session check is the load-bearing one.)
 * Known trade-off: while the tag is null (no main-agent task event seen yet,
 * e.g. right after a reset — teammate TaskCreated carries agentId and does not
 * re-tag), ANY prompt passes the gate. A teammate prompt in that window still
 * clears the list; it self-heals on the next TaskUpdate. See task-state.test.js
 * ("null-tag window") which locks this behavior deliberately.
 */
export function shouldResetTasksOnPrompt(payload, currentSessionId) {
  const { agentId, sessionId } = payload || {};
  if (agentId) return false;
  if (!sessionId) return false;
  if (currentSessionId && sessionId !== currentSessionId) return false;
  return true;
}

/** Full-snapshot view of ONE bucket for SSE broadcast; insertion order preserved. */
export function getTaskSnapshot(bucket = '') {
  const b = _bucketFor(bucket);
  return { sessionId: b.sessionId, tasks: [...b.tasks.values()] };
}

/** Test hook: restore pristine module state. */
export function __resetForTests() {
  resetAllTasks();
}
