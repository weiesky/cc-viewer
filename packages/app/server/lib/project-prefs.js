// Per-project preference forks — pure helpers around the `prefsByProject` map inside
// preferences.json. Mirrors the per-project scheme already used by lib/auth.js
// (authByProject): keyed by the FULL project directory so two projects that share a
// basename ("~/work/app" vs "~/play/app") never collapse into one fork.
//
//   preferences.json:
//     prefsByProject: { "<projectDir>": { ...forkedPrefs } }
//
// A project "has a fork" iff a key exists for it (hasOwnProperty). Removing a fork
// (toggle off) deletes the key so the project inherits global again.
import { basename } from 'node:path';
import { mergeApprovalModalPrefs } from './approval-modal-prefs.js';
import { listPlatforms } from './im-config.js';
import { _projectName } from '../interceptor.js';

// SINGLE SOURCE of "what must never live inside a fork": secrets (auth password + IM creds),
// machine-level paths (logDir/claudeConfigDir), and the internal forks map. snapshotForFork /
// cleanPatch / the admin list read all funnel through stripSensitive so the rule can't drift.
const STRIP_KEYS = ['auth', 'authByProject', 'prefsByProject', 'logDir', 'claudeConfigDir'];

/** Strip secrets + IM credentials + machine-level keys from a prefs-shaped object in place. */
export function stripSensitive(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  for (const k of STRIP_KEYS) delete obj[k];
  for (const id of listPlatforms()) delete obj[id];
  return obj;
}

/** Full project dir used as the fork key — same scheme as server.js AUTH_PROJECT. */
export function getCurrentProjectKey() {
  return process.env.CCV_PROJECT_DIR || process.cwd();
}

/** Human-readable project name for display (interceptor's sanitized basename). */
export function getCurrentProjectName() {
  return _projectName || basename(getCurrentProjectKey());
}

/**
 * Whether the server is currently serving a concrete project. In workspace mode the
 * project is unknown until a workspace is launched (interceptor _projectName / env are
 * empty) — refuse to fork under the server's own cwd in that window.
 */
export function hasActiveProject() {
  if (process.env.CCV_WORKSPACE_MODE === '1') {
    return !!(process.env.CCV_PROJECT_DIR || _projectName);
  }
  return true;
}

/** Does `key` have a fork? (key present, regardless of contents) — mirror auth.hasOverride. */
export function hasFork(prefs, key) {
  return !!(key && prefs && prefs.prefsByProject &&
    Object.prototype.hasOwnProperty.call(prefs.prefsByProject, key));
}

/** List of project dirs that currently have a fork. */
export function listForks(prefs) {
  return (prefs && prefs.prefsByProject && typeof prefs.prefsByProject === 'object')
    ? Object.keys(prefs.prefsByProject)
    : [];
}

/**
 * Curated snapshot of the current GLOBAL prefs to seed a new fork. Deep-copied from the
 * RAW file object (not a GET payload — avoids baking the resumeAutoChoice='continue'
 * virtual default), with secrets / machine-level / internal / `_`-meta keys removed.
 */
export function snapshotForFork(prefsRaw) {
  const copy = JSON.parse(JSON.stringify(prefsRaw || {}));
  for (const k of Object.keys(copy)) if (k[0] === '_') delete copy[k]; // 元字段
  return stripSensitive(copy); // 密码/IM/机器级/forks 单一来源剥离
}

/**
 * Build the effective prefs a scoped (non-loopback) client should see: fork values win
 * over global for scalars, approvalModal deep-merged (fork over global). Keys absent from
 * the fork fall through to global so newly-added global settings stay forward-compatible.
 * Machine-level fields (logDir/claudeConfigDir) are NOT handled here — the GET handler
 * stamps them after this runs.
 */
export function resolveScoped(globalPrefs, fork) {
  const { approvalModal: gAM, ...gRest } = globalPrefs || {};
  const { approvalModal: fAM, ...fRest } = fork || {};
  const merged = { ...gRest, ...fRest };
  if (gAM || fAM) {
    // 防引用别名：fork 无 approvalModal 时也返回浅拷贝，避免调用方（preferencesGet 的
    // voicePack reconcile）回写到解析出的全局对象（当前每请求新解析虽无害，仍保持"绝不外泄内部引用"）。
    merged.approvalModal = fAM
      ? mergeApprovalModalPrefs(gAM, fAM, {})
      : { ...gAM };
  }
  return merged;
}
