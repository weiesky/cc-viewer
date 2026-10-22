// Reverse proxy for service plugins: forwards /plugins/<name>/* (HTTP + WebSocket)
// to the plugin's child process on 127.0.0.1:<port>, streaming in both directions.
//
// Contract notes (hard-won, do not regress):
// - Never buffer: request/response bodies are piped. SSE keeps flowing because we
//   flushHeaders() as soon as upstream responds and never set an upstream response timeout.
// - Client-abort detection uses res.on('close') + !res.writableFinished — NOT
//   req.on('close'), which fires as soon as the request body finishes and would cut
//   every POST/PUT mid-flight.
// - The `token` query param is stripped before forwarding (it is the host's ACCESS_TOKEN;
//   plugins get their own secret via x-ccv-plugin-secret instead).
// - Handlers never throw: dispatch() has no try/catch, so an async throw would become an
//   unhandled rejection and kill the process. Everything is caught + reportSwallowed.
import http from 'node:http';
import { reportSwallowed } from './error-report.js';

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
]);
const SENSITIVE_REQUEST_HEADERS = new Set(['cookie', 'authorization', 'x-ccviewer-internal']);
const MAX_ACTIVE_SOCKETS_PER_PLUGIN = 256;
const UPSTREAM_HEADERS_TIMEOUT_MS = 30000;
const WS_HANDSHAKE_TIMEOUT_MS = 10000;

export function createProxyTracker() {
  // name -> Set<socket|ClientRequest|Agent>
  const byPlugin = new Map();
  return {
    add(name, item) {
      let set = byPlugin.get(name);
      if (!set) { set = new Set(); byPlugin.set(name, set); }
      set.add(item);
    },
    remove(name, item) {
      const set = byPlugin.get(name);
      if (set) { set.delete(item); if (set.size === 0) byPlugin.delete(name); }
    },
    count(name) {
      return byPlugin.get(name)?.size ?? 0;
    },
    destroyAll(name) {
      const set = byPlugin.get(name);
      if (!set) return;
      byPlugin.delete(name);
      for (const item of set) {
        try {
          if (typeof item.destroy === 'function') item.destroy();
        } catch (err) {
          reportSwallowed('plugin-proxy.tracker-destroy', err);
        }
      }
    },
  };
}

export function createPluginAgent() {
  return http.Agent({ keepAlive: true, maxSockets: 64, maxFreeSockets: 8 });
}

function stripTokenFromSearch(search) {
  if (!search) return '';
  const params = new URLSearchParams(search);
  params.delete('token');
  const s = params.toString();
  return s ? `?${s}` : '';
}

function buildForwardHeaders(req, target, extra = {}) {
  const headers = {};
  const connectionTokens = new Set();
  const conn = req.headers.connection;
  if (typeof conn === 'string') {
    for (const t of conn.split(',')) connectionTokens.add(t.trim().toLowerCase());
  }
  for (const [key, value] of Object.entries(req.headers)) {
    const k = key.toLowerCase();
    if (HOP_BY_HOP.has(k) || connectionTokens.has(k)) continue;
    if (SENSITIVE_REQUEST_HEADERS.has(k)) continue;
    if (k === 'expect') continue;              // do not forward 100-continue
    if (k === 'host') continue;               // rewritten below
    if (k === 'x-ccv-plugin-secret') continue; // always overwrite client-supplied values
    headers[k] = value;
  }
  headers.host = `127.0.0.1:${target.port}`;
  headers['x-forwarded-host'] = req.headers.host || '';
  headers['x-forwarded-proto'] = target.protocol || 'http';
  headers['x-forwarded-prefix'] = target.externalPrefix || '';
  const priorFor = req.headers['x-forwarded-for'];
  const clientIp = req.socket?.remoteAddress;
  headers['x-forwarded-for'] = priorFor ? `${priorFor}, ${clientIp}` : clientIp;
  headers['x-ccv-plugin-secret'] = target.secret;
  return { ...headers, ...extra };
}

function rewriteResponseHeaders(upstreamHeaders, target) {
  const headers = {};
  for (const [key, value] of Object.entries(upstreamHeaders)) {
    const k = key.toLowerCase();
    if (k === 'location' && typeof value === 'string') {
      headers[k] = rewriteLocation(value, target);
      continue;
    }
    if (k === 'set-cookie') {
      const cookies = Array.isArray(value) ? value : [value];
      const rewritten = [];
      for (const c of cookies) {
        const rc = rewriteSetCookie(String(c), target);
        if (rc) rewritten.push(rc);
      }
      if (rewritten.length) headers[k] = rewritten;
      continue;
    }
    headers[k] = value;
  }
  return headers;
}

function rewriteLocation(location, target) {
  // relative path or an absolute URL pointing at the upstream -> add the plugin prefix; external redirects untouched
  const prefix = target.externalPrefix || '';
  if (location.startsWith('/')) {
    return `${prefix}${location}`;
  }
  try {
    const u = new URL(location);
    if ((u.hostname === '127.0.0.1' || u.hostname === 'localhost') && Number(u.port) === target.port) {
      return `${prefix}${u.pathname}${u.search}${u.hash}`;
    }
  } catch { /* invalid URL: forward as-is */ }
  return location;
}

