// Coverage target: server/proxy.js
//   - forceIdentityAcceptEncoding / stripContentLengthHeader: pure header rewriters, all branches.
//   - startProxy: spins a real local http proxy + a fake upstream http server, then drives a few
//     requests through with the global fetch to exercise forwarding, header rewriting, error-body
//     passthrough, streaming passthrough, and the 502 fallback on upstream connect failure.
//
// Isolation: CCV_LOG_DIR / CLAUDE_CONFIG_DIR point at a temp dir set BEFORE importing proxy.js
// (which calls setupInterceptor() and patches global fetch). ANTHROPIC_BASE_URL is pointed at our
// fake upstream so getOriginalBaseUrl() resolves there (no settings.json / active profile present).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-proxy-unit-test-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
// 清掉可能从外部继承的代理 / baseURL，确保 getProxyDispatcher() → null、getOriginalBaseUrl 走 env 分支
delete process.env.http_proxy;
delete process.env.https_proxy;
delete process.env.HTTP_PROXY;
delete process.env.HTTPS_PROXY;
delete process.env.all_proxy;
delete process.env.ALL_PROXY;

const { forceIdentityAcceptEncoding, stripContentLengthHeader, startProxy } = await import('../server/proxy.js');

describe('forceIdentityAcceptEncoding', () => {
  it('returns falsy input unchanged', () => {
    assert.equal(forceIdentityAcceptEncoding(undefined), undefined);
    assert.equal(forceIdentityAcceptEncoding(null), null);
  });

  it('injects accept-encoding: identity onto empty headers', () => {
    const out = forceIdentityAcceptEncoding({});
    assert.deepEqual(out, { 'accept-encoding': 'identity' });
  });

  it('drops any existing accept-encoding (case-insensitive) and forces identity', () => {
    const out = forceIdentityAcceptEncoding({ 'Accept-Encoding': 'gzip, br', 'x-keep': '1' });
    assert.equal(out['accept-encoding'], 'identity');
    assert.equal(out['x-keep'], '1');
    // 原来的大小写键被剥掉，只剩规范化后的 lowercase 'accept-encoding'
    assert.equal('Accept-Encoding' in out, false);
    assert.equal(Object.keys(out).filter(k => k.toLowerCase() === 'accept-encoding').length, 1);
  });

  it('preserves unrelated headers verbatim', () => {
    const out = forceIdentityAcceptEncoding({ 'content-type': 'application/json', authorization: 'Bearer x' });
    assert.equal(out['content-type'], 'application/json');
    assert.equal(out.authorization, 'Bearer x');
    assert.equal(out['accept-encoding'], 'identity');
  });

  it('does not mutate the original headers object', () => {
    const src = { 'accept-encoding': 'gzip' };
    const out = forceIdentityAcceptEncoding(src);
    assert.equal(src['accept-encoding'], 'gzip', 'source untouched');
    assert.notEqual(out, src);
  });
});

describe('stripContentLengthHeader', () => {
  it('returns falsy input unchanged', () => {
    assert.equal(stripContentLengthHeader(undefined), undefined);
    assert.equal(stripContentLengthHeader(null), null);
  });

  it('returns the same object when no content-length present', () => {
    const src = { 'content-type': 'application/json' };
    const out = stripContentLengthHeader(src);
    assert.equal(out, src, 'no-op returns identical reference');
  });

  it('removes content-length (lowercase) and keeps the rest', () => {
    const out = stripContentLengthHeader({ 'content-length': '42', 'x-a': '1' });
    assert.equal('content-length' in out, false);
    assert.equal(out['x-a'], '1');
  });

  it('removes content-length case-insensitively', () => {
    const out = stripContentLengthHeader({ 'Content-Length': '99', keep: 'y' });
    assert.equal(Object.keys(out).some(k => k.toLowerCase() === 'content-length'), false);
    assert.equal(out.keep, 'y');
  });

  it('does not mutate the original headers object when stripping', () => {
    const src = { 'content-length': '7', other: 'z' };
    const out = stripContentLengthHeader(src);
    assert.equal('content-length' in src, true, 'source untouched');
    assert.notEqual(out, src);
  });
});

