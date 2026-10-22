import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { createProxyTracker, createPluginAgent, proxyHttpRequest, proxyUpgrade } from '../server/lib/plugin-proxy.js';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

async function close(server) {
  try { server.closeAllConnections?.(); } catch { /* noop */ }
  server.close();
  await once(server, 'close').catch(() => {});
}

function httpRequest(port, { method = 'GET', path = '/', headers = {}, body = null, token = null }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

let upstream;
let downstream;
let tracker;
let agent;
let upPort;
let downPort;
const SECRET = 'proxy-secret';

function makeTarget() {
  return {
    name: 'hello-service',
    port: upPort,
    secret: SECRET,
    externalPrefix: '/plugins/hello-service',
    cookiePath: '/plugins/hello-service/',
    protocol: 'http',
    agent,
  };
}

function makeDownstream(handler) {
  return http.createServer((req, res) => {
    try {
      handler(req, res);
    } catch (err) {
      res.writeHead(500); res.end(String(err));
    }
  });
}

beforeEach(async () => {
  tracker = createProxyTracker();
  agent = createPluginAgent();
});

afterEach(async () => {
  agent.destroy();
  await close(upstream).catch(() => {});
  await close(downstream).catch(() => {});
});

describe('plugin-proxy HTTP', () => {
  it('forwards with prefix strip, query (token stripped), host rewrite, secret inject', async () => {
    let seen = null;
    upstream = http.createServer((req, res) => {
      seen = { url: req.url, host: req.headers.host, secret: req.headers['x-ccv-plugin-secret'], prefix: req.headers['x-forwarded-prefix'], cookie: req.headers.cookie, expect: req.headers.expect };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    upPort = await listen(upstream);
    downstream = makeDownstream((req, res) => {
      proxyHttpRequest(req, res, {
        target: makeTarget(),
        match: { forwardPath: '/api/data', search: '?a=1&token=HOST_TOKEN&b=2' },
        tracker,
      });
    });
    downPort = await listen(downstream);

    const r = await httpRequest(downPort, { path: '/plugins/hello-service/api/data?a=1&token=HOST_TOKEN&b=2', headers: { cookie: 'ccv_auth=abc' } });
    assert.equal(r.status, 200);
    assert.equal(seen.url, '/api/data?a=1&b=2', 'token query 被剥离，其余保留');
    assert.equal(seen.host, `127.0.0.1:${upPort}`);
    assert.equal(seen.secret, SECRET);
    assert.equal(seen.prefix, '/plugins/hello-service');
    assert.equal(seen.cookie, undefined, 'cookie 被剥离');
  });

  it('streams POST body end-to-end (no abort on req close)', async () => {
    let received = '';
    upstream = http.createServer((req, res) => {
      req.on('data', (c) => { received += c; });
      req.on('end', () => {
        // Delayed response: if the proxy wrongly used req.on('close') to destroy the upstream, the full body/response would never complete
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end(`len=${received.length}`);
        }, 100);
      });
    });
    upPort = await listen(upstream);
    downstream = makeDownstream((req, res) => {
      proxyHttpRequest(req, res, {
        target: makeTarget(),
        match: { forwardPath: '/echo', search: '' },
        tracker,
      });
    });
    downPort = await listen(downstream);

    const body = 'x'.repeat(64 * 1024);
    const r = await httpRequest(downPort, { method: 'POST', path: '/plugins/hello-service/echo', body });
    assert.equal(r.status, 200);
    assert.equal(r.body, `len=${body.length}`);
  });

  it('streams SSE chunks as they arrive (flushHeaders)', async () => {
    upstream = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write('data: one\n\n');
      setTimeout(() => { res.write('data: two\n\n'); res.end(); }, 150);
    });
    upPort = await listen(upstream);
    downstream = makeDownstream((req, res) => {
      proxyHttpRequest(req, res, {
        target: makeTarget(),
        match: { forwardPath: '/sse', search: '' },
        tracker,
      });
    });
    downPort = await listen(downstream);

    const chunks = [];
    const firstChunkAt = await new Promise((resolve, reject) => {
      const t0 = Date.now();
      const req = http.request({ host: '127.0.0.1', port: downPort, path: '/plugins/hello-service/sse' }, (res) => {
        res.on('data', (c) => { chunks.push(c.toString()); if (chunks.length === 1) resolve(Date.now() - t0); });
        res.on('end', () => {});
      });
      req.on('error', reject);
      req.end();
    });
    assert.ok(firstChunkAt < 150, `首块应在第二块发出前到达（实际 ${firstChunkAt}ms）`);
    await new Promise(r => setTimeout(r, 300));
    assert.deepEqual(chunks, ['data: one\n\n', 'data: two\n\n']);
  });

  it('returns 502 when upstream is down', async () => {
    upPort = 1; // unavailable port
    downstream = makeDownstream((req, res) => {
      proxyHttpRequest(req, res, {
        target: makeTarget(),
        match: { forwardPath: '/x', search: '' },
        tracker,
      });
    });
    downPort = await listen(downstream);
    const r = await httpRequest(downPort, { path: '/plugins/hello-service/x' });
    assert.equal(r.status, 502);
    upstream = http.createServer(() => {}); // needed for afterEach close
  });

  it('rewrites same-origin Location and Set-Cookie, drops ccv_auth', async () => {
    upstream = http.createServer((req, res) => {
      res.writeHead(302, {
        Location: '/next',
        'Set-Cookie': ['sid=1; Path=/; Domain=example.com', 'ccv_auth=evil; Path=/'],
      });
      res.end();
    });
    upPort = await listen(upstream);
    downstream = makeDownstream((req, res) => {
      proxyHttpRequest(req, res, {
        target: makeTarget(),
        match: { forwardPath: '/redir', search: '' },
        tracker,
      });
    });
    downPort = await listen(downstream);
    const r = await httpRequest(downPort, { path: '/plugins/hello-service/redir' });
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, '/plugins/hello-service/next');
    const setCookie = Array.isArray(r.headers['set-cookie']) ? r.headers['set-cookie'] : [r.headers['set-cookie']];
    assert.equal(setCookie.length, 1, 'ccv_auth cookie 被拒');
    assert.match(setCookie[0], /sid=1/);
    assert.match(setCookie[0], /Path=\/plugins\/hello-service\//);
    assert.ok(!/Domain=/i.test(setCookie[0]), 'Domain 被剥离');
  });

  it('respects per-plugin active socket cap', async () => {
    upstream = http.createServer(() => {});
    upPort = await listen(upstream);
    downstream = makeDownstream((req, res) => {
      // Fill the tracker
      for (let i = 0; i < 300; i++) tracker.add('hello-service', { destroy() {} });
      proxyHttpRequest(req, res, {
        target: makeTarget(),
        match: { forwardPath: '/x', search: '' },
        tracker,
      });
    });
    downPort = await listen(downstream);
    const r = await httpRequest(downPort, { path: '/plugins/hello-service/x' });
    assert.equal(r.status, 503);
    assert.equal(r.headers['retry-after'], '2');
  });
});

