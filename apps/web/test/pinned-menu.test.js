/**
 * Unit tests for src/utils/pinnedMenu.js
 * 纯 ESM、无依赖，直接 import。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PINNED_KEY, parsePinned, togglePinned, normalizePinnedKeys, resolvePinnedKeys } from '../src/utils/pinnedMenu.js';

describe('pinnedMenu', () => {
  it('exports the legacy localStorage key (migration source only)', () => {
    assert.equal(PINNED_KEY, 'ccv_pinnedMenuKeys');
  });

  describe('parsePinned', () => {
    it('parses a valid JSON array of strings', () => {
      assert.deepEqual(parsePinned('["a","b"]'), ['a', 'b']);
    });
    it('returns [] for null / non-string', () => {
      assert.deepEqual(parsePinned(null), []);
      assert.deepEqual(parsePinned(undefined), []);
      assert.deepEqual(parsePinned(123), []);
      assert.deepEqual(parsePinned(''), []);
    });
    it('returns [] for non-JSON garbage', () => {
      assert.deepEqual(parsePinned('not json'), []);
      assert.deepEqual(parsePinned('{'), []);
    });
    it('returns [] when parsed value is not an array', () => {
      assert.deepEqual(parsePinned('{"a":1}'), []);
      assert.deepEqual(parsePinned('"a"'), []);
      assert.deepEqual(parsePinned('42'), []);
    });
    it('drops non-string / empty elements and dedupes', () => {
      assert.deepEqual(parsePinned('["a",1,null,"","a","b"]'), ['a', 'b']);
    });
  });

  describe('togglePinned', () => {
    it('appends a missing key to the end (insertion order)', () => {
      assert.deepEqual(togglePinned(['a'], 'b'), ['a', 'b']);
    });
    it('removes an existing key', () => {
      assert.deepEqual(togglePinned(['a', 'b', 'c'], 'b'), ['a', 'c']);
    });
    it('does not mutate the input array', () => {
      const input = ['a'];
      togglePinned(input, 'b');
      assert.deepEqual(input, ['a']);
    });
    it('normalizes dirty input (dedupe + drop non-strings) before toggling', () => {
      assert.deepEqual(togglePinned(['a', 'a', 1, null], 'b'), ['a', 'b']);
    });
    it('handles non-array input gracefully', () => {
      assert.deepEqual(togglePinned(null, 'a'), ['a']);
    });
    it('ignores empty / non-string keys', () => {
      assert.deepEqual(togglePinned(['a'], ''), ['a']);
      assert.deepEqual(togglePinned(['a'], null), ['a']);
    });
  });

  describe('normalizePinnedKeys', () => {
    it('returns [] for non-array input', () => {
      assert.deepEqual(normalizePinnedKeys(null), []);
      assert.deepEqual(normalizePinnedKeys('["a"]'), []);
      assert.deepEqual(normalizePinnedKeys({}), []);
    });
    it('drops non-string / empty elements and dedupes', () => {
      assert.deepEqual(normalizePinnedKeys(['a', 1, null, '', 'a', 'b']), ['a', 'b']);
    });
    it('returns a new array (no alias of the input)', () => {
      const input = ['a'];
      const out = normalizePinnedKeys(input);
      assert.notEqual(out, input);
      assert.deepEqual(out, ['a']);
    });
  });

  describe('resolvePinnedKeys', () => {
    it('prefers an authoritative preferences array (empty array included)', () => {
      assert.deepEqual(resolvePinnedKeys(['a', 'b'], '["x"]'), { keys: ['a', 'b'], migrated: false });
      // An explicit empty array means the user cleared every pin — authoritative, no fallback.
      assert.deepEqual(resolvePinnedKeys([], '["x"]'), { keys: [], migrated: false });
    });
    it('falls back to the legacy localStorage string and flags migration', () => {
      assert.deepEqual(resolvePinnedKeys(undefined, '["a","b"]'), { keys: ['a', 'b'], migrated: true });
      assert.deepEqual(resolvePinnedKeys(null, '["a"]'), { keys: ['a'], migrated: true });
    });
    it('no legacy value -> empty, no migration', () => {
      assert.deepEqual(resolvePinnedKeys(undefined, null), { keys: [], migrated: false });
      assert.deepEqual(resolvePinnedKeys(undefined, ''), { keys: [], migrated: false });
      assert.deepEqual(resolvePinnedKeys(undefined, 'garbage'), { keys: [], migrated: false });
    });
    it('treats a corrupt non-array preferences value as absent', () => {
      assert.deepEqual(resolvePinnedKeys('junk', '["x"]'), { keys: ['x'], migrated: true });
      assert.deepEqual(resolvePinnedKeys({}, null), { keys: [], migrated: false });
      assert.deepEqual(resolvePinnedKeys(42, null), { keys: [], migrated: false });
    });
    it('normalizes dirty arrays from preferences', () => {
      assert.deepEqual(resolvePinnedKeys(['a', 1, '', 'a', null, 'b'], null), { keys: ['a', 'b'], migrated: false });
    });
    it('legacy strings that are valid JSON but contain no usable key do not trigger migration', () => {
      // [1,2,null] / [""] parse fine but normalize to [] — a migration of "nothing" must not run.
      assert.deepEqual(resolvePinnedKeys(undefined, '[1,2,null]'), { keys: [], migrated: false });
      assert.deepEqual(resolvePinnedKeys(undefined, '[""]'), { keys: [], migrated: false });
    });
    it('nested arrays inside preferences are flattened by normalization', () => {
      assert.deepEqual(resolvePinnedKeys([['a'], 'b'], null), { keys: ['b'], migrated: false });
    });
  });
});
