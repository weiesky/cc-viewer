import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateImportDir } from '../lib/file-api.js';

/**
 * Tests for the import-file endpoint's security checks and TOCTOU-safe
 * unique-filename write. The HTTP layer is not exercised here; we test the
 * extracted pure validator and the exclusive-write semantics directly.
 */

describe('validateImportDir', () => {
  it('accepts empty string (project root)', () => {
    assert.deepEqual(validateImportDir(''), { ok: true });
  });

  it('accepts a simple one-level path', () => {
    assert.deepEqual(validateImportDir('src'), { ok: true });
  });

  it('accepts a nested multi-level path (folder upload)', () => {
    assert.deepEqual(validateImportDir('src/components/foo'), { ok: true });
  });

  it('rejects absolute path starting with /', () => {
    const r = validateImportDir('/etc');
    assert.equal(r.ok, false);
    assert.match(r.error, /Invalid/);
  });

  it('rejects absolute path starting with backslash', () => {
    const r = validateImportDir('\\Windows');
    assert.equal(r.ok, false);
  });

  it('rejects embedded null byte', () => {
    const r = validateImportDir('src\0evil');
    assert.equal(r.ok, false);
  });

  it('rejects .. segment (path traversal)', () => {
    const r = validateImportDir('src/../etc');
    assert.equal(r.ok, false);
  });

  it('rejects leading .. segment', () => {
    const r = validateImportDir('../etc');
    assert.equal(r.ok, false);
  });

  it('rejects single . segment', () => {
    const r = validateImportDir('./src');
    assert.equal(r.ok, false);
  });

  it('rejects empty segment (double slash)', () => {
    const r = validateImportDir('src//foo');
    assert.equal(r.ok, false);
  });

  it('rejects trailing slash (empty segment)', () => {
    const r = validateImportDir('src/');
    assert.equal(r.ok, false);
  });

  it('rejects segment containing backslash', () => {
    const r = validateImportDir('src/foo\\bar');
    assert.equal(r.ok, false);
  });

  it('rejects .git as first segment', () => {
    const r = validateImportDir('.git/hooks');
    assert.equal(r.ok, false);
    assert.match(r.error, /\.git/);
  });

  it('rejects .git nested in path', () => {
    const r = validateImportDir('src/.git/config');
    assert.equal(r.ok, false);
    assert.match(r.error, /\.git/);
  });

  it('rejects .Git / .GIT (case-insensitive for CI filesystems)', () => {
    // On macOS / Windows default CI filesystems, `.Git` resolves to the real `.git`
    for (const v of ['.Git/hooks', '.GIT/config', 'src/.Git/x', 'deep/path/.git']) {
      const r = validateImportDir(v);
      assert.equal(r.ok, false, `${v} should be rejected`);
    }
  });

  it('rejects non-string input', () => {
    assert.equal(validateImportDir(null).ok, false);
    assert.equal(validateImportDir(undefined).ok, false);
    assert.equal(validateImportDir(42).ok, false);
  });
});

/**
 * Exclusive-write (wx) unique-name resolver. Mirrors the loop in server.js's
 * /api/import-file. Testing this confirms that concurrent saves cannot overwrite
 * each other — the previous existsSync+write pattern had a TOCTOU race.
 */
function saveUniqueExclusive(dir, originalName, data) {
  const dotIdx = originalName.lastIndexOf('.');
  const stem = dotIdx > 0 ? originalName.slice(0, dotIdx) : originalName;
  const ext = dotIdx > 0 ? originalName.slice(dotIdx) : '';
  let finalName = originalName;
  let savePath = join(dir, finalName);
  let counter = 1;
  while (counter < 10001) {
    try {
      writeFileSync(savePath, data, { flag: 'wx' });
      return { finalName, savePath };
    } catch (e) {
      if (e && e.code === 'EEXIST') {
        finalName = `${stem}-${counter}${ext}`;
        savePath = join(dir, finalName);
        counter++;
        continue;
      }
      throw e;
    }
  }
  throw new Error('Too many conflicts');
}

function makeTmpDir() {
  const d = join(tmpdir(), `ccv-import-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(d, { recursive: true });
  return d;
}

describe('import-file unique-name write (wx flag)', () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('writes a new file with its original name', () => {
    const r = saveUniqueExclusive(dir, 'hello.txt', 'a');
    assert.equal(r.finalName, 'hello.txt');
    assert.equal(readFileSync(r.savePath, 'utf-8'), 'a');
  });

  it('appends -1 suffix on conflict (preserving extension)', () => {
    saveUniqueExclusive(dir, 'hello.txt', 'first');
    const r2 = saveUniqueExclusive(dir, 'hello.txt', 'second');
    assert.equal(r2.finalName, 'hello-1.txt');
    assert.equal(readFileSync(join(dir, 'hello.txt'), 'utf-8'), 'first');
    assert.equal(readFileSync(r2.savePath, 'utf-8'), 'second');
  });

  it('appends -1, -2, -3 ... incrementally', () => {
    const names = [];
    for (let i = 0; i < 4; i++) {
      names.push(saveUniqueExclusive(dir, 'doc.md', `v${i}`).finalName);
    }
    assert.deepEqual(names, ['doc.md', 'doc-1.md', 'doc-2.md', 'doc-3.md']);
  });

  it('handles files without extension', () => {
    saveUniqueExclusive(dir, 'Makefile', 'a');
    const r = saveUniqueExclusive(dir, 'Makefile', 'b');
    assert.equal(r.finalName, 'Makefile-1');
  });

  it('concurrent writes of the same name both succeed with distinct paths', async () => {
    // Simulate TOCTOU: kick off 5 parallel writes of the same filename.
    const data = Buffer.from('x');
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        Promise.resolve().then(() => saveUniqueExclusive(dir, 'race.bin', Buffer.concat([data, Buffer.from(String(i))]))),
      ),
    );
    const paths = new Set(results.map(r => r.savePath));
    assert.equal(paths.size, 5, 'all 5 writes produced distinct paths');
    assert.equal(readdirSync(dir).length, 5);
  });
});

describe('import-file multi-level dir creation', () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('mkdirSync recursive creates nested folders for batch folder drop', () => {
    // Mirrors what /api/import-file does after passing validateImportDir:
    //   mkdirSync(join(cwd, dir), { recursive: true })
    const subDir = join(dir, 'a', 'b', 'c');
    mkdirSync(subDir, { recursive: true });
    assert.ok(existsSync(subDir));
    const r = saveUniqueExclusive(subDir, 'deep.txt', 'hi');
    assert.equal(readFileSync(r.savePath, 'utf-8'), 'hi');
  });
});
