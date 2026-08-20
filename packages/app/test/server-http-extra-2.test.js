// 覆盖目标：server/server.js 的 setupTerminalWebSocket（CLI 模式专属，约 1016-1692）
// 以及 startViewer 的 CLI-mode 分支（ptyApi / serverStarted hook / IM reconcile，约 915-998）。
// 这些路径在 workspace 模式不执行（setupTerminalWebSocket 仅 isCliMode 调用），故单独用
// CCV_CLI_MODE=1 拉一个独立 server 进程来驱动。
//
// 做法：用项目内置的 `ws` 依赖连真实 WebSocket，覆盖：
//   - upgrade 鉴权 + 路径分流（/ws/terminal、/ws/terminal-scratch、未知路径 destroy）
//   - scratch id 校验（缺失 / 非法字符 → socket.destroy → 客户端 close 1006）
//   - terminal ws connection：state/buffer 下发、整套 ws.on('message') 分支
//     （resize/input/input-sequential/ask-hook-answer/ask-cancel/perm-hook-answer/
//      sdk-*/image-*-notify/未知 type/坏 JSON）+ close 时的 activeWs 交接
//   - scratch ws connection：state 下发 + input/resize/kill 消息 + close
//
// 注意：input 类消息会让 pty-manager / scratch-pty-manager 真的 spawn 一个 shell（node-pty）。
// 这是 CLI 终端的固有行为，无法用 mock 绕过 upgrade→connection 真实链路；但 shell 是无害的
// 本地子进程，stopViewer() / kill 消息会回收。真正“需要外网 / 真实 PTY 交互断言”的细节路径
// （SIGWINCH 重绘、反压 timeout terminate）放过。

import { describe, it, before, after } from 'node:test';
import { describeCli } from './_helpers/cli-tier.mjs';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-ws-cli-'));
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

/** 打开一个 ws，收集若干消息，到 graceMs 后主动关闭并 resolve。 */
function openWs(base, path, { sendAfterOpen = [], collectMs = 350 } = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(base + path);
    const msgs = [];
    let opened = false;
    let closeCode = null;
    const finish = () => resolve({ ws, opened, msgs, closeCode });
    ws.on('open', () => {
      opened = true;
      for (const m of sendAfterOpen) {
        try { ws.send(typeof m === 'string' ? m : JSON.stringify(m)); } catch {}
      }
      setTimeout(() => { try { ws.close(); } catch {} }, collectMs);
    });
    ws.on('message', (d) => { try { msgs.push(JSON.parse(d.toString())); } catch { msgs.push({ raw: d.toString() }); } });
    ws.on('error', () => {});
    ws.on('close', (code) => { closeCode = code; finish(); });
    // 兜底：连不上也别挂死
    setTimeout(() => { try { ws.terminate(); } catch {} ; finish(); }, collectMs + 1500);
  });
}

