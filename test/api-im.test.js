import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Isolate LOG_DIR before any findcc-loading import.
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-api-im-test-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';
// 私有高位端口窗,避免与用户真实 ccv 服务(7008-7099)抢端口(2026-06-06 审计 port-clash)。
// server.js 顶层把 CCV_START_PORT/MAX_PORT 冻结为 const,故必须在 import server.js 之前设好(本文件 before() 内动态 import,此处即生效)。
process.env.CCV_START_PORT = '19770';
process.env.CCV_MAX_PORT = '19779';

// Stub the shared bridge fetch so /test never touches the network (feishu testConnection uses it).
const core = await import('../packages/app/server/lib/im-bridge-core.js');
core.__setFetchForTests(async (url) => {
  if (url.includes('tenant_access_token')) return { ok: true, json: async () => ({ code: 0, tenant_access_token: 't', expire: 7200 }) };
  return { ok: true, json: async () => ({ code: 0 }) };
});

function httpRequest(port, path, { method = 'GET', body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method, headers: body ? { 'Content-Type': 'application/json' } : {} }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data, json() { return JSON.parse(data); } }));
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

describe('Generic /api/im/:platform config API (loopback=admin)', { concurrency: false }, () => {
  let stopViewer, getPort, port;

  before(async () => {
    const mod = await import('../packages/app/server/server.js');
    stopViewer = mod.stopViewer;
    getPort = mod.getPort;
    assert.ok(await mod.startViewer(), 'server should start');
    port = getPort();
    assert.ok(port > 0);
  });

  after(async () => {
    await new Promise((resolve) => { stopViewer(); setTimeout(() => { rmSync(tmpDir, { recursive: true, force: true }); resolve(); }, 200); });
  });

  it('GET /api/im/feishu/status defaults to disabled (local admin gets an empty appSecret)', async () => {
    const res = await httpRequest(port, '/api/im/feishu/status');
    assert.equal(res.status, 200);
    const d = res.json();
    assert.equal(d.enabled, false);
    assert.equal(d.hasSecret, false);
    assert.equal(d.appSecret, '', 'local admin gets the plaintext appSecret (empty when unset)');
    assert.equal(d.region, 'feishu', 'region surfaces in admin state');
    assert.ok(d.connection && typeof d.connection === 'object');
  });

  it('POST /api/im/feishu/config saves creds + region and returns masked state', async () => {
    const res = await httpRequest(port, '/api/im/feishu/config', {
      method: 'POST',
      body: { enabled: false, appId: 'cli_abc', appSecret: 'topsecret', region: 'lark', allowUserIds: ['ou_1'] },
    });
    assert.equal(res.status, 200);
    const d = res.json();
    assert.equal(d.appId, 'cli_abc');
    assert.equal(d.region, 'lark');
    assert.equal(d.hasSecret, true);
    assert.equal('appSecret' in d, false);
    assert.deepEqual(d.allowUserIds, ['ou_1']);
    assert.ok(!res.body.includes('topsecret'), 'secret must not leak in the response');
  });

  it('preserves the secret when re-saving with an empty appSecret', async () => {
    const res = await httpRequest(port, '/api/im/feishu/config', { method: 'POST', body: { enabled: false, appId: 'cli_z', appSecret: '' } });
    assert.equal(res.json().hasSecret, true);
    assert.equal(res.json().appId, 'cli_z');
  });

  it('POST /api/im/feishu/test validates creds via the stubbed token fetch', async () => {
    const res = await httpRequest(port, '/api/im/feishu/test', { method: 'POST', body: { appId: 'cli_abc', appSecret: 'topsecret', region: 'lark' } });
    assert.equal(res.status, 200);
    assert.equal(res.json().ok, true);
  });

  it('POST /api/im/wecom/test with no creds returns ok:false BEFORE opening a connection', async () => {
    // Empty body + nothing stored → the route must reject on the missing-creds guard, not reach
    // wecom's testConnection (which would open a WebSocket the fetch stub can't intercept).
    const res = await httpRequest(port, '/api/im/wecom/test', { method: 'POST', body: {} });
    assert.equal(res.status, 200);
    assert.equal(res.json().ok, false);
    assert.match(res.json().detail || '', /missing/);
  });

  it('GET /api/preferences strips the feishu key (no secret leak)', async () => {
    const res = await httpRequest(port, '/api/preferences');
    assert.equal('feishu' in res.json(), false, 'feishu must be stripped from preferences');
    assert.ok(!res.body.includes('topsecret'), 'no secret in preferences');
  });

  it('returns 404 for an unknown platform (no crash)', async () => {
    const res = await httpRequest(port, '/api/im/telegram/status');
    assert.equal(res.status, 404);
  });

  it('still routes the legacy /api/dingtalk/status', async () => {
    const res = await httpRequest(port, '/api/dingtalk/status');
    assert.equal(res.status, 200);
    assert.equal(res.json().enabled, false);
  });

  // WeCom is registered as a third platform via the same generic routes (no /test here — WeCom's
  // testConnection opens a WebSocket the fetch stub can't intercept; that's covered in wecom-bridge.test.js).
  it('GET /api/im/wecom/status defaults to disabled', async () => {
    const res = await httpRequest(port, '/api/im/wecom/status');
    assert.equal(res.status, 200);
    assert.equal(res.json().enabled, false);
    assert.equal(res.json().hasSecret, false);
  });

  it('POST /api/im/wecom/config saves creds and the strip keeps the secret out of /api/preferences', async () => {
    const res = await httpRequest(port, '/api/im/wecom/config', { method: 'POST', body: { enabled: false, botId: 'bot_z', secret: 'wecomsecret', allowUserIds: ['lisi'] } });
    assert.equal(res.status, 200);
    assert.equal(res.json().botId, 'bot_z');
    assert.equal(res.json().hasSecret, true);
    assert.equal('secret' in res.json(), false);
    assert.ok(!res.body.includes('wecomsecret'), 'secret must not leak in the response');
    const prefs = await httpRequest(port, '/api/preferences');
    assert.equal('wecom' in prefs.json(), false, 'wecom must be stripped from preferences');
    assert.ok(!prefs.body.includes('wecomsecret'), 'no wecom secret in preferences');
  });

  // applyProcess:false 旁路（前端 onBlur 自动保存用）：持久化配置但不驱动进程，故不会 spawn worker。
  // 用 enabled:true + applyProcess:false 断言：enabled 落盘、但 process 仍 dead（没起 worker），且 applyProcess 不入盘。
  it('POST config with applyProcess:false persists config but does NOT spawn a worker', async () => {
    const res = await httpRequest(port, '/api/im/wecom/config', {
      method: 'POST',
      body: { enabled: true, applyProcess: false, botId: 'bot_blur', secret: 'blursecret', allowUserIds: ['lisi'] },
    });
    assert.equal(res.status, 200);
    const st = await httpRequest(port, '/api/im/wecom/status');
    assert.equal(st.json().enabled, true, 'enabled is persisted even with applyProcess:false');
    assert.equal(st.json().process.state, 'dead', 'no worker spawned (applyProcess:false bypasses restart)');
    assert.equal(st.json().process.port, null, 'no port since no worker');
    assert.equal('applyProcess' in st.json(), false, 'applyProcess is a control flag, never persisted');
    // 复位，避免给后续测试留下 enabled:true 脏态
    await httpRequest(port, '/api/im/wecom/config', { method: 'POST', body: { enabled: false, applyProcess: false } });
  });

  it('GET /api/im/:platform/senders returns {} when none recorded', async () => {
    const res = await httpRequest(port, '/api/im/discord/senders');
    assert.equal(res.status, 200);
    const d = res.json();
    assert.equal(d.platform, 'discord');
    assert.deepEqual(d.senders, {});
  });

  it('GET /api/im/:platform/senders surfaces a persisted sender map', async () => {
    const { upsertSender } = await import('../packages/app/server/lib/im-senders.js');
    upsertSender('discord', 'snow1', { name: 'Alice', avatar: 'https://a/1.png' });
    const res = await httpRequest(port, '/api/im/discord/senders');
    assert.equal(res.status, 200);
    assert.equal(res.json().senders.snow1.name, 'Alice');
    assert.equal(res.json().senders.snow1.avatar, 'https://a/1.png');
  });

  // Discord is the 4th platform; unlike WeCom its testConnection is REST-based, so /test is coverable here.
  it('GET /api/im/discord/status defaults to disabled', async () => {
    const res = await httpRequest(port, '/api/im/discord/status');
    assert.equal(res.status, 200);
    assert.equal(res.json().enabled, false);
    assert.equal(res.json().hasSecret, false);
  });

  it('POST /api/im/discord/config saves the token and the strip keeps it out of /api/preferences', async () => {
    const res = await httpRequest(port, '/api/im/discord/config', { method: 'POST', body: { enabled: false, botToken: 'discordtoken123', allowUserIds: ['42'] } });
    assert.equal(res.status, 200);
    assert.equal(res.json().hasSecret, true);
    assert.equal('botToken' in res.json(), false);
    assert.ok(!res.body.includes('discordtoken123'), 'token must not leak');
    const prefs = await httpRequest(port, '/api/preferences');
    assert.equal('discord' in prefs.json(), false, 'discord must be stripped from preferences');
    assert.ok(!prefs.body.includes('discordtoken123'), 'no discord token in preferences');
  });

  it('POST /api/im/discord/test validates the token via the stubbed REST /users/@me', async () => {
    const res = await httpRequest(port, '/api/im/discord/test', { method: 'POST', body: { botToken: 'discordtoken123' } });
    assert.equal(res.status, 200);
    assert.equal(res.json().ok, true);
  });
});

