/**
 * turn-end-bridge.test.js — covers server/lib/turn-end-bridge.js
 *
 * turn-end-bridge.js is a one-shot CLI script (runs on import, calls process.exit(0)),
 * so it cannot be imported into the test process. We spawn it as a child `node` process
 * and assert on observable behavior:
 *   - exits 0 with CCVIEWER_PORT unset (silent no-op, no request)
 *   - POSTs sessionId / transcriptPath / ts to /api/turn-end-notify (parsed from stdin)
 *   - forwards X-CCViewer-Internal header only when CCVIEWER_INTERNAL_TOKEN set
 *   - always exits 0 even when the notify target refuses the connection / errors
 *   - tolerates non-JSON / absent stdin (still notifies with null sessionId)
 *   - exits 0 (does not hang) when the server stalls past the 500ms timeout
 *
 * Spawning under c8 still produces coverage because the child inherits NODE_V8_COVERAGE
 * from the parent test process's environment (we pass the full process.env through).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '..', 'server', 'lib', 'turn-end-bridge.js');

/**
 * Run turn-end-bridge.js as a child process.
 * @param {object} opts
 * @param {object} [opts.env] extra env vars (merged over process.env)
 * @param {string|null} [opts.stdin] data to pipe to stdin (null = no stdin written)
 * @returns {Promise<{code:number, stdout:string, stderr:string}>}
 */
function runBridge({ env = {}, stdin = null } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    if (stdin !== null) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}

