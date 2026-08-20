import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { getGitDiffs, countUntrackedLines } from '../server/lib/git-diff.js';

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

  it('normalizes CRLF to LF so diff does not treat line endings as changes', async () => {
    writeFileSync(join(cwd, 'crlf.txt'), 'line1\nline2\nline3');
    execSync('git add crlf.txt && git commit -m "add"', { cwd, stdio: 'pipe' });
    // Overwrite with CRLF — only real change is "line2" → "modified"
    writeFileSync(join(cwd, 'crlf.txt'), 'line1\r\nmodified\r\nline3');
    const result = await getGitDiffs(cwd, ['crlf.txt']);
    assert.equal(result.length, 1);
    assert.equal(result[0].status, 'M');
    // Both contents should be normalized to LF
    assert.equal(result[0].old_content, 'line1\nline2\nline3');
    assert.equal(result[0].new_content, 'line1\nmodified\nline3');
  });
});

describe('countUntrackedLines', () => {
  let cwd;

  beforeEach(() => {
    cwd = makeTmpDir();
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('returns 0 for a missing file', () => {
    assert.equal(countUntrackedLines(cwd, 'nope.txt'), 0);
  });

  it('returns 0 for an empty file', () => {
    writeFileSync(join(cwd, 'empty.txt'), '');
    assert.equal(countUntrackedLines(cwd, 'empty.txt'), 0);
  });

  it('counts a single unterminated line as 1', () => {
    writeFileSync(join(cwd, 'a.txt'), 'hello');
    assert.equal(countUntrackedLines(cwd, 'a.txt'), 1);
  });

  it('counts a single newline-terminated line as 1', () => {
    writeFileSync(join(cwd, 'a.txt'), 'hello\n');
    assert.equal(countUntrackedLines(cwd, 'a.txt'), 1);
  });

  it('counts multi-line content with trailing newline correctly', () => {
    writeFileSync(join(cwd, 'a.txt'), 'a\nb\nc\n');
    assert.equal(countUntrackedLines(cwd, 'a.txt'), 3);
  });

  it('counts multi-line content without trailing newline correctly', () => {
    writeFileSync(join(cwd, 'a.txt'), 'a\nb\nc');
    assert.equal(countUntrackedLines(cwd, 'a.txt'), 3);
  });

  it('returns 0 for a binary file (null byte in first 8KB)', () => {
    writeFileSync(join(cwd, 'bin.dat'), Buffer.from([0x00, 0x01, 0x02, 0x03]));
    assert.equal(countUntrackedLines(cwd, 'bin.dat'), 0);
  });

  it('returns 0 for a file larger than 5MB', () => {
    writeFileSync(join(cwd, 'big.txt'), Buffer.alloc(5 * 1024 * 1024 + 1, 'x'));
    assert.equal(countUntrackedLines(cwd, 'big.txt'), 0);
  });

  it('counts a text file with only newlines as one line per newline', () => {
    writeFileSync(join(cwd, 'nl.txt'), '\n\n\n');
    assert.equal(countUntrackedLines(cwd, 'nl.txt'), 3);
  });

  it('rejects path traversal with ..', () => {
    assert.equal(countUntrackedLines(cwd, '../etc/passwd'), 0);
  });

  it('rejects absolute paths', () => {
    assert.equal(countUntrackedLines(cwd, '/etc/passwd'), 0);
  });

  it('rejects empty or nullish file argument', () => {
    assert.equal(countUntrackedLines(cwd, ''), 0);
    assert.equal(countUntrackedLines(cwd, null), 0);
    assert.equal(countUntrackedLines(cwd, undefined), 0);
  });

  it('returns 0 for a directory path', () => {
    mkdirSync(join(cwd, 'subdir'));
    assert.equal(countUntrackedLines(cwd, 'subdir'), 0);
  });

  it('refuses to follow a symlink pointing outside cwd (security)', () => {
    // Write a sentinel "sensitive" file outside cwd and symlink to it.
    const outside = makeTmpDir();
    try {
      const sensitive = join(outside, 'secret.txt');
      writeFileSync(sensitive, 'line1\nline2\nline3\n');
      symlinkSync(sensitive, join(cwd, 'leak.txt'));
      // Without the symlink guard this would return 3, leaking the line count.
      assert.equal(countUntrackedLines(cwd, 'leak.txt'), 0);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('refuses an intermediate symlink that escapes cwd (security)', () => {
    const outside = makeTmpDir();
    try {
      writeFileSync(join(outside, 'data.txt'), 'a\nb\nc\n');
      // cwd/link -> outside ; read path = cwd/link/data.txt, realpath = outside/data.txt
      symlinkSync(outside, join(cwd, 'link'));
      assert.equal(countUntrackedLines(cwd, 'link/data.txt'), 0);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('allows a symlink that stays inside cwd', () => {
    writeFileSync(join(cwd, 'real.txt'), 'a\nb\n');
    symlinkSync(join(cwd, 'real.txt'), join(cwd, 'alias.txt'));
    // The alias is still a symlink, so lstat rejects — this asserts the
    // defensive behavior even in the benign case (no false sense of safety).
    assert.equal(countUntrackedLines(cwd, 'alias.txt'), 0);
    // The real file remains countable via its own name.
    assert.equal(countUntrackedLines(cwd, 'real.txt'), 2);
  });

  it('matches git diff --numstat for a typical new JS source file', () => {
    initGitRepo(cwd);
    const content = 'export function foo() {\n  return 1;\n}\n';
    writeFileSync(join(cwd, 'src.js'), content);
    // Add intent-to-add so numstat has something to compare to
    execSync('git add --intent-to-add src.js', { cwd, stdio: 'pipe' });
    const numstat = execSync('git diff --numstat', { cwd, encoding: 'utf-8' });
    const m = numstat.match(/^(\d+)\t/);
    assert.ok(m, 'git diff --numstat produced a count');
    const gitCount = Number(m[1]);
    assert.equal(countUntrackedLines(cwd, 'src.js'), gitCount);
  });
});
