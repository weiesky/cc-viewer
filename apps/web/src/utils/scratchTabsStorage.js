/**
 * Scratch (mini-terminal) per-workspace tab-group persistence (multi-project, 2026-10-12).
 *
 * Each viewed workspace owns an independent scratch tab group: switching away hides the
 * outgoing group (its server-side PTYs stay alive), switching back restores it. Groups
 * are stored under per-workspace localStorage keys.
 *
 * Three key families:
 *  - named:      `cc-viewer-scratch-tabs:<groupKey>` (one per workspace)
 *  - pending:    `cc-viewer-scratch-pending-tabs` — the boot bucket. TerminalPanel always
 *                constructs with viewProject === null (the name resolves asynchronously),
 *                so the first group lands here; the componentDidUpdate swap MERGES the
 *                first resolved named group from named > legacy > pending (named wins
 *                outright, pending only fills a genuinely empty group) and clears the
 *                pending bucket. Pending tabs never connect before the swap
 *                (allowBoundScope), so no bound-root stray shell is spawned or orphaned.
 *  - legacy:     `cc-viewer-scratch-tabs` (pre-feature global keys) — adopted ONCE by
 *                the first named group after an upgrade, then removed (MIGRATED_KEY).
 *
 * Group key: `project` or `project\x00instance` (the AppBase view-cache key precedent),
 * disambiguating same-basename twin instances. '' means "no workspace resolved yet".
 *
 * Pure + dependency-free (no DOM/React) so it is directly node-testable; the `storage`
 * parameter is the node-test seam (house precedent: utils/viewedWorkspaceStorage.js).
 */

export const SCRATCH_TAB_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const SCRATCH_TAB_MAX = 8;

export const LEGACY_TABS_KEY = 'cc-viewer-scratch-tabs';
export const LEGACY_ACTIVE_KEY = 'cc-viewer-scratch-active-tab';
export const MIGRATED_KEY = 'cc-viewer-scratch-migrated';
export const PENDING_TABS_KEY = 'cc-viewer-scratch-pending-tabs';
export const PENDING_ACTIVE_KEY = 'cc-viewer-scratch-pending-active-tab';
export const TABS_KEY_PREFIX = 'cc-viewer-scratch-tabs:';
export const ACTIVE_KEY_PREFIX = 'cc-viewer-scratch-active-tab:';

function defaultStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** Non-empty project name or null (bound/unnamed view). */
export function normalizeScratchProject(project) {
  return (typeof project === 'string' && project) ? project : null;
}

function normalizeInstance(instance) {
  return (typeof instance === 'string' && instance) ? instance : null;
}

/**
 * Group identity for storage + swap detection. `project\x00instance` when the view is
 * pinned to a specific live instance (same-basename twins), bare `project` otherwise,
 * '' for the not-yet-resolved (boot) view.
 */
export function groupKeyOf(project, instance) {
  const p = normalizeScratchProject(project);
  if (!p) return '';
  const i = normalizeInstance(instance);
  return i ? `${p}\x00${i}` : p;
}

/** A group is "pending" when it was created before any project name resolved (boot). */
export function isPendingGroupKey(groupKey) {
  return !groupKey;
}

export function tabsKeyFor(groupKey) {
  return groupKey ? TABS_KEY_PREFIX + groupKey : PENDING_TABS_KEY;
}

export function activeKeyFor(groupKey) {
  return groupKey ? ACTIVE_KEY_PREFIX + groupKey : PENDING_ACTIVE_KEY;
}

/** Tab id generator — moved verbatim from TerminalPanel (server SCRATCH_ID_RE compatible). */
export function genScratchTabId() {
  const rand = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID().replace(/-/g, '')
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return ('t-' + rand).slice(0, 64);
}

/** JSON → validated [{id}] capped at SCRATCH_TAB_MAX; never throws. */
export function parseScratchTabs(raw) {
  if (typeof raw !== 'string' || !raw) return [];
  let arr;
  try {
    arr = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const t of arr) {
    if (t && typeof t.id === 'string' && SCRATCH_TAB_ID_RE.test(t.id)) {
      out.push({ id: t.id });
      if (out.length >= SCRATCH_TAB_MAX) break;
    }
  }
  return out;
}

function readGroup(storage, groupKey) {
  let tabsRaw = null;
  let activeRaw = null;
  try {
    tabsRaw = storage.getItem(tabsKeyFor(groupKey));
    activeRaw = storage.getItem(activeKeyFor(groupKey));
  } catch {
    return null;
  }
  const tabs = parseScratchTabs(tabsRaw);
  if (tabs.length === 0) return null;
  const activeId = (typeof activeRaw === 'string' && tabs.some((t) => t.id === activeRaw))
    ? activeRaw
    : tabs[0].id;
  return { tabs, activeId };
}

/**
 * Load a workspace's tab group. Falls back to a one-time legacy adoption: when the
 * named group has nothing stored, the pre-feature global keys still hold tabs, and no
 * group has claimed them yet (MIGRATED_KEY), the legacy tabs become this group's.
 * The pending bucket is NOT part of the fallback chain — it merges on the boot swap
 * instead (mergePendingScratchGroup), so legacy adoption can never leak pending tab ids
 * into an unvisited workspace. Returns { tabs, activeId, migratedFromLegacy } — tabs
 * may be [] (caller seeds a default tab). All storage failures are benign-silent.
 */
