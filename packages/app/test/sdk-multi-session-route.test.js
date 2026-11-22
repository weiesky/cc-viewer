/**
 * SDK-mode same-cwd SIBLING sessions — route level (workspaces launch + live-processes),
 * 2026-11. The SDK launch branch (workspaces.js `deps.isSdkMode`) previously had NO route
 * coverage; this suite drives POST /api/workspaces/launch with CCV_SDK_MODE=1 and asserts:
 *  - a forceNew launch APPENDS a fresh random-key sibling (it does NOT close or replace the
 *    existing same-cwd session) and returns the new instanceKey;
 *  - no writer retirement happens on a launch (the old sibling stays live);
 *  - a plain launch reuses/activates the cwd's primary (no sibling spawned);
 *  - GET /api/live-processes lists BOTH same-cwd SDK sessions (no cwd-collapse) and reports
 *    currentInstanceKey as the STABLE primary (deterministic boot key), not the shared active.
 *
 * Fake query via sdk.__setQueryForTests. Isolated CCV_LOG_DIR; CCV_PROXY_PORT stays UNSET so
 * the launch path skips the PTY spawn.
 */
import { describe, it, after, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { resolve as pathResolve } from 'node:path';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-sdk-multisession-route-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';
process.env.CCV_SDK_MODE = '1';
delete process.env.CCV_PROXY_PORT;       // skip the PTY spawn branch
delete process.env.CCV_ELECTRON_MULTITAB; // exercise the in-process SDK branch
delete process.env.CCV_CLAUDE_CONTINUE;

const wsDir = join(tmpDir, 'sibling-project');
mkdirSync(wsDir, { recursive: true });
const bootKey = `ccv-${createHash('sha256').update(pathResolve(wsDir)).digest('hex').slice(0, 32)}`;

const { workspacesRoutes } = await import('../server/routes/workspaces.js');
const { resumeRoutes } = await import('../server/routes/resume.js');
const sdk = await import('../server/lib/sdk-manager.js');

function route(routes, method, path) {
  const r = routes.find((x) => x.method === method && x.path === path);
  assert.ok(r, `route ${method} ${path} must exist`);
  return r.handler;
}

function makeClient() { const writes = []; return { write: (s) => { writes.push(s); return true; }, _writes: writes }; }

function callRoute(handler, { body, query = '' } = {}, deps) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    let status = 0;
    const res = { writeHead(c) { status = c; }, end(b) { resolve({ status, data: JSON.parse(b || '{}') }); } };
    const parsed = new URL(`http://x${query ? `?${query}` : ''}`);
    handler(req, res, Object.assign(parsed, { pathname: parsed.pathname }), true, deps);
    if (body !== undefined) { req.emit('data', typeof body === 'string' ? body : JSON.stringify(body)); }
    req.emit('end');
  });
}

function baseDeps(overrides = {}) {
  return {
    MAX_POST_BODY: 1024 * 1024,
    isWorkspaceMode: true,
    isSdkMode: true,
    workspaceLaunched: false,
    clients: [],
    startLogWatch() {}, stopLogWatch() {},
    statsWorker: {}, startStatsWorker() {}, startStreamingStatusTimer() {},
    setWorkspaceLaunched() {},
    workspaceClaudeArgs: [],
    clearScopeRuntimeFor() {},
    ...overrides,
  };
}

/** Minimal resident fake query (no real SDK child). */
function makeQuery() {
  return ({ prompt, options }) => {
    const q = (async function* () {
      yield { type: 'system', subtype: 'init', session_id: `s-${Math.random().toString(36).slice(2)}`, model: 'm', slash_commands: [] };
      for await (const item of prompt) { if (item && item.type === 'user') yield { type: 'result', subtype: 'success', session_id: 's', is_error: false, result: 'ok' }; }
    })();
    q.close = () => { q._closed = true; };
    q.interrupt = () => Promise.resolve();
    return q;
  };
}

before(() => { sdk.__setQueryForTests(makeQuery()); });
after(() => { try { sdk.stopSession(); } catch {} try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });
afterEach(() => { sdk.stopSession(); });

