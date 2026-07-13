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
// - Open SQLite read-only (readOnly:true) to avoid SQLITE_BUSY locks while cc-switch is running
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
// Linux empirically uses ~/.cc-switch/; mac/win follow Tauri v2 standard dirs plus a dot-dir fallback.
function candidateDbPaths() {
  const home = homedir();
  const plat = platform();
  const paths = [];
  if (plat === 'darwin') {
    paths.push(join(home, 'Library', 'Application Support', 'cc-switch', 'cc-switch.db'));
    paths.push(join(home, 'Library', 'Application Support', 'com.ccswitch.desktop', 'cc-switch.db'));
  } else if (plat === 'win32') {
    const appdata = process.env.APPDATA || join(home, 'AppData', 'Roaming');
    const localappdata = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    paths.push(join(appdata, 'cc-switch', 'cc-switch.db'));
    paths.push(join(localappdata, 'cc-switch', 'cc-switch.db'));
  } else {
    // linux and other unix
    const xdg = process.env.XDG_DATA_HOME;
    if (xdg) paths.push(join(xdg, 'cc-switch', 'cc-switch.db'));
    paths.push(join(home, '.local', 'share', 'cc-switch', 'cc-switch.db'));
  }
  // Generic dot-dir fallback (binary strings confirm this path is hardcoded)
  paths.push(join(home, '.cc-switch', 'cc-switch.db'));
  return paths;
}

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
    return { profiles: [], error: 'node:sqlite unavailable on this runtime' };
  }
  let db = null;
  try {
    // Read-only: cc-switch stays unaffected by our reads (no SQLITE_BUSY)
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch (err) {
    return { profiles: [], error: `cannot open db: ${err && err.message}` };
  }
  try {
    // providers table existence check (older / corrupt dbs may not have it)
    let hasTable = false;
    try {
      const r = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='providers'").get();
      hasTable = !!r;
    } catch { hasTable = false; }
    if (!hasTable) return { profiles: [], error: 'providers table not found' };

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
  } catch (err) {
    return { profiles: [], error: `query failed: ${err && err.message}` };
  } finally {
    try { db.close(); } catch { /* best effort */ }
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
// - proxy_-prefixed (user-created): left untouched, preserved as-is
// - newly seen ccs_ ids: appended to the end of the list
// - max (built-in default) is always kept at the front
// Returns { profiles, imported, updated } counts.
export function mergeImportedProfiles(existing, importedList) {
  const existingArr = Array.isArray(existing) ? existing : [];
  const importedMap = new Map();
  for (const p of importedList) importedMap.set(p.id, p);

  const result = [];
  let newCount = 0;
  let updatedCount = 0;

  // Put built-in max first (if present)
  for (const p of existingArr) {
    if (p.id === 'max') {
      result.push(p);
      break;
    }
  }
  // User-created profiles (proxy_ prefix + others that are not ccs_ and not max) are preserved as-is
  for (const p of existingArr) {
    if (p.id === 'max') continue;
    if (p.id && !p.id.startsWith('ccs_')) {
      result.push(p);
    }
  }
  // ccs_-sourced: use the freshly imported data
  for (const p of existingArr) {
    if (p.id && p.id.startsWith('ccs_')) {
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
