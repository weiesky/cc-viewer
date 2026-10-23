// Scheduled-task store — task definitions + scheduling state live in preferences.json
// (`scheduledTasks` key); run history lives in scheduled-task-runs.json.
//
// Why preferences.json: the task definition is user configuration, so it rides the same
// locked/atomic prefs file the rest of the user's config uses (one place to back up and
// maintain). Scheduling state (nextRunAt/claim/jitter) travels WITH the definition so the
// claim's cross-process mutual exclusion stays a single locked read-modify-write on
// `preferences.json.lock` — splitting state from definition would invite double-fires.
//
// Why runs are separate (scheduled-task-runs-store.js): history is expendable,
// append-mostly, and grows per task; keeping it out of prefs keeps every claim/finalize
// prefs rewrite small and lets history self-heal (tolerant) while the registry is strict.
//
// Corruption contract:
//   - prefs corrupt OR `scheduledTasks` present-but-malformed → corrupt:true on read, and
//     EVERY writer refuses (never silently erase tasks). strictCorrupt on the kernel guards
//     the whole prefs file; `_stateForWrite` adds the nested-shape guard.
//   - Other prefs writers stay tolerant by design; json-store now preserves the corrupt
//     bytes to `<file>.corrupt-<ts>` before any tolerant self-heal, so nothing is lost.
//
// Legacy fallback (one-directional, read-only): when prefs has NO `scheduledTasks` key and
// a legacy `<root>/scheduled-tasks.json` exists with ≥1 valid task, reads fall back to it
// (tasks exposed with `legacy:true`, claim hidden, runs stripped). NO writer may touch the
// legacy path — update/delete/claim/sweep pre-check `legacy` and refuse without writing;
// only createTask may create the `scheduledTasks` key (which then tombstones the legacy
// file forever). The feature is unreleased, so this branch is a courtesy display only.
//
// Secret policy: prompts are user content (may carry secrets) → prefs stays 0600 and the
// whole prefs file is denied to the raw file API / IM readers (file-access-policy.js).
//
// Boundary: L1-lib. Imports L1 (cron/schedule-model/json-store/scheduled-task-runs-store)
// + L0-leaf (pid-alive) + node builtins. Must NOT import L2 (pty-manager/sdk-manager/…).

import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mutateJson, readJsonStrict } from './json-store.js';
import { isPidAlive } from './pid-alive.js';
import { normalizeSchedule, nextBaseFor, occurrencesAtOrBefore, jitterForTaskId } from './schedule-model.js';
import { appendRuns, appendRun, deleteRunsForTask, findRunByClaimId } from './scheduled-task-runs-store.js';
import { reportSwallowed } from './error-report.js';

const LEGACY_FILE_NAME = 'scheduled-tasks.json';
const PREFS_FILE_NAME = 'preferences.json';
const VERSION = 1;
const MAX_TASKS_PER_PROJECT = 50;
const MAX_RUNS = 20;
const MAX_PROMPT_LEN = 20_000;
const SUMMARY_LEN = 200;
const CATCH_UP_WINDOW_MS = 7 * 24 * 3600 * 1000; // 7 days
// A claim whose owner pid is unreadable is reclaimed after this age (pid-reuse
// backstop). 2h comfortably covers the longest legit run (spawn 30min).
const STALE_CLAIM_MS = 2 * 3600 * 1000;
// Jitter applies only to recurring tasks and is capped at half the period so a
// `*/n` cron doesn't turn every fire into a late catch-up.
const JITTER_MAX_MS = 120_000;

export function prefsFilePath(root) { return join(root, PREFS_FILE_NAME); }
export function legacyTasksFilePath(root) { return join(root, LEGACY_FILE_NAME); }

// ─── read path ───────────────────────────────────────────────────────────────

let _legacyReported = false;

function _isValidTask(t) { return t && typeof t === 'object' && typeof t.id === 'string'; }

