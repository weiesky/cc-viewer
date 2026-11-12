// Covers the slow-upstream advisory in server/proxy.js (sdk-slow-upstream).
//
// Behavior under test (the promise made by dcec232):
//   - A non-utility LLM request that is STILL waiting for the upstream's first
//     byte past the threshold emits ONE `slow` signal, then a `resolved` signal
//     when the request settles.
//   - Utility probes (count_tokens / sdk heartbeat) are exempt — no timer at all.
//   - A request that settles BEFORE the threshold never emits.
//   - The emit carries the request's own self-report headers
//     (x-ccv-project-dir / x-ccv-instance), not the process-wide bound project.
//
// Method: proxy.js calls the upstream via the bare `fetch` identifier (resolved
// to globalThis.fetch at call time), so swapping globalThis.fetch constructs any
// upstream timing with no network. The threshold is shrunk and emits observed via
// the exported `__testing` seam — no 30s real wait, no mock.timers needed.
//
// Isolation: private high port + private CCV_LOG_DIR/CLAUDE_CONFIG_DIR, all set
// before importing proxy.js. globalThis.fetch and __testing are restored after.
import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-slow-upstream-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:9'; // never actually hit

let startProxy, proxyPort, proxyMod;
const realFetch = globalThis.fetch;

function proxyReq(path, { method = 'POST', body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    if (body != null) h['content-length'] = Buffer.byteLength(body);
    const r = request({ hostname: '127.0.0.1', port: proxyPort, path, method, headers: h }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      res.on('error', reject);
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

function abortProxyReq(path, { body = null, headers = {} } = {}) {
  return new Promise((resolve) => {
    const h = { ...headers };
    if (body != null) h['content-length'] = Buffer.byteLength(body);
    const r = request({ hostname: '127.0.0.1', port: proxyPort, path, method: 'POST', headers: h });
    let clientError = null;
    r.on('error', (err) => { clientError = err; });
    r.end(body);
    resolve(() => {
      r.destroy();
      assert.equal(clientError, null, 'unexpected client failure before the intentional abort');
    });
  });
}

const LLM_BODY = JSON.stringify({ model: 'claude-test', messages: [] });

before(async () => {
  proxyMod = await import('../server/proxy.js');
  ({ startProxy } = proxyMod);
  proxyPort = await startProxy();
  assert.ok(proxyPort > 0);
});

after(() => {
  globalThis.fetch = realFetch;
  // Close the proxy listener so node:test's event loop can exit (the suite
  // otherwise hangs on the open server handle).
  try { proxyMod.__testing.lastServer?.close(); } catch { /* noop */ }
  rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  proxyMod.__testing.slowUpstreamMs = 30 * 1000;
  proxyMod.__testing.emit = () => {};
});

// A fetch that resolves with headers after `ms` (a hanging-then-arriving first byte).
function slowFetch(ms) {
  return () => new Promise((resolve) => {
    setTimeout(() => resolve({
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => '{}',
      body: null,
    }), ms);
  });
}

describe('proxy.js slow-upstream advisory', () => {
  it('emits one slow signal (with the request cwd/instance) then resolved when the request outlives the threshold', async () => {
    const events = [];
    proxyMod.__testing.slowUpstreamMs = 40;
    proxyMod.__testing.emit = (info) => events.push(info);
    globalThis.fetch = slowFetch(200); // first byte at 200ms > 40ms threshold

    await proxyReq('/v1/messages', {
      body: LLM_BODY,
      headers: { 'content-type': 'application/json', 'x-ccv-project-dir': '/work/ws-a', 'x-ccv-instance': 'inst-a' },
    });

    const slow = events.filter(e => e.type === 'slow');
    const resolved = events.filter(e => e.type === 'resolved');
    assert.equal(slow.length, 1, 'exactly one slow advisory per request');
    assert.equal(slow[0].cwd, '/work/ws-a');
    assert.equal(slow[0].instanceKey, 'inst-a');
    assert.ok(slow[0].requestId, 'each slow advisory carries a requestId');
    assert.ok(typeof slow[0].waitingMs === 'number' && slow[0].waitingMs > 0, 'waitingMs reflects real elapsed, not a constant');
    assert.equal(slow[0].model, 'claude-test');
    assert.equal(resolved.length, 1, 'a resolved signal follows once the wait ends');
    assert.equal(resolved[0].cwd, '/work/ws-a');
    assert.equal(resolved[0].requestId, slow[0].requestId, 'resolved clears the same requestId');
  });

  it('resolves an announced wait when the client disconnects before response headers', async () => {
    const events = [];
    proxyMod.__testing.slowUpstreamMs = 40;
    proxyMod.__testing.emit = (info) => events.push(info);
    globalThis.fetch = () => new Promise(() => {});
    const abort = await abortProxyReq('/v1/messages', {
      body: LLM_BODY,
      headers: { 'content-type': 'application/json', 'x-ccv-project-dir': '/work/ws-a', 'x-ccv-instance': 'inst-a' },
    });
    for (let i = 0; i < 100 && !events.some(e => e.type === 'slow'); i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const slow = events.find(e => e.type === 'slow');
    assert.ok(slow, 'the slow advisory is announced before the client leaves');
    abort();
    for (let i = 0; i < 100 && !events.some(e => e.type === 'resolved'); i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const resolved = events.filter(e => e.type === 'resolved');
    assert.equal(resolved.length, 1, 'disconnect dismisses the announced request exactly once');
    assert.equal(resolved[0].requestId, slow.requestId);
    assert.equal(resolved[0].cwd, '/work/ws-a');
    assert.equal(resolved[0].instanceKey, 'inst-a');
  });

  it('resolves once when the client leaves a headers-fast, body-stalled stream', async () => {
    const events = [];
    proxyMod.__testing.slowUpstreamMs = 40;
    proxyMod.__testing.emit = (info) => events.push(info);
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'text/event-stream']]),
      body: new ReadableStream({ start() {} }),
    });
    const abort = await abortProxyReq('/v1/messages', {
      body: LLM_BODY,
      headers: { 'content-type': 'application/json', 'x-ccv-project-dir': '/work/ws-a', 'x-ccv-instance': 'inst-a' },
    });
    for (let i = 0; i < 100 && !events.some(e => e.type === 'slow'); i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const slow = events.find(e => e.type === 'slow');
    assert.ok(slow, 'the body stall announces the wait');
    abort();
    for (let i = 0; i < 100 && !events.some(e => e.type === 'resolved'); i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.deepEqual(events.filter(e => e.type === 'resolved').map(e => e.requestId), [slow.requestId]);
  });

  it('settles a wait when forwarding fails after upstream headers arrive', async () => {
    const events = [];
    proxyMod.__testing.slowUpstreamMs = 80;
    proxyMod.__testing.emit = (info) => events.push(info);
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json'], ['x-invalid', 'bad\nvalue']]),
      body: null,
      text: async () => '{}',
    });
    const response = await proxyReq('/v1/messages', {
      body: LLM_BODY,
      headers: { 'content-type': 'application/json', 'x-ccv-project-dir': '/work/ws-a', 'x-ccv-instance': 'inst-a' },
    });
    assert.equal(response.status, 502);
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.equal(events.filter(e => e.type === 'slow').length, 0, 'a terminal forwarding failure cannot announce a new wait');
    assert.equal(events.filter(e => e.type === 'resolved').length, 0);
  });

  it('does not emit when the request settles before the threshold', async () => {
    const events = [];
    proxyMod.__testing.slowUpstreamMs = 200;
    proxyMod.__testing.emit = (info) => events.push(info);
    globalThis.fetch = slowFetch(10); // first byte at 10ms < 200ms threshold

    await proxyReq('/v1/messages', {
      body: LLM_BODY,
      headers: { 'content-type': 'application/json', 'x-ccv-project-dir': '/work/ws-a' },
    });

    assert.equal(events.filter(e => e.type === 'slow').length, 0);
    assert.equal(events.filter(e => e.type === 'resolved').length, 0, 'no resolved without a prior slow');
  });

  it('exempts utility probes (count_tokens) — no timer is armed at all', async () => {
    const events = [];
    proxyMod.__testing.slowUpstreamMs = 40;
    proxyMod.__testing.emit = (info) => events.push(info);
    globalThis.fetch = slowFetch(200);

    await proxyReq('/v1/messages/count_tokens', {
      body: LLM_BODY,
      headers: { 'content-type': 'application/json', 'x-ccv-project-dir': '/work/ws-a' },
    });

    assert.equal(events.length, 0, 'utility traffic never emits');
  });

  it('falls back to empty cwd/instance when the self-report headers are absent', async () => {
    const events = [];
    proxyMod.__testing.slowUpstreamMs = 40;
    proxyMod.__testing.emit = (info) => events.push(info);
    globalThis.fetch = slowFetch(200);

    await proxyReq('/v1/messages', { body: LLM_BODY, headers: { 'content-type': 'application/json' } });

    const slow = events.filter(e => e.type === 'slow');
    assert.equal(slow.length, 1);
    assert.equal(slow[0].cwd, '');
    assert.equal(slow[0].instanceKey, '');
  });

  // review P1-2: the timer must stay armed past HEADERS until the first body
  // chunk. A headers-fast-then-stalled SSE stream is exactly the silent case the
  // feature targets. The stub resolves headers at 10ms but delays the first body
  // byte to 200ms (> the 40ms threshold) — the slow frame MUST fire, then a
  // resolved once the first body chunk arrives.
  it('fires for a headers-fast-then-stalled-body stream (timer waits for first byte, not headers)', async () => {
    const events = [];
    proxyMod.__testing.slowUpstreamMs = 40;
    proxyMod.__testing.emit = (info) => events.push(info);
    // Headers at 10ms, first SSE body byte at 200ms.
    globalThis.fetch = () => new Promise((resolve) => {
      setTimeout(() => {
        const stream = new ReadableStream({
          start(controller) {
            setTimeout(() => {
              controller.enqueue(new TextEncoder().encode('data: {}\n\n'));
              controller.close();
            }, 200);
          },
        });
        resolve({
          ok: true,
          status: 200,
          headers: new Map([['content-type', 'text/event-stream']]),
          body: stream,
        });
      }, 10);
    });

    await proxyReq('/v1/messages', {
      body: LLM_BODY,
      headers: { 'content-type': 'application/json', 'x-ccv-project-dir': '/work/ws-b', 'x-ccv-instance': 'inst-b' },
    });

    const slow = events.filter(e => e.type === 'slow');
    assert.equal(slow.length, 1, 'a body-stall past the threshold fires the advisory even though headers were fast');
    assert.equal(slow[0].cwd, '/work/ws-b');
    assert.equal(events.filter(e => e.type === 'resolved').length, 1, 'resolved once the first body chunk lands');
  });
});