// Loopback HTTP is always isLocal:true, so cover the !isLocal 403 guard with a direct handler call.
describe('POST /api/im/:platform/config loopback-only guard', () => {
  it('rejects a remote caller with 403 before reading the body', async () => {
    const { imRoutes } = await import('../packages/app/server/routes/im.js');
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/config', 'POST'));
    let status = 0, payload = '';
    const res = { writeHead(s) { status = s; }, end(b) { payload = b || ''; } };
    let reloaded = false;
    const deps = { MAX_POST_BODY: 1e6, im: { reloadBridge() { reloaded = true; }, getBridgeStatus: () => ({}) } };
    route.handler({ on() {} }, res, { pathname: '/api/im/feishu/config' }, /* isLocal */ false, deps);
    assert.equal(status, 403);
    assert.match(payload, /Loopback only/);
    assert.equal(reloaded, false);
  });

  it('GET status strips cred fields for a remote caller', async () => {
    const { imRoutes } = await import('../packages/app/server/routes/im.js');
    const { saveConfig } = await import('../packages/app/server/lib/im-config.js');
    saveConfig('feishu', { enabled: true, appId: 'cli_SECRET', appSecret: 'sec_SECRET', region: 'lark', allowUserIds: ['ou_SECRET'] });
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/status', 'GET'));
    // isWorker:true → imStatus reports its own in-process adapter (the leaky connection we stub here);
    // the !isLocal branch must strip it. (A worker actually binds loopback-only, but the strip logic stays.)
    const deps = { im: { isWorker: true, getBridgeStatus: () => ({ running: true, connected: true, boundConversationId: 'oc_SECRET', appKeyTail: 'CRET', lastError: 'boom' }) } };
    let payload = '';
    const res = { writeHead() {}, end(b) { payload = b || ''; } };
    route.handler({}, res, { pathname: '/api/im/feishu/status' }, /* isLocal */ false, deps);
    const rd = JSON.parse(payload);
    assert.equal(rd.enabled, true);
    assert.equal(rd.hasSecret, true);
    assert.deepEqual(rd.connection, { running: true, connected: true });
    for (const leak of ['cli_SECRET', 'sec_SECRET', 'ou_SECRET', 'oc_SECRET', 'CRET', 'boom']) {
      assert.ok(!payload.includes(leak), `remote payload must not leak ${leak}`);
    }
    assert.equal('appId' in rd, false);
    assert.equal('appSecret' in rd, false);
    assert.equal('allowUserIds' in rd, false);
  });

  it('GET /api/im/discord/status strips the token + allowlist for a remote caller', async () => {
    const { imRoutes } = await import('../packages/app/server/routes/im.js');
    const { saveConfig } = await import('../packages/app/server/lib/im-config.js');
    saveConfig('discord', { enabled: true, botToken: 'tok_SECRET', allowUserIds: ['u_SECRET'] });
    const route = imRoutes.find((r) => r.predicate('/api/im/discord/status', 'GET'));
    const deps = { im: { isWorker: true, getBridgeStatus: () => ({ running: true, connected: true, boundConversationId: 'dm_SECRET', lastError: 'boom' }) } };
    let payload = '';
    const res = { writeHead() {}, end(b) { payload = b || ''; } };
    route.handler({}, res, { pathname: '/api/im/discord/status' }, /* isLocal */ false, deps);
    const rd = JSON.parse(payload);
    assert.equal(rd.enabled, true);
    assert.equal(rd.hasSecret, true);
    assert.deepEqual(rd.connection, { running: true, connected: true });
    for (const leak of ['tok_SECRET', 'u_SECRET', 'dm_SECRET', 'boom']) {
      assert.ok(!payload.includes(leak), `remote payload must not leak ${leak}`);
    }
    assert.equal('botToken' in rd, false);
    assert.equal('allowUserIds' in rd, false);
  });
});