// Validate the nested scheduledTasks shape. Key ABSENT → null (legacy may apply).
// Present but wrong shape/version → 'corrupt' (never silently reset; never fall back to
// legacy, else a deliberately emptied registry could resurrect stale prompts).
function _tasksFromPrefs(prefs) {
  if (!Object.prototype.hasOwnProperty.call(prefs, 'scheduledTasks')) return null;
  const st = prefs.scheduledTasks;
  if (!st || typeof st !== 'object' || Array.isArray(st)) return 'corrupt';
  if (st.version !== VERSION) return 'corrupt';
  if (!Array.isArray(st.tasks)) return 'corrupt';
  return st.tasks.filter(_isValidTask);
}

// Strip fields that must never cross the read boundary: runs live in the runs file,
// claim stays internal-ish (routes derive `running` from it) but legacy claims are
// neutralized to avoid a permanently-stuck "running" display.
function _exposeTask(t, { neutralizeClaim = false } = {}) {
  const { runs, ...rest } = t;
  if (neutralizeClaim) rest.claim = null;
  return rest;
}

/** Read the registry. Never throws. */
export function readScheduledTasks(root) {
  const prefs = readJsonStrict(prefsFilePath(root));
  if (prefs.state === 'corrupt') return { version: VERSION, tasks: [], corrupt: true, legacy: false };
  if (prefs.state === 'ok') {
    const tasks = _tasksFromPrefs(prefs.data);
    if (tasks === 'corrupt') return { version: VERSION, tasks: [], corrupt: true, legacy: false };
    if (tasks !== null) return { version: VERSION, tasks: tasks.map(t => _exposeTask(t)), corrupt: false, legacy: false };
    // key absent → maybe legacy
  }
  // prefs missing entirely OR key absent: legacy fallback (read-only).
  const legacyFile = legacyTasksFilePath(root);
  if (existsSync(legacyFile)) {
    let data = null;
    try { data = JSON.parse(readFileSync(legacyFile, 'utf-8')); } catch { data = null; }
    const tasks = data && Array.isArray(data.tasks) ? data.tasks.filter(_isValidTask) : [];
    if (tasks.length > 0) {
      if (!_legacyReported) {
        _legacyReported = true;
        reportSwallowed('scheduled-task-store.legacy', new Error('legacy scheduled-tasks.json present; read-only fallback (never written)'));
      }
      return { version: VERSION, tasks: tasks.map(t => _exposeTask(t, { neutralizeClaim: true })), corrupt: false, legacy: true };
    }
  }
  return { version: VERSION, tasks: [], corrupt: false, legacy: false };
}

/** True when the registry is in legacy read-only mode (writers must refuse). */
function _isLegacy(root) { return readScheduledTasks(root).legacy === true; }

// ─── write path ──────────────────────────────────────────────────────────────

// Validate + seed the nested state for a write. Throws (never silently overwrites) when
// the key exists but is malformed.
function _stateForWrite(prefs) {
  if (!Object.prototype.hasOwnProperty.call(prefs, 'scheduledTasks')) {
    prefs.scheduledTasks = { version: VERSION, tasks: [] };
    return prefs.scheduledTasks;
  }
  const st = prefs.scheduledTasks;
  const valid = st && typeof st === 'object' && !Array.isArray(st) && st.version === VERSION && Array.isArray(st.tasks);
  if (!valid) {
    const err = new Error('scheduled-task-store: refusing to overwrite malformed preferences.json scheduledTasks');
    err.code = 'JSON_STORE_CORRUPT';
    reportSwallowed('scheduled-task-store.state-corrupt', err);
    throw err;
  }
  return st;
}

/**
 * Locked read-modify-write of the task registry inside preferences.json.
 * `mutator(reg)` runs synchronously (reg = { version, tasks }); it must NOT touch the
 * runs store or any other lock. Run records are returned via the shared `pendingRuns`
 * array pattern at each call site and flushed AFTER this resolves (lock order: prefs →
 * runs, except finalize which is runs → prefs; never nested).
 */
export function mutateScheduledTasks(root, mutator) {
  return mutateJson(prefsFilePath(root), async (prefs) => {
    const reg = _stateForWrite(prefs);
    reg.version = VERSION;
    const r = await mutator(reg);
    return r === undefined ? reg : r;
  }, { mode: 0o600, pretty: true, strictCorrupt: true, fallback: {} });
}

