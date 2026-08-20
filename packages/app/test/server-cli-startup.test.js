// 覆盖目标：server/server.js 模块顶层 --usePassword 交接分支（332-339）——
// CCV_USE_PASSWORD=1 时：取 explicit CCV_PASSWORD（有则用），否则沿用已存密码，再否则 generatePassword；
// saveAuthConfig 落到本项目作用域后 reload。此分支在模块加载时一次性执行，故必须用**独立测试文件
// （= 独立进程）**并在 import server.js 之前把 env 设好。既有 server-auth-branches.test.js 走的是
// 直接写 prefs 的路径，从不设 CCV_USE_PASSWORD，故 331-339 始终未覆盖。
//
// 本文件不发任何 input、不连 ws，仅校验：① getAuthConfig() 反映 enabled=true + 显式密码；
// ② loopback 请求仍被放行（isLocal 短路鉴权门）。无 PTY、无 IM，afterEach 仅 stopViewer + 清 tmp。
// 隔离端口私有窗（17910-17914，避开 cli-mode 17900-17909 / im-worker 17915-17919 /
// startup-extra 17860-17899 / lifecycle 17920-17959）。

import { describe, it, before, after } from 'node:test';
import { describeCli } from './_helpers/cli-tier.mjs';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-cli-startup-'));
mkdirSync(join(tmpDir, 'logs'), { recursive: true });
const projectDir = join(tmpDir, 'proj');
mkdirSync(projectDir, { recursive: true });

const EXPLICIT_PASSWORD = 'unit-explicit-pw-9z';

process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_CLI_MODE = '1';
process.env.CCV_WORKSPACE_MODE = '0';
process.env.CCV_SDK_MODE = '0';
process.env.NODE_ENV = 'test';
process.env.CCV_START_PORT = '17910';
process.env.CCV_MAX_PORT = '17914';
process.env.CCV_PROJECT_DIR = projectDir;
// 关键：在 import server.js 之前设 --usePassword 交接 env，命中 332-339 的 explicit 分支。
process.env.CCV_USE_PASSWORD = '1';
process.env.CCV_PASSWORD = EXPLICIT_PASSWORD;
delete process.env.CCV_IM_PLATFORM;
delete process.env.CCV_BASE_PATH;
delete process.env.CCV_ALLOWED_HOSTS;

function raw(port, path, headers = {}) {
  return new Promise((resolve) => {
    const req = request({ hostname: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', (err) => resolve({ status: -1, error: err.code || err.message }));
    const tid = setTimeout(() => { try { req.destroy(); } catch {} resolve({ status: -1, error: 'client-timeout' }); }, 4000);
    if (typeof tid.unref === 'function') tid.unref();
    req.end();
  });
}

describeCli('server.js CLI-mode --usePassword startup handoff (CCV_USE_PASSWORD)', { concurrency: false }, () => {
  let mod, port;

  before(async () => {
    mod = await import('../server/server.js');
    const srv = await mod.startViewer();
    assert.ok(srv, 'CLI-mode server should start');
    port = mod.getPort();
    assert.ok(port >= 17910 && port <= 17914, `port should be in private window, got ${port}`);
  });

  after(async () => {
    await new Promise((resolve) => {
      mod.stopViewer();
      setTimeout(() => { rmSync(tmpDir, { recursive: true, force: true }); resolve(); }, 300);
    });
  });

  // ── 332-339：CCV_USE_PASSWORD=1 + explicit CCV_PASSWORD → auth 启用且密码为显式值 ──
  it('getAuthConfig() reflects enabled=true with the explicit password from CCV_PASSWORD', () => {
    const cfg = mod.getAuthConfig();
    assert.equal(cfg.enabled, true, 'password handoff should enable auth');
    assert.equal(cfg.password, EXPLICIT_PASSWORD, 'explicit CCV_PASSWORD must win over generated/persisted');
  });

  it('CCV_USE_PASSWORD / CCV_PASSWORD env are scrubbed after the handoff (no plaintext leak downstream)', () => {
    // 342-343：消费完即从 process.env 删除，避免随 {...process.env} 泄漏进 spawn 的子进程。
    assert.equal(process.env.CCV_USE_PASSWORD, undefined, 'CCV_USE_PASSWORD must be deleted post-handoff');
    assert.equal(process.env.CCV_PASSWORD, undefined, 'CCV_PASSWORD must be deleted post-handoff');
  });

  it('a loopback request is still served despite auth being enabled (isLocal short-circuits the gate)', async () => {
    const res = await raw(port, '/api/cli-mode');
    assert.equal(res.status, 200, 'loopback is always allowed even with auth enabled');
  });
});