describeCli('server.js terminal WebSocket (CLI mode)', { concurrency: false }, () => {
  let mod, port, base, token;

  before(async () => {
    mod = await import('../server/server.js');
    const srv = await mod.startViewer();
    assert.ok(srv, 'CLI-mode server should start');
    port = mod.getPort();
    assert.ok(port > 0);
    token = mod.getAccessToken();
    base = `ws://127.0.0.1:${port}`;
    // 给 setupTerminalWebSocket 的 await import('ws') / pty-manager 一点时间完成挂载
    await new Promise((r) => setTimeout(r, 200));
  });

  after(async () => {
    await new Promise((resolve) => {
      mod.stopViewer();
      setTimeout(() => { rmSync(tmpDir, { recursive: true, force: true }); resolve(); }, 400);
    });
  });

  it('CLI-mode server started and exposes a port + token', () => {
    assert.equal(mod.getProtocol(), 'http');
    assert.match(token, /^[0-9a-f]{32}$/);
  });

  // ─────────── upgrade 路径分流 / 鉴权 ───────────
  describe('upgrade routing & auth', () => {
    it('loopback connects to /ws/terminal and receives an initial state message', async () => {
      const { opened, msgs } = await openWs(base, '/ws/terminal', { collectMs: 250 });
      assert.equal(opened, true, 'terminal ws should open for loopback');
      const types = msgs.map((m) => m.type);
      assert.ok(types.includes('state'), `expected a 'state' message, got ${JSON.stringify(types)}`);
    });

    it('/ws/terminal-scratch with valid id opens and sends state', async () => {
      const { opened, msgs } = await openWs(base, '/ws/terminal-scratch?id=scratchA1', {
        sendAfterOpen: [{ type: 'kill' }], // 立即 kill，避免遗留 scratch shell
        collectMs: 350,
      });
      assert.equal(opened, true, 'scratch ws should open with a valid id');
      const types = msgs.map((m) => m.type);
      assert.ok(types.includes('state'), `expected scratch 'state', got ${JSON.stringify(types)}`);
    });

    it('/ws/terminal-scratch with MISSING id is rejected (socket destroyed → never opens)', async () => {
      const { opened, closeCode } = await openWs(base, '/ws/terminal-scratch', { collectMs: 150 });
      assert.equal(opened, false, 'missing scratch id must be rejected before open');
      assert.equal(closeCode, 1006, 'abnormal closure expected on destroyed upgrade');
    });

    it('/ws/terminal-scratch with INVALID id chars is rejected', async () => {
      const bad = '/ws/terminal-scratch?id=' + encodeURIComponent('has space!');
      const { opened, closeCode } = await openWs(base, bad, { collectMs: 150 });
      assert.equal(opened, false, 'invalid scratch id must be rejected');
      assert.equal(closeCode, 1006);
    });

    it('unknown /ws/* path is rejected (else → destroy)', async () => {
      const { opened, closeCode } = await openWs(base, '/ws/does-not-exist', { collectMs: 150 });
      assert.equal(opened, false, 'unknown ws path must be destroyed');
      assert.equal(closeCode, 1006);
    });
  });

  // ─────────── terminal ws message handler 全分支扫荡 ───────────
  describe('terminal ws message handler branches', () => {
    it('drives the full message battery without crashing the server', async () => {
      // 一条 ws 上连发各种 msg.type，覆盖 ws.on(message) 的分支链。
      // 断言：连接成功打开且服务端在处理完整批量消息后仍能响应（HTTP 探活）。
      const battery = [
        { type: 'resize', cols: 80, rows: 24 },               // PC resize（首个 → activeWs=this）
        { type: 'resize', cols: 100, rows: 30, mobile: true }, // 移动端 resize（始终生效 + 加入 mobileClients）
        { type: 'input', data: 'echo hi\r' },                  // input → spawnShell + writeToPty
        { type: "input", data: String.fromCharCode(3) },       // Ctrl+C 第一次（记录时间戳）
        { type: "input", data: String.fromCharCode(3) },       // Ctrl+C 第二次（2s 内 → blocked toast）
        { type: 'input-sequential', chunks: ['a', 'b'], seq: 7 }, // 顺序写入 → input-sequential-done
        { type: 'ask-hook-answer', answers: ['x'] },           // 缺 id → warn 分支（legacy fallback removed）
        { type: 'ask-hook-answer', id: 'no-such-ask', answers: ['x'] }, // 未知 id → cancelled ack
        { type: 'ask-cancel', id: 'bad id!' },                 // 非法 id 格式 → reject + return
        { type: 'ask-cancel', id: 'unknownAsk', reason: 'nope' }, // 未知 id → ack-only 分支
        { type: 'perm-hook-answer', id: 'no-such-perm', decision: 'allow' }, // 未知 perm → no-op
        { type: 'sdk-ask-answer', id: 'sdkA', answers: ['y'] }, // 无 _sdkResolveApproval → 仅广播分支
        { type: 'sdk-plan-answer', id: 'planA', approve: true },
        { type: 'sdk-user-message', text: 'hello' },           // 无 _sdkSendUserMessage → no-op
        { type: 'sdk-interrupt' },                             // 非 SDK 模式 → warn 分支
        { type: 'image-upload-notify', path: '/tmp/cc-viewer-uploads/img.png', source: 'paste' },
        { type: 'image-remove-notify', path: '/tmp/cc-viewer-uploads/img.png' },
        { type: 'image-upload-notify', path: '../../etc/passwd' }, // traversal → 被拒（不广播）
        { type: 'totally-unknown-type' },                      // 落入无分支 → 静默
        // 进程卫生：上面 input 'echo hi' 触发 spawnShell(/bin/sh)；主终端 ws 不发 kill（server.js
        // 注释明示 ws.close 不杀 pty 以支持刷新重连），且 _doStop 不调 killPty → 干净退出只能靠 shell
        // 进程退出被动回收。这里主动喂一条 'exit\r' 让 /bin/sh 自行退出，降低用例若中途 timeout/崩溃
        // 时 shell orphan 到 PID 1 的风险（不依赖 teardown 时序）。
        { type: 'input', data: 'exit\r' },                     // 让 pty 里的 /bin/sh 主动退出
        'this is not json',                                    // JSON.parse 抛 → catch 吞掉
      ];
      const { opened, msgs } = await openWs(base, '/ws/terminal', {
        sendAfterOpen: battery,
        collectMs: 500,
      });
      assert.equal(opened, true);
      // 至少收到初始 state；可能还会收到 toast(ctrlC blocked) / input-sequential-done / data。
      const types = msgs.map((m) => m.type);
      assert.ok(types.includes('state'));

      // 服务端没被消息批量打挂 —— HTTP 探活仍正常返回 cli-mode=true。
      const probe = await new Promise((resolve, reject) => {
        import('node:http').then(({ request }) => {
          const r = request({ hostname: '127.0.0.1', port, path: '/api/cli-mode', method: 'GET' }, (res) => {
            let d = ''; res.on('data', (c) => d += c); res.on('end', () => resolve({ s: res.statusCode, d }));
          });
          r.on('error', reject); r.end();
        });
      });
      assert.equal(probe.s, 200);
      assert.equal(JSON.parse(probe.d).cliMode, true);
    });

    it('close handler hands activeWs over: two clients, close the active one', async () => {
      // 两条连接：A 先 input 成为 activeWs，再关 A；server 的 close 分支应把控制权交给 B。
      // 仅验证“关闭不抛、B 仍正常”，不深究 PTY 尺寸（PTY 真实交互放过）。
      const a = new WebSocket(base + '/ws/terminal');
      const b = new WebSocket(base + '/ws/terminal');
      await Promise.all([
        new Promise((r) => a.on('open', r)),
        new Promise((r) => b.on('open', r)),
      ]);
      a.on('error', () => {}); b.on('error', () => {});
      // B 先 resize 注册尺寸，A input 抢 activeWs
      b.send(JSON.stringify({ type: 'resize', cols: 90, rows: 28 }));
      a.send(JSON.stringify({ type: 'input', data: 'x' }));
      await new Promise((r) => setTimeout(r, 150));
      // 关闭 A → 触发 close handler 的 activeWs 交接逻辑
      a.close();
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(b.readyState, WebSocket.OPEN, 'B should remain open after A closes');
      // 进程卫生：A 的 input 'x' 已 spawnShell；关 B 前主动喂 'exit\r' 让 /bin/sh 退出，
      // 不依赖 stopViewer/进程 teardown 时序，降低用例中途崩溃时 shell orphan 风险。
      try { b.send(JSON.stringify({ type: 'input', data: 'exit\r' })); } catch {}
      await new Promise((r) => setTimeout(r, 100));
      b.close();
      await new Promise((r) => setTimeout(r, 100));
    });
  });

  // ─────────── scratch ws message handler ───────────
  describe('scratch ws message handler', () => {
    it('scratch ws accepts input/resize then kill, sending state+data', async () => {
      const { opened, msgs } = await openWs(base, '/ws/terminal-scratch?id=scratchMsg1', {
        sendAfterOpen: [
          { type: 'resize', cols: 80, rows: 24 },
          { type: 'input', data: 'echo scratch\r' },
          { type: 'kill' }, // 主动杀掉 scratch pty，回收配额
        ],
        collectMs: 450,
      });
      assert.equal(opened, true);
      const types = msgs.map((m) => m.type);
      assert.ok(types.includes('state'), `scratch should send state, got ${JSON.stringify(types)}`);
    });

    it('scratch ws tolerates a bad-JSON message without crashing', async () => {
      const { opened } = await openWs(base, '/ws/terminal-scratch?id=scratchMsg2', {
        sendAfterOpen: ['<<<not json>>>', { type: 'kill' }],
        collectMs: 300,
      });
      assert.equal(opened, true);
    });
  });
});