function _newId(prefix) { return `${prefix}_${randomBytes(8).toString('hex')}`; }
function _summarize(prompt) {
  const s = String(prompt == null ? '' : prompt).replace(/\s+/g, ' ').trim();
  return s.length > SUMMARY_LEN ? `${s.slice(0, SUMMARY_LEN - 1)}…` : s;
}

function _makeRun(task, fields) {
  return { id: _newId('run'), summary: _summarize(task.prompt), ...fields };
}

// History is best-effort: a flush failure is reported but never fails the state change
// that produced it. (finalizeTask is the exception — see its own contract.)
async function _flushRuns(root, entries) {
  if (!entries || entries.length === 0) return;
  try { await appendRuns(root, entries); }
  catch (err) { reportSwallowed('scheduled-task-store.runs-flush', err); }
}

function _computeNext(task, now) {
  const base = nextBaseFor(task.schedule, now);
  if (base === null) { task.nextBaseAt = null; task.nextRunAt = null; return; }
  task.nextBaseAt = base;
  if (task.schedule.kind === 'once') {
    task.jitterMs = 0;
    task.nextRunAt = base;
  } else {
    if (typeof task.jitterMs !== 'number') task.jitterMs = jitterForTaskId(task.id, _jitterCapFor(task.schedule));
    task.jitterMs = Math.min(task.jitterMs, _jitterCapFor(task.schedule));
    task.nextRunAt = base + task.jitterMs;
  }
}

function _jitterCapFor(schedule) {
  if (schedule.kind === 'hourly') return Math.min(JITTER_MAX_MS, 30 * 60 * 1000 / 2);
  if (schedule.kind === 'cron') {
    const expr = schedule.expr || '';
    const minuteField = expr.trim().split(/\s+/)[0] || '*';
    if (minuteField === '*') return Math.min(JITTER_MAX_MS, 30 * 1000);
    const m = /^\*\/(\d+)$/.exec(minuteField);
    if (m) { const periodMs = Number(m[1]) * 60 * 1000; return Math.min(JITTER_MAX_MS, Math.floor(periodMs / 2)); }
  }
  return JITTER_MAX_MS;
}

// ─── public CRUD / scheduler primitives ─────────────────────────────────────

export function listTasks(root, project) {
  const { tasks } = readScheduledTasks(root);
  return project ? tasks.filter(t => t.project === project) : tasks;
}

export function getTask(root, id) {
  return readScheduledTasks(root).tasks.find(t => t.id === id) || null;
}

/**
 * Create a task. draft = { project, cwd, prompt, mode, schedule, enabled }.
 * The ONLY writer allowed to create the `scheduledTasks` prefs key (legacy tombstone).
 */
export async function createTask(root, draft, now = Date.now()) {
  const norm = normalizeSchedule(draft.schedule, now);
  if (!norm.ok) return { ok: false, reason: norm.error, detail: norm.detail };
  const prompt = String(draft.prompt == null ? '' : draft.prompt).trim();
  if (!prompt) return { ok: false, reason: 'invalid_prompt' };
  if (prompt.length > MAX_PROMPT_LEN) return { ok: false, reason: 'invalid_prompt', detail: 'too long' };
  if (draft.mode !== 'inject' && draft.mode !== 'spawn') return { ok: false, reason: 'invalid_mode' };

  return mutateScheduledTasks(root, (reg) => {
    const sameProject = reg.tasks.filter(t => t.project === draft.project);
    if (sameProject.length >= MAX_TASKS_PER_PROJECT) return { ok: false, reason: 'task_limit' };
    const task = {
      id: _newId('st'),
      project: draft.project,
      cwd: draft.cwd,
      prompt,
      mode: draft.mode,
      schedule: norm.schedule,
      permissionMode: draft.mode === 'spawn' ? (draft.permissionMode === 'inherit' ? 'inherit' : 'default') : undefined,
      enabled: draft.enabled !== false,
      jitterMs: undefined,
      nextBaseAt: null,
      nextRunAt: null,
      lastRunAt: null,
      lastResult: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
      pausedAt: null,
      completedAt: null,
      claim: null,
    };
    _computeNext(task, now);
    reg.tasks.push(task);
    return { ok: true, task };
  });
}

/**
 * Update prompt / mode / schedule / enabled. Recomputes next ONLY when schedule or
 * enabled changed. Never clobbers an active claim. Resume does NOT catch up; it records
 * a skipped/paused run (flushed to the runs file after the prefs write).
 */
