// Proxy retry stats routes — HTTP endpoints for proxy retry statistics.
//
// The stats-worker scans proxy_*.jsonl detail logs and aggregates them into the
// proxyStats field of <project>/<project>.json (same file as token stats). These
// routes only read that data and trigger refreshes.
//
// Route shape follows the _dispatch.js descriptor convention:
//   { method, match: 'exact'|'prefix', path, handler(req, res, parsedUrl, isLocal, deps) }
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { LOG_DIR } from '../../findcc.js';
import { _projectName } from '../interceptor.js';

// GET /api/proxy-stats — returns the current project's proxy retry stats (proxyStats field).
// Response body: { proxyStats: {...} }; proxyStats is null when there is no data.
function getProxyStats(req, res) {
  try {
    if (!_projectName) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No project name', proxyStats: null }));
      return;
    }
    const statsFile = join(LOG_DIR, _projectName, `${_projectName}.json`);
    if (!existsSync(statsFile)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ proxyStats: null }));
      return;
    }
    const stats = JSON.parse(readFileSync(statsFile, 'utf-8'));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ proxyStats: stats.proxyStats || null }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message, proxyStats: null }));
  }
}

// POST /api/refresh-proxy-stats — triggers a full re-scan by the stats-worker (including proxy detail aggregation).
// Reuses the existing worker's scan-all message mechanism; shares the same worker as /api/refresh-stats.
// scan-all refreshes both token stats and proxy stats (both are produced in the same generateProjectStats run).
//
// Review P2 fix — in-flight coalescing: the old handler attached one worker
// listener per request (30s lifetime → listener pile-up under repeated
// clicks/floods) and resolved on ANY scan-all-done (two concurrent refreshes
// cross-resolved each other). Now a module-level latch: the first request
// starts ONE scan with ONE listener; requests arriving while it runs just
// join the waiter list and share its completion. A flood of POSTs therefore
// costs a single full scan instead of N.
let _refreshWaiters = null; // Array<res> while a scan is in flight

function refreshProxyStats(req, res, parsedUrl, isLocal, deps) {
  try {
    if (!deps.statsWorker) deps.startStatsWorker();
    if (!deps.statsWorker) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Stats worker not available' }));
      return;
    }
    if (_refreshWaiters) {
      _refreshWaiters.push(res); // join the in-flight scan
      return;
    }
    _refreshWaiters = [res];
    const worker = deps.statsWorker;
    const finish = (status, body) => {
      const waiters = _refreshWaiters || [];
      _refreshWaiters = null;
      clearTimeout(timeout);
      worker.removeListener('message', onDone);
      const payload = JSON.stringify(body);
      for (const r of waiters) {
        try {
          r.writeHead(status, { 'Content-Type': 'application/json' });
          r.end(payload);
        } catch { /* client may have disconnected while waiting */ }
      }
    };
    const timeout = setTimeout(() => finish(504, { error: 'Proxy stats refresh timed out' }), 30000);
    timeout.unref?.();
    const onDone = (m) => {
      if (m.type === 'scan-all-done') finish(200, { ok: true });
    };
    worker.on('message', onDone);
    worker.postMessage({ type: 'scan-all', logDir: LOG_DIR });
  } catch (err) {
    _refreshWaiters = null;
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

export const proxyStatsRoutes = [
  { method: 'GET', match: 'exact', path: '/api/proxy-stats', handler: getProxyStats },
  { method: 'POST', match: 'exact', path: '/api/refresh-proxy-stats', handler: refreshProxyStats },
];
