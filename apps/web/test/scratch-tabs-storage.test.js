// scratchTabsStorage (per-workspace scratch tab groups, 2026-10-12) — pure-module tests
// with an injected storage seam (house precedent: fileExpandedPathsStorage.test.js).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCRATCH_TAB_MAX,
  LEGACY_TABS_KEY,
  LEGACY_ACTIVE_KEY,
  MIGRATED_KEY,
  PENDING_TABS_KEY,
  PENDING_ACTIVE_KEY,
  normalizeScratchProject,
  groupKeyOf,
  isPendingGroupKey,
  tabsKeyFor,
  activeKeyFor,
  genScratchTabId,
  parseScratchTabs,
  loadScratchGroup,
  persistScratchGroup,
  claimLegacyScratch,
  mergePendingScratchGroup,
} from '../src/utils/scratchTabsStorage.js';

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

function makeThrowingStorage() {
  return {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); },
  };
}

describe('scratchTabsStorage: keys & normalization', () => {
  it('normalizeScratchProject maps empty/non-string to null', () => {
    assert.equal(normalizeScratchProject('proj'), 'proj');
    assert.equal(normalizeScratchProject(''), null);
    assert.equal(normalizeScratchProject(null), null);
    assert.equal(normalizeScratchProject(undefined), null);
    assert.equal(normalizeScratchProject(42), null);
  });

  it('groupKeyOf joins project+instance with NUL (same-basename twin precedent)', () => {
    assert.equal(groupKeyOf('proj', 'ccv-ab12'), 'proj\x00ccv-ab12');
    assert.equal(groupKeyOf('proj', null), 'proj');
    assert.equal(groupKeyOf('proj', ''), 'proj');
    assert.equal(groupKeyOf(null, 'ccv-ab12'), '');
    assert.equal(groupKeyOf('', ''), '');
    assert.equal(isPendingGroupKey(groupKeyOf(null, null)), true);
    assert.equal(isPendingGroupKey(groupKeyOf('proj', null)), false);
  });

  it('unnamed (pending) group uses dedicated pending keys; named groups use prefixed keys', () => {
    assert.equal(tabsKeyFor(''), PENDING_TABS_KEY);
    assert.equal(activeKeyFor(''), PENDING_ACTIVE_KEY);
    assert.equal(tabsKeyFor('proj'), 'cc-viewer-scratch-tabs:proj');
    assert.equal(activeKeyFor('proj'), 'cc-viewer-scratch-active-tab:proj');
    // Pending keys are NOT the legacy keys — the boot bucket must not collide with the
    // pre-feature global archive (review finding: collision leaked pending ids into
    // unvisited workspaces via legacy adoption).
    assert.notEqual(tabsKeyFor(''), LEGACY_TABS_KEY);
    assert.notEqual(activeKeyFor(''), LEGACY_ACTIVE_KEY);
    // Instance-qualified groups get distinct keys.
    assert.notEqual(tabsKeyFor('proj\x00ccv-ab12'), tabsKeyFor('proj'));
  });
});

describe('scratchTabsStorage: genScratchTabId & parseScratchTabs', () => {
  it('genScratchTabId produces server-compatible ids', () => {
    const id = genScratchTabId();
    assert.match(id, /^[A-Za-z0-9_-]{1,64}$/);
    assert.notEqual(genScratchTabId(), genScratchTabId());
  });

  it('parseScratchTabs validates ids and caps at SCRATCH_TAB_MAX', () => {
    assert.deepEqual(parseScratchTabs(null), []);
    assert.deepEqual(parseScratchTabs('not json'), []);
    assert.deepEqual(parseScratchTabs('{"a":1}'), []);
    assert.deepEqual(parseScratchTabs('[{"id":"bad id!"},{"id":"ok-1"}]'), [{ id: 'ok-1' }]);
    const many = Array.from({ length: SCRATCH_TAB_MAX + 5 }, (_, i) => ({ id: `t-${i}` }));
    assert.equal(parseScratchTabs(JSON.stringify(many)).length, SCRATCH_TAB_MAX);
  });
});

