/**
 * project-key-from-cwd.test.js — behavior tests for the shared client mirror of the
 * server's projectKeyForCwd (packages/app/server/lib/system-prompt-snapshots.js).
 * Locks the sanitize rules both sides rely on for frame routing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { projectKeyFromCwd } from '../src/utils/projectKeyFromCwd.js';

describe('projectKeyFromCwd', () => {
  it('takes the basename and keeps ASCII word chars/dots/dashes', () => {
    assert.equal(projectKeyFromCwd('/a/b/my-proj_1.2'), 'my-proj_1.2');
    assert.equal(projectKeyFromCwd('/Users/sky/cc-viewer'), 'cc-viewer');
  });

  it('sanitizes spaces and CJK to underscores (matches server routing keys)', () => {
    assert.equal(projectKeyFromCwd('/a/foo bar'), 'foo_bar');
    assert.equal(projectKeyFromCwd('/a/工作区'), '___'.replace(/_/g, '_')); // 3 CJK → 3 underscores
    assert.equal(projectKeyFromCwd('/a/工作区').length, 3);
  });

  it('handles windows-style separators', () => {
    assert.equal(projectKeyFromCwd('C:\\dev\\my proj'), 'my_proj');
  });

  it('degenerates empty / all-dots to _ (no path traversal)', () => {
    assert.equal(projectKeyFromCwd('/a/...'), '_');
    assert.equal(projectKeyFromCwd('/a/.'), '_');
  });

  it('returns empty string for non-string / empty input', () => {
    assert.equal(projectKeyFromCwd(''), '');
    assert.equal(projectKeyFromCwd(null), '');
    assert.equal(projectKeyFromCwd(undefined), '');
    assert.equal(projectKeyFromCwd(42), '');
  });
});
