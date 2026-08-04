import React from 'react';
import { formatTeammateLabel } from './requestType';

/**
 * Late-identity healing helpers for ChatView.buildAllItems.
 *
 * Background: on a cold load the first build can run before identity data is
 * complete — the producer turn may be in-flight (excluded from the filtered
 * requests array) or split into the live tail, and the teammate-name registry
 * may not have scanned the lead's Agent tool_use yet. The resulting fallbacks
 * ("MainAgent" model identity, "Teammate: X" labels) get baked into cached
 * elements / scan entries and were previously frozen until a new MainAgent
 * turn replaced the session object. These helpers heal them on the next
 * buildAllItems tick instead.
 */

/**
 * Patch cached ChatMessage elements whose modelInfo was baked as null once the
 * request scan can resolve it. Mirrors refreshCachedItemProp: clones ONLY rows
 * that transition to a different resolved value, returns the SAME array
 * reference when nothing changed (React reconciler then skips everything).
 *
 * Strict-null marker: rows that display model identity always receive
 * `modelInfo` explicitly (null when unresolved); rows that never get the prop
 * have `undefined` and are skipped. Permanently-unresolvable rows stay null
 * and are re-checked cheaply each pass without cloning.
 *
 * Session-fallback rows: rows baked with the session-level model fallback
 * carry a `_fromSession: true` marker ON the modelInfo object (a per-session
 * wrapper around getModelInfo's cached ref) and stay heal-eligible so they
 * upgrade to the precise per-message model once the producer becomes
 * resolvable. The resolver passed here MUST be the precise one (NOT the
 * session-fallback wrapped one), or marked rows would "heal" back to the same
 * fallback. Precise resolutions come from getModelInfo's cache and never carry
 * the marker, so an upgraded row drops out of heal eligibility — the upgrade
 * clones each fallback row exactly once (same cost as today's null→resolved
 * heal), never churns.
 *
 * @param {Array} items - cached ChatMessage element array
 * @param {Function} resolveModelInfo - (ts, role) => modelInfo|null, closing
 *   over the CURRENT request-scan caches (precise resolver, no fallback)
 * @returns {Array} same array if clean, else a new array with healed clones
 */
export function refreshResolvedModelInfo(items, resolveModelInfo) {
  let dirty = false;
  const out = items.map((m) => {
    if (!m || !m.props || !m.props.timestamp) return m;
    const mi = m.props.modelInfo;
    if (mi !== null && !(mi && mi._fromSession)) return m;
    // Non-assistant rows (plan-prompt/teammate/task-notification) were
    // originally computed with msg.role 'user' — preserve that mapping.
    const role = m.props.role === 'assistant' ? 'assistant' : 'user';
    const next = resolveModelInfo(m.props.timestamp, role);
    // Defense-in-depth: a marked value here means a caller passed the session-fallback WRAPPED
    // resolver by mistake — treating it as a heal would clone marked rows forever (the clone
    // keeps the marker → eligible again next pass). Never "heal" to a fallback value.
    if (!next || next._fromSession) return m;
    dirty = true;
    return React.cloneElement(m, { modelInfo: next });
  });
  return dirty ? out : items;
}

/**
 * Heal teammate labels baked into _reqScanCache.subAgentEntries before
 * resolveTeammateNames had injected req.teammate. Entries carry the request
 * OBJECT reference (entry.req) — object identity survives filtered-array
 * rebuilds and mid-array insertions, unlike positional indices, which shift
 * exactly in the late-completing-spawn scenario this fix targets.
 *
 * Mutates entries in place (they live inside the scan cache). Also covers
 * id → real-name upgrades: heals whenever the freshly formatted label differs.
 *
 * @param {Array} entries - subAgentEntries ({ unresolved, req, label, ... })
 */
export function healUnresolvedTeammateEntries(entries) {
  for (const entry of entries) {
    if (!entry || !entry.unresolved || !entry.req || !entry.req.teammate) continue;
    // Wire-v3 entries carry the SERVER-side typeTag (via _v3Row). When the
    // tag has a real Teammate name (extractTeammateName / persisted agent
    // name), it may differ from req.teammate (the heuristic registry) —
    // overwriting would DOWNGRADE a good server label ("Teammate:
    // frontend-reviewer" → "Teammate: X"), so skip those. When the tag is
    // Teammate WITHOUT a name (old journals, no persisted agent), let the heal
    // upgrade from the registry's real name.
    const tag = entry.req._v3Row && entry.req._v3Row.typeTag;
    if (tag && tag.type === 'Teammate' && tag.subType) continue;
    const label = formatTeammateLabel(entry.req.teammate, entry.req.body?.model);
    if (label !== entry.label) entry.label = label;
    entry.unresolved = false;
  }
}

/**
 * Detects that the requests array changed IDENTITY under an incremental scan
 * cursor (mid-array insertion — e.g. an in-flight producer turn completing and
 * entering the filtered array before the cursor). Append-only growth keeps
 * requests[processedCount-1] identical, so this stays false on the hot path.
 * Accepted residual: a mid-array REPLACEMENT below the cursor with an
 * unchanged element at processedCount-1 does not fire — that can only leave a
 * stale token badge, not the identity bug.
 *
 * @returns {boolean} true when the caller must do a full scan-cache reset
 */
export function needsFullReqRescan(requests, processedCount, lastScannedReq) {
  if (!processedCount) return false;
  return requests[processedCount - 1] !== lastScannedReq;
}
