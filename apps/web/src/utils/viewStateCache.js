/**
 * Per-project view-state cache (multi-project tab switching, 2026-10).
 *
 * When the user switches the main view between concurrently-running projects
 * (header tabs), the client used to throw away the departing project's entire
 * conversation state and cold-reload the target's window from scratch — the
 * "slow switch" half of the multi-project switch bug. This cache keeps a
 * bounded snapshot of each departing project's view state (in memory, keyed
 * by project name) so returning to a project restores instantly and only
 * fetches the missed delta via `/events?project=<p>&since=<lastTs>`.
 *
 * Design mirrors the deepseek-harness session-scope model: view state is
 * bound to its scope (the project) and survives view switches; a cursor
 * (lastTs timestamp) carries the resume point. Keying and the project-name
 * race mirror fileExpandedPathsStorage (`ccv_fileExpandedPaths:<project>`).
 *
 * Pure + dependency-free (no DOM/React) so it is directly node-testable
 * (house precedent: utils/resumeSessions.js).
 */

// Hard caps, both defensive: the project count matches the realistic live-tab
// count (each live main PTY is one project; 8 is generous), and the per-entry
// window matches the cold-load limit (AppBase wantProject branch: 400 desktop
// / 200 mobile) so a cached snapshot never holds more than a cold load would.
const MAX_PROJECTS = 8;
const DEFAULT_WINDOW = 400;

/** Newest entry timestamp of a snapshot — the `since` resume cursor.
 *  Prefers the v2 row tail (wireV3 list source); falls back to the newest
 *  timestamp-bearing request entry (mirrors AppBase's desktop-reconnect
 *  lastTs scan). Returns null when nothing carries a timestamp. */
function lastTsOf(viewState) {
  if (!viewState || typeof viewState !== 'object') return null;
  const rows = Array.isArray(viewState.v2Rows) ? viewState.v2Rows : [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const ts = rows[i] && rows[i].timestamp;
    if (typeof ts === 'string' && ts) return ts;
  }
  const reqs = Array.isArray(viewState.requests) ? viewState.requests : [];
  for (let i = reqs.length - 1; i >= 0; i--) {
    const ts = reqs[i] && reqs[i].timestamp;
    if (typeof ts === 'string' && ts) return ts;
  }
  return null;
}

function trimWindow(list, windowSize) {
  if (!Array.isArray(list)) return [];
  const w = Number.isInteger(windowSize) && windowSize > 0 ? windowSize : DEFAULT_WINDOW;
  return list.length > w ? list.slice(list.length - w) : list;
}

export function createViewStateCache({ maxProjects = MAX_PROJECTS, windowSize = DEFAULT_WINDOW } = {}) {
  /** Map<project, snapshot> — insertion order doubles as FIFO order. */
  const store = new Map();

  // Capture a departing project's view state. `viewState` may carry:
  // { requests, v2Rows, v2RowsMeta, mainAgentSessions, pinnedSessionTs,
  //   selectedIndex }. Requests/rows are tail-trimmed to the window; the
  // resume cursor (lastTs) is computed at snapshot time so a restore is a
  // plain lookup. A project with NO timestamp anywhere is still cached (the
  // view restores; the caller just cannot do a since-incremental resume and
  // falls back to a fresh cold load for correctness).
  function snapshot(project, viewState = {}) {
    if (!project || typeof project !== 'string') return false;
    if (store.has(project)) store.delete(project); // re-insert at tail (most-recent)
    const entry = {
      requests: trimWindow(viewState.requests, windowSize),
      v2Rows: trimWindow(viewState.v2Rows, windowSize),
      v2RowsMeta: viewState.v2RowsMeta && typeof viewState.v2RowsMeta === 'object' ? viewState.v2RowsMeta : { totalCount: 0, hasMore: false, oldestTs: '' },
      mainAgentSessions: Array.isArray(viewState.mainAgentSessions) ? viewState.mainAgentSessions : [],
      pinnedSessionTs: viewState.pinnedSessionTs || null,
      selectedIndex: Number.isInteger(viewState.selectedIndex) ? viewState.selectedIndex : null,
      snapshottedAt: Date.now(),
    };
    entry.lastTs = lastTsOf(entry);
    store.set(project, entry);
    while (store.size > maxProjects) {
      const oldest = store.keys().next().value;
      store.delete(oldest);
    }
    return true;
  }

  // The snapshot to restore for `project`, or null. Includes `lastTs` (resume
  // cursor) and `count` (the cached content size, for the `cc` guard param).
  // `cc` must be >0 or the server silently drops the incremental resume
  // (events.js requires cc>0) — so it counts BOTH requests and v2Rows: a
  // wireV3 rows-only snapshot (requests empty, rows present) would otherwise
  // report cc=0 and quietly lose the whole optimization while still painting
  // instantly.
  function restore(project) {
    const entry = store.get(project);
    if (!entry) return null;
    return { ...entry, count: Math.max(entry.requests.length, entry.v2Rows.length) };
  }

  function invalidate(project) { store.delete(project); }
  function clear() { store.clear(); }
  function size() { return store.size; }

  return { snapshot, restore, lastTsOf, invalidate, clear, size };
}
