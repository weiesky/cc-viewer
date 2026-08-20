import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { utimes, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { withFileLockAsync } from '../server/lib/async-file-lock.js';

async function waitUntil(predicate, { timeout = 3000, interval = 10 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error('waitUntil timeout');
}

describe('async-file-lock 分支补充', () => {
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'afl-branch-'));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('opts 全部缺省时走 ?? 默认值 (deadline/retryMs/staleThresholdMs/writePid)', async () => {
    const lockPath = join(tmpDir, 'defaults.lock');
    const result = await withFileLockAsync(lockPath, () => 'default-ok');
    assert.equal(result, 'default-ok');
    assert.ok(!existsSync(lockPath));
  });

  it('writePid:false 时不写入 PID 内容 (line 54/59 false 臂)', async () => {
    const lockPath = join(tmpDir, 'nopid.lock');
    let sawContent = null;
    const result = await withFileLockAsync(lockPath, () => {
      // 锁文件应存在但为空（未写 pid）
      sawContent = existsSync(lockPath);
    }, { writePid: false });
    assert.equal(result, undefined);
    assert.equal(sawContent, true);
    assert.ok(!existsSync(lockPath));
  });

  it('isLockStale: stat 在 deadline 已过且无 pid 时 catch 返回 false → 抛超时 (line 42-43, 74-83 throw 臂)', async () => {
    // 持有一把"活锁"：无 pid 信息（invalid json），且 mtime 较新 → 非 stale。
    // deadline 立即过期，isLockStale 走 stat 分支，mtime 未超阈值 → false → 抛超时。
    const lockPath = join(tmpDir, 'live-nopid.lock');
    writeFileSync(lockPath, 'not-json');
    await assert.rejects(
      () => withFileLockAsync(lockPath, () => 'never', {
        deadline: 0,           // 立即过期，绕过 while 循环内分支直达 deadline 后逻辑
        staleThresholdMs: 100000,
      }),
      /Lock acquisition timeout/
    );
    // 清理残留活锁
    rmSync(lockPath, { force: true });
  });

  it('deadline 已过但锁是 stale (dead pid) → unlink+continue 拿到锁 (line 75 true 臂)', async () => {
    const lockPath = join(tmpDir, 'dead-after-deadline.lock');
    writeFileSync(lockPath, JSON.stringify({ pid: 999999, ts: Date.now() }));
    const result = await withFileLockAsync(lockPath, () => 'reclaimed', {
      deadline: 0,            // 立即过期 → 直接走 deadline 后的 isLockStale 检查
      staleThresholdMs: 100000,
    });
    assert.equal(result, 'reclaimed');
    assert.ok(!existsSync(lockPath));
  });

  it('deadline 后 stat 命中 mtime 过期 → stale unlink (line 38-40 stat 分支 true)', async () => {
    const lockPath = join(tmpDir, 'old-mtime.lock');
    writeFileSync(lockPath, 'invalid-json-no-pid');
    // 把 mtime 设成很久以前，确保 Date.now() - mtimeMs > threshold
    const old = new Date(Date.now() - 1000000);
    await utimes(lockPath, old, old);
    const result = await withFileLockAsync(lockPath, () => 'mtime-stale-ok', {
      deadline: 0,
      staleThresholdMs: 1000,
    });
    assert.equal(result, 'mtime-stale-ok');
    assert.ok(!existsSync(lockPath));
  });

  it('readLockOwnerPid: 空文件 (!raw) 走 mtime 回退路径', async () => {
    const lockPath = join(tmpDir, 'empty.lock');
    writeFileSync(lockPath, '');
    const old = new Date(Date.now() - 1000000);
    await utimes(lockPath, old, old);
    const result = await withFileLockAsync(lockPath, () => 'empty-ok', {
      deadline: 50,
      staleThresholdMs: 1,
      retryMs: 5,
    });
    assert.equal(result, 'empty-ok');
  });

  it('readLockOwnerPid: 合法 JSON 但 pid 非整数 → 走 mtime 回退 (line 26 false 臂)', async () => {
    const lockPath = join(tmpDir, 'badpid.lock');
    writeFileSync(lockPath, JSON.stringify({ pid: 'not-a-number', foo: 1 }));
    const old = new Date(Date.now() - 1000000);
    await utimes(lockPath, old, old);
    const result = await withFileLockAsync(lockPath, () => 'badpid-ok', {
      deadline: 50,
      staleThresholdMs: 1,
      retryMs: 5,
    });
    assert.equal(result, 'badpid-ok');
  });

  it('isPidAlive: pid<=0 直接判死 → 锁被回收 (line 12 第二分支)', async () => {
    const lockPath = join(tmpDir, 'zero-pid.lock');
    writeFileSync(lockPath, JSON.stringify({ pid: 0, ts: Date.now() }));
    // pid:0 → Number.isInteger 为真但 <=0 → isPidAlive false → isLockStale true
    const result = await withFileLockAsync(lockPath, () => 'zero-ok', {
      deadline: 500,
      staleThresholdMs: 100000,
      retryMs: 5,
    });
    assert.equal(result, 'zero-ok');
  });

  it('while 循环内 (deadline 未过) 遇活锁 → sleep 重试后拿到锁 (line 71 retry 路径)', async () => {
    const lockPath = join(tmpDir, 'retry.lock');
    // 用一个真实存活的 pid（当前进程）但走 _inProcessLocks 串行化会冲突，
    // 改为：先放一个 own-pid（视为 stale）会立即回收，不走 sleep。
    // 这里用一个仍存活的外部 pid 模拟"活锁"，短暂占用后释放。
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid + 1 > 0 ? 999998 : 1, ts: Date.now() }));
    // pid 999998 大概率不存在 → 会被当 stale 回收。为确保走 sleep-retry，
    // 用占位文件 + 后台移除模拟活锁释放。
    rmSync(lockPath, { force: true });
    writeFileSync(lockPath, 'live-json-no-pid');
    // mtime 新 → 非 stale → 在 deadline 内 sleep 重试；后台移除锁让其拿到
    setTimeout(() => { try { rmSync(lockPath, { force: true }); } catch {} }, 40);
    const result = await withFileLockAsync(lockPath, () => 'retried-ok', {
      deadline: 5000,
      staleThresholdMs: 100000,
      retryMs: 10,
    });
    assert.equal(result, 'retried-ok');
  });

  it('isLockStale catch 返回 false: 锁文件在 stat 前被删 (line 41-43)', async () => {
    // 写一个 invalid-json 锁（无 pid），在 deadline 内重试期间删除它，
    // stat 抛 ENOENT → catch → false。随后 open(wx) 成功拿锁。
    const lockPath = join(tmpDir, 'vanish.lock');
    writeFileSync(lockPath, 'no-pid-json');
    setTimeout(() => { try { rmSync(lockPath, { force: true }); } catch {} }, 30);
    const result = await withFileLockAsync(lockPath, () => 'vanished-ok', {
      deadline: 5000,
      staleThresholdMs: 100000,  // 非 stale，强制走 sleep 重试直到文件消失
      retryMs: 10,
    });
    assert.equal(result, 'vanished-ok');
  });
});
