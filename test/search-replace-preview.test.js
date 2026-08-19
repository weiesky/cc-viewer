import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// The client preview mirror (src/utils/searchReplace.js) must stay byte-for-byte equivalent to
// the server (server/lib/code-replace.js + buildQueryRegExp) or the inline preview diverges from
// what gets written. Both modules are pure ESM and import cleanly under node:test.
const client = await import('../apps/web/src/utils/searchReplace.js');
const serverReplace = await import('../packages/app/server/lib/code-replace.js');
const server = await import('../packages/app/server/lib/code-search.js');
const { buildQueryRegExp: serverBuildRe } = server;

const CASES = [
  { name: 'literal', opts: { query: 'foo' }, matched: 'foo', replacement: 'bar' },
  { name: 'literal with $ (must stay literal)', opts: { query: 'foo' }, matched: 'foo', replacement: '$1$&x' },
  { name: 'regex $1/$2 swap', opts: { query: '(a)(b)', regex: true }, matched: 'ab', replacement: '$2$1' },
  { name: 'regex $&', opts: { query: 'a+', regex: true }, matched: 'aaa', replacement: '[$&]' },
  { name: 'regex $$', opts: { query: 'x', regex: true }, matched: 'x', replacement: '$$' },
  { name: 'whole-word', opts: { query: 'cat', wholeWord: true }, matched: 'cat', replacement: 'dog' },
  { name: 'case-insensitive', opts: { query: 'ABC' }, matched: 'abc', replacement: 'z' },
];

describe('client/server replace parity', () => {
  for (const c of CASES) {
    it(`buildQueryRegExp identical — ${c.name}`, () => {
      const cr = client.buildQueryRegExp(c.opts);
      const sr = serverBuildRe(c.opts);
      assert.equal(cr.source, sr.source);
      assert.equal(cr.flags, sr.flags);
    });
    it(`applyMatch identical — ${c.name}`, () => {
      const reNoG = client.noGlobal(client.buildQueryRegExp(c.opts));
      const sReNoG = new RegExp(serverBuildRe(c.opts).source, serverBuildRe(c.opts).flags.replace('g', ''));
      const regex = !!c.opts.regex;
      const cOut = client.applyMatch(c.matched, reNoG, regex, c.replacement);
      const sOut = serverReplace.applyMatch(c.matched, sReNoG, regex, c.replacement);
      assert.equal(cOut, sOut);
    });
  }
});

describe('client/server helper source parity', () => {
  // The "byte-for-byte equivalent" claim in searchReplace.js is only real if these match.
  it('escapeRegExp is identical', () => {
    assert.equal(client.escapeRegExp.toString(), server.escapeRegExp.toString());
  });
  it('looksCatastrophic is identical', () => {
    assert.equal(client.looksCatastrophic.toString(), server.looksCatastrophic.toString());
  });
  it('looksCatastrophic agrees on sample patterns', () => {
    for (const p of ['(a+)+', '(.*)*', '(a{2,})+', 'foo', 'a+b+', '(ab)+', '(a|b)+', 'https?://']) {
      assert.equal(client.looksCatastrophic(p), server.looksCatastrophic(p), p);
    }
  });
});

describe('computeMatchTarget', () => {
  it('returns the JS-engine match position covering a submatch start', () => {
    const reG = client.buildQueryRegExp({ query: 'foo' });
    const line = 'foo + foo';
    assert.deepEqual(client.computeMatchTarget(line, 6, reG), { col: 6, expectText: 'foo' });
    assert.deepEqual(client.computeMatchTarget(line, 0, reG), { col: 0, expectText: 'foo' });
  });
  it('returns null when no match covers the position', () => {
    const reG = client.buildQueryRegExp({ query: 'zzz' });
    assert.equal(client.computeMatchTarget('foo bar', 0, reG), null);
  });
  it('falls back to the enclosing match when the start is mid-match', () => {
    const reG = client.buildQueryRegExp({ query: 'foobar' });
    // "foobar" starts at index 3; a submatch start of 4 lands inside it.
    assert.deepEqual(client.computeMatchTarget('xx foobar yy', 4, reG), { col: 3, expectText: 'foobar' });
  });
});
