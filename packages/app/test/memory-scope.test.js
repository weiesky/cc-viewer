import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Pin the shared memory-dir derivation. Three call sites (files-content,
// files-fs, target-scope) consume memoryDirFor; if any one of them ever
// re-implements the encoding inline it will drift — the trailing-separator
// bug is the canonical example (raw bound cwd with a trailing '/' used to
// 404 the in-app memory browser).
describe('memoryDirFor', () => {
  it('strips trailing path separators before encoding', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'ccv-memory-scope-'));
    process.env.CLAUDE_CONFIG_DIR = configDir;
    try {
      const { memoryDirFor } = await import('../server/lib/memory-scope.js');
      const bare = memoryDirFor('/tmp/some-project');
      const trailing = memoryDirFor('/tmp/some-project/');
      const windowsTrailing = memoryDirFor('/tmp/some-project\\');
      assert.equal(trailing, bare);
      assert.equal(windowsTrailing, bare);
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('encodes every non [a-zA-Z0-9-] char to a single dash (matching the Claude Code project dir layout)', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'ccv-memory-scope-'));
    process.env.CLAUDE_CONFIG_DIR = configDir;
    try {
      const { memoryDirFor } = await import('../server/lib/memory-scope.js');
      const dir = memoryDirFor('/Users/sky/.npm-global/lib');
      assert.equal(dir, join(configDir, 'projects', '-Users-sky--npm-global-lib', 'memory'));
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('handles empty / non-ASCII cwd deterministically', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'ccv-memory-scope-'));
    process.env.CLAUDE_CONFIG_DIR = configDir;
    try {
      const { memoryDirFor } = await import('../server/lib/memory-scope.js');
      // Each non-ASCII char collapses to its own '-' (per-char replace).
      const nonAscii = memoryDirFor('/tmp/项目');
      assert.equal(nonAscii, join(configDir, 'projects', '-tmp---', 'memory'));
      // Empty input is degenerate but must not throw.
      const empty = memoryDirFor('');
      assert.equal(empty, join(configDir, 'projects', '', 'memory'));
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});
