// Scheduled-task store — a single JSON file per cc-viewer data root.
//
// One GLOBAL file (`<LOG_DIR>/scheduled-tasks.json`), not one-per-project: the
// scheduler must enumerate and atomically claim across every project on each tick,
// which a single locked file makes one read; a per-project layout would need a
// readdir + N reads per tick and would silently drop tasks when a project dir is
// cleaned. The per-project binding lives INSIDE the task (`project` for UI/SSE
// routing, `cwd` for execution), not in the file location.
//
// Write path: mutateJson (json-store.js) — async cross-process file lock + tmp→rename
// atomic write. The lock is the SAME one multiple cc-viewer processes (Electron tabs,
// IM workers, parallel instances sharing LOG_DIR) contend on, so the claim/finalize
// read-modify-write below is the multi-process mutual-exclusion point. Execution
// always happens OUTSIDE the lock (the lock is never held across a run).
//
// Secret policy: prompts are user content (may carry secrets) → default 0600, NOT
// mode:false (review P2-3). strictCorrupt:true — a corrupt file is never overwritten
// back to empty; the route surfaces 500 store_corrupt instead.
//
// Boundary: L1-lib. Imports L1 (cron/schedule-model/json-store) + L0-leaf (pid-alive)
// + node builtins. Must NOT import L2 (pty-manager/sdk-manager/interceptor).

import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mutateJson } from './json-store.js';
import { isPidAlive } from './pid-alive.js';
import { normalizeSchedule, nextBaseFor, occurrencesAtOrBefore, jitterForTaskId } from './schedule-model.js';

const FILE_NAME = 'scheduled-tasks.json';
const VERSION = 1;
const MAX_TASKS_PER_PROJECT = 50;
const MAX_RUNS = 20;
const MAX_PROMPT_LEN = 20_000;
const SUMMARY_LEN = 200;
const CATCH_UP_WINDOW_MS = 7 * 24 * 3600 * 1000; // 7 days
// A claim whose owner pid is unreadable is reclaimed after this age (pid-reuse
// backstop). 2h comfortably covers the longest legit run (spawn 30min) — 25h would
// only prolong a wedged claim (review P2-2).
const STALE_CLAIM_MS = 2 * 3600 * 1000;
// Jitter applies only to recurring tasks and is capped at half the period so a
// `*/n` cron doesn't turn every fire into a late catch-up (review P2-9).
const JITTER_MAX_MS = 120_000;

export function tasksFilePath(root) { return join(root, FILE_NAME); }

/** Read the registry. Distinguishes "file absent" (empty, not corrupt) from "present but
 * unparseable" (corrupt:true) so a damaged store surfaces as an explicit flag instead of
 * silently showing zero tasks while writes 500 (review P2-3/P2-4). */
export function readScheduledTasks(root) {
  const file = tasksFilePath(root);
  if (!existsSync(file)) return { version: VERSION, tasks: [], corrupt: false };
  let data = null;
  try {
    data = JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return { version: VERSION, tasks: [], corrupt: true };
  }
  if (!data || typeof data !== 'object') return { version: VERSION, tasks: [], corrupt: true };
  const tasks = Array.isArray(data.tasks) ? data.tasks.filter(t => t && typeof t === 'object' && typeof t.id === 'string') : [];
  return { version: VERSION, tasks, corrupt: false };
}

function _nowDefault() { return Date.now(); }
function _newId(prefix) { return `${prefix}_${randomBytes(8).toString('hex')}`; }
function _summarize(prompt) {
  const s = String(prompt == null ? '' : prompt).replace(/\s+/g, ' ').trim();
  return s.length > SUMMARY_LEN ? `${s.slice(0, SUMMARY_LEN - 1)}…` : s;
}

