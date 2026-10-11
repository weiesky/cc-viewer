/**
 * GET /api/sdk-mcp-server-status (server/routes/sdk-mcp-status.js).
 *
 * The handler dynamic-imports sdk-manager (same module instance as the static import here
 * — Node ESM caches by resolved URL; the seam is proven live by resume-route.test.js).
 * Covers: session-inactive (no turn run) / ok:true (snapshot shape) / ok:true with an EMPTY
 * server list (the array-vs-object inversion — [] is legitimate) / control-failed.
 * The handler's 500 branch is a defensive catch-all (unreachable through the query fake —
 * fetchMcpStatus self-catches), so it is not unit-tested here.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Isolate LOG_DIR before importing anything that loads findcc/interceptor.
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-sdk-mcp-route-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_SDK_MODE = '1';

const { sdkMcpStatusRoutes } = await import('../server/routes/sdk-mcp-status.js');
const sdk = await import('../server/lib/sdk-manager.js');

after(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

const handler = sdkMcpStatusRoutes.find((r) => r.method === 'GET' && r.path === '/api/sdk-mcp-server-status').handler;

function callRoute() {
  return new Promise((resolve) => {
    let status = 0; let payload = '';
    const res = { writeHead(c) { status = c; }, end(b) { payload = b || ''; resolve({ status, body: JSON.parse(payload || '{}') }); } };
    handler({}, res);
  });
}

const SERVERS = [
  { name: 'tavily', status: 'connected', serverInfo: { name: 'tavily', version: '1.2.0' }, tools: [{ name: 'web_search' }] },
  { name: 'broken', status: 'failed', error: 'spawn ENOENT' },
];

function makeMcpQuery(spec) {
  return function fakeQuery({ prompt }) {
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: 'system', subtype: 'init', session_id: 'sess-mcp', model: 'm', tools: [] };
        for await (const msg of prompt) { yield { type: 'result', subtype: 'success' }; }
      },
      async mcpServerStatus() {
        if (spec && spec.reject) return Promise.reject(spec.reject);
        return Promise.resolve(spec && 'resolve' in spec ? spec.resolve : spec);
      },
      interrupt() { return Promise.resolve(); },
      close() { },
    };
  };
}

describe('sdk-mcp-status route — GET /api/sdk-mcp-server-status', () => {
  it('session-inactive:无常驻 query → 200 { ok:false, reason:session-inactive }', async () => {
    sdk.__setQueryForTests(makeMcpQuery({ resolve: SERVERS }));
    // No initSdkSession / no turn → _activeQuery is null.
    sdk.stopSession();
    const r = await callRoute();
    assert.equal(r.status, 200, 'inactive is a normal state, not an HTTP error');
    assert.equal(r.body.ok, false);
    assert.equal(r.body.reason, 'session-inactive');
  });

  it('ok:true:常驻 query 存活 → 200 { ok:true, snapshot } 形状,servers 无损透传', async () => {
    sdk.__setQueryForTests(makeMcpQuery({ resolve: SERVERS }));
    sdk.initSdkSession(tmpDir, 'proj', { broadcastWs: () => {}, onTurnEnd: () => {} });
    await sdk.sendUserMessage('hello'); // build the resident query
    const r = await callRoute();
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.snapshot.type, 'sdk-mcp-status');
    assert.equal(r.body.snapshot.trigger, 'request');
    assert.deepEqual(r.body.snapshot.servers, SERVERS, 'servers passed through losslessly');
    assert.equal(typeof r.body.snapshot.ts, 'number');
    sdk.stopSession();
  });

  it('ok:true with []:空数组是合法"无 MCP 服务器"结果(数组守卫反转)', async () => {
    sdk.__setQueryForTests(makeMcpQuery({ resolve: [] }));
    sdk.initSdkSession(tmpDir, 'proj', { broadcastWs: () => {}, onTurnEnd: () => {} });
    await sdk.sendUserMessage('hello');
    const r = await callRoute();
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true, 'an empty array must be ok:true, not control-failed');
    assert.deepEqual(r.body.snapshot.servers, []);
    sdk.stopSession();
  });

  it('control-failed:mcpServerStatus reject → 200 { ok:false, reason:control-failed }', async () => {
    sdk.__setQueryForTests(makeMcpQuery({ reject: new Error('control boom') }));
    sdk.initSdkSession(tmpDir, 'proj', { broadcastWs: () => {}, onTurnEnd: () => {} });
    await sdk.sendUserMessage('hello');
    const r = await callRoute();
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.reason, 'control-failed');
    sdk.stopSession();
  });
});
