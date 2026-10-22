// Regression tests for malformed Host headers.
//
// llhttp accepts values like `Host: [`, but `new URL(path, proto://host)` throws. The HTTP
// handler and the WS upgrade listener both parse the URL, and handleRequest is wired
// directly into createServer (an async throw becomes an unhandled rejection that kills
// the process). history.md claims the malformed-Host crash is fixed — this file locks it in.
//
// Isolation mirrors server-http-extra.test.js: env is pointed at a temp dir before
// importing server.js, workspace mode prevents the auto-boot path, and the server uses a
// private high port window.
import { describe, it, before, after } from 'node:test';
import { describeCli } from './_helpers/cli-tier.mjs';
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { request } from 'node:http';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-malformed-host-'));
mkdirSync(join(tmpDir, 'logs'), { recursive: true });
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';
process.env.NODE_ENV = 'test';
delete process.env.CCV_BASE_PATH;
delete process.env.CCV_ALLOWED_HOSTS;
delete process.env.CCV_USE_PASSWORD;
delete process.env.CCV_PASSWORD;
process.env.CCV_START_PORT = '19810';
process.env.CCV_MAX_PORT = '19819';

// Raw TCP so the client never sanitizes the Host value we want to send.
function sendRaw(port, payload, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    let data = '';
    let settled = false;
    const done = (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve(data);
    };
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => { data += chunk; });
    socket.on('end', () => done());
    socket.on('close', () => done());
    socket.on('error', (err) => done(data ? null : err));
    socket.setTimeout(timeoutMs, () => done());
    socket.write(payload);
  });
}

function httpGet(port, path) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describeCli('server.js malformed Host handling', { concurrency: false }, () => {
  let mod;
  let port;

  before(async () => {
    mod = await import('../server/server.js');
    const server = await mod.startViewer();
    assert.ok(server, 'server should start');
    port = mod.getPort();
    assert.ok(port > 0, 'port assigned');
  });

  after(async () => {
    await new Promise((resolve) => {
      mod.stopViewer();
      setTimeout(() => { rmSync(tmpDir, { recursive: true, force: true }); resolve(); }, 200);
    });
  });

  const assertAlive = async () => {
    const res = await httpGet(port, '/api/user-profile');
    assert.equal(res.status, 200, 'process must survive the malformed request');
  };

  it('rejects `Host: [` with 400 and keeps serving', async () => {
    const raw = await sendRaw(port, 'GET /api/user-profile HTTP/1.1\r\nHost: [\r\nConnection: close\r\n\r\n');
    assert.match(raw, /^HTTP\/1\.1 400/, `expected 400, got: ${raw.slice(0, 80)}`);
    await assertAlive();
  });

  it('rejects an empty Host with 400 and keeps serving', async () => {
    const raw = await sendRaw(port, 'GET /api/user-profile HTTP/1.1\r\nHost: \r\nConnection: close\r\n\r\n');
    assert.match(raw, /^HTTP\/1\.1 400/, `expected 400, got: ${raw.slice(0, 80)}`);
    await assertAlive();
  });

  it('destroys a WS upgrade with a malformed Host without crashing', async () => {
    const raw = await sendRaw(
      port,
      'GET /ws/terminal HTTP/1.1\r\n'
      + 'Host: [\r\n'
      + 'Upgrade: websocket\r\n'
      + 'Connection: Upgrade\r\n'
      + 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n'
      + 'Sec-WebSocket-Version: 13\r\n\r\n',
    );
    assert.doesNotMatch(raw, /^HTTP\/1\.1 101/, 'malformed Host must never upgrade');
    await assertAlive();
  });
});
