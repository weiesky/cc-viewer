import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// auth 配置现存于 LOG_DIR/preferences.json 的 `auth` 键。把 LOG_DIR(CCV_LOG_DIR)隔离到
// 临时目录,避免污染真实偏好文件。必须在 *任何* 会拉起 findcc.js 的 import 之前设置——
// findcc.js 顶层 `export let LOG_DIR = resolveLogDir()` 在 import 时一次性求值并冻结。
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-auth-api-test-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';
// 确保 CLI 密码钩子不介入(默认 disabled 起步)
delete process.env.CCV_USE_PASSWORD;
delete process.env.CCV_PASSWORD;
// 私有高位端口窗,避免与用户真实 ccv 服务(7008-7099)抢端口(2026-06-06 审计 port-clash)。
// server.js 顶层把 CCV_START_PORT/MAX_PORT 冻结为 const,故必须在 import server.js 之前设好(本文件 before() 内动态 import,此处即生效)。
process.env.CCV_START_PORT = '19710';
process.env.CCV_MAX_PORT = '19719';

// 动态 import(必须在上面设好 CCV_LOG_DIR 之后):静态 import 会被 ESM 提升到 env 设置之前,
// 让 routes/auth.js → lib/auth.js → findcc.js 把 LOG_DIR 冻结到真实路径,从而把测试 auth
// 写进用户真实的 preferences.json。用于下方 direct-handler 测试。
const { authRoutes: authRoutesCache } = await import('../server/routes/auth.js');

