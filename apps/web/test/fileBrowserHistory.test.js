/**
 * Unit tests for fileBrowserHistory.js — node:test, no DOM.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_HISTORY,
  createHistory, currentPath, canBack, canForward,
  pushPath, replaceCurrent, back, forward, remapAll,
} from '../src/utils/fileBrowserHistory.js';

describe('createHistory', () => {
  it('seeds a single entry and cursor at 0', () => {
    const h = createHistory('src');
    assert.deepEqual(h.entries, ['src']);
    assert.equal(h.index, 0);
    assert.equal(currentPath(h), 'src');
  });
  it('defaults to the project root', () => {
    const h = createHistory();
    assert.equal(currentPath(h), '');
  });
});

describe('pushPath', () => {
  it('appends a new entry and advances the cursor', () => {
    let h = createHistory('');
    h = pushPath(h, 'a');
    h = pushPath(h, 'a/b');
    assert.deepEqual(h.entries, ['', 'a', 'a/b']);
    assert.equal(currentPath(h), 'a/b');
    assert.ok(canBack(h));
    assert.ok(!canForward(h));
  });
  it('dedupes against the current entry (same-path is a no-op)', () => {
    let h = createHistory('');
    h = pushPath(h, 'a');
    const before = h;
    h = pushPath(h, 'a');
    assert.equal(h, before);
  });
  it('truncates the forward branch on push', () => {
    let h = createHistory('');
    h = pushPath(h, 'a');
    h = pushPath(h, 'b');
    h = back(h);
    h = pushPath(h, 'c');
    assert.deepEqual(h.entries, ['', 'a', 'c']);
    assert.ok(!canForward(h));
  });
  it('caps the stack at MAX_HISTORY by dropping the oldest', () => {
    let h = createHistory('p0');
    for (let i = 1; i < MAX_HISTORY + 20; i++) h = pushPath(h, `p${i}`);
    assert.equal(h.entries.length, MAX_HISTORY);
    assert.equal(h.entries[0], 'p20');
    assert.equal(h.index, MAX_HISTORY - 1);
    assert.equal(currentPath(h), `p${MAX_HISTORY + 19}`);
  });
});

describe('replaceCurrent', () => {
  it('replaces only the current entry', () => {
    let h = createHistory('');
    h = pushPath(h, 'a');
    h = pushPath(h, 'a/b');
    h = replaceCurrent(h, 'a/c');
    assert.deepEqual(h.entries, ['', 'a', 'a/c']);
    assert.equal(currentPath(h), 'a/c');
    assert.ok(canBack(h));
  });
  it('is a no-op when the path is unchanged', () => {
    const h = createHistory('x');
    assert.equal(replaceCurrent(h, 'x'), h);
  });
  it('collapses an adjacent duplicate introduced by the replacement', () => {
    let h = createHistory('');
    h = pushPath(h, 'a');
    h = pushPath(h, 'b');
    h = replaceCurrent(h, 'a');
    assert.deepEqual(h.entries, ['', 'a']);
    assert.equal(currentPath(h), 'a');
  });
});

describe('back / forward', () => {
  it('moves the cursor without mutating entries', () => {
    let h = createHistory('');
    h = pushPath(h, 'a');
    h = pushPath(h, 'b');
    h = back(h);
    assert.equal(currentPath(h), 'a');
    assert.ok(canForward(h));
    h = forward(h);
    assert.equal(currentPath(h), 'b');
  });
  it('is a no-op at the boundaries', () => {
    let h = createHistory('');
    assert.equal(back(h), h);
    assert.equal(forward(h), h);
  });
});

describe('remapAll', () => {
  it('renames exact matches and descendants across the whole stack', () => {
    let h = createHistory('');
    h = pushPath(h, 'a');
    h = pushPath(h, 'a/b');
    h = pushPath(h, 'c');
    const out = remapAll(h, (p) => {
      if (p === 'a') return 'x';
      if (p.startsWith('a/')) return 'x' + p.slice(1);
      return p;
    });
    assert.deepEqual(out.entries, ['', 'x', 'x/b', 'c']);
  });
  it('collapses descendants of a deleted ancestor to the root', () => {
    let h = createHistory('');
    h = pushPath(h, 'a');
    h = pushPath(h, 'a/b');
    h = pushPath(h, 'c');
    const out = remapAll(h, (p) => (p === 'a' || p.startsWith('a/') ? null : p));
    assert.deepEqual(out.entries, ['', 'c']);
    assert.equal(currentPath(out), 'c');
  });
  it('clamps the cursor when the current entry collapses', () => {
    let h = createHistory('');
    h = pushPath(h, 'a');
    h = pushPath(h, 'a/b');
    const out = remapAll(h, (p) => (p.startsWith('a') ? null : p));
    assert.deepEqual(out.entries, ['']);
    assert.equal(out.index, 0);
    assert.equal(currentPath(out), '');
  });
});