// New behavior: allowlist gate + process control + logs (direct handler calls with deps doubles so
// no real worker process is ever spawned).
describe('IM routes: allowlist optional / process control / logs (manager-backed)', () => {
  const fakeReq = (bodyStr) => ({
    on(ev, cb) { if (ev === 'data' && bodyStr) cb(Buffer.from(bodyStr)); if (ev === 'end') cb(); return this; },
  });
  function call(route, { pathname, body, isLocal = true, deps }) {
    let status = 0, payload = '';
    let resolveEnd; const done = new Promise((r) => { resolveEnd = r; });
    const res = { writeHead(s) { status = s; }, end(b) { payload = b || ''; resolveEnd(); } };
    route.handler(fakeReq(body ? JSON.stringify(body) : null), res, { pathname }, isLocal, deps);
    return done.then(() => ({ status, payload, json: () => JSON.parse(payload) }));
  }

  it('config POST with enabled:true but NO allowlist → 200, still spawns (allowlist is optional)', async () => {
    const { imRoutes } = await import('../packages/app/server/routes/im.js');
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/config', 'POST'));
    const calls = [];
    const deps = { MAX_POST_BODY: 1e6, im: { isWorker: false, restartProcess: async (id) => calls.push(['restart', id]), stopProcess: async (id) => calls.push(['stop', id]) } };
    const r = await call(route, { pathname: '/api/im/feishu/config', body: { enabled: true, appId: 'a', appSecret: 'b', allowUserIds: [] }, deps });
    assert.equal(r.status, 200);
    assert.equal(r.json().connection.running, true);
    // Empty allowlist no longer hard-rejected; the worker IS driven (UI surfaces a security warning).
    assert.deepEqual(calls, [['restart', 'feishu']]);
  });

  it('GET /api/im/:platform/append-system returns the preset when no file exists yet', async () => {
    const { imRoutes } = await import('../packages/app/server/routes/im.js');
    const route = imRoutes.find((r) => r.predicate('/api/im/discord/append-system', 'GET'));
    const r = await call(route, { pathname: '/api/im/discord/append-system', deps: { MAX_POST_BODY: 1e6 } });
    assert.equal(r.status, 200);
    assert.equal(r.json().platform, 'discord');
    assert.match(r.json().content, /AskUserQuestion/); // preset content
  });

  it('POST /api/im/:platform/append-system persists content; GET reads it back', async () => {
    const { imRoutes } = await import('../packages/app/server/routes/im.js');
    const post = imRoutes.find((r) => r.predicate('/api/im/discord/append-system', 'POST'));
    const get = imRoutes.find((r) => r.predicate('/api/im/discord/append-system', 'GET'));
    const w = await call(post, { pathname: '/api/im/discord/append-system', body: { content: '# custom persona\nbe brief' }, deps: { MAX_POST_BODY: 1e6 } });
    assert.equal(w.status, 200);
    assert.equal(w.json().ok, true);
    const r = await call(get, { pathname: '/api/im/discord/append-system', deps: { MAX_POST_BODY: 1e6 } });
    assert.equal(r.json().content, '# custom persona\nbe brief');
  });

  it('POST /api/im/:platform/append-system rejects non-string content (400) and non-local caller (403)', async () => {
    const { imRoutes } = await import('../packages/app/server/routes/im.js');
    const post = imRoutes.find((r) => r.predicate('/api/im/discord/append-system', 'POST'));
    const bad = await call(post, { pathname: '/api/im/discord/append-system', body: { content: 123 }, deps: { MAX_POST_BODY: 1e6 } });
    assert.equal(bad.status, 400);
    const remote = await call(post, { pathname: '/api/im/discord/append-system', body: { content: 'x' }, isLocal: false, deps: { MAX_POST_BODY: 1e6 } });
    assert.equal(remote.status, 403);
  });

  it('POST /api/im/:platform/append-system rejects content over MAX_IM_APPEND_SYSTEM_CHARS (413)', async () => {
    const { imRoutes } = await import('../packages/app/server/routes/im.js');
    const { MAX_IM_APPEND_SYSTEM_CHARS } = await import('../packages/app/server/lib/im-append-system.js');
    const post = imRoutes.find((r) => r.predicate('/api/im/discord/append-system', 'POST'));
    const tooBig = 'a'.repeat(MAX_IM_APPEND_SYSTEM_CHARS + 1);
    // MAX_POST_BODY must exceed the JSON body so the size guard (413), not the body-limit, is what trips.
    const r = await call(post, { pathname: '/api/im/discord/append-system', body: { content: tooBig }, deps: { MAX_POST_BODY: MAX_IM_APPEND_SYSTEM_CHARS * 2 } });
    assert.equal(r.status, 413);
  });

  it('config POST enabled with whitespace-only allowlist → fires audit warning + still 200/spawns', async () => {
    const { imRoutes } = await import('../packages/app/server/routes/im.js');
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/config', 'POST'));
    const calls = [];
    const deps = { MAX_POST_BODY: 1e6, im: { isWorker: false, restartProcess: async (id) => calls.push(['restart', id]), stopProcess: async (id) => calls.push(['stop', id]) } };
    // 全空白白名单经 normalize 后等同空名单 → 必须照样打审计告警（不能因原始数组非空而漏报）
    const origWarn = console.warn; let warned = '';
    console.warn = (...a) => { warned += a.join(' '); };
    try {
      const r = await call(route, { pathname: '/api/im/feishu/config', body: { enabled: true, appId: 'a', appSecret: 'b', allowUserIds: ['   '] }, deps });
      assert.equal(r.status, 200);
      assert.match(warned, /EMPTY allowlist/);
    } finally { console.warn = origWarn; }
    assert.deepEqual(calls, [['restart', 'feishu']]);
  });

  it('config POST with enabled:true AND allowlist → restartProcess(id)', async () => {
    const { imRoutes } = await import('../packages/app/server/routes/im.js');
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/config', 'POST'));
    const calls = [];
    const deps = { MAX_POST_BODY: 1e6, im: { isWorker: false, restartProcess: async (id) => calls.push(['restart', id]), stopProcess: async (id) => calls.push(['stop', id]) } };
    const r = await call(route, { pathname: '/api/im/feishu/config', body: { enabled: true, appId: 'a', appSecret: 'b', allowUserIds: ['ou_ok'] }, deps });
    assert.equal(r.status, 200);
    assert.equal(r.json().connection.running, true);
    assert.deepEqual(calls, [['restart', 'feishu']]);
  });

  it('config POST with enabled:false → stopProcess(id)', async () => {
    const { imRoutes } = await import('../packages/app/server/routes/im.js');
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/config', 'POST'));
    const calls = [];
    const deps = { MAX_POST_BODY: 1e6, im: { isWorker: false, restartProcess: async (id) => calls.push(['restart', id]), stopProcess: async (id) => calls.push(['stop', id]) } };
    const r = await call(route, { pathname: '/api/im/feishu/config', body: { enabled: false }, deps });
    assert.equal(r.status, 200);
    assert.deepEqual(calls, [['stop', 'feishu']]);
  });

  it('process POST {action:restart} drives the manager; rejects in a worker process', async () => {
    const { imRoutes } = await import('../packages/app/server/routes/im.js');
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/process', 'POST'));
    const calls = [];
    const mainDeps = { MAX_POST_BODY: 1e6, im: { isWorker: false, restartProcess: async (id) => calls.push(['restart', id]), getProcessStatus: async () => ({ running: true, connected: false }) } };
    const r = await call(route, { pathname: '/api/im/feishu/process', body: { action: 'restart' }, deps: mainDeps });
    assert.equal(r.status, 200);
    assert.equal(r.json().ok, true);
    assert.deepEqual(calls, [['restart', 'feishu']]);
    // worker → 409
    const workerDeps = { MAX_POST_BODY: 1e6, im: { isWorker: true } };
    const r2 = await call(route, { pathname: '/api/im/feishu/process', body: { action: 'restart' }, deps: workerDeps });
    assert.equal(r2.status, 409);
  });

  it('logs GET returns {project, latest:null} when the worker has no logs', async () => {
    const { imRoutes } = await import('../packages/app/server/routes/im.js');
    const route = imRoutes.find((r) => r.predicate('/api/im/discord/logs', 'GET'));
    const r = await call(route, { pathname: '/api/im/discord/logs', isLocal: true, deps: { im: {} } });
    assert.equal(r.status, 200);
    assert.equal(r.json().project, 'IM_discord');
    assert.equal(r.json().latest, null);
  });

  it('status (main branch) carries connectionState/lastError from getProcessStatus', async () => {
    const { imRoutes } = await import('../packages/app/server/routes/im.js');
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/status', 'GET'));
    const deps = { im: { isWorker: false, getProcessStatus: async () => ({ state: 'ready', running: true, connected: false, connectionState: 'reconnecting', lastError: 'net down', pid: 1, port: 7000, startedAt: null }) } };
    const r = await call(route, { pathname: '/api/im/feishu/status', isLocal: true, deps });
    assert.equal(r.status, 200);
    const conn = r.json().connection;
    assert.equal(conn.connectionState, 'reconnecting');
    assert.equal(conn.lastError, 'net down');
    assert.equal(conn.connected, false);
  });

  it('status remote trim keeps connectionState but strips lastError', async () => {
    const { imRoutes } = await import('../packages/app/server/routes/im.js');
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/status', 'GET'));
    const deps = { im: { isWorker: true, getBridgeStatus: () => ({ running: true, connected: false, connectionState: 'reconnecting', lastError: 'boom_SECRET', boundConversationId: 'oc_x' }) } };
    const r = await call(route, { pathname: '/api/im/feishu/status', isLocal: false, deps });
    assert.deepEqual(r.json().connection, { running: true, connected: false, connectionState: 'reconnecting' });
    assert.ok(!r.payload.includes('boom_SECRET'), 'lastError must stay loopback-only');
  });

  it('config POST optimistic response includes connectionState: disconnected', async () => {
    const { imRoutes } = await import('../packages/app/server/routes/im.js');
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/config', 'POST'));
    const deps = { MAX_POST_BODY: 1e6, im: { isWorker: false, restartProcess: async () => {}, stopProcess: async () => {} } };
    const r = await call(route, { pathname: '/api/im/feishu/config', body: { enabled: true, appId: 'a', appSecret: 'b', allowUserIds: ['u'] }, deps });
    assert.deepEqual(r.json().connection, { running: true, connected: false, connectionState: 'disconnected' });
  });
});

