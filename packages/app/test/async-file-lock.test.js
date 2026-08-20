import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { withFileLockAsync } from '../server/lib/async-file-lock.js';

describe('withFileLockAsync', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'afl-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should execute fn under lock and clean up', async () => {
    const lockPath = join(tmpDir, 'test.lock');
    const result = await withFileLockAsync(lockPath, () => 42);
    assert.equal(result, 42);
    assert.ok(!existsSync(lockPath));
  });

  it('should support async fn', async () => {
    const lockPath = join(tmpDir, 'test.lock');
    const result = await withFileLockAsync(lockPath, async () => {
      await new Promise(r => setTimeout(r, 10));
      return 'async-result';
    });
    assert.equal(result, 'async-result');
    assert.ok(!existsSync(lockPath));
  });

  it('should clean up lock on fn error', async () => {
    const lockPath = join(tmpDir, 'test.lock');
    await assert.rejects(
      () => withFileLockAsync(lockPath, () => { throw new Error('oops'); }),
      { message: 'oops' }
    );
    assert.ok(!existsSync(lockPath));
  });

  it('should write pid to lock file', async () => {
    const lockPath = join(tmpDir, 'test.lock');
    let lockContent = null;
    await withFileLockAsync(lockPath, () => {
      lockContent = JSON.parse(readFileSync(lockPath, 'utf-8'));
    });
    assert.equal(lockContent.pid, process.pid);
    assert.ok(lockContent.ts > 0);
  });

  it('should handle stale lock from dead process', async () => {
    const lockPath = join(tmpDir, 'test.lock');
    // Simulate stale lock from a dead PID
    writeFileSync(lockPath, JSON.stringify({ pid: 999999, ts: Date.now() - 10000 }));
    const result = await withFileLockAsync(lockPath, () => 'recovered', {
      deadline: 500,
      staleThresholdMs: 1000,
    });
    assert.equal(result, 'recovered');
  });

  it('should handle stale lock from own process', async () => {
    const lockPath = join(tmpDir, 'test.lock');
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, ts: Date.now() - 10000 }));
    const result = await withFileLockAsync(lockPath, () => 'self-recovered');
    assert.equal(result, 'self-recovered');
  });

  it('should handle mtime-based stale detection when no pid', async () => {
    const lockPath = join(tmpDir, 'test.lock');
    writeFileSync(lockPath, 'invalid-json');
    // Touch with old mtime isn't easy, but we can set a short threshold
    const result = await withFileLockAsync(lockPath, () => 'ok', {
      deadline: 3000,
      staleThresholdMs: 0,
    });
    assert.equal(result, 'ok');
  });

  it('should serialize concurrent access', async () => {
    const lockPath = join(tmpDir, 'test.lock');
    const dataFile = join(tmpDir, 'data.txt');
    writeFileSync(dataFile, '0');

    const increment = () => withFileLockAsync(lockPath, async () => {
      const val = parseInt(readFileSync(dataFile, 'utf-8'));
      await new Promise(r => setTimeout(r, 5));
      writeFileSync(dataFile, String(val + 1));
    }, { retryMs: 5, deadline: 10000 });

    await Promise.all([increment(), increment(), increment()]);
    assert.equal(readFileSync(dataFile, 'utf-8'), '3');
  });

  it('should ensure directory if requested', async () => {
    const subDir = join(tmpDir, 'sub', 'dir');
    const lockPath = join(subDir, 'test.lock');
    const result = await withFileLockAsync(lockPath, () => 'ok', { ensureDir: subDir });
    assert.equal(result, 'ok');
  });
});
