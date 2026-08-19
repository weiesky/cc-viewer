// Single correct writer for {LOG_DIR}/preferences.json.
//
// preferences.json holds UI prefs AND the (base64) LAN password (auth) AND per-project
// forks (prefsByProject). Multiple writers touch it — the global POST /api/preferences,
// lib/auth.js, and the new project-prefs routes — so every write here goes through ONE
// async file lock + atomic tmp→rename, mirroring server/lib/ask-store.js. Same-process
// callers serialize via withFileLockAsync's per-lockPath Promise chain; cross-process
// callers mutex on the lock file. This prevents a concurrent writer from clobbering the
// password-bearing file or losing a fork update.
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { renameSyncWithRetry } from './file-api.js';
import { withFileLockAsync } from './async-file-lock.js';
import { mergeApprovalModalPrefs } from './approval-modal-prefs.js';
import { reconcileVoicePackPrefs } from './voice-pack-manager.js';
import { LOG_DIR } from '../../findcc.js';

// Path is computed fresh each call: LOG_DIR is a live binding (setLogDir) and tests
// redirect it via CCV_LOG_DIR before importing. Matches lib/auth.js getPrefsPath().
// In production every caller resolves to this same canonical path; the optional `file`
// override on the helpers below exists only so the preferences route can forward its
// deps.getPrefsFile() seam (used by branch tests) and stay symmetric with the GET read.
export function getPrefsFile() { return join(LOG_DIR, 'preferences.json'); }
// Lock lives next to the file so every writer of the SAME preferences.json shares one lock
// (global POST, fork ops, …). In prod all paths are canonical ⇒ one lock ⇒ serialized.
function getPrefsLock(file) { return join(dirname(file), 'preferences.lock'); }

/** Read the raw on-disk prefs object (no stripping, no virtual defaults). {} on miss/corrupt. */
export function readPrefsRaw(file = getPrefsFile()) {
  try {
    if (!existsSync(file)) return {};
    const obj = JSON.parse(readFileSync(file, 'utf-8'));
    return obj && typeof obj === 'object' ? obj : {};
  } catch { return {}; }
}

/** Atomic write (tmp + rename) with 0600 — the file may carry the base64 password. */
function writePrefsAtomic(prefs, file) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  try {
    writeFileSync(tmp, JSON.stringify(prefs, null, 2), { mode: 0o600 });
    renameSyncWithRetry(tmp, file);
    // writeFileSync's mode only applies on creation; re-assert 0600 on a pre-existing file.
    try { chmodSync(file, 0o600); } catch { /* best-effort; non-POSIX or race */ }
  } catch (err) {
    try { unlinkSync(tmp); } catch {}
    throw err;
  }
}

/**
 * Locked read-modify-write. Reads the raw prefs inside the lock, runs mutator(prefs)
 * (mutate in place; may be async), atomically writes, and returns the mutator's return
 * value when defined, else the mutated prefs object. `file` defaults to the canonical path.
 */
export async function mutatePrefs(mutator, file = getPrefsFile()) {
  return withFileLockAsync(getPrefsLock(file), async () => {
    const prefs = readPrefsRaw(file);
    const result = await mutator(prefs);
    writePrefsAtomic(prefs, file);
    return result !== undefined ? result : prefs;
  }, { ensureDir: dirname(file) });
}

/**
 * Apply a preferences patch onto `target` IN PLACE — the single-sourced merge used by
 * both the global POST and per-project fork writes so the two paths can't drift.
 * Scalars shallow-merge; approvalModal goes through mergeApprovalModalPrefs (with voice
 * pack reconcile when a logDir is given).
 */
export function applyPrefsPatch(target, patch, { logDir = null } = {}) {
  if (!patch || typeof patch !== 'object') return target;
  const { approvalModal: incAM, ...rest } = patch;
  Object.assign(target, rest);
  if (incAM && typeof incAM === 'object') {
    target.approvalModal = mergeApprovalModalPrefs(target.approvalModal, incAM, {
      reconcile: logDir ? (vp) => reconcileVoicePackPrefs(logDir, vp) : null,
    });
  }
  return target;
}
