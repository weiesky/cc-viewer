import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { getGitDiffs } from '../lib/git-diff.js';

function makeTmpDir() {
  const dir = join(tmpdir(), `ccv-git-diff-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function initGitRepo(dir) {
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
}

describe('getGitDiffs', () => {
  let cwd;

  beforeEach(() => {
    cwd = makeTmpDir();
    initGitRepo(cwd);
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('returns empty array for empty file list', async () => {
    const result = await getGitDiffs(cwd, []);
    assert.deepStrictEqual(result, []);
  });

  it('skips path traversal with ..', async () => {
    const result = await getGitDiffs(cwd, ['../etc/passwd']);
    assert.deepStrictEqual(result, []);
  });

  it('skips absolute paths', async () => {
    const result = await getGitDiffs(cwd, ['/etc/passwd']);
    assert.deepStrictEqual(result, []);
  });

  it('skips files with no git status changes', async () => {
    writeFileSync(join(cwd, 'clean.txt'), 'hello');
    execSync('git add clean.txt && git commit -m "init"', { cwd, stdio: 'pipe' });
    const result = await getGitDiffs(cwd, ['clean.txt']);
    assert.deepStrictEqual(result, []);
  });

  it('detects new untracked file (??)', async () => {
    writeFileSync(join(cwd, 'new.txt'), 'new content');
    const result = await getGitDiffs(cwd, ['new.txt']);
    assert.equal(result.length, 1);
    assert.equal(result[0].file, 'new.txt');
    assert.equal(result[0].is_new, true);
    assert.equal(result[0].is_deleted, false);
    assert.equal(result[0].new_content, 'new content');
    assert.equal(result[0].old_content, '');
  });

  it('detects modified file (M)', async () => {
    writeFileSync(join(cwd, 'mod.txt'), 'original');
    execSync('git add mod.txt && git commit -m "add"', { cwd, stdio: 'pipe' });
    writeFileSync(join(cwd, 'mod.txt'), 'modified');
    const result = await getGitDiffs(cwd, ['mod.txt']);
    assert.equal(result.length, 1);
    assert.equal(result[0].status, 'M');
    assert.equal(result[0].is_new, false);
    assert.equal(result[0].old_content, 'original');
    assert.equal(result[0].new_content, 'modified');
  });

  it('detects deleted file (D)', async () => {
    writeFileSync(join(cwd, 'del.txt'), 'to delete');
    execSync('git add del.txt && git commit -m "add"', { cwd, stdio: 'pipe' });
    execSync('git rm del.txt', { cwd, stdio: 'pipe' });
    const result = await getGitDiffs(cwd, ['del.txt']);
    assert.equal(result.length, 1);
    assert.equal(result[0].is_deleted, true);
    assert.equal(result[0].new_content, '');
  });

  it('detects staged new file (A)', async () => {
    writeFileSync(join(cwd, 'staged.txt'), 'staged content');
    execSync('git add staged.txt', { cwd, stdio: 'pipe' });
    const result = await getGitDiffs(cwd, ['staged.txt']);
    assert.equal(result.length, 1);
    assert.equal(result[0].status, 'A');
    assert.equal(result[0].is_new, true);
  });

  it('handles multiple files in one call', async () => {
    writeFileSync(join(cwd, 'a.txt'), 'aaa');
    writeFileSync(join(cwd, 'b.txt'), 'bbb');
    const result = await getGitDiffs(cwd, ['a.txt', 'b.txt']);
    assert.equal(result.length, 2);
  });

  it('skips nonexistent files gracefully', async () => {
    const result = await getGitDiffs(cwd, ['nonexistent.txt']);
    assert.deepStrictEqual(result, []);
  });

  it('detects large file and returns is_large', async () => {
    writeFileSync(join(cwd, 'big.txt'), 'x');
    execSync('git add big.txt && git commit -m "add"', { cwd, stdio: 'pipe' });
    // Overwrite with >5MB content
    writeFileSync(join(cwd, 'big.txt'), Buffer.alloc(5 * 1024 * 1024 + 1, 'x'));
    const result = await getGitDiffs(cwd, ['big.txt']);
    assert.equal(result.length, 1);
    assert.equal(result[0].is_large, true);
    assert.ok(result[0].size > 5 * 1024 * 1024);
  });
});
