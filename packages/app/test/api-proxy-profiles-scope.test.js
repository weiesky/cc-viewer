/**
 * GET/POST /api/proxy-profiles session scope: GET ?instanceKey= resolves a bound
 * session's own main/roles; POST scope:'session' writes ONLY the in-memory session
 * binding (never the workspace file / global default); POST scope:'global' sets the
 * global default. Session-scope SSE frames go only to that instance's clients.
 *
 * Env isolated before dynamic imports (PROFILE_PATH = LOG_DIR/profile.json).
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-pscope-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

const PROFILE_PATH = join(tmpDir, 'profile.json');
const KEY_A = 'ccv-aaaa1111';
const KEY_B = 'ccv-bbbb2222';

const maskApiKey = (k) => (k && typeof k === 'string' && k.length > 4 ? '****' + k.slice(-4) : k ? '****' : '');
const maskProfiles = (data) => (data && Array.isArray(data.profiles)
  ? { ...data, profiles: data.profiles.map((p) => (p.apiKey ? { ...p, apiKey: maskApiKey(p.apiKey) } : p)) }
  : data);

const PROFILES = [
  { id: 'max', name: 'Default' },
  { id: 'gA', name: 'GlobalA', baseURL: 'https://global-a.example.com', apiKey: 'sk-ga' },
  { id: 'sB', name: 'SessB', baseURL: 'https://sess-b.example.com', apiKey: 'sk-sb' },
];

let getRoute;
let postRoute;
let registry;
let interceptor;

function mkRes() {
  return { statusCode: null, body: '', writeHead(code) { this.statusCode = code; }, end(b) { this.body = b || ''; } };
}
function mkReq(body) {
  const req = new EventEmitter();
  process.nextTick(() => { req.emit('data', Buffer.from(body)); req.emit('end'); });
  return req;
}
function parsedUrl(query = {}) {
  return { pathname: '/api/proxy-profiles', searchParams: new URLSearchParams(query) };
}
function mkDeps() {
  const sent = [];
  return {
    maskProfiles, maskApiKey,
    defaultProxyProfiles: { profiles: [{ id: 'max', name: 'Default' }] },
    clients: [],
    MAX_POST_BODY: 1024 * 1024,
    isMasked: (k) => typeof k === 'string' && k.startsWith('****'),
    __sent: sent,
  };
}

before(async () => {
  registry = await import('../server/lib/proxy-session-registry.js');
  interceptor = await import('../server/interceptor.js');
  const { preferencesRoutes } = await import('../server/routes/preferences.js');
  getRoute = preferencesRoutes.find((r) => r.path === '/api/proxy-profiles' && r.method === 'GET').handler;
  postRoute = preferencesRoutes.find((r) => r.path === '/api/proxy-profiles' && r.method === 'POST').handler;
});

after(() => { rmSync(tmpDir, { recursive: true, force: true }); });
beforeEach(() => {
  registry.__resetSessionProxyProfilesForTests();
  writeFileSync(PROFILE_PATH, JSON.stringify({ active: 'gA', profiles: PROFILES }));
  interceptor._loadProxyProfile(); // refresh _activeProfile/_globalDefaultId from the rewritten file
});

describe('GET /api/proxy-profiles?instanceKey=', () => {
  it('no instanceKey → global view, sessionScoped=false', () => {
    const res = mkRes();
    getRoute({}, res, parsedUrl(), true, mkDeps());
    const d = JSON.parse(res.body);
    assert.equal(d.active, 'gA');
    assert.equal(d.sessionScoped, false);
    assert.equal(d.globalActive, 'gA');
  });

  it('a bound session resolves its own main/roles with sessionScoped=true', () => {
    registry.setSessionProxyProfile(KEY_A, { main: 'sB', roles: { subagent: 'max', teammate: 'follow' } });
    const res = mkRes();
    getRoute({}, res, parsedUrl({ instanceKey: KEY_A }), true, mkDeps());
    const d = JSON.parse(res.body);
    assert.equal(d.active, 'sB');
    assert.equal(d.sessionScoped, true);
    assert.equal(d.instanceKey, KEY_A);
    assert.equal(d.globalActive, 'gA', 'global default still reported');
    assert.equal(d.roles.subagent, 'max');
  });

  it('an unbound / dangling session falls back to the global view', () => {
    registry.setSessionProxyProfile(KEY_A, { main: 'ghost' }); // not in list
    const res = mkRes();
    getRoute({}, res, parsedUrl({ instanceKey: KEY_A }), true, mkDeps());
    const d = JSON.parse(res.body);
    assert.equal(d.active, 'gA', 'dangling binding must not surface');
    assert.equal(d.sessionScoped, false);
  });

  it('a session explicitly on max reports max, not the global', () => {
    registry.setSessionProxyProfile(KEY_A, { main: 'max' });
    const res = mkRes();
    getRoute({}, res, parsedUrl({ instanceKey: KEY_A }), true, mkDeps());
    assert.equal(JSON.parse(res.body).active, 'max');
  });
});

describe('POST /api/proxy-profiles scope', () => {
  function profileFileActive() {
    return JSON.parse(readFileSync(PROFILE_PATH, 'utf8')).active;
  }

  it("scope:'session' writes ONLY the session binding, leaving profile.json.active and the global untouched", async () => {
    const deps = mkDeps();
    const res = mkRes();
    postRoute(mkReq(JSON.stringify({ scope: 'session', instanceKey: KEY_A, active: 'sB', profiles: PROFILES })), res, parsedUrl(), true, deps);
    await new Promise((r) => setImmediate(r));
    assert.equal(res.statusCode, 200);
    assert.equal(registry.getSessionProxy(KEY_A)?.main, 'sB');
    assert.equal(profileFileActive(), 'gA', 'session scope must NOT touch the global default');
  });

  it("scope:'session' rejects a missing/invalid instanceKey or an unknown profile", async () => {
    for (const body of [
      { scope: 'session', instanceKey: 'bad', active: 'sB', profiles: PROFILES },
      { scope: 'session', instanceKey: KEY_A, active: 'ghost', profiles: PROFILES },
      { scope: 'session', instanceKey: KEY_A, profiles: PROFILES }, // neither active nor roles
    ]) {
      const res = mkRes();
      postRoute(mkReq(JSON.stringify(body)), res, parsedUrl(), true, mkDeps());
      await new Promise((r) => setImmediate(r));
      assert.equal(res.statusCode, 400, `expected 400 for ${JSON.stringify(body)}`);
    }
  });

  it("scope:'session' roles-only merges per-key (does not clobber the session main)", async () => {
    registry.setSessionProxyProfile(KEY_A, { main: 'sB', roles: { subagent: 'follow', teammate: 'follow' } });
    const res = mkRes();
    postRoute(mkReq(JSON.stringify({ scope: 'session', instanceKey: KEY_A, profiles: PROFILES, roles: { subagent: 'max' } })), res, parsedUrl(), true, mkDeps());
    await new Promise((r) => setImmediate(r));
    assert.equal(res.statusCode, 200);
    const b = registry.getSessionProxy(KEY_A);
    assert.equal(b.main, 'sB', 'main preserved on a roles-only change');
    assert.equal(b.roles.subagent, 'max', 'role applied');
    assert.equal(b.roles.teammate, 'follow', 'unsubmitted role preserved');
  });

  it("scope:'global' sets the global default without touching session bindings", async () => {
    registry.setSessionProxyProfile(KEY_A, { main: 'sB' });
    const res = mkRes();
    postRoute(mkReq(JSON.stringify({ scope: 'global', active: 'gA', profiles: PROFILES })), res, parsedUrl(), true, mkDeps());
    await new Promise((r) => setImmediate(r));
    assert.equal(res.statusCode, 200);
    assert.equal(registry.getSessionProxy(KEY_A)?.main, 'sB', 'global write must not clobber the session binding');
  });

  it('legacy POST (no scope) behaves as before (workspace/global write, no session binding)', async () => {
    const res = mkRes();
    postRoute(mkReq(JSON.stringify({ active: 'sB', profiles: PROFILES })), res, parsedUrl(), true, mkDeps());
    await new Promise((r) => setImmediate(r));
    assert.equal(res.statusCode, 200);
    assert.equal(registry.getSessionProxy(KEY_A), undefined, 'legacy write creates no session binding');
  });

  it('session-scope SSE goes only to clients stamped with that instance', async () => {
    const deps = mkDeps();
    const sent = [];
    const realSend = (clients, event, data) => { sent.push({ event, data, count: clients.length }); };
    // monkey-patch via deps is not wired; assert via the exported path: the route uses
    // filterClientsByInstance(deps.clients, sessionKey). We emulate by stamping clients.
    const clientA = { _ccvViewInstance: KEY_A };
    const clientB = { _ccvViewInstance: KEY_B };
    const clientUnstamped = {};
    deps.clients = [clientA, clientB, clientUnstamped];
    // We cannot intercept sendEventToClients without DI; instead assert the filter directly
    // (the same function the route calls) to lock the recipient set.
    const { filterClientsByInstance } = await import('../server/lib/v2/view-router.js');
    const targets = filterClientsByInstance(deps.clients, KEY_A);
    assert.ok(targets.includes(clientA), 'same instance receives');
    assert.ok(targets.includes(clientUnstamped), 'unstamped receives');
    assert.ok(!targets.includes(clientB), 'a different instance is excluded');
    void realSend; void sent;
  });
});
