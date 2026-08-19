// Wire Format v2 — S8 conversion manager (resident-task supervision).
//
// Owns the single in-process conversion worker: start/stop/status for the
// routes, plus boot-time auto-resume — a state file left at 'running' or
// 'verifying' means the previous server died mid-conversion, so the task
// restarts itself until the project reaches 'done' (user decision: the
// migration is resident until complete). File-level checkpoints make the
// re-run safe and cheap (done files are skipped).

import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { readConvertState } from './convert.js';
import { _invalidate as _invalidateMigrationStatus } from './migrate-prompt.js';

let _running = null; // { project, logDir, worker, startedAt, progress }
let _lastError = null; // last worker-level failure (state file may lag on hard crashes)

export function isConvertRunning() {
  return !!_running;
}

/**
 * Start converting a project in a background worker.
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function startConvert(logDir, project) {
  if (!logDir || !project) return { ok: false, error: 'logDir/project required' };
  if (_running) return { ok: false, error: `conversion already running for project "${_running.project}"` };
  let worker;
  try {
    worker = new Worker(new URL('./convert-worker.js', import.meta.url));
  } catch (err) {
    return { ok: false, error: `failed to start worker: ${err.message}` };
  }
  _lastError = null;
  _running = { project, logDir, worker, startedAt: new Date().toISOString(), progress: null };
  worker.on('message', (msg) => {
    if (!msg || !_running || _running.worker !== worker) return;
    if (msg.type === 'progress') _running.progress = msg.progress;
    else if (msg.type === 'final') {
      if (msg.error) _lastError = msg.error;
      // A finished conversion immediately changes what migrationStatus returns
      // for this project — drop the memo so the next call re-scans.
      _invalidateMigrationStatus(_running.logDir, msg.project);
    }
  });
  worker.on('error', (err) => {
    _lastError = String(err && err.message || err);
    if (_running && _running.worker === worker) _running = null;
  });
  worker.on('exit', () => {
    if (_running && _running.worker === worker) _running = null;
  });
  worker.postMessage({ type: 'start', logDir, project });
  return { ok: true };
}

/** Request a graceful stop (checkpoints at a file/entry boundary). */
export function stopConvert() {
  if (!_running) return { ok: false, error: 'no conversion running' };
  try { _running.worker.postMessage({ type: 'stop' }); } catch { }
  return { ok: true };
}

/** Snapshot for GET /api/wire-v2-convert: in-memory liveness + on-disk state. */
export function convertStatus(logDir, project) {
  const state = project ? readConvertState(join(logDir, project)) : null;
  const runningHere = !!(_running && _running.project === project);
  return {
    running: runningHere,
    ...(runningHere && { startedAt: _running.startedAt, progress: _running.progress }),
    ...(_lastError && !runningHere && { lastWorkerError: _lastError }),
    state,
  };
}

/** Boot hook: resume a conversion the previous process left unfinished. */
export function maybeResumeConvert(logDir, project) {
  if (!logDir || !project || _running) return false;
  const state = readConvertState(join(logDir, project));
  if (!state || (state.status !== 'running' && state.status !== 'verifying')) return false;
  const res = startConvert(logDir, project);
  if (res.ok) console.error(`[CC Viewer] wire-v2 convert: resuming unfinished migration for "${project}"`);
  return res.ok;
}