export function loadScratchGroup(groupKey, storage = defaultStorage()) {
  const empty = { tabs: [], activeId: '', migratedFromLegacy: false };
  if (!storage) return empty;
  const hit = readGroup(storage, groupKey);
  if (hit) return { ...hit, migratedFromLegacy: false };
  // Legacy adoption only makes sense for a named group.
  if (!groupKey) return empty;
  let migrated = false;
  try {
    migrated = storage.getItem(MIGRATED_KEY) === 'true';
  } catch {
    return empty;
  }
  if (migrated) return empty;
  // Read the legacy pair directly (the pending bucket has its own keys now).
  let tabsRaw = null;
  let activeRaw = null;
  try {
    tabsRaw = storage.getItem(LEGACY_TABS_KEY);
    activeRaw = storage.getItem(LEGACY_ACTIVE_KEY);
  } catch {
    return empty;
  }
  const tabs = parseScratchTabs(tabsRaw);
  if (tabs.length === 0) return empty;
  const activeId = (typeof activeRaw === 'string' && tabs.some((t) => t.id === activeRaw))
    ? activeRaw
    : tabs[0].id;
  return { tabs, activeId, migratedFromLegacy: true };
}

/** Persist a group (tabs + active id together — every mutation writes both so unmount
 *  and crash paths never lose the latest state). No-op for empty tab lists. */
export function persistScratchGroup(groupKey, tabs, activeId, storage = defaultStorage()) {
  if (!storage) return;
  const list = Array.isArray(tabs) ? tabs.filter((t) => t && typeof t.id === 'string' && SCRATCH_TAB_ID_RE.test(t.id)) : [];
  if (list.length === 0) return;
  const active = (typeof activeId === 'string' && list.some((t) => t.id === activeId))
    ? activeId
    : list[0].id;
  try {
    storage.setItem(tabsKeyFor(groupKey), JSON.stringify(list));
    storage.setItem(activeKeyFor(groupKey), active);
  } catch {}
}

/** One-shot: mark the legacy keys as adopted and remove them. Idempotent. */
export function claimLegacyScratch(storage = defaultStorage()) {
  if (!storage) return;
  try {
    if (storage.getItem(MIGRATED_KEY) === 'true') return;
    storage.setItem(MIGRATED_KEY, 'true');
    storage.removeItem(LEGACY_TABS_KEY);
    storage.removeItem(LEGACY_ACTIVE_KEY);
  } catch {}
}

/**
 * Boot merge: the first resolved named group is assembled from up to three sources,
 * by priority: (1) the named group's own stored tabs, (2) the pre-feature legacy
 * archive (adopted once, then claimed), (3) the pending boot bucket. The pending bucket
 * is cleared unconditionally — it is single-use boot scaffolding.
 *
 * Why this ordering: the ctor always runs before the workspace name resolves, so EVERY
 * boot seeds+persists a pending tab. On a steady-state boot the named group wins and
 * the stray pending seed is dropped (no flash, no orphan — the pending ScratchTerminal
 * never connected, see TerminalPanel/ScratchTerminal allowBoundScope). On an UPGRADE
 * boot the pending tab is just the ctor's worthless fresh seed, so the legacy archive
 * (the user's real pre-feature tabs) must outrank it — otherwise the archive strands
 * and drifts into whichever OTHER workspace the user opens first. Pending fills the
 * group only on a genuine first-ever visit (no named, no legacy).
 *
 * Returns { tabs, activeId, migratedFromLegacy } of the merged named group (tabs may be
 * [] so the caller can seed). The caller claims the legacy archive when
 * migratedFromLegacy is true (claimLegacyScratch).
 */
export function mergePendingScratchGroup(namedKey, storage = defaultStorage()) {
  if (!storage || !namedKey) return { tabs: [], activeId: '', migratedFromLegacy: false };
  const named = readGroup(storage, namedKey);
  const pending = readGroup(storage, '');
  try {
    storage.removeItem(PENDING_TABS_KEY);
    storage.removeItem(PENDING_ACTIVE_KEY);
  } catch {}
  if (named && named.tabs.length > 0) {
    const activeId = named.tabs.some((t) => t.id === named.activeId) ? named.activeId : named.tabs[0].id;
    return { tabs: named.tabs, activeId, migratedFromLegacy: false };
  }
  // Named group is empty. The legacy archive outranks the pending bucket: on an
  // UPGRADE boot the pending tab is merely the ctor's fresh seed (worthless — the user
  // never chose it), while the legacy archive holds the user's real pre-feature tabs.
  // Letting pending win here would strand the archive to be adopted by whichever OTHER
  // workspace the user opens first (the drift this merge exists to prevent). Pending
  // wins only when there is no legacy to adopt (genuine first-ever visit).
  let legacyClaimed = false;
  try {
    legacyClaimed = storage.getItem(MIGRATED_KEY) !== 'true';
  } catch {}
  if (legacyClaimed) {
    let tabsRaw = null;
    let activeRaw = null;
    try {
      tabsRaw = storage.getItem(LEGACY_TABS_KEY);
      activeRaw = storage.getItem(LEGACY_ACTIVE_KEY);
    } catch {}
    const legacyTabs = parseScratchTabs(tabsRaw);
    if (legacyTabs.length > 0) {
      const activeId = (typeof activeRaw === 'string' && legacyTabs.some((t) => t.id === activeRaw))
        ? activeRaw
        : legacyTabs[0].id;
      persistScratchGroup(namedKey, legacyTabs, activeId, storage);
      return { tabs: legacyTabs, activeId, migratedFromLegacy: true };
    }
  }
  if (pending && pending.tabs.length > 0) {
    const activeId = pending.tabs.some((t) => t.id === pending.activeId) ? pending.activeId : pending.tabs[0].id;
    persistScratchGroup(namedKey, pending.tabs, activeId, storage);
    return { tabs: pending.tabs, activeId, migratedFromLegacy: false };
  }
  return { tabs: [], activeId: '', migratedFromLegacy: false };
}