describe('scratchTabsStorage: persist & load round trip', () => {
  it('per-group isolation: A invisible to B; active id validated', () => {
    const s = makeStorage();
    persistScratchGroup('A', [{ id: 't-1' }, { id: 't-2' }], 't-2', s);
    persistScratchGroup('B', [{ id: 't-9' }], 't-9', s);
    assert.deepEqual(loadScratchGroup('A', s).tabs, [{ id: 't-1' }, { id: 't-2' }]);
    assert.equal(loadScratchGroup('A', s).activeId, 't-2');
    assert.deepEqual(loadScratchGroup('B', s).tabs, [{ id: 't-9' }]);
    assert.equal(loadScratchGroup('C', s).tabs.length, 0);
  });

  it('invalid stored active id falls back to the first tab', () => {
    const s = makeStorage({
      'cc-viewer-scratch-tabs:A': JSON.stringify([{ id: 't-1' }, { id: 't-2' }]),
      'cc-viewer-scratch-active-tab:A': 't-gone',
    });
    assert.equal(loadScratchGroup('A', s).activeId, 't-1');
  });

  it('persist is a no-op for empty tab lists (never wipes a group)', () => {
    const s = makeStorage({
      'cc-viewer-scratch-tabs:A': JSON.stringify([{ id: 't-1' }]),
    });
    persistScratchGroup('A', [], '', s);
    assert.equal(s.getItem('cc-viewer-scratch-tabs:A'), JSON.stringify([{ id: 't-1' }]));
  });

  it('pending group reads/writes the pending keys exactly (never the legacy keys)', () => {
    const s = makeStorage();
    persistScratchGroup('', [{ id: 't-1' }], 't-1', s);
    assert.equal(s.getItem(PENDING_TABS_KEY), JSON.stringify([{ id: 't-1' }]));
    assert.equal(s.getItem(LEGACY_TABS_KEY), null, 'pending writes must not touch the legacy archive');
    assert.equal(loadScratchGroup('', s).tabs.length, 1);
  });
});

describe('scratchTabsStorage: legacy one-time adoption', () => {
  it('first named group adopts legacy tabs; claim removes legacy keys; second group gets none', () => {
    const s = makeStorage({
      [LEGACY_TABS_KEY]: JSON.stringify([{ id: 't-old' }]),
      [LEGACY_ACTIVE_KEY]: 't-old',
    });
    const g1 = loadScratchGroup('A', s);
    assert.equal(g1.migratedFromLegacy, true);
    assert.deepEqual(g1.tabs, [{ id: 't-old' }]);
    persistScratchGroup('A', g1.tabs, g1.activeId, s);
    claimLegacyScratch(s);
    assert.equal(s.getItem(MIGRATED_KEY), 'true');
    assert.equal(s.getItem(LEGACY_TABS_KEY), null);
    // A second named group must NOT re-adopt anything.
    const g2 = loadScratchGroup('B', s);
    assert.equal(g2.migratedFromLegacy, false);
    assert.equal(g2.tabs.length, 0);
    // claimLegacyScratch is idempotent.
    claimLegacyScratch(s);
    assert.equal(s.getItem(MIGRATED_KEY), 'true');
  });

  it('an existing named group wins over legacy (no adoption)', () => {
    const s = makeStorage({
      [LEGACY_TABS_KEY]: JSON.stringify([{ id: 't-old' }]),
      'cc-viewer-scratch-tabs:A': JSON.stringify([{ id: 't-new' }]),
    });
    const g = loadScratchGroup('A', s);
    assert.equal(g.migratedFromLegacy, false);
    assert.deepEqual(g.tabs, [{ id: 't-new' }]);
  });

  it('pending tabs are NOT adopted as legacy (boot bucket never leaks into an unvisited workspace)', () => {
    const s = makeStorage({
      [PENDING_TABS_KEY]: JSON.stringify([{ id: 't-boot' }]),
      [PENDING_ACTIVE_KEY]: 't-boot',
      [LEGACY_TABS_KEY]: JSON.stringify([{ id: 't-old' }]),
      [LEGACY_ACTIVE_KEY]: 't-old',
    });
    const g = loadScratchGroup('A', s);
    assert.equal(g.migratedFromLegacy, true);
    assert.deepEqual(g.tabs, [{ id: 't-old' }], 'adoption must read the legacy pair, not the pending bucket');
  });
});

