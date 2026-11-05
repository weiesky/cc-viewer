// 覆盖目标：CCV_BASE_URL（云端反代公网 URL）—— 三种写法的剥离/注入/Host 加白/外链生成。
// 隔离手法同 api-base-path.test.js：import server.js 之前设置临时 LOG_DIR 与私有端口窗；
// CCV_BASE_URL 在 server 侧每请求现读 process.env，同一实例下各 describe 翻转 env 即可。
// 端口窗 18500-18509（全仓唯一，与其他测试文件不重叠）。

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── 必须在任何会拉起 findcc.js 的 import 之前设置 ──
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-base-url-'));
mkdirSync(join(tmpDir, 'logs'), { recursive: true });
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';
process.env.NODE_ENV = 'test';
delete process.env.CCV_BASE_URL;
delete process.env.CCV_BASE_PATH;
delete process.env.CCV_ALLOWED_HOSTS;
delete process.env.CCV_USE_PASSWORD;
delete process.env.CCV_PASSWORD;
// 私有高位端口窗，避免与用户真实 ccv 服务(7008-7099)及其他测试文件抢端口。
process.env.CCV_START_PORT = '18500';
process.env.CCV_MAX_PORT = '18509';

const HOST = 'arca-sandbox-office.alipay.com';
const PREFIX = '/arca/api/v1/session/{token}';        // 字面前缀（配置形态）
const WIRE = '/arca/api/v1/session/%7Btoken%7D';      // 线格式（请求 pathname 经 new URL 编码后）

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
function sseProbe(port, path, { headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, headers }, (res) => {
      const r = { status: res.statusCode, contentType: res.headers['content-type'] || '' };
      req.destroy();
      resolve(r);
    });
    req.setTimeout(3000, () => { req.destroy(); reject(new Error('SSE probe timeout')); });
    req.on('error', () => {}); // destroy 后的 ECONNRESET 静音（已 resolve）
    req.end();
  });
}

