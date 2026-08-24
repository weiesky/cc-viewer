import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getContextSidebarArrowNavigation } from '../src/utils/contextSidebarNavigation.js';

describe('getContextSidebarArrowNavigation', () => {
  it('moves down across sections in visible order', () => {
    const result = getContextSidebarArrowNavigation({
      currentId: 'system__0',
      visibleIds: ['system__0', 'messages__history_toggle', 'current-step', 'tool__0', 'tool__1'],
      key: 'ArrowDown',
    });

    assert.equal(result, 'messages__history_toggle');
  });

  it('moves from the current step to the first tool item', () => {
    const result = getContextSidebarArrowNavigation({
      currentId: 'current-step',
      visibleIds: ['system__0', 'messages__history_toggle', 'current-step', 'tool__0', 'tool__1'],
      key: 'ArrowDown',
    });

    assert.equal(result, 'tool__0');
  });

  it('moves up from a tool item back to the current step', () => {
    const result = getContextSidebarArrowNavigation({
      currentId: 'tool__0',
      visibleIds: ['system__0', 'messages__history_toggle', 'current-step', 'tool__0', 'tool__1'],
      key: 'ArrowUp',
    });

    assert.equal(result, 'current-step');
  });

  it('moves between history items and current step when history is expanded', () => {
    const result = getContextSidebarArrowNavigation({
      currentId: 'step-18',
      visibleIds: ['system__0', 'messages__history_toggle', 'step-17', 'step-18', 'current-step', 'tool__0'],
      key: 'ArrowDown',
    });

    assert.equal(result, 'current-step');
  });

  it('moves from the current step to history toggle when history is collapsed', () => {
    const result = getContextSidebarArrowNavigation({
      currentId: 'current-step',
      visibleIds: ['system__0', 'messages__history_toggle', 'current-step', 'tool__0'],
      key: 'ArrowUp',
    });

    assert.equal(result, 'messages__history_toggle');
  });

  it('returns null when no move is possible', () => {
    const result = getContextSidebarArrowNavigation({
      currentId: 'tool__1',
      visibleIds: ['system__0', 'messages__history_toggle', 'current-step', 'tool__0', 'tool__1'],
      key: 'ArrowDown',
    });

    assert.equal(result, null);
  });
});
