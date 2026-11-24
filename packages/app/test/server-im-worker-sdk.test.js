/**
 * server-im-worker-sdk.test.js — SDK 模式下 server.js 不得自启 PTY 版 IM bridge。
 *
 * 门控改动（server.js）：`isCliMode && !isSdkMode && CCV_IM_PLATFORM` 才走 PTY startBridge；
 * SDK worker（CCV_SDK_MODE=1）由 cli.js 的 runImSdkMode 在 initSdkSession 之后自行 startBridge。
 * 若 server.js 在 SDK 模式也启 PTY bridge，会与 runImSdkMode 的 SDK bridge 竞争同一机器人 → 丢/重消息。
 *
 * 本测试在 SDK+IM worker 环境下起 server，断言 server 健康且 imCore 没有运行任何 PTY bridge
 * （bridgeDeps 未被 server.js 注入 PTY 形状）。
 *
 * 约定同 server-im-worker.test.js：node:test + describeCli（CCV_TEST_CLI=1）；私有端口窗。
 */

import { describe, it, before, after } from 'node:test';
import { describeCli } from './_helpers/cli-tier.mjs';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-im-worker-sdk-'));
mkdirSync(join(tmpDir, 'logs'), { recursive: true });
const projectDir = join(tmpDir, 'proj');
mkdirSync(projectDir, { recursive: true });

process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_CLI_MODE = '1';
process.env.CCV_WORKSPACE_MODE = '0';
process.env.CCV_SDK_MODE = '1';           // SDK worker
process.env.NODE_ENV = 'test';
process.env.CCV_START_PORT = '17925';
process.env.CCV_MAX_PORT = '17929';
process.env.CCV_PROJECT_DIR = projectDir;
process.env.CCV_IM_PLATFORM = 'dingtalk'; // IM worker 平台
delete process.env.CCV_BASE_PATH;
delete process.env.CCV_BASE_URL;
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

describeCli('server.js SDK-mode IM-worker must NOT self-start the PTY bridge', { concurrency: false }, () => {
  let mod, imCore, port;

  before(async () => {
    mod = await import('../server/server.js');
    imCore = await import('../server/lib/im/im-bridge-core.js');
    const srv = await mod.startViewer();
    assert.ok(srv, 'SDK-mode IM-worker server should start');
    port = mod.getPort();
    assert.ok(port >= 17925 && port <= 17929, `port should be in private window, got ${port}`);
    await new Promise((r) => { const t = setTimeout(r, 250); if (t.unref) t.unref(); });
  });

  after(async () => {
    try { await imCore.stopAll(); } catch {}
    await new Promise((resolve) => {
      mod.stopViewer();
      setTimeout(() => { rmSync(tmpDir, { recursive: true, force: true }); resolve(); }, 300);
    });
  });

  it('server is healthy in SDK+IM worker mode', async () => {
    const res = await raw(port, '/api/cli-mode');
    assert.equal(res.status, 200, 'loopback request served');
  });

  it('server.js does NOT inject PTY-shaped bridge deps in SDK mode (no self-start)', async () => {
    // SDK worker 的 bridge 由 runImSdkMode 启动；server.js 被 !isSdkMode 门控跳过，
    // 因此 imCore 不应处于 running（且没有 PTY deps）。
    assert.equal(imCore.isBridgeRunning('dingtalk'), false,
      'server.js must not start the PTY bridge when CCV_SDK_MODE=1 (runImSdkMode owns the bridge)');
    // 判别力（quality/architect P1-1）：仅 isBridgeRunning 在"门控被删 + 无 prefs → no-op"的世界
    // 里也为 false，无法区分。真正判别门控的是「server.js 是否注入过 PTY deps」——门控被删时
    // startBridge(id, ptyDeps) 会把 writeToPtySequential 等注入实例。断言 deps 从未被注入。
    const deps = imCore.__getBridgeDepsForTests('dingtalk');
    assert.equal(deps, null,
      'server.js must never inject PTY bridge deps in SDK mode (a deleted !isSdkMode gate would leave writeToPtySequential behind)');
  });
});