export async function updateTask(root, id, patch, now = Date.now()) {
  if (_isLegacy(root)) return { ok: false, reason: 'task_not_found' };
  const pendingRuns = [];
  const out = await mutateScheduledTasks(root, (reg) => {
    const task = reg.tasks.find(t => t.id === id);
    if (!task) return { ok: false, reason: 'task_not_found' };
    let scheduleChanged = false;
    let enabledChanged = false;

    if (patch.prompt !== undefined) {
      const prompt = String(patch.prompt).trim();
      if (!prompt || prompt.length > MAX_PROMPT_LEN) return { ok: false, reason: 'invalid_prompt' };
      task.prompt = prompt;
    }
    if (patch.mode !== undefined) {
      if (patch.mode !== 'inject' && patch.mode !== 'spawn') return { ok: false, reason: 'invalid_mode' };
      task.mode = patch.mode;
    }
    if (patch.schedule !== undefined) {
      // once.at>=now+60s is only enforced when `at` itself changes: the UI always sends the
      // full schedule back on save, so a prompt edit on an expired once task would otherwise
      // be rejected with once_in_past.
      const atUnchanged = patch.schedule && patch.schedule.kind === 'once'
        && task.schedule && task.schedule.kind === 'once'
        && Number(patch.schedule.at) === Number(task.schedule.at);
      const norm = normalizeSchedule(patch.schedule, now);
      if (!norm.ok) {
        if (!(atUnchanged && norm.error === 'once_in_past')) {
          return { ok: false, reason: norm.error, detail: norm.detail };
        }
      }
      task.schedule = atUnchanged ? task.schedule : norm.schedule;
      if (!atUnchanged) delete task.jitterMs;
      scheduleChanged = true;
    }
    if (patch.enabled !== undefined && patch.enabled !== task.enabled) {
      task.enabled = !!patch.enabled;
      enabledChanged = true;
      if (!task.enabled) {
        task.pausedAt = now;
      } else {
        if (task.pausedAt != null) {
          const occ = occurrencesAtOrBefore(task.schedule, task.pausedAt, now);
          if (occ && occ.count > 0) {
            pendingRuns.push({ taskId: task.id, run: _makeRun(task, { status: 'skipped', reason: 'paused', at: now, finishedAt: now, missedCount: occ.count, catchUp: false, manual: false }) });
          }
        }
        task.pausedAt = null;
        task.completedAt = null;
      }
    }
    if (scheduleChanged || (enabledChanged && task.enabled)) _computeNext(task, now);
    task.updatedAt = now;
    return { ok: true, task };
  });
  await _flushRuns(root, pendingRuns);
  return out;
}

/** Delete a task (and its history). An actively-claimed task can't be deleted. */
export async function deleteTask(root, id, now = Date.now()) {
  if (_isLegacy(root)) return { ok: false, reason: 'task_not_found' };
  const out = await mutateScheduledTasks(root, (reg) => {
    const idx = reg.tasks.findIndex(t => t.id === id);
    if (idx < 0) return { ok: false, reason: 'task_not_found' };
    const task = reg.tasks[idx];
    if (task.claim && isPidAlive(task.claim.pid) && (now - task.claim.at) < STALE_CLAIM_MS) {
      return { ok: false, reason: 'task_running' };
    }
    reg.tasks.splice(idx, 1);
    return { ok: true };
  });
  if (out && out.ok) {
    try { await deleteRunsForTask(root, id); }
    catch (err) { reportSwallowed('scheduled-task-store.runs-delete', err); }
  }
  return out;
}

/**
 * Reclaim a dead/expired claim inside the prefs lock. If the runs file already holds a
 * terminal run for this claimRunId (finalize appended but crashed before the CAS), the
 * once-task restores its terminal state instead of recording a misleading 'interrupted'.
 * Returns true when the claim was reclaimed.
 */