describe('SDK same-cwd sibling sessions — launch + live-processes routes', () => {
  it('a forceNew launch APPENDS a sibling (old session stays live), returns the new instanceKey, and does NOT retire', async () => {
    // Boot the cwd's primary session AND bind the server to this cwd (the "current root").
    const prevDir = process.env.CCV_PROJECT_DIR;
    process.env.CCV_PROJECT_DIR = wsDir;
    sdk.initSdkSession(wsDir, basename(wsDir), { permissionMode: 'default', env: { ...process.env } });
    assert.ok(sdk.listSdkSessions().find((s) => s.instanceKey === bootKey), 'boot session registered');

    const client = makeClient();
    const { status, data } = await callRoute(route(workspacesRoutes, 'POST', '/api/workspaces/launch'), { body: { path: wsDir, extraArgs: [], forceNew: true } }, baseDeps({ clients: [client] }));
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.ok(data.instanceKey, 'launch returns the fresh instanceKey for the client pin');
    assert.notEqual(data.instanceKey, bootKey, 'the fresh key differs from the deterministic boot key');

    // The old sibling survives — two sessions coexist for the cwd.
    const keys = sdk.listSdkSessions().filter((s) => s.cwd === wsDir).map((s) => s.instanceKey);
    assert.equal(keys.length, 2, 'TWO same-cwd sessions coexist after the +1');
    assert.ok(keys.includes(bootKey), 'the boot session is still registered (not replaced)');
    // The fresh sibling is the active one and is marked freshLaunch.
    const fresh = sdk.listSdkSessions().find((s) => s.instanceKey === data.instanceKey);
    assert.equal(fresh.active, true, 'the new sibling becomes active');
    assert.equal(fresh.freshLaunch, true, 'the new sibling is marked freshLaunch (empty view)');
    // The +1 must NOT retire the surviving sibling's writer routing.
    const { _v2Writer } = await import('../server/interceptor.js');
    assert.equal(_v2Writer._retiredInstances.has(bootKey), false, 'the surviving boot sibling is NOT retired by the launch');
    assert.equal(_v2Writer._retiredInstances.has(data.instanceKey), false, 'the new sibling is not retired either');
    // The sibling launch broadcast is tagged sibling:true and carries NO empty reload frames.
    const frames = client._writes.join('');
    assert.match(frames, /event: workspace_started/, 'workspace_started broadcast');
    assert.match(frames, /"sibling":true/, 'marked as a sibling launch');
    assert.ok(!/event: load_start/.test(frames), 'no global load_start (would blank the live sibling)');
    // The boot session remains resolvable (it was NOT closed). NOTE: attach switches active,
    // so this probe runs LAST (after the active assertion above).
    assert.equal(sdk.attachSdkSession({ instanceKey: bootKey }).ok, true, 'boot sibling still resolvable');
    // Restore the bound dir so later cases aren't pinned to this cwd.
    if (prevDir === undefined) delete process.env.CCV_PROJECT_DIR; else process.env.CCV_PROJECT_DIR = prevDir;
  });

  it('a plain (non-forceNew) launch reuses the cwd primary — no sibling is spawned', async () => {
    sdk.initSdkSession(wsDir, basename(wsDir), { permissionMode: 'default', env: { ...process.env } });
    const { status, data } = await callRoute(route(workspacesRoutes, 'POST', '/api/workspaces/launch'), { body: { path: wsDir, extraArgs: [] } }, baseDeps());
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    // No forceNew → no instanceKey pin (the legacy bound-channel replay path).
    assert.equal(data.instanceKey, undefined, 'a plain launch does not pin a fresh instance');
    const keys = sdk.listSdkSessions().filter((s) => s.cwd === wsDir).map((s) => s.instanceKey);
    assert.deepEqual(keys, [bootKey], 'still exactly the boot session — no sibling spawned');
  });

  it('GET /api/live-processes lists BOTH same-cwd SDK sessions and reports the STABLE primary as currentInstanceKey', async () => {
    sdk.initSdkSession(wsDir, basename(wsDir), { permissionMode: 'default', env: { ...process.env } });
    const r = sdk.createSdkSession(wsDir, { permissionMode: 'default', env: { ...process.env } }); // fresh sibling, becomes active
    process.env.CCV_PROJECT_DIR = wsDir;
    const { status, data } = await callRoute(route(resumeRoutes, 'GET', '/api/live-processes'), {}, baseDeps());
    assert.equal(status, 200);
    const rows = (data.processes || []).filter((p) => p && p.cwd === wsDir);
    assert.equal(rows.length, 2, 'both same-cwd SDK sessions surface as tabs (no cwd-collapse)');
    const keys = rows.map((p) => p.instanceKey).sort();
    assert.deepEqual(keys, [bootKey, r.instanceKey].sort(), 'both instanceKeys are listed');
    // currentInstanceKey is the STABLE primary (the deterministic boot key), NOT the shared
    // active pointer — keying the bound tab to active would yank every bound-view client to
    // whatever instance spoke last.
    assert.equal(data.currentInstanceKey, bootKey, 'bound identity = stable primary, not the active sibling');
  });

  it('currentInstanceKey falls to the NEWEST fresh sibling once the boot session is closed (delegates to the resolver)', async () => {
    sdk.initSdkSession(wsDir, basename(wsDir), { permissionMode: 'default', env: { ...process.env } });
    const older = sdk.createSdkSession(wsDir, { permissionMode: 'default', env: { ...process.env } });
    const newer = sdk.createSdkSession(wsDir, { permissionMode: 'default', env: { ...process.env } });
    // Close the deterministic boot session, leaving only the two fresh siblings.
    sdk.closeSdkSession({ instanceKey: bootKey });
    process.env.CCV_PROJECT_DIR = wsDir;
    const { status, data } = await callRoute(route(resumeRoutes, 'GET', '/api/live-processes'), {}, baseDeps());
    assert.equal(status, 200);
    // Pin the delegation end-to-end: the route must NOT fall back to the OLDEST fresh row
    // (the pre-refactor inline `rows[0]`), but to the resolver's NEWEST same-cwd sibling.
    assert.equal(data.currentInstanceKey, newer.instanceKey, 'route delegates to the resolver (newest), not the old inline rows[0]');
    assert.notEqual(newer.instanceKey, older.instanceKey, 'the two fresh siblings are distinct');
  });

  it('closing a fresh sibling routes a retire (wasFreshKey:true); closing the boot routes a release (wasFreshKey:false)', async () => {
    const { _v2Writer } = await import('../server/interceptor.js');
    sdk.initSdkSession(wsDir, basename(wsDir), { permissionMode: 'default', env: { ...process.env } });
    const r = sdk.createSdkSession(wsDir, { permissionMode: 'default', env: { ...process.env } });
    // Close the fresh sibling by instanceKey → its RANDOM key is retired.
    const closeHandler = route(resumeRoutes, 'POST', '/api/live-processes/close');
    const c1 = await callRoute(closeHandler, { body: { project: basename(wsDir), instanceKey: r.instanceKey } }, baseDeps());
    assert.equal(c1.status, 200);
    assert.equal(c1.data.ok, true, 'closing the fresh sibling succeeds');
    assert.equal(c1.data.instanceKey, r.instanceKey, 'the close response names the closed instance');
    assert.equal(sdk.listSdkSessions().find((s) => s.instanceKey === r.instanceKey), undefined, 'the fresh sibling is gone');
    assert.ok(sdk.listSdkSessions().find((s) => s.instanceKey === bootKey), 'the boot sibling survives');
    // Writer-side: the fresh (random) key IS retired; the boot (deterministic) key is NOT.
    assert.equal(_v2Writer._retiredInstances.has(r.instanceKey), true, 'fresh random key retired on close');
    assert.equal(_v2Writer._retiredInstances.has(bootKey), false, 'boot deterministic key NOT retired (release only)');

    // Close the boot (deterministic) session — must NOT be retired (release only).
    const c2 = await callRoute(closeHandler, { body: { project: basename(wsDir), instanceKey: bootKey } }, baseDeps());
    assert.equal(c2.status, 200);
    assert.equal(sdk.listSdkSessions().filter((s) => s.cwd === wsDir).length, 0, 'registry empty after both closed');
    assert.equal(_v2Writer._retiredInstances.has(bootKey), false, 'the boot key is STILL not retired after its own close (release, not retire)');
  });
});
