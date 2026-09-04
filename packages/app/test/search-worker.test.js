// search-worker.js coverage: the node engine's scan body (runNodeScan, direct in-process
// import — the `if (!isMainThread)` guard stays dormant under node --test) and the worker
// integration path (searchCode with engine:'node' spawns a real Worker per query).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

// Same fixture/policy dance as code-search.test.js: the tmp root is not under the server's
// startup cwd, so CCV_PROJECT_DIR must point at it for isReadAllowed() (the per-file gate
// inside BOTH the worker thread and the in-process runNodeScan) to allow reads. node --test
// isolates this file in its own process (and the worker inherits this process's env).
const fixtureRoot = mkdtempSync(join(tmpdir(), 'ccv-search-worker-'));
process.env.CCV_PROJECT_DIR = fixtureRoot;

const { runNodeScan } = await import('../server/lib/search-worker.js');
const { searchCode } = await import('../server/lib/code-search.js');
const { _resetCacheForTests } = await import('../server/lib/file-access-policy.js');

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
  write('ignored.log', 'needle in a log file\n');       // gitignored via *.log
  write('node_modules/dep/i.js', 'needle in a dep\n');   // ignored-name segment
  write('.secret/h.js', 'needle in a hidden dir\n');     // hidden
  write('bin.dat', 'needle\x00\x01binary\n');            // binary (NUL byte)
  write('.gitignore', '*.log\n');

  if (gitAvailable) {
    spawnSync('git', ['init', '-q'], { cwd: fixtureRoot });
    spawnSync('git', ['add', '-A'], { cwd: fixtureRoot });
  }
  _resetCacheForTests();
});

after(() => { rmSync(fixtureRoot, { recursive: true, force: true }); });

const SCAN = { root: fixtureRoot, query: 'needle' };
const filesOf = (r) => r.results.map((x) => x.file).sort();

describe('runNodeScan (direct)', () => {
  it('finds literal matches grouped by file, case-insensitive by default', async () => {
    const r = await runNodeScan(SCAN);
    const files = filesOf(r);
    assert.ok(files.includes('a.js'));
    assert.ok(files.includes('src/b.ts'));
    assert.ok(files.includes('src/c.txt'));
    const ajs = r.results.find((x) => x.file === 'a.js');
    assert.equal(ajs.matches.length, 2); // needle + NEEDLE
    assert.deepEqual(ajs.matches[0].submatches[0], { start: 6, end: 12 });
    assert.equal(r.filesScanned >= 3, true);
  });

  it('respects case-sensitive / whole-word / regex toggles', async () => {
    const cs = await runNodeScan({ ...SCAN, query: 'NEEDLE', caseSensitive: true });
    assert.equal(cs.results.find((x) => x.file === 'a.js').matches.length, 1);
    const ww = await runNodeScan({ ...SCAN, query: 'needl', wholeWord: true });
    assert.equal(ww.results.length, 0);
    const rx = await runNodeScan({ ...SCAN, query: 'N[Ee]+DLE', regex: true, caseSensitive: true });
    assert.ok(rx.results.find((x) => x.file === 'a.js').matches.some((m) => m.line === 3));
  });

  it('returns error:invalid_regex for bad / catastrophic patterns', async () => {
    assert.equal((await runNodeScan({ ...SCAN, query: '(', regex: true })).error, 'invalid_regex');
    assert.equal((await runNodeScan({ ...SCAN, query: '(a+)+$', regex: true })).error, 'invalid_regex');
  });

  it('applies include/exclude globs and skips hidden/ignored/binary', async () => {
    const inc = await runNodeScan({ ...SCAN, includeGlobs: ['*.ts'] });
    assert.deepEqual(filesOf(inc), ['src/b.ts']);
    const exc = await runNodeScan({ ...SCAN, excludeGlobs: ['*.txt'] });
    assert.ok(!filesOf(exc).includes('src/c.txt'));
    const all = filesOf(await runNodeScan(SCAN));
    assert.ok(!all.some((f) => f.startsWith('node_modules/')));
    assert.ok(!all.some((f) => f.startsWith('.secret/')));
    assert.ok(!all.includes('bin.dat'));
  });

  it('respects .gitignore when git is available', { skip: !gitAvailable }, async () => {
    const r = await runNodeScan(SCAN);
    assert.ok(!filesOf(r).includes('ignored.log'));
  });

  it('caps results and per-file matches, sets truncated', async () => {
    const r = await runNodeScan({ ...SCAN, maxMatchesPerFile: 1 });
    assert.equal(r.truncated, true);
    assert.equal(r.results.find((x) => x.file === 'a.js').matches.length, 1);
    const g = await runNodeScan({ ...SCAN, maxResults: 1 });
    assert.equal(g.results.reduce((n, x) => n + x.matches.length, 0), 1);
    assert.equal(g.truncated, true);
  });

  it('does not follow a symlinked file (no secret exfiltration)', { skip: process.platform === 'win32' }, async () => {
    const secretDir = mkdtempSync(join(tmpdir(), 'ccv-secret-'));
    writeFileSync(join(secretDir, 'secret.txt'), 'needle TOPSECRET\n');
    try {
      symlinkSync(join(secretDir, 'secret.txt'), join(fixtureRoot, 'link.txt'));
      const r = await runNodeScan({ root: fixtureRoot, query: 'TOPSECRET' });
      assert.equal(r.results.length, 0, 'symlinked file must not be searched');
    } finally {
      rmSync(secretDir, { recursive: true, force: true });
    }
  });

  it('honors the wall-clock time budget', async () => {
    const r = await runNodeScan({ ...SCAN, nodeTimeBudgetMs: 0 });
    assert.equal(r.truncated, true);
  });
});

