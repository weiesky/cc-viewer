// 覆盖目标：server/server.js 终端 WS 的 resync-request 分支（客户端 write-queue 积压
// 丢弃后请求权威快照对齐，见 src/utils/terminalWriteQueue.js onTrim → TerminalPanel/_requestResync）。
//   - resync-request → 服务端回 data-resync（getOutputBuffer 快照，未 spawn PTY 时为空串）
//   - 冷却兜底：冷却期内的第二次请求不回包（resyncReqGate，CCV_RESYNC_REQ_COOLDOWN_MS）
//   - scratch ws 同协议分支不在此覆盖（需 spawn 真 shell PTY，CI 无 native pty；
//     主路径已验证 resyncReqGate + sendResync 接线，scratch 为同款复制）
//
// 隔离同 server-ws-branches.test.js：CCV_CLI_MODE=1 + mkdtemp env，NODE_ENV=test，
// 全程不发 input → 不拉起 node-pty 子进程。
import { describe, it, before, after } from 'node:test';
import { describeCli } from './_helpers/cli-tier.mjs';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-resync-req-'));
mkdirSync(join(tmpDir, 'logs'), { recursive: true });
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_CLI_MODE = '1';
process.env.CCV_WORKSPACE_MODE = '0';
process.env.CCV_SDK_MODE = '0';
process.env.NODE_ENV = 'test';
delete process.env.CCV_IM_PLATFORM;
delete process.env.CCV_BASE_PATH;
delete process.env.CCV_ALLOWED_HOSTS;
// 私有高位端口窗，避免与用户真实 ccv 服务抢端口（惯例见 server-ws-branches.test.js）
process.env.CCV_START_PORT = '19750';
process.env.CCV_MAX_PORT = '19759';
// 冷却调大确保用例内第二次请求必落在冷却期（默认 1000ms 也够，显式钉死防默认值漂移）
process.env.CCV_RESYNC_REQ_COOLDOWN_MS = '60000';

function connectWs(base, path = '/ws/terminal') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(base + path);
    const msgs = [];
    const waiters = [];
    ws.on('message', (d) => {
      let m;
      try { m = JSON.parse(d.toString()); } catch { m = { raw: d.toString() }; }
      msgs.push(m);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].pred(m)) { waiters[i].resolve(m); waiters.splice(i, 1); }
      }
    });
    ws.on('error', () => {});
    ws.on('open', () => resolve({
      ws,
      msgs,
      send: (m) => ws.send(typeof m === 'string' ? m : JSON.stringify(m)),
      waitFor: (pred, timeoutMs = 2500) => new Promise((res) => {
        const hit = msgs.find(pred);
        if (hit) return res(hit);
        const entry = { pred, resolve: res };
        waiters.push(entry);
        const tid = setTimeout(() => {
          const idx = waiters.indexOf(entry);
          if (idx >= 0) waiters.splice(idx, 1);
          res(null);
        }, timeoutMs);
        if (typeof tid.unref === 'function') tid.unref();
      }),
      close: () => new Promise((res) => { ws.on('close', () => res()); try { ws.close(); } catch { res(); } }),
    }));
    const tid = setTimeout(() => { try { ws.terminate(); } catch {} reject(new Error('ws open timeout')); }, 3000);
    if (typeof tid.unref === 'function') tid.unref();
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describeCli('server.js terminal WS resync-request branch (CLI mode)', { concurrency: false }, () => {
  let mod, port, base;

  before(async () => {
    mod = await import('../server/server.js');
    const srv = await mod.startViewer();
    assert.ok(srv, 'CLI-mode server should start');
    port = mod.getPort();
    assert.ok(port > 0);
    base = `ws://127.0.0.1:${port}`;
    await wait(200); // setupTerminalWebSocket 的 await import 挂载完成
  });

  after(async () => {
    await new Promise((resolve) => {
      mod.stopViewer();
      setTimeout(() => { rmSync(tmpDir, { recursive: true, force: true }); resolve(); }, 400);
    });
  });

  it('resync-request → 回 data-resync 快照；冷却期内第二次请求被吞', async () => {
    const conn = await connectWs(base);
    // 排掉 connection 时的 state/replay 消息，再发请求
    await conn.waitFor((m) => m.type === 'state');

    conn.send({ type: 'resync-request' });
    const resync = await conn.waitFor((m) => m.type === 'data-resync');
    assert.ok(resync, 'first resync-request should be answered with data-resync');
    assert.equal(typeof resync.data, 'string', 'snapshot payload is a string (empty when no PTY)');

    // 冷却期内（60s）再次请求 → 不回包
    const countBefore = conn.msgs.filter((m) => m.type === 'data-resync').length;
    conn.send({ type: 'resync-request' });
    await wait(600);
    const countAfter = conn.msgs.filter((m) => m.type === 'data-resync').length;
    assert.equal(countAfter, countBefore, 'second request within cooldown must be swallowed');

    await conn.close();
  });

  it('未知消息类型不影响连接（resync-request 分支插入未破坏 switch 链）', async () => {
    const conn = await connectWs(base);
    await conn.waitFor((m) => m.type === 'state');
    conn.send({ type: 'no-such-type' });
    conn.send({ type: 'resize', cols: 80, rows: 24 });
    await wait(300);
    assert.equal(conn.ws.readyState, WebSocket.OPEN, 'connection survives unknown + normal messages');
    await conn.close();
  });
});
