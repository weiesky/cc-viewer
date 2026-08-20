// 覆盖目标：server/server.js 的 HTTP 请求前置层与静态资源/SPA 分支 + 直出 export。
// 既有 test/server.test.js 已覆盖 /api/* 路由的 happy/error path 与 CORS/SSE/stream-chunk，
// 本文件专攻 server.test.js 未触达的 server.js 内联分支：
//   - handleRequest 前置：CCV_BASE_PATH 前缀剥离、/ws/* 早返回、Host allowlist 403
//   - 静态文件服务：index.html 主题/base 注入、/assets 长缓存、stale chunk 404、SPA fallback
//   - 顶层 export：getPort/getProtocol/getAccessToken/getInternalToken/getAuthConfig/getAllLocalIps
//   - SDK export：pushSdkEntry / setSdkStreamingState / broadcastWsMessage / setSdk* 注入器
//   - broadcastTurnEnd 入队语义
//
// 隔离手法（参照 test/server.test.js + test/api-auth.test.js）：在 import server.js 之前
// 把 CCV_LOG_DIR / CLAUDE_CONFIG_DIR 指向临时目录，CCV_WORKSPACE_MODE=1 阻止自动启动，
// NODE_ENV=test 激活 __testing namespace。node:test 默认按文件进程隔离，本文件独占一个
// server.js 单例，不与其它 test 文件互相污染。

import { describe, it, before, after } from 'node:test';
import { describeCli } from './_helpers/cli-tier.mjs';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── 必须在任何会拉起 findcc.js 的 import 之前设置 ──
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-http-extra-'));
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
// 私有高位端口窗,避免与用户真实 ccv 服务(7008-7099)抢端口(2026-06-06 审计 port-clash)。
// server.js 顶层把 CCV_START_PORT/MAX_PORT 冻结为 const,故必须在 import server.js 之前设好(本文件 before() 内动态 import,此处即生效)。
process.env.CCV_START_PORT = '19720';
process.env.CCV_MAX_PORT = '19729';

/** 低层 http 请求：可自定义 headers（含 Host）。返回 {status, headers, body}。 */
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

