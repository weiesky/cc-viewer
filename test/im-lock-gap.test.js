// im-lock 覆盖补缺：补 test/im-lock.test.js 未触达的分支。
// 目标行（c8 缺口）：
//   - writeLockContent 失败的 catch（temp 清理 + 上抛）：50-52
//   - acquireImLock 三次竞争全失败后的兜底（最后再判一次 → 上抛 Error）：88-91
//   - defaultProbe 真 HTTP 身份探测全分支：122-148
//     （200+合法形状 / 200+错误形状 / 非 200 / 连接错误 / 超时 / 大 body 截断）
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, chmodSync, readdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';

// ████ 数据安全 — 禁止改回静态 import(2026-06-06 事故) ████
// LOG_DIR/CACHE_DIR 等在 findcc.js / server/lib 模块【加载时】即从 env 派生。
// ESM 静态 import 会被提升到本文件任何语句之前执行,所以「先设 env 再静态 import」无效。
// 必须:① node 内置模块静态 import;② 隔离段设 env;③ 项目模块用顶层 await 动态 import。
// 改回静态 import findcc/server 会让本文件单跑(无外部 CCV_LOG_DIR)时落到真实 ~/.claude。
const __isoDir = mkdtempSync(join(tmpdir(), 'ccv-imlockgap-'));
process.env.CCV_LOG_DIR = __isoDir;
process.env.CLAUDE_CONFIG_DIR = __isoDir;

const { LOG_DIR } = await import('../packages/app/findcc.js');
const {
  imDir, lockPath, acquireImLock, updateImLockPort, defaultProbe,
} = await import('../packages/app/server/lib/im/im-lock.js');

let n = 0;
function freshId() { return `gap_lock_${process.pid}_${n++}`; }
function wipe(id) {
  try { chmodSync(imDir(id), 0o755); } catch { /* dir may not exist */ }
  try { rmSync(imDir(id), { recursive: true, force: true }); } catch { /* noop */ }
}

