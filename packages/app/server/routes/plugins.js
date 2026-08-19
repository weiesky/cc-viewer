// Plugin management routes (moved verbatim from server.js handleRequest).
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { loadPlugins, getPluginsInfo, getPluginsDir } from '../lib/plugin-loader.js';
import { uploadPlugins, installPluginFromUrl } from '../lib/plugin-manager.js';
import { SERVER_LIB } from '../_paths.js';

function pluginsList(req, res) {
  const plugins = getPluginsInfo();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ plugins, pluginsDir: getPluginsDir() }));
}

async function pluginsDelete(req, res, parsedUrl) {
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
    await loadPlugins();
    const plugins = getPluginsInfo();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, plugins, pluginsDir: getPluginsDir() }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function pluginsReload(req, res) {
  try {
    await loadPlugins();
    const plugins = getPluginsInfo();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, plugins, pluginsDir: getPluginsDir() }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

function pluginsUpload(req, res, parsedUrl, isLocal, deps) {
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > deps.MAX_POST_BODY) req.destroy(); });
  req.on('end', async () => {
    try {
      const { files: fileList } = JSON.parse(body);
      uploadPlugins(getPluginsDir(), fileList);
      await loadPlugins();
      const plugins = getPluginsInfo();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, plugins, pluginsDir: getPluginsDir() }));
    } catch (err) {
      const status = err.statusCode || 500;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

function pluginsInstallFromUrl(req, res, parsedUrl, isLocal, deps) {
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > deps.MAX_POST_BODY) req.destroy(); });
  req.on('end', async () => {
    try {
      const { url: fileUrl } = JSON.parse(body);
      const extractScript = join(SERVER_LIB, 'extract-plugin-name.mjs');
      await installPluginFromUrl(getPluginsDir(), fileUrl, extractScript);
      await loadPlugins();
      const plugins = getPluginsInfo();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, plugins, pluginsDir: getPluginsDir() }));
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
  { method: 'POST', match: 'exact', path: '/api/plugins/upload', handler: pluginsUpload },
  { method: 'POST', match: 'exact', path: '/api/plugins/install-from-url', handler: pluginsInstallFromUrl },
];
