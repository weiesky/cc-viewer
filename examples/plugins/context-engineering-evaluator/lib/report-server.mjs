import { createServer } from 'node:http';
import { readdirSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { renderRunList, renderRunDetail } from './html-renderer.mjs';

const DEFAULT_PORT = 7799;
const DEFAULT_REPORTS_DIR = join(homedir(), '.claude', 'cc-viewer', 'eval-reports');

export function createReportServer({ reportsDir = DEFAULT_REPORTS_DIR } = {}) {
  let server = null;
  let serverUrl = null;

  function loadRuns() {
    if (!existsSync(reportsDir)) return [];
    const files = readdirSync(reportsDir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse();
    const runs = [];
    for (const file of files) {
      try {
        const data = JSON.parse(readFileSync(join(reportsDir, file), 'utf-8'));
        if (data && data.meta) {
          if (!data.id) data.id = file.replace(/\.json$/, '');
          runs.push(data);
        }
      } catch {}
    }
    return runs;
  }

  function findRun(id) {
    const filePath = join(reportsDir, `${id}.json`);
    if (!existsSync(filePath)) return null;
    try {
      const data = JSON.parse(readFileSync(filePath, 'utf-8'));
      if (!data.id) data.id = id;
      return data;
    } catch {
      return null;
    }
  }

  function handleRequest(req, res) {
    try {
      const parsed = new URL(req.url || '/', 'http://127.0.0.1');
      const path = parsed.pathname;

      if (path === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, service: 'cc-insight' }));
        return;
      }

      if (path === '/api/runs') {
        const runs = loadRuns().map((r) => ({ id: r.id, meta: r.meta, summary: r.summary }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(runs));
        return;
      }

      const runApiMatch = path.match(/^\/api\/run\/(.+)$/);
      if (runApiMatch) {
        const run = findRun(decodeURIComponent(runApiMatch[1]));
        if (!run) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'run not found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(run));
        return;
      }

      const runPageMatch = path.match(/^\/run\/(.+)$/);
      if (runPageMatch) {
        const run = findRun(decodeURIComponent(runPageMatch[1]));
        res.writeHead(run ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderRunDetail(run));
        return;
      }

      if (path === '/') {
        const runs = loadRuns();
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderRunList(runs));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }

  async function start() {
    if (server) return serverUrl;
    if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });

    const port = Number(process.env.CCV_INSIGHT_PORT || DEFAULT_PORT);
    const host = '127.0.0.1';

    const boot = (p) => new Promise((resolve, reject) => {
      const srv = createServer(handleRequest);
      srv.once('error', reject);
      srv.listen(p, host, () => resolve(srv));
    });

    try {
      server = await boot(port);
    } catch {
      server = await boot(0);
    }

    const addr = server.address();
    serverUrl = `http://${host}:${addr.port}`;
    console.error(`[cc-insight] report server started: ${serverUrl}`);
    return serverUrl;
  }

  async function stop() {
    if (!server) return;
    await new Promise((resolve) => server.close(() => resolve()));
    server = null;
    serverUrl = null;
  }

  function getUrl() {
    return serverUrl;
  }

  return { start, stop, getUrl, loadRuns, findRun };
}
