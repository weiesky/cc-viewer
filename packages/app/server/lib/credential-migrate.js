// One-time credential migration — moves legacy plaintext/base64 secrets into the vault.
//
// Runs ONCE at server startup (fire-and-forget setImmediate, after config-backup so a pre-strip
// copy exists). For each legacy secret field it: writes the value to the vault, READS IT BACK and
// compares (the data-safety invariant), and only then strips the legacy field from the source
// file — all inside the source file's lock. Idempotent by data, not by a marker: a field that
// already matches the vault is a no-op; a field whose on-disk value DIFFERS from the vault wins
// (it is the user's later intent — hand edit / restored backup / old binary) and overwrites.
//
// The migration marker written at the end is INFORMATIONAL only (for logging + the backup-clean
// decision); it never gates re-migration, so a later plaintext reintroduction is still picked up.
//
// Boundary: L1-lib. Imports json-store + credential-access + findcc (load-time root).
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { reportSwallowed } from '@ccv/core/error-report';
import { LOG_DIR } from '../../findcc.js';
import { mutateJsonSync } from './json-store.js';
import { migrateFieldWithVerify, getCredentialsFile } from './credential-access.js';

// Load-time roots, aligned with credential-access / PROFILE_PATH (not live-bound).
const PREFS_FILE = join(LOG_DIR, 'preferences.json');
const PROFILE_FILE = join(LOG_DIR, 'profile.json');

// Ref builders — must EXACTLY match the runtime readers (auth.js refFor / im-config secretRef /
// interceptor profile-apiKey ref) or the migrated entries won't be found at read time.
function _authRef(projectDir) { return projectDir ? `proj:${resolve(projectDir)}` : 'global'; }
function _imRef(platform, fieldKey) { return `${platform}.${fieldKey}`; }

function _b64Decode(stored) {
  if (!stored || typeof stored !== 'string') return '';
  try { return Buffer.from(stored, 'base64').toString('utf-8'); } catch { return ''; }
}

// IM platform → secret field keys (mirrors im-config DESCRIPTORS; only `secret`-type fields).
// cred fields (appKey/appId/botId) stay base64 — they are low-sensitivity and out of scope.
const IM_SECRET_FIELDS = {
  dingtalk: ['appSecret'],
  feishu: ['appSecret'],
  wecom: ['secret'],
  discord: ['botToken'],
};

/**
 * Migrate auth.password / authByProject.*.password (base64) into the vault, then strip them from
 * preferences.json (leaving { enabled }).
 * Returns { migrated, skipped, failed } counts.
 */
function migrateAuthPasswords() {
  const result = { migrated: 0, skipped: 0, failed: 0 };
  if (!existsSync(PREFS_FILE)) return result;
  mutateJsonSync(PREFS_FILE, (prefs) => {
    if (!prefs || typeof prefs !== 'object') return;
    // global
    if (prefs.auth && typeof prefs.auth === 'object' && prefs.auth.password) {
      const plain = _b64Decode(prefs.auth.password);
      const r = migrateFieldWithVerify('lan-password', _authRef(null), plain);
      if (r.migrated && r.verified) { delete prefs.auth.password; result.migrated++; }
      else result.failed++;
    }
    // per-project
    if (prefs.authByProject && typeof prefs.authByProject === 'object') {
      for (const [dir, entry] of Object.entries(prefs.authByProject)) {
        if (!entry || typeof entry !== 'object' || !entry.password) { result.skipped++; continue; }
        const plain = _b64Decode(entry.password);
        const r = migrateFieldWithVerify('lan-password', _authRef(dir), plain);
        if (r.migrated && r.verified) { delete entry.password; result.migrated++; }
        else result.failed++;
      }
    }
  }, { mode: 0o600 });
  return result;
}

/**
 * Migrate IM platform secret fields (base64) into the vault, then strip them (leaving '').
 */
function migrateImSecrets() {
  const result = { migrated: 0, skipped: 0, failed: 0 };
  if (!existsSync(PREFS_FILE)) return result;
  mutateJsonSync(PREFS_FILE, (prefs) => {
    if (!prefs || typeof prefs !== 'object') return;
    for (const [platform, fields] of Object.entries(IM_SECRET_FIELDS)) {
      const cfg = prefs[platform];
      if (!cfg || typeof cfg !== 'object') { result.skipped += fields.length; continue; }
      for (const fieldKey of fields) {
        const stored = cfg[fieldKey];
        if (!stored) { result.skipped++; continue; }
        const plain = _b64Decode(stored);
        const r = migrateFieldWithVerify('im-secret', _imRef(platform, fieldKey), plain);
        if (r.migrated && r.verified) { cfg[fieldKey] = ''; result.migrated++; }
        else result.failed++;
      }
    }
  }, { mode: 0o600 });
  return result;
}

/**
 * Migrate profile.json plaintext apiKeys into the vault, then strip them (leaving '').
 * Reads the file directly (the startup strip is the ONLY writer that removes the field).
 */
function migrateProfileApiKeys() {
  const result = { migrated: 0, skipped: 0, failed: 0 };
  if (!existsSync(PROFILE_FILE)) return result;
  mutateJsonSync(PROFILE_FILE, (data) => {
    if (!data || typeof data !== 'object' || !Array.isArray(data.profiles)) return;
    for (const p of data.profiles) {
      if (!p || typeof p.id !== 'string') { result.skipped++; continue; }
      const plain = typeof p.apiKey === 'string' ? p.apiKey : '';
      if (!plain) { result.skipped++; continue; }
      const r = migrateFieldWithVerify('profile-apiKey', p.id, plain);
      if (r.migrated && r.verified) { p.apiKey = ''; result.migrated++; }
      else result.failed++;
    }
  }, { mode: 0o600, strictCorrupt: true }); // never overwrite a corrupt profile.json with a {} fallback
  return result;
}

/**
 * Run the full one-time migration. Best-effort: per-class failures are reported and counted,
 * never thrown (a failed field keeps its legacy value, so nothing is lost and the next boot
 * retries). Returns a summary; also writes an informational marker into credentials.json.
 */
export function migrateCredentialsToVault() {
  const summary = { auth: null, im: null, profiles: null, ok: true };
  try { summary.auth = migrateAuthPasswords(); } catch (e) { summary.ok = false; reportSwallowed('credential-migrate.auth', e); }
  try { summary.im = migrateImSecrets(); } catch (e) { summary.ok = false; reportSwallowed('credential-migrate.im', e); }
  try { summary.profiles = migrateProfileApiKeys(); } catch (e) { summary.ok = false; reportSwallowed('credential-migrate.profiles', e); }

  const total = (s) => (s ? s.migrated + s.failed : 0);
  const touched = total(summary.auth) + total(summary.im) + total(summary.profiles);
  if (touched > 0) {
    // Informational marker only — never used to gate re-migration.
    try {
      mutateJsonSync(getCredentialsFile(), (data) => {
        if (data && typeof data === 'object') data._credsMigratedAt = new Date().toISOString();
      }, { mode: 0o600, strictCorrupt: true });
    } catch (e) { reportSwallowed('credential-migrate.marker', e); }
    // Loud, single-line startup signal so an operator can see the vault came online.
    console.error(`[cc-viewer] credential vault migration: auth=${fmt(summary.auth)} im=${fmt(summary.im)} profiles=${fmt(summary.profiles)}`);
  }
  return summary;
}

function fmt(s) { return s ? `${s.migrated} migrated/${s.failed} failed` : 'n/a'; }
