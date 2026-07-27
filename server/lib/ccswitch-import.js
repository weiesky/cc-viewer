// cc-switch config import library (pure functions + read-only SQLite).
//
// cc-switch is a Tauri desktop app that stores AI provider credentials in the
// providers table of a SQLite database (cc-switch.db). The settings_config column
// is a JSON string containing env.ANTHROPIC_BASE_URL / env.ANTHROPIC_AUTH_TOKEN /
// env.ANTHROPIC_MODEL, etc.
//
// This module locates the cc-switch data directory cross-platform (mac/linux/windows),
// opens the db read-only, and maps providers with app_type='claude' into cc-viewer's
// profile format. It performs no writes and never touches profile.json — persistence
// is delegated to the caller (preferences.js POST /api/ccswitch-import).
//
// Design notes:
// - Open SQLite read-only by default (readOnly:true) to avoid SQLITE_BUSY locks while cc-switch is running;
//   escalate once to a read-write + query_only connection only when a malformed leftover journal forces
//   SQLITE_READONLY recovery (see readCcSwitchProviders)
// - Multi-path probing: each platform tries the standard Tauri dir first, then falls back to ~/.cc-switch/
// - settings_config parsing is fully fault-tolerant: null / non-JSON / missing env are all skipped, never throws
// - Profile ids get a ccs_ prefix to distinguish from user-created proxy_ prefixed ones; updates are idempotent (re-imports update, never duplicate)
// - Only app_type='claude' is imported; codex is skipped (different format, cc-viewer does not support OpenAI auth)
// - Never sets active automatically: import only populates the list; switching is decided by the caller/UI (avoids clobbering the user's current selection)

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';

// Dynamically import node:sqlite — built into Node 22.5+ (22.5 needs --experimental-sqlite flag,
// stable in 23+ / 26). Dynamic import is used so that a missing module on older Node does not
// bring down the entire interceptor chain.
let _DatabaseSync = null;
async function getDatabaseSync() {
  if (_DatabaseSync !== null) return _DatabaseSync;
  try {
    const m = await import('node:sqlite');
    _DatabaseSync = m.DatabaseSync || null;
  } catch {
    _DatabaseSync = null;
  }
  return _DatabaseSync;
}

// Cross-platform candidate paths (ordered by priority; the first existsSync hit wins).
// cc-switch hardcodes ~/.cc-switch/cc-switch.db on ALL platforms (get_app_config_dir() in its
// config.rs; the Tauri identifier com.ccswitch.desktop does NOT affect the DB path). So that
// path is probed first. The platform-specific Tauri app-data dirs below are kept only as
// legacy fallbacks in case some very old cc-switch version wrote there — never first — so a
// stale/empty leftover file in them cannot shadow the real ~/.cc-switch/cc-switch.db.
function candidateDbPaths(opts) {
  // opts is for testing only (inject platform/home/env without touching the runtime);
  // production callers omit it and use the real homedir()/platform()/process.env.
  const home = opts && opts.home != null ? opts.home : homedir();
  const plat = opts && opts.plat != null ? opts.plat : platform();
  const env = opts && opts.env ? opts.env : process.env;
  const paths = [join(home, '.cc-switch', 'cc-switch.db')]; // primary on every platform
  if (plat === 'darwin') {
    paths.push(join(home, 'Library', 'Application Support', 'cc-switch', 'cc-switch.db'));
    paths.push(join(home, 'Library', 'Application Support', 'com.ccswitch.desktop', 'cc-switch.db'));
  } else if (plat === 'win32') {
    const appdata = env.APPDATA || join(home, 'AppData', 'Roaming');
    const localappdata = env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    paths.push(join(appdata, 'cc-switch', 'cc-switch.db'));
    paths.push(join(localappdata, 'cc-switch', 'cc-switch.db'));
  } else {
    // linux and other unix
    const xdg = env.XDG_DATA_HOME;
    if (xdg) paths.push(join(xdg, 'cc-switch', 'cc-switch.db'));
    paths.push(join(home, '.local', 'share', 'cc-switch', 'cc-switch.db'));
  }
  return paths;
}
// Exported for unit tests so the win32/darwin priority ordering can be exercised on any host.
export { candidateDbPaths as _candidateDbPathsForTest };

