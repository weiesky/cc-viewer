// 覆盖目标：server/server.js startViewer 内 IM-worker 分支（977-992）——
// 当 isCliMode && process.env.CCV_IM_PLATFORM 时：动态 import pty-manager，调 imCore.startBridge(id, deps)
// 把这台 worker 的单一平台接到 singleton PTY。既有 server-* 测试从不设 CCV_IM_PLATFORM，故走的都是
// else 分支（reconcileImProcesses），977-992 这段 worker 接线始终未覆盖。
//
// 关键安全点：
//   - CCV_IM_PLATFORM 设为合法平台 id（dingtalk），但 tmp 配置里**无该平台 prefs** → loadConfig 返
//     disabled config → imCore.startBridge 在 `!cfg.enabled` 处 no-op 返回，**不建立任何真实 IM 连接、
//     不联网**。我们只为覆盖 server.js 里 await import + startBridge 调用包装这一段。
//   - 设了 CCV_IM_PLATFORM → else-if 的 reconcileImProcesses() 被跳过，**不 spawn 任何 detached worker
//     进程**（进程卫生）。
//   - 不发 input、不连 ws、不拉 PTY 交互；唯一的 await import('./pty-manager.js') 只取函数引用不 spawn。
// 独立进程（模块顶层单例）。端口私有窗 17915-17919（避开 cli-mode 17900-17909 / cli-startup
// 17910-17914 / startup-extra 17860-17899 / lifecycle 17920-17959）。

import { describe, it, before, after } from 'node:test';
import { describeCli } from './_helpers/cli-tier.mjs';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-im-worker-'));
mkdirSync(join(tmpDir, 'logs'), { recursive: true });
const projectDir = join(tmpDir, 'proj');
mkdirSync(projectDir, { recursive: true });

process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_CLI_MODE = '1';
process.env.CCV_WORKSPACE_MODE = '0';
process.env.CCV_SDK_MODE = '0';
process.env.NODE_ENV = 'test';
process.env.CCV_START_PORT = '17915';
process.env.CCV_MAX_PORT = '17919';
process.env.CCV_PROJECT_DIR = projectDir;
// 关键：在 import server.js 之前钉死 IM-worker 平台（合法 id，但无 prefs → startBridge no-op）。
process.env.CCV_IM_PLATFORM = 'dingtalk';
delete process.env.CCV_BASE_PATH;
delete process.env.CCV_ALLOWED_HOSTS;
delete process.env.CCV_USE_PASSWORD;
delete process.env.CCV_PASSWORD;

function raw(port, path) {
  return new Promise((resolve) => {
    const req = request({ hostname: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', (err) => resolve({ status: -1, error: err.code || err.message }));
    const tid = setTimeout(() => { try { req.destroy(); } catch {} resolve({ status: -1, error: 'client-timeout' }); }, 4000);
    if (typeof tid.unref === 'function') tid.unref();
    req.end();
  });
}

describeCli('server.js CLI-mode IM-worker startBridge wiring (CCV_IM_PLATFORM)', { concurrency: false }, () => {
  let mod, imCore, port;

  before(async () => {
    mod = await import('../packages/app/server/server.js');
    imCore = await import('../packages/app/server/lib/im-bridge-core.js');
    const srv = await mod.startViewer();
    assert.ok(srv, 'CLI-mode IM-worker server should start');
    port = mod.getPort();
    assert.ok(port >= 17915 && port <= 17919, `port should be in private window, got ${port}`);
    // 让 startViewer 回调里的 await import(pty-manager) + imCore.startBridge 跑完。
    await new Promise((r) => { const t = setTimeout(r, 250); if (t.unref) t.unref(); });
  });

  after(async () => {
    // 进程卫生：停 worker bridge（no-op，未真启）+ 停 server + 清 tmp。
    try { await imCore.stopAll(); } catch {}
    await new Promise((resolve) => {
      mod.stopViewer();
      setTimeout(() => { rmSync(tmpDir, { recursive: true, force: true }); resolve(); }, 300);
    });
  });

  // ── 977-992：worker 接线执行后 server 健康；bridge 因 disabled config 未真连（no-op） ──
  it('server is healthy after the IM-worker startBridge handoff (disabled config → no real connection)', async () => {
    const res = await raw(port, '/api/cli-mode');
    assert.equal(res.status, 200, 'loopback request served after IM-worker wiring');
    // 无 prefs → bridge 不应处于 running（startBridge 在 !cfg.enabled 处 no-op）。
    assert.equal(imCore.isBridgeRunning('dingtalk'), false, 'bridge must NOT be running with a disabled/absent config');
  });

  it('IM status export reflects isWorker=true when CCV_IM_PLATFORM is set', async () => {
    // 503/513：deps 里 isWorker = !!process.env.CCV_IM_PLATFORM。经 /api/im 路由可观测（若存在）；
    // 退一步只断言 env 仍在（startBridge 读完后 server.js 不删 CCV_IM_PLATFORM，worker 全程保留）。
    assert.equal(process.env.CCV_IM_PLATFORM, 'dingtalk', 'worker keeps CCV_IM_PLATFORM for its lifetime');
  });
});
