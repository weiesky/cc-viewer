/**
 * GET /api/sdk-context-usage (server/routes/sdk-context.js).
 *
 * The handler dynamic-imports sdk-manager (same module instance as the static import here
 * — Node ESM caches by resolved URL; the seam is proven live by resume-route.test.js).
 * Covers: session-inactive (no turn run) / ok:true (snapshot shape) / control-failed.
 * The handler's 500 branch is a defensive catch-all (unreachable through the query fake —
 * fetchContextUsage self-catches), so it is not unit-tested here.
 */
import { describe, it, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Isolate LOG_DIR before importing anything that loads findcc/interceptor.
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-sdk-ctx-route-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_SDK_MODE = '1';

const { sdkContextRoutes } = await import('../server/routes/sdk-context.js');
const sdk = await import('../server/lib/sdk-manager.js');

after(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });
afterEach(() => { sdk.stopSession(); });

const handler = sdkContextRoutes.find((r) => r.method === 'GET' && r.path === '/api/sdk-context-usage').handler;

function callRoute(parsedUrl) {
  return new Promise((resolve) => {
    let status = 0; let payload = '';
    const res = { writeHead(c) { status = c; }, end(b) { payload = b || ''; resolve({ status, body: JSON.parse(payload || '{}') }); } };
    handler({}, res, parsedUrl);
  });
}

function routeUrl(params = {}) {
  const u = new URL('http://127.0.0.1/api/sdk-context-usage');
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u;
}

const USAGE = {
  categories: [{ name: 'System prompt', tokens: 1200, color: '#8884d8' }],
  totalTokens: 1200, maxTokens: 200000, rawMaxTokens: 200000,
  percentage: 0.6, gridRows: [], model: 'claude-opus-4-test',
  memoryFiles: [], mcpTools: [], agents: [], isAutoCompactEnabled: true,
  apiUsage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
};

function makeCtxQuery(usageSpec) {
  return function fakeQuery({ prompt, options }) {
    // A function spec may vary the returned usage per cwd (multi-session route anchors).
    const spec = typeof usageSpec === 'function' ? usageSpec(options.cwd) : usageSpec;
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: 'system', subtype: 'init', session_id: `sess-${options.cwd}`, model: 'm', tools: [] };
        for await (const msg of prompt) { yield { type: 'result', subtype: 'success' }; }
      },
      async getContextUsage() {
        if (spec && spec.reject) return Promise.reject(spec.reject);
        return Promise.resolve(spec && 'resolve' in spec ? spec.resolve : spec);
      },
      interrupt() { return Promise.resolve(); },
      close() { },
    };
  };
}

// Multi-session fixtures for anchor tests. Distinct cwds give distinct totals so a wrong
// resolution is observable; twin dirs share the basename "same".
const ALPHA = join(tmpDir, 'alpha');
const BETA = join(tmpDir, 'beta');
const TWIN_A = join(tmpDir, 'twin-a', 'same');
const TWIN_B = join(tmpDir, 'twin-b', 'same');
const TOTALS = { [ALPHA]: 111, [BETA]: 222, [TWIN_A]: 333, [TWIN_B]: 444 };
const sessionDeps = () => ({ broadcastWs: () => {}, onTurnEnd: () => {} });

function usageForCwd(cwd) {
  return { ...USAGE, totalTokens: TOTALS[cwd] ?? -1 };
}

async function initAndTurn(cwd) {
  sdk.initSdkSession(cwd, cwd.split('/').pop(), sessionDeps());
  await sdk.sendUserMessage('hi'); // build the resident query
}

function instanceFor(cwd) {
  return sdk.listSdkSessions().find((s) => s.cwd === cwd).instanceKey;
}

