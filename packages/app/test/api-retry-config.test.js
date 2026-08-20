// Route tests for GET/POST /api/retry-config — the local-only gate, the
// validation/normalization path, the 0o600 config write, the live-binding
// refresh, and the SSE retry_config broadcast.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Isolate LOG_DIR (RETRY_CONFIG_PATH = join(LOG_DIR, 'retry-config.json')) before any interceptor-loading import.
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-retry-config-test-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

const RETRY_CONFIG_PATH = join(tmpDir, 'retry-config.json');

function mkReq(body) {
  const handlers = {};
  return {
    on(ev, fn) {
      handlers[ev] = fn;
      if (ev === 'end') {
        if (body && handlers.data) handlers.data(Buffer.from(body));
        handlers.end();
      }
      return this;
    },
    destroy() {},
  };
}

function mkRes() {
  let status = 0;
  let payload = '';
  return {
    writeHead(s) { status = s; },
    end(b) { payload = b || ''; },
    get status() { return status; },
    get payload() { return payload; },
  };
}

function mkSseClient() {
  return { writable: true, destroyed: false, written: '', write(p) { this.written += p; return true; } };
}

let getRoute; let postRoute;
before(async () => {
  const { preferencesRoutes } = await import('../server/routes/preferences.js');
  getRoute = preferencesRoutes.find((r) => r.path === '/api/retry-config' && r.method === 'GET');
  postRoute = preferencesRoutes.find((r) => r.path === '/api/retry-config' && r.method === 'POST');
  assert.ok(getRoute, 'GET /api/retry-config route must exist');
  assert.ok(postRoute, 'POST /api/retry-config route must exist');
});
after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

describe('POST /api/retry-config', { concurrency: false }, () => {
  it('rejects a non-local caller with 403 and writes nothing', () => {
    const res = mkRes();
    postRoute.handler(mkReq(JSON.stringify({ config: { mode: 'race', maxConcurrent: 10 } })), res, {}, /* isLocal */ false, { MAX_POST_BODY: 1e6, clients: [] });
    assert.equal(res.status, 403);
    const data = JSON.parse(res.payload);
    assert.equal(data.ok, false);
    assert.match(data.error, /local-only/);
    assert.equal(existsSync(RETRY_CONFIG_PATH), false, 'a rejected save must not touch retry-config.json');
  });

  it('rejects a body without a config object (400)', () => {
    const res = mkRes();
    postRoute.handler(mkReq(JSON.stringify({ mode: 'race' })), res, {}, true, { MAX_POST_BODY: 1e6, clients: [] });
    assert.equal(res.status, 400);
  });

  it('writes a validated full config at 0o600, refreshes the live binding, and broadcasts SSE', async () => {
    const sse = mkSseClient();
    const res = mkRes();
    postRoute.handler(
      mkReq(JSON.stringify({ config: { mode: 'serial', maxRetries: 3, retryIntervalMs: 250, bogusField: 'dropped', maxConcurrent: 'not-a-number' } })),
      res, {}, true, { MAX_POST_BODY: 1e6, clients: [sse] },
    );
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.payload).ok, true);

    const written = JSON.parse(readFileSync(RETRY_CONFIG_PATH, 'utf-8'));
    assert.equal(written.mode, 'serial');
    assert.equal(written.maxRetries, 3);
    assert.equal(written.retryIntervalMs, 250);
    assert.equal('bogusField' in written, false, 'unknown fields must be dropped by validation');
    assert.ok(written.maxConcurrent >= 1, 'invalid field falls back to the default, keeping the file complete');
    if (process.platform !== 'win32') {
      assert.equal(statSync(RETRY_CONFIG_PATH).mode & 0o777, 0o600);
    }

    assert.match(sse.written, /event: retry_config/, 'save must broadcast retry_config');
    assert.match(sse.written, /"mode":"serial"/, 'broadcast carries the refreshed live-binding config');

    // Live binding refreshed without waiting for the 1.5s watchFile poll
    const getRes = mkRes();
    getRoute.handler({}, getRes, {}, true, {});
    const got = JSON.parse(getRes.payload);
    assert.equal(got.config.mode, 'serial');
    assert.equal(got.config.maxRetries, 3);
    assert.ok(got.defaults && got.defaults.mode === 'off', 'GET carries the code defaults for the reset button');
  });
});
