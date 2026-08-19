// CLIENT-SAFE: no node deps. Imported by src/ — do not add fs/process/node: imports.
// Approval-modal preferences merge logic.
//
// Lives here (not in voice-pack-manager) because it merges *generic* approvalModal
// fields (modalEnabled, soundEnabled, notifyOnlyWhenHidden) plus the voicePack subtree.
// voice-pack-manager.js stays focused on the file/audio backing store.
//
// Both server/routes/preferences.js (handles POST /api/preferences) and src/AppBase.jsx (hydrate +
// handleVoicePackChange) use this so the merge contract is single-sourced.

import { EVENT_KEYS } from './voice-pack-events.js';

// Whitelist guard: only keys from EVENT_KEYS land in the merged events map.
// Defense-in-depth against a malicious/buggy client posting `{ events: { constructor: ... } }`
// or other unexpected keys that would persist to preferences.json and surface in
// dropdown rendering().
function _filterEvents(events) {
  if (!events || typeof events !== 'object') return {};
  const out = {};
  for (const k of EVENT_KEYS) {
    if (k in events) out[k] = events[k];
  }
  return out;
}

/**
 * Deep-merge an incoming voicePack patch into the base voicePack subtree.
 * Pure function — no I/O, no reconcile. Caller decides whether to run a
 * reconcile pass over the result.
 *
 * Contract:
 *   - top-level fields (enabled, volume, …) shallow-merged
 *   - events map merged key-by-key, filtered through EVENT_KEYS whitelist
 *   - returns a new object; inputs untouched
 */
export function mergeVoicePackInto(baseVP, incVP) {
  const base = (baseVP && typeof baseVP === 'object') ? baseVP : {};
  if (!incVP || typeof incVP !== 'object') {
    // Still pass base.events through the whitelist so persisted-but-stale keys
    // get cleaned up on the next save.
    return { ...base, events: _filterEvents(base.events) };
  }
  const { events: incEvents, ...incRest } = incVP;
  const mergedEvents = {
    ..._filterEvents(base.events),
    ..._filterEvents(incEvents),
  };
  return { ...base, ...incRest, events: mergedEvents };
}

/**
 * Deep-merge an incoming approvalModal patch into the base approvalModal subtree.
 * Top-level approvalModal fields shallow-merge; the voicePack subtree goes
 * through mergeVoicePackInto.
 *
 * `reconcile` is an optional callback `(voicePack) => voicePack` — typically
 * voice-pack-manager.reconcileVoicePackPrefs(logDir, …) — applied to the
 * merged voicePack to strip references to audio ids that no longer exist on disk.
 */
export function mergeApprovalModalPrefs(baseAM, incAM, { reconcile = null } = {}) {
  if (!incAM || typeof incAM !== 'object') return baseAM;
  const base = (baseAM && typeof baseAM === 'object') ? baseAM : {};
  const { voicePack: incVP, ...incAMRest } = incAM;
  const merged = { ...base, ...incAMRest };
  if (incVP && typeof incVP === 'object') {
    merged.voicePack = mergeVoicePackInto(base.voicePack, incVP);
    if (typeof reconcile === 'function') {
      merged.voicePack = reconcile(merged.voicePack);
    }
  }
  return merged;
}
