/**
 * Gap top-up for src/utils/contextSidebarNavigation.js
 *
 * test/context-sidebar-navigation.test.js covers the arrow moves and the
 * out-of-bounds → null case (via `?? null` on L12), but never hits the
 * "currentId is not in visibleIds" branch (currentIndex < 0 → L14-15 return null).
 * This file pins exactly that branch, for both arrow keys and an empty list.
 *
 * Pure function, no globals — direct static import.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getContextSidebarArrowNavigation } from '../src/utils/contextSidebarNavigation.js';

describe('getContextSidebarArrowNavigation — currentId absent from visibleIds (L14-15)', () => {
  const visibleIds = ['system__0', 'current-turn', 'tool__0'];

  it('returns null on ArrowDown when currentId is not present', () => {
    const r = getContextSidebarArrowNavigation({ currentId: 'ghost', visibleIds, key: 'ArrowDown' });
    assert.equal(r, null);
  });

  it('returns null on ArrowUp when currentId is not present', () => {
    const r = getContextSidebarArrowNavigation({ currentId: 'ghost', visibleIds, key: 'ArrowUp' });
    assert.equal(r, null);
  });

  it('returns null when visibleIds is empty (default [] also yields currentIndex -1)', () => {
    const r = getContextSidebarArrowNavigation({ currentId: 'anything', key: 'ArrowDown' });
    assert.equal(r, null);
  });

  it('still returns null for a non-arrow key even when currentId is absent', () => {
    const r = getContextSidebarArrowNavigation({ currentId: 'ghost', visibleIds, key: 'Enter' });
    assert.equal(r, null);
  });
});
