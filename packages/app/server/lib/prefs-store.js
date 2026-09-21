// Single correct writer for {LOG_DIR}/preferences.json.
//
// preferences.json holds UI prefs AND the (base64) LAN password (auth) AND per-project
// forks (prefsByProject). Multiple writers touch it — the global POST /api/preferences,
// lib/auth.js, and the new project-prefs routes — so every write here goes through ONE
// async file lock + atomic tmp→rename, mirroring server/lib/ask/ask-store.js. Same-process
// callers serialize via withFileLockAsync's per-lockPath Promise chain; cross-process
// callers mutex on the lock file. This prevents a concurrent writer from clobbering the
// password-bearing file or losing a fork update.
import { join, dirname } from 'node:path';
import { mutateJson, readJsonSafe, writeJsonAtomic } from './json-store.js';
import { mergeApprovalModalPrefs } from '@ccv/core/approval-modal-prefs';
import { reconcileVoicePackPrefs } from './voice-pack-manager.js';
import { LOG_DIR } from '../../findcc.js';

// Path is computed fresh each call: LOG_DIR is a live binding (setLogDir) and tests
// redirect it via CCV_LOG_DIR before importing. Matches lib/auth.js getPrefsPath().
// In production every caller resolves to this same canonical path; the optional `file`
// override on the helpers below exists only so the preferences route can forward its
// deps.getPrefsFile() seam (used by branch tests) and stay symmetric with the GET read.
export function getPrefsFile() { return join(LOG_DIR, 'preferences.json'); }

/** Read the raw on-disk prefs object (no stripping, no virtual defaults). {} on miss/corrupt. */
export function readPrefsRaw(file = getPrefsFile()) {
  return readJsonSafe(file, {});
}

/**
 * Locked read-modify-write. Reads the raw prefs inside the lock, runs mutator(prefs)
 * (mutate in place; may be async), atomically writes, and returns the mutator's return
 * value when defined, else the mutated prefs object. `file` defaults to the canonical path.
 *
 * Delegates to the unified json-store kernel (mutateJson): one async file lock derived from
 * the file name + atomic tmp→rename at 0600. The lock is shared with the SYNC writers of the
 * same file (auth.js / im-config.js via mutateJsonSync), so all preferences.json writers now
 * mutex on the same `preferences.json.lock`.
 */
export async function mutatePrefs(mutator, file = getPrefsFile()) {
  return mutateJson(file, mutator, { mode: 0o600, fallback: {}, ensureDir: dirname(file) });
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