describe('CCV_BASE_URL cloud reverse-proxy', { concurrency: false }, () => {
  let mod, port;

  before(async () => {
    mod = await import('../server/server.js');
    const srv = await mod.startViewer();
    assert.ok(srv, 'server should start');
    port = mod.getPort();
    assert.ok(port > 0, 'port assigned');
  });

  after(async () => {
    delete process.env.CCV_BASE_URL;
    delete process.env.CCV_BASE_PATH;
    delete process.env.CCV_ALLOWED_HOSTS;
    await new Promise((resolve) => {
      mod.stopViewer();
      setTimeout(() => { rmSync(tmpDir, { recursive: true, force: true }); resolve(); }, 200);
    });
  });

  describe('形式3 完整 URL（https://host/path）', () => {
    before(() => { process.env.CCV_BASE_URL = `https://${HOST}${PREFIX}`; });
    after(() => { delete process.env.CCV_BASE_URL; });

    it('带前缀 API 命中路由返回 JSON（Host 用代理域名 → 剥离 + 自动加白）', async () => {
      const res = await raw(port, `${PREFIX}/api/cli-mode`, { headers: { host: HOST } });
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type'].includes('application/json'),
        'prefixed API must return JSON, not SPA HTML fallback');
      assert.equal(JSON.parse(res.body).cliMode, false);
    });

    it('带前缀静态资源（编码形式）返回 JS 而非 SPA HTML', async () => {
      // 资产名带 hash，从注入后的 index.html 里现取一个真实存在的 ./assets/ 引用
      const idx = await raw(port, `${WIRE}/`, { headers: { host: HOST } });
      const m = idx.body.match(/"\.\/(assets\/[^"]+\.js)"/);
      assert.ok(m, 'index.html should reference a hashed js asset');
      const res = await raw(port, `${WIRE}/${m[1]}`, { headers: { host: HOST } });
      assert.equal(res.status, 200);
      assert.ok(String(res.headers['content-type']).includes('javascript'),
        `asset under encoded prefix must serve JS, got ${res.headers['content-type']}`);
    });

    it('字面花括号裸前缀（curl -g / 原样转发形态）→ 200 HTML', async () => {
      const res = await raw(port, PREFIX, { headers: { host: HOST } });
      assert.equal(res.status, 200);
      assert.ok(String(res.headers['content-type']).includes('text/html'));
      assert.ok(res.body.includes(`<base href="${PREFIX}/">`));
    });

    it('编码形式（%7Btoken%7D）同样剥离命中 —— 真实请求经 new URL 后只有编码形态', async () => {
      const res = await raw(port, `${WIRE}/api/cli-mode`, { headers: { host: HOST } });
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type'].includes('application/json'));
    });

    it('带前缀 SSE /events 返回 text/event-stream（前缀下 SSE 不被 SPA 吞掉）', async () => {
      const r = await sseProbe(port, `${WIRE}/events`, { headers: { host: HOST } });
      assert.equal(r.status, 200);
      assert.ok(r.contentType.includes('text/event-stream'),
        `expected SSE stream, got ${r.contentType}`);
    });

    it('带前缀根路径注入字面 <base> + __CCV_BASE_PATH__', async () => {
      const res = await raw(port, `${WIRE}/`, { headers: { host: HOST } });
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type'].includes('text/html'));
      assert.ok(res.body.includes(`<base href="${PREFIX}/">`), 'base href keeps the literal {token} form');
      assert.ok(res.body.includes(`window.__CCV_BASE_PATH__="${PREFIX}/"`));
    });

    it('裸前缀（编码形式、无尾斜杠）→ 200 HTML（不再 404/白屏）', async () => {
      const res = await raw(port, WIRE, { headers: { host: HOST } });
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type'].includes('text/html'));
      assert.ok(res.body.includes(`<base href="${PREFIX}/">`));
    });

    it('/api/local-url 返回公网 URL（显式 https + 前缀 + ccv 自己的 token）', async () => {
      const res = await raw(port, `${WIRE}/api/local-url`, { headers: { host: HOST } });
      assert.equal(res.status, 200);
      const { url } = JSON.parse(res.body);
      assert.ok(url.startsWith(`https://${HOST}${PREFIX}/?token=`),
        `share url must be the public URL, got ${url}`);
    });

    it('未配置的 Host 仍被 403 拒绝（自动加白只针对配置值）', async () => {
      const res = await raw(port, `${WIRE}/api/cli-mode`, { headers: { host: 'evil.example' } });
      assert.equal(res.status, 403);
      assert.match(res.body, /host-not-allowed|Forbidden/i);
    });
  });

  describe('形式1 host+path（无 scheme）', () => {
    before(() => { process.env.CCV_BASE_URL = `${HOST}${PREFIX}`; });
    after(() => { delete process.env.CCV_BASE_URL; });

    it('剥离 + 注入生效', async () => {
      const api = await raw(port, `${WIRE}/api/cli-mode`, { headers: { host: HOST } });
      assert.equal(api.status, 200);
      const root = await raw(port, `${WIRE}/`, { headers: { host: HOST } });
      assert.ok(root.body.includes(`<base href="${PREFIX}/">`));
    });

    it('local-url 无 XFP → 默认 https', async () => {
      const res = await raw(port, `${WIRE}/api/local-url`, { headers: { host: HOST } });
      const { url } = JSON.parse(res.body);
      assert.ok(url.startsWith(`https://${HOST}${PREFIX}/?token=`), `got ${url}`);
    });

    it('local-url 带 X-Forwarded-Proto: http → http（无 Origin 头，避开 same-origin 门）', async () => {
      const res = await raw(port, `${WIRE}/api/local-url`,
        { headers: { host: HOST, 'x-forwarded-proto': 'http' } });
      const { url } = JSON.parse(res.body);
      assert.ok(url.startsWith(`http://${HOST}${PREFIX}/?token=`), `got ${url}`);
    });
  });

  describe('形式2 仅路径（/path）', () => {
    before(() => { process.env.CCV_BASE_URL = PREFIX; });
    after(() => { delete process.env.CCV_BASE_URL; });

    it('剥离 + 注入生效；不加白任何 Host', async () => {
      const api = await raw(port, `${WIRE}/api/cli-mode`);
      assert.equal(api.status, 200);
      const root = await raw(port, `${WIRE}/`);
      assert.ok(root.body.includes(`<base href="${PREFIX}/">`));
      const evil = await raw(port, `${WIRE}/api/cli-mode`, { headers: { host: 'evil.example' } });
      assert.equal(evil.status, 403);
    });

    it('local-url 回退内网 IP 形式（带前缀）', async () => {
      const res = await raw(port, `${WIRE}/api/local-url`);
      const { url } = JSON.parse(res.body);
      assert.match(url, /^http:\/\/[^/]+\/arca\/api\/v1\/session\/\{token\}\/\?token=/, `got ${url}`);
    });
  });

  describe('与 CCV_BASE_PATH 同设：CCV_BASE_URL 优先（legacy 被忽略）', () => {
    before(() => {
      process.env.CCV_BASE_URL = `https://${HOST}/new/base`;
      process.env.CCV_BASE_PATH = '/legacy/';
    });
    after(() => {
      delete process.env.CCV_BASE_URL;
      delete process.env.CCV_BASE_PATH;
    });

    it('新前缀命中、旧前缀落 SPA（证明 legacy 不再参与剥离）', async () => {
      const fresh = await raw(port, '/new/base/api/cli-mode', { headers: { host: HOST } });
      assert.equal(fresh.status, 200);
      assert.ok(fresh.headers['content-type'].includes('application/json'));
      const legacy = await raw(port, '/legacy/api/cli-mode');
      assert.ok(String(legacy.headers['content-type']).includes('text/html'),
        'legacy prefix must fall through to SPA when CCV_BASE_URL wins');
    });
  });

  describe('非法 CCV_BASE_URL：回退 legacy', () => {
    before(() => {
      process.env.CCV_BASE_URL = 'https://bad host/x';
      process.env.CCV_BASE_PATH = '/legacy/';
    });
    after(() => {
      delete process.env.CCV_BASE_URL;
      delete process.env.CCV_BASE_PATH;
    });

    it('legacy 前缀剥离生效、根路径注入 legacy base', async () => {
      const api = await raw(port, '/legacy/api/cli-mode');
      assert.equal(api.status, 200);
      assert.ok(api.headers['content-type'].includes('application/json'));
      const root = await raw(port, '/legacy/');
      assert.ok(root.body.includes('<base href="/legacy/">'));
    });
  });

  describe('显式 CCV_ALLOWED_HOSTS 与 base URL host 合并', () => {
    before(() => {
      process.env.CCV_BASE_URL = `https://${HOST}${PREFIX}`;
      process.env.CCV_ALLOWED_HOSTS = 'allowed.test';
    });
    after(() => {
      delete process.env.CCV_BASE_URL;
      delete process.env.CCV_ALLOWED_HOSTS;
    });

    it('配置域名与用户显式域名都可达（合并而非替换）', async () => {
      const byBase = await raw(port, `${WIRE}/api/cli-mode`, { headers: { host: HOST } });
      assert.equal(byBase.status, 200);
      const byExplicit = await raw(port, '/api/cli-mode', { headers: { host: 'allowed.test' } });
      assert.equal(byExplicit.status, 200);
      const evil = await raw(port, '/api/cli-mode', { headers: { host: 'evil.example' } });
      assert.equal(evil.status, 403);
    });
  });

  describe('带端口的 base URL host：Host 匹配只比 hostname', () => {
    before(() => { process.env.CCV_BASE_URL = `${HOST}:8443${PREFIX}`; });
    after(() => { delete process.env.CCV_BASE_URL; });

    it('Host: host（无端口）可达；local-url 带端口渲染', async () => {
      const api = await raw(port, `${WIRE}/api/cli-mode`, { headers: { host: HOST } });
      assert.equal(api.status, 200);
      const res = await raw(port, `${WIRE}/api/local-url`, { headers: { host: HOST } });
      const { url } = JSON.parse(res.body);
      assert.ok(url.startsWith(`https://${HOST}:8443${PREFIX}/?token=`), `got ${url}`);
    });
  });
});
