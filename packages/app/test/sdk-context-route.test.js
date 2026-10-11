/**
 * GET /api/sdk-context-usage (server/routes/sdk-context.js).
 *
 * The handler dynamic-imports sdk-manager (same module instance as the static import here
 * — Node ESM caches by resolved URL; the seam is proven live by resume-route.test.js).
 * Covers: session-inactive (no turn run) / ok:true (snapshot shape) / control-failed.
 * The handler's 500 branch is a defensive catch-all (unreachable through the query fake —
 * fetchContextUsage self-catches), so it is not unit-tested here.
 */
import { describe, it, after } from 'node:test';
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

const handler = sdkContextRoutes.find((r) => r.method === 'GET' && r.path === '/api/sdk-context-usage').handler;

function callRoute() {
  return new Promise((resolve) => {
    let status = 0; let payload = '';
    const res = { writeHead(c) { status = c; }, end(b) { payload = b || ''; resolve({ status, body: JSON.parse(payload || '{}') }); } };
    handler({}, res);
  });
}

const USAGE = {
  categories: [{ name: 'System prompt', tokens: 1200, color: '#8884d8' }],
  totalTokens: 1200, maxTokens: 200000, rawMaxTokens: 200000,
  percentage: 0.6, gridRows: [], model: 'claude-opus-4-test',
  memoryFiles: [], mcpTools: [], agents: [], isAutoCompactEnabled: true,
  apiUsage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
};

function makeCtxQuery(usageSpec) {
  return function fakeQuery({ prompt }) {
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: 'system', subtype: 'init', session_id: 'sess-ctx', model: 'm', tools: [] };
        for await (const msg of prompt) { yield { type: 'result', subtype: 'success' }; }
      },
      async getContextUsage() {
        if (usageSpec && usageSpec.reject) return Promise.reject(usageSpec.reject);
        return Promise.resolve(usageSpec && 'resolve' in usageSpec ? usageSpec.resolve : usageSpec);
      },
      interrupt() { return Promise.resolve(); },
      close() { },
    };
  };
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
});
