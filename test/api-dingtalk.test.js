import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ████████ 死命令(2026-06-06 数据事故,绝对不可违反)████████
// 本文件起【真实 server 整链】,POST /api/dingtalk/config 会打到真实 im-process-manager。
// 历史教训:enabled:true 的整链 POST 曾触发 spawnImProcess 拉起 detached 真实 IM worker
// (脱离测试生命周期常驻、子链剥离 CCV_* 后以真实 ~/.claude/cc-viewer 为 LOG_DIR),
// 与用户真实环境互相破坏,三次把用户 40GB 历史日志整树删除。
// 现状:im-process-manager.spawnImProcess 有 L4 铁闸(NODE_TEST_CONTEXT 下拒绝真实 spawn)。
// 本文件内任何用例【绝不允许】:设 CCV_TEST_ALLOW_IM_SPAWN、绕过铁闸、或以任何方式
// 拉起/杀灭真实 worker;需要验证 restart 行为一律走「直接 handler + 注入 stub deps」模式
// (见下方 allowlist describe 块)。新增用例先读 server/lib/im/im-process-manager.js 顶部铁闸注释。
// █████████████████████████████████████████████████████████
// Isolate LOG_DIR (dingtalk config shares preferences.json) before any findcc-loading import.
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-dingtalk-api-test-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';
// 私有高位端口窗,避免与用户真实 ccv 服务(7008-7099)抢端口(2026-06-06 审计 port-clash)。
// server.js 顶层把 CCV_START_PORT/MAX_PORT 冻结为 const,故必须在 import server.js 之前设好(本文件 before() 内动态 import,此处即生效)。
process.env.CCV_START_PORT = '19780';
process.env.CCV_MAX_PORT = '19789';

