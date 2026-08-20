// ████ 文件内显式隔离(第六层闸) — ESM 静态 import 会被提升(hoist) ████
// WORKSPACES_FILE = join(LOG_DIR, 'workspaces.json'),beforeEach 对其 unlinkSync。
// LOG_DIR 在 ../findcc.js 模块加载时即固化:若先静态 import findcc 再赋 env,LOG_DIR
// 会落到真实 ~/.claude/cc-viewer,unlinkSync 误伤用户数据(2026-06-06 事故同源)。
// 因此必须:仅 node: 内置静态 import → 隔离段锁 env → 顶层 await 动态 import 项目模块。
// 禁止改回静态 import findcc/workspace-registry。
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, unlinkSync, writeFileSync, readFileSync, existsSync, utimesSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

// ── 隔离段:务必早于任何项目模块 import ──
const __isoDir = mkdtempSync(join(tmpdir(), 'ccv-wsreg-'));
process.env.CCV_LOG_DIR = __isoDir;
process.env.CLAUDE_CONFIG_DIR = __isoDir;

// 隔离段之后才动态 import(此时 LOG_DIR 已固化到 __isoDir)
const { LOG_DIR } = await import('../findcc.js');
const { getWorkspaces, loadWorkspaces, registerWorkspace, removeWorkspace } = await import('../server/workspace-registry.js');

const WORKSPACES_FILE = join(LOG_DIR, 'workspaces.json');

function spawnRegister(path) {
  const moduleUrl = new URL('../server/workspace-registry.js', import.meta.url).href;
  const script = `
    import { registerWorkspace } from ${JSON.stringify(moduleUrl)};
    await registerWorkspace(process.argv[1]);
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

  it('registers a workspace and sanitizes projectName', async () => {
    const wsDir = join(tmpdir(), `ccv-ws-${Date.now()}-my project!`);
    mkdirSync(wsDir, { recursive: true });
    const entry = await registerWorkspace(wsDir);
    assert.equal(entry.path, wsDir);
    assert.equal(entry.projectName, wsDir.split('/').pop().replace(/[^a-zA-Z0-9_\-\.]/g, '_'));
    const list = loadWorkspaces();
    assert.equal(list.length, 1);
    assert.equal(list[0].path, wsDir);
  });

  it('does not duplicate when registering same path twice', async () => {
    const wsDir = join(tmpdir(), `ccv-ws-${Date.now()}-dup`);
    mkdirSync(wsDir, { recursive: true });
    const first = await registerWorkspace(wsDir);
    await new Promise(r => setTimeout(r, 10));
    const second = await registerWorkspace(wsDir);
    assert.equal(first.id, second.id);
    const list = loadWorkspaces();
    assert.equal(list.length, 1);
  });

  it('removes workspace by id', async () => {
    const wsDir = join(tmpdir(), `ccv-ws-${Date.now()}-rm`);
    mkdirSync(wsDir, { recursive: true });
    const entry = await registerWorkspace(wsDir);
    assert.equal(await removeWorkspace(entry.id), true);
    assert.deepStrictEqual(loadWorkspaces(), []);
  });

  it('enriches logCount and totalSize in getWorkspaces', async () => {
    const wsDir = join(tmpdir(), `ccv-ws-${Date.now()}-logs`);
    mkdirSync(wsDir, { recursive: true });
    const entry = await registerWorkspace(wsDir);
    const projectDir = join(LOG_DIR, entry.projectName);
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, `${entry.projectName}_a.jsonl`), '{"a":1}\n');
    writeFileSync(join(projectDir, `${entry.projectName}_b.jsonl`), '{"b":2}\n');
    writeFileSync(join(projectDir, 'readme.txt'), 'x');
    const list = await getWorkspaces();
    assert.equal(list.length, 1);
    assert.equal(list[0].logCount, 2);
    assert.ok(list[0].totalSize > 0);
  });

  it('counts v2 session dirs and reports unmigrated v1 files separately (combined logCount)', async () => {
    const wsDir = join(tmpdir(), `ccv-ws-${Date.now()}-v2`);
    mkdirSync(wsDir, { recursive: true });
    const entry = await registerWorkspace(wsDir);
    const projectDir = join(LOG_DIR, entry.projectName);
    // one unmigrated v1 file + a _temp (excluded) + two v2 sessions (one without journal)
    mkdirSync(join(projectDir, 'sessions', 'sid-1'), { recursive: true });
    mkdirSync(join(projectDir, 'sessions', 'sid-empty'), { recursive: true });
    writeFileSync(join(projectDir, `${entry.projectName}_a.jsonl`), '{"a":1}\n');
    writeFileSync(join(projectDir, `${entry.projectName}_temp.jsonl`), '{"t":1}\n');
    writeFileSync(join(projectDir, 'sessions', 'sid-1', 'journal.jsonl'),
      '{"ph":"meta","wireFormat":2}\n'
      + '{"ph":"req","seq":1,"rid":"r1","kind":"main","ts":"2026-07-16T00:00:00.000Z","url":"u"}\n');
    // discardable probe dir (sub-only, no leader): must count for NOTHING —
    // a probe-only workspace would otherwise auto -c into a void (2026-07-16)
    mkdirSync(join(projectDir, 'sessions', 'sid-probe'), { recursive: true });
    writeFileSync(join(projectDir, 'sessions', 'sid-probe', 'journal.jsonl'),
      '{"ph":"meta","wireFormat":2}\n'
      + '{"ph":"req","seq":1,"rid":"rq","kind":"sub","ts":"2026-07-16T00:00:01.000Z","url":"u"}\n');
    // conv/blob content beyond the journal — totalSize must count the FOLDER
    // (journal-only undercounts ~12x on real sessions).
    mkdirSync(join(projectDir, 'sessions', 'sid-1', 'conversations', 'main'), { recursive: true });
    writeFileSync(join(projectDir, 'sessions', 'sid-1', 'conversations', 'main', 'e0.jsonl'), 'x'.repeat(5000));
    const list = await getWorkspaces();
    const w = list.find(x => x.id === entry.id);
    assert.equal(w.sessionCount, 1, 'only session dirs with a journal count');
    assert.equal(w.unmigratedV1Count, 1, '_temp.jsonl excluded');
    assert.equal(w.logCount, 2, 'combined count keeps the auto--c heuristic alive for declined migrations');
    assert.ok(w.totalSize > 5000, 'session totalSize is recursive folder size, not journal-only');
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

  it('recovers from stale lock', async () => {
    // Manually create a lock file with old mtime
    const LOCK_FILE = join(LOG_DIR, 'workspaces.lock');
    const oldTime = new Date(Date.now() - 10000);
    writeFileSync(LOCK_FILE, '');
    utimesSync(LOCK_FILE, oldTime, oldTime);

    // Attempt to register - should clear lock and succeed
    const wsDir = join(tmpdir(), `ccv-ws-${Date.now()}-stale`);
    mkdirSync(wsDir, { recursive: true });

    // This will throw if lock is not cleared
    const entry = await registerWorkspace(wsDir);
    assert.ok(entry);
    assert.ok(!existsSync(LOCK_FILE)); // Lock should be gone after operation
  });
});
