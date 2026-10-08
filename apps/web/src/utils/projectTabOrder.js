/**
 * User-defined project-tab order (2026-10-08).
 *
 * The tab strip polls /api/live-processes every 5s and deriveProjectTabs returns
 * the rows sorted by project name — so without an override, a user's drag would
 * be reverted on the next poll. This module persists the user's manual order in
 * localStorage and re-applies it to each fresh poll:
 *   - Tabs the user has ordered keep their relative position (by stable id).
 *   - Brand-new tabs (never seen in a saved order) append to the END in their
 *     poll-sorted order, so a freshly spawned project doesn't jump to the front.
 *   - Tabs that disappeared (process exited) are pruned from the saved order.
 *
 * Storage shape: { v: 1, ids: string[] } where each id is tab.key (`main:<id>`
 * from deriveProjectTabs — stable across polls for the same instanceKey or,
 * in legacy basename mode, the same project name).
 */

const STORAGE_KEY = 'ccv.projectTabOrder.v1';

/** Read the persisted order. Returns [] when unset/corrupt — callers treat
 *  an empty list as "no override, keep the poll's natural order". */
export function readProjectTabOrder() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return [];
    const ids = Array.isArray(parsed.ids) ? parsed.ids : null;
    if (!ids) return [];
    return ids.filter((x) => typeof x === 'string' && x);
  } catch {
    return [];
  }
}

/** Persist the order. Best-effort — quota/security errors are swallowed so a
 *  private-mode Safari session doesn't break the tab strip. */
export function writeProjectTabOrder(ids) {
  try {
    if (!Array.isArray(ids)) return;
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({ v: 1, ids }));
  } catch { /* benign: storage unavailable */ }
}

/**
 * Merge a fresh poll's tabs with the saved order.
 * @param {Array<{key:string}>} tabs - latest deriveProjectTabs rows.
 * @param {string[]} savedIds - readProjectTabOrder() output.
 * @returns {Array} new array, same row references, re-ordered.
 *
 * Algorithm:
 *   1. index fresh tabs by key.
 *   2. walk savedIds in order — emit the matching fresh tab if it still exists.
 *   3. walk fresh tabs — emit any not already emitted (the "new arrivals"),
 *      preserving their natural (poll) order at the tail.
 * Pure: input arrays are not mutated.
 */
export function mergeProjectTabOrder(tabs, savedIds) {
  const fresh = Array.isArray(tabs) ? tabs : [];
  if (!fresh.length) return [];
  if (!Array.isArray(savedIds) || !savedIds.length) return fresh.slice();
  const byKey = new Map(fresh.map((t) => [t.key, t]));
  const emitted = new Set();
  const out = [];
  for (const id of savedIds) {
    const t = byKey.get(id);
    if (t && !emitted.has(id)) { out.push(t); emitted.add(id); }
  }
  for (const t of fresh) {
    if (!emitted.has(t.key)) { out.push(t); emitted.add(t.key); }
  }
  return out;
}

/**
 * Move one tab to a new index, returning the new order of ids. Pure helper for
 * the drag-end handler — derives the next `ids` array from the CURRENT visible
 * order plus the (activeId, overId) pair dnd-kit reports.
 * @param {Array<{key:string}>} visibleTabs - tabs in their current visible order.
 * @param {string} activeId - tab.key being dragged.
 * @param {string} overId - tab.key the drag is hovering over (drop target).
 * @returns {string[]|null} new ids array, or null when the drop is a no-op.
 */
export function reorderProjectTabIds(visibleTabs, activeId, overId) {
  if (!Array.isArray(visibleTabs) || !activeId || !overId || activeId === overId) return null;
  const ids = visibleTabs.map((t) => t.key);
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0) return null;
  const next = ids.slice();
  next.splice(from, 1);
  next.splice(to, 0, activeId);
  return next;
}
