// Plugin management routes (moved verbatim from server.js handleRequest).
// Write operations go through the plugin runtime's single-flight queue so service
// plugins are deactivated/stopped/re-spawned — never a bare loadPlugins() that would
// leave child processes behind.
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { getPluginsInfo, getPluginsDir, getPluginEntries } from '../lib/plugin-loader.js';
import { uploadPlugins, installPluginFromUrl, deletePluginDir } from '../lib/plugin-manager.js';
import {
  reloadRuntime,
  unloadPlugin,
  restartPlugin,
  getRuntimePluginStatus,
  isRuntimeStopping,
} from '../lib/plugin-runtime.js';
import { buildPanelDescriptor } from '../lib/plugin-panels.js';
import { SERVER_LIB } from '../_paths.js';
import { reportSwallowed } from '../lib/error-report.js';
import { isAdminReq } from '../lib/is-admin.js';
import { isSameOriginBrowserRequest } from '../lib/same-origin.js';

// Write endpoints execute arbitrary plugin code (reload/restart), install remote files,
// or delete on-disk plugins. They require an admin AND a same-origin browser context:
// the global ACAO:* prelude would otherwise let a cross-site page drive a localhost
// server that trusts its socket peer. CLI/native clients (no Origin) stay allowed.
function rejectWrite(req, res, isLocal, parsedUrl) {
  // Refuse during the shutdown teardown window: a reload/restart accepted here could
  // spawn a child after onServerStopping already swept the runtime, leaking a lock file.
  if (isRuntimeStopping()) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'server is stopping' }));
    return true;
  }
  if (isAdminReq(req, isLocal) && isSameOriginBrowserRequest(req, parsedUrl)) return false;
  res.writeHead(403, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Forbidden: admin and same-origin required' }));
  return true;
}

function decorateWithRuntime(plugins) {
  return plugins.map(p => {
    // Only service plugins have a service status; lifecycle-only dir plugins also get a
    // runtime entry, but exposing it as serviceStatus would imply a service exists.
    if (p.type !== 'service') return p;
    const status = getRuntimePluginStatus(p.name);
    return status ? { ...p, serviceStatus: status } : p;
  });
}

function pluginsList(req, res) {
  const plugins = decorateWithRuntime(getPluginsInfo());
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ plugins, pluginsDir: getPluginsDir() }));
}

async function pluginsDelete(req, res, parsedUrl, isLocal) {
  if (rejectWrite(req, res, isLocal, parsedUrl)) return;
  const dir = parsedUrl.searchParams.get('dir');
  if (dir) {
    try {
      const unloaded = await unloadPlugin(dir, 'delete');
      if (!unloaded.ok) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: unloaded.error || 'plugin runtime is stopping' }));
        return;
      }
      deletePluginDir(getPluginsDir(), dir);
      const result = await reloadRuntime();
      if (!result.ok) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: result.error || 'plugin runtime is stopping' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, plugins: decorateWithRuntime(getPluginsInfo()), pluginsDir: getPluginsDir(), generation: result.generation }));
    } catch (err) {
      res.writeHead(err.statusCode || 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }
  const file = parsedUrl.searchParams.get('file');
  if (!file || file.includes('..') || file.includes('/') || file.includes('\\')) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid file name' }));
    return;
  }
  const filePath = join(getPluginsDir(), file);
  try {
    if (!existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File not found' }));
      return;
    }
    unlinkSync(filePath);
    const result = await reloadRuntime();
    if (!result.ok) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: result.error || 'plugin runtime is stopping' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, plugins: decorateWithRuntime(getPluginsInfo()), pluginsDir: getPluginsDir(), generation: result.generation }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function pluginsReload(req, res, parsedUrl, isLocal) {
  if (rejectWrite(req, res, isLocal, parsedUrl)) return;
  try {
    // ?reason=disable: the UI disable toggle goes through preferences + reload, so deactivate must receive 'disable'
    const reason = parsedUrl && parsedUrl.searchParams.get('reason');
    const result = await reloadRuntime(reason === 'disable' ? { reason: 'disable' } : {});
    if (!result.ok) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: result.error || 'plugin runtime is stopping' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, plugins: decorateWithRuntime(getPluginsInfo()), pluginsDir: getPluginsDir(), generation: result.generation }));
  } catch (err) {
    reportSwallowed('plugins.reload', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function pluginsRestart(req, res, parsedUrl, isLocal) {
  if (rejectWrite(req, res, isLocal, parsedUrl)) return;
  const name = parsedUrl.searchParams.get('name');
  if (!name) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'name is required' }));
    return;
  }
  try {
    const result = await restartPlugin(name);
    res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    reportSwallowed('plugins.restart', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

function pluginPanelsList(req, res) {
  try {
    const panels = [];
    for (const entry of getPluginEntries()) {
      if (entry.shape !== 'dir' || !entry.enabled || entry.loadError || !entry.panel) continue;
      const status = getRuntimePluginStatus(entry.name);
      panels.push(buildPanelDescriptor(entry, { serviceStatus: status }));
    }
    panels.sort((a, b) => a.name.localeCompare(b.name));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, panels }));
  } catch (err) {
    reportSwallowed('plugins.panels', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

function pluginsUpload(req, res, parsedUrl, isLocal, deps) {
  if (rejectWrite(req, res, isLocal, parsedUrl)) return;
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > deps.MAX_POST_BODY) req.destroy(); });
  req.on('end', async () => {
    try {
      const { files: fileList } = JSON.parse(body);
      uploadPlugins(getPluginsDir(), fileList);
      const result = await reloadRuntime();
      if (!result.ok) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: result.error || 'plugin runtime is stopping' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, plugins: decorateWithRuntime(getPluginsInfo()), pluginsDir: getPluginsDir(), generation: result.generation }));
    } catch (err) {
      const status = err.statusCode || 500;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

function pluginsInstallFromUrl(req, res, parsedUrl, isLocal, deps) {
  if (rejectWrite(req, res, isLocal, parsedUrl)) return;
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > deps.MAX_POST_BODY) req.destroy(); });
  req.on('end', async () => {
    try {
      const { url: fileUrl } = JSON.parse(body);
      const extractScript = join(SERVER_LIB, 'extract-plugin-name.mjs');
      await installPluginFromUrl(getPluginsDir(), fileUrl, extractScript);
      const result = await reloadRuntime();
      if (!result.ok) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: result.error || 'plugin runtime is stopping' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, plugins: decorateWithRuntime(getPluginsInfo()), pluginsDir: getPluginsDir(), generation: result.generation }));
    } catch (err) {
      const status = err.statusCode || 500;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

export const pluginsRoutes = [
  { method: 'GET', match: 'exact', path: '/api/plugins', handler: pluginsList },
  { method: 'DELETE', match: 'exact', path: '/api/plugins', handler: pluginsDelete },
  { method: 'POST', match: 'exact', path: '/api/plugins/reload', handler: pluginsReload },
  { method: 'POST', match: 'exact', path: '/api/plugins/restart', handler: pluginsRestart },
  { method: 'GET', match: 'exact', path: '/api/plugin-panels', handler: pluginPanelsList },
  { method: 'POST', match: 'exact', path: '/api/plugins/upload', handler: pluginsUpload },
  { method: 'POST', match: 'exact', path: '/api/plugins/install-from-url', handler: pluginsInstallFromUrl },
];
