/**
 * Viewed-workspace persistence (multi-project parallel view, 2026-10).
 *
 * When the user switches the main view to a parallel project (header chip/tab
 * click), the client scopes the SSE feed to `/events?project=<p>&instance=<i>`
 * and renders THAT project's conversation. A page refresh used to reset the
 * view back to the bound project (`viewedProject`/`viewedInstance` initialize
 * to null), losing the workspace the user was looking at. This module records
 * the last-viewed workspace in localStorage and provides the pure resolver
 * that validates a saved scope against a fresh `/api/live-processes` snapshot
 * at boot, so a refresh restores the same workspace — or falls back to the
 * bound project when the saved one is gone or ambiguous.
 *
 * Payload: `{ project, instanceKey, cwd, ts }`. `instanceKey` is minted per
 * PTY spawn (`ccv-<hex>`) and dies with its process; `cwd` is the restart-
 * stable disambiguation anchor used to re-resolve the same project to its new
 * instanceKey. Same-basename projects are NEVER restored by name alone when
 * 2+ live rows share the name (the server 400s on ambiguous name-only views).
 * `ts` is recorded for a potential future staleness heuristic; the restore
 * path does NOT read it today (the `/api/live-processes` re-validation is the
 * real freshness guard), so it is currently inert.
 *
 * Pure + dependency-free (no DOM/React) so it is directly node-testable
 * (house precedent: utils/viewStateCache.js, utils/resumeSessions.js). The
 * `storage` parameter is the node-test seam (injected fake localStorage).
 */

export const VIEWED_WORKSPACE_KEY = 'ccv_viewedWorkspace';

function defaultStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function asStringOrNull(v) {
  return typeof v === 'string' && v ? v : null;
}

/** Read and validate the persisted entry. Returns
 *  `{ project, instanceKey, cwd, ts }` or null (missing / malformed / no
 *  project). Defensive: any non-string field is normalized to null. */
export function readViewedWorkspace(storage = defaultStorage()) {
  if (!storage) return null;
  let raw = null;
  try {
    raw = storage.getItem(VIEWED_WORKSPACE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const project = asStringOrNull(parsed.project);
  if (!project) return null;
  return {
    project,
    instanceKey: asStringOrNull(parsed.instanceKey),
    cwd: asStringOrNull(parsed.cwd),
    ts: typeof parsed.ts === 'number' && Number.isFinite(parsed.ts) ? parsed.ts : null,
  };
}

/** Persist the viewed workspace. Best-effort: localStorage failures (quota,
 *  private mode) are benign and stay silent (CLAUDE.md). */
export function writeViewedWorkspace(entry, storage = defaultStorage()) {
  if (!storage || !entry || typeof entry.project !== 'string' || !entry.project) return;
  const payload = {
    project: entry.project,
    instanceKey: asStringOrNull(entry.instanceKey),
    cwd: asStringOrNull(entry.cwd),
    ts: typeof entry.ts === 'number' && Number.isFinite(entry.ts) ? entry.ts : null,
  };
  try {
    storage.setItem(VIEWED_WORKSPACE_KEY, JSON.stringify(payload));
  } catch {}
}

/** Clear the persisted entry (view returned to the bound project). */
export function clearViewedWorkspace(storage = defaultStorage()) {
  if (!storage) return;
  try {
    storage.removeItem(VIEWED_WORKSPACE_KEY);
  } catch {}
}

/**
 * Validate a saved scope against a live-processes snapshot.
 *
 * @param saved  `{ project, instanceKey, cwd }` from readViewedWorkspace()
 *               (null-safe).
 * @param live   `{ processes, currentProject, currentInstanceKey }` — the
 *               relevant fields of a GET /api/live-processes response.
 * @returns      `{ project, instance }` to restore, or null to fall back to
 *               the bound view.
 *
 * Decision table (ambiguity NEVER guesses by name):
 *  - no matching live row                              -> null (project gone)
 *  - saved scope IS the bound project's own live
 *    instance (project === currentProject AND
 *    instanceKey === currentInstanceKey)               -> null (bound view)
 *  - exact instanceKey alive                           -> { project, instance: saved.instanceKey }
 *  - instance dead + cwd matches a live row            -> re-resolve to that row's instanceKey
 *  - instance dead + no cwd hit + exactly 1 live row
 *    with a different name than the bound project      -> { project, instance: null }
 *  - no saved instance + exactly 1 live row with a
 *    different name than the bound project             -> { project, instance: null }
 *  - everything else (same-name ambiguity / it IS the
 *    bound project)                                    -> null (bound view)
 */
export function resolveRestoredViewScope(saved, live) {
  if (!saved || typeof saved.project !== 'string' || !saved.project) return null;
  const processes = live && Array.isArray(live.processes) ? live.processes : [];
  const currentProject = live && typeof live.currentProject === 'string' ? live.currentProject : '';
  const currentInstanceKey = live && typeof live.currentInstanceKey === 'string' ? live.currentInstanceKey : '';
  const rows = processes.filter((p) => p && p.project === saved.project);
  if (rows.length === 0) return null;

  const savedInstance = asStringOrNull(saved.instanceKey);
  const savedCwd = asStringOrNull(saved.cwd);

  // The saved scope IS the bound project's own live instance: nothing to
  // "restore" — the bound view is the default boot, so fall back to it rather
  // than resurrecting the bound project as a spurious parallel view.
  const isBoundInstance = saved.project === currentProject
    && savedInstance
    && currentInstanceKey
    && savedInstance === currentInstanceKey;

  if (savedInstance) {
    // Exact instance still alive: restore that precise view (equivalent to
    // what the user was watching before the refresh) — unless it is the bound
    // project's own instance (handled above).
    if (isBoundInstance) return null;
    const exact = rows.find((p) => asStringOrNull(p.instanceKey) === savedInstance);
    if (exact) return { project: saved.project, instance: savedInstance };

    // Instance died (process/server restart re-mints instanceKeys): re-resolve
    // by cwd, which is immutable for a project directory.
    if (savedCwd) {
      const byCwd = rows.find((p) => typeof p.cwd === 'string' && p.cwd === savedCwd);
      if (byCwd) {
        const key = asStringOrNull(byCwd.instanceKey);
        return { project: saved.project, instance: key || null };
      }
    }

    // No cwd anchor: name-only restore only when the name is unambiguous AND
    // it is not the bound project itself (restoring the bound project as a
    // "parallel view" would be wrong — the bound view is the default).
    if (rows.length === 1 && saved.project !== currentProject) {
      return { project: saved.project, instance: null };
    }
    return null;
  }

  // Legacy instance-agnostic entry: single live row and not the bound name.
  if (rows.length === 1 && saved.project !== currentProject) {
    return { project: saved.project, instance: null };
  }
  return null;
}

/**
 * Resolve the cwd for a chosen view from the header-reported tab list
 * (`this._lastProjectTabs`, rows carry `cwd`). Chip/tab click payloads often
 * lack cwd; the tab list is the authoritative source and avoids touching any
 * header payloads. Returns null when the view is not found.
 */
export function resolveCwdForView(project, instanceKey, tabs) {
  if (typeof project !== 'string' || !project || !Array.isArray(tabs)) return null;
  const wantInstance = asStringOrNull(instanceKey);
  const hit = tabs.find((t) => {
    if (!t || t.project !== project) return false;
    if (!wantInstance) return true;
    return asStringOrNull(t.instanceKey) === wantInstance;
  });
  return hit && typeof hit.cwd === 'string' && hit.cwd ? hit.cwd : null;
}
