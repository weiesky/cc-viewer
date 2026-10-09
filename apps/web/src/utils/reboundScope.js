/**
 * Bound-project rebind gate (2026-10).
 *
 * When the BOUND project's PTY is closed and a survivor exists, the server
 * re-binds its workspace identity and broadcasts
 * `workspace_started(rebound:true, reboundFrom:<old project name>)` to EVERY
 * SSE client (routes/resume.js — the fan-out is not view-scoped). Only the
 * clients actually sitting in that project's view domain are affected: their
 * SSE connection is stamped with the old bound name (`res._ccvViewProject` is
 * frozen at connect time, events.js) and would never receive the survivor's
 * live feed, so they must hard-reset and re-scope.
 *
 * A tab viewing an UNRELATED project (a parallel-project view, or an attached
 * history session of a third project) keeps its own scope untouched by the
 * server, so it must NOT be force-detached, blanked, or dragged to the
 * survivor — that would wipe its transcript and its live feed mid-stream.
 *
 * The tab's effective scope name is `viewedProject || projectName`: an attach
 * always carries its owning project in `viewedProject` (AppBase), and a null
 * viewedProject means the bound project itself.
 *
 * @param {object} o
 * @param {*}      o.rebound      the broadcast's `data.rebound` marker
 * @param {*}      o.reboundFrom  the broadcast's `data.reboundFrom` (old bound name)
 * @param {string} o.projectName  this tab's bound project name
 * @param {string} [o.viewedProject] this tab's parallel/attached project, if any
 * @returns {boolean} true when this tab must hard-reset + reconnect
 */
export function reboundAffectsView({ rebound, reboundFrom, projectName, viewedProject }) {
  if (rebound !== true) return false;
  // A server that predates the gate sends rebound:true with no reboundFrom.
  // Preserve the pre-gate behavior (every client re-scopes) rather than risk
  // leaving an affected tab with a blank pane and a stale scope stamp.
  if (typeof reboundFrom !== 'string' || !reboundFrom) return true;
  return (viewedProject || projectName || '') === reboundFrom;
}