describe('searchCode engine:node (worker integration)', () => {
  const NODE = { engine: 'node', root: fixtureRoot };

  it('returns matches through the worker thread', async () => {
    const r = await searchCode({ ...NODE, query: 'needle' });
    assert.equal(r.engine, 'node');
    const files = filesOf(r);
    assert.ok(files.includes('a.js'));
    assert.ok(files.includes('src/b.ts'));
    assert.ok(typeof r.filesScanned === 'number' && r.filesScanned >= 3);
  });

  it('maps worker invalid_regex to error:invalid_regex (not a throw)', async () => {
    const r = await searchCode({ ...NODE, query: '(a+)+$', regex: true });
    assert.equal(r.error, 'invalid_regex');
  });

  it('aborts quickly on an already-aborted signal', async () => {
    const ac = new AbortController();
    ac.abort();
    const started = Date.now();
    const r = await searchCode({ ...NODE, query: 'needle', signal: ac.signal });
    assert.equal(r.truncated, true);
    assert.equal(r.results.length, 0);
    assert.ok(Date.now() - started < 2000, 'abort must not wait for a full scan');
  });

  it('a mid-scan abort terminates the worker and resolves truncated', async () => {
    // Large enough fixture that the scan is genuinely in flight when the abort lands:
    // 400 files x 2KB each, node engine, no rg involved.
    const big = mkdtempSync(join(tmpdir(), 'ccv-bigscan-'));
    const prevDir = process.env.CCV_PROJECT_DIR;
    process.env.CCV_PROJECT_DIR = big;
    _resetCacheForTests();
    try {
      for (let i = 0; i < 400; i++) {
        writeFileSync(join(big, `f${i}.txt`), `line one\nneedle row ${i}\n`.repeat(40));
      }
      const ac = new AbortController();
      const p = searchCode({ engine: 'node', root: big, query: 'needle', signal: ac.signal });
      // Fire on the next tick — the worker is spawned but nowhere near done scanning.
      setImmediate(() => ac.abort());
      const started = Date.now();
      const r = await p;
      assert.equal(r.truncated, true);
      assert.ok(Date.now() - started < 8000, 'mid-scan abort must not wait out the time budget');
    } finally {
      process.env.CCV_PROJECT_DIR = prevDir;
      _resetCacheForTests();
      rmSync(big, { recursive: true, force: true });
    }
  });
});
