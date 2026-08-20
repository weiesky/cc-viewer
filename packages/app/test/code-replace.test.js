import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, statSync, symlinkSync, chmodSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const fixtureRoot = mkdtempSync(join(tmpdir(), 'ccv-replace-'));
process.env.CCV_PROJECT_DIR = fixtureRoot;

const { searchReplace, applyMatch, replaceInContent } = await import('../server/lib/code-replace.js');
const { buildQueryRegExp } = await import('../server/lib/code-search.js');
const { _resetCacheForTests } = await import('../server/lib/file-access-policy.js');

const gitAvailable = spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0;
function write(rel, content) {
  const full = join(fixtureRoot, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}
function read(rel) { return readFileSync(join(fixtureRoot, rel), 'utf8'); }
function mkRe(opts) {
  const reG = buildQueryRegExp(opts);
  return { reG, reNoG: new RegExp(reG.source, reG.flags.replace('g', '')) };
}
const BASE = { root: fixtureRoot };

function seed() {
  write('a.js', 'const foo = 1;\nfoo + foo\nFOO upper\n');
  write('src/b.js', 'let x = foo;\n');
  write('crlf.txt', 'foo bar\r\nsecond foo\r\n');
  write('exec.sh', '#!/bin/sh\nfoo\n');
  write('.env', 'SECRET=foo\n');
  write('node_modules/dep/i.js', 'foo dep\n');
  write('.gitignore', 'ignored.log\n');
  write('ignored.log', 'foo in log\n');
  chmodSync(join(fixtureRoot, 'exec.sh'), 0o755);
  if (gitAvailable) {
    spawnSync('git', ['init', '-q'], { cwd: fixtureRoot });
    spawnSync('git', ['add', '-A'], { cwd: fixtureRoot });
  }
  _resetCacheForTests();
}

describe('applyMatch', () => {
  it('literal mode returns replacement verbatim (no $ interpretation)', () => {
    const { reNoG } = mkRe({ query: 'foo' });
    assert.equal(applyMatch('foo', reNoG, false, '$1$&bar'), '$1$&bar');
  });
  it('regex mode expands $&, $1, $$', () => {
    const { reNoG } = mkRe({ query: '(f)(oo)', regex: true });
    assert.equal(applyMatch('foo', reNoG, true, '$2$1'), 'oof');
    assert.equal(applyMatch('foo', reNoG, true, '[$&]'), '[foo]');
    assert.equal(applyMatch('foo', reNoG, true, '$$'), '$');
  });
});

describe('replaceInContent', () => {
  it('all-in-file replaces every match and counts them', () => {
    const { reG, reNoG } = mkRe({ query: 'foo' });
    const r = replaceInContent('foo x foo\nfoo\n', reG, reNoG, 'bar', { regex: false, target: 'all-in-file' });
    assert.equal(r.count, 3);
    assert.equal(r.newContent, 'bar x bar\nbar\n');
  });
  it('preserves CRLF vs LF exactly', () => {
    const { reG, reNoG } = mkRe({ query: 'foo' });
    const r = replaceInContent('foo\r\nfoo\n', reG, reNoG, 'x', { regex: false, target: 'all-in-file' });
    assert.equal(r.newContent, 'x\r\nx\n');
  });
  it('single-match targets one occurrence by col and verifies expectText', () => {
    const { reG, reNoG } = mkRe({ query: 'foo' });
    const line0 = 'foo + foo';
    // replace the second occurrence (col 6)
    const r = replaceInContent(line0 + '\n', reG, reNoG, 'bar', { regex: false, target: { line: 1, col: 6 }, expectText: 'foo' });
    assert.equal(r.count, 1);
    assert.equal(r.newContent, 'foo + bar\n');
  });
  it('single-match skips on expectText drift', () => {
    const { reG, reNoG } = mkRe({ query: 'foo' });
    const r = replaceInContent('foo + foo\n', reG, reNoG, 'bar', { regex: false, target: { line: 1, col: 6 }, expectText: 'DIFFERENT' });
    assert.equal(r.count, 0);
  });
});

describe('searchReplace', () => {
  beforeEach(seed);
  after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  it('scope:all replaces across files and reports changed + total', async () => {
    const r = await searchReplace({ ...BASE, query: 'foo', replacement: 'bar', scope: 'all', caseSensitive: true });
    const files = r.changed.map((c) => c.file).sort();
    assert.ok(files.includes('a.js'));
    assert.ok(files.includes('src/b.js'));
    assert.equal(read('a.js'), 'const bar = 1;\nbar + bar\nFOO upper\n');
    assert.equal(read('src/b.js'), 'let x = bar;\n');
    assert.ok(r.total >= 4);
  });

  it('scope:file replaces only one file', async () => {
    const r = await searchReplace({ ...BASE, query: 'foo', replacement: 'bar', scope: 'file', file: 'src/b.js', caseSensitive: true });
    assert.equal(read('src/b.js'), 'let x = bar;\n');
    assert.equal(read('a.js'), 'const foo = 1;\nfoo + foo\nFOO upper\n'); // untouched
    assert.equal(r.changed.length, 1);
  });

  it('scope:match replaces a single occurrence via col+expectText', async () => {
    const r = await searchReplace({ ...BASE, query: 'foo', replacement: 'bar', scope: 'match', file: 'a.js', line: 2, col: 6, expectText: 'foo', caseSensitive: true });
    assert.equal(read('a.js'), 'const foo = 1;\nfoo + bar\nFOO upper\n');
    assert.equal(r.total, 1);
  });

  it('supports regex capture groups', async () => {
    write('cg.js', 'call(foo, bar)\n');
    _resetCacheForTests();
    const r = await searchReplace({ ...BASE, query: '(\\w+), (\\w+)', replacement: '$2, $1', scope: 'file', file: 'cg.js', regex: true });
    assert.equal(read('cg.js'), 'call(bar, foo)\n');
    assert.equal(r.total, 1);
  });

  it('keeps a literal $ literal in non-regex mode', async () => {
    write('lit.js', 'price = foo\n');
    _resetCacheForTests();
    await searchReplace({ ...BASE, query: 'foo', replacement: '$100', scope: 'file', file: 'lit.js' });
    assert.equal(read('lit.js'), 'price = $100\n');
  });

  it('respects whole-word', async () => {
    write('ww.js', 'foo food foobar foo\n');
    _resetCacheForTests();
    await searchReplace({ ...BASE, query: 'foo', replacement: 'X', scope: 'file', file: 'ww.js', wholeWord: true, caseSensitive: true });
    assert.equal(read('ww.js'), 'X food foobar X\n');
  });

  it('is case-insensitive by default', async () => {
    const r = await searchReplace({ ...BASE, query: 'foo', replacement: 'x', scope: 'file', file: 'a.js' });
    assert.equal(read('a.js'), 'const x = 1;\nx + x\nx upper\n'); // FOO also replaced
    assert.ok(r.total >= 4);
  });

  it('preserves CRLF line endings on disk', async () => {
    await searchReplace({ ...BASE, query: 'foo', replacement: 'x', scope: 'file', file: 'crlf.txt' });
    assert.equal(read('crlf.txt'), 'x bar\r\nsecond x\r\n');
  });

  it('preserves file mode (exec bit)', async () => {
    await searchReplace({ ...BASE, query: 'foo', replacement: 'bar', scope: 'file', file: 'exec.sh' });
    assert.equal(read('exec.sh'), '#!/bin/sh\nbar\n');
    assert.equal(statSync(join(fixtureRoot, 'exec.sh')).mode & 0o111, 0o111); // still executable
  });

  it('refuses protected dirs and hidden/ignored files (scope:file)', async () => {
    for (const file of ['node_modules/dep/i.js', '.env', '.git/config']) {
      const r = await searchReplace({ ...BASE, query: 'foo', replacement: 'x', scope: 'file', file });
      assert.equal(r.changed.length, 0, `${file} must not be changed`);
      assert.equal(r.skipped[0]?.reason, 'forbidden', `${file} → forbidden`);
    }
    assert.equal(read('.env'), 'SECRET=foo\n');
  });

  it('rejects a path escaping the project via a symlinked directory (containment)', { skip: process.platform === 'win32' }, async () => {
    const outside = mkdtempSync(join(tmpdir(), 'ccv-outside-'));
    writeFileSync(join(outside, 'secret.txt'), 'foo secret\n');
    try {
      symlinkSync(outside, join(fixtureRoot, 'link')); // symlinked DIR (lstat on the leaf file passes)
      _resetCacheForTests();
      const r = await searchReplace({ ...BASE, query: 'foo', replacement: 'x', scope: 'file', file: 'link/secret.txt' });
      assert.equal(r.changed.length, 0);
      assert.equal(r.skipped[0]?.reason, 'forbidden');
      assert.equal(readFileSync(join(outside, 'secret.txt'), 'utf8'), 'foo secret\n'); // untouched
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('skips a symlinked file', { skip: process.platform === 'win32' }, async () => {
    const target = join(fixtureRoot, 'real-target.js');
    writeFileSync(target, 'foo\n');
    symlinkSync(target, join(fixtureRoot, 'ln.js'));
    _resetCacheForTests();
    const r = await searchReplace({ ...BASE, query: 'foo', replacement: 'x', scope: 'file', file: 'ln.js' });
    assert.equal(r.skipped[0]?.reason, 'symlink');
  });

  it('skips non-UTF-8 files instead of corrupting them', async () => {
    const latin1 = Buffer.from('caf\xE9 foo\n', 'latin1'); // 0xE9, no NUL
    writeFileSync(join(fixtureRoot, 'latin1.txt'), latin1);
    _resetCacheForTests();
    const r = await searchReplace({ ...BASE, query: 'foo', replacement: 'x', scope: 'file', file: 'latin1.txt' });
    assert.equal(r.skipped[0]?.reason, 'encoding');
    assert.ok(readFileSync(join(fixtureRoot, 'latin1.txt')).equals(latin1)); // byte-for-byte intact
  });

  it('skips files named in skipPaths as dirty', async () => {
    const r = await searchReplace({ ...BASE, query: 'foo', replacement: 'x', scope: 'all', caseSensitive: true, skipPaths: ['a.js'] });
    assert.ok(r.skipped.some((s) => s.file === 'a.js' && s.reason === 'dirty'));
    assert.equal(read('a.js'), 'const foo = 1;\nfoo + foo\nFOO upper\n');
  });

  it('reports changed on drift (match no longer at col)', async () => {
    const r = await searchReplace({ ...BASE, query: 'foo', replacement: 'x', scope: 'match', file: 'a.js', line: 1, col: 999, expectText: 'foo' });
    assert.equal(r.changed.length, 0);
    assert.equal(r.skipped[0]?.reason, 'changed');
  });

  it('dryRun counts without writing', async () => {
    const before = read('a.js');
    const r = await searchReplace({ ...BASE, query: 'foo', replacement: 'bar', scope: 'all', caseSensitive: true, dryRun: true });
    assert.ok(r.total >= 4);
    assert.ok(r.changed.length >= 2);
    assert.equal(read('a.js'), before); // unchanged on disk
    // no orphaned tmp files
    assert.ok(!readdirSync(fixtureRoot).some((f) => f.includes('.ccv-tmp-')));
  });

  it('rejects catastrophic / invalid regex', async () => {
    const cat = await searchReplace({ ...BASE, query: '(a+)+$', replacement: 'x', scope: 'all', regex: true });
    assert.equal(cat.error, 'invalid_regex');
    const bad = await searchReplace({ ...BASE, query: '(', replacement: 'x', scope: 'all', regex: true });
    assert.equal(bad.error, 'invalid_regex');
  });

  it('reports write_failed and cleans up tmp when the write throws', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
    write('ro/f.js', 'foo\n');
    _resetCacheForTests();
    const dir = join(fixtureRoot, 'ro');
    chmodSync(dir, 0o555); // dir not writable → tmp write/rename fails
    try {
      const r = await searchReplace({ ...BASE, query: 'foo', replacement: 'bar', scope: 'file', file: 'ro/f.js', caseSensitive: true });
      assert.equal(r.skipped[0]?.reason, 'write_failed');
      assert.equal(r.total, 0); // rolled back
      assert.equal(readFileSync(join(dir, 'f.js'), 'utf8'), 'foo\n'); // intact
      assert.ok(!readdirSync(dir).some((f) => f.includes('.ccv-tmp-'))); // no orphan
    } finally {
      chmodSync(dir, 0o755);
    }
  });

  it('skips a binary file', async () => {
    writeFileSync(join(fixtureRoot, 'b.bin'), Buffer.from('foo\x00bar'));
    _resetCacheForTests();
    const r = await searchReplace({ ...BASE, query: 'foo', replacement: 'x', scope: 'file', file: 'b.bin' });
    assert.equal(r.skipped[0]?.reason, 'binary');
  });

  it('skips a file larger than maxFileSize', async () => {
    write('big.js', 'foo bar baz\n');
    _resetCacheForTests();
    const r = await searchReplace({ ...BASE, query: 'foo', replacement: 'x', scope: 'file', file: 'big.js', maxFileSize: 2 });
    assert.equal(r.skipped[0]?.reason, 'too_large');
    assert.equal(read('big.js'), 'foo bar baz\n');
  });

  it('returns truncated:false for a normal scope:all replace', async () => {
    const r = await searchReplace({ ...BASE, query: 'foo', replacement: 'bar', scope: 'all', caseSensitive: true });
    assert.equal(r.truncated, false);
  });

  it('does not count or write a no-op replacement (context-dependent regex)', async () => {
    write('la.js', 'foobar and foobaz\n'); // lookahead only matches the first
    _resetCacheForTests();
    // foo(?=bar) can't be re-expanded on the isolated match "foo" → applyMatch no-ops.
    const r = await searchReplace({ ...BASE, query: 'foo(?=bar)', replacement: 'X', scope: 'file', file: 'la.js', regex: true });
    assert.equal(r.total, 0);
    assert.equal(r.skipped[0]?.reason, 'changed');
    assert.equal(read('la.js'), 'foobar and foobaz\n'); // untouched, not a no-op write
  });

  it('does not count an identity replacement', async () => {
    write('id.js', 'foo foo\n');
    _resetCacheForTests();
    const r = await searchReplace({ ...BASE, query: 'foo', replacement: 'foo', scope: 'file', file: 'id.js', caseSensitive: true });
    assert.equal(r.total, 0);
  });

  it('allows a filename containing ".." (segment check, not substring)', async () => {
    write('a..b.txt', 'foo\n');
    _resetCacheForTests();
    const r = await searchReplace({ ...BASE, query: 'foo', replacement: 'x', scope: 'file', file: 'a..b.txt' });
    assert.equal(read('a..b.txt'), 'x\n');
    assert.equal(r.total, 1);
  });

  it('leaves no tmp files after a normal replace', async () => {
    await searchReplace({ ...BASE, query: 'foo', replacement: 'bar', scope: 'all', caseSensitive: true });
    assert.ok(!readdirSync(fixtureRoot).some((f) => f.includes('.ccv-tmp-')));
  });
});
