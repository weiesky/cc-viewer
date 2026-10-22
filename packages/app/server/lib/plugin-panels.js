// Plugin panel descriptors + static bundle serving for /plugin-panels/<name>/*.
//
// Static root is the directory containing panel.entry (a .js bundle) — NEVER the plugin
// root, so main.mjs/service.mjs/helpers can never be served. The manifest's resolved
// main/service paths are additionally rejected by realpath even if an author drops a
// copy inside panel/. Extension whitelist excludes .html/.json/.map/.mjs.
import { createReadStream, statSync, realpathSync } from 'node:fs';
import { join, extname, relative, isAbsolute } from 'node:path';
import { reportSwallowed } from './error-report.js';

const EXT_MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function realpathSafe(p) {
  try { return realpathSync(p); } catch { return null; }
}

function isInside(parent, child) {
  const rel = relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Build one panel descriptor for GET /api/plugin-panels.
 * entry: loader directory-plugin entry (panel info + fingerprint).
 * serviceStatus: supplied by the runtime (may be null).
 */
export function buildPanelDescriptor(entry, { serviceStatus = null } = {}) {
  const p = entry.panel;
  let entryStats = null;
  try { entryStats = statSync(p.entryPath); } catch { /* bundle missing */ }
  const panelStatus = entryStats ? 'ready' : 'missing';
  return {
    name: entry.name,
    title: p.title || entry.name,
    titleI18n: p.titleI18n || null,
    version: entry.manifest?.version ?? null,
    icon: p.icon,
    width: p.width,
    desktopOnly: p.desktopOnly,
    // Fingerprint goes into the URL so the frontend reloads the bundle after it changes (otherwise hot reload is an illusion)
    entryUrl: entryStats ? `/plugin-panels/${encodeURIComponent(entry.name)}/${relative(p.rootDir, p.entryPath).split('\\').join('/')}?v=${p.fingerprint}` : null,
    cssUrl: p.cssPath && exists(p.cssPath)
      ? `/plugin-panels/${encodeURIComponent(entry.name)}/${relative(p.rootDir, p.cssPath).split('\\').join('/')}?v=${p.fingerprint}`
      : null,
    assetBaseUrl: `/plugin-panels/${encodeURIComponent(entry.name)}/`,
    prefix: entry.service ? entry.service.prefix : null,
    panelStatus,
    // Only service plugins have a serviceStatus; panel-only plugins are null so the UI
    // does not report a service that never existed. When the runtime has not started
    // (or has no record), report null = unknown instead of fabricating 'ready'.
    serviceStatus: entry.service ? (serviceStatus ? serviceStatus.state : null) : null,
    error: serviceStatus?.lastError ?? null,
  };
}

function exists(p) {
  try { statSync(p); return true; } catch { return false; }
}

/**
 * Resolve /plugin-panels/<name>/<rel> to a file on disk.
 * @returns {{ filePath, stat } | { error, status } }
 */
export function resolvePanelFile(entry, relPath) {
  if (!relPath || relPath.includes('\0') || relPath.includes('\\')) {
    return { error: 'illegal path', status: 400 };
  }
  let decoded;
  try {
    decoded = decodeURIComponent(relPath);
  } catch {
    return { error: 'bad encoding', status: 400 };
  }
  const segments = decoded.split('/');
  if (segments.some(s => s === '..' || s === '.' || s === '')) {
    return { error: 'illegal segments', status: 400 };
  }
  const lastSegment = segments[segments.length - 1];
  if (lastSegment.startsWith('.')) {
    return { error: 'dotfiles rejected', status: 404 };
  }
  const ext = extname(lastSegment).toLowerCase();
  if (!EXT_MIME[ext]) {
    return { error: 'extension not allowed', status: 404 };
  }
  const rootDir = entry.panel.rootDir;
  const target = join(rootDir, ...segments);
  const realRoot = realpathSafe(rootDir);
  const realTarget = realpathSafe(target);
  if (!realRoot || !realTarget) {
    return { error: 'not found', status: 404 };
  }
  const rootCmp = process.platform === 'win32' ? realRoot.toLowerCase() : realRoot;
  const targetCmp = process.platform === 'win32' ? realTarget.toLowerCase() : realTarget;
  if (!isInside(rootCmp, targetCmp)) {
    return { error: 'escapes panel root', status: 403 };
  }
  // Explicitly reject the manifest's resolved main/service paths even if copied into panel/
  const forbidden = [entry.manifest?.mainPath, entry.service?.entryPath].filter(Boolean);
  for (const f of forbidden) {
    const fCmp = process.platform === 'win32' ? f.toLowerCase() : f;
    if (fCmp === targetCmp) {
      return { error: 'source files are not served', status: 404 };
    }
  }
  let stat;
  try {
    stat = statSync(realTarget);
  } catch {
    return { error: 'not found', status: 404 };
  }
  if (!stat.isFile()) {
    return { error: 'not found', status: 404 };
  }
  return { filePath: realTarget, stat };
}

/**
 * Serve a panel static file. Never throws (dispatch has no try/catch).
 * @returns true (handled, including 404)
 */
export function servePanelFile(req, res, entry, relPath) {
  try {
    const resolved = resolvePanelFile(entry, relPath);
    if (resolved.error) {
      res.writeHead(resolved.status, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(resolved.error);
      return true;
    }
    const { filePath, stat } = resolved;
    const ext = extname(filePath).toLowerCase();
    const etag = `W/"${stat.mtimeMs}-${stat.size}"`;
    const headers = {
      'Content-Type': EXT_MIME[ext],
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ETag: etag,
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' });
      res.end();
      return true;
    }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    const stream = createReadStream(filePath);
    stream.on('error', (err) => {
      reportSwallowed('plugin-panels.stream', err);
      res.destroy();
    });
    stream.pipe(res);
    return true;
  } catch (err) {
    reportSwallowed('plugin-panels.serve', err);
    try {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('panel serve failure');
      } else {
        res.destroy();
      }
    } catch { /* noop */ }
    return true;
  }
}