function _reclaimClaim(root, task, now, pendingRuns) {
  const c = task.claim;
  if (!c) return false;
  // Does the runs file already know how this claim ended?
  let terminal = null;
  try { terminal = findRunByClaimId(root, task.id, c.runId); }
  catch (err) { reportSwallowed('scheduled-task-store.reclaim-lookup', err); }
  if (terminal && task.schedule.kind === 'once') {
    // Finalize landed but the CAS crashed: restore the terminal state, don't re-mark.
    task.lastRunAt = terminal.finishedAt || now;
    task.lastResult = terminal.status;
    task.lastError = terminal.error ?? terminal.reason ?? null;
    if (terminal.status === 'dispatched' || terminal.status === 'completed') task.completedAt = terminal.finishedAt || now;
    else task.enabled = false;
    task.claim = null;
    return true;
  }
  pendingRuns.push({ taskId: task.id, run: _makeRun(task, { status: 'error', reason: 'interrupted', at: c.at, finishedAt: now, catchUp: !!c.catchUp, manual: !!c.manual, claimRunId: c.runId }) });
  task.claim = null;
  return true;
}

/**
 * Atomically claim the NEXT fire of a task (the multi-process mutual-exclusion point).
 * The schedule is advanced (or the once-task completed) INSIDE the prefs lock, so a
 * crashing executor never double-fires.
 */
export async function claimTask(root, id, now = Date.now(), { manual = false, instanceId = '' } = {}) {
  if (_isLegacy(root)) return { ok: false, reason: 'not-found' };
  const pendingRuns = [];
  const out = await mutateScheduledTasks(root, (reg) => {
    const task = reg.tasks.find(t => t.id === id);
    if (!task) return { ok: false, reason: 'not-found' };

    if (task.claim) {
      const alive = isPidAlive(task.claim.pid);
      const fresh = (now - task.claim.at) < STALE_CLAIM_MS;
      if (alive && fresh) return { ok: false, reason: 'running' };
      _reclaimClaim(root, task, now, pendingRuns);
    }

    const runId = _newId('run');
    if (manual) {
      if (task.enabled && task.nextRunAt != null && task.nextRunAt <= now) _advancePastDue(task, now);
      task.claim = { runId, at: now, pid: process.pid, instanceId, manual: true, catchUp: false, missedCount: 0 };
      return { ok: true, action: 'claimed', task, runId, at: now, manual: true, catchUp: false, missedCount: 0 };
    }

    if (!task.enabled) return { ok: false, reason: 'disabled' };
    if (task.nextRunAt == null || now < task.nextRunAt) return { ok: false, reason: 'not-due' };

    if (task.schedule.kind === 'once') {
      const overdue = now - task.schedule.at;
      if (overdue > CATCH_UP_WINDOW_MS) {
        pendingRuns.push({ taskId: task.id, run: _makeRun(task, { status: 'missed', reason: 'stale', at: now, finishedAt: now, claimRunId: runId }) });
        task.enabled = false; task.nextBaseAt = null; task.nextRunAt = null;
        return { ok: true, action: 'missed', task };
      }
      task.claim = { runId, at: now, pid: process.pid, instanceId, manual: false, catchUp: overdue > 0, missedCount: 0 };
      task.nextBaseAt = null; task.nextRunAt = null;
      return { ok: true, action: 'claimed', task, runId, at: now, manual: false, catchUp: overdue > 0, missedCount: 0 };
    }

    const occ = occurrencesAtOrBefore(task.schedule, task.nextBaseAt ?? now, now);
    if (!occ || occ.stale || (now - occ.latest) > CATCH_UP_WINDOW_MS) {
      pendingRuns.push({ taskId: task.id, run: _makeRun(task, { status: 'missed', reason: 'stale', at: now, finishedAt: now, missedCount: occ ? occ.count : 0, claimRunId: runId }) });
      _computeNext(task, now);
      return { ok: true, action: 'missed', task };
    }
    const missedCount = Math.max(0, occ.count - 1);
    task.claim = { runId, at: now, pid: process.pid, instanceId, manual: false, catchUp: occ.count > 1, missedCount };
    task.nextBaseAt = nextBaseFor(task.schedule, occ.latest);
    task.nextRunAt = task.nextBaseAt === null ? null : task.nextBaseAt + task.jitterMs;
    return { ok: true, action: 'claimed', task, runId, at: now, manual: false, catchUp: occ.count > 1, missedCount };
  });
  await _flushRuns(root, pendingRuns);
  return out;
}