// Test hook: override the cached DatabaseSync — pass false to simulate a runtime
// without node:sqlite (the getter returns the cached falsy value and the callers
// take the unavailable path), or null to restore lazy detection.
export function _setDatabaseSyncForTest(v) { _DatabaseSync = v; }

// Returns the first existing cc-switch.db path, or null if none found.
export function findCcSwitchDbPath() {
  for (const p of candidateDbPaths()) {
    try {
      if (existsSync(p)) return p;
    } catch { /* ignore */ }
  }
  return null;
}

// Map of model fields in settings_config.env → cc-viewer profile fields.
// Note: cc-switch has variants suffixed with _NAME (e.g. ANTHROPIC_DEFAULT_SONNET_MODEL_NAME);
// cc-viewer profiles only use the standard field names without _NAME, so we take only the
// standard names and ignore the _NAME variants.
const ENV_FIELD_MAP = {
  ANTHROPIC_BASE_URL: 'baseURL',
  ANTHROPIC_AUTH_TOKEN: 'apiKey',
  ANTHROPIC_API_KEY: 'apiKey', // rare, but kept for compatibility
  ANTHROPIC_MODEL: 'ANTHROPIC_MODEL',
  ANTHROPIC_DEFAULT_OPUS_MODEL: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  ANTHROPIC_DEFAULT_SONNET_MODEL: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  ANTHROPIC_DEFAULT_HAIKU_MODEL: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  // cc-switch's "通用配置" effort toggle writes CLAUDE_CODE_EFFORT_LEVEL (e.g. "max").
  // cc-viewer's interceptor injects profile.effort as output_config.effort, so mapping
  // this env var preserves the user's effort setting across import (was previously dropped).
  CLAUDE_CODE_EFFORT_LEVEL: 'effort',
};

// Map a cc-switch providers row into a cc-viewer profile object.
// settings_config is a JSON string stored in a TEXT column. Returns null when the row is unusable (no credentials / no baseURL).
export function mapProviderToProfile(row) {
  if (!row || !row.id || !row.name) return null;
  if (row.app_type && row.app_type !== 'claude') return null; // only import claude
  let cfg = null;
  try {
    cfg = typeof row.settings_config === 'string'
      ? JSON.parse(row.settings_config)
      : row.settings_config;
  } catch { return null; }
  if (!cfg || typeof cfg !== 'object') return null;
  const env = cfg.env;
  if (!env || typeof env !== 'object') return null;

  const profile = {
    id: `ccs_${row.id}`,
    name: String(row.name),
    baseURL: '',
    apiKey: '',
    effort: '', // CLAUDE_CODE_EFFORT_LEVEL → output_config.effort (injected by interceptor)
    ANTHROPIC_MODEL: '',
    ANTHROPIC_DEFAULT_OPUS_MODEL: '',
    ANTHROPIC_DEFAULT_SONNET_MODEL: '',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: '',
    source: 'cc-switch', // source marker; UI may show an "imported" badge from this
  };

  let hasCredential = false;
  for (const [envKey, profileKey] of Object.entries(ENV_FIELD_MAP)) {
    if (typeof env[envKey] === 'string' && env[envKey]) {
      // Prefer whichever credential appears first (ANTHROPIC_AUTH_TOKEN is ordered before ANTHROPIC_API_KEY;
      // if both exist and apiKey was already set by the former, do not overwrite it)
      if (profileKey === 'apiKey' && hasCredential) continue;
      profile[profileKey] = env[envKey];
      if (profileKey === 'apiKey') hasCredential = true;
    }
  }

  // A valid credential requires both baseURL and apiKey (rows with only non-credential config, e.g. Claude Official, are skipped)
  if (!profile.baseURL || !profile.apiKey) return null;
  return profile;
}

