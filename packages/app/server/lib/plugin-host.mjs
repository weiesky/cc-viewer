// plugin-host.mjs — SDK for service-plugin child processes. Loaded by the plugin's
// service entry (service.mjs) via the CCV_PLUGIN_HOST file:// URL; never imported by
// the main cc-viewer process.
//
// Wraps the wire contract between parent and child so third-party services only write
// request handlers:
//   - HTTP server on 127.0.0.1:0 (random loopback port, no port races)
//   - x-ccv-plugin-secret check on EVERY route (the parent proxy is the only legitimate
//     caller; the child must not trust anything else on loopback)
//   - GET /__ccv/health with a forced nonce (plugins cannot override identity fields)
//   - atomic lock-file write (temp + rename) so the parent can discover pid/port
//   - SIGTERM/SIGINT graceful shutdown, parent-process watchdog (PPID change → exit)
//   - re-exports ws (WebSocketServer/WebSocket): bare 'ws' resolves against THIS file's
//     location (cc-viewer's own dependency), so plugins must not `import 'ws'` themselves.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { timingSafeEqual } from 'node:crypto';

export { WebSocket, WebSocketServer } from 'ws';

function readConfig() {
  const configPath = process.env.CCV_PLUGIN_CONFIG;
  if (!configPath) {
    throw new Error('CCV_PLUGIN_CONFIG is not set — service entries must be spawned by cc-viewer');
  }
  return JSON.parse(readFileSync(configPath, 'utf-8'));
}

export const config = readConfig();
export const plugin = {
  name: config.name,
  version: config.version ?? null,
  dir: config.pluginDir,
  dataDir: config.dataDir,
  prefix: config.prefix,
};
export const parent = {
  port: config.parentPort ?? null,
  basePath: config.parentBasePath || '',
  url: config.parentPort ? `http://127.0.0.1:${config.parentPort}${config.parentBasePath || ''}` : null,
};

/**
 * Call the parent's HTTP API. Loopback parent APIs are token-free; the internal header
 * marks plugin traffic for the host interceptor. Never append the ACCESS_TOKEN here.
 */
export async function callParent(path, init = {}) {
  if (!parent.url) throw new Error('parent port is not available');
  const headers = { 'x-cc-viewer-internal': '1', ...(init.headers || {}) };
  return fetch(`${parent.url}${path}`, { ...init, headers });
}

function secretMatches(headerValue, secret) {
  if (!headerValue || !secret) return false;
  const a = Buffer.from(String(headerValue));
  const b = Buffer.from(String(secret));
  // timingSafeEqual throws on length mismatch - compare lengths first
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function writeLockAtomic(lockPath, body) {
  mkdirSync(dirname(lockPath), { recursive: true });
  const tmpPath = `${lockPath}.tmp-${process.pid}`;
  writeFileSync(tmpPath, JSON.stringify(body), { mode: 0o600 });
  renameSync(tmpPath, lockPath);
}

/**
 * Start the plugin service.
 * @param {object} opts
 * @param {(req, res) => void | Promise<void>} opts.onRequest  standard node http handler
 * @param {(req, socket, head) => void} [opts.onUpgrade]       optional ws upgrade handler
 * @param {() => object} [opts.health]                         extra health fields (identity is forced)
 * @returns {Promise<{ server, port, close():Promise<void> }>}
 */
export async function startPluginService(opts = {}) {
  if (typeof opts.onRequest !== 'function') {
    throw new Error('startPluginService requires onRequest(req, res)');
  }
  const secret = config.secret;
  const nonce = config.nonce;
  const lockPath = process.env.CCV_PLUGIN_LOCK || config.lockPath;

  const server = createServer(async (req, res) => {
    try {
      if (!secretMatches(req.headers['x-ccv-plugin-secret'], secret)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid plugin secret' }));
        return;
      }
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/__ccv/health') {
        const extra = typeof opts.health === 'function' ? (opts.health() || {}) : {};
        res.writeHead(200, { 'Content-Type': 'application/json' });
        // Identity fields are written last so a plugin's custom health cannot override them
        res.end(JSON.stringify({
          ...extra,
          ok: true,
          name: config.name,
          pid: process.pid,
          version: config.version ?? null,
          nonce,
        }));
        return;
      }
      await opts.onRequest(req, res);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err && err.message || err) }));
      } else {
        res.destroy();
      }
    }
  });

  server.on('upgrade', (req, socket, head) => {
    try {
      if (!secretMatches(req.headers['x-ccv-plugin-secret'], secret)) {
        socket.destroy();
        return;
      }
      if (typeof opts.onUpgrade === 'function') {
        opts.onUpgrade(req, socket, head);
      } else {
        socket.destroy();
      }
    } catch {
      try { socket.destroy(); } catch { /* noop */ }
    }
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });
  const port = server.address().port;

  const lockBody = {
    pid: process.pid,
    port,
    parentPid: config.parentPid ?? process.ppid,
    name: config.name,
    generation: config.generation ?? null,
    nonce,
    bootNonce: config.bootNonce ?? null,
    startedAt: new Date().toISOString(),
  };
  writeLockAtomic(lockPath, lockBody);

  let closed = false;
  const close = () => new Promise((resolveClose) => {
    if (closed) { resolveClose(); return; }
    closed = true;
    clearInterval(watchdog);
    try { unlinkSync(lockPath); } catch { /* noop */ }
    const forceTimer = setTimeout(() => process.exit(0), 2000);
    forceTimer.unref?.();
    server.close(() => {
      clearTimeout(forceTimer);
      resolveClose();
    });
    try { server.closeAllConnections?.(); } catch { /* noop */ }
  });

  process.on('SIGTERM', () => { close().then(() => process.exit(0)); });
  process.on('SIGINT', () => { close().then(() => process.exit(0)); });

  // Parent watchdog: a PPID change (parent died/adopted as orphan) -> exit and release port + lock
  const initialPpid = process.ppid;
  const watchdog = setInterval(() => {
    let parentAlive = true;
    try {
      process.kill(initialPpid, 0);
    } catch {
      parentAlive = false;
    }
    if (!parentAlive || process.ppid !== initialPpid) {
      process.exit(0);
    }
  }, 2000);
  watchdog.unref?.();

  const logPrefix = `[plugin:${config.name}]`;
  return {
    server,
    port,
    close,
    log: (...args) => console.log(logPrefix, ...args),
    warn: (...args) => console.warn(logPrefix, ...args),
    error: (...args) => console.error(logPrefix, ...args),
  };
}
