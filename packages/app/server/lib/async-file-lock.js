// Async file lock — 替代 Atomics.wait 阻塞锁
// 使用 fs.promises.open('wx') 原子创建 + setTimeout 异步重试
// 同进程内通过 Promise 链串行化，跨进程通过文件锁互斥

import { open, stat, unlink, readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';

// 同进程内的 Promise 互斥锁（按 lockPath 分组）
const _inProcessLocks = new Map();

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

async function readLockOwnerPid(path) {
  try {
    const raw = await readFile(path, 'utf-8');
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj && Number.isInteger(obj.pid)) return obj.pid;
  } catch {}
  return null;
}

async function isLockStale(path, mtimeFallbackMs) {
  const pid = await readLockOwnerPid(path);
  if (pid !== null) {
    // 同进程的锁由 _inProcessLocks 管理，这里看到 own pid 说明是上次崩溃残留
    if (pid === process.pid) return true;
    return !isPidAlive(pid);
  }
  try {
    const stats = await stat(path);
    return Date.now() - stats.mtimeMs > mtimeFallbackMs;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function _acquireFileLock(lockPath, opts) {
  const deadline = Date.now() + (opts.deadline ?? 2000);
  const retryMs = opts.retryMs ?? 25;
  const staleThresholdMs = opts.staleThresholdMs ?? 5000;
  const writePid = opts.writePid !== false;

  while (true) {
    try {
      const fh = await open(lockPath, 'wx');
      if (writePid) {
        await fh.writeFile(JSON.stringify({ pid: process.pid, ts: Date.now() }));
      }
      await fh.close();
      return;
    } catch (err) {
      if (err?.code === 'EEXIST') {
        if (Date.now() < deadline) {
          if (await isLockStale(lockPath, staleThresholdMs)) {
            try { await unlink(lockPath); } catch {}
            continue;
          }
          await sleep(retryMs);
          continue;
        }
        // deadline exceeded — only break if lock is stale (dead PID or old mtime)
        if (await isLockStale(lockPath, staleThresholdMs)) {
          try { await unlink(lockPath); } catch {}
          continue;
        }
        throw new Error(`Lock acquisition timeout: ${lockPath} (held by live process)`);

      }
      throw err;
    }
  }
}

/**
 * @param {string} lockPath - 锁文件路径
 * @param {() => any | Promise<any>} fn - 持锁期间执行的函数
 * @param {object} [opts]
 * @param {number} [opts.deadline] - 最长等待时间 (ms)，默认 2000
 * @param {number} [opts.retryMs] - 重试间隔 (ms)，默认 25
 * @param {number} [opts.staleThresholdMs] - mtime 过期阈值 (ms)，默认 5000
 * @param {boolean} [opts.writePid] - 锁文件中写入 PID 信息，默认 true
 * @param {string} [opts.ensureDir] - 若提供，在获取锁前确保此目录存在
 */
export async function withFileLockAsync(lockPath, fn, opts = {}) {
  if (opts.ensureDir) {
    try { mkdirSync(opts.ensureDir, { recursive: true }); } catch {}
  }

  // 同进程串行化：排队等待前一个持锁操作完成
  const prev = _inProcessLocks.get(lockPath) || Promise.resolve();
  let resolve;
  const next = new Promise(r => { resolve = r; });
  _inProcessLocks.set(lockPath, next);

  await prev;

  try {
    await _acquireFileLock(lockPath, opts);
    try {
      return await fn();
    } finally {
      try { await unlink(lockPath); } catch {}
    }
  } finally {
    resolve();
    if (_inProcessLocks.get(lockPath) === next) {
      _inProcessLocks.delete(lockPath);
    }
  }
}
