/**
 * file-api-gap.test.js — fills the uncovered surface of server/lib/file-api.js
 * (the existing import-file-api.test.js only exercises validateImportDir + a wx-write
 * re-implementation). Here we drive the real exported functions:
 *   - isPathContained          (containment + symlink resolution + error→false)
 *   - resolveFilePath          (editor vs non-editor, abs/.. containment, throws)
 *   - readFileContent          (rel, abs-in-root, editor abs, NOT_FOUND/NOT_FILE/TOO_LARGE)
 *   - writeFileContent         (rel write, editor abs, INVALID_PATH / INVALID_CONTENT)
 *   - renameSyncWithRetry      (success, non-retryable rethrow, retry-then-give-up)
 *   - ERROR_STATUS_MAP         (code→HTTP status table)
 *
 * Each test uses a fresh mkdtemp dir; everything is cleaned up in after().
 * Pure module (no findcc / interceptor import), so direct static import is fine.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync, chmodSync,
} from 'node:fs';
import { join, sep, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  isPathContained,
  resolveFilePath,
  readFileContent,
  writeFileContent,
  renameSyncWithRetry,
  ERROR_STATUS_MAP,
} from '../server/lib/file-api.js';

let root;

before(() => {
  // realpath the tmp root so containment comparisons (which realpath everything) line up
  // on macOS where /var → /private/var.
  root = mkdtempSync(join(tmpdir(), 'ccv-file-api-'));
});
after(() => { rmSync(root, { recursive: true, force: true }); });

describe('isPathContained', () => {
  it('returns true for the root itself', () => {
    assert.equal(isPathContained(root, root), true);
  });

  it('returns true for a child file inside the root', () => {
    const f = join(root, 'inside.txt');
    writeFileSync(f, 'x');
    assert.equal(isPathContained(f, root), true);
  });

  it('returns true for a nested child directory', () => {
    const d = join(root, 'a', 'b');
    mkdirSync(d, { recursive: true });
    assert.equal(isPathContained(d, root), true);
  });

  it('returns false for a sibling path outside the root', () => {
    const sibling = mkdtempSync(join(tmpdir(), 'ccv-file-api-other-'));
    try {
      assert.equal(isPathContained(sibling, root), false);
    } finally {
      rmSync(sibling, { recursive: true, force: true });
    }
  });

  it('does NOT treat a prefix-sharing sibling as contained (root vs root-extra)', () => {
    // Guards the `startsWith(resolvedRoot + sep)` (not bare startsWith) check.
    const decoy = root + '-extra';
    mkdirSync(decoy, { recursive: true });
    try {
      assert.equal(isPathContained(decoy, root), false);
    } finally {
      rmSync(decoy, { recursive: true, force: true });
    }
  });

  it('returns false when realpath throws (non-existent target)', () => {
    assert.equal(isPathContained(join(root, 'does-not-exist-xyz'), root), false);
  });

  it('falls back to CCV_PROJECT_DIR / cwd when root arg omitted', () => {
    const saved = process.env.CCV_PROJECT_DIR;
    process.env.CCV_PROJECT_DIR = root;
    try {
      const f = join(root, 'env-root.txt');
      writeFileSync(f, 'x');
      assert.equal(isPathContained(f), true);
      assert.equal(isPathContained(join(tmpdir(), 'nope-' + Date.now())), false);
    } finally {
      if (saved === undefined) delete process.env.CCV_PROJECT_DIR;
      else process.env.CCV_PROJECT_DIR = saved;
    }
  });
});

describe('resolveFilePath', () => {
  it('throws INVALID_PATH for empty reqPath', () => {
    assert.throws(() => resolveFilePath(root, '', false), (e) => e.code === 'INVALID_PATH');
  });

  it('resolves a plain relative path under cwd (non-editor)', () => {
    const out = resolveFilePath(root, 'sub/file.md', false);
    assert.equal(out, resolve(join(root, 'sub/file.md')));
  });

  it('allows an absolute path that stays inside the project root (non-editor)', () => {
    const abs = join(root, 'inroot.txt');
    writeFileSync(abs, 'x');
    const out = resolveFilePath(root, abs, false);
    assert.equal(out, resolve(abs));
  });

  it('throws INVALID_PATH for an absolute path outside the root (non-editor)', () => {
    const outside = join(tmpdir(), 'ccv-outside-' + Date.now() + '.txt');
    writeFileSync(outside, 'x');
    try {
      assert.throws(() => resolveFilePath(root, outside, false), (e) => e.code === 'INVALID_PATH');
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it('throws INVALID_PATH for a ".." traversal that escapes the root (non-editor)', () => {
    assert.throws(() => resolveFilePath(root, '../../etc/passwd', false), (e) => e.code === 'INVALID_PATH');
  });

  it('editor session: absolute path is allowed verbatim (no containment check)', () => {
    const outside = join(tmpdir(), 'ccv-editor-abs-' + Date.now() + '.txt');
    const out = resolveFilePath(root, outside, true);
    assert.equal(out, resolve(outside));
  });

  it('editor session: relative path is joined under cwd', () => {
    const out = resolveFilePath(root, 'notes.md', true);
    assert.equal(out, resolve(join(root, 'notes.md')));
  });
});

describe('readFileContent', () => {
  it('throws INVALID_PATH for empty reqPath', () => {
    assert.throws(() => readFileContent(root, '', false), (e) => e.code === 'INVALID_PATH');
  });

  it('reads a relative file and returns { path, content, size }', () => {
    writeFileSync(join(root, 'hello.txt'), 'hi there');
    const r = readFileContent(root, 'hello.txt', false);
    assert.equal(r.path, 'hello.txt');
    assert.equal(r.content, 'hi there');
    assert.equal(r.size, Buffer.byteLength('hi there'));
  });

  it('throws NOT_FOUND for a missing relative file', () => {
    assert.throws(() => readFileContent(root, 'no-such.txt', false), (e) => e.code === 'NOT_FOUND');
  });

  it('throws NOT_FILE when the target is a directory (editor abs path)', () => {
    const d = join(root, 'adir');
    mkdirSync(d, { recursive: true });
    assert.throws(() => readFileContent(root, d, true), (e) => e.code === 'NOT_FILE');
  });

  it('throws TOO_LARGE for a file over the 5MB limit', () => {
    const big = join(root, 'big.bin');
    // 5MB + 1 byte
    writeFileSync(big, Buffer.alloc(5 * 1024 * 1024 + 1, 0x61));
    try {
      assert.throws(() => readFileContent(root, 'big.bin', false), (e) => e.code === 'TOO_LARGE');
    } finally {
      rmSync(big, { force: true });
    }
  });

  it('non-editor absolute path inside root → returns relative display path', () => {
    const abs = join(root, 'nested', 'doc.md');
    mkdirSync(join(root, 'nested'), { recursive: true });
    writeFileSync(abs, 'body');
    const r = readFileContent(root, abs, false);
    // display path is relative to realpath(root)
    assert.equal(r.content, 'body');
    assert.ok(!r.path.startsWith('/'), `display path should be relative, got ${r.path}`);
    assert.match(r.path, /nested[\\/]doc\.md$/);
  });

  it('non-editor absolute path OUTSIDE root → INVALID_PATH', () => {
    const outside = join(tmpdir(), 'ccv-read-outside-' + Date.now() + '.txt');
    writeFileSync(outside, 'x');
    try {
      assert.throws(() => readFileContent(root, outside, false), (e) => e.code === 'INVALID_PATH');
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it('editor session: reads an absolute file verbatim, display path = reqPath', () => {
    const abs = join(root, 'editor-read.txt');
    writeFileSync(abs, 'editor body');
    const r = readFileContent(root, abs, true);
    assert.equal(r.path, abs);
    assert.equal(r.content, 'editor body');
  });
});

describe('writeFileContent', () => {
  it('throws INVALID_PATH for empty reqPath', () => {
    assert.throws(() => writeFileContent(root, '', 'x', false), (e) => e.code === 'INVALID_PATH');
  });

  it('writes a relative file and returns { path, size }', () => {
    const r = writeFileContent(root, 'out.txt', 'written', false);
    assert.equal(r.path, 'out.txt');
    assert.equal(r.size, Buffer.byteLength('written'));
    assert.equal(readFileSync(join(root, 'out.txt'), 'utf-8'), 'written');
  });

  it('throws INVALID_PATH for an absolute path (non-editor)', () => {
    assert.throws(() => writeFileContent(root, '/etc/evil', 'x', false), (e) => e.code === 'INVALID_PATH');
  });

  it('throws INVALID_PATH for a ".." path (non-editor)', () => {
    assert.throws(() => writeFileContent(root, '../escape.txt', 'x', false), (e) => e.code === 'INVALID_PATH');
  });

  it('throws INVALID_CONTENT when content is not a string', () => {
    assert.throws(() => writeFileContent(root, 'x.txt', 123, false), (e) => e.code === 'INVALID_CONTENT');
    assert.throws(() => writeFileContent(root, 'x.txt', null, false), (e) => e.code === 'INVALID_CONTENT');
  });

  it('editor session: writes to an absolute path verbatim', () => {
    const abs = join(root, 'editor-write.txt');
    const r = writeFileContent(root, abs, 'edited', true);
    assert.equal(r.path, abs);
    assert.equal(readFileSync(abs, 'utf-8'), 'edited');
  });
});

describe('renameSyncWithRetry', () => {
  it('renames successfully on the first try', () => {
    const src = join(root, 'r-src.txt');
    const dst = join(root, 'r-dst.txt');
    writeFileSync(src, 'data');
    renameSyncWithRetry(src, dst);
    assert.equal(existsSync(src), false);
    assert.equal(readFileSync(dst, 'utf-8'), 'data');
  });

  it('rethrows immediately for a non-retryable error (ENOENT source)', () => {
    const src = join(root, 'missing-src-' + Date.now() + '.txt');
    const dst = join(root, 'wherever.txt');
    assert.throws(() => renameSyncWithRetry(src, dst), (e) => e.code === 'ENOENT');
  });

  it('retries a retryable error (EACCES) then gives up and throws the last error', (t) => {
    // A read-only destination directory makes renameSync raise EACCES (retryable),
    // which exercises the retry loop, the Atomics.wait sleep, and the final give-up
    // throw after exhausting `retries`. Skip if running as root (perms bypassed).
    const src = join(root, 'rr-src.txt');
    writeFileSync(src, 'x');
    const roDir = join(root, 'rr-readonly');
    mkdirSync(roDir, { recursive: true });
    chmodSync(roDir, 0o555);
    try {
      // Sanity: confirm the platform actually denies the write (not root / not Windows).
      let denied = false;
      try { renameSyncWithRetry(src, join(roDir, 'never.txt'), { retries: 1, delayMs: 1 }); }
      catch (e) { denied = e.code === 'EACCES' || e.code === 'EPERM'; }
      if (!denied) { t.skip('platform did not deny rename into read-only dir'); return; }

      // Now the real assertion: with retries:3 + delayMs:1 it must spin then throw EACCES.
      const start = Date.now();
      assert.throws(
        () => renameSyncWithRetry(src, join(roDir, 'dst.txt'), { retries: 3, delayMs: 5 }),
        (e) => e.code === 'EACCES' || e.code === 'EPERM',
      );
      // 3 attempts → 2 inter-attempt sleeps of 5ms each ≈ ≥10ms of Atomics.wait.
      assert.ok(Date.now() - start >= 8, 'retry sleeps should consume real time');
    } finally {
      chmodSync(roDir, 0o755);
    }
  });

  it('honors a retries:1 option (single attempt, throws non-retryable straight away)', () => {
    const src = join(root, 'one-shot-missing-' + Date.now());
    assert.throws(() => renameSyncWithRetry(src, join(root, 'x.txt'), { retries: 1, delayMs: 1 }),
      (e) => e.code === 'ENOENT');
  });
});

describe('ERROR_STATUS_MAP', () => {
  it('maps each FileApiError code to the right HTTP status', () => {
    assert.deepEqual(ERROR_STATUS_MAP, {
      INVALID_PATH: 400,
      NOT_FOUND: 404,
      NOT_FILE: 400,
      TOO_LARGE: 413,
      INVALID_CONTENT: 400,
    });
  });

  it('exposes 404 for NOT_FOUND and 413 for TOO_LARGE specifically', () => {
    assert.equal(ERROR_STATUS_MAP.NOT_FOUND, 404);
    assert.equal(ERROR_STATUS_MAP.TOO_LARGE, 413);
  });
});

// Pin the `sep`-import contract isn't directly testable; covered transitively above.
void sep;
