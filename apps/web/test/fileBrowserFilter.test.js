import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchesFilter, splitMatch } from '../src/utils/fileBrowserFilter.js';

describe('matchesFilter', () => {
  it('matches everything on empty / missing query', () => {
    assert.equal(matchesFilter('anything.txt', ''), true);
    assert.equal(matchesFilter('anything.txt', null), true);
    assert.equal(matchesFilter('anything.txt', undefined), true);
  });

  it('performs case-insensitive substring matching', () => {
    assert.equal(matchesFilter('README.md', 'readme'), true);
    assert.equal(matchesFilter('README.md', 'MD'), true);
    assert.equal(matchesFilter('README.md', 'am.md'.slice(1, 4)), false); // sanity: not a subsequence check
  });

  it('does not match when the query is not a substring', () => {
    assert.equal(matchesFilter('README.md', 'xyz'), false);
  });

  it('handles CJK and mixed input without throwing', () => {
    assert.equal(matchesFilter('组件.jsx', '组件'), true);
    assert.equal(matchesFilter('组件.jsx', 'jsx'), true);
    assert.equal(matchesFilter('Hello 世界.md', '世界'), true);
  });

  it('treats query as a literal string, not a RegExp', () => {
    // `(`, `[`, `\\`, `*` would crash or misbehave in a naive RegExp filter.
    assert.equal(matchesFilter('foo(bar).txt', '(bar)'), true);
    assert.equal(matchesFilter('foo[1].txt', '[1]'), true);
    assert.equal(matchesFilter('a*b.txt', '*'), true);
    assert.equal(matchesFilter('a.b.txt', '.'), true);
    assert.equal(matchesFilter('abc.txt', 'a.c'), false); // `.` is literal, not a wildcard
  });
});

describe('splitMatch', () => {
  it('returns the whole name as one non-hit segment when query is empty', () => {
    assert.deepEqual(splitMatch('foo.txt', ''), [{ text: 'foo.txt', hit: false }]);
  });

  it('returns the whole name as one non-hit segment when nothing matches', () => {
    assert.deepEqual(splitMatch('foo.txt', 'xyz'), [{ text: 'foo.txt', hit: false }]);
  });

  it('splits around a single match in the middle', () => {
    assert.deepEqual(splitMatch('foo_bar_baz.txt', 'bar'), [
      { text: 'foo_', hit: false },
      { text: 'bar', hit: true },
      { text: '_baz.txt', hit: false },
    ]);
  });

  it('splits around multiple matches', () => {
    assert.deepEqual(splitMatch('aa.txt.aa', 'aa'), [
      { text: 'aa', hit: true },
      { text: '.txt.', hit: false },
      { text: 'aa', hit: true },
    ]);
  });

  it('matches case-insensitively but preserves the original casing in the segments', () => {
    assert.deepEqual(splitMatch('README.md', 'readme'), [
      { text: 'README', hit: true },
      { text: '.md', hit: false },
    ]);
  });

  it('handles a match at the start and at the end', () => {
    assert.deepEqual(splitMatch('foo.txt.foo', 'foo'), [
      { text: 'foo', hit: true },
      { text: '.txt.', hit: false },
      { text: 'foo', hit: true },
    ]);
  });

  it('does not misalign on characters that expand when lowercased (İ → i̇)', () => {
    // 'İ' (U+0130) lowercases to 'i̇' (two UTF-16 code units). Indexing the
    // lowercased copy would shift every subsequent offset; sliding over the
    // original string keeps the segments aligned with what the user sees.
    const segments = splitMatch('aİbc', 'b');
    assert.deepEqual(segments, [
      { text: 'aİ', hit: false },
      { text: 'b', hit: true },
      { text: 'c', hit: false },
    ]);
    // The joined segments must equal the original name exactly.
    assert.equal(segments.map(s => s.text).join(''), 'aİbc');
  });
});
