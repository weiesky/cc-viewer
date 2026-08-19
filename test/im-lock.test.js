import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ████ 数据安全 — 禁止改回静态 import(2026-06-06 事故) ████
// LOG_DIR/CACHE_DIR 等在 findcc.js / server/lib 模块【加载时】即从 env 派生。
// ESM 静态 import 会被提升到本文件任何语句之前执行,所以「先设 env 再静态 import」无效。
// 必须:① node 内置模块静态 import;② 隔离段设 env;③ 项目模块用顶层 await 动态 import。
// 改回静态 import findcc/server 会让本文件单跑(无外部 CCV_LOG_DIR)时落到真实 ~/.claude。
const __isoDir = mkdtempSync(join(tmpdir(), 'ccv-imlock-'));
process.env.CCV_LOG_DIR = __isoDir;
process.env.CLAUDE_CONFIG_DIR = __isoDir;

const { LOG_DIR } = await import('../packages/app/findcc.js');
const {
  imDir, lockPath, isPidAlive, readImLock, acquireImLock,
  updateImLockPort, releaseImLock, clearImLock, getImLiveness, BOOT_WINDOW_MS,
} = await import('../packages/app/server/lib/im-lock.js');

// 每个用例用独立 id，避免互相干扰；beforeEach 清掉残留目录。
let n = 0;
function freshId() { return `test_lock_${process.pid}_${n++}`; }
function wipe(id) { try { rmSync(imDir(id), { recursive: true, force: true }); } catch { /* noop */ } }

