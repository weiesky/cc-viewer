import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ████ 数据安全 — 禁止改回静态 import(2026-06-06 事故) ████
// LOG_DIR/CACHE_DIR 等在 findcc.js / server/lib 模块【加载时】即从 env 派生。
// ESM 静态 import 会被提升到本文件任何语句之前执行,所以「先设 env 再静态 import」无效。
// 必须:① node 内置模块静态 import;② 隔离段设 env;③ 项目模块用顶层 await 动态 import。
// 改回静态 import findcc/server 会让本文件单跑(无外部 CCV_LOG_DIR)时落到真实 ~/.claude。
const __isoDir = mkdtempSync(join(tmpdir(), 'ccv-impm-'));
process.env.CCV_LOG_DIR = __isoDir;
process.env.CLAUDE_CONFIG_DIR = __isoDir;

const { LOG_DIR } = await import('../packages/app/findcc.js');
const { saveConfig } = await import('../packages/app/server/lib/im-config.js');
const { imDir, acquireImLock, updateImLockPort, readImLock, clearImLock } = await import('../packages/app/server/lib/im-lock.js');
const {
  buildChildEnv, spawnImProcess, stopImProcess, getImProcessStatus, reconcileImProcesses,
} = await import('../packages/app/server/lib/im-process-manager.js');

let n = 0;
const freshId = () => `test_pm_${process.pid}_${n++}`;
const wipe = (id) => { try { rmSync(imDir(id), { recursive: true, force: true }); } catch { /* noop */ } };
const fakeSpawn = (records) => (cmd, args, options) => { records.push({ cmd, args, options }); return { pid: 4242, unref() {} }; };

describe('im-process-manager: buildChildEnv (prefix-strip + whitelist refill)', () => {
  it('strips CCV_*/CCVIEWER_*, preserves non-ccv env, sets worker env, inherits CCV_LOG_DIR', () => {
    const base = {
      PATH: '/bin', HOME: '/h', ANTHROPIC_API_KEY: 'sk-x', LANG: 'en_US.UTF-8',
      CCV_BYPASS_PERMISSIONS: '1', CCV_ELECTRON_MULTITAB: '1', CCV_PASSWORD: 'secret',
      CCV_PROJECT_DIR: '/somewhere', CCVIEWER_PORT: '7008', CCV_LOG_DIR: '/tmp/x',
    };
    const env = buildChildEnv('dingtalk', base);
    // preserved
    assert.equal(env.PATH, '/bin');
    assert.equal(env.HOME, '/h');
    assert.equal(env.ANTHROPIC_API_KEY, 'sk-x');
    assert.equal(env.LANG, 'en_US.UTF-8');
    // stripped (these would mis-boot / leak)
    assert.equal(env.CCV_BYPASS_PERMISSIONS, undefined);
    assert.equal(env.CCV_ELECTRON_MULTITAB, undefined);
    assert.equal(env.CCV_PASSWORD, undefined);
    assert.equal(env.CCV_PROJECT_DIR, undefined);
    assert.equal(env.CCVIEWER_PORT, undefined);
    // CCV_LOG_DIR inherited (shared prefs/log root)
    assert.equal(env.CCV_LOG_DIR, '/tmp/x');
    // worker-specific
    assert.equal(env.CCV_IM_PLATFORM, 'dingtalk');
    assert.equal(env.CCV_START_PORT, '7050');
    assert.equal(env.CCV_MAX_PORT, '7099');
    assert.equal(env.CCV_HOST, '127.0.0.1');
    assert.equal(env.CCV_IM_DENY, '1');
  });
});

describe('im-process-manager: spawnImProcess', () => {
  it('spawns `node cli.js --im <id> --no-open` detached with cwd=IM_<id>/ and worker env', () => {
    const id = freshId(); wipe(id);
    const records = [];
    const res = spawnImProcess(id, { spawnImpl: fakeSpawn(records) });
    assert.equal(res.pid, 4242);
    assert.equal(records.length, 1);
    const { cmd, args, options } = records[0];
    assert.ok(typeof cmd === 'string' && cmd.length > 0);
    assert.ok(args.some((a) => a.endsWith('cli.js')));
    assert.deepEqual(args.slice(-3), ['--im', id, '--no-open']);
    assert.equal(options.cwd, imDir(id));
    assert.equal(options.detached, true);
    assert.equal(options.env.CCV_IM_PLATFORM, id);
    assert.equal(options.env.CCV_START_PORT, '7050');
    assert.equal(options.env.CCV_HOST, '127.0.0.1');
    assert.equal(options.env.CCV_IM_DENY, '1');
    wipe(id);
  });
});

