// Unified JSON store kernel — one locked + atomic read/write path per config file.
//
// cc-viewer historically copy-pasted the same "read → mutate → tmp→rename" block across
// prefs-store / auth / im-config / workspace-registry / ask-store / session-pin-store, with
// divergent lock and permission handling (and a few writers that were neither locked nor
// atomic — see lib/im/im-config.js). This module extracts that pattern ONCE so the lock and
// the 0600 policy live in a single place. It is the prerequisite for any consistent local
// state (and, later, for cloud sync): a file cannot be projected or compared unless every
// writer goes through the same locked, atomic path.
//
// Boundary: L1-lib. Imports only node builtins + the two L0-leaf primitives
// (file-api.renameSyncWithRetry, async-file-lock.withFileLockAsync) + @ccv/core/error-report.
// It deliberately does NOT import LOG_DIR — callers inject the file path so the kernel stays
// a pure, reusable primitive with no data-root coupling.
//
// Two lock flavors are provided because callers split into two camps:
//   - mutateJson      — async lock (withFileLockAsync), for async mutators.
//   - mutateJsonSync  — synchronous spin lock (openSync('wx')), for the many existing SYNC
//                       writers (auth.js, im-config.js) that cannot become async without
//                       cascading signature changes through routes and server startup.
// Both serialize same-process callers and mutex cross-process on the same `${file}.lock`.
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, unlinkSync, openSync, closeSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { renameSyncWithRetry } from './file-api.js';
import { withFileLockAsync, hasLiveDiskHolder } from './async-file-lock.js';
import { reportSwallowed } from '@ccv/core/error-report';

/** Lock file lives next to the data file, derived from ITS name (not a fixed basename), so two
 *  different files in the same directory never share a lock by accident. */
export function lockPathFor(file) { return `${file}.lock`; }

/**
 * Tolerant JSON read. Missing / corrupt / non-object (when fallback is a plain object) → fallback.
 * Arrays are accepted when the fallback is an array; a scalar never satisfies an object fallback.
 */
export function readJsonSafe(file, fallback = {}) {
  try {
    if (!existsSync(file)) return fallback;
    const obj = JSON.parse(readFileSync(file, 'utf-8'));
    if (obj === null || typeof obj !== 'object') return fallback;
    // Shape guard: an array fallback accepts only an array; a plain-object fallback rejects one.
    if (Array.isArray(fallback) !== Array.isArray(obj)) return fallback;
    return obj;
  } catch {
    return fallback;
  }
}

// Sentinel for "file exists but cannot be read/parsed". A MUTATE path can choose how to treat it:
//   - DEFAULT (tolerant): collapse to `fallback` and write, so a corrupt preferences.json stays
//     self-healing (the long-standing L66 behavior — a user re-saving recovers the file).
//   - strictCorrupt:true: refuse to write, preserving the corrupt bytes — for files whose loss is
//     unacceptable (e.g. profile.json, where a {} overwrite would drop every profile).
const CORRUPT = Symbol('json-store.corrupt');
function _readForMutation(file, fallback) {
  if (!existsSync(file)) return fallback; // genuinely absent → seeding is fine
  try {
    const obj = JSON.parse(readFileSync(file, 'utf-8'));
    if (obj === null || typeof obj !== 'object') return CORRUPT;
    if (Array.isArray(fallback) !== Array.isArray(obj)) return CORRUPT;
    return obj;
  } catch {
    return CORRUPT;
  }
}

function _resolveForMutation(data, file, strictCorrupt) {
  if (data !== CORRUPT) return data;
  if (strictCorrupt) {
    const err = new Error(`json-store: refusing to overwrite corrupt/unreadable file ${file}`);
    err.code = 'JSON_STORE_CORRUPT';
    reportSwallowed('json-store.corrupt-guard', err);
    throw err;
  }
  return undefined; // tolerant: signal "use the fallback"
}

/**
 * Atomic write (tmp + renameSyncWithRetry). `mode` defaults to 0600 (the file may carry secrets);
 * pass `mode: false` to skip the permission bit entirely (non-secret stores under umask).
 * Serialization: `pretty` (2-space, the prefs convention) or compact.
 */
export function writeJsonAtomic(file, data, { mode = 0o600, pretty = true } = {}) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  try {
    writeFileSync(tmp, pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data), mode ? { mode } : undefined);
    renameSyncWithRetry(tmp, file);
    if (mode) {
      // writeFileSync's mode only applies on creation; re-assert on a pre-existing file.
      try { chmodSync(file, mode); } catch { /* best-effort; non-POSIX or race */ }
    }
  } catch (err) {
    try { unlinkSync(tmp); } catch {}
    throw err;
  }
}

/**
 * Locked read-modify-write (async). Reads inside the lock, runs `mutator(data)` (mutate in
 * place; may be async), atomically writes, returns the mutator's value when defined else data.
 */
export async function mutateJson(file, mutator, { mode = 0o600, pretty = true, fallback = {}, ensureDir, strictCorrupt = false } = {}) {
  return withFileLockAsync(lockPathFor(file), async () => {
    const resolved = _resolveForMutation(_readForMutation(file, fallback), file, strictCorrupt);
    const data = resolved === undefined ? fallback : resolved;
    const result = await mutator(data);
    writeJsonAtomic(file, data, { mode, pretty });
    return result !== undefined ? result : data;
  }, { ensureDir: ensureDir ?? dirname(file) });
}

/**
 * Lock-only primitive: holds the file's `${file}.lock` around `fn()` WITHOUT doing any read
 * or write itself. For stores whose on-disk shape differs from their in-memory shape (e.g.
 * ask-store's {version, entries} wrap) and therefore need to run their own domain read/save
 * inside the mutex rather than the kernel's read→mutate→write. Shares the same lock as
 * mutateJson / mutateJsonSync for the file.
 */