describe('im-lock', () => {
  beforeEach(() => { mkdirSync(LOG_DIR, { recursive: true }); });

  it('acquires a fresh lock with {pid, port:null, startedAt}', () => {
    const id = freshId(); wipe(id);
    const r = acquireImLock(id);
    assert.equal(r.ok, true);
    const lock = readImLock(id);
    assert.equal(lock.pid, process.pid);
    assert.equal(lock.port, null);
    assert.ok(lock.startedAt && !Number.isNaN(Date.parse(lock.startedAt)));
    wipe(id);
  });

  it('refuses when a foreign live process holds the lock', () => {
    const id = freshId(); wipe(id);
    mkdirSync(imDir(id), { recursive: true });
    writeFileSync(lockPath(id), JSON.stringify({ pid: 424242, port: 7050, startedAt: new Date().toISOString() }));
    const r = acquireImLock(id, { isAlive: () => true }); // 注入：持有者存活
    assert.equal(r.ok, false);
    assert.equal(r.holder.pid, 424242);
    wipe(id);
  });

  it('reclaims a stale lock whose holder is dead', () => {
    const id = freshId(); wipe(id);
    mkdirSync(imDir(id), { recursive: true });
    writeFileSync(lockPath(id), JSON.stringify({ pid: 424242, port: 7050, startedAt: new Date().toISOString() }));
    const r = acquireImLock(id, { isAlive: () => false }); // 注入：持有者已死
    assert.equal(r.ok, true);
    assert.equal(readImLock(id).pid, process.pid);
    wipe(id);
  });

  it('updateImLockPort backfills port only when pid matches', () => {
    const id = freshId(); wipe(id);
    acquireImLock(id);
    assert.equal(updateImLockPort(id, 7055), true);
    assert.equal(readImLock(id).port, 7055);
    // 模拟锁被后继进程接管（不同 pid）→ 不应覆盖
    writeFileSync(lockPath(id), JSON.stringify({ pid: process.pid + 1, port: 7056, startedAt: new Date().toISOString() }));
    assert.equal(updateImLockPort(id, 9999), false);
    assert.equal(readImLock(id).port, 7056);
    wipe(id);
  });

  it('readImLock tolerates a half-written / corrupt file (returns null, never throws)', () => {
    const id = freshId(); wipe(id);
    mkdirSync(imDir(id), { recursive: true });
    writeFileSync(lockPath(id), '{ partial json no close');
    assert.equal(readImLock(id), null);
    writeFileSync(lockPath(id), '');
    assert.equal(readImLock(id), null);
    wipe(id);
  });

  it('releaseImLock only removes the lock when pid matches; clearImLock is unconditional', () => {
    const id = freshId(); wipe(id);
    acquireImLock(id); // our pid
    // 身份不符 → 不删
    assert.equal(releaseImLock(id, process.pid + 1), false);
    assert.equal(existsSync(lockPath(id)), true);
    // 身份相符 → 删
    assert.equal(releaseImLock(id, process.pid), true);
    assert.equal(existsSync(lockPath(id)), false);
    // 双重释放幂等
    assert.equal(releaseImLock(id, process.pid), true);
    // clearImLock 无条件
    writeFileSync(lockPath(id), JSON.stringify({ pid: 1, port: 1, startedAt: '' }));
    assert.equal(clearImLock(id), true);
    assert.equal(existsSync(lockPath(id)), false);
    wipe(id);
  });

  describe('getImLiveness (tri-state)', () => {
    it('dead when no lock file', async () => {
      const id = freshId(); wipe(id);
      const r = await getImLiveness(id);
      assert.equal(r.state, 'dead');
    });

    it('booting when lock has no port, startedAt is recent, and pid alive', async () => {
      const id = freshId(); wipe(id);
      acquireImLock(id); // port:null, startedAt=now, pid=us(alive)
      const r = await getImLiveness(id, { pidAlive: () => true });
      assert.equal(r.state, 'booting');
      wipe(id);
    });

    it('dead when lock has no port but startedAt is past the boot window', async () => {
      const id = freshId(); wipe(id);
      acquireImLock(id);
      const future = () => Date.now() + BOOT_WINDOW_MS + 1000;
      const r = await getImLiveness(id, { now: future, pidAlive: () => false });
      assert.equal(r.state, 'dead');
      wipe(id);
    });

    it('ready when port present and HTTP identity probe succeeds', async () => {
      const id = freshId(); wipe(id);
      acquireImLock(id);
      updateImLockPort(id, 7051);
      const probe = async () => ({ ok: true, connected: true, pid: process.pid });
      const r = await getImLiveness(id, { probe });
      assert.equal(r.state, 'ready');
      assert.equal(r.connected, true);
      // Probe without connectionState (old worker) → derived from connected.
      assert.equal(r.connectionState, 'connected');
      assert.equal(r.lastError, null);
      wipe(id);
    });

    it('ready carries connectionState/lastError through from a tri-state probe', async () => {
      const id = freshId(); wipe(id);
      acquireImLock(id);
      updateImLockPort(id, 7054);
      const probe = async () => ({ ok: true, connected: false, connectionState: 'reconnecting', lastError: 'net down', pid: process.pid });
      const r = await getImLiveness(id, { probe });
      assert.equal(r.state, 'ready');
      assert.equal(r.connected, false);
      assert.equal(r.connectionState, 'reconnecting');
      assert.equal(r.lastError, 'net down');
      wipe(id);
    });

    it('hung when port present, probe fails, but pid still alive', async () => {
      const id = freshId(); wipe(id);
      acquireImLock(id);
      updateImLockPort(id, 7052);
      const r = await getImLiveness(id, { probe: async () => null, pidAlive: () => true });
      assert.equal(r.state, 'hung');
      wipe(id);
    });

    it('dead when port present, probe fails, and pid is gone', async () => {
      const id = freshId(); wipe(id);
      acquireImLock(id);
      updateImLockPort(id, 7053);
      const r = await getImLiveness(id, { probe: async () => null, pidAlive: () => false });
      assert.equal(r.state, 'dead');
      wipe(id);
    });
  });

  it('isPidAlive: current process alive, absurd pid dead', () => {
    assert.equal(isPidAlive(process.pid), true);
    assert.equal(isPidAlive(2147483646), false);
    assert.equal(isPidAlive(0), false);
    assert.equal(isPidAlive(-1), false);
  });
});
