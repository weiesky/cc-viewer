// Scheduled-task scheduler — the timer that turns due tasks into runs.
//
// This is L1 pure logic: it never imports the SDK/PTY managers (L2) or the SSE
// plumbing (L3/server). server.js injects every capability via initScheduledTaskScheduler
// (the same shape as initChatQueue): getRoot / getMode / canExecute / execute / isReady /
// broadcast / report. That keeps the tick loop unit-testable with fakes.
//
// Multi-process model (review P0-1): several cc-viewer processes share one LOG_DIR
// (Electron tabs, IM workers, parallel instances). The scheduler only starts when the
// host process opts in (server.js gates on isCliMode && !CCV_IM_PLATFORM). On top of
// that, each tick filters due tasks through deps.canExecute(task) so a process only
// claims work it can actually run (an IM worker never has the user's resident session).
// The actual cross-process mutual exclusion is the store's claimTask file lock.
//
// Robustness (compliance P0): every async step is wrapped so a throwing store call
// (strictCorrupt / lock timeout) or executor surfaces through deps.report instead of
// becoming an unhandledRejection that would kill the whole ccv process under Node 22.

import { readScheduledTasks, claimTask, finalizeTask, sweepStaleClaims } from './scheduled-task-store.js';

const TICK_MS = 10_000;
const STARTUP_GRACE_MS = 20_000;      // let SDK/PTY come up before the first tick
const READY_WINDOW_MS = 5 * 60_000;   // beyond this, execute anyway (and record failures)
const SPAWN_PER_PROJECT = 1;
const SPAWN_GLOBAL = 2;

let _deps = null;
let _timer = null;
let _startedAt = 0;
let _ticking = false;
let _instanceId = '';
const _spawnInFlight = { total: 0, byProject: new Map() };

/**
 * Wire the scheduler's capabilities. Called once from server.js at start.
 * deps: {
 *   getRoot(): string,
 *   getMode(): { sdk:boolean },
 *   canExecute(task): boolean,           // process-level capability filter (P0-1)
 *   execute(task, claim): Promise<result>,
 *   isReady(): boolean,
 *   broadcast(project, payload): void,
 *   report(tag, err): void,
 * }
 */
