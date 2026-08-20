// proxy.js server-path coverage: drives the real startProxy() request handler against a local
// upstream so the actual getOriginalBaseUrl / getBaseUrlFromSettings reads, the error-response
// branch, the streaming branch, and the catch/502 path execute (the existing proxy.test.js only
// exercises replicated copies of the pure helpers, leaving the live server lines uncovered).
//
// proxy.js calls setupInterceptor() (patches global fetch) at import — runs in this isolated file.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-proxy-server-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
// Exercise the CCV_DEBUG-gated logging branches (error-status log, catch log, pipeline-error log).
process.env.CCV_DEBUG = '1';

// A controllable upstream. Each request reads `mode` off the global to pick a behavior.
let upstream, upstreamPort, mode;
let overloadedRemaining = 0; // for mode '529-then-200'
function startUpstream() {
  return new Promise((resolve) => {
    upstream = createServer((req, res) => {
      if (mode === '529-then-200') {
        if (overloadedRemaining > 0) {
          overloadedRemaining--;
          res.writeHead(529, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'overloaded' } }));
        } else {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: 'recovered' }));
        }
      } else if (mode === 'ok-stream') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('data: hello\n\n');
        res.end('data: done\n\n');
      } else if (mode === 'error-json') {
        res.writeHead(429, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'rate limited' } }));
      } else if (mode === 'empty-200') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(); // no body → response.body null-ish path
      } else if (mode === 'no-content') {
        res.writeHead(204); // 204 → fetch gives a null body → res.end() branch
        res.end();
      } else {
        res.writeHead(200);
        res.end('plain ok');
      }
    });
    upstream.listen(0, '127.0.0.1', () => resolve());
  });
}

let proxyPort, startProxy;

