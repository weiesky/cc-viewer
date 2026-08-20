// 覆盖目标：CCV_BASE_PATH 反代子路径下的完整路由链（PR #108 遗留 P0 的回归锁）。
// 修复点：handleRequest 剥前缀后写回 parsedUrl.pathname —— dispatch 与各 handler
// （files-content 的 /api/file-raw/ 偏移 slice 等）直读 parsedUrl.pathname，写回前
// 前缀下全部 /api/* 与 SSE /events 命不中路由、落 SPA fallback 返回 HTML。
//
// 隔离手法（参照 test/server-http-extra.test.js）：import server.js 之前把
// CCV_LOG_DIR / CLAUDE_CONFIG_DIR 指向临时目录（铁律：绝不碰真实文件体系），
// CCV_WORKSPACE_MODE=1 阻止自动启动，私有端口窗 17970-17979。
// CCV_BASE_PATH 在 server 侧是每请求读 process.env，故同一 server 实例下
// 各 describe 间直接切换 env 即可覆盖多场景，无需重启。

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── 必须在任何会拉起 findcc.js 的 import 之前设置 ──
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-base-path-'));
mkdirSync(join(tmpDir, 'logs'), { recursive: true });
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';
process.env.NODE_ENV = 'test';
delete process.env.CCV_BASE_PATH;
delete process.env.CCV_ALLOWED_HOSTS;
delete process.env.CCV_USE_PASSWORD;
delete process.env.CCV_PASSWORD;
// 私有高位端口窗，避免与用户真实 ccv 服务(7008-7099)及其他测试文件抢端口。
process.env.CCV_START_PORT = '17970';
process.env.CCV_MAX_PORT = '17979';

/** 低层 http 请求。返回 {status, headers, body}。 */
function raw(port, path, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body != null) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

/** SSE 探测：长连接拿不到 'end'，收到响应头即判定并主动销毁，setTimeout 兜底防挂。 */
function sseProbe(port, path) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path }, (res) => {
      const r = { status: res.statusCode, contentType: res.headers['content-type'] || '' };
      req.destroy();
      resolve(r);
    });
    req.setTimeout(3000, () => { req.destroy(); reject(new Error('SSE probe timeout')); });
    req.on('error', () => {}); // destroy 后的 ECONNRESET 静音（已 resolve）
    req.end();
  });
}