function _computeNext(task, now) {
  const base = nextBaseFor(task.schedule, now);
  if (base === null) { task.nextBaseAt = null; task.nextRunAt = null; return; }
  task.nextBaseAt = base;
  // Jitter only for recurring tasks; once fires exactly at the chosen time.
  if (task.schedule.kind === 'once') {
    task.jitterMs = 0;
    task.nextRunAt = base;
  } else {
    // Recompute jitter when the schedule changed (cleared to undefined by updateTask), so a
    // high-frequency cron never inherits a long daily jitter (and vice-versa) — review P2-1.
    if (typeof task.jitterMs !== 'number') task.jitterMs = jitterForTaskId(task.id, _jitterCapFor(task.schedule));
    // Clamp to the CURRENT schedule's cap even for a pre-existing jitter (period changed).
    task.jitterMs = Math.min(task.jitterMs, _jitterCapFor(task.schedule));
    task.nextRunAt = base + task.jitterMs;
  }
}

// Cap jitter at half the (minimum) period so high-frequency crons stay sane. `* * * * *`
// (and any all-wildcard minute field) is a 60s period → 30s cap (review P1-6).
function _jitterCapFor(schedule) {
  if (schedule.kind === 'hourly') return Math.min(JITTER_MAX_MS, 30 * 60 * 1000 / 2);
  if (schedule.kind === 'cron') {
    const expr = schedule.expr || '';
    const minuteField = expr.trim().split(/\s+/)[0] || '*';
    if (minuteField === '*') return Math.min(JITTER_MAX_MS, 30 * 1000); // every minute
    const m = /^\*\/(\d+)$/.exec(minuteField);
    if (m) { const periodMs = Number(m[1]) * 60 * 1000; return Math.min(JITTER_MAX_MS, Math.floor(periodMs / 2)); }
  }
  return JITTER_MAX_MS;
}

/** Locked read-modify-write over the registry. */
export function mutateScheduledTasks(root, mutator) {
  return mutateJson(tasksFilePath(root), async (data) => {
    const reg = (data && Array.isArray(data.tasks)) ? data : { version: VERSION, tasks: [] };
    reg.version = VERSION;
    const r = await mutator(reg);
    return r === undefined ? reg : r;
  }, { pretty: true, strictCorrupt: true, fallback: { version: VERSION, tasks: [] } });
}

export function listTasks(root, project) {
  const { tasks } = readScheduledTasks(root);
  return project ? tasks.filter(t => t.project === project) : tasks;
}

export function getTask(root, id) {
  return readScheduledTasks(root).tasks.find(t => t.id === id) || null;
}

/**
 * Create a task. draft = { project, cwd, prompt, mode, schedule, enabled }.
 * Returns { ok:true, task } | { ok:false, reason }.
 */
export async function createTask(root, draft, now = _nowDefault()) {
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
      // Permission mode for unattended spawn runs (security P1-3): defaults to 'default'
      // (asks for approval) — a spawn task must NOT silently inherit a bypassPermissions
      // host. The task can opt into 'inherit' explicitly via the create form.
      permissionMode: draft.mode === 'spawn' ? (draft.permissionMode === 'inherit' ? 'inherit' : 'default') : undefined,
      enabled: draft.enabled !== false,
      jitterMs: undefined, // computed in _computeNext
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
      runs: [],
    };
    _computeNext(task, now);
    reg.tasks.push(task);
    return { ok: true, task };
  });
}

/**
 * Update prompt / mode / schedule / enabled. Recomputes next ONLY when schedule or
 * enabled changed (so a prompt edit doesn't reset the schedule). Never clobbers an
 * active claim. Pause/resume: resume does NOT catch up (active pause is deliberate);
 * it records a skipped/paused run and recomputes next from now.
 */
