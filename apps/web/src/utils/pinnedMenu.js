// Pinned-state logic for the hamburger menu's "pin → shortcut" feature.
// Authoritative persistence: server-side preferences.json (`pinnedMenuKeys`, a real string
// array, order = pin chronology) via the /api/preferences channel. The legacy localStorage
// key `ccv_pinnedMenuKeys` (a JSON string) now serves only as the one-shot migration source.
// Pure functions only: parse / toggle / normalize / resolve; all I/O stays in AppHeader.

export const PINNED_KEY = 'ccv_pinnedMenuKeys';

// Parse a legacy localStorage raw string → string[].
// Any anomaly (null / non-JSON / non-array) degrades to []; non-string elements are dropped
// and duplicates removed.
export function parsePinned(raw) {
  if (typeof raw !== 'string' || raw === '') return [];
  let arr;
  try {
    arr = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  return normalizePinnedKeys(arr);
}

// Toggle one key's pinned state: remove if present, append to the end otherwise
// (insertion order is preserved). Returns a new array (input is not mutated), normalized.
export function togglePinned(arr, key) {
  const list = normalizePinnedKeys(arr);
  if (typeof key !== 'string' || key === '') return list;
  if (list.includes(key)) return list.filter(k => k !== key);
  return [...list, key];
}

// Normalize any input into a deduped array of non-empty strings. Shared by the preferences
// array (authoritative) and the legacy JSON string (after parsePinned) so dirty data never
// propagates into state.
export function normalizePinnedKeys(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    if (typeof item !== 'string' || item === '') continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

// Authoritative resolve on hydrate: a preferences array wins (empty array = the user cleared
// every pin — still authoritative, no fallback); only a non-array / absent value falls back
// to the legacy localStorage string. migrated=true iff the keys came from a non-empty legacy
// value, which tells the caller to write them back to preferences and clear the legacy key.
export function resolvePinnedKeys(prefsValue, legacyRaw) {
  if (Array.isArray(prefsValue)) return { keys: normalizePinnedKeys(prefsValue), migrated: false };
  const keys = parsePinned(legacyRaw);
  return { keys, migrated: keys.length > 0 };
}
