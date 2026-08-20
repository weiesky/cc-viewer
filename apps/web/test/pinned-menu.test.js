/**
 * Unit tests for src/utils/pinnedMenu.js
 * 纯 ESM、无依赖，直接 import。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PINNED_KEY, parsePinned, serializePinned, togglePinned } from '../src/utils/pinnedMenu.js';

describe('pinnedMenu', () => {
  it('exports a stable localStorage key', () => {
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

  describe('serializePinned', () => {
    it('serializes an array', () => {
      assert.equal(serializePinned(['a', 'b']), '["a","b"]');
    });
    it('coerces non-array to []', () => {
      assert.equal(serializePinned(null), '[]');
      assert.equal(serializePinned('x'), '[]');
    });
    it('round-trips with parsePinned', () => {
      const arr = ['import-local', 'messaging'];
      assert.deepEqual(parsePinned(serializePinned(arr)), arr);
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
});