function proxyReq(path, { method = 'POST', body = null } = {}) {
  return new Promise((resolve, reject) => {
    // Send an explicit content-length (like the real Claude CLI) so node does not switch the
    // inbound request to chunked transfer-encoding, which undici would reject upstream.
    const headers = {};
    if (body != null) headers['content-length'] = Buffer.byteLength(body);
    const r = request({ hostname: '127.0.0.1', port: proxyPort, path, method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

before(async () => {
  await startUpstream();
  upstreamPort = upstream.address().port;
  // Route the proxy's upstream to our local server via env (getOriginalBaseUrl reads ANTHROPIC_BASE_URL).
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${upstreamPort}`;
  ({ startProxy } = await import('../server/proxy.js'));
  proxyPort = await startProxy();
  assert.ok(proxyPort > 0);
});

after(() => {
  try { upstream?.close(); } catch { /* noop */ }
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('startProxy live forwarding', () => {
  it('forwards a streaming 200 response body to the client', async () => {
    mode = 'ok-stream';
    const res = await proxyReq('/v1/messages', { body: JSON.stringify({ model: 'claude-3' }) });
    assert.equal(res.status, 200);
    assert.match(res.body, /hello/);
    assert.match(res.body, /done/);
    // content-encoding/length stripped from the response headers
    assert.equal(res.headers['content-encoding'], undefined);
  });

  it('passes an upstream error status + JSON body straight through (error-response branch)', async () => {
    mode = 'error-json';
    const res = await proxyReq('/v1/messages', { body: '{}' });
    assert.equal(res.status, 429);
    assert.match(res.body, /rate limited/);
  });

  it('handles an empty 200 (no body) without hanging', async () => {
    mode = 'empty-200';
    const res = await proxyReq('/v1/messages', { body: '{}' });
    assert.equal(res.status, 200);
    assert.equal(res.body, '');
  });

  it('strips inbound chunked transfer-encoding so undici does not reject (hop-by-hop fix)', async () => {
    // Real Claude CLI sends chunked TE; proxy buffers to a full Buffer, so the stale
    // transfer-encoding: chunked header must be dropped before forwarding, otherwise
    // undici throws 'invalid transfer-encoding header' and the request fails.
    mode = 'plain';
    const res = await new Promise((resolve, reject) => {
      const r = request({ hostname: '127.0.0.1', port: proxyPort, path: '/v1/messages', method: 'POST' }, (resp) => {
        let data = '';
        resp.on('data', (c) => { data += c; });
        resp.on('end', () => resolve({ status: resp.statusCode, body: data }));
      });
      r.on('error', reject);
      // Do NOT set content-length → node http switches to chunked transfer-encoding
      r.write(JSON.stringify({ model: 'claude-3' }));
      r.end();
    });
    assert.equal(res.status, 200, 'chunked TE stripped, upstream reachable');
    assert.match(res.body, /plain ok/);
  });

  it('returns 502 Proxy Error when the upstream is unreachable (catch branch)', async () => {
    // Point at a closed port so fetch throws → catch → 502.
    const saved = process.env.ANTHROPIC_BASE_URL;
    process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:1'; // nothing listening
    try {
      const res = await proxyReq('/v1/messages', { body: '{}' });
      assert.equal(res.status, 502);
      assert.match(res.body, /Proxy Error/);
    } finally {
      process.env.ANTHROPIC_BASE_URL = saved;
    }
  });

  it('forwards a GET with no body (body.length === 0 branch)', async () => {
    mode = 'plain';
    const res = await proxyReq('/v1/models', { method: 'GET' });
    assert.equal(res.status, 200);
    assert.match(res.body, /plain ok/);
  });

  it('handles a 204 (null response body → res.end() branch)', async () => {
    mode = 'no-content';
    const res = await proxyReq('/v1/x', { method: 'GET' });
    assert.equal(res.status, 204);
    assert.equal(res.body, '');
  });
});

describe('retry engine end-to-end (live proxy, serial 529 → 200)', () => {
  it('retries an overloaded upstream and returns the eventual 200 with X-Forward-Attempts', async () => {
    // Drive the REAL handleLlmApiRequest → executeRequest path: write
    // retry-config.json into the isolated LOG_DIR and refresh the live
    // binding directly (the 1.5s watchFile poll is too slow for a test).
    const { RETRY_CONFIG_PATH, _loadRetryConfigState } = await import('../server/interceptor.js');
    writeFileSync(RETRY_CONFIG_PATH, JSON.stringify({ mode: 'serial', maxRetries: 5, retryIntervalMs: 10, connectTimeoutMs: 0 }));
    _loadRetryConfigState();
    try {
      mode = '529-then-200';
      overloadedRemaining = 2;
      const res = await proxyReq('/v1/messages', { body: JSON.stringify({ model: 'claude-3' }) });
      assert.equal(res.status, 200, 'the retried request must surface the eventual success');
      assert.match(res.body, /recovered/);
      assert.equal(res.headers['x-forward-attempts'], '3', 'two 529s + the winning attempt');
      assert.equal(overloadedRemaining, 0, 'upstream actually served the failing attempts');
    } finally {
      rmSync(RETRY_CONFIG_PATH, { force: true });
      _loadRetryConfigState(); // back to env defaults (mode off) for the other cases
    }
  });
});

describe('getOriginalBaseUrl reads ANTHROPIC_BASE_URL from settings.json', () => {
  it('uses the config-file base URL when no env var is set', async () => {
    // Write a settings.json into CLAUDE_CONFIG_DIR so getBaseUrlFromSettings parses it; clear env
    // so the config-path read (not the env branch) supplies the upstream.
    const saved = process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_BASE_URL;
    writeFileSync(join(tmpDir, 'settings.json'), JSON.stringify({ env: { ANTHROPIC_BASE_URL: `http://127.0.0.1:${upstreamPort}` } }));
    try {
      mode = 'plain';
      const res = await proxyReq('/v1/from-settings', { method: 'GET' });
      assert.equal(res.status, 200, 'request routed via the settings.json base URL');
      assert.match(res.body, /plain ok/);
    } finally {
      rmSync(join(tmpDir, 'settings.json'), { force: true });
      process.env.ANTHROPIC_BASE_URL = saved;
    }
  });

  it('tolerates a corrupt settings.json (catch arm) and falls through to env', async () => {
    writeFileSync(join(tmpDir, 'settings.json'), '{bad json');
    try {
      mode = 'plain';
      const res = await proxyReq('/v1/corrupt-settings', { method: 'GET' });
      // env ANTHROPIC_BASE_URL still points at the live upstream → request succeeds despite bad file
      assert.equal(res.status, 200);
    } finally {
      rmSync(join(tmpDir, 'settings.json'), { force: true });
    }
  });
});

describe('getOriginalBaseUrl fallback (default endpoint)', () => {
  it('routes to the hard-coded https://api.anthropic.com default when no settings / env present', async () => {
    // With env cleared AND no settings.json in the (empty) tmp config dir, getOriginalBaseUrl()
    // walks every config path (no match), then the env branch (unset), and finally returns the hard
    // default 'https://api.anthropic.com'. The proxy then builds `${default}/${req.url-without-slash}`
    // and calls the (interceptor-patched) global fetch.
    //
    // Instead of letting that hit the real network (slow + flaky + only ever lets us make the empty
    // `status >= 200` assertion that 200/404/502 all satisfy), we shim globalThis.fetch for the
    // duration of this case to intercept exactly the default-host URL, capture the constructed URL,
    // and return a controllable synthetic 200. proxy.js calls the bare `fetch` identifier which
    // resolves to globalThis.fetch at call time, so the shim is picked up. This both removes the
    // external dependency and lets us assert the *exact default URL the default branch built*.
    const saved = process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_BASE_URL;

    const patchedFetch = globalThis.fetch; // interceptor-patched fetch installed at proxy.js import
    let capturedUrl = null;
    globalThis.fetch = async function (url, options) {
      const urlStr = typeof url === 'string' ? url : (url?.url ?? String(url));
      if (urlStr.startsWith('https://api.anthropic.com/')) {
        capturedUrl = urlStr;
        // Synthetic upstream response so no network round-trip happens.
        return new Response('default-route-ok', { status: 200, headers: { 'content-type': 'text/plain' } });
      }
      // Anything else (shouldn't happen in this case) falls through to the real patched fetch.
      return patchedFetch.call(this, url, options);
    };

    try {
      const res = await proxyReq('/v1/x', { body: '{}' });
      // Strong behavioral assertions: the default branch must build exactly
      // https://api.anthropic.com/v1/x (base default + leading-slash-stripped req.url), the request
      // must reach our shim (capturedUrl set), and the synthetic body/status must pass through.
      assert.equal(capturedUrl, 'https://api.anthropic.com/v1/x', 'default branch must route to the hard-coded api.anthropic.com base with the request path appended');
      assert.equal(res.status, 200);
      assert.equal(res.body, 'default-route-ok');
    } finally {
      globalThis.fetch = patchedFetch;
      process.env.ANTHROPIC_BASE_URL = saved;
    }
  });
});
