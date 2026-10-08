/**
 * Unit tests for src/utils/projectTabOrder.js — the user-defined tab order
 * persistence + merge helpers backing the header tab strip's drag-to-reorder.
 * Pure logic (no React, no DOM); localStorage access is shimmed via a stub
 * global so Node's test runner can exercise the storage-backed paths.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  readProjectTabOrder,
  writeProjectTabOrder,
  mergeProjectTabOrder,
  reorderProjectTabIds,
} from '../src/utils/projectTabOrder.js';

// Minimal in-memory localStorage shim — implements just getItem/setItem/removeItem,
// which is all projectTabOrder uses.
function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

describe('projectTabOrder storage', () => {
  beforeEach(() => {
    globalThis.localStorage = makeStorage();
  });

  it('returns [] when storage is empty', () => {
    assert.deepEqual(readProjectTabOrder(), []);
  });

  it('round-trips ids', () => {
    writeProjectTabOrder(['main:a', 'main:b', 'main:c']);
    assert.deepEqual(readProjectTabOrder(), ['main:a', 'main:b', 'main:c']);
  });

  it('returns [] on corrupt JSON', () => {
    globalThis.localStorage.setItem('ccv.projectTabOrder.v1', 'not-json{');
    assert.deepEqual(readProjectTabOrder(), []);
  });

  it('returns [] when ids field is missing or wrong type', () => {
    globalThis.localStorage.setItem('ccv.projectTabOrder.v1', JSON.stringify({ v: 1 }));
    assert.deepEqual(readProjectTabOrder(), []);
    globalThis.localStorage.setItem('ccv.projectTabOrder.v1', JSON.stringify({ v: 1, ids: 'not-array' }));
    assert.deepEqual(readProjectTabOrder(), []);
  });

  it('filters out non-string entries', () => {
    globalThis.localStorage.setItem('ccv.projectTabOrder.v1', JSON.stringify({ v: 1, ids: ['a', 1, null, 'b', undefined] }));
    assert.deepEqual(readProjectTabOrder(), ['a', 'b']);
  });

  it('returns [] for empty-string storage value', () => {
    globalThis.localStorage.setItem('ccv.projectTabOrder.v1', '');
    assert.deepEqual(readProjectTabOrder(), []);
  });

  it('returns [] for the literal string "null"', () => {
    globalThis.localStorage.setItem('ccv.projectTabOrder.v1', 'null');
    assert.deepEqual(readProjectTabOrder(), []);
  });

  it('returns [] for JSON null payload', () => {
    globalThis.localStorage.setItem('ccv.projectTabOrder.v1', JSON.stringify(null));
    assert.deepEqual(readProjectTabOrder(), []);
  });

  it('writeProjectTabOrder ignores non-array input', () => {
    writeProjectTabOrder('not-array');
    writeProjectTabOrder(null);
    assert.deepEqual(readProjectTabOrder(), []);
  });

  it('survives a throwing localStorage (privacy mode)', () => {
    globalThis.localStorage = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    };
    assert.deepEqual(readProjectTabOrder(), []);
    writeProjectTabOrder(['a']); // must not throw
  });
});

describe('mergeProjectTabOrder', () => {
  const T = (key, extra = {}) => ({ key, ...extra });

  it('returns fresh order when saved list is empty', () => {
    const tabs = [T('a'), T('b'), T('c')];
    assert.deepEqual(mergeProjectTabOrder(tabs, []).map((t) => t.key), ['a', 'b', 'c']);
  });

  it('applies the saved order', () => {
    const tabs = [T('a'), T('b'), T('c')];
    const out = mergeProjectTabOrder(tabs, ['c', 'a', 'b']);
    assert.deepEqual(out.map((t) => t.key), ['c', 'a', 'b']);
  });

  it('appends brand-new tabs at the end, preserving their poll order', () => {
    const tabs = [T('a'), T('b'), T('c'), T('d')];
    const out = mergeProjectTabOrder(tabs, ['b', 'a']);
    assert.deepEqual(out.map((t) => t.key), ['b', 'a', 'c', 'd']);
  });

  it('prunes saved ids that no longer exist in the fresh poll', () => {
    const tabs = [T('a'), T('c')];
    const out = mergeProjectTabOrder(tabs, ['c', 'b', 'a', 'x']);
    assert.deepEqual(out.map((t) => t.key), ['c', 'a']);
  });

  it('dedupes saved ids (first occurrence wins)', () => {
    const tabs = [T('a'), T('b')];
    const out = mergeProjectTabOrder(tabs, ['b', 'a', 'b']);
    assert.deepEqual(out.map((t) => t.key), ['b', 'a']);
  });

  it('returns [] when fresh tabs are empty', () => {
    assert.deepEqual(mergeProjectTabOrder([], ['a']), []);
  });

  it('does not mutate the input arrays', () => {
    const tabs = [T('a'), T('b'), T('c')];
    const saved = ['c', 'a'];
    const tabsBefore = tabs.map((t) => t.key);
    const savedBefore = saved.slice();
    mergeProjectTabOrder(tabs, saved);
    assert.deepEqual(tabs.map((t) => t.key), tabsBefore);
    assert.deepEqual(saved, savedBefore);
  });

  it('returns a fresh array even when nothing moved', () => {
    const tabs = [T('a'), T('b')];
    const out = mergeProjectTabOrder(tabs, ['a', 'b']);
    assert.notEqual(out, tabs);
    assert.deepEqual(out.map((t) => t.key), ['a', 'b']);
  });

  it('dedupes duplicate keys in the fresh tabs array (defends dnd-kit items)', () => {
    // If deriveProjectTabs regresses and emits two rows with the same key, the
    // internal `byKey` Map keeps the LAST occurrence. We assert the emitted
    // output has no duplicate key so dnd-kit's SortableContext items (which
    // require unique ids) stays well-formed.
    const tabs = [T('a', { tag: 1 }), T('b'), T('a', { tag: 2 })];
    const out = mergeProjectTabOrder(tabs, ['a', 'b']);
    const keys = out.map((t) => t.key);
    assert.deepEqual(keys, ['a', 'b']);
    assert.equal(new Set(keys).size, keys.length);
    // Map semantics: last write wins.
    assert.equal(out[0].tag, 2);
  });
});

describe('reorderProjectTabIds', () => {
  const T = (key) => ({ key });

  it('moves forward', () => {
    const tabs = [T('a'), T('b'), T('c'), T('d')];
    assert.deepEqual(reorderProjectTabIds(tabs, 'a', 'c'), ['b', 'c', 'a', 'd']);
  });

  it('moves backward', () => {
    const tabs = [T('a'), T('b'), T('c'), T('d')];
    assert.deepEqual(reorderProjectTabIds(tabs, 'd', 'b'), ['a', 'd', 'b', 'c']);
  });

  it('moves to the first position', () => {
    const tabs = [T('a'), T('b'), T('c')];
    assert.deepEqual(reorderProjectTabIds(tabs, 'c', 'a'), ['c', 'a', 'b']);
  });

  it('moves to the last position', () => {
    const tabs = [T('a'), T('b'), T('c')];
    assert.deepEqual(reorderProjectTabIds(tabs, 'a', 'c'), ['b', 'c', 'a']);
  });

  it('returns null when active === over (no-op drop)', () => {
    const tabs = [T('a'), T('b')];
    assert.equal(reorderProjectTabIds(tabs, 'a', 'a'), null);
  });

  it('returns null when either id is missing from the visible tabs', () => {
    const tabs = [T('a'), T('b')];
    assert.equal(reorderProjectTabIds(tabs, 'a', 'zz'), null);
    assert.equal(reorderProjectTabIds(tabs, 'zz', 'a'), null);
  });

  it('returns null on missing inputs', () => {
    assert.equal(reorderProjectTabIds(null, 'a', 'b'), null);
    assert.equal(reorderProjectTabIds([T('a')], '', 'a'), null);
    assert.equal(reorderProjectTabIds([T('a')], 'a', ''), null);
  });

  it('does not mutate the input tabs array', () => {
    const tabs = [T('a'), T('b'), T('c')];
    const before = tabs.map((t) => t.key);
    reorderProjectTabIds(tabs, 'a', 'c');
    assert.deepEqual(tabs.map((t) => t.key), before);
  });
});