export async function withJsonLock(file, fn, { ensureDir } = {}) {
  return withFileLockAsync(lockPathFor(file), fn, { ensureDir: ensureDir ?? dirname(file) });
}

// ─── Synchronous spin lock ───
// Mirrors async-file-lock's two-tier stale detection (dead PID or aged mtime) but with
// openSync('wx') + a blocking Atomics.wait so sync callers can hold the SAME `${file}.lock`.
// Same-process serialization is inherent (JS is single-threaded; a sync critical section has
// no interleaving). Cross-process mutual exclusion comes from the lock file.

function _isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (err) { return err && err.code === 'EPERM'; }
}

function _readLockOwnerPid(path) {
  try {
    const raw = readFileSync(path, 'utf-8');
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj && Number.isInteger(obj.pid)) return obj.pid;
  } catch {}
  return null;
}

function _isLockStale(path, mtimeFallbackMs) {
  const pid = _readLockOwnerPid(path);
  if (pid !== null) {
    if (pid === process.pid) {
      // Own pid is a crash leftover ONLY when this process does not currently hold the disk lock
      // via the async flavor. An async holder (mutateJson / withJsonLock / mutatePrefs) is alive
      // and mid-critical-section right now — it yields the JS thread at every await, so this sync
      // caller can observe its lock; stealing it would let both writers commit and lose an update.
      if (hasLiveDiskHolder(path)) return false;
      return true;
    }
    return !_isPidAlive(pid);
  }
  try {
    const stats = statSync(path);
    return Date.now() - stats.mtimeMs > mtimeFallbackMs;
  } catch {
    return false; // conservative: cannot stat → assume held
  }
}

function _blockingSleep(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch { /* Atomics.wait unavailable on the main thread in some embedders — best-effort */ }
}

// Returns true when the lock was acquired, false on timeout (caller decides how to degrade).
// A short deadline is used when this process itself holds the lock via the async flavor: async
// mutators are currently synchronous (sub-ms hold), so a brief spin rides it out without either
// freezing the loop for seconds or stealing the lock (which would lose the async writer's update).
function _acquireLockSync(lockPath, { deadline = 2000, retryMs = 25, staleThresholdMs = 5000 } = {}) {
  const asyncHeldHere = hasLiveDiskHolder(lockPath);
  const effectiveDeadline = asyncHeldHere ? Math.min(deadline, 250) : deadline;
  const deadlineAt = Date.now() + effectiveDeadline;
  while (true) {
    let fd;
    try {
      fd = openSync(lockPath, 'wx');
      try { writeFileSync(fd, JSON.stringify({ pid: process.pid, ts: Date.now() })); } finally { closeSync(fd); }
      return true;
    } catch (err) {
      if (err?.code === 'EEXIST') {
        if (Date.now() < deadlineAt) {
          if (_isLockStale(lockPath, staleThresholdMs)) {
            try { unlinkSync(lockPath); } catch {}
            continue;
          }
          _blockingSleep(retryMs);
          continue;
        }
        if (_isLockStale(lockPath, staleThresholdMs)) {
          try { unlinkSync(lockPath); } catch {}
          continue;
        }
        return false; // timeout — caller degrades instead of crashing
      }
      throw err;
    }
  }
}

/**
 * Synchronous locked read-modify-write, for the existing SYNC writers (auth.js, im-config.js).
 * Holds the SAME `${file}.lock` as mutateJson so a sync writer and an async writer of the same
 * file still mutex cross-process. `mutator` must be synchronous (no await).
 *
 * Timeout policy (P1-F): if the lock cannot be acquired in time (a live foreign process holds
 * it), we DEGRADE to an unlocked atomic write rather than throwing — a 2s freeze plus an
 * uncaught throw out of a route callback would kill the whole server (proxy + all sessions).
 * The atomic write still can't tear the file; the residual lost-update window is the pre-kernel
 * status quo and is reported so it's visible. Pass { strict: true } to throw on timeout instead.
 */
export function mutateJsonSync(file, mutator, { mode = 0o600, pretty = true, fallback = {}, ensureDir, deadline, strict = false, strictCorrupt = false } = {}) {
  const dir = ensureDir ?? dirname(file);
  try { mkdirSync(dir, { recursive: true }); } catch {}
  const lockPath = lockPathFor(file);
  const acquired = _acquireLockSync(lockPath, deadline ? { deadline } : {});
  if (!acquired && strict) {
    throw new Error(`Lock acquisition timeout: ${lockPath} (held by live process)`);
  }
  if (!acquired) {
    reportSwallowed('json-store.lock-timeout-degraded', new Error(`mutateJsonSync degraded to unlocked write: ${file}`));
  }
  try {
    const resolved = _resolveForMutation(_readForMutation(file, fallback), file, strictCorrupt);
    const data = resolved === undefined ? fallback : resolved;
    const result = mutator(data);
    writeJsonAtomic(file, data, { mode, pretty });
    return result !== undefined ? result : data;
  } finally {
    if (acquired) {
      try { unlinkSync(lockPath); } catch (err) { reportSwallowed('json-store.lock-release', err); }
    }
  }
}

/**
 * Generic shallow merge of a patch onto `target` IN PLACE. Domain-specific merges (e.g.
 * approvalModal reconciliation in prefs-store) stay in the per-store layer — the kernel only
 * provides the plain-object assign so every store doesn't re-hand-roll it.
 */
export function applyJsonPatch(target, patch) {
  if (!patch || typeof patch !== 'object') return target;
  Object.assign(target, patch);
  return target;
}