export function initScheduledTaskScheduler(deps) {
  _deps = deps;
  _instanceId = `boot_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Idempotent start (server.js may re-run _doStart on stop/start cycles). */
export function startScheduledTaskScheduler() {
  if (!_deps || _timer) return;
  _startedAt = Date.now();
  // Reclaim any claims whose owner died while we were down (or a previous generation
  // of THIS pid left behind). Failures here must never block startup.
  const root = _safe(() => _deps.getRoot());
  if (root) {
    // Skip the sweep entirely in legacy read-only mode: the sweep would create the
    // `scheduledTasks` prefs key (tombstone) and hide the legacy set. Legacy claims are
    // never swept (the legacy file is never written) — they are display-neutralized at
    // the read boundary instead.
    const reg = _safe(() => readScheduledTasks(root));
    if (!reg || !reg.legacy) {
      // Defer past the current synchronous startup burst: auth handoff (saveAuthConfig)
      // and the credential migration run synchronously during _doStart, and the sync lock
      // flavor THROWS on reentry if our async prefs write is mid-flight (json-store
      // JSON_STORE_REENTRANT). setTimeout(0) keeps the sweep's lock off that path while
      // still running before the first 10s tick.
      setTimeout(() => {
        sweepStaleClaims(root, Date.now(), { selfInstanceId: _instanceId })
          .catch(err => _report('scheduler.sweep', err));
      }, 0).unref?.();
    }
  }
  _timer = setInterval(() => { _tick().catch(err => _report('scheduler.tick', err)); }, TICK_MS);
  if (typeof _timer.unref === 'function') _timer.unref();
}

/** Stop ticking and refuse new claims. In-flight runs finish on their own. */
export function stopScheduledTaskScheduler() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

/** Test seam: is the loop running? */
export function isSchedulerRunning() { return !!_timer; }

function _report(tag, err) {
  try { if (_deps && typeof _deps.report === 'function') _deps.report(tag, err); }
  catch { /* reporting must never throw */ }
}
function _safe(fn) { try { return fn(); } catch { return undefined; } }

// Fail-closed canExecute: a throwing/absent canExecute means "cannot execute" (claim
// nothing), and the throw is reported (diagnostic value, not a silent swallow).
function _canExecuteSafe(task) {
  if (!_deps || typeof _deps.canExecute !== 'function') return false;
  try { return _deps.canExecute(task) === true; }
  catch (err) { _report('scheduler.can-execute', err); return false; }
}

async function _tick(now = Date.now()) {
  if (!_deps || _ticking) return;
  _ticking = true;
  try {
    const root = _safe(() => _deps.getRoot());
    if (!root) return;
    // Startup grace: don't fire during the first seconds after boot while SDK/PTY
    // sessions are still coming up. After READY_WINDOW we execute regardless.
    const uptime = now - _startedAt;
    if (uptime < STARTUP_GRACE_MS) return;
    if (uptime < READY_WINDOW_MS) {
      const ready = _safe(() => _deps.isReady && _deps.isReady());
      if (!ready) return;
    }

    const reg = readScheduledTasks(root);
    if (reg.legacy) return; // read-only legacy fallback: writes can't resolve these ids
    const due = reg.tasks.filter(t =>
      t.enabled && t.nextRunAt != null && t.nextRunAt <= now &&
      // Process-level capability: only claim work THIS process can execute (P0-1).
      // Fail-CLOSED: a throwing canExecute must not let this process claim the task
      // (review: fail-open would let a PTY/IM process claim work it can't run).
      _canExecuteSafe(t),
    );
    for (const t of due) {
      let claim = null;
      try {
        claim = await claimTask(root, t.id, now, { manual: false, instanceId: _instanceId });
      } catch (err) {
        _report('scheduler.claim', err); // strictCorrupt / lock timeout → skip, don't crash
        continue;
      }
      if (!claim || !claim.ok) continue;
      if (claim.action === 'missed') {
        _broadcastRun(claim.task, { runId: null }, { status: 'missed', reason: 'stale' });
        continue;
      }
      // Fire-and-forget, but the promise is guarded so a rejection never escapes.
      _launch(root, claim.task, claim).catch(err => _report('scheduler.launch', err));
    }
  } finally {
    _ticking = false;
  }
}

async function _launch(root, task, claim) {
  // Broadcast a running marker so an open modal shows a spinner (review P2-3).
  _broadcastRun(task, claim, { status: 'running' });
  let result;
  if (task.mode === 'spawn' && _spawnAtCap(task.project)) {
    result = { status: 'skipped', reason: 'busy' };
  } else {
    if (task.mode === 'spawn') _incSpawn(task.project);
    try {
      result = await _deps.execute(task, claim);
    } catch (err) {
      _report('scheduler.execute', err);
      result = { status: task.mode === 'spawn' ? 'error' : 'failed', reason: 'internal', error: String(err?.message || err) };
    } finally {
      if (task.mode === 'spawn') _decSpawn(task.project);
    }
  }
  try {
    await finalizeTask(root, task.id, claim, result, Date.now());
  } catch (err) {
    _report('scheduler.finalize', err);
  }
  _broadcastRun(task, claim, result);
}

function _broadcastRun(task, claim, result) {
  try {
    if (!_deps || typeof _deps.broadcast !== 'function') return;
    _deps.broadcast(task.project, {
      type: 'task_run',
      project: task.project,
      taskId: task.id,
      runId: claim?.runId ?? null,
      mode: task.mode,
      status: result.status,
      reason: result.reason ?? null,
      summary: String(task.prompt || '').replace(/\s+/g, ' ').trim().slice(0, 200),
      sessionId: result.sessionId ?? null,
      error: result.error ?? null,
      catchUp: !!claim?.catchUp,
      manual: !!claim?.manual,
      at: Date.now(),
    });
  } catch (err) {
    _report('scheduler.broadcast', err);
  }
}

function _spawnAtCap(project) {
  if (_spawnInFlight.total >= SPAWN_GLOBAL) return true;
  return (_spawnInFlight.byProject.get(project) || 0) >= SPAWN_PER_PROJECT;
}
function _incSpawn(project) {
  _spawnInFlight.total += 1;
  _spawnInFlight.byProject.set(project, (_spawnInFlight.byProject.get(project) || 0) + 1);
}
function _decSpawn(project) {
  _spawnInFlight.total = Math.max(0, _spawnInFlight.total - 1);
  _spawnInFlight.byProject.set(project, Math.max(0, (_spawnInFlight.byProject.get(project) || 1) - 1));
}

/** Run a task immediately (Run now). Returns claimTask's claim or an error object. */
export async function runTaskNow(id, { manual = true } = {}) {
  if (!_deps) return { ok: false, reason: 'scheduler_unavailable' };
  if (!_timer) return { ok: false, reason: 'scheduler_unavailable' };
  const root = _safe(() => _deps.getRoot());
  if (!root) return { ok: false, reason: 'scheduler_unavailable' };
  const now = Date.now();
  let claim;
  try {
    claim = await claimTask(root, id, now, { manual, instanceId: _instanceId });
  } catch (err) {
    _report('scheduler.run-now.claim', err);
    return { ok: false, reason: 'store_corrupt' };
  }
  if (!claim || !claim.ok) return claim || { ok: false, reason: 'not-found' };
  if (claim.action === 'missed') {
    _broadcastRun(claim.task, { runId: null }, { status: 'missed', reason: 'stale' });
    return { ok: true, action: 'missed', runId: null };
  }
  _launch(root, claim.task, claim).catch(err => _report('scheduler.run-now.launch', err));
  return { ok: true, action: 'claimed', runId: claim.runId };
}

/** Expose the spawn availability flag for the routes' GET list. */
export function spawnAvailable() {
  try {
    const mode = _deps && _deps.getMode ? _deps.getMode() : null;
    return !!(mode && mode.sdk && _deps.getSpawnConfig && _deps.getSpawnConfig().available);
  } catch { return false; }
}

/** Test seam: reset module state (timers, in-flight counters). */
export function __resetSchedulerForTests() {
  stopScheduledTaskScheduler();
  _deps = null;
  _ticking = false;
  _startedAt = 0;
  _instanceId = '';
  _spawnInFlight.total = 0;
  _spawnInFlight.byProject.clear();
}

/** Test seam: drive one tick synchronously (bypasses the interval + startup grace). */
export async function __tickForTests(now = Date.now()) {
  _startedAt = 0; // neutralize the startup grace for a deterministic test tick
  await _tick(now);
}
