import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readModelContextSize, buildContextWindowEvent, CONTEXT_WINDOW_FILE } from '../lib/context-watcher.js';

const CLAUDE_DIR = join(homedir(), '.claude');

// 备份和恢复 context-window.json
let savedContextFile = null;
let contextFileExisted = false;

function backupContextFile() {
  try {
    contextFileExisted = existsSync(CONTEXT_WINDOW_FILE);
    if (contextFileExisted) savedContextFile = readFileSync(CONTEXT_WINDOW_FILE, 'utf-8');
  } catch { }
}

function restoreContextFile() {
  try {
    if (contextFileExisted && savedContextFile !== null) {
      writeFileSync(CONTEXT_WINDOW_FILE, savedContextFile);
    } else if (!contextFileExisted && existsSync(CONTEXT_WINDOW_FILE)) {
      unlinkSync(CONTEXT_WINDOW_FILE);
    }
  } catch { }
  savedContextFile = null;
}

describe('context-watcher: readModelContextSize', () => {
  it('returns default 200k when file does not exist', () => {
    backupContextFile();
    try {
      if (existsSync(CONTEXT_WINDOW_FILE)) unlinkSync(CONTEXT_WINDOW_FILE);
      const result = readModelContextSize();
      assert.equal(result.modelId, null);
      assert.equal(result.contextSize, 200000);
    } finally {
      restoreContextFile();
    }
  });

  it('infers 1M from model.id with [1m] tag', () => {
    backupContextFile();
    try {
      mkdirSync(CLAUDE_DIR, { recursive: true });
      writeFileSync(CONTEXT_WINDOW_FILE, JSON.stringify({
        model: { id: 'claude-opus-4-6[1m]' },
      }) + '\n');
      const result = readModelContextSize();
      assert.equal(result.modelId, 'claude-opus-4-6[1m]');
      assert.equal(result.contextSize, 1000000);
    } finally {
      restoreContextFile();
    }
  });

  it('infers 200k from model.id with [200k] tag', () => {
    backupContextFile();
    try {
      mkdirSync(CLAUDE_DIR, { recursive: true });
      writeFileSync(CONTEXT_WINDOW_FILE, JSON.stringify({
        model: { id: 'claude-sonnet-4-6[200k]' },
      }) + '\n');
      const result = readModelContextSize();
      assert.equal(result.modelId, 'claude-sonnet-4-6[200k]');
      assert.equal(result.contextSize, 200000);
    } finally {
      restoreContextFile();
    }
  });

  it('falls back to context_window.context_window_size from Claude Code statusLine', () => {
    backupContextFile();
    try {
      mkdirSync(CLAUDE_DIR, { recursive: true });
      writeFileSync(CONTEXT_WINDOW_FILE, JSON.stringify({
        model: { id: 'claude-sonnet-4-6' },
        context_window: { context_window_size: 200000 },
      }) + '\n');
      const result = readModelContextSize();
      assert.equal(result.contextSize, 200000);
    } finally {
      restoreContextFile();
    }
  });

  it('defaults Opus to 1M when no size tag in model.id', () => {
    backupContextFile();
    try {
      mkdirSync(CLAUDE_DIR, { recursive: true });
      writeFileSync(CONTEXT_WINDOW_FILE, JSON.stringify({
        model: { id: 'claude-opus-4-6' },
      }) + '\n');
      const result = readModelContextSize();
      assert.equal(result.contextSize, 1000000);
    } finally {
      restoreContextFile();
    }
  });

  it('returns default 200k when model.id has no size tag and no context_window field', () => {
    backupContextFile();
    try {
      mkdirSync(CLAUDE_DIR, { recursive: true });
      writeFileSync(CONTEXT_WINDOW_FILE, JSON.stringify({
        model: { id: 'claude-sonnet-4-6' },
      }) + '\n');
      const result = readModelContextSize();
      assert.equal(result.contextSize, 200000);
    } finally {
      restoreContextFile();
    }
  });
});

describe('context-watcher: buildContextWindowEvent', () => {
  it('computes correct context_window data from usage', () => {
    const usage = {
      input_tokens: 5000,
      output_tokens: 1000,
      cache_creation_input_tokens: 200,
      cache_read_input_tokens: 3000,
    };
    const result = buildContextWindowEvent(usage, 200000);
    assert.ok(result);
    assert.equal(result.total_input_tokens, 8200); // 5000 + 200 + 3000
    assert.equal(result.total_output_tokens, 1000);
    assert.equal(result.context_window_size, 200000);
    assert.equal(result.used_percentage, 5); // (9200 / 200000) * 100 ≈ 5
    assert.equal(result.remaining_percentage, 95);
  });

  it('computes correct percentage for 1M context', () => {
    const usage = { input_tokens: 50000, output_tokens: 10000 };
    const result = buildContextWindowEvent(usage, 1000000);
    assert.ok(result);
    assert.equal(result.context_window_size, 1000000);
    assert.equal(result.used_percentage, 6); // (60000 / 1000000) * 100 = 6
    assert.equal(result.remaining_percentage, 94);
  });

  it('returns null when usage is missing', () => {
    assert.equal(buildContextWindowEvent(null, 200000), null);
    assert.equal(buildContextWindowEvent(undefined, 200000), null);
  });

  it('handles zero tokens gracefully', () => {
    const usage = { input_tokens: 0, output_tokens: 0 };
    const result = buildContextWindowEvent(usage, 200000);
    assert.ok(result);
    assert.equal(result.used_percentage, 0);
    assert.equal(result.remaining_percentage, 100);
  });

  it('preserves current_usage in output', () => {
    const usage = { input_tokens: 1000, output_tokens: 500 };
    const result = buildContextWindowEvent(usage, 200000);
    assert.deepEqual(result.current_usage, usage);
  });
});