describe('plugin-proxy WebSocket', () => {
  it('tunnels ws echo end-to-end and destroys pair on unload', async () => {
    const { WebSocketServer, WebSocket } = await import('ws');
    const wss = new WebSocketServer({ noServer: true });
    wss.on('connection', (ws) => {
      ws.on('message', (m) => ws.send(`echo:${m}`));
    });
    upstream = http.createServer((req, res) => { res.writeHead(404); res.end(); });
    upstream.on('upgrade', (req, socket, head) => {
      if (req.headers['x-ccv-plugin-secret'] !== SECRET) { socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });
    upPort = await listen(upstream);

    downstream = http.createServer((req, res) => { res.writeHead(404); res.end(); });
    downstream.on('upgrade', (req, socket, head) => {
      proxyUpgrade(req, socket, head, {
        target: makeTarget(),
        match: { forwardPath: '/ws', search: '?token=HOST_TOKEN' },
        tracker,
      });
    });
    downPort = await listen(downstream);

    const ws = new WebSocket(`ws://127.0.0.1:${downPort}/plugins/hello-service/ws?token=HOST_TOKEN`);
    const reply = await new Promise((resolve, reject) => {
      ws.on('open', () => ws.send('hi'));
      ws.on('message', (m) => resolve(m.toString()));
      ws.on('error', reject);
      setTimeout(() => reject(new Error('ws echo timeout')), 3000);
    });
    assert.equal(reply, 'echo:hi');

    // Unload: destroyAll must tear down both tunnel ends
    tracker.destroyAll('hello-service');
    const closed = await new Promise((resolve) => {
      ws.on('close', () => resolve(true));
      setTimeout(() => resolve(false), 2000);
    });
    assert.equal(closed, true, '隧道销毁后客户端应断开');
    await close(wss).catch(() => {});
  });

  it('rewrites 101 handshake headers and drops Set-Cookie/Location/extra headers', async () => {
    let upstreamSocket = null;
    upstream = http.createServer((req, res) => { res.writeHead(404); res.end(); });
    upstream.on('upgrade', (req, socket) => {
      upstreamSocket = socket;
      socket.write([
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Accept: dummy-accept',
        'Sec-WebSocket-Protocol: chat',
        'Set-Cookie: sid=1; Path=/; Domain=example.com',
        'Set-Cookie: ccv_auth=evil; Path=/',
        'Location: /next',
        'X-Plugin-Leak: yes',
        '', '',
      ].join('\r\n'));
    });
    upPort = await listen(upstream);
    downstream = http.createServer((req, res) => { res.writeHead(404); res.end(); });
    downstream.on('upgrade', (req, socket, head) => {
      proxyUpgrade(req, socket, head, {
        target: makeTarget(),
        match: { forwardPath: '/ws', search: '' },
        tracker,
      });
    });
    downPort = await listen(downstream);

    const raw = await new Promise((resolve, reject) => {
      const sock = net.connect(downPort, '127.0.0.1', () => {
        sock.write('GET /plugins/hello-service/ws HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
      });
      let data = '';
      sock.on('data', (chunk) => {
        data += chunk;
        if (data.includes('\r\n\r\n')) { sock.destroy(); resolve(data); }
      });
      sock.on('error', reject);
      setTimeout(() => reject(new Error('101 timeout')), 3000);
    });
    const head = raw.split('\r\n\r\n')[0];
    assert.match(head, /^HTTP\/1\.1 101/);
    assert.match(head, /sec-websocket-accept: dummy-accept/i);
    assert.match(head, /sec-websocket-protocol: chat/i);
    assert.doesNotMatch(head, /set-cookie/i, 'plugin cookies must never reach the client');
    assert.doesNotMatch(head, /location:/i, 'Location is not a handshake header');
    assert.doesNotMatch(head, /x-plugin-leak/i, 'only handshake headers are forwarded');

    // Tear down both tunnel ends so afterEach's server.close() is not stuck on the
    // upgraded socket (the raw upstream side is paused and never reads EOF on its own).
    tracker.destroyAll('hello-service');
    upstreamSocket?.destroy();
  });

  it('forwards non-101 response status and body', async () => {
    const { WebSocket } = await import('ws');
    upstream = http.createServer((req, res) => { res.writeHead(404); res.end(); });
    upstream.on('upgrade', (req, socket, head) => {
      const body = JSON.stringify({ error: 'no ws here' });
      socket.write(`HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`);
      socket.destroy();
    });
    upPort = await listen(upstream);
    downstream = http.createServer((req, res) => { res.writeHead(404); res.end(); });
    downstream.on('upgrade', (req, socket, head) => {
      proxyUpgrade(req, socket, head, {
        target: makeTarget(),
        match: { forwardPath: '/ws', search: '' },
        tracker,
      });
    });
    downPort = await listen(downstream);

    const ws = new WebSocket(`ws://127.0.0.1:${downPort}/plugins/hello-service/ws`);
    const err = await new Promise((resolve) => {
      ws.on('error', (e) => resolve(e));
      ws.on('open', () => resolve(null));
      setTimeout(() => resolve(new Error('timeout')), 3000);
    });
    assert.ok(err, 'should error');
    assert.match(err.message, /403/);
  });
});
