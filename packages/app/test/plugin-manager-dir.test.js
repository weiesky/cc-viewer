import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deletePluginDir } from '../server/lib/plugin-manager.js';

let tmpRoot;
let pluginsDir;

function setup() {
  tmpRoot = mkdtempSync(join(tmpdir(), 'ccv-dpd-'));
  pluginsDir = join(tmpRoot, 'plugins');
  mkdirSync(pluginsDir, { recursive: true });
}

function teardown() {
  rmSync(tmpRoot, { recursive: true, force: true });
}

describe('deletePluginDir', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('deletes a valid directory plugin recursively', () => {
    mkdirSync(join(pluginsDir, 'hello', 'panel'), { recursive: true });
    writeFileSync(join(pluginsDir, 'hello', 'plugin.json'), JSON.stringify({ name: 'hello' }));
    writeFileSync(join(pluginsDir, 'hello', 'panel', 'index.js'), 'x');
    const r = deletePluginDir(pluginsDir, 'hello');
    assert.deepEqual(r, { deleted: 'hello' });
    assert.ok(!existsSync(join(pluginsDir, 'hello')));
  });

  it('rejects invalid slug names', () => {
    for (const bad of ['', '..', 'a/b', 'a\\b', 'has space', '.hidden']) {
      assert.throws(() => deletePluginDir(pluginsDir, bad), /Invalid directory name/);
    }
  });

  it('rejects non-existent directory (404)', () => {
    assert.throws(() => deletePluginDir(pluginsDir, 'ghost'), /Directory not found/);
  });

  it('rejects directory without plugin.json', () => {
    mkdirSync(join(pluginsDir, 'random-assets'), { recursive: true });
    assert.throws(() => deletePluginDir(pluginsDir, 'random-assets'), /missing plugin\.json/);
  });

  it('rejects manifest name mismatch', () => {
    mkdirSync(join(pluginsDir, 'dirname'), { recursive: true });
    writeFileSync(join(pluginsDir, 'dirname', 'plugin.json'), JSON.stringify({ name: 'other-name' }));
    assert.throws(() => deletePluginDir(pluginsDir, 'dirname'), /does not match/);
    assert.ok(existsSync(join(pluginsDir, 'dirname')), '失败时目录保留');
  });

  it('rejects symlink escape (realpath outside plugins root)', () => {
    const outside = mkdtempSync(join(tmpdir(), 'ccv-dpd-out-'));
    writeFileSync(join(outside, 'plugin.json'), JSON.stringify({ name: 'escape' }));
    symlinkSync(outside, join(pluginsDir, 'escape'), 'dir');
    assert.throws(() => deletePluginDir(pluginsDir, 'escape'), /escapes plugins root|Invalid/);
    assert.ok(existsSync(join(outside, 'plugin.json')), 'symlink 目标未被误删');
    rmSync(outside, { recursive: true, force: true });
  });

  it('rejects bad JSON in plugin.json', () => {
    mkdirSync(join(pluginsDir, 'broken'), { recursive: true });
    writeFileSync(join(pluginsDir, 'broken', 'plugin.json'), '{bad');
    assert.throws(() => deletePluginDir(pluginsDir, 'broken'), /not valid JSON/);
  });
});
