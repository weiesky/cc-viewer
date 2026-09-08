import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMdCodePath } from '../src/utils/markdownCodePathClassify.js';

test('accepts path-like spans (returns {path, line})', () => {
  const pass = [
    ['docs/a.md', 'docs/a.md'],
    ['README.md', 'README.md'],
    ['.env', '.env'],
    ['.gitignore', '.gitignore'],
    ['src/utils', 'src/utils'],
    ['/Users/foo/x.md', '/Users/foo/x.md'],
    ['src/my file.md', 'src/my file.md'],
    ['my file.md', 'my file.md'],
    ['a/b', 'a/b'],
    ['/a', '/a'],
  ];
  for (const [input, expected] of pass) {
    const r = resolveMdCodePath(input);
    assert.ok(r, `expected candidate: ${input}`);
    assert.equal(r.path, expected, `path for: ${input}`);
    assert.equal(r.line, null, `no line suffix: ${input}`);
  }
});

test('parses :N and :N-M line suffixes (file-reference convention)', () => {
  const cases = [
    ['docs/a.md:10', 'docs/a.md', 10],
    ['docs/a.md:10-20', 'docs/a.md', 10],
    ['apps/web/src/components/chat/ChatView.jsx:3012-3015', 'apps/web/src/components/chat/ChatView.jsx', 3012],
    ['/abs/x.js:3', '/abs/x.js', 3],
    ['src/utils:7', 'src/utils', 7],
  ];
  for (const [input, path, line] of cases) {
    const r = resolveMdCodePath(input);
    assert.ok(r, `expected candidate: ${input}`);
    assert.equal(r.path, path, `path for: ${input}`);
    assert.equal(r.line, line, `line for: ${input}`);
  }
});

test('does not strip a colon-suffix that is not a line number', () => {
  // `foo:bar` has a colon but no digits → not a line suffix (and no separator/ext → null)
  assert.equal(resolveMdCodePath('foo:bar'), null);
  // `docs/a.md:xyz` → the colon tail stays part of the path (verification fails → plain code)
  const r = resolveMdCodePath('docs/a.md:xyz');
  assert.equal(r.path, 'docs/a.md:xyz');
  assert.equal(r.line, null);
});

test('accepts Windows drive paths (drive check precedes scheme check)', () => {
  assert.deepEqual(resolveMdCodePath('C:\\Users\\a.md'), { path: 'C:\\Users\\a.md', line: null });
  assert.deepEqual(resolveMdCodePath('c:/x/y.js'), { path: 'c:/x/y.js', line: null });
  assert.deepEqual(resolveMdCodePath('C:\\Users\\a.md:12-14'), { path: 'C:\\Users\\a.md', line: 12 });
});

test('rejects non-path spans', () => {
  const fail = [
    'true', 'vue', 'useState', 'string',           // bare identifiers
    'npm run build', 'foo bar',                     // commands/prose without separator or extension
    'https://example.com', 'http://x',              // schemes
    'file:///x.md', 'mailto:a@b.com', 'data:text/html,x',
    'https:x',                                      // scheme-looking without //
    '//srv/share',                                  // protocol-relative / UNC
    '../docs/a.md', 'a/../b.md', 'a\\..\\b.md',     // `..` segments — server always 400s
    'v1.2.3', '1.2.34', '2026.09.09',               // numeric dot chains
    'foo.',                                         // trailing dot, no extension tail
    '#L12',                                         // anchor-ish
    '', '   ',                                      // empty
    'a\nb.md', 'a\tb.md', 'a\x00b.md',              // control chars
  ];
  for (const input of fail) {
    assert.equal(resolveMdCodePath(input), null, `expected null: ${JSON.stringify(input)}`);
  }
});

test('rejects non-strings and overlong strings', () => {
  assert.equal(resolveMdCodePath(null), null);
  assert.equal(resolveMdCodePath(undefined), null);
  assert.equal(resolveMdCodePath(42), null);
  assert.equal(resolveMdCodePath('a/'.padEnd(2000, 'b') + '.md'), null);
  assert.equal(resolveMdCodePath('x'.repeat(1025) + '/a'), null);
  // exactly 1024 with a separator is still acceptable
  const ok = ('a'.repeat(1000) + '/b.md').slice(0, 1024);
  assert.equal(resolveMdCodePath(ok)?.path, ok);
});

test('normalizes like link hrefs: ./ prefix, #fragment, ?query, percent-decoding', () => {
  assert.equal(resolveMdCodePath('./a.md')?.path, 'a.md');
  assert.equal(resolveMdCodePath('docs/a.md#L2')?.path, 'docs/a.md');
  assert.equal(resolveMdCodePath('styles/a.css?t=1')?.path, 'styles/a.css');
  assert.equal(resolveMdCodePath('docs/a%20b.md')?.path, 'docs/a b.md');
  // malformed percent stays raw (100%.md is a legit filename)
  assert.equal(resolveMdCodePath('docs/100%.md')?.path, 'docs/100%.md');
  // line suffix survives percent-decoding normalization of the base
  assert.deepEqual(resolveMdCodePath('docs/a%20b.md:9'), { path: 'docs/a b.md', line: 9 });
});

test('trims surrounding whitespace; keeps interior whitespace', () => {
  assert.equal(resolveMdCodePath('  docs/a.md  ')?.path, 'docs/a.md');
  assert.equal(resolveMdCodePath(' docs/a.md')?.path, 'docs/a.md');
});

test('pure: same input → same output, no env dependence', () => {
  assert.deepEqual(resolveMdCodePath('docs/a.md:3'), resolveMdCodePath('docs/a.md:3'));
});
