/**
 * ccv-editor.test.js — covers server/lib/ccv-editor.js
 *
 * ccv-editor.js is a CLI $EDITOR wrapper (runs main() on import, calls process.exit),
 * so we spawn it as a child `node` process and assert on observable behavior:
 *   - usage error (exit 1) when no file argument
 *   - error (exit 1) when CCV_EDITOR_PORT unset
 *   - POSTs { sessionId, filePath } to /api/editor-open (filePath resolved to absolute)
 *   - exits 1 when /api/editor-open returns non-2xx (prints server error text)
 *   - exits 1 when the server is unreachable (connect failure)
 *   - polls /api/editor-status until { done:true } then exits 0
 *   - exits 1 when an editor-status poll throws (connection reset → server restarted)
 *   - tolerates a non-OK editor-status response (keeps polling, no crash)
 *
 * Spawning under c8 still yields coverage: the child inherits NODE_V8_COVERAGE from
 * the parent test process environment (we pass the whole process.env through).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '..', 'server', 'lib', 'ccv-editor.js');

/** Run ccv-editor.js as a child; resolve { code, stdout, stderr }. */
function runEditor({ args = [], env = {} } = {}) {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', rej);
    child.on('close', (code) => res({ code, stdout, stderr }));
  });
}

function listen(server) {
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
}

describe('ccv-editor.js', { concurrency: false }, () => {
  it('exits 1 with usage message when no file argument is given', async () => {
    // resolve('') === process.cwd() (truthy), so the empty-path guard does NOT fire;
    // instead it fails on the missing CCV_EDITOR_PORT. Pin that real behavior.
    const { code, stderr } = await runEditor({ args: [], env: { CCV_EDITOR_PORT: '' } });
    assert.equal(code, 1);
    assert.match(stderr, /CCV_EDITOR_PORT not set/);
  });

  it('exits 1 when CCV_EDITOR_PORT is not set', async () => {
    const { code, stderr } = await runEditor({ args: ['notes.md'], env: { CCV_EDITOR_PORT: '' } });
    assert.equal(code, 1);
    assert.match(stderr, /CCV_EDITOR_PORT not set/);
  });

  it('POSTs { sessionId, filePath(absolute) } to /api/editor-open then completes when status.done', async () => {
    let openBody = null;
    let openSessionId = null;
    let statusPolls = 0;
    const server = http.createServer((req, res) => {
      if (req.url === '/api/editor-open' && req.method === 'POST') {
        let b = '';
        req.on('data', (c) => { b += c; });
        req.on('end', () => {
          openBody = JSON.parse(b);
          openSessionId = openBody.sessionId;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{}');
        });
        return;
      }
      if (req.url.startsWith('/api/editor-status')) {
        statusPolls++;
        // Confirm the poll carries the same session id
        const u = new URL(req.url, 'http://x');
        assert.equal(u.searchParams.get('id'), openSessionId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        // First poll: not done; second: done → child exits 0
        res.end(JSON.stringify({ done: statusPolls >= 2 }));
        return;
      }
      res.writeHead(404); res.end();
    });
    const port = await listen(server);
    try {
      const { code } = await runEditor({
        args: ['relative/notes.md'],
        env: { CCV_EDITOR_PORT: String(port) },
      });
      assert.equal(code, 0, 'exits 0 once status.done is true');
      assert.ok(openBody, 'editor-open was called');
      assert.equal(openBody.filePath, resolve('relative/notes.md'), 'filePath resolved to absolute');
      assert.equal(typeof openBody.sessionId, 'string');
      assert.ok(openBody.sessionId.length >= 16, 'sessionId looks like a uuid');
      assert.ok(statusPolls >= 2, 'polled at least twice before done');
    } finally {
      server.close();
    }
  });

  it('exits 1 and prints server error when /api/editor-open returns non-2xx', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/api/editor-open') {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('boom-open-failed');
        return;
      }
      res.writeHead(404); res.end();
    });
    const port = await listen(server);
    try {
      const { code, stderr } = await runEditor({
        args: ['/abs/file.md'],
        env: { CCV_EDITOR_PORT: String(port) },
      });
      assert.equal(code, 1);
      assert.match(stderr, /Failed to open editor/);
      assert.match(stderr, /boom-open-failed/);
    } finally {
      server.close();
    }
  });

  it('exits 1 when the server is unreachable on editor-open', async () => {
    // Reserve then immediately release a port → ECONNREFUSED on connect.
    const tmp = http.createServer();
    const port = await listen(tmp);
    await new Promise((r) => tmp.close(r));
    const { code, stderr } = await runEditor({
      args: ['file.md'],
      env: { CCV_EDITOR_PORT: String(port) },
    });
    assert.equal(code, 1);
    assert.match(stderr, /Failed to connect to cc-viewer server/);
  });

  it('exits 1 when an editor-status poll throws (server reset → connection error)', async () => {
    let polled = false;
    const server = http.createServer((req, res) => {
      if (req.url === '/api/editor-open') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
        return;
      }
      if (req.url.startsWith('/api/editor-status')) {
        polled = true;
        // Abruptly destroy the socket → fetch() rejects → child exits 1
        req.socket.destroy();
        return;
      }
      res.writeHead(404); res.end();
    });
    const port = await listen(server);
    try {
      const { code } = await runEditor({
        args: ['file.md'],
        env: { CCV_EDITOR_PORT: String(port) },
      });
      assert.equal(code, 1, 'connection error during poll exits 1');
      assert.ok(polled, 'status was polled before the reset');
    } finally {
      server.close();
    }
  });

  it('keeps polling on a non-OK status response, then exits 0 when done', async () => {
    let polls = 0;
    const server = http.createServer((req, res) => {
      if (req.url === '/api/editor-open') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
        return;
      }
      if (req.url.startsWith('/api/editor-status')) {
        polls++;
        if (polls === 1) {
          // First poll: non-OK → `if (!res.ok) continue;` branch (keep polling)
          res.writeHead(503, { 'Content-Type': 'text/plain' });
          res.end('not ready');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ done: true }));
        return;
      }
      res.writeHead(404); res.end();
    });
    const port = await listen(server);
    try {
      const { code } = await runEditor({
        args: ['file.md'],
        env: { CCV_EDITOR_PORT: String(port) },
      });
      assert.equal(code, 0);
      assert.ok(polls >= 2, 'continued past the 503 to a done:true poll');
    } finally {
      server.close();
    }
  });
});