function rewriteSetCookie(cookie, target) {
  // prevent shadowing the host auth cookie (parseCookies takes the first match)
  const namePart = cookie.split(';', 1)[0];
  const eq = namePart.indexOf('=');
  const cookieName = (eq >= 0 ? namePart.slice(0, eq) : namePart).trim().toLowerCase();
  if (cookieName === 'ccv_auth') return null;
  const parts = cookie.split(';').map(p => p.trim());
  const out = [parts[0]];
  let hasPath = false;
  for (const attr of parts.slice(1)) {
    const lower = attr.toLowerCase();
    if (lower.startsWith('domain=')) continue; // drop Domain
    if (lower.startsWith('path=')) {
      hasPath = true;
      out.push(`Path=${target.cookiePath || target.externalPrefix || '/'}`);
      continue;
    }
    out.push(attr);
  }
  if (!hasPath) out.push(`Path=${target.cookiePath || target.externalPrefix || '/'}`);
  return out.join('; ');
}

// 101 responses go through the same Set-Cookie/Location policy as plain HTTP, but only
// handshake headers may reach the client: forwarding arbitrary headers can leak plugin
// cookies and framing headers would corrupt the byte tunnel.
const WS_HANDSHAKE_HEADERS = new Set([
  'upgrade', 'connection',
  'sec-websocket-accept', 'sec-websocket-protocol', 'sec-websocket-extensions',
]);

function rewriteUpgradeHeaders(upstreamHeaders, target) {
  const rewritten = rewriteResponseHeaders(upstreamHeaders, target);
  const out = {};
  for (const [key, value] of Object.entries(rewritten)) {
    if (WS_HANDSHAKE_HEADERS.has(key.toLowerCase())) out[key] = value;
  }
  return out;
}

function sendJson(res, status, body) {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * Main HTTP proxy entry. target: { port, secret, name, externalPrefix, protocol, agent }.
 * match: { forwardPath, search } (plugin prefix already stripped).
 */
export function proxyHttpRequest(req, res, { target, match, tracker }) {
  try {
    if (tracker && tracker.count(target.name) >= MAX_ACTIVE_SOCKETS_PER_PLUGIN) {
      res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '2' });
      res.end(JSON.stringify({ error: `plugin "${target.name}" is overloaded` }));
      return;
    }
    const forwardPath = `${match.forwardPath || '/'}${stripTokenFromSearch(match.search)}`;
    const upstreamReq = http.request({
      host: '127.0.0.1',
      port: target.port,
      method: req.method,
      path: forwardPath,
      headers: buildForwardHeaders(req, target),
      agent: target.agent || false,
    });

    let finished = false;
    const cleanup = () => {
      if (tracker) tracker.remove(target.name, upstreamReq);
    };
    if (tracker) tracker.add(target.name, upstreamReq);

    // 30s headers timeout (SSE responses are no longer limited after that)
    upstreamReq.setTimeout(UPSTREAM_HEADERS_TIMEOUT_MS, () => {
      upstreamReq.destroy(new Error('upstream headers timeout'));
    });

    upstreamReq.on('response', (upstreamRes) => {
      upstreamReq.setTimeout(0);
      const headers = rewriteResponseHeaders(upstreamRes.headers, target);
      try {
        res.writeHead(upstreamRes.statusCode, headers);
        res.flushHeaders?.();
        upstreamRes.pipe(res);
        upstreamRes.on('error', (err) => {
          reportSwallowed('plugin-proxy.upstream-res', err);
          res.destroy();
        });
        res.on('error', (err) => {
          reportSwallowed('plugin-proxy.client-res', err);
          upstreamRes.destroy();
        });
      } catch (err) {
        reportSwallowed('plugin-proxy.write-head', err);
        res.destroy();
      }
    });

    upstreamReq.on('error', (err) => {
      reportSwallowed('plugin-proxy.upstream-req', err);
      if (!res.headersSent) {
        sendJson(res, 502, { error: `plugin "${target.name}" upstream error`, detail: String(err && err.message || err) });
      } else {
        res.destroy();
      }
      cleanup();
    });

    // client-abort signal (never req.on('close') - it fires when the request body ends)
    res.on('close', () => {
      if (!res.writableFinished && !finished) {
        upstreamReq.destroy();
      }
      cleanup();
    });
    req.on('error', (err) => {
      reportSwallowed('plugin-proxy.client-req', err);
      upstreamReq.destroy();
    });

    req.pipe(upstreamReq);
  } catch (err) {
    reportSwallowed('plugin-proxy.http', err);
    sendJson(res, 502, { error: `plugin proxy failure` });
  }
}

/**
 * WebSocket proxy (http.request upgrade/response events, raw byte tunnel).
 * The caller must attach client socket error/close handlers synchronously before entering.
 */