describeCli('server.js HTTP prelude + static serving + exports', { concurrency: false }, () => {
  let mod, port;

  before(async () => {
    mod = await import('../server/server.js');
    const srv = await mod.startViewer();
    assert.ok(srv, 'server should start');
    port = mod.getPort();
    assert.ok(port > 0, 'port assigned');
  });

  after(async () => {
    await new Promise((resolve) => {
      mod.stopViewer();
      setTimeout(() => { rmSync(tmpDir, { recursive: true, force: true }); resolve(); }, 200);
    });
  });

  // ─────────── 顶层同步 export ───────────
  describe('getter exports', () => {
    it('getProtocol() returns http (no HTTPS plugin in test)', () => {
      assert.equal(mod.getProtocol(), 'http');
    });

    it('getPort() matches the listening port', () => {
      assert.equal(mod.getPort(), port);
    });

    it('getAccessToken() is a 32-hex token', () => {
      const tok = mod.getAccessToken();
      assert.match(tok, /^[0-9a-f]{32}$/);
    });

    it('getInternalToken() is a 32-hex token distinct from access token', () => {
      const it_ = mod.getInternalToken();
      assert.match(it_, /^[0-9a-f]{32}$/);
      assert.notEqual(it_, mod.getAccessToken());
    });

    it('getAuthConfig() exposes enabled=false by default with password field', () => {
      const cfg = mod.getAuthConfig();
      assert.equal(typeof cfg, 'object');
      assert.equal(cfg.enabled, false);
      assert.ok('password' in cfg, 'authConfig has password key');
    });

    it('getAllLocalIps() returns an array of IPv4 strings (no internal/loopback)', () => {
      const ips = mod.getAllLocalIps();
      assert.ok(Array.isArray(ips));
      for (const ip of ips) {
        assert.match(ip, /^\d{1,3}(\.\d{1,3}){3}$/);
        assert.notEqual(ip, '127.0.0.1', 'loopback must be filtered out');
      }
    });
  });

  // ─────────── handleRequest 前置层 ───────────
  describe('request prelude', () => {
    it('OPTIONS preflight short-circuits with 200 + CORS', async () => {
      const res = await raw(port, '/api/preferences', { method: 'OPTIONS' });
      assert.equal(res.status, 200);
      assert.equal(res.headers['access-control-allow-origin'], '*');
      assert.ok(res.headers['access-control-allow-methods'].includes('POST'));
    });

    it('GET /ws/terminal is left to upgrade handler → no HTTP response (hangs then resets, never a 2xx body)', async () => {
      // handleRequest 对 /ws/* 直接 return（不 writeHead）。普通 GET 无 Upgrade 头时
      // 服务端既不应答也不升级 → 客户端读到 socket 关闭/重置，而不是一个 200/404 body。
      // 真正校验"无 HTTP 应答"：只允许 socket 重置(error)/超时两条退出路径；万一服务端竟回了
      // HTTP 响应，断言它绝不是 2xx（早返回回归会让 /ws/* 错误地落到静态/SPA 200 → 本断言捕获）。
      const outcome = await new Promise((resolve, reject) => {
        let settled = false;
        const settle = (v) => { if (!settled) { settled = true; resolve(v); } };
        const req = request({ hostname: '127.0.0.1', port, path: '/ws/terminal', method: 'GET' }, (res) => {
          // 不期望进入响应回调；若进入，捕获状态码后断言它不是 2xx。
          const status = res.statusCode;
          res.destroy();
          settle({ kind: 'response', status });
        });
        req.on('error', () => settle({ kind: 'reset' }));
        req.end();
        // 服务端无响应：给 600ms 后主动收尾——超时即"无应答"，是预期路径。
        setTimeout(() => { try { req.destroy(); } catch {} settle({ kind: 'timeout' }); }, 600);
      });
      // 正常行为：reset 或 timeout（无 HTTP 应答）。绝不能是一个 HTTP 响应（更不能是 2xx）。
      assert.ok(['reset', 'timeout'].includes(outcome.kind),
        `/ws/* GET must not get an HTTP response; got ${JSON.stringify(outcome)}`);
      if (outcome.kind === 'response') {
        assert.ok(outcome.status < 200 || outcome.status >= 300,
          `/ws/* GET must never answer 2xx; got status ${outcome.status}`);
      }
    });

    it('Host header outside allowlist returns 403 host-not-allowed', async () => {
      const res = await raw(port, '/api/cli-mode', { headers: { Host: 'evil.example.com' } });
      assert.equal(res.status, 403);
      const j = JSON.parse(res.body);
      assert.equal(j.ok, false);
      assert.equal(j.error, 'host-not-allowed');
      assert.equal(j.host, 'evil.example.com');
    });

    it('Host 127.0.0.1:<port> is allowed (loopback in allowlist)', async () => {
      const res = await raw(port, '/api/cli-mode', { headers: { Host: `127.0.0.1:${port}` } });
      assert.equal(res.status, 200);
      assert.equal(JSON.parse(res.body).cliMode, false);
    });

    it('bracketed IPv6 [::1] Host is allowed (bracket stripping → matches ::1 in allowlist)', async () => {
      // Host allowlist 把 [::1] 去括号后比对 ::1，命中 allowlist。
      // 注意：bare `::1`（无括号）会让 server.js 顶部 `new URL(req.url, 'http://::1')`
      // 抛 Invalid URL（handleRequest 无 try/catch）→ 请求悬挂。属现状边界 bug，见 notes，
      // 此处只测合法的 bracketed 形式。
      const res = await raw(port, '/api/cli-mode', { headers: { Host: '[::1]' } });
      assert.equal(res.status, 200);
    });

    it('localhost Host is allowed', async () => {
      const res = await raw(port, '/api/cli-mode', { headers: { Host: 'localhost' } });
      assert.equal(res.status, 200);
    });
  });

  // ─────────── 静态文件 / SPA fallback ───────────
  describe('static file serving (real dist/)', () => {
    it('GET / serves index.html with SSR data-theme injected', async () => {
      const res = await raw(port, '/');
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type'].includes('text/html'));
      assert.equal(res.headers['cache-control'], 'no-cache');
      // 默认无 prefs.themeColor → mac/linux 注入 light，win 注入 dark；二者其一即可
      assert.match(res.body, /<html[^>]*data-theme="(light|dark)"/);
    });

    it('GET /index.html serves the SSR-injected document too', async () => {
      const res = await raw(port, '/index.html');
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type'].includes('text/html'));
    });

    it('GET /favicon.ico is served as a static asset (not SPA fallback)', async () => {
      const res = await raw(port, '/favicon.ico');
      assert.equal(res.status, 200);
      assert.ok(!res.headers['content-type'].includes('text/html'),
        'favicon must be a binary asset, not index.html');
    });

    it('GET /assets/<missing> returns 404 stale-chunk message (not SPA fallback)', async () => {
      const res = await raw(port, '/assets/definitely-missing-hash-xyz.js');
      assert.equal(res.status, 404);
      assert.ok(res.headers['content-type'].includes('text/plain'));
      assert.ok(/stale chunk|refresh/i.test(res.body), `unexpected body: ${res.body}`);
    });

    it('GET unknown non-API path falls through to SPA index.html', async () => {
      const res = await raw(port, '/some/client/route');
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type'].includes('text/html'));
    });

    it('GET / 始终注入 <base href="/">（根部署稳健：配合相对路径产物）', async () => {
      const res = await raw(port, '/');
      assert.equal(res.status, 200);
      assert.ok(res.body.includes('<base href="/">'),
        '根部署也必须注入 <base href="/">，否则深链直访下相对 ./assets 解析错位 → 白屏');
      // 根部署不注入运行时全局：API/WS 的 base 语义保持"无前缀"不变
      assert.ok(!res.body.includes('window.__CCV_BASE_PATH__'),
        '根部署不应注入 window.__CCV_BASE_PATH__');
    });

    it('GET 深链 SPA fallback 文档同样含 <base href="/">（Risk A 修复）', async () => {
      const res = await raw(port, '/deep/nested/route');
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type'].includes('text/html'));
      assert.ok(res.body.includes('<base href="/">'),
        '深链 SPA fallback 必须含 <base href="/">，使 ./assets 解析到根而非 /deep/nested/assets');
    });

    it('GET /api/<unknown> falls through to SPA fallback (dist present → 200 html)', async () => {
      // /api/ GET 未命中路由时不会走“非GET API 404”，而是落到静态/SPA：dist 存在 → index.html。
      const res = await raw(port, '/api/this-route-does-not-exist');
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type'].includes('text/html'));
    });

    it('POST /api/<unknown> returns JSON 404 (non-GET API branch)', async () => {
      const res = await raw(port, '/api/this-route-does-not-exist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: {},
      });
      assert.equal(res.status, 404);
      assert.ok(res.headers['content-type'].includes('application/json'));
      assert.equal(JSON.parse(res.body).error, 'Not Found');
    });

    it('POST non-API unknown path returns plain 404', async () => {
      const res = await raw(port, '/not-an-api', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: {},
      });
      assert.equal(res.status, 404);
    });
  });

  // ─────────── CCV_BASE_PATH 反代前缀（剥离 + base 注入）───────────
  describe('CCV_BASE_PATH reverse-proxy prefix', () => {
    const PREFIX = '/proxy/cc';
    before(() => { process.env.CCV_BASE_PATH = PREFIX; });
    after(() => { delete process.env.CCV_BASE_PATH; });

    it('prefixed API path IS routed to the API (handleRequest 剥前缀后写回 parsedUrl.pathname)', async () => {
      // 原 PIN 的 bug 已修（base-path 收口）：handleRequest 剥前缀后写回 parsedUrl.pathname，
      // dispatch() 与各 handler 拿到的都是无前缀路径 → 前缀 API 正常命中路由返回 JSON。
      // 完整前缀路由矩阵见 test/api-base-path.test.js。
      const res = await raw(port, `${PREFIX}/api/cli-mode`);
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type'].includes('application/json'),
        'prefixed API must return JSON after base-path fix');
      assert.equal(JSON.parse(res.body).cliMode, false);
      // 未加前缀的同一路由同样正常（向后兼容对照组）
      const res2 = await raw(port, '/api/cli-mode');
      assert.ok(res2.headers['content-type'].includes('application/json'));
      assert.equal(JSON.parse(res2.body).cliMode, false);
    });

    it('prefixed root serves index.html with injected <base href> + window.__CCV_BASE_PATH__', async () => {
      const res = await raw(port, `${PREFIX}/`);
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type'].includes('text/html'));
      assert.ok(res.body.includes('<base href="/proxy/cc/">'),
        'must inject normalized <base href> with trailing slash');
      assert.ok(res.body.includes('window.__CCV_BASE_PATH__="/proxy/cc/"'),
        'must inject runtime base path global');
    });

    it('prefixed unknown client route falls through to SPA index.html', async () => {
      const res = await raw(port, `${PREFIX}/dashboard`);
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type'].includes('text/html'));
    });
  });

  // ─────────── SDK / WS broadcast exports（无客户端时的安全 no-op 行为）───────────
  describe('SDK export helpers (no connected clients)', () => {
    it('pushSdkEntry() is a no-op safe call when no SSE clients are connected', () => {
      assert.doesNotThrow(() => mod.pushSdkEntry({ type: 'assistant', message: { content: [] } }));
    });

    it('setSdkStreamingState() handles active=true then inactive without throwing', () => {
      assert.doesNotThrow(() => mod.setSdkStreamingState({ active: true, startTime: Date.now() }));
      assert.doesNotThrow(() => mod.setSdkStreamingState({ active: false }));
      // undefined / null / {} 均当作 inactive
      assert.doesNotThrow(() => mod.setSdkStreamingState(undefined));
      assert.doesNotThrow(() => mod.setSdkStreamingState(null));
      assert.doesNotThrow(() => mod.setSdkStreamingState({}));
    });

    it('broadcastWsMessage() with no terminalWss does not throw; ask-* type triggers parent notify path', () => {
      // workspace 模式未起 WS（terminalWss 为 null）→ 仅走 _notifyParentPending 分支。
      assert.doesNotThrow(() => mod.broadcastWsMessage({ type: 'sdk-ask-pending', id: 'x1' }));
      assert.doesNotThrow(() => mod.broadcastWsMessage({ type: 'ask-hook-resolved', id: 'x2' }));
      // 非 ask 类型 / 字符串 / 无 type：不进 parent-notify 分支，仍不抛
      assert.doesNotThrow(() => mod.broadcastWsMessage({ type: 'data', data: 'noop' }));
      assert.doesNotThrow(() => mod.broadcastWsMessage('a raw string'));
      assert.doesNotThrow(() => mod.broadcastWsMessage(null));
    });

    it('setSdkResolveApproval/Cancel/SendUserMessage/InterruptTurn store the injected fns (smoke)', () => {
      // 这些 setter 只是把引用存进模块级变量；调用不应抛。
      const fn = () => {};
      assert.doesNotThrow(() => mod.setSdkResolveApproval(fn));
      assert.doesNotThrow(() => mod.setSdkCancelApproval(fn));
      assert.doesNotThrow(() => mod.setSdkSendUserMessage(fn));
      assert.doesNotThrow(() => mod.setSdkInterruptTurn(fn));
      // 还原为 null，避免污染同进程后续用例
      mod.setSdkResolveApproval(null);
      mod.setSdkCancelApproval(null);
      mod.setSdkSendUserMessage(null);
      mod.setSdkInterruptTurn(null);
    });
  });

  // ─────────── workspace 配置 setter exports ───────────
  describe('workspace setter exports', () => {
    it('setWorkspaceClaudeArgs / setWorkspaceClaudePath store args & path (smoke)', () => {
      assert.doesNotThrow(() => mod.setWorkspaceClaudeArgs(['--foo', '--bar']));
      assert.doesNotThrow(() => mod.setWorkspaceClaudePath('/usr/local/bin/claude', true));
      // 还原默认，避免影响后续 launch 行为
      mod.setWorkspaceClaudeArgs([]);
      mod.setWorkspaceClaudePath(null, false);
    });

    it('setLaunchCallback stores a callback (smoke)', () => {
      const cb = () => {};
      assert.doesNotThrow(() => mod.setLaunchCallback(cb));
      mod.setLaunchCallback(null);
    });

    it('setWorkspaceLaunched(true) flips /api/cli-mode workspaceMode to false', async () => {
      // workspaceMode = isWorkspaceMode && !_workspaceLaunched。
      // 启动后默认 _workspaceLaunched=false → workspaceMode=true；置 true 后应翻成 false。
      const before = JSON.parse((await raw(port, '/api/cli-mode')).body);
      assert.equal(before.workspaceMode, true);
      mod.setWorkspaceLaunched(true);
      try {
        const after = JSON.parse((await raw(port, '/api/cli-mode')).body);
        assert.equal(after.workspaceMode, false, 'launched workspace must report workspaceMode=false');
      } finally {
        mod.setWorkspaceLaunched(false); // 还原
      }
    });
  });

  // ─────────── broadcastTurnEnd 入队（debounce 行为细节由 turn-end-debounce.test.js 覆盖）───────────
  describe('broadcastTurnEnd scheduling', () => {
    it('broadcastTurnEnd(sessionId) enqueues a pending timer keyed by sessionId', () => {
      mod.__testing.reset();
      mod.broadcastTurnEnd('sess-http-extra', Date.now());
      assert.deepEqual(mod.__testing.getPendingKeys(), ['sess-http-extra']);
      mod.__testing.reset();
      assert.deepEqual(mod.__testing.getPendingKeys(), []);
    });

    it('broadcastTurnEnd() with no sessionId falls into the null bucket', () => {
      mod.__testing.reset();
      mod.broadcastTurnEnd();
      assert.deepEqual(mod.__testing.getPendingKeys(), [null]);
      mod.__testing.reset();
    });
  });

  // ─────────── stopViewer 幂等 ───────────
  describe('stopViewer idempotency', () => {
    it('calling stopViewer() twice returns the same in-flight promise', () => {
      const p1 = mod.stopViewer();
      const p2 = mod.stopViewer();
      assert.strictEqual(p1, p2, 'second stopViewer() must reuse the in-flight stop promise');
      // 重新启动留给 after()? 不——after 再调一次 stopViewer 是幂等 no-op（已 resolved）。
    });
  });
});
