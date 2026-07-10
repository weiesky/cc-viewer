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
function refreshProxyStats(req, res, parsedUrl, isLocal, deps) {
  try {
    if (!deps.statsWorker) deps.startStatsWorker();
    if (deps.statsWorker) {
      const timeout = setTimeout(() => {
        deps.statsWorker?.removeListener('message', onDone);
        res.writeHead(504, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Proxy stats refresh timed out' }));
      }, 30000);
      const onDone = (m) => {
        if (m.type === 'scan-all-done') {
          clearTimeout(timeout);
          deps.statsWorker?.removeListener('message', onDone);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        }
      };
      deps.statsWorker.on('message', onDone);
      deps.statsWorker.postMessage({ type: 'scan-all', logDir: LOG_DIR });
    } else {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Stats worker not available' }));
    }
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

export const proxyStatsRoutes = [
  { method: 'GET', match: 'exact', path: '/api/proxy-stats', handler: getProxyStats },
  { method: 'POST', match: 'exact', path: '/api/refresh-proxy-stats', handler: refreshProxyStats },
];