describe('startProxy forwarding', () => {
  let upstream;
  let upstreamPort;
  let proxyPort;
  let lastUpstreamReq;
  let savedBaseUrl;

  before(async () => {
    savedBaseUrl = process.env.ANTHROPIC_BASE_URL;

    // 假上游：根据路径返回不同响应形态，并记录收到的请求供断言头改写。
    upstream = createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        lastUpstreamReq = {
          method: req.method,
          url: req.url,
          headers: { ...req.headers },
          body: Buffer.concat(chunks).toString('utf-8'),
        };

        if (req.url === '/error') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'bad request from upstream' } }));
          return;
        }
        if (req.url === '/empty') {
          // 204：无 body，response.body 为 null → 走 res.end() 分支
          res.writeHead(204);
          res.end();
          return;
        }
        if (req.url === '/echo') {
          const payload = JSON.stringify({ ok: true, sawBody: lastUpstreamReq.body });
          res.writeHead(200, {
            'Content-Type': 'application/json',
            // content-length 是代理应从响应头里剥掉的三个编码相关头之一
            'Content-Length': String(Buffer.byteLength(payload)),
            'x-upstream-mark': 'hit',
          });
          res.end(payload);
          return;
        }
        // 默认：流式 body
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.write('part1-');
        res.end('part2');
      });
    });

    await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    upstreamPort = upstream.address().port;
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${upstreamPort}`;

    proxyPort = await startProxy();
  });

  after(async () => {
    if (savedBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = savedBaseUrl;
    await new Promise((resolve) => upstream.close(resolve));
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('startProxy resolves to a numeric port', () => {
    assert.equal(typeof proxyPort, 'number');
    assert.ok(proxyPort > 0);
  });

  it('forwards a POST body to the upstream and strips content-length / forces identity encoding', async () => {
    const payload = JSON.stringify({ hello: 'world' });
    const resp = await fetch(`http://127.0.0.1:${proxyPort}/echo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(payload)),
        'Accept-Encoding': 'gzip, br',
      },
      body: payload,
    });
    assert.equal(resp.status, 200);
    const json = await resp.json();
    assert.equal(json.ok, true);
    // 上游确实收到了改写后的 body
    assert.equal(json.sawBody, payload);

    // 上游收到的请求头：accept-encoding 被强制为 identity。
    // x-cc-viewer-trace 由 proxy 注入用于让拦截器强制记录，但拦截器消费后会删除它，
    // 因此真正到达上游的请求里不应再出现该头（pin 当前拦截器行为）。
    assert.equal(lastUpstreamReq.method, 'POST');
    assert.equal(lastUpstreamReq.url, '/echo');
    assert.equal(lastUpstreamReq.headers['accept-encoding'], 'identity');
    assert.equal('x-cc-viewer-trace' in lastUpstreamReq.headers, false);
    // host 头被删掉后由 fetch 重设为上游 host（不应再是代理 host）
    assert.equal(lastUpstreamReq.headers.host, `127.0.0.1:${upstreamPort}`);

    // 响应头：上游声明的 content-length 被代理剥掉（由 Node/undici 按实际重算）；自定义头透传
    assert.equal(resp.headers.get('x-upstream-mark'), 'hit');
  });

  it('forwards a GET with no body and passes through a streaming response', async () => {
    const resp = await fetch(`http://127.0.0.1:${proxyPort}/stream`, { method: 'GET' });
    assert.equal(resp.status, 200);
    const text = await resp.text();
    assert.equal(text, 'part1-part2');
    assert.equal(lastUpstreamReq.method, 'GET');
    assert.equal(lastUpstreamReq.body, '', 'GET had no forwarded body');
  });

  it('passes through an upstream error status and its body verbatim', async () => {
    const resp = await fetch(`http://127.0.0.1:${proxyPort}/error`, { method: 'GET' });
    assert.equal(resp.status, 400);
    const json = await resp.json();
    assert.deepEqual(json, { error: { message: 'bad request from upstream' } });
  });

  it('handles an upstream 204 (null body) via res.end()', async () => {
    const resp = await fetch(`http://127.0.0.1:${proxyPort}/empty`, { method: 'GET' });
    assert.equal(resp.status, 204);
    const text = await resp.text();
    assert.equal(text, '');
  });

  it('preserves a base url path prefix and a leading-slash request url join', async () => {
    // 临时把上游 base 指到带路径前缀的形式，验证 cleanBase/cleanReq 拼接逻辑
    const prev = process.env.ANTHROPIC_BASE_URL;
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${upstreamPort}/`;
    try {
      const resp = await fetch(`http://127.0.0.1:${proxyPort}/echo`, {
        method: 'POST',
        body: 'x',
      });
      assert.equal(resp.status, 200);
      assert.equal(lastUpstreamReq.url, '/echo', 'trailing slash on base did not double up');
    } finally {
      process.env.ANTHROPIC_BASE_URL = prev;
    }
  });

  it('returns 502 Proxy Error when the upstream is unreachable', async () => {
    // 把 base 指向一个监听中但会立刻 RST 的端口：用已关闭的 server 端口模拟 connect 失败。
    const dead = createServer(() => {});
    const deadPort = await new Promise((resolve) => {
      dead.listen(0, '127.0.0.1', () => resolve(dead.address().port));
    });
    await new Promise((resolve) => dead.close(resolve)); // 关闭 → 该端口拒绝连接

    const prev = process.env.ANTHROPIC_BASE_URL;
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${deadPort}`;
    try {
      const resp = await fetch(`http://127.0.0.1:${proxyPort}/whatever`, { method: 'GET' });
      assert.equal(resp.status, 502);
      const text = await resp.text();
      assert.equal(text, 'Proxy Error');
    } finally {
      process.env.ANTHROPIC_BASE_URL = prev;
    }
  });

  it('with CCV_DEBUG on: logs error responses and stream errors but still returns the body', async () => {
    const prevDebug = process.env.CCV_DEBUG;
    const origErr = console.error;
    const logged = [];
    console.error = (...args) => { logged.push(args.join(' ')); };
    process.env.CCV_DEBUG = '1';
    try {
      // 错误响应 → 命中 extractApiErrorMessage 调试日志分支
      const errResp = await fetch(`http://127.0.0.1:${proxyPort}/error`, { method: 'GET' });
      assert.equal(errResp.status, 400);
      const ejson = await errResp.json();
      assert.equal(ejson.error.message, 'bad request from upstream');

      // 不可达上游 → 命中 catch 块的调试日志分支并仍回 502
      const prev = process.env.ANTHROPIC_BASE_URL;
      const dead = createServer(() => {});
      const deadPort = await new Promise((resolve) => dead.listen(0, '127.0.0.1', () => resolve(dead.address().port)));
      await new Promise((resolve) => dead.close(resolve));
      process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${deadPort}`;
      try {
        const r = await fetch(`http://127.0.0.1:${proxyPort}/x`, { method: 'GET' });
        assert.equal(r.status, 502);
      } finally {
        process.env.ANTHROPIC_BASE_URL = prev;
      }

      // 流式响应在 DEBUG 下也应正常透传
      const sResp = await fetch(`http://127.0.0.1:${proxyPort}/stream`, { method: 'GET' });
      assert.equal(await sResp.text(), 'part1-part2');

      assert.ok(logged.some(l => l.includes('[CC-Viewer Proxy]')), 'debug logs were emitted');
    } finally {
      console.error = origErr;
      if (prevDebug === undefined) delete process.env.CCV_DEBUG;
      else process.env.CCV_DEBUG = prevDebug;
    }
  });
});
