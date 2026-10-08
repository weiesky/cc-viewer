// Per-project view routing (2026-10), split out of server.js so the pure logic
// is unit-testable without the server singleton (same posture as resume-list.js).
//
// The server runs ONE V2LiveFeed per project (the bound project plus any project
// a client is VIEWING via /events?project=). Two pure questions recur:
//   1. which SSE clients should a given project's feed broadcast to, and
//   2. which project owns a given session dir (so writer activity reaches the
//      right feed).
// Both are pure and live here; server.js wires them to the live _projectName and
// the feed map.

/**
 * Filter an SSE client list to those whose VIEWED project is `project`.
 *
 * A client's viewed project is stamped on its SSE response (`res._ccvViewProject`)
 * by /events; unset means the bound project (the pre-view-layer default). So a
 * client belongs to `project` when (stamped project, defaulting to `boundProject`)
 * === `project`. With a single project active this reduces to "keep everyone" for
 * the bound feed (and "keep no one" for any other) — i.e. byte-identical to the
 * legacy broadcast-to-all behavior.
 *
 * @param {Array} clientList - SSE response objects (may carry `_ccvViewProject`).
 * @param {string} project - the feed's project name.
 * @param {string} boundProject - the server's bound project (`_projectName`).
 * @returns {Array} the subset of clients viewing `project` (same references).
 */
export function filterClientsByViewProject(clientList, project, boundProject) {
  if (!project) return clientList;
  const bound = boundProject || '';
  // Fast path: nothing to split when this IS the bound project AND no client is
  // viewing a different project (the overwhelmingly common case) — return the
  // SAME array reference (no filter alloc), preserving legacy identity.
  if (project === bound) {
    let anyForeign = false;
    for (const c of clientList) { if (c && c._ccvViewProject && c._ccvViewProject !== bound) { anyForeign = true; break; } }
    if (!anyForeign) return clientList;
  }
  return clientList.filter((c) => c && ((c._ccvViewProject || bound) === project));
}

/**
 * Extract the owning project dir name from a session dir path of the form
 * `<LOG_DIR>/<projectSan>/sessions/<dirName>`. Returns the on-disk `<projectSan>`
 * segment, or '' when `dir` is not under `<LOG_DIR>/`. Pure string parsing — the
 * caller maps the segment to a feed via its own key scheme.
 *
 * @param {string} dir - absolute session dir.
 * @param {string} logDir - LOG_DIR root (e.g. ~/.claude/cc-viewer).
 * @param {string} sep - path separator (injected for tests / win32).
 * @returns {string} the project dir name, or ''.
 */
export function projectOfSessionDir(dir, logDir, sep) {
  if (typeof dir !== 'string' || !dir || typeof logDir !== 'string' || !logDir) return '';
  const root = logDir.endsWith(sep) ? logDir : logDir + sep;
  if (!dir.startsWith(root)) return '';
  const rest = dir.slice(root.length);
  const projectSan = rest.split(sep)[0];
  return projectSan || '';
}

/**
 * Resolve which feed key owns writer activity for a session dir, and whether a
 * bound-feed fallback is allowed. Pure decision extracted from server.js's
 * `_feedForSessionDir` so the routing rule is behavior-testable (2026-10-05).
 *
 * Rule:
 *  - dir owns a project (`<LOG_DIR>/<projectSan>/...`): return that project's
 *    feed key and `allowBoundFallback:false`. When that project has no live
 *    feed the caller MUST drop the broadcast — never re-route a foreign
 *    project's activity to the bound project's viewers (the bleed).
 *  - dir owns no project (outside `<LOG_DIR>/`): `feedKey:null` and
 *    `allowBoundFallback:true` (legacy single-project behavior).
 *
 * @param {string} dir - absolute session dir.
 * @param {string} logDir - LOG_DIR root.
 * @param {string} sep - path separator.
 * @returns {{feedKey:string|null, allowBoundFallback:boolean}}
 */
export function resolveActivityFeedKey(dir, logDir, sep) {
  const projectSan = projectOfSessionDir(dir, logDir, sep);
  if (projectSan) return { feedKey: projectSan, allowBoundFallback: false };
  return { feedKey: null, allowBoundFallback: true };
}