/** 用 node:http 发请求(loopback → 服务端视为 admin/isLocal) */
function httpRequest(port, path, { method = 'GET', body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data,
          json() { return JSON.parse(data); },
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

describe('password auth API (loopback=admin)', { concurrency: false }, () => {
  let stopViewer, getPort;
  let port;

  before(async () => {
    const mod = await import('../server/server.js');
    stopViewer = mod.stopViewer;
    getPort = mod.getPort;
    const srv = await mod.startViewer();
    assert.ok(srv, 'server should start');
    port = getPort();
    assert.ok(port > 0, 'port should be assigned');
  });

  after(async () => {
    await new Promise((resolve) => {
      stopViewer();
      setTimeout(() => {
        rmSync(tmpDir, { recursive: true, force: true });
        resolve();
      }, 200);
    });
  });

  // --- state: default disabled, admin sees password field ---
  it('GET /api/auth/state defaults to disabled and isAdmin (loopback)', async () => {
    const res = await httpRequest(port, '/api/auth/state');
    assert.equal(res.status, 200);
    const data = res.json();
    assert.equal(data.enabled, false);
    assert.equal(data.isAdmin, true);
    // admin 能看到密码字段(默认空串)
    assert.equal(data.password, '');
    // 非 CLI 模式(测试 harness)：无项目作用域 → scope=global、无覆盖、projectDir=null、带 global 字段
    assert.equal(data.scope, 'global');
    assert.equal(data.hasProjectOverride, false);
    assert.equal(data.projectDir, null);
    assert.ok(data.global && typeof data.global === 'object');
  });

  // --- enabling auto-generates a password ---
  it('POST /api/auth/config {enabled:true} auto-generates a 6-char password', async () => {
    const res = await httpRequest(port, '/api/auth/config', { method: 'POST', body: { enabled: true } });
    assert.equal(res.status, 200);
    const data = res.json();
    assert.equal(data.enabled, true);
    assert.equal(data.isAdmin, true);
    assert.equal(typeof data.password, 'string');
    assert.equal(data.password.length, 6);
    assert.match(data.password, /^[A-Z0-9]{6}$/);
  });

  // --- changing the password ---
  it('POST /api/auth/config {password} updates the password', async () => {
    const res = await httpRequest(port, '/api/auth/config', { method: 'POST', body: { password: 'SECRET99' } });
    assert.equal(res.status, 200);
    assert.equal(res.json().password, 'SECRET99');
    // state 应反映新密码
    const state = await httpRequest(port, '/api/auth/state');
    assert.equal(state.json().password, 'SECRET99');
  });

  // --- preferences.json must not leak the auth password (it shares the file) ---
  it('GET /api/preferences strips the auth key (no password leak)', async () => {
    const res = await httpRequest(port, '/api/preferences');
    assert.equal(res.status, 200);
    assert.equal('auth' in res.json(), false, 'auth key must be stripped from preferences');
    assert.ok(!res.body.includes('SECRET99'), 'password must never appear in preferences response');
  });

  // --- preferences POST must not be an admin-only bypass for auth changes ---
  it('POST /api/preferences cannot modify auth (ignores incoming.auth)', async () => {
    const res = await httpRequest(port, '/api/preferences', {
      method: 'POST',
      body: { auth: { enabled: false, password: 'hacked' }, themeColor: 'light' },
    });
    assert.equal(res.status, 200);
    // auth must be unchanged: still enabled with the real password
    const state = (await httpRequest(port, '/api/auth/state')).json();
    assert.equal(state.enabled, true);
    assert.equal(state.password, 'SECRET99');
  });

  // --- per-project overrides (authByProject) must not leak via GET nor be injectable via POST ---
  it('never leaks or accepts authByProject via /api/preferences', async () => {
    const pf = join(tmpDir, 'preferences.json');
    // (1) seed a real project override directly into the file the server reads
    const seeded = JSON.parse(readFileSync(pf, 'utf-8'));
    seeded.authByProject = { '/seeded': { enabled: true, password: Buffer.from('SEEDPW', 'utf-8').toString('base64') } };
    writeFileSync(pf, JSON.stringify(seeded));
    // GET must strip it (no project password, even base64, in the response)
    const get = await httpRequest(port, '/api/preferences');
    assert.equal('authByProject' in get.json(), false, 'GET must strip authByProject');
    assert.ok(!get.body.includes('SEEDPW') && !get.body.includes('U0VFRFBX'), 'no project password in GET');
    // (2) POST attempting to inject a cross-project override must be ignored + not echoed
    const post = await httpRequest(port, '/api/preferences', {
      method: 'POST',
      body: { authByProject: { '/evil': { enabled: true, password: 'HAX' } }, themeColor: 'light' },
    });
    assert.equal('authByProject' in post.json(), false, 'POST response must not echo authByProject');
    assert.ok(!post.body.includes('HAX'));
    const after = JSON.parse(readFileSync(pf, 'utf-8'));
    assert.equal(after.authByProject['/evil'], undefined, 'POST must not inject a cross-project override');
    assert.ok(after.authByProject['/seeded'], 'existing override preserved (read-merge-write)');
  });

  // --- login: correct password mints a SameSite=Strict cookie ---
  it('POST /api/auth/login with correct password sets ccv_auth cookie (SameSite=Strict)', async () => {
    const res = await httpRequest(port, '/api/auth/login', { method: 'POST', body: { password: 'SECRET99' } });
    assert.equal(res.status, 200);
    assert.equal(res.json().ok, true);
    const setCookie = res.headers['set-cookie'];
    assert.ok(Array.isArray(setCookie) && setCookie.length === 1, 'should send one Set-Cookie');
    const cookie = setCookie[0];
    assert.match(cookie, /^ccv_auth=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Path=\//);
    assert.ok(!/Secure/.test(cookie), 'must NOT set Secure (LAN plain HTTP)');
  });

  // --- login is case-insensitive (password 'SECRET99' typed lowercase still works) ---
  it('POST /api/auth/login matches the password case-insensitively', async () => {
    const res = await httpRequest(port, '/api/auth/login', { method: 'POST', body: { password: 'secret99' } });
    assert.equal(res.status, 200);
    assert.equal(res.json().ok, true);
    assert.ok(res.headers['set-cookie'], 'lowercase input should still authenticate');
  });

  // --- login: wrong password → 401, no cookie ---
  it('POST /api/auth/login with wrong password returns 401 and no cookie', async () => {
    const res = await httpRequest(port, '/api/auth/login', { method: 'POST', body: { password: 'WRONG123' } });
    assert.equal(res.status, 401);
    assert.equal(res.json().ok, false);
    assert.ok(!res.headers['set-cookie'], 'no cookie on failure');
  });

  // --- empty password = no protection: login refuses to mint a cookie ---
  it('empty password disables login cookie minting', async () => {
    const cfg = await httpRequest(port, '/api/auth/config', { method: 'POST', body: { password: '' } });
    assert.equal(cfg.json().password, '');
    // 即便仍 enabled,空密码模式下 login 不应签发 cookie(空密码=无防护,无需登录)
    const res = await httpRequest(port, '/api/auth/login', { method: 'POST', body: { password: '' } });
    assert.equal(res.status, 401);
    assert.ok(!res.headers['set-cookie']);
  });

  // --- rate limiting (must run LAST: trips the per-IP counter) ---
  it('POST /api/auth/login is rate-limited per IP (429 after burst)', async () => {
    // 先恢复一个非空密码,确保 429 来自限流而非空密码短路
    await httpRequest(port, '/api/auth/config', { method: 'POST', body: { password: 'BURST999' } });
    let saw429 = false;
    for (let i = 0; i < 30; i++) {
      const res = await httpRequest(port, '/api/auth/login', { method: 'POST', body: { password: 'nope' } });
      if (res.status === 429) { saw429 = true; break; }
    }
    assert.ok(saw429, 'should hit 429 within a 30-request burst');
  });

  it('disabling protection clears enabled flag', async () => {
    const res = await httpRequest(port, '/api/auth/config', { method: 'POST', body: { enabled: false } });
    assert.equal(res.status, 200);
    assert.equal(res.json().enabled, false);
  });
});

// The admin-only (403 for non-local) guard lives in the authConfigPost handler, NOT in
// decideAuth — and loopback HTTP tests are always isLocal:true, so the API path above can't
// exercise it. Call the handler directly with isLocal=false to cover the reject branch.
describe('POST /api/auth/config admin-only guard', () => {
  it('rejects a non-local (remote) caller with 403 before reading the body', async () => {
    const { authRoutes } = await import('../server/routes/auth.js');
    const route = authRoutes.find(r => r.path === '/api/auth/config' && r.method === 'POST');
    assert.ok(route, 'config POST route must be registered');

    let status = 0;
    let payload = '';
    const res = {
      writeHead(s) { status = s; },
      end(body) { payload = body || ''; },
    };
    // A real config change would mutate state; assert it is NOT called on the reject path.
    let setCalled = false;
    const deps = { MAX_POST_BODY: 1e6, authConfig: { enabled: false, password: '' }, setAuthConfig() { setCalled = true; } };
    const req = { on() {} }; // body never read on the 403 path

    route.handler(req, res, { pathname: '/api/auth/config' }, /* isLocal */ false, deps);

    assert.equal(status, 403);
    assert.match(payload, /admin-only/);
    assert.equal(setCalled, false, 'must not mutate auth config for a remote caller');
  });
});

// buildState masks passwords for non-local callers (password: isLocal ? ... : null). The
// loopback API harness is always isLocal:true, so this leak-prevention branch is never hit
// there — exercise it directly. This is the one branch whose failure leaks the plaintext
// password to an authenticated REMOTE user.
describe('GET /api/auth/state password masking', () => {
  function callState(isLocal) {
    const route = authRoutesCache.find(r => r.path === '/api/auth/state' && r.method === 'GET');
    let payload = '';
    const res = { writeHead() {}, end(b) { payload = b || ''; } };
    const deps = {
      getAuthState() {
        return {
          effective: { enabled: true, password: 'SECRETPW' },
          global: { enabled: true, password: 'GLOBALPW' },
          scope: 'global', hasProjectOverride: false, projectDir: null,
        };
      },
    };
    route.handler({ on() {} }, res, { pathname: '/api/auth/state' }, isLocal, deps);
    return JSON.parse(payload);
  }

  it('masks effective + global passwords to null for a remote (non-admin) caller', () => {
    const j = callState(/* isLocal */ false);
    assert.equal(j.isAdmin, false);
    assert.equal(j.password, null, 'effective password must be masked for remote');
    assert.equal(j.global.password, null, 'global password must be masked for remote');
    assert.equal(j.enabled, true, 'non-secret fields still present');
  });

  it('reveals passwords to the local admin', () => {
    const j = callState(/* isLocal */ true);
    assert.equal(j.isAdmin, true);
    assert.equal(j.password, 'SECRETPW');
    assert.equal(j.global.password, 'GLOBALPW');
  });
});

// The clearOverride branch of authConfigPost drops a project override (→ inherit global).
// It can't be reached via the loopback API (harness runs non-CLI → projectDir:null → the
// route coerces project→global), so cover it with a direct handler call.
describe('POST /api/auth/config clearOverride branch', () => {
  it('calls clearAuthOverride and never setAuthConfig', () => {
    const route = authRoutesCache.find(r => r.path === '/api/auth/config' && r.method === 'POST');
    let cleared = false, setCalled = false;
    const state = { effective: { enabled: false, password: '' }, global: { enabled: true, password: 'G' }, scope: 'global', hasProjectOverride: false, projectDir: '/tmp/projX' };
    const deps = {
      MAX_POST_BODY: 1e6,
      getAuthState() { return state; },
      clearAuthOverride() { cleared = true; },
      setAuthConfig() { setCalled = true; },
    };
    const handlers = {};
    const req = { on(ev, cb) { handlers[ev] = cb; } };
    let status = 0, payload = '';
    const res = { writeHead(s) { status = s; }, end(b) { payload = b || ''; } };
    route.handler(req, res, { pathname: '/api/auth/config' }, /* isLocal */ true, deps);
    handlers.data(JSON.stringify({ clearOverride: true }));
    handlers.end();
    assert.equal(status, 200);
    assert.equal(cleared, true, 'must call deps.clearAuthOverride');
    assert.equal(setCalled, false, 'must NOT call setAuthConfig on the clearOverride path');
    assert.equal(JSON.parse(payload).scope, 'global');
  });
});

// authConfigPost's scope-source selection: editing the GLOBAL scope while a project override
// is active must seed from `state.global`, NOT `state.effective` (the override). The loopback
// API harness is always non-CLI (projectDir:null → project coerced to global), so this subtle
// branch can only be hit via a direct handler call.
describe('POST /api/auth/config scope-source selection', () => {
  it('editing global reads the global config, not the active project override', () => {
    const route = authRoutesCache.find(r => r.path === '/api/auth/config' && r.method === 'POST');
    let savedCfg = null, savedScope = null;
    // project override is active & enabled; global is OFF/empty
    const state = {
      effective: { enabled: true, password: 'PROJPW' },
      global: { enabled: false, password: '' },
      scope: 'project', hasProjectOverride: true, projectDir: '/x',
    };
    const deps = {
      MAX_POST_BODY: 1e6,
      getAuthState() { return state; },
      setAuthConfig(cfg, scope) { savedCfg = cfg; savedScope = scope; },
      clearAuthOverride() {},
    };
    const handlers = {};
    const req = { on(ev, cb) { handlers[ev] = cb; } };
    const res = { writeHead() {}, end() {} };
    route.handler(req, res, { pathname: '/api/auth/config' }, /* isLocal */ true, deps);
    handlers.data(JSON.stringify({ scope: 'global', password: 'NEWGLOBAL' }));
    handlers.end();
    assert.equal(savedScope, 'global');
    assert.equal(savedCfg.password, 'NEWGLOBAL');
    // enabled taken from GLOBAL scope (false), NOT the effective project override (true)
    assert.equal(savedCfg.enabled, false, 'must seed from global, not the active override');
  });
});