// Read claude providers from cc-switch.db and return a cc-viewer profile array.
// Opened read-only with full fault tolerance: db cannot open / table missing / no rows → empty array + error message.
export async function readCcSwitchProviders(dbPath) {
  const DatabaseSync = await getDatabaseSync();
  if (!DatabaseSync) {
    // Keep the 'node:sqlite unavailable' prefix stable — the UI keys a dedicated
    // localized message off it (ui.proxy.ccswitchNodeUnsupported).
    return { profiles: [], error: 'node:sqlite unavailable on this runtime (requires Node >= 22.5 with --experimental-sqlite, or >= 23.4)' };
  }

  // Open the db. Two contention modes from cc-switch to recover from:
  //  (1) A leftover MALFORMED cc-switch.db-journal (cc-switch killed mid-write, leaving a
  //      truncated/corrupt rollback journal) forces SQLite to discard it on the first page
  //      access — a write — which a read-only connection refuses with SQLITE_READONLY
  //      ("attempt to write a readonly database"). Escalate once to a read-write open guarded
  //      by PRAGMA query_only=ON (lets SQLite recover, blocks our own writes), then retry.
  //      Mirrors what cc-switch itself does on its next normal launch.
  //  (2) A running cc-switch holding an EXCLUSIVE write lock (its real contention mode — a
  //      valid hot journal under BEGIN EXCLUSIVE blocks even read-only readers, unlike
  //      BEGIN IMMEDIATE) makes the read-only connection's first query throw SQLITE_BUSY
  //      ("database is locked"). Retry once after a short backoff (cc-switch's writes are
  //      short — transient locks usually clear), and if still held surface a friendly message
  //      rather than the opaque `query failed: database is locked`.
  const primaryErrCode = (e) => Number.isInteger(e && e.errcode) ? (e.errcode & 0xff) : null;
  const isReadonlyErr = (e) => primaryErrCode(e) === 8
    || /readonly/i.test(e && (e.errstr || e.message || ''));
  const isBusyErr = (e) => [5, 6].includes(primaryErrCode(e))
    || /locked|busy/i.test(e && (e.errstr || e.message || ''));

  // Run the providers read against a given connection; returns the result object or throws.
  const readProviders = (db) => {
    // providers table existence check. A query that throws here means the file is
    // unreadable as a SQLite db (corrupt / non-SQLite / truncated) — the real cause
    // must surface, not be masked as "table not found".
    const r = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='providers'").get();
    if (!r) return { profiles: [], error: `providers table not found in ${dbPath}` };

    const rows = db.prepare(
      "SELECT id, app_type, name, settings_config, is_current FROM providers WHERE app_type = 'claude' ORDER BY sort_index, name"
    ).all();

    const profiles = [];
    let currentId = null;
    for (const row of rows) {
      const p = mapProviderToProfile(row);
      if (p) {
        profiles.push(p);
        if (row.is_current) currentId = p.id;
      }
    }
    return { profiles, currentId, error: null };
  };

  // Open read-only and attempt the read. Two recovery paths:
  //  - SQLITE_BUSY ("database is locked"): cc-switch is running and holding an EXCLUSIVE write
  //    lock (its real contention mode — a valid hot journal under BEGIN EXCLUSIVE blocks even
  //    read-only readers, unlike BEGIN IMMEDIATE). The lock is transient (cc-switch mid-write),
  //    so retry once after a short backoff; if still held, surface a friendly, actionable
  //    message instead of the opaque `query failed: database is locked` wrapper.
  //  - SQLITE_READONLY ("attempt to write a readonly database"): a malformed leftover journal
  //    (cc-switch killed mid-write) forces SQLite to discard it — a write the read-only
  //    connection refuses. Escalate once to a read-write open guarded by PRAGMA query_only=ON
  //    (lets SQLite recover, blocks our own writes), then retry. Mirrors cc-switch's own
  //    next-launch recovery.
  // Other errors propagate to the outer catch (formatted as `query failed: <message>`),
  // preserving real-cause surfacing (e.g. "file is not a database").
  const LOCKED_MSG = 'cc-switch db is locked (cc-switch may be running); retry shortly';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Keep the BUSY retry and READONLY escalation as independent one-shot budgets. Every open,
  // PRAGMA and query attempt passes through the same classifier, so a real state transition such
  // as BUSY (cc-switch was writing) → READONLY (it crashed and left a malformed journal) can use
  // both recoveries in sequence instead of escaping through a nested retry catch.
  let useRecoveryConnection = false;
  let busyRetried = false;
  while (true) {
    let db = null;
    let phase = 'open';
    try {
      db = useRecoveryConnection
        ? new DatabaseSync(dbPath)
        : new DatabaseSync(dbPath, { readOnly: true });
      phase = 'query';
      if (useRecoveryConnection) db.exec('PRAGMA query_only = ON');
      return readProviders(db);
    } catch (err) {
      if (isBusyErr(err)) {
        if (busyRetried) return { profiles: [], error: LOCKED_MSG };
        busyRetried = true;
        await sleep(200);
        continue;
      }
      if (isReadonlyErr(err) && !useRecoveryConnection) {
        useRecoveryConnection = true;
        continue;
      }
      const prefix = phase === 'open' ? 'cannot open db' : 'query failed';
      return { profiles: [], error: `${prefix}: ${err && err.message}` };
    } finally {
      try { db && db.close(); } catch { /* best effort */ }
    }
  }
}

