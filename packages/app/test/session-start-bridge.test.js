/**
 * session-start-bridge.test.js — covers server/lib/session-start-bridge.js
 *
 * Like turn-end-bridge.js, the bridge is a one-shot CLI script (runs on
 * import, always process.exit(0)), so we spawn it as a child `node` process
 * and assert observable behavior:
 *   - exits 0 with CCVIEWER_PORT unset (silent no-op, no request)
 *   - POSTs source / sessionId / transcriptPath / cwd / ts parsed from the
 *     SessionStart hook stdin JSON to /api/session-start-notify
 *   - forwards X-CCViewer-Internal only when CCVIEWER_INTERNAL_TOKEN set
 *   - never pollutes stdout (SessionStart stdout is context-injection JSON)
 *   - tolerates non-JSON stdin (null fields, still notifies)
 *   - exits 0 on connection refusal and on a stalled server (500ms timeout)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '..', 'server', 'lib', 'session-start-bridge.js');

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
    if (stdin !== null) child.stdin.write(stdin);
    child.stdin.end();
  });
}

function captureServer({ stall = false } = {}) {
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
      if (stall) return;
      res.writeHead(200, { 'Content-Type': 'application/json' });
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

const HOOK_PAYLOAD = {
  session_id: 'resume-uuid-1',
  transcript_path: '/Users/x/.claude/projects/p/orig-uuid.jsonl',
  source: 'resume',
  cwd: '/Users/x/work/proj',
  hook_event_name: 'SessionStart',
};

describe('session-start-bridge.js', { concurrency: false }, () => {
  it('exits 0 and makes no request when CCVIEWER_PORT is unset', async () => {
    const { server, captured } = captureServer();
    await listen(server);
    try {
      const res = await runBridge({
        env: { CCVIEWER_PORT: '', CCVIEWER_DEBUG: '1' },
        stdin: JSON.stringify(HOOK_PAYLOAD),
      });
      assert.equal(res.code, 0, 'must always exit 0');
      assert.equal(res.stdout, '', 'stdout must stay clean (SessionStart context-injection channel)');
      assert.equal(captured.hit, false);
      assert.match(res.stderr, /CCVIEWER_PORT unset/);
    } finally {
      server.close();
    }
  });

  it('POSTs source/sessionId/transcriptPath/cwd/ts to /api/session-start-notify', async () => {
    const { server, hitPromise } = captureServer();
    const port = await listen(server);
    try {
      const runP = runBridge({
        env: { CCVIEWER_PORT: String(port), CCVIEWER_INTERNAL_TOKEN: '' },
        stdin: JSON.stringify(HOOK_PAYLOAD),
      });
      const cap = await hitPromise;
      const res = await runP;
      assert.equal(res.code, 0);
      assert.equal(res.stdout, '', 'stdout stays clean on the notify path too');
      assert.equal(cap.method, 'POST');
      assert.equal(cap.url, '/api/session-start-notify');
      const payload = JSON.parse(cap.body);
      assert.equal(payload.source, 'resume');
      assert.equal(payload.sessionId, 'resume-uuid-1');
      assert.equal(payload.transcriptPath, HOOK_PAYLOAD.transcript_path);
      assert.equal(payload.cwd, HOOK_PAYLOAD.cwd);
      assert.ok(typeof payload.ts === 'number' && payload.ts > 0);
      assert.equal(cap.headers['x-ccviewer-internal'], undefined, 'no token env → header absent');
    } finally {
      server.close();
    }
  });

  it('forwards X-CCViewer-Internal when CCVIEWER_INTERNAL_TOKEN is set', async () => {
    const { server, hitPromise } = captureServer();
    const port = await listen(server);
    try {
      const runP = runBridge({
        env: { CCVIEWER_PORT: String(port), CCVIEWER_INTERNAL_TOKEN: 'tok-1' },
        stdin: JSON.stringify(HOOK_PAYLOAD),
      });
      const cap = await hitPromise;
      await runP;
      assert.equal(cap.headers['x-ccviewer-internal'], 'tok-1');
    } finally {
      server.close();
    }
  });

  it('tolerates non-JSON stdin: still notifies with null fields', async () => {
    const { server, hitPromise } = captureServer();
    const port = await listen(server);
    try {
      const runP = runBridge({
        env: { CCVIEWER_PORT: String(port) },
        stdin: 'not json at all',
      });
      const cap = await hitPromise;
      const res = await runP;
      assert.equal(res.code, 0);
      const payload = JSON.parse(cap.body);
      assert.equal(payload.source, null);
      assert.equal(payload.sessionId, null);
      assert.equal(payload.transcriptPath, null);
    } finally {
      server.close();
    }
  });

  it('exits 0 on connection refusal and on a stalled server (500ms timeout)', async () => {
    // Refusal: reserve a port then free it.
    const tmp = http.createServer();
    const freePort = await listen(tmp);
    await new Promise((r) => tmp.close(r));
    const refused = await runBridge({
      env: { CCVIEWER_PORT: String(freePort), CCVIEWER_DEBUG: '1' },
      stdin: JSON.stringify(HOOK_PAYLOAD),
    });
    assert.equal(refused.code, 0);
    assert.match(refused.stderr, /POST error/);

    // Stall: server never responds → client timeout path.
    const { server, hitPromise } = captureServer({ stall: true });
    const port = await listen(server);
    try {
      const start = Date.now();
      const runP = runBridge({
        env: { CCVIEWER_PORT: String(port), CCVIEWER_DEBUG: '1' },
        stdin: JSON.stringify(HOOK_PAYLOAD),
      });
      await hitPromise;
      const res = await runP;
      assert.equal(res.code, 0);
      assert.match(res.stderr, /POST timeout/);
      assert.ok(Date.now() - start < 5000, 'exits promptly after the 500ms timeout');
    } finally {
      server.close();
    }
  });
});