describe('scratchTabsStorage: pending merge (boot null→named swap)', () => {
  it('empty named group adopts the pending tabs (first-ever boot is a no-op swap)', () => {
    const s = makeStorage({
      [PENDING_TABS_KEY]: JSON.stringify([{ id: 't-boot' }, { id: 't-boot2' }]),
      [PENDING_ACTIVE_KEY]: 't-boot2',
    });
    const g = mergePendingScratchGroup('proj', s);
    assert.deepEqual(g.tabs, [{ id: 't-boot' }, { id: 't-boot2' }]);
    assert.equal(g.activeId, 't-boot2');
    assert.equal(g.migratedFromLegacy, false);
    assert.equal(s.getItem(PENDING_TABS_KEY), null, 'pending bucket must be single-use');
    assert.equal(s.getItem(PENDING_ACTIVE_KEY), null);
    // The merged group is persisted under the named key.
    assert.equal(s.getItem('cc-viewer-scratch-tabs:proj'), JSON.stringify([{ id: 't-boot' }, { id: 't-boot2' }]));
  });

  it('steady-state boot: the named group wins, the stray pending tab is dropped and cleared', () => {
    const s = makeStorage({
      'cc-viewer-scratch-tabs:proj': JSON.stringify([{ id: 't-real' }, { id: 't-real2' }]),
      'cc-viewer-scratch-active-tab:proj': 't-real2',
      [PENDING_TABS_KEY]: JSON.stringify([{ id: 't-stray' }]),
      [PENDING_ACTIVE_KEY]: 't-stray',
    });
    const g = mergePendingScratchGroup('proj', s);
    assert.deepEqual(g.tabs, [{ id: 't-real' }, { id: 't-real2' }], 'named group must win — no flash, no id swap');
    assert.equal(g.activeId, 't-real2');
    assert.equal(s.getItem(PENDING_TABS_KEY), null, 'stray pending bucket must be cleared');
    // The named group's stored form is untouched (no merge-written overwrite).
    assert.equal(s.getItem('cc-viewer-scratch-tabs:proj'), JSON.stringify([{ id: 't-real' }, { id: 't-real2' }]));
  });

  it('UPGRADE boot (named empty + ctor-seeded pending + legacy present) → legacy WINS over pending (no drift)', () => {
    // The exact real chain the reviewers probed: the ctor always seeds+persists a
    // pending tab before the swap, so pending is non-empty at merge time. If pending
    // outranked legacy, the pre-feature archive would strand and drift into whichever
    // OTHER workspace the user opens first. Legacy must win; pending is dropped.
    const s = makeStorage({
      [PENDING_TABS_KEY]: JSON.stringify([{ id: 't-seed' }]),
      [PENDING_ACTIVE_KEY]: 't-seed',
      [LEGACY_TABS_KEY]: JSON.stringify([{ id: 't-old1' }, { id: 't-old2' }]),
      [LEGACY_ACTIVE_KEY]: 't-old2',
    });
    const g = mergePendingScratchGroup('bound', s);
    assert.equal(g.migratedFromLegacy, true, 'upgrade boot must adopt the legacy archive');
    assert.deepEqual(g.tabs, [{ id: 't-old1' }, { id: 't-old2' }], 'legacy tabs must outrank the ctor seed');
    assert.equal(g.activeId, 't-old2');
    assert.equal(s.getItem(PENDING_TABS_KEY), null, 'ctor seed must be cleared');
    assert.equal(s.getItem('cc-viewer-scratch-tabs:bound'), JSON.stringify([{ id: 't-old1' }, { id: 't-old2' }]));
    // And the archive does NOT leak into a second workspace (caller claims it).
    claimLegacyScratch(s);
    const g2 = mergePendingScratchGroup('other', s);
    assert.equal(g2.migratedFromLegacy, false, 'second workspace must not re-adopt');
    assert.deepEqual(g2.tabs, [], 'second workspace gets no drifted tabs');
  });

  it('first-ever visit (named empty + pending present + NO legacy) → pending fills the group', () => {
    const s = makeStorage({
      [PENDING_TABS_KEY]: JSON.stringify([{ id: 't-boot' }, { id: 't-boot2' }]),
      [PENDING_ACTIVE_KEY]: 't-boot2',
    });
    const g = mergePendingScratchGroup('proj', s);
    assert.equal(g.migratedFromLegacy, false);
    assert.deepEqual(g.tabs, [{ id: 't-boot' }, { id: 't-boot2' }]);
    assert.equal(g.activeId, 't-boot2');
    assert.equal(s.getItem('cc-viewer-scratch-tabs:proj'), JSON.stringify([{ id: 't-boot' }, { id: 't-boot2' }]));
  });

  it('already-migrated marker set → pending fills even if a legacy archive is somehow present', () => {
    const s = makeStorage({
      [MIGRATED_KEY]: 'true',
      [PENDING_TABS_KEY]: JSON.stringify([{ id: 't-seed' }]),
      [LEGACY_TABS_KEY]: JSON.stringify([{ id: 't-old' }]),
    });
    const g = mergePendingScratchGroup('proj', s);
    assert.equal(g.migratedFromLegacy, false);
    assert.deepEqual(g.tabs, [{ id: 't-seed' }], 'claimed archive must never re-adopt');
  });

  it('named group beats the legacy archive (no adoption, archive stays)', () => {
    const s = makeStorage({
      'cc-viewer-scratch-tabs:proj': JSON.stringify([{ id: 't-real' }]),
      [LEGACY_TABS_KEY]: JSON.stringify([{ id: 't-legacy' }]),
    });
    const g = mergePendingScratchGroup('proj', s);
    assert.deepEqual(g.tabs, [{ id: 't-real' }]);
    assert.equal(g.migratedFromLegacy, false);
    assert.equal(s.getItem(LEGACY_TABS_KEY), JSON.stringify([{ id: 't-legacy' }]), 'archive must not be consumed');
  });

  it('no named + no pending + no legacy → empty (caller seeds a default tab)', () => {
    const s = makeStorage();
    const g = mergePendingScratchGroup('proj', s);
    assert.deepEqual(g, { tabs: [], activeId: '', migratedFromLegacy: false });
  });

  it('no-op for an empty named key', () => {
    const s = makeStorage({ [PENDING_TABS_KEY]: JSON.stringify([{ id: 't-boot' }]) });
    const g = mergePendingScratchGroup('', s);
    assert.deepEqual(g, { tabs: [], activeId: '', migratedFromLegacy: false });
    // Pending bucket preserved (nothing consumed it).
    assert.equal(s.getItem(PENDING_TABS_KEY), JSON.stringify([{ id: 't-boot' }]));
  });
});

describe('scratchTabsStorage: failure tolerance', () => {
  it('throwing storage stays silent and returns defaults', () => {
    const t = makeThrowingStorage();
    assert.deepEqual(loadScratchGroup('A', t), { tabs: [], activeId: '', migratedFromLegacy: false });
    persistScratchGroup('A', [{ id: 't-1' }], 't-1', t);
    claimLegacyScratch(t);
    mergePendingScratchGroup('A', t);
  });
});
