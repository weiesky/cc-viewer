/**
 * Navigation history stack for the file browser modal.
 *
 * Pure functions only (no React, no DOM) so the same module can be unit
 * tested with node:test and reused elsewhere.
 *
 * Model: an array of canonical navigation-root-relative paths plus a cursor
 * pointing at the "current" entry. Pushing while a forward branch exists
 * truncates that branch (browser-style linear history). Duplicate pushes of
 * the same path are no-ops so repeated navigations do not pile up entries.
 */

export const MAX_HISTORY = 100;

export function createHistory(initialPath = '') {
  return { entries: [initialPath], index: 0 };
}

export function currentPath(h) {
  return h.entries[h.index];
}

export function canBack(h) {
  return h.index > 0;
}

export function canForward(h) {
  return h.index < h.entries.length - 1;
}

/**
 * Push a new path. Truncates the forward branch, dedupes against the current
 * entry (same-path navigation is a no-op so state side-effects can still run
 * without growing the stack), and caps the stack at MAX_HISTORY by dropping
 * the oldest entry (cursor shifts to keep pointing at the same entry).
 */
export function pushPath(h, path) {
  if (path === currentPath(h)) return h;
  const entries = h.entries.slice(0, h.index + 1);
  entries.push(path);
  let index = entries.length - 1;
  if (entries.length > MAX_HISTORY) {
    entries.shift();
    index -= 1;
  }
  return { entries, index };
}

/** Replace the current entry without touching the rest of the stack. */
export function replaceCurrent(h, path) {
  if (path === currentPath(h)) return h;
  const entries = h.entries.slice();
  entries[h.index] = path;
  return dedupeAround(h, entries, h.index);
}

export function back(h) {
  if (!canBack(h)) return h;
  return { entries: h.entries, index: h.index - 1 };
}

export function forward(h) {
  if (!canForward(h)) return h;
  return { entries: h.entries, index: h.index + 1 };
}

/**
 * Remap every entry through `mapFn(path) -> newPath` (rename) or `null`
 * (delete the entry: a deleted ancestor strands its descendants — collapse
 * them to the root ''). Adjacent duplicates introduced by the remap are
 * collapsed; the cursor is clamped to the surviving entry nearest its prior
 * position. The forward branch is kept (it may still be valid for entries
 * the remap did not touch).
 */
export function remapAll(h, mapFn) {
  const mapped = h.entries.map(p => mapFn(p));
  const collapsedToRoot = mapped.map(p => (p === null ? '' : p));
  const entries = [];
  let index = 0;
  for (let i = 0; i < collapsedToRoot.length; i++) {
    const p = collapsedToRoot[i];
    if (entries.length > 0 && entries[entries.length - 1] === p) {
      if (i <= h.index) index = entries.length - 1;
      continue;
    }
    entries.push(p);
    if (i <= h.index) index = entries.length - 1;
  }
  if (entries.length === 0) entries.push('');
  if (index >= entries.length) index = entries.length - 1;
  return { entries, index };
}

function dedupeAround(h, entries, cursor) {
  const out = [];
  let index = 0;
  for (let i = 0; i < entries.length; i++) {
    const p = entries[i];
    if (out.length > 0 && out[out.length - 1] === p) {
      if (i <= cursor) index = out.length - 1;
      continue;
    }
    out.push(p);
    if (i <= cursor) index = out.length - 1;
  }
  return { entries: out, index };
}
