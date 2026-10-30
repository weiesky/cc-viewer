// Coverage target: server/proxy.js — off-mode Node-side stream idle watchdog.
// handleLlmApiRequest is not exported, so the cases below drive it through a real
// startProxy() + fake upstream, mirroring the harness pattern of proxy-unit.test.js:
//   (a) upstream sends 200 + text/event-stream headers and never writes a byte →
//       the proxied client request must error out within ~500ms instead of parking.
//   (b) healthy stream — chunks arrive well within the idle budget → full body intact.
//
// Isolation: CCV_LOG_DIR / CLAUDE_CONFIG_DIR point at a temp dir set BEFORE importing
// proxy.js (which calls setupInterceptor() and patches global fetch). Retry mode 'off'
// and a 50ms idle budget are also set pre-import so interceptor's module-init
// _loadRetryConfigState() picks them up (no retry-config.json exists in the temp dir,
// so env wins). ANTHROPIC_BASE_URL is pointed at our fake upstream so
// getOriginalBaseUrl() resolves there (no settings.json / active profile present).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-proxy-stream-idle-off-test-'));
const ENV_KEYS = [
  'CCV_LOG_DIR', 'CLAUDE_CONFIG_DIR',
  'CCV_PROXY_RETRY_MODE', 'CCV_PROXY_STREAM_IDLE_TIMEOUT_MS',
  'ANTHROPIC_BASE_URL',
  'http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY',
];
const savedEnv = {};
for (const key of ENV_KEYS) savedEnv[key] = process.env[key];

process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_PROXY_RETRY_MODE = 'off';
process.env.CCV_PROXY_STREAM_IDLE_TIMEOUT_MS = '50';
// Clear any inherited proxy env so getProxyDispatcher() → null and getOriginalBaseUrl falls back to env
delete process.env.http_proxy;
delete process.env.https_proxy;
delete process.env.HTTP_PROXY;
delete process.env.HTTPS_PROXY;
delete process.env.all_proxy;
delete process.env.ALL_PROXY;

const { startProxy } = await import('../server/proxy.js');

const HEALTHY_CHUNKS = 8;
const HEALTHY_INTERVAL_MS = 10; // total ~80ms — longer than the 50ms idle budget, each gap below it
const healthyBody = Array.from({ length: HEALTHY_CHUNKS }, (_, i) => `data: part${i}\n\n`).join('');

describe('off-mode stream idle watchdog', () => {
  let upstream;
  let upstreamPort;
  let proxyPort;

  before(async () => {
    // Fake upstream: /v1/messages?scenario=hang sends headers only (hung); otherwise emits SSE on a schedule.
    upstream = createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const scenario = new URL(req.url, 'http://127.0.0.1').searchParams.get('scenario');
        if (scenario === 'hang') {
          // 200 + SSE headers, then never write/end — the client-side watchdog must break the hang
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.flushHeaders();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.flushHeaders();
        let i = 0;
        const iv = setInterval(() => {
          if (i === HEALTHY_CHUNKS) {
            clearInterval(iv);
            res.end();
            return;
          }
          res.write(`data: part${i}\n\n`);
          i++;
        }, HEALTHY_INTERVAL_MS);
        res.on('close', () => clearInterval(iv));
      });
    });

    await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    upstreamPort = upstream.address().port;
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${upstreamPort}`;

    proxyPort = await startProxy();
  });

  after(async () => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    // The hung scenario may leave an upstream connection open at teardown; force-close to avoid a stuck close()
    if (typeof upstream.closeAllConnections === 'function') upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('hung upstream (200 + text/event-stream, no bytes) → client errors within the idle budget', async () => {
    const started = Date.now();
    await assert.rejects(
      async () => {
        // stream:true marks the upstream response as an SSE stream for the interceptor,
        // so fetch resolves on headers instead of draining the body first.
        const resp = await fetch(`http://127.0.0.1:${proxyPort}/v1/messages?scenario=hang`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'test-model', messages: [], stream: true }),
        });
        // If headers reached the client (status 200), the body is then cut by the watchdog;
        // if the watchdog fires before headers flush, fetch itself rejects — both mean the client is no longer parked.
        await resp.text();
      },
      /terminated|aborted|fetch failed|socket|reset|closed/i,
      'hung stream should surface as a request/body error, not hang',
    );
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 500, `client should error within ~500ms, took ${elapsed}ms`);
  });

  it('healthy stream under the idle budget → full body received intact', async () => {
    const resp = await fetch(`http://127.0.0.1:${proxyPort}/v1/messages?scenario=healthy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test-model', messages: [], stream: true }),
    });
    assert.equal(resp.status, 200);
    const text = await resp.text();
    assert.equal(text, healthyBody, 'watchdog must reset per chunk and leave the stream untouched');
  });
});