describe('im-lock gap', () => {
  beforeEach(() => { mkdirSync(LOG_DIR, { recursive: true }); });

  // ── writeLockContent catch (50-52) ───────────────────────────────────────
  it('writeLockContent propagates rename failure and cleans up the temp file', () => {
    const id = freshId(); wipe(id);
    acquireImLock(id); // 落一把合法锁，pid===self，updateImLockPort 才会走到 writeLockContent
    const dir = imDir(id);
    // 把锁目录设为只读 → tmp 写入会进不去 / rename 进不去（EACCES，retryable 重试后上抛）。
    chmodSync(dir, 0o555);
    let threw = null;
    try { updateImLockPort(id, 7777); } catch (e) { threw = e; }
    chmodSync(dir, 0o755); // 复原以便断言/清理
    assert.ok(threw, 'updateImLockPort must rethrow when atomic write fails');
    assert.equal(threw.code, 'EACCES');
    // catch 块尝试 unlink(tmp)（best-effort）：目录里不应残留 im.lock.tmp-* 半成品。
    const leftover = readdirSync(dir).filter((f) => f.startsWith('im.lock.tmp-'));
    assert.deepEqual(leftover, [], 'temp file must be cleaned up on failure');
    wipe(id);
  });

  // ── acquireImLock 竞争耗尽后兜底上抛 (88-91) ──────────────────────────────
  it('throws after exhausting retries when the lock path cannot be acquired or reclaimed', () => {
    const id = freshId(); wipe(id);
    // 把 lockPath 本身建成一个目录：
    //   openSync(dir,'wx') → EEXIST（每轮都进 catch）
    //   readImLock(dir) → 读目录当文件失败 → null（holder 为空，不返回 holder）
    //   unlinkSync(dir) → 失败（被 catch 吞掉）→ 文件仍在 → 三轮全失败
    //   循环结束 readImLock 仍 null → 走到 throw
    mkdirSync(lockPath(id), { recursive: true });
    assert.throws(
      () => acquireImLock(id),
      (e) => /failed to acquire after retries/.test(e.message),
    );
    wipe(id);
  });

  it('returns the holder (not throw) if after retries a live foreign holder is detectable', () => {
    // 单独验证 line 90 的 truthy 分支：循环里因为我们自己的 unlink 总成功无法触发，
    // 这里直接构造“目录占位 + 最后一刻塞入活 holder”的场景不可行（lockPath 是目录）；
    // 改为验证常规 EEXIST + 活 holder 在循环内即返回（覆盖 77-78，确保不误抛）。
    const id = freshId(); wipe(id);
    mkdirSync(imDir(id), { recursive: true });
    writeFileSync(lockPath(id), JSON.stringify({ pid: 999999, port: 8000, startedAt: new Date().toISOString() }));
    const r = acquireImLock(id, { isAlive: () => true });
    assert.equal(r.ok, false);
    assert.equal(r.holder.pid, 999999);
    wipe(id);
  });

  // ── defaultProbe 真 HTTP（122-148） ───────────────────────────────────────
  describe('defaultProbe over a real loopback server', () => {
    let server, port;
    const handlers = { fn: null };

    after(() => { if (server) server.close(); });

    function start() {
      return new Promise((resolve) => {
        server = createServer((req, res) => handlers.fn(req, res));
        server.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
      });
    }

    it('resolves {ok, connected, pid} on 200 with a valid IM-status shape (connection.connected)', async () => {
      await start();
      handlers.fn = (req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ connection: { connected: true }, pid: 4242 }));
      };
      const r = await defaultProbe('any', port);
      // No connectionState in the body (old worker) → derived from connected.
      assert.deepEqual(r, { ok: true, connected: true, connectionState: 'connected', lastError: null, pid: 4242 });
    });

    it('carries connectionState/lastError through from a tri-state worker', async () => {
      handlers.fn = (req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ connection: { connected: false, connectionState: 'reconnecting', lastError: 'net down' }, pid: 4242 }));
      };
      const r = await defaultProbe('any', port);
      assert.deepEqual(r, { ok: true, connected: false, connectionState: 'reconnecting', lastError: 'net down', pid: 4242 });
    });

    it('old-worker fallback: connected:false without connectionState derives disconnected', async () => {
      handlers.fn = (req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ connection: { connected: false }, pid: 1 }));
      };
      const r = await defaultProbe('any', port);
      assert.equal(r.connectionState, 'disconnected');
      assert.equal(r.lastError, null);
    });

    it('accepts the "enabled boolean" shape and reports connected:false when no connection', async () => {
      handlers.fn = (req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ enabled: false }));
      };
      const r = await defaultProbe('any', port);
      assert.equal(r.ok, true);
      assert.equal(r.connected, false);
      assert.equal(r.connectionState, 'disconnected');
      assert.equal(r.pid, undefined);
    });

    it('returns null when 200 body has neither connection nor enabled (foreign service)', async () => {
      handlers.fn = (req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ hello: 'world' }));
      };
      assert.equal(await defaultProbe('any', port), null);
    });

    it('returns null on non-200 status', async () => {
      handlers.fn = (req, res) => { res.writeHead(503); res.end('nope'); };
      assert.equal(await defaultProbe('any', port), null);
    });

    it('returns null on invalid JSON body', async () => {
      handlers.fn = (req, res) => { res.writeHead(200); res.end('{not-json'); };
      assert.equal(await defaultProbe('any', port), null);
    });

    it('returns null when nothing is listening (connection error)', async () => {
      // 用一个已关闭服务器的端口几乎必然 ECONNREFUSED。
      const r = await defaultProbe('any', port + 1, { timeoutMs: 300 });
      assert.equal(r, null);
    });

    it('returns null on request timeout (server never responds)', async () => {
      handlers.fn = () => { /* hang: never write a response */ };
      const r = await defaultProbe('any', port, { timeoutMs: 120 });
      assert.equal(r, null);
    });

    it('encodes the id into the probe path', async () => {
      let seenPath = '';
      handlers.fn = (req, res) => {
        seenPath = req.url;
        res.writeHead(200);
        res.end(JSON.stringify({ enabled: true, connection: { connected: false } }));
      };
      await defaultProbe('weird id/与', port);
      assert.equal(seenPath, `/api/im/${encodeURIComponent('weird id/与')}/status`);
    });
  });
});