// Advance a due recurring task's schedule past the pending occurrence (used by manual run).
function _advancePastDue(task, now) {
  if (task.schedule.kind === 'once') { task.nextBaseAt = null; task.nextRunAt = null; return; }
  const occ = occurrencesAtOrBefore(task.schedule, task.nextBaseAt ?? now, now);
  const anchor = occ && !occ.stale ? occ.latest : now;
  task.nextBaseAt = nextBaseFor(task.schedule, anchor);
  task.nextRunAt = task.nextBaseAt === null ? null : task.nextBaseAt + (task.jitterMs || 0);
}

/**
 * Write the outcome of a claimed run. Ordering is runs-first, then the prefs CAS:
 *   - append fails  → claim is NOT released (returns runs_unavailable); the stale sweep /
 *     next claim's reclaim restores the terminal state from the runs file (once) or marks
 *     interrupted (recurring). A completed run is never silently dropped while the claim
 *     is cleared underneath it.
 *   - CAS fails     → the run is already recorded (orphan, accepted + reported); the newer
 *     claim is not touched.
 * claimRunId makes a later reclaim/retry idempotent.
 */
export async function finalizeTask(root, id, claim, result, now = Date.now()) {
  if (_isLegacy(root)) return { ok: false, reason: 'not-found' };
  // Pre-check (unlocked): known-stale finalizes append nothing.
  const cur = getTask(root, id);
  if (!cur) return { ok: false, reason: 'not-found' };
  if (!cur.claim || cur.claim.runId !== claim.runId) return { ok: false, reason: 'claim-superseded' };

  const run = _makeRun(cur, {
    status: result.status,
    reason: result.reason ?? null,
    error: result.error ?? null,
    at: claim.at,
    finishedAt: now,
    durationMs: result.durationMs ?? (now - claim.at),
    catchUp: !!claim.catchUp,
    missedCount: claim.missedCount || 0,
    manual: !!claim.manual,
    sessionId: result.sessionId ?? null,
    claimRunId: claim.runId,
  });
  try {
    await appendRun(root, id, run);
  } catch (err) {
    reportSwallowed('scheduled-task-store.finalize-run', err);
    return { ok: false, reason: 'runs_unavailable' };
  }

  return mutateScheduledTasks(root, (reg) => {
    const task = reg.tasks.find(t => t.id === id);
    if (!task) return { ok: false, reason: 'not-found' };
    if (!task.claim || task.claim.runId !== claim.runId) {
      // The run is already in the history file — orphan is the accepted cost of runs-first.
      reportSwallowed('scheduled-task-store.finalize-superseded-after-run', new Error(`run recorded but claim superseded for task ${id}`));
      return { ok: false, reason: 'claim-superseded' };
    }
    task.lastRunAt = now;
    task.lastResult = result.status;
    task.lastError = result.error ?? result.reason ?? null;
    if (task.schedule.kind === 'once') {
      // A once task completes ONLY on a real success; a skipped/failed run disables it
      // (terminal) so it never fires silently again.
      if (result.status === 'dispatched' || result.status === 'completed') {
        task.completedAt = now;
      } else {
        task.enabled = false;
      }
    }
    task.claim = null;
    task.updatedAt = now;
    return { ok: true };
  });
}

/** Reclaim claims whose owner pid died (called at scheduler start). */
export async function sweepStaleClaims(root, now = Date.now(), { selfInstanceId = '' } = {}) {
  if (_isLegacy(root)) return { swept: 0 };
  const pendingRuns = [];
  const out = await mutateScheduledTasks(root, (reg) => {
    let swept = 0;
    for (const task of reg.tasks) {
      const c = task.claim;
      if (!c) continue;
      const ownerAlive = isPidAlive(c.pid);
      const staleGeneration = c.pid === process.pid && selfInstanceId && c.instanceId && c.instanceId !== selfInstanceId;
      if (ownerAlive && !staleGeneration && (now - c.at) < STALE_CLAIM_MS) continue;
      _reclaimClaim(root, task, now, pendingRuns);
      swept += 1;
    }
    return { swept };
  });
  await _flushRuns(root, pendingRuns);
  return out;
}
