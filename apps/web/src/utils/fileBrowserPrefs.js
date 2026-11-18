/**
 * Per-directory view + sort preferences for the file browser modal.
 *
 * Persists { viewMode, sortBy, sortOrder } per (scopeKey, dirPath) in
 * sessionStorage so re-entering a directory in the same tab restores the
 * user's last choice; closing the tab forgets it. sessionStorage is used so
 * two side-by-side tabs never fight over the same directory's prefs.
 *
 * Storage shape: a single JSON document per scope, keyed by directory path
 * ('' = navigation root). All reads/writes are wrapped in try/catch — the
 * browser can deny storage in private mode, and a corrupt payload must never
 * break the modal.
 */

const PREFIX = 'ccv.fileBrowserModal.prefs.v1.';

export const DEFAULT_PREFS = Object.freeze({
  viewMode: 'grid',
  sortBy: 'name',
  sortOrder: 'asc',
});

const VIEW_MODES = new Set(['grid', 'list']);
const SORT_KEYS = new Set(['name', 'size', 'mtime']);
const SORT_ORDERS = new Set(['asc', 'desc']);

function storageAvailable() {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage !== null;
  } catch {
    return false;
  }
}

function scopeStorageKey(scopeKey) {
  return PREFIX + scopeKey;
}

/** Sanitize a raw prefs object into the strict shape (defaults for invalid values). */
export function sanitizePrefs(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PREFS };
  return {
    viewMode: VIEW_MODES.has(raw.viewMode) ? raw.viewMode : DEFAULT_PREFS.viewMode,
    sortBy: SORT_KEYS.has(raw.sortBy) ? raw.sortBy : DEFAULT_PREFS.sortBy,
    sortOrder: SORT_ORDERS.has(raw.sortOrder) ? raw.sortOrder : DEFAULT_PREFS.sortOrder,
  };
}

/** Load prefs for one directory under a scope. Always returns a sanitized copy. */
export function loadDirPrefs(scopeKey, path) {
  if (!storageAvailable()) return { ...DEFAULT_PREFS };
  try {
    const raw = sessionStorage.getItem(scopeStorageKey(scopeKey));
    if (!raw) return { ...DEFAULT_PREFS };
    const doc = JSON.parse(raw);
    if (!doc || typeof doc !== 'object') return { ...DEFAULT_PREFS };
    return sanitizePrefs(doc[path]);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/** Merge `patch` into the prefs of one directory under a scope. */
export function saveDirPrefs(scopeKey, path, patch) {
  if (!storageAvailable()) return;
  try {
    const key = scopeStorageKey(scopeKey);
    // Object.create(null) so a directory literally named `__proto__` is a
    // plain own-property, not a silent trip through the prototype chain.
    let doc = Object.create(null);
    const raw = sessionStorage.getItem(key);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') doc = Object.assign(Object.create(null), parsed);
      } catch {
        doc = Object.create(null);
      }
    }
    doc[path] = sanitizePrefs({ ...(doc[path] || {}), ...(patch || {}) });
    sessionStorage.setItem(key, JSON.stringify(doc));
  } catch {
    // Quota / private mode — silently skip; prefs are a nice-to-have.
  }
}

/**
 * Cache key for the in-memory directory listing cache. Default-order listings
 * share the raw path key with the modal's left tree (which always lists in
 * the default order); any non-default sort rides on its own key so the tree
 * and the grid never pollute each other's cached entries. The separator is
 * the NUL escape sequence, which cannot appear in any POSIX or Windows path,
 * so no real directory name can ever collide with the sort suffix.
 */
export function dirCacheKey(path, sortBy, sortOrder) {
  if (sortBy === 'name' && sortOrder === 'asc') return path;
  // NUL separator via fromCharCode — POSIX and Windows both forbid NUL in
  // path names, so no real directory can collide with the sort suffix. The
  // source keeps the NUL as a fromCharCode call (not a raw byte) so the file
  // stays grep-able and passes lint:control-bytes.
  const NUL = String.fromCharCode(0);
  return `${path}${NUL}${sortBy}${NUL}${sortOrder}`;
}