// Top-level convenience: probe path + read, returns { profiles, currentId, dbPath, error }.
// Shared by GET /api/ccswitch-providers (preview) and POST /api/ccswitch-import (apply).
export async function discoverCcSwitchProviders() {
  const dbPath = findCcSwitchDbPath();
  if (!dbPath) return { profiles: [], currentId: null, dbPath: null, error: 'cc-switch not found' };
  const result = await readCcSwitchProviders(dbPath);
  return { ...result, dbPath };
}

// Merge cc-switch-imported profiles into cc-viewer's existing profile list.
// Rules:
// - ccs_-prefixed (previously imported): matched by id, updated with fresh data (credential refresh)
// - proxy_-prefixed (user-created) and any entry without a ccs_ id (including id-less ones): preserved as-is
// - newly seen ccs_ ids: appended to the end of the list
// - max (built-in default) is always present and first — seeded when missing, mirroring
//   proxyProfilesPost's invariant, so a first-ever import can never write a list without it
// Returns { profiles, imported, updated } counts.
export function mergeImportedProfiles(existing, importedList) {
  const existingArr = Array.isArray(existing) ? existing : [];
  const importedMap = new Map();
  for (const p of importedList) importedMap.set(p.id, p);

  const result = [];
  let newCount = 0;
  let updatedCount = 0;

  // Built-in max always first — reuse the existing entry, or seed the same shape
  // proxyProfilesPost injects. Without this, a fresh install importing before ever
  // saving a proxy would write a profiles list with no Default option.
  const existingMax = existingArr.find(p => p && p.id === 'max');
  result.push(existingMax || { id: 'max', name: 'Default' });
  // Everything that is not max and not ccs_-sourced (user proxy_ profiles, unknown or
  // id-less entries) is preserved verbatim — this function only owns the ccs_ namespace
  for (const p of existingArr) {
    if (!p || p.id === 'max') continue;
    if (!p.id || !p.id.startsWith('ccs_')) {
      result.push(p);
    }
  }
  // ccs_-sourced: use the freshly imported data
  for (const p of existingArr) {
    if (p && p.id && p.id.startsWith('ccs_')) {
      if (importedMap.has(p.id)) {
        result.push(importedMap.get(p.id));
        importedMap.delete(p.id);
        updatedCount++;
      }
      // If the imported data no longer has this id (deleted on the cc-switch side), drop it (no stale entries)
    }
  }
  // Newly seen ccs_ profiles (not previously imported)
  for (const p of importedMap.values()) {
    result.push(p);
    newCount++;
  }

  return { profiles: result, imported: newCount, updated: updatedCount };
}
