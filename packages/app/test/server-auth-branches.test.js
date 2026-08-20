// 覆盖目标：server/server.js 在「密码鉴权已启用」时的启动日志 authConfig.enabled 分支
// （passwordActive，888-890）与 getAuthConfig() 的 enabled 路径，并文档化「回环恒放行」不变式。
//
// 隔离手法：在 import server.js 之前往临时 LOG_DIR 写 preferences.json，把全局 `auth` 置为
// { enabled:true, password: base64('s3cret') } —— server.js 顶层 loadAuthConfig 会读到它。
// 用 workspace 模式（非 CLI）：启动日志块受 `if (!isCliMode)` 守卫，只有非 CLI 才打印
// network/password 行 → 命中 authConfig.enabled→passwordActive 分支。
//
// 放过（确认本机回环打不到，由 test/api-auth.test.js 对 decideAuth 纯函数侧等价覆盖）：
// handleRequest 鉴权三态拒绝分支（login-page / unauthorized / forbidden，612-627）与 WS upgrade
// 鉴权失败 destroy（1083-1086）都要求 isLocal=false。decideAuth/upgrade 的 isLocal 取自
// socket.remoteAddress（恒 127.0.0.1），与 Host header 无关，故回环客户端永远被放行，
// 无法从本机入站触发这些拒绝分支。

import { describe, it, before, after } from 'node:test';
import { describeCli } from './_helpers/cli-tier.mjs';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-auth-branch-'));
mkdirSync(join(tmpDir, 'logs'), { recursive: true });
// 在 import 之前写好 enabled 密码（base64 轻混淆，与 auth.js encodePassword 一致）
const PASSWORD = 's3cret';
writeFileSync(
  join(tmpDir, 'preferences.json'),
  JSON.stringify({ auth: { enabled: true, password: Buffer.from(PASSWORD, 'utf-8').toString('base64') } }),
);
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
// 用 workspace 模式（非 CLI）：startViewer 的启动日志块受 `if (!isCliMode)` 守卫，
// 只有非 CLI 才会打印 network/password 行 → 命中 authConfig.enabled 的 passwordActive 分支（888-890）。
// workspace 模式同时阻止 _initPromise 自动启动，由测试显式 startViewer 控时序。
process.env.CCV_CLI_MODE = '0';
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_SDK_MODE = '0';
process.env.NODE_ENV = 'test';
delete process.env.CCV_IM_PLATFORM;
delete process.env.CCV_BASE_PATH;
delete process.env.CCV_ALLOWED_HOSTS;
delete process.env.CCV_USE_PASSWORD;
delete process.env.CCV_PASSWORD;
// 私有高位端口窗,避免与用户真实 ccv 服务(7008-7099)抢端口(2026-06-06 审计 port-clash)。
// server.js 顶层把 CCV_START_PORT/MAX_PORT 冻结为 const,故必须在 import server.js 之前设好(本文件 before() 内动态 import,此处即生效)。
process.env.CCV_START_PORT = '19790';
process.env.CCV_MAX_PORT = '19799';

function raw(port, path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method, headers }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d }));
    });
    req.on('error', reject);
    req.end();
  });
}

describeCli('server.js with password auth enabled (loopback always-allow invariant)', { concurrency: false }, () => {
  let mod, port, token;

  before(async () => {
    mod = await import('../server/server.js');
    const srv = await mod.startViewer();
    assert.ok(srv, 'server should start with auth enabled');
    port = mod.getPort();
    token = mod.getAccessToken();
  });

  after(async () => {
    await new Promise((resolve) => {
      mod.stopViewer();
      setTimeout(() => { rmSync(tmpDir, { recursive: true, force: true }); resolve(); }, 300);
    });
  });

  it('getAuthConfig() reflects enabled=true with the configured plaintext password', () => {
    const cfg = mod.getAuthConfig();
    assert.equal(cfg.enabled, true, 'auth should be enabled from prefs');
    assert.equal(cfg.password, PASSWORD, 'password decoded from base64 prefs storage');
  });

  it('loopback request without any credential is still served (isLocal short-circuits the gate)', async () => {
    // decideAuth 用 socket.remoteAddress=127.0.0.1 判 isLocal → 恒 allow，即便 auth.enabled。
    const res = await raw(port, '/api/cli-mode');
    assert.equal(res.status, 200, 'loopback is always allowed even with auth enabled');
    assert.equal(JSON.parse(res.body).cliMode, false);
  });

  it('loopback request WITH a valid ?token also serves normally (no double-gating)', async () => {
    const res = await raw(port, `/api/cli-mode?token=${token}`);
    assert.equal(res.status, 200);
  });

  it('static asset is served without credential regardless of auth (isStaticAsset bypass)', async () => {
    const res = await raw(port, '/favicon.ico');
    assert.equal(res.status, 200);
    assert.ok(!res.headers['content-type'].includes('text/html'));
  });
});