export async function updateTask(root, id, patch, now = _nowDefault()) {
  return mutateScheduledTasks(root, (reg) => {
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
      // once.at>=now+60s is only enforced when `at` itself changes (review P1-3 / P2-1):
      // the UI always sends the full schedule back on save, so a prompt edit on an
      // expired/about-to-fire once task would otherwise be rejected with once_in_past.
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
      if (!atUnchanged) delete task.jitterMs; // force jitter recompute on schedule change
      scheduleChanged = true;
    }
    if (patch.enabled !== undefined && patch.enabled !== task.enabled) {
      task.enabled = !!patch.enabled;
      enabledChanged = true;
      if (!task.enabled) {
        task.pausedAt = now;
      } else {
        // Resume: record the deliberate gap, do NOT back-fill.
        if (task.pausedAt != null) {
          const occ = occurrencesAtOrBefore(task.schedule, task.pausedAt, now);
          if (occ && occ.count > 0) {
            _pushRun(task, { status: 'skipped', reason: 'paused', at: now, finishedAt: now, missedCount: occ.count, catchUp: false, manual: false });
          }
        }
        task.pausedAt = null;
        task.completedAt = null; // resume a finished once task re-arms nothing (once stays done)
      }
    }
    if (scheduleChanged || (enabledChanged && task.enabled)) _computeNext(task, now);
    task.updatedAt = now;
    return { ok: true, task };
  });
}

/** Delete a task. An actively-claimed task can't be deleted (it would orphan a run). */
export async function deleteTask(root, id, now = _nowDefault()) {
  return mutateScheduledTasks(root, (reg) => {
    const idx = reg.tasks.findIndex(t => t.id === id);
    if (idx < 0) return { ok: false, reason: 'task_not_found' };
    const task = reg.tasks[idx];
    if (task.claim && isPidAlive(task.claim.pid) && (now - task.claim.at) < STALE_CLAIM_MS) {
      return { ok: false, reason: 'task_running' };
    }
    reg.tasks.splice(idx, 1);
    return { ok: true };
  });
}

/**
 * Atomically claim the NEXT fire of a task (the multi-process mutual-exclusion point).
 * The schedule is advanced (or the once-task completed) INSIDE the lock, so a crashing
 * executor never double-fires. Returns:
 *   { ok:false, reason } | { ok:true, action:'claimed', task, runId, manual, catchUp, missedCount }
 *   | { ok:true, action:'missed', task }
 */