export function proxyUpgrade(req, socket, head, { target, match, tracker }) {
  try {
    const forwardPath = `${match.forwardPath || '/'}${stripTokenFromSearch(match.search)}`;
    const upstreamReq = http.request({
      host: '127.0.0.1',
      port: target.port,
      method: 'GET',
      path: forwardPath,
      headers: buildForwardHeaders(req, target, {
        connection: 'Upgrade',
        upgrade: req.headers.upgrade || 'websocket',
      }),
      agent: false, // never globalAgent: destroying it kills every pooled connection in the process
    });

    let upstreamSocket = null;
    let settled = false;
    const destroyPair = () => {
      try { socket.destroy(); } catch { /* noop */ }
      try { upstreamSocket?.destroy(); } catch { /* noop */ }
      if (tracker) {
        tracker.remove(target.name, upstreamReq);
        if (upstreamSocket) tracker.remove(target.name, upstreamSocket);
      }
    };
    if (tracker) tracker.add(target.name, upstreamReq);

    const handshakeTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          socket.write('HTTP/1.1 504 Gateway Timeout\r\nConnection: close\r\n\r\n');
        } catch { /* noop */ }
        destroyPair();
      }
    }, WS_HANDSHAKE_TIMEOUT_MS);
    handshakeTimer.unref?.();

    upstreamReq.on('upgrade', (upstreamRes, upSocket, upHead) => {
      settled = true;
      clearTimeout(handshakeTimer);
      upstreamSocket = upSocket;
      upSocket.setNoDelay(true);
      socket.setNoDelay(true);
      if (tracker) tracker.add(target.name, upSocket);

      // 101 status line + rewritten handshake headers (see rewriteUpgradeHeaders).
      let headLines = `HTTP/1.1 101 Switching Protocols\r\n`;
      for (const [key, value] of Object.entries(rewriteUpgradeHeaders(upstreamRes.headers, target))) {
        if (Array.isArray(value)) {
          for (const v of value) headLines += `${key}: ${v}\r\n`;
        } else {
          headLines += `${key}: ${value}\r\n`;
        }
      }
      headLines += '\r\n';
      try {
        socket.write(headLines);
        if (upHead && upHead.length) socket.write(upHead);
        upSocket.pipe(socket);
        socket.pipe(upSocket);
      } catch (err) {
        reportSwallowed('plugin-proxy.ws-pipe', err);
        destroyPair();
        return;
      }
      upSocket.on('error', (err) => { reportSwallowed('plugin-proxy.ws-upstream', err); destroyPair(); });
      socket.on('error', (err) => { reportSwallowed('plugin-proxy.ws-client', err); destroyPair(); });
      upSocket.on('close', () => destroyPair());
      socket.on('close', () => destroyPair());
    });

    upstreamReq.on('response', (upstreamRes) => {
      // Non-101: forward status line + headers + body, then close both ends.
      // Headers must be rebuilt, not echoed: the Node client already decoded chunked/gzip, so
      // echoing transfer-encoding makes the downstream parse plaintext as chunked (parse error).
      settled = true;
      clearTimeout(handshakeTimer);
      try {
        const bodyChunks = [];
        upstreamRes.on('data', (c) => bodyChunks.push(c));
        upstreamRes.on('end', () => {
          const body = Buffer.concat(bodyChunks);
          const headers = {};
          for (const [key, value] of Object.entries(upstreamRes.headers)) {
            const k = key.toLowerCase();
            if (HOP_BY_HOP.has(k) || k === 'content-length') continue;
            headers[key] = value;
          }
          headers['content-length'] = String(body.length);
          let headLines = `HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage || ''}\r\n`;
          for (const [key, value] of Object.entries(headers)) {
            if (Array.isArray(value)) {
              for (const v of value) headLines += `${key}: ${v}\r\n`;
            } else {
              headLines += `${key}: ${value}\r\n`;
            }
          }
          headLines += '\r\n';
          try {
            socket.write(headLines);
            socket.write(body);
          } catch { /* noop */ }
          destroyPair();
        });
        upstreamRes.on('error', () => destroyPair());
      } catch (err) {
        reportSwallowed('plugin-proxy.ws-non101', err);
        destroyPair();
      }
    });

    upstreamReq.on('error', (err) => {
      reportSwallowed('plugin-proxy.ws-connect', err);
      if (!settled) {
        settled = true;
        clearTimeout(handshakeTimer);
        try {
          socket.write(`HTTP/1.1 502 Bad Gateway\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n${JSON.stringify({ error: `plugin "${target.name}" upstream error` })}`);
        } catch { /* noop */ }
      }
      destroyPair();
    });

    // The caller attached error/close before the async section; add a close fallback here
    socket.on('close', () => {
      if (!settled) {
        settled = true;
        clearTimeout(handshakeTimer);
        upstreamReq.destroy();
      }
    });

    if (head && head.length) {
      // The upgrade event's head is the client's first packet - write it upstream right after the headers
      upstreamReq.write(head);
    }
    upstreamReq.end();
  } catch (err) {
    reportSwallowed('plugin-proxy.upgrade', err);
    try { socket.destroy(); } catch { /* noop */ }
  }
}
