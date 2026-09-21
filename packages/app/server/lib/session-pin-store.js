// Server-side "current session" pin store, per project.
//
// The current-session view filter needs a single "current session pointer". It used to
// live in the browser's localStorage (keyed by project name) — so two devices hitting the
// SAME ccv process diverged. We move it server-side: one tiny JSON per project.
//
// `logDir` here is the PER-PROJECT directory (interceptor._logDir = LOG_DIR/<projectName>);
// '' means no active project (workspace mode not yet launched) → read = null / write = no-op.
// Writes are atomic (tmp + rename) so a torn read can't happen when several writers race
// (mirrors server/lib/prefs-store.js).
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonAtomic } from './json-store.js';

/** Pin file path inside the project dir: `.session-pin.json`. */
export function pinFilePath(logDir) {
  return join(logDir, '.session-pin.json');
}

/** Read the pinned session id. No project / missing file / corrupt → null. */
export function readPin(logDir) {
  if (!logDir) return null;
  try {
    const file = pinFilePath(logDir);
    if (!existsSync(file)) return null;
    const obj = JSON.parse(readFileSync(file, 'utf-8'));
    const v = obj && typeof obj === 'object' ? obj.pinnedSessionId : null;
    return (typeof v === 'string' && v) ? v : null;
  } catch { return null; }
}

/**
 * Write (or clear) the pinned session id. No project (logDir = '') → no-op, returns false.
 * A null/empty pinnedSessionId deletes the file (back to "show latest"). Atomic via the
 * json-store kernel (tmp + rename). Non-secret → mode:false (umask); the pin is a view
 * preference, not a credential. Returns true on success, false on no-project / write
 * failure (view state is best-effort).
 */
export function writePin(logDir, pinnedSessionId) {
  if (!logDir) return false;
  const file = pinFilePath(logDir);
  const id = (typeof pinnedSessionId === 'string' && pinnedSessionId) ? pinnedSessionId : null;
  try {
    if (id == null) {
      try { unlinkSync(file); } catch { /* already absent */ }
      return true;
    }
    writeJsonAtomic(file, { pinnedSessionId: id }, { mode: false, pretty: false });
    return true;
  } catch { return false; }
}