export async function claimTask(root, id, now = _nowDefault(), { manual = false, instanceId = '' } = {}) {
  return mutateScheduledTasks(root, (reg) => {
    const task = reg.tasks.find(t => t.id === id);
    if (!task) return { ok: false, reason: 'not-found' };

    // A live claim blocks re-entry. A dead/expired one is reclaimed first.
    if (task.claim) {
      const alive = isPidAlive(task.claim.pid);
      const fresh = (now - task.claim.at) < STALE_CLAIM_MS;
      if (alive && fresh) return { ok: false, reason: 'running' };
      // Reclaim: the previous owner died mid-run → close it out as interrupted.
      _pushRun(task, { status: 'error', reason: 'interrupted', at: task.claim.at, finishedAt: now, catchUp: !!task.claim.catchUp, manual: !!task.claim.manual });
      task.claim = null;
    }

    const runId = _newId('run');
    if (manual) {
      // Run now: fire immediately without disturbing the schedule — but if the task
      // is already due (e.g. after downtime), advance next past the pending
      // occurrence so the scheduler doesn't immediately re-fire it (review P2-1).
      if (task.enabled && task.nextRunAt != null && task.nextRunAt <= now) _advancePastDue(task, now);
      task.claim = { runId, at: now, pid: process.pid, instanceId, manual: true, catchUp: false, missedCount: 0 };
      return { ok: true, action: 'claimed', task, runId, at: now, manual: true, catchUp: false, missedCount: 0 };
    }

    if (!task.enabled) return { ok: false, reason: 'disabled' };
    if (task.nextRunAt == null || now < task.nextRunAt) return { ok: false, reason: 'not-due' };

    if (task.schedule.kind === 'once') {
      const overdue = now - task.schedule.at;
      if (overdue > CATCH_UP_WINDOW_MS) {
        _pushRun(task, { status: 'missed', reason: 'stale', at: now, finishedAt: now });
        task.enabled = false; task.nextBaseAt = null; task.nextRunAt = null;
        return { ok: true, action: 'missed', task };
      }
      task.claim = { runId, at: now, pid: process.pid, instanceId, manual: false, catchUp: overdue > 0, missedCount: 0 };
      task.nextBaseAt = null; task.nextRunAt = null; // re-armed only by editing the schedule
      return { ok: true, action: 'claimed', task, runId, at: now, manual: false, catchUp: overdue > 0, missedCount: 0 };
    }

    // Recurring: how many fires did we miss since the last scheduled base?
    const occ = occurrencesAtOrBefore(task.schedule, task.nextBaseAt ?? now, now);
    if (!occ || occ.stale || (now - occ.latest) > CATCH_UP_WINDOW_MS) {
      // Even the most recent fire is beyond the catch-up window → skip entirely.
      _pushRun(task, { status: 'missed', reason: 'stale', at: now, finishedAt: now, missedCount: occ ? occ.count : 0 });
      _computeNext(task, now);
      return { ok: true, action: 'missed', task };
    }
    const missedCount = Math.max(0, occ.count - 1);
    task.claim = { runId, at: now, pid: process.pid, instanceId, manual: false, catchUp: occ.count > 1, missedCount };
    task.nextBaseAt = nextBaseFor(task.schedule, occ.latest);
    task.nextRunAt = task.nextBaseAt === null ? null : task.nextBaseAt + task.jitterMs;
    return { ok: true, action: 'claimed', task, runId, at: now, manual: false, catchUp: occ.count > 1, missedCount };
  });
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
 * Write the outcome of a claimed run. Lock-CAS: only clears the claim / appends the
 * run when the on-disk claim is STILL this runId (a reclaimed-then-rerun task belongs
 * to the newer claim; the stale finalize must not clobber it — review P2-1).
 */
export async function finalizeTask(root, id, claim, result, now = _nowDefault()) {
  return mutateScheduledTasks(root, (reg) => {
    const task = reg.tasks.find(t => t.id === id);
    if (!task) return { ok: false, reason: 'not-found' };
    if (!task.claim || task.claim.runId !== claim.runId) {
      return { ok: false, reason: 'claim-superseded' };
    }
    _pushRun(task, {
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
    });
    task.lastRunAt = now;
    task.lastResult = result.status;
    task.lastError = result.error ?? result.reason ?? null;
    if (task.schedule.kind === 'once') {
      // A once task completes ONLY on a real success (dispatched/completed). A skipped
      // (busy) or failed run is NOT a completion: it disables the task so it never fires
      // silently again, and completedAt stays null so the UI shows a failed/paused state
      // rather than "done" (review P1-2).
      if (result.status === 'dispatched' || result.status === 'completed') {
        task.completedAt = now;
      } else {
        task.enabled = false; // terminal for a one-shot task; the user can re-arm by editing
      }
    }
    task.claim = null;
    task.updatedAt = now;
    return { ok: true };
  });
}

/** Reclaim claims whose owner pid died (called at scheduler start). */
export async function sweepStaleClaims(root, now = _nowDefault(), { selfInstanceId = '' } = {}) {
  return mutateScheduledTasks(root, (reg) => {
    let swept = 0;
    for (const task of reg.tasks) {
      const c = task.claim;
      if (!c) continue;
      const ownerAlive = isPidAlive(c.pid);
      // Same pid but a DIFFERENT boot generation (Electron stop/start) → not ours anymore.
      const staleGeneration = c.pid === process.pid && selfInstanceId && c.instanceId && c.instanceId !== selfInstanceId;
      if (ownerAlive && !staleGeneration && (now - c.at) < STALE_CLAIM_MS) continue;
      _pushRun(task, { status: 'error', reason: 'interrupted', at: c.at, finishedAt: now, catchUp: !!c.catchUp, manual: !!c.manual });
      task.claim = null;
      swept += 1;
    }
    return { swept };
  });
}

function _pushRun(task, run) {
  task.runs = Array.isArray(task.runs) ? task.runs : [];
  task.runs.push({
    id: _newId('run'),
    summary: _summarize(task.prompt),
    ...run,
  });
  if (task.runs.length > MAX_RUNS) task.runs.splice(0, task.runs.length - MAX_RUNS);
}