describe('sdk-context route — GET /api/sdk-context-usage', () => {
  it('session-inactive:无常驻 query → 200 { ok:false, reason:session-inactive }', async () => {
    sdk.__setQueryForTests(makeCtxQuery({ resolve: USAGE }));
    // No initSdkSession / no turn → _activeQuery is null.
    sdk.stopSession();
    const r = await callRoute();
    assert.equal(r.status, 200, 'inactive is a normal state, not an HTTP error');
    assert.equal(r.body.ok, false);
    assert.equal(r.body.reason, 'session-inactive');
  });

  it('ok:true:常驻 query 存活 → 200 { ok:true, snapshot } 形状', async () => {
    sdk.__setQueryForTests(makeCtxQuery({ resolve: USAGE }));
    sdk.initSdkSession(tmpDir, 'proj', { broadcastWs: () => {}, onTurnEnd: () => {} });
    await sdk.sendUserMessage('hello'); // build the resident query
    const r = await callRoute();
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.snapshot.type, 'sdk-context-usage');
    assert.equal(r.body.snapshot.trigger, 'request');
    assert.deepEqual(r.body.snapshot.usage, USAGE, 'usage passed through losslessly');
    assert.equal(typeof r.body.snapshot.ts, 'number');
    sdk.stopSession();
  });

  it('control-failed:getContextUsage reject → 200 { ok:false, reason:control-failed }', async () => {
    sdk.__setQueryForTests(makeCtxQuery({ reject: new Error('control boom') }));
    sdk.initSdkSession(tmpDir, 'proj', { broadcastWs: () => {}, onTurnEnd: () => {} });
    await sdk.sendUserMessage('hello');
    const r = await callRoute();
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.reason, 'control-failed');
    sdk.stopSession();
  });

  it('no params → active session fallback (last initialized session)', async () => {
    sdk.__setQueryForTests(makeCtxQuery((cwd) => ({ resolve: usageForCwd(cwd) })));
    await initAndTurn(ALPHA);
    await initAndTurn(BETA); // active
    assert.equal(sdk.getActiveSdkCwd(), BETA);

    const r = await callRoute();
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.snapshot.usage.totalTokens, TOTALS[BETA], 'no-param pull uses the active session');
    assert.equal(sdk.getActiveSdkCwd(), BETA, 'a read never switches active');
  });

  it('project anchor resolves that workspace without switching active', async () => {
    sdk.__setQueryForTests(makeCtxQuery((cwd) => ({ resolve: usageForCwd(cwd) })));
    await initAndTurn(ALPHA);
    await initAndTurn(BETA);

    const r = await callRoute(routeUrl({ project: 'alpha' }));
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.snapshot.usage.totalTokens, TOTALS[ALPHA]);
    assert.equal(r.body.snapshot.instanceKey, instanceFor(ALPHA), 'snapshot carries its instance routing key');
    assert.equal(sdk.getActiveSdkCwd(), BETA, 'anchored read did not switch active');
  });

  it('exact instance anchor (no project) resolves that instance without switching active', async () => {
    sdk.__setQueryForTests(makeCtxQuery((cwd) => ({ resolve: usageForCwd(cwd) })));
    await initAndTurn(ALPHA);
    await initAndTurn(BETA);
    const alphaInstance = instanceFor(ALPHA);

    const r = await callRoute(routeUrl({ instance: alphaInstance }));
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.snapshot.usage.totalTokens, TOTALS[ALPHA]);
    assert.equal(r.body.snapshot.instanceKey, alphaInstance);
    assert.equal(sdk.getActiveSdkCwd(), BETA);
  });

  it('matching project+instance pair resolves; mismatched pair is session-inactive', async () => {
    sdk.__setQueryForTests(makeCtxQuery((cwd) => ({ resolve: usageForCwd(cwd) })));
    await initAndTurn(ALPHA);
    await initAndTurn(BETA);
    const alphaInstance = instanceFor(ALPHA);
    const betaInstance = instanceFor(BETA);

    const good = await callRoute(routeUrl({ project: 'alpha', instance: alphaInstance }));
    assert.equal(good.status, 200);
    assert.equal(good.body.ok, true);
    assert.equal(good.body.snapshot.usage.totalTokens, TOTALS[ALPHA]);

    // Instance priority must not let beta's instance win when the viewer named alpha.
    const mismatch = await callRoute(routeUrl({ project: 'alpha', instance: betaInstance }));
    assert.equal(mismatch.status, 200);
    assert.deepEqual(mismatch.body, { ok: false, reason: 'session-inactive' });
    assert.equal(sdk.getActiveSdkCwd(), BETA, 'rejected pair never falls back to active');
  });

  it('unknown project / unknown instance / ambiguous project → session-inactive, never active', async () => {
    sdk.__setQueryForTests(makeCtxQuery((cwd) => ({ resolve: usageForCwd(cwd) })));
    await initAndTurn(ALPHA);
    await initAndTurn(BETA);
    await initAndTurn(TWIN_A);
    await initAndTurn(TWIN_B); // active

    const activeCwd = sdk.getActiveSdkCwd();
    for (const params of [
      { project: 'does-not-exist' },
      { instance: 'ccv-deadbeef' },
      { project: 'same' }, // two same-basename sessions → ambiguous
    ]) {
      const r = await callRoute(routeUrl(params)); // eslint-disable-line no-await-in-loop
      assert.equal(r.status, 200);
      assert.deepEqual(r.body, { ok: false, reason: 'session-inactive' }, `anchor ${JSON.stringify(params)}`);
      assert.equal(sdk.getActiveSdkCwd(), activeCwd, 'no anchor may fall back to active'); // eslint-disable-line no-await-in-loop
    }
  });
});