// Per-IM skill management endpoints (GET /skills, POST /skills/import, POST /skills/toggle).
// Scoped to IM_<id>/.claude/skills under the isolated CCV_LOG_DIR temp. Uses 'wecom' to avoid
// colliding with the append-system tests that wrote under IM_discord.
describe('IM skill management endpoints (per-IM .claude/skills)', () => {
  const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  const jsonReq = (bodyStr) => ({ on(ev, cb) { if (ev === 'data' && bodyStr) cb(Buffer.from(bodyStr)); if (ev === 'end') cb(); return this; } });
  const importReq = (boundary, filename, content) => {
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n\r\n${content}\r\n--${boundary}--\r\n`;
    const buf = Buffer.from(body, 'utf8');
    return { headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(buf.length) }, on(ev, cb) { if (ev === 'data') cb(buf); if (ev === 'end') cb(); return this; }, destroy() {} };
  };
  function run(route, req, { pathname, isLocal = true, deps = {} }) {
    let status = 0, payload = '';
    let resolveEnd; const done = new Promise((r) => { resolveEnd = r; });
    const res = { writeHead(s) { status = s; }, end(b) { payload = b || ''; resolveEnd(); } };
    route.handler(req, res, { pathname }, isLocal, deps);
    return done.then(() => ({ status, payload, json: () => JSON.parse(payload) }));
  }

  it('GET skills is empty before any import', async () => {
    const { imRoutes } = await import('../packages/app/server/routes/im.js');
    const route = imRoutes.find((r) => r.predicate('/api/im/wecom/skills', 'GET'));
    const r = await run(route, jsonReq(null), { pathname: '/api/im/wecom/skills' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json().skills, []);
  });

  it('import a SKILL.md → GET shows it (project, enabled); toggle off → enabled:false', async () => {
    const { imRoutes } = await import('../packages/app/server/routes/im.js');
    const imp = imRoutes.find((r) => r.predicate('/api/im/wecom/skills/import', 'POST'));
    const get = imRoutes.find((r) => r.predicate('/api/im/wecom/skills', 'GET'));
    const tog = imRoutes.find((r) => r.predicate('/api/im/wecom/skills/toggle', 'POST'));

    const md = '---\nname: my-im-skill\n---\n# hi\n';
    const w = await run(imp, importReq('XB', 'my-im-skill.md', md), { pathname: '/api/im/wecom/skills/import', deps: { WINDOWS_RESERVED_NAMES: RESERVED } });
    assert.equal(w.status, 200);
    assert.equal(w.json().name, 'my-im-skill');

    let r = await run(get, jsonReq(null), { pathname: '/api/im/wecom/skills' });
    assert.equal(r.json().skills.length, 1);
    assert.equal(r.json().skills[0].name, 'my-im-skill');
    assert.equal(r.json().skills[0].source, 'project');
    assert.equal(r.json().skills[0].enabled, true);

    const t = await run(tog, jsonReq(JSON.stringify({ name: 'my-im-skill', enable: false })), { pathname: '/api/im/wecom/skills/toggle', deps: { MAX_POST_BODY: 1e6 } });
    assert.equal(t.status, 200);
    r = await run(get, jsonReq(null), { pathname: '/api/im/wecom/skills' });
    assert.equal(r.json().skills[0].enabled, false);
  });

  it('import rejects non-zip/md (415) and non-local caller (403); toggle bad name → 400', async () => {
    const { imRoutes } = await import('../packages/app/server/routes/im.js');
    const imp = imRoutes.find((r) => r.predicate('/api/im/wecom/skills/import', 'POST'));
    const tog = imRoutes.find((r) => r.predicate('/api/im/wecom/skills/toggle', 'POST'));
    const bad = await run(imp, importReq('XB', 'evil.txt', 'x'), { pathname: '/api/im/wecom/skills/import', deps: { WINDOWS_RESERVED_NAMES: RESERVED } });
    assert.equal(bad.status, 415);
    const remote = await run(imp, importReq('XB', 'a.md', 'x'), { pathname: '/api/im/wecom/skills/import', isLocal: false, deps: { WINDOWS_RESERVED_NAMES: RESERVED } });
    assert.equal(remote.status, 403);
    const t = await run(tog, jsonReq(JSON.stringify({ name: '../escape', enable: true })), { pathname: '/api/im/wecom/skills/toggle', deps: { MAX_POST_BODY: 1e6 } });
    assert.equal(t.status, 400);
  });
});