// Stub the bridge's outbound fetch so /test never touches the network.
const bridge = await import('../packages/app/server/lib/im/dingtalk-bridge.js');
bridge.__setFetchForTests(async (url) => {
  if (url.includes('accessToken')) return { ok: true, json: async () => ({ accessToken: 'tok', expireIn: 7200 }) };
  return { ok: true, json: async () => ({}) };
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

describe('DingTalk config API (loopback=admin)', { concurrency: false }, () => {
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

  it('GET /api/dingtalk/status defaults to disabled (local admin gets an empty appSecret)', async () => {
    const res = await httpRequest(port, '/api/dingtalk/status');
    assert.equal(res.status, 200);
    const d = res.json();
    assert.equal(d.enabled, false);
    assert.equal(d.hasSecret, false);
    // Loopback HTTP is always isLocal:true (admin) → appSecret is present but empty when none is stored.
    assert.equal(d.appSecret, '', 'local admin gets the plaintext appSecret (empty when unset)');
    assert.ok(d.connection && typeof d.connection === 'object', 'includes live connection status');
  });

  it('POST /api/dingtalk/config saves creds and returns masked state', async () => {
    const res = await httpRequest(port, '/api/dingtalk/config', {
      method: 'POST',
      body: { enabled: false, appKey: 'dk123', appSecret: 'topsecret', allowStaffIds: ['u1', 'u2'], maxChunkChars: 2000, aiCardTemplateId: 'ai-tmpl' },
    });
    assert.equal(res.status, 200);
    const d = res.json();
    assert.equal(d.appKey, 'dk123');
    assert.equal(d.hasSecret, true);
    assert.equal('appSecret' in d, false);
    assert.deepEqual(d.allowStaffIds, ['u1', 'u2']);
    assert.equal(d.maxChunkChars, 2000);
    assert.equal(d.aiCardTemplateId, 'ai-tmpl', 'aiCardTemplateId round-trips through the POST route + admin state');
    assert.ok(!res.body.includes('topsecret'), 'secret must not leak in the response');
  });

  it('preserves the secret when re-saving with an empty appSecret', async () => {
    const res = await httpRequest(port, '/api/dingtalk/config', { method: 'POST', body: { enabled: false, appKey: 'dk999', appSecret: '' } });
    assert.equal(res.json().hasSecret, true, 'empty secret must preserve the stored one');
    assert.equal(res.json().appKey, 'dk999');
  });

  it('GET /api/preferences strips the dingtalk key (no secret leak)', async () => {
    const res = await httpRequest(port, '/api/preferences');
    assert.equal('dingtalk' in res.json(), false, 'dingtalk must be stripped from preferences');
    assert.ok(!res.body.includes('topsecret') && !res.body.includes(Buffer.from('topsecret').toString('base64')), 'no secret (raw or base64) in preferences');
  });

  it('POST /api/dingtalk/test validates creds via the stubbed token fetch', async () => {
    const res = await httpRequest(port, '/api/dingtalk/test', { method: 'POST', body: { appKey: 'dk123', appSecret: 'topsecret' } });
    assert.equal(res.status, 200);
    assert.equal(res.json().ok, true);
  });
});

// GET /api/dingtalk/status: a token-authorized LAN (non-local) client must not see the appKey,
// the staffId allowlist, the bound conversation id, or raw errors. Direct handler call since
// loopback HTTP is always isLocal:true.
describe('GET /api/dingtalk/status loopback gate', () => {
  it('strips appKey / allowlist / boundConversationId / lastError for remote callers', async () => {
    const { dingtalkRoutes } = await import('../packages/app/server/routes/dingtalk.js');
    const { saveDingTalkConfig } = await import('../packages/app/server/lib/im/dingtalk-config.js');
    saveDingTalkConfig({ enabled: true, appKey: 'dkSECRET', appSecret: 'appSecretSECRET', allowStaffIds: ['staff-x'] });
    const route = dingtalkRoutes.find((r) => r.path === '/api/dingtalk/status' && r.method === 'GET');
    const deps = { dingtalk: { isWorker: true, getBridgeStatus: () => ({ running: true, connected: true, boundConversationId: 'cidSECRET', appKeyTail: 'CRET', lastError: 'boom' }) } };
    const mkRes = () => { let payload = ''; return { writeHead() {}, end(b) { payload = b || ''; }, get payload() { return payload; } }; };

    const remote = mkRes();
    route.handler({}, remote, { pathname: '/api/dingtalk/status' }, /* isLocal */ false, deps);
    const rd = JSON.parse(remote.payload);
    assert.equal(rd.enabled, true);
    assert.equal(rd.hasSecret, true);
    assert.deepEqual(rd.connection, { running: true, connected: true });
    for (const leak of ['dkSECRET', 'appSecretSECRET', 'staff-x', 'cidSECRET', 'CRET', 'boom']) {
      assert.ok(!remote.payload.includes(leak), `remote payload must not leak ${leak}`);
    }
    assert.equal('appKey' in rd, false);
    assert.equal('appSecret' in rd, false, 'remote must never receive the plaintext appSecret');
    assert.equal('allowStaffIds' in rd, false);

    // local caller (admin) gets the full admin view INCLUDING the plaintext appSecret to view/copy
    const local = mkRes();
    route.handler({}, local, { pathname: '/api/dingtalk/status' }, /* isLocal */ true, deps);
    const ld = JSON.parse(local.payload);
    assert.equal(ld.appKey, 'dkSECRET');
    assert.equal(ld.appSecret, 'appSecretSECRET', 'local admin gets the plaintext appSecret');
    assert.deepEqual(ld.allowStaffIds, ['staff-x']);
    assert.equal(ld.connection.boundConversationId, 'cidSECRET');
  });

  it('remote trim keeps connectionState but strips lastError; main branch carries the tri-state', async () => {
    const { dingtalkRoutes } = await import('../packages/app/server/routes/dingtalk.js');
    const route = dingtalkRoutes.find((r) => r.path === '/api/dingtalk/status' && r.method === 'GET');
    const mkRes = () => { let payload = ''; return { writeHead() {}, end(b) { payload = b || ''; }, get payload() { return payload; } }; };

    // Worker branch, remote trim.
    const workerDeps = { dingtalk: { isWorker: true, getBridgeStatus: () => ({ running: true, connected: false, connectionState: 'reconnecting', lastError: 'boom_SECRET' }) } };
    const remote = mkRes();
    route.handler({}, remote, { pathname: '/api/dingtalk/status' }, /* isLocal */ false, workerDeps);
    assert.deepEqual(JSON.parse(remote.payload).connection, { running: true, connected: false, connectionState: 'reconnecting' });
    assert.ok(!remote.payload.includes('boom_SECRET'), 'lastError must stay loopback-only');

    // Main branch: connectionState/lastError come from getProcessStatus.
    const mainDeps = { dingtalk: { isWorker: false, getProcessStatus: async () => ({ state: 'ready', running: true, connected: false, connectionState: 'reconnecting', lastError: 'net down', pid: 1, port: 7000, startedAt: null }) } };
    const local = mkRes();
    await new Promise((resolve) => {
      const res = { writeHead() {}, end(b) { local.end(b); resolve(); } };
      route.handler({}, res, { pathname: '/api/dingtalk/status' }, /* isLocal */ true, mainDeps);
    });
    const ld = JSON.parse(local.payload);
    assert.equal(ld.connection.connectionState, 'reconnecting');
    assert.equal(ld.connection.lastError, 'net down');
  });
});

// Loopback HTTP is always isLocal:true, so the !isLocal 403 guard can't be hit via the API.
// Cover it with a direct handler call (mirrors the auth test).
describe('POST /api/dingtalk/config loopback-only guard', () => {
  it('rejects a remote caller with 403 before reading the body', async () => {
    const { dingtalkRoutes } = await import('../packages/app/server/routes/dingtalk.js');
    const route = dingtalkRoutes.find((r) => r.path === '/api/dingtalk/config' && r.method === 'POST');
    let status = 0, payload = '';
    const res = { writeHead(s) { status = s; }, end(b) { payload = b || ''; } };
    let reloaded = false;
    const deps = { MAX_POST_BODY: 1e6, dingtalk: { reloadBridge() { reloaded = true; }, getBridgeStatus: () => ({}) } };
    route.handler({ on() {} }, res, { pathname: '/api/dingtalk/config' }, /* isLocal */ false, deps);
    assert.equal(status, 403);
    assert.match(payload, /Loopback only/);
    assert.equal(reloaded, false, 'must not reload bridge for a remote caller');
  });
});

// Allowlist is optional: enabling with an empty allowStaffIds now saves (200) and drives the
// worker, instead of the old 400 allowlist_required (the legacy gate matched the generic im route).
// Note: dingtalk deps' restartProcess/stopProcess take NO id arg, unlike deps.im.
describe('POST /api/dingtalk/config allowlist optional', () => {
  const fakeReq = (bodyStr) => ({
    on(ev, cb) { if (ev === 'data' && bodyStr) cb(Buffer.from(bodyStr)); if (ev === 'end') cb(); return this; },
  });
  function call(route, body, deps) {
    let status = 0, payload = '';
    let resolveEnd; const done = new Promise((r) => { resolveEnd = r; });
    const res = { writeHead(s) { status = s; }, end(b) { payload = b || ''; resolveEnd(); } };
    route.handler(fakeReq(JSON.stringify(body)), res, { pathname: '/api/dingtalk/config' }, /* isLocal */ true, deps);
    return done.then(() => ({ status, json: () => JSON.parse(payload) }));
  }

  it('enabled:true with empty allowStaffIds → 200 and drives restartProcess', async () => {
    const { dingtalkRoutes } = await import('../packages/app/server/routes/dingtalk.js');
    const route = dingtalkRoutes.find((r) => r.path === '/api/dingtalk/config' && r.method === 'POST');
    const calls = [];
    const deps = { MAX_POST_BODY: 1e6, dingtalk: { isWorker: false, restartProcess: async () => calls.push('restart'), stopProcess: async () => calls.push('stop') } };
    const r = await call(route, { enabled: true, appKey: 'a', appSecret: 'b', allowStaffIds: [] }, deps);
    assert.equal(r.status, 200);
    assert.equal(r.json().connection.running, true);
    assert.deepEqual(calls, ['restart']);
  });

  it('invalid JSON body → 400 Invalid JSON (dingtalk.js:62-65)', async () => {
    const { dingtalkRoutes } = await import('../packages/app/server/routes/dingtalk.js');
    const route = dingtalkRoutes.find((r) => r.path === '/api/dingtalk/config' && r.method === 'POST');
    let status = 0, payload = '';
    let resolveEnd; const done = new Promise((r) => { resolveEnd = r; });
    const res = { writeHead(s) { status = s; }, end(b) { payload = b || ''; resolveEnd(); } };
    const deps = { MAX_POST_BODY: 1e6, dingtalk: { restartProcess: async () => {}, stopProcess: async () => {} } };
    route.handler(fakeReq('{not valid json'), res, { pathname: '/api/dingtalk/config' }, /* isLocal */ true, deps);
    await done;
    assert.equal(status, 400);
    assert.match(payload, /Invalid JSON/);
  });

  it('process apply error is swallowed → still 200 (dingtalk.js:91-92)', async () => {
    // restartProcess 抛错时 catch 记日志但不影响响应：仍回 200 + connection。
    const { dingtalkRoutes } = await import('../packages/app/server/routes/dingtalk.js');
    const route = dingtalkRoutes.find((r) => r.path === '/api/dingtalk/config' && r.method === 'POST');
    const deps = { MAX_POST_BODY: 1e6, dingtalk: { restartProcess: async () => { throw new Error('apply-boom'); }, stopProcess: async () => {} } };
    const r = await call(route, { enabled: true, appKey: 'a', appSecret: 'b', allowStaffIds: ['s1'] }, deps);
    assert.equal(r.status, 200, 'config save responds 200 even if worker apply throws');
    assert.equal(r.json().connection.running, true);
  });
});

// POST /api/dingtalk/test —— loopback gate + 缺凭据短路（不触网络）
describe('POST /api/dingtalk/test branches', () => {
  it('remote caller → 403 Loopback only before reading body (dingtalk.js:100-103)', async () => {
    const { dingtalkRoutes } = await import('../packages/app/server/routes/dingtalk.js');
    const route = dingtalkRoutes.find((r) => r.path === '/api/dingtalk/test' && r.method === 'POST');
    let status = 0, payload = '';
    const res = { writeHead(s) { status = s; }, end(b) { payload = b || ''; } };
    let tested = false;
    const deps = { MAX_POST_BODY: 1e6, dingtalk: { testConnection: async () => { tested = true; return { ok: true }; } } };
    route.handler({ on() {} }, res, { pathname: '/api/dingtalk/test' }, /* isLocal */ false, deps);
    assert.equal(status, 403);
    assert.match(payload, /Loopback only/);
    assert.equal(tested, false, 'must not call testConnection for a remote caller');
  });

  it('missing appKey/appSecret (none stored) → 200 { ok:false } without touching the network (dingtalk.js:114-117)', async () => {
    const { dingtalkRoutes } = await import('../packages/app/server/routes/dingtalk.js');
    const { saveDingTalkConfig } = await import('../packages/app/server/lib/im/dingtalk-config.js');
    // 清掉已存配置，确保 stored.appKey/appSecret 也为空 → 命中缺凭据短路。
    saveDingTalkConfig({ enabled: false, appKey: '', appSecret: '', allowStaffIds: [] });
    const route = dingtalkRoutes.find((r) => r.path === '/api/dingtalk/test' && r.method === 'POST');
    let status = 0, payload = '';
    let resolveEnd; const done = new Promise((r) => { resolveEnd = r; });
    const res = { writeHead(s) { status = s; }, end(b) { payload = b || ''; resolveEnd(); } };
    let tested = false;
    const fakeReq = (bodyStr) => ({ on(ev, cb) { if (ev === 'data' && bodyStr) cb(Buffer.from(bodyStr)); if (ev === 'end') cb(); return this; } });
    const deps = { MAX_POST_BODY: 1e6, dingtalk: { testConnection: async () => { tested = true; return { ok: true }; } } };
    route.handler(fakeReq(JSON.stringify({ appKey: '', appSecret: '' })), res, { pathname: '/api/dingtalk/test' }, /* isLocal */ true, deps);
    await done;
    assert.equal(status, 200);
    const d = JSON.parse(payload);
    assert.equal(d.ok, false);
    assert.match(d.detail, /missing appKey\/appSecret/);
    assert.equal(tested, false, 'must short-circuit before calling testConnection');
  });
});
