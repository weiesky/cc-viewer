/**
 * sdk-task-label.js — shared predicate for "does this task entry carry a
 * user-visible label?" Used by:
 *   - server `getSdkTaskSnapshot` (packages/app/server/lib/sdk-manager.js)
 *   - client `sdkTaskTracker.applySnapshot`      (apps/web/src/utils/sdkTaskTracker.js)
 *   - client `sdkTaskTracker.restoreFromStorage` (apps/web/src/utils/sdkTaskTracker.js)
 *
 * Field-name mapping (two names for the same concept, one per shape):
 *   wire / server table : description  = task title/text (started/progress frames)
 *                         summary      = terminal notification's result text
 *   client tracker      : subject      = task title/text    (from wire description)
 *                         description  = terminal result text (from wire summary)
 *
 * "Label-less" = no displayable label on any field. A row is label-less iff
 * NEITHER field has any displayable text (null/undefined/empty/whitespace-only).
 * Truthiness-based after trim — a `description: ''` or `summary: ''` is as
 * label-less as an absent field. NOTE: the HUD uses `||` for the label chain,
 * so a whitespace-only label that passes this predicate (because the OTHER
 * field has text) will render as blank — a known, deliberate asymmetry (the
 * fallback to `#id` is a last resort; we prefer a blank-but-real row to a
 * fabricated one).
 *
 * Realistic label-less origins (server side, post fold-bug fix):
 *   - a `task_updated` frame whose patch lacks `description` landing as the
 *     FIRST frame for its taskId (e.g. the server table was reset / evicted
 *     and a status-only update arrives for a still-running task);
 *   - a `task_notification` frame with NO summary and no description arriving
 *     without its task_started (a frame lost in a WS gap).
 * A `task_notification`-only entry WITH `summary` is NOT label-less — it is
 * exactly what the HUD fallback (`subject || description || #id`) relabels.
 *
 * Filter scope (post P2 decision): the label-less filter is applied to
 * TERMINAL entries only (`status` in {completed, failed, stopped, killed} on
 * the wire, `status` in {completed, failed} on the client). An in-flight
 * task whose only frames are status-only task_updated patches is still a
 * live task; filtering it would hide it from a reconnect replay with no way
 * for later deltas to re-label it.
 */

function _hasText(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

const _WIRE_TERMINAL = new Set(['completed', 'failed', 'stopped', 'killed']);
const _CLIENT_TERMINAL = new Set(['completed', 'failed']);

/**
 * Wire-shape predicate (server table entries / sdk-task-snapshot payloads).
 * @param {object} t - { description?, summary?, status?, terminal? }
 * @returns {boolean} true iff the entry has at least one displayable label
 *   field OR is not terminal (in-flight entries stay visible regardless).
 */
export function hasWireTaskLabel(t) {
  if (!t || typeof t !== 'object') return false;
  const terminal = t.terminal === true || _WIRE_TERMINAL.has(t.status);
  if (!terminal) return true; // in-flight rows stay regardless of label
  return _hasText(t.description) || _hasText(t.summary);
}

/**
 * Client-shape predicate (taskStore / sdkTaskTracker rows).
 * @param {object} t - { subject?, description?, status? }
 * @returns {boolean} true iff the row has at least one displayable label
 *   field OR is not terminal.
 */
export function hasTrackerTaskLabel(t) {
  if (!t || typeof t !== 'object') return false;
  if (!_CLIENT_TERMINAL.has(t.status)) return true; // in-flight rows stay
  return _hasText(t.subject) || _hasText(t.description);
}
