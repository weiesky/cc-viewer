import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

// A tmp fixture is NOT under the server's startup cwd, so it isn't an allowed read root by
// default. Point CCV_PROJECT_DIR at it and reset the policy cache so isReadAllowed() (the
// node engine's per-file gate) treats fixture files as in-project. node --test isolates each
// test file in its own process, so mutating process.env here is safe.
const fixtureRoot = mkdtempSync(join(tmpdir(), 'ccv-search-'));
process.env.CCV_PROJECT_DIR = fixtureRoot;

const { searchCode, buildQueryRegExp, globToRegExp, parseRgJsonLines, looksCatastrophic, hasRipgrep } = await import('../server/lib/code-search.js');
const { _resetCacheForTests } = await import('../server/lib/file-access-policy.js');
const rgPresent = await hasRipgrep();

function write(rel, content) {
  const full = join(fixtureRoot, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

const gitAvailable = spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0;

before(() => {
  write('a.js', 'const needle = 1;\nplain line\nNEEDLE upper\n');
  write('src/b.ts', 'let x = needle;\nno match here\n');
  write('src/c.txt', 'needle in text\n');
  write('README.md', '# needle in markdown\n');
  write('ignored.log', 'needle in a log file\n');       // gitignored via *.log
  write('build/out.js', 'needle in build output\n');     // gitignored via build/
  write('node_modules/dep/i.js', 'needle in a dep\n');   // ignored-name segment
  write('.secret/h.js', 'needle in a hidden dir\n');     // hidden
  write('bin.dat', 'needle\x00\x01binary\n');            // binary (NUL byte)
  write('.gitignore', '*.log\nbuild/\n');

  if (gitAvailable) {
    spawnSync('git', ['init', '-q'], { cwd: fixtureRoot });
    spawnSync('git', ['add', '-A'], { cwd: fixtureRoot });
  }
  _resetCacheForTests();
});

after(() => { rmSync(fixtureRoot, { recursive: true, force: true }); });

const NODE = { engine: 'node', root: fixtureRoot };
const filesOf = (r) => r.results.map((x) => x.file).sort();

describe('searchCode — node engine', () => {
  it('finds literal matches grouped by file, case-insensitive by default', async () => {
    const r = await searchCode({ ...NODE, query: 'needle' });
    const files = filesOf(r);
    assert.ok(files.includes('a.js'));
    assert.ok(files.includes('src/b.ts'));
    assert.ok(files.includes('src/c.txt'));
    // a.js matches both "needle" and "NEEDLE" (case-insensitive)
    const ajs = r.results.find((x) => x.file === 'a.js');
    assert.equal(ajs.matches.length, 2);
    assert.deepEqual(ajs.matches[0].submatches[0], { start: 6, end: 12 });
  });

  it('respects case-sensitive toggle', async () => {
    const r = await searchCode({ ...NODE, query: 'NEEDLE', caseSensitive: true });
    const ajs = r.results.find((x) => x.file === 'a.js');
    assert.equal(ajs.matches.length, 1);
    assert.equal(ajs.matches[0].line, 3);
  });

  it('respects whole-word toggle', async () => {
    const r = await searchCode({ ...NODE, query: 'needl', wholeWord: true });
    assert.equal(r.results.length, 0, 'partial word should not match with whole-word on');
    const r2 = await searchCode({ ...NODE, query: 'needle', wholeWord: true });
    assert.ok(r2.results.length > 0);
  });

  it('supports regex mode', async () => {
    const r = await searchCode({ ...NODE, query: 'N[Ee]+DLE', regex: true, caseSensitive: true });
    const ajs = r.results.find((x) => x.file === 'a.js');
    assert.ok(ajs && ajs.matches.some((m) => m.line === 3));
  });

  it('returns error:invalid_regex for a bad pattern', async () => {
    const r = await searchCode({ ...NODE, query: '(', regex: true });
    assert.equal(r.error, 'invalid_regex');
  });

  it('rejects catastrophic-backtracking regex patterns', async () => {
    const r = await searchCode({ ...NODE, query: '(a+)+$', regex: true });
    assert.equal(r.error, 'invalid_regex');
  });

  it('treats a !-prefixed include glob as an exclude (rg parity)', async () => {
    const r = await searchCode({ ...NODE, query: 'needle', includeGlobs: ['!*.txt'] });
    const files = filesOf(r);
    assert.ok(!files.includes('src/c.txt'), '!*.txt excludes .txt');
    assert.ok(files.includes('a.js'), 'other files still matched');
  });

  it('sets truncated when the per-file match cap is hit', async () => {
    const r = await searchCode({ ...NODE, query: 'needle', maxMatchesPerFile: 1 });
    assert.equal(r.truncated, true); // a.js has 2 matches; capped to 1
    const ajs = r.results.find((x) => x.file === 'a.js');
    assert.equal(ajs.matches.length, 1);
  });

  it('applies include globs (basename glob matches at any depth)', async () => {
    const r = await searchCode({ ...NODE, query: 'needle', includeGlobs: ['*.ts'] });
    assert.deepEqual(filesOf(r), ['src/b.ts']);
  });

  it('applies exclude globs', async () => {
    const r = await searchCode({ ...NODE, query: 'needle', excludeGlobs: ['*.txt', '*.md'] });
    const files = filesOf(r);
    assert.ok(!files.includes('src/c.txt'));
    assert.ok(!files.includes('README.md'));
    assert.ok(files.includes('a.js'));
  });

  it('supports {brace} globs', async () => {
    const r = await searchCode({ ...NODE, query: 'needle', includeGlobs: ['*.{ts,md}'] });
    assert.deepEqual(filesOf(r), ['README.md', 'src/b.ts']);
  });

  it('excludes node_modules, hidden dirs, and binary files', async () => {
    const r = await searchCode({ ...NODE, query: 'needle' });
    const files = filesOf(r);
    assert.ok(!files.some((f) => f.startsWith('node_modules/')), 'node_modules excluded');
    assert.ok(!files.some((f) => f.startsWith('.secret/')), 'hidden dir excluded');
    assert.ok(!files.includes('bin.dat'), 'binary excluded');
  });

  it('respects .gitignore when git is available', { skip: !gitAvailable }, async () => {
    const r = await searchCode({ ...NODE, query: 'needle' });
    const files = filesOf(r);
    assert.ok(!files.includes('ignored.log'), '*.log gitignored');
    assert.ok(!files.some((f) => f.startsWith('build/')), 'build/ gitignored');
  });

  it('caps results and sets truncated', async () => {
    const r = await searchCode({ ...NODE, query: 'needle', maxResults: 1 });
    assert.equal(r.truncated, true);
    const total = r.results.reduce((n, x) => n + x.matches.length, 0);
    assert.equal(total, 1);
  });

  it('honors an already-aborted signal', async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await searchCode({ ...NODE, query: 'needle', signal: ac.signal });
    assert.equal(r.truncated, true);
    assert.equal(r.results.length, 0);
  });

  it('does not follow a symlinked file (no secret exfiltration)', { skip: process.platform === 'win32' }, async () => {
    const secretDir = mkdtempSync(join(tmpdir(), 'ccv-secret-'));
    writeFileSync(join(secretDir, 'secret.txt'), 'needle TOPSECRET\n');
    try {
      symlinkSync(join(secretDir, 'secret.txt'), join(fixtureRoot, 'link.txt'));
      const r = await searchCode({ ...NODE, query: 'TOPSECRET' });
      assert.equal(r.results.length, 0, 'symlinked file must not be searched');
    } finally {
      rmSync(secretDir, { recursive: true, force: true });
    }
  });

  it('falls back to a plain walk for a non-git directory', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'ccv-plain-'));
    const prev = process.env.CCV_PROJECT_DIR;
    process.env.CCV_PROJECT_DIR = plain;
    _resetCacheForTests();
    try {
      writeFileSync(join(plain, 'x.js'), 'hello needle world\n');
      const r = await searchCode({ engine: 'node', root: plain, query: 'needle' });
      assert.deepEqual(filesOf(r), ['x.js']);
    } finally {
      process.env.CCV_PROJECT_DIR = prev;
      _resetCacheForTests();
      rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe('buildQueryRegExp', () => {
  it('escapes literal queries', () => {
    const re = buildQueryRegExp({ query: 'a.b(c)' });
    assert.ok(re.test('a.b(c)'));
    assert.ok(!re.test('axbxc'));
  });
  it('applies whole-word boundaries', () => {
    const re = buildQueryRegExp({ query: 'cat', wholeWord: true });
    assert.ok(re.test('a cat sat'));
    assert.ok(!re.test('category'));
  });
  it('is case-insensitive unless caseSensitive', () => {
    assert.ok(buildQueryRegExp({ query: 'ABC' }).test('abc'));
    assert.ok(!buildQueryRegExp({ query: 'ABC', caseSensitive: true }).test('abc'));
  });
  it('throws on invalid regex', () => {
    assert.throws(() => buildQueryRegExp({ query: '(', regex: true }));
  });
});

describe('globToRegExp', () => {
  it('matches a no-slash glob at any depth', () => {
    const re = globToRegExp('*.js');
    assert.ok(re.test('a.js'));
    assert.ok(re.test('src/deep/a.js'));
    assert.ok(!re.test('a.ts'));
  });
  it('* does not cross path separators', () => {
    const re = globToRegExp('src/*.js');
    assert.ok(re.test('src/a.js'));
    assert.ok(!re.test('src/deep/a.js'));
  });
  it('** crosses path separators', () => {
    const re = globToRegExp('src/**/*.js');
    assert.ok(re.test('src/a.js'));
    assert.ok(re.test('src/deep/a.js'));
  });
  it('expands brace alternation', () => {
    const re = globToRegExp('*.{js,ts}');
    assert.ok(re.test('a.js'));
    assert.ok(re.test('a.ts'));
    assert.ok(!re.test('a.md'));
  });
  it('handles ? (single char) and [char class]', () => {
    assert.ok(globToRegExp('a?.js').test('ax.js'));
    assert.ok(!globToRegExp('a?.js').test('axy.js'));
    assert.ok(globToRegExp('v[0-9].txt').test('v3.txt'));
    assert.ok(!globToRegExp('v[0-9].txt').test('vx.txt'));
  });
  it('treats a trailing slash as match-everything-beneath', () => {
    const re = globToRegExp('build/');
    assert.ok(re.test('build/out.js'));
    assert.ok(re.test('build/deep/x.js'));
  });
  it('escapes regex metacharacters in the literal parts', () => {
    const re = globToRegExp('a.b+c(*');
    assert.ok(re.test('a.b+c(zzz'));
    assert.ok(!re.test('aXbPcQ'));
  });
});

describe('searchCode — ripgrep engine', { skip: !rgPresent }, () => {
  before(() => {
    write('rg/a.js', 'const needle = 1;\nNEEDLE two\n');
    write('rg/b.ts', 'let x = needle;\n');
    write('rg/skip.log', 'needle in log\n');
    write('rg/.gitignore', '*.log\n');
    if (gitAvailable) { spawnSync('git', ['init', '-q'], { cwd: fixtureRoot }); spawnSync('git', ['add', '-A'], { cwd: fixtureRoot }); }
    _resetCacheForTests();
  });
  const RG = { engine: 'ripgrep', root: fixtureRoot };

  it('finds matches with correct submatch offsets', async () => {
    const r = await searchCode({ ...RG, query: 'needle', caseSensitive: true, includeGlobs: ['rg/**'] });
    assert.equal(r.engine, 'ripgrep');
    const a = r.results.find((x) => x.file === 'rg/a.js');
    assert.ok(a && a.matches[0].submatches[0].start === 6);
  });
  it('respects case / whole-word toggles', async () => {
    const ci = await searchCode({ ...RG, query: 'NEEDLE', includeGlobs: ['rg/**'] });
    assert.ok(ci.results.reduce((n, g) => n + g.matches.length, 0) >= 2); // case-insensitive
    const ww = await searchCode({ ...RG, query: 'needl', wholeWord: true, includeGlobs: ['rg/**'] });
    assert.equal(ww.results.length, 0);
  });
  it('respects .gitignore', { skip: !gitAvailable }, async () => {
    const r = await searchCode({ ...RG, query: 'needle', includeGlobs: ['rg/**'] });
    assert.ok(!r.results.some((g) => g.file.endsWith('.log')));
  });
  it('sets truncated and kills rg at the result cap', async () => {
    const r = await searchCode({ ...RG, query: 'needle', includeGlobs: ['rg/**'], maxResults: 1 });
    assert.equal(r.truncated, true);
  });
  it('maps an invalid regex to error:invalid_regex', async () => {
    const r = await searchCode({ ...RG, query: '(', regex: true, includeGlobs: ['rg/**'] });
    assert.equal(r.error, 'invalid_regex');
  });
});

describe('searchCode — auto falls back to node when rg is absent', () => {
  it('uses node and returns results when hasRipgrep() is false', async () => {
    // On a machine without rg this exercises the real fallback; with rg it still must return node
    // OR ripgrep — either way a valid engine + results.
    const r = await searchCode({ engine: 'auto', root: fixtureRoot, query: 'needle' });
    assert.ok(['node', 'ripgrep'].includes(r.engine));
    assert.ok(r.results.length > 0);
  });
});

describe('looksCatastrophic', () => {
  it('flags nested-quantifier patterns', () => {
    assert.ok(looksCatastrophic('(a+)+'));
    assert.ok(looksCatastrophic('(.*)*'));
    assert.ok(looksCatastrophic('(a+)*$'));
    assert.ok(looksCatastrophic('(a{2,})+'));
  });
  it('does not flag common safe patterns', () => {
    assert.ok(!looksCatastrophic('foo'));
    assert.ok(!looksCatastrophic('a+b+'));
    assert.ok(!looksCatastrophic('(ab)+'));
    assert.ok(!looksCatastrophic('(a|b)+'));
    assert.ok(!looksCatastrophic('https?://'));
    assert.ok(!looksCatastrophic('[a-z]+\\.js'));
  });
});

describe('parseRgJsonLines', () => {
  const rgLine = (obj) => JSON.stringify({ type: 'match', data: obj });

  it('parses a basic match with byte→char submatch offsets', () => {
    const recs = parseRgJsonLines([rgLine({
      path: { text: 'a.js' },
      lines: { text: 'const needle = 1;\n' },
      line_number: 1,
      submatches: [{ match: { text: 'needle' }, start: 6, end: 12 }],
    })]);
    assert.equal(recs.length, 1);
    assert.equal(recs[0].file, 'a.js');
    assert.equal(recs[0].line, 1);
    assert.equal(recs[0].text, 'const needle = 1;'); // trailing newline trimmed
    assert.deepEqual(recs[0].submatches, [{ start: 6, end: 12 }]);
  });

  it('converts multibyte byte offsets to char offsets', () => {
    // "héllo néédle" — the match "néédle" starts at byte 8 (é is 2 bytes ×2 before it).
    const text = 'héllo néédle x';
    const buf = Buffer.from(text, 'utf8');
    const byteStart = buf.indexOf(Buffer.from('néédle'));
    const byteEnd = byteStart + Buffer.byteLength('néédle');
    const recs = parseRgJsonLines([rgLine({
      path: { text: 'u.txt' },
      lines: { text: text + '\n' },
      line_number: 1,
      submatches: [{ start: byteStart, end: byteEnd }],
    })]);
    const { start, end } = recs[0].submatches[0];
    assert.equal(text.slice(start, end), 'néédle');
  });

  it('handles CRLF line endings', () => {
    const recs = parseRgJsonLines([rgLine({
      path: { text: 'w.txt' }, lines: { text: 'foo bar\r\n' }, line_number: 2,
      submatches: [{ start: 4, end: 7 }],
    })]);
    assert.equal(recs[0].text, 'foo bar'); // both \r and \n trimmed
  });

  it('decodes the {bytes} invalid-UTF-8 variant without throwing', () => {
    const recs = parseRgJsonLines([rgLine({
      path: { bytes: Buffer.from('weird.bin').toString('base64') },
      lines: { bytes: Buffer.from('abc match def').toString('base64') },
      line_number: 5,
      submatches: [{ start: 4, end: 9 }],
    })]);
    assert.equal(recs.length, 1);
    assert.equal(recs[0].file, 'weird.bin');
  });

  it('drops zero-width and out-of-range submatches, ignores non-match events', () => {
    const recs = parseRgJsonLines([
      JSON.stringify({ type: 'begin', data: { path: { text: 'a.js' } } }),
      rgLine({ path: { text: 'a.js' }, lines: { text: 'hi\n' }, line_number: 1, submatches: [{ start: 1, end: 1 }] }),
      'not json',
    ]);
    assert.equal(recs.length, 1);
    assert.deepEqual(recs[0].submatches, []); // zero-width dropped
  });
});

describe('searchCode — auto engine (ripgrep when present)', () => {
  it('returns matches via whichever engine is available', async () => {
    const r = await searchCode({ engine: 'auto', root: fixtureRoot, query: 'needle' });
    assert.ok(['ripgrep', 'node'].includes(r.engine));
    assert.ok(r.results.length > 0);
  });
});