describe('CCV_BASE_PATH reverse-proxy routing', { concurrency: false }, () => {
  let mod, port;

  before(async () => {
    mod = await import('../server/server.js');
    const srv = await mod.startViewer();
    assert.ok(srv, 'server should start');
    port = mod.getPort();
    assert.ok(port > 0, 'port assigned');
  });

  after(async () => {
    delete process.env.CCV_BASE_PATH;
    await new Promise((resolve) => {
      mod.stopViewer();
      setTimeout(() => { rmSync(tmpDir, { recursive: true, force: true }); resolve(); }, 200);
    });
  });

  describe('prefixed routing（/proxy/，P0 回归锁）', () => {
    before(() => { process.env.CCV_BASE_PATH = '/proxy/'; });
    after(() => { delete process.env.CCV_BASE_PATH; });

    it('prefixed API 命中路由返回 JSON（而非 SPA HTML）', async () => {
      const res = await raw(port, '/proxy/api/cli-mode');
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type'].includes('application/json'),
        'prefixed API must return JSON, not SPA HTML fallback');
      assert.equal(JSON.parse(res.body).cliMode, false);
    });

    it('prefixed SSE /proxy/events 返回 text/event-stream', async () => {
      const r = await sseProbe(port, '/proxy/events');
      assert.equal(r.status, 200);
      assert.ok(r.contentType.includes('text/event-stream'),
        `expected SSE stream, got ${r.contentType}`);
    });

    it('prefixed /api/file-raw/<path> 偏移 slice 正确（handler 直读 parsedUrl.pathname）', async () => {
      const f = join(tmpDir, 'raw-probe.txt');
      writeFileSync(f, 'base-path-raw-ok');
      const bare = await raw(port, `/api/file-raw/${encodeURIComponent(f)}`);
      const prefixed = await raw(port, `/proxy/api/file-raw/${encodeURIComponent(f)}`);
      // 与无前缀孪生请求逐项一致：前缀对 handler 完全透明（不依赖 file policy 的放行细节）
      assert.equal(prefixed.status, bare.status);
      assert.equal(prefixed.headers['content-type'], bare.headers['content-type']);
      assert.equal(prefixed.body, bare.body);
      assert.ok(!String(prefixed.headers['content-type']).includes('text/html'),
        'must not fall through to SPA HTML');
    });

    it('prefixed 根路径返回注入 <base> + __CCV_BASE_PATH__ 的 index.html', async () => {
      const res = await raw(port, '/proxy/');
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type'].includes('text/html'));
      assert.ok(res.body.includes('<base href="/proxy/">'));
      assert.ok(res.body.includes('window.__CCV_BASE_PATH__="/proxy/"'));
    });

    it('prefixed 未知前端路由落 SPA fallback', async () => {
      const res = await raw(port, '/proxy/dashboard');
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type'].includes('text/html'));
    });

    it('/api/local-url 返回的分享 URL 带 basePath（二维码扫码不绕过代理）', async () => {
      const res = await raw(port, '/proxy/api/local-url');
      assert.equal(res.status, 200);
      const { url } = JSON.parse(res.body);
      assert.match(url, /\/proxy\/\?token=/, `share url must include base path, got ${url}`);
    });
  });

  describe('normalize：无尾斜杠的 /proxy 同样生效', () => {
    before(() => { process.env.CCV_BASE_PATH = '/proxy'; });
    after(() => { delete process.env.CCV_BASE_PATH; });

    it('/proxy/api/cli-mode 返回 JSON', async () => {
      const res = await raw(port, '/proxy/api/cli-mode');
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type'].includes('application/json'));
    });

    it('<base> 注入为补全尾斜杠后的 /proxy/', async () => {
      const res = await raw(port, '/proxy/');
      assert.ok(res.body.includes('<base href="/proxy/">'));
    });
  });

  describe('向后兼容：未设 CCV_BASE_PATH', () => {
    it('裸 /api/cli-mode 正常 JSON；根路径 HTML 不含 <base> 注入', async () => {
      const api = await raw(port, '/api/cli-mode');
      assert.equal(api.status, 200);
      assert.ok(api.headers['content-type'].includes('application/json'));
      const root = await raw(port, '/');
      assert.equal(root.status, 200);
      assert.ok(!root.body.includes('window.__CCV_BASE_PATH__'),
        'no base injection without CCV_BASE_PATH');
    });
  });

  describe('缺前导斜杠：忽略（按无前缀工作）', () => {
    before(() => { process.env.CCV_BASE_PATH = 'proxy/x/'; });
    after(() => { delete process.env.CCV_BASE_PATH; });

    it('裸 /api/cli-mode 仍正常；根路径不注入 <base>', async () => {
      const api = await raw(port, '/api/cli-mode');
      assert.equal(api.status, 200);
      assert.ok(api.headers['content-type'].includes('application/json'));
      const root = await raw(port, '/');
      assert.ok(!root.body.includes('window.__CCV_BASE_PATH__'));
    });
  });

  describe('注入转义安全（jsSafeBase 修复回归）', () => {
    before(() => { process.env.CCV_BASE_PATH = '/p"x/'; });
    after(() => { delete process.env.CCV_BASE_PATH; });

    it('含双引号的 basePath：script 内 \\" 转义、HTML 属性 &quot;，不破坏文档结构', async () => {
      // 请求路径里的 " 会被 URL 规范化为 %22，startsWith 不命中 → 走根路径取 index.html
      const res = await raw(port, '/');
      assert.equal(res.status, 200);
      assert.ok(res.body.includes('window.__CCV_BASE_PATH__="/p\\"x/"'),
        'JS string must escape the quote');
      assert.ok(res.body.includes('<base href="/p&quot;x/">'),
        'HTML attribute must entity-escape the quote');
    });
  });
});
