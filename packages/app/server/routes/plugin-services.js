// Routes for service-plugin proxies (/plugins/<name>/*) and panel bundles
// (/plugin-panels/<name>/*). Registered in server.js's _routes after pluginsRoutes.
// Unknown plugin names return 404 here — requests must NOT fall through to the SPA
// fallback (it would serve index.html as JS/JSON).
import { getPluginEntries } from '../lib/plugin-loader.js';
import { tryProxyHttp } from '../lib/plugin-runtime.js';
import { servePanelFile } from '../lib/plugin-panels.js';
import { reportSwallowed } from '../lib/error-report.js';
import { isSameOriginBrowserRequest } from '../lib/same-origin.js';

function findPanelEntry(name) {
  for (const entry of getPluginEntries()) {
    if (entry.shape === 'dir' && entry.enabled && !entry.loadError && entry.panel && entry.name === name) {
      return entry;
    }
  }
  return null;
}

function pluginProxyHandler(req, res, parsedUrl) {
  try {
    // Plugin services are same-machine capabilities reachable through the main origin.
    // A cross-site browser page must not drive them just because loopback trusts the
    // socket peer; CLI/native callers (no Origin) and same-origin pages pass.
    if (!isSameOriginBrowserRequest(req, parsedUrl)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden: cross-site plugin proxy request' }));
      return;
    }
    const handled = tryProxyHttp(req, res, parsedUrl);
    if (!handled) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unknown plugin service' }));
    }
  } catch (err) {
    reportSwallowed('plugin-services.proxy-route', err);
    try {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'plugin proxy failure' }));
      } else {
        res.destroy();
      }
    } catch { /* noop */ }
  }
}

function pluginPanelHandler(req, res, parsedUrl) {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('method not allowed');
      return;
    }
    // /plugin-panels/<name>/<rel...>
    const rest = parsedUrl.pathname.slice('/plugin-panels/'.length);
    const slash = rest.indexOf('/');
    const name = slash === -1 ? rest : rest.slice(0, slash);
    const relPath = slash === -1 ? '' : rest.slice(slash + 1);
    let decodedName;
    try {
      decodedName = decodeURIComponent(name);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('bad plugin name');
      return;
    }
    const entry = findPanelEntry(decodedName);
    if (!entry) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('unknown plugin panel');
      return;
    }
    if (!relPath) {
      // Bare directory path -> entry bundle (relative rootDir = drop the first segment of entryRel)
      const entryRel = entry.panel.entryRel;
      const rel = entryRel.slice(entryRel.indexOf('/') + 1);
      servePanelFile(req, res, entry, rel);
      return;
    }
    servePanelFile(req, res, entry, relPath);
  } catch (err) {
    reportSwallowed('plugin-services.panel-route', err);
    try {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('panel route failure');
      } else {
        res.destroy();
      }
    } catch { /* noop */ }
  }
}

export const pluginServicesRoutes = [
  {
    predicate: (url) => url === '/plugins' || url.startsWith('/plugins/'),
    handler: pluginProxyHandler,
  },
  {
    predicate: (url) => url === '/plugin-panels' || url.startsWith('/plugin-panels/'),
    handler: pluginPanelHandler,
  },
];
