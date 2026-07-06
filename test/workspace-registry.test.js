import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, unlinkSync, writeFileSync, readFileSync, existsSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { LOG_DIR } from '../findcc.js';
import { getWorkspaces, loadWorkspaces, registerWorkspace, removeWorkspace } from '../workspace-registry.js';

const WORKSPACES_FILE = join(LOG_DIR, 'workspaces.json');

function spawnRegister(path) {
  const moduleUrl = new URL('../workspace-registry.js', import.meta.url).href;
  const script = `
    import { registerWorkspace } from ${JSON.stringify(moduleUrl)};
    registerWorkspace(process.argv[1]);
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, path], {
      env: { ...process.env, CCV_LOG_DIR: LOG_DIR },
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`child exited ${code}`));
    });
  });
}

describe('workspace-registry', () => {
  beforeEach(() => {
    try { unlinkSync(WORKSPACES_FILE); } catch { }
  });

  it('loads empty list when file missing or corrupted', () => {
    assert.deepStrictEqual(loadWorkspaces(), []);
    mkdirSync(LOG_DIR, { recursive: true });
    writeFileSync(WORKSPACES_FILE, 'not json');
    assert.deepStrictEqual(loadWorkspaces(), []);
  });

  it('registers a workspace and sanitizes projectName', () => {
    const wsDir = join(tmpdir(), `ccv-ws-${Date.now()}-my project!`);
    mkdirSync(wsDir, { recursive: true });
    const entry = registerWorkspace(wsDir);
    assert.equal(entry.path, wsDir);
    assert.equal(entry.projectName, wsDir.split('/').pop().replace(/[^a-zA-Z0-9_\-\.]/g, '_'));
    const list = loadWorkspaces();
    assert.equal(list.length, 1);
    assert.equal(list[0].path, wsDir);
  });

  it('does not duplicate when registering same path twice', async () => {
    const wsDir = join(tmpdir(), `ccv-ws-${Date.now()}-dup`);
    mkdirSync(wsDir, { recursive: true });
    const first = registerWorkspace(wsDir);
    await new Promise(r => setTimeout(r, 10));
    const second = registerWorkspace(wsDir);
    assert.equal(first.id, second.id);
    const list = loadWorkspaces();
    assert.equal(list.length, 1);
  });

  it('removes workspace by id', () => {
    const wsDir = join(tmpdir(), `ccv-ws-${Date.now()}-rm`);
    mkdirSync(wsDir, { recursive: true });
    const entry = registerWorkspace(wsDir);
    assert.equal(removeWorkspace(entry.id), true);
    assert.deepStrictEqual(loadWorkspaces(), []);
  });

  it('enriches logCount and totalSize in getWorkspaces', () => {
    const wsDir = join(tmpdir(), `ccv-ws-${Date.now()}-logs`);
    mkdirSync(wsDir, { recursive: true });
    const entry = registerWorkspace(wsDir);
    const projectDir = join(LOG_DIR, entry.projectName);
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, `${entry.projectName}_a.jsonl`), '{"a":1}\n');
    writeFileSync(join(projectDir, `${entry.projectName}_b.jsonl`), '{"b":2}\n');
    writeFileSync(join(projectDir, 'readme.txt'), 'x');
    const list = getWorkspaces();
    assert.equal(list.length, 1);
    assert.equal(list[0].logCount, 2);
    assert.ok(list[0].totalSize > 0);
  });

  it('keeps workspaces.json consistent under concurrent register', async () => {
    const wsA = join(tmpdir(), `ccv-ws-${Date.now()}-A`);
    const wsB = join(tmpdir(), `ccv-ws-${Date.now()}-B`);
    mkdirSync(wsA, { recursive: true });
    mkdirSync(wsB, { recursive: true });

    await Promise.all([spawnRegister(wsA), spawnRegister(wsB)]);
    const data = JSON.parse(readFileSync(WORKSPACES_FILE, 'utf-8'));
    assert.ok(Array.isArray(data.workspaces));
    const paths = data.workspaces.map(w => w.path);
    assert.ok(paths.includes(wsA));
    assert.ok(paths.includes(wsB));
  });

  it('recovers from stale lock', () => {
    // Manually create a lock file with old mtime
    const LOCK_FILE = join(LOG_DIR, 'workspaces.lock');
    const oldTime = new Date(Date.now() - 10000);
    writeFileSync(LOCK_FILE, '');
    utimesSync(LOCK_FILE, oldTime, oldTime);

    // Attempt to register - should clear lock and succeed
    const wsDir = join(tmpdir(), `ccv-ws-${Date.now()}-stale`);
    mkdirSync(wsDir, { recursive: true });

    // This will throw if lock is not cleared
    const entry = registerWorkspace(wsDir);
    assert.ok(entry);
    assert.ok(!existsSync(LOCK_FILE)); // Lock should be gone after operation
  });
});