describe('im-process-manager: getImProcessStatus', () => {
  beforeEach(() => mkdirSync(LOG_DIR, { recursive: true }));

  it('dead when no lock', async () => {
    const id = freshId(); wipe(id);
    const s = await getImProcessStatus(id);
    assert.equal(s.state, 'dead');
    assert.equal(s.running, false);
    assert.equal(s.connected, false);
    assert.equal(s.connectionState, 'disconnected');
  });

  it('ready (running + connected) when lock has port and probe succeeds', async () => {
    const id = freshId(); wipe(id);
    acquireImLock(id);
    updateImLockPort(id, 7050);
    const s = await getImProcessStatus(id, { probe: async () => ({ ok: true, connected: true, pid: process.pid }) });
    assert.equal(s.state, 'ready');
    assert.equal(s.running, true);
    assert.equal(s.connected, true);
    // Old-worker probe (no connectionState) → derived from connected.
    assert.equal(s.connectionState, 'connected');
    assert.equal(s.port, 7050);
    wipe(id);
  });

  it('ready + reconnecting carries the tri-state and lastError through', async () => {
    const id = freshId(); wipe(id);
    acquireImLock(id);
    updateImLockPort(id, 7055);
    const s = await getImProcessStatus(id, {
      probe: async () => ({ ok: true, connected: false, connectionState: 'reconnecting', lastError: 'net down', pid: process.pid }),
    });
    assert.equal(s.state, 'ready');
    assert.equal(s.connected, false);
    assert.equal(s.connectionState, 'reconnecting');
    assert.equal(s.lastError, 'net down');
    wipe(id);
  });

  it('booting (running, not connected) when lock has no port yet and pid alive', async () => {
    const id = freshId(); wipe(id);
    acquireImLock(id);
    const s = await getImProcessStatus(id, { pidAlive: () => true });
    assert.equal(s.state, 'booting');
    assert.equal(s.running, true);
    assert.equal(s.connected, false);
    assert.equal(s.connectionState, 'disconnected');
    wipe(id);
  });
});

describe('im-process-manager: stopImProcess', () => {
  beforeEach(() => mkdirSync(LOG_DIR, { recursive: true }));

  it('alreadyDead when no lock', async () => {
    const id = freshId(); wipe(id);
    const r = await stopImProcess(id, { timeoutMs: 50, pollIntervalMs: 5 });
    assert.equal(r.alreadyDead, true);
  });

  it('alreadyDead + clears lock when holder pid is gone', async () => {
    const id = freshId(); wipe(id);
    acquireImLock(id);
    const r = await stopImProcess(id, { isAlive: () => false, timeoutMs: 50, pollIntervalMs: 5 });
    assert.equal(r.alreadyDead, true);
    assert.equal(readImLock(id), null);
    wipe(id);
  });

  it('SIGTERMs, then resolves when the worker releases its lock', async () => {
    const id = freshId(); wipe(id);
    acquireImLock(id); // pid = process.pid (alive)
    const signals = [];
    const killImpl = (pid, sig) => { signals.push(sig); if (sig === 'SIGTERM') clearImLock(id); };
    const r = await stopImProcess(id, { killImpl, timeoutMs: 500, pollIntervalMs: 5 });
    assert.equal(r.stopped, true);
    assert.ok(!r.forced);
    assert.deepEqual(signals, ['SIGTERM']);
    wipe(id);
  });

  it('escalates to SIGKILL (process group) when the worker never releases', async () => {
    const id = freshId(); wipe(id);
    acquireImLock(id);
    const signals = [];
    const killImpl = (pid, sig) => signals.push(sig); // never releases lock, pid stays "alive"
    const r = await stopImProcess(id, { killImpl, isAlive: () => true, timeoutMs: 30, pollIntervalMs: 5 });
    assert.equal(r.forced, true);
    assert.ok(signals.includes('SIGTERM'));
    assert.ok(signals.includes('SIGKILL'));
    assert.equal(readImLock(id), null); // force-cleared
    wipe(id);
  });
});

describe('im-process-manager: reconcileImProcesses', () => {
  beforeEach(() => {
    mkdirSync(LOG_DIR, { recursive: true });
    try { rmSync(join(LOG_DIR, 'preferences.json'), { force: true }); } catch { /* noop */ }
  });

  it('spawns enabled platforms that are dead; skips disabled', async () => {
    // enable dingtalk only
    saveConfig('dingtalk', { enabled: true, appKey: 'k', appSecret: 's' });
    const records = [];
    const spawned = await reconcileImProcesses({ spawnImpl: fakeSpawn(records) });
    assert.deepEqual(spawned, ['dingtalk']);
    assert.equal(records.length, 1);
    assert.deepEqual(records[0].args.slice(-3), ['--im', 'dingtalk', '--no-open']);
  });

  it('does NOT spawn when an enabled platform already has a live (ready) worker', async () => {
    saveConfig('feishu', { enabled: true, appId: 'k', appSecret: 's' });
    // simulate a live worker: lock with a port + probe says ready
    acquireImLock('feishu');
    updateImLockPort('feishu', 7051);
    const records = [];
    const spawned = await reconcileImProcesses({
      spawnImpl: fakeSpawn(records),
      probe: async () => ({ ok: true, connected: true, pid: process.pid }),
    });
    assert.ok(!spawned.includes('feishu'));
    assert.equal(records.length, 0);
    clearImLock('feishu');
  });

  it('spawns nothing when no platform is enabled', async () => {
    const records = [];
    const spawned = await reconcileImProcesses({ spawnImpl: fakeSpawn(records) });
    assert.deepEqual(spawned, []);
  });
});