/** Start a one-shot capture server; resolves with the captured request once it lands. */
function captureServer({ stall = false, statusCode = 200 } = {}) {
  const captured = { hit: false };
  let resolveHit;
  const hitPromise = new Promise((r) => { resolveHit = r; });
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      captured.hit = true;
      captured.method = req.method;
      captured.url = req.url;
      captured.headers = req.headers;
      captured.body = body;
      resolveHit(captured);
      if (stall) return; // never respond → exercise client-side 500ms timeout
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  return { server, captured, hitPromise };
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

describe('turn-end-bridge.js', { concurrency: false }, () => {
  it('exits 0 and makes no request when CCVIEWER_PORT is unset', async () => {
    const { server, captured } = captureServer();
    const port = await listen(server);
    try {
      const res = await runBridge({
        // Explicitly clear CCVIEWER_PORT (inherited env might carry one)
        env: { CCVIEWER_PORT: '', CCVIEWER_DEBUG: '1' },
        stdin: JSON.stringify({ session_id: 'abc' }),
      });
      assert.equal(res.code, 0, 'must always exit 0');
      assert.equal(res.stdout, '', 'must not pollute stdout (Stop hook decision channel)');
      assert.equal(captured.hit, false, 'no port → no notify request');
      assert.match(res.stderr, /CCVIEWER_PORT unset/, 'debug stderr explains the silent exit');
    } finally {
      server.close();
      void port;
    }
  });

  it('POSTs sessionId / transcriptPath / ts parsed from stdin to /api/turn-end-notify', async () => {
    const { server, hitPromise } = captureServer();
    const port = await listen(server);
    try {
      const runP = runBridge({
        // Clear any token inherited from the launching harness so we assert the
        // "no token" code path (header omitted).
        env: { CCVIEWER_PORT: String(port), CCVIEWER_INTERNAL_TOKEN: '' },
        stdin: JSON.stringify({ session_id: 'sess-42', transcript_path: '/tmp/t.jsonl' }),
      });
      const cap = await hitPromise;
      const res = await runP;
      assert.equal(res.code, 0);
      assert.equal(cap.method, 'POST');
      assert.equal(cap.url, '/api/turn-end-notify');
      assert.equal(cap.headers['content-type'], 'application/json');
      const payload = JSON.parse(cap.body);
      assert.equal(payload.sessionId, 'sess-42');
      assert.equal(payload.transcriptPath, '/tmp/t.jsonl');
      assert.equal(typeof payload.ts, 'number');
      assert.ok(payload.ts > 0);
      // Empty token env → header must be absent (internalToken falsy → spread {})
      assert.equal(cap.headers['x-ccviewer-internal'], undefined);
    } finally {
      server.close();
    }
  });

  it('forwards X-CCViewer-Internal header when CCVIEWER_INTERNAL_TOKEN is set', async () => {
    const { server, hitPromise } = captureServer();
    const port = await listen(server);
    try {
      const runP = runBridge({
        env: { CCVIEWER_PORT: String(port), CCVIEWER_INTERNAL_TOKEN: 'secret-tok' },
        stdin: JSON.stringify({ session_id: 's' }),
      });
      const cap = await hitPromise;
      const res = await runP;
      assert.equal(res.code, 0);
      assert.equal(cap.headers['x-ccviewer-internal'], 'secret-tok');
    } finally {
      server.close();
    }
  });

  it('sends null sessionId/transcriptPath when stdin is not valid JSON', async () => {
    const { server, hitPromise } = captureServer();
    const port = await listen(server);
    try {
      const runP = runBridge({
        env: { CCVIEWER_PORT: String(port) },
        stdin: 'this is not json {{{',
      });
      const cap = await hitPromise;
      const res = await runP;
      assert.equal(res.code, 0);
      const payload = JSON.parse(cap.body);
      assert.equal(payload.sessionId, null);
      assert.equal(payload.transcriptPath, null);
      assert.equal(typeof payload.ts, 'number');
    } finally {
      server.close();
    }
  });

  it('still notifies (sessionId null) when stdin is empty', async () => {
    const { server, hitPromise } = captureServer();
    const port = await listen(server);
    try {
      const runP = runBridge({
        env: { CCVIEWER_PORT: String(port) },
        stdin: '',
      });
      const cap = await hitPromise;
      const res = await runP;
      assert.equal(res.code, 0);
      const payload = JSON.parse(cap.body);
      assert.equal(payload.sessionId, null);
    } finally {
      server.close();
    }
  });

  it('exits 0 when the notify target refuses the connection (no server listening)', async () => {
    // Reserve a port then close it so nothing is listening → ECONNREFUSED.
    const tmp = http.createServer();
    const port = await listen(tmp);
    await new Promise((r) => tmp.close(r));
    const res = await runBridge({
      env: { CCVIEWER_PORT: String(port), CCVIEWER_DEBUG: '1' },
      stdin: JSON.stringify({ session_id: 'x' }),
    });
    assert.equal(res.code, 0, 'connection error must never block the hook chain');
    assert.match(res.stderr, /POST error/, 'debug stderr reports the connection error');
  });

  it('exits 0 (does not hang) when the server stalls past the 500ms timeout', async () => {
    const { server, hitPromise } = captureServer({ stall: true });
    const port = await listen(server);
    try {
      const start = Date.now();
      const runP = runBridge({
        env: { CCVIEWER_PORT: String(port), CCVIEWER_DEBUG: '1' },
        stdin: JSON.stringify({ session_id: 'slow' }),
      });
      await hitPromise; // request reached server
      const res = await runP;
      const elapsed = Date.now() - start;
      assert.equal(res.code, 0);
      assert.match(res.stderr, /POST timeout/, 'timeout path taken');
      assert.ok(elapsed < 5000, `should exit promptly after 500ms timeout, took ${elapsed}ms`);
    } finally {
      server.close();
    }
  });

  it('exits 0 when CCVIEWER_PROTOCOL=https targets a plain-http server (cert path, error swallowed)', async () => {
    // The bridge uses the https client with rejectUnauthorized:false; pointing it at a
    // plain http server yields a protocol/parse error which must still exit 0.
    const { server } = captureServer();
    const port = await listen(server);
    try {
      const res = await runBridge({
        env: { CCVIEWER_PORT: String(port), CCVIEWER_PROTOCOL: 'https', CCVIEWER_DEBUG: '1' },
        stdin: JSON.stringify({ session_id: 'h' }),
      });
      assert.equal(res.code, 0);
      assert.match(res.stderr, /POST error|POST done/, 'https-over-http resolved via error or done, never a crash');
    } finally {
      server.close();
    }
  });
});
