// Service-plugin manifest (plugin.json) parsing, validation and fingerprints.
// A directory plugin lives in <pluginsDir>/<name>/ with a plugin.json manifest:
//   { name, version?, main?, service?: {entry,prefix?,env?}, panel?: {entry,css?,title?,icon?,width?,desktopOnly?}, config?: {defaults?} }
import { readFileSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { join, dirname, resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { reportSwallowed } from './error-report.js';

export const PLUGIN_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const SERVICE_PREFIX_RE = /^\/plugins\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PANEL_ICON_WHITELIST = new Set(['api', 'dashboard', 'appstore', 'tool', 'database', 'chart', 'file', 'global']);
const MAIN_CANDIDATES = ['main.mjs', 'main.js', 'index.mjs', 'index.js'];
const FINGERPRINT_MAX_FILES = 64;
const FINGERPRINT_MAX_BYTES = 4 * 1024 * 1024;

export function validatePluginName(name) {
  return typeof name === 'string' && PLUGIN_NAME_RE.test(name);
}

export function defaultServicePrefix(name) {
  return `/plugins/${name}`;
}

export function validateServicePrefix(prefix) {
  return typeof prefix === 'string' && SERVICE_PREFIX_RE.test(prefix);
}

function isPathInside(parent, child) {
  const rel = relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function realpathSafe(p) {
  try {
    return realpathSync(p);
  } catch (err) {
    reportSwallowed('plugin-manifest.realpath', err);
    return null;
  }
}

/**
 * Resolve a manifest-relative path and ensure it stays inside the plugin dir.
 * Returns { abs, real } or { error }.
 */
export function resolveInsidePluginDir(pluginDir, relPath, label) {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    return { error: `${label} must be a non-empty string` };
  }
  if (relPath.includes('\0') || relPath.includes('\\')) {
    return { error: `${label} contains illegal characters` };
  }
  // manifest fields must not contain explicit './'/'../'; internal callers (e.g. import resolution) may allowDotSegments
  const segments = relPath.split('/');
  if (segments.some(s => s === '..' || s === '.')) {
    return { error: `${label} must not contain '.' or '..' segments` };
  }
  return resolvePluginPath(pluginDir, relPath, label);
}

function resolvePluginPath(pluginDir, relPath, label) {
  const abs = resolve(pluginDir, relPath);
  const realRoot = realpathSafe(pluginDir);
  const realTarget = realpathSafe(abs);
  if (!realRoot || !realTarget) {
    return { error: `${label} does not exist: ${relPath}` };
  }
  // Windows filesystems are case-insensitive: compare in lowercase
  const rootCmp = process.platform === 'win32' ? realRoot.toLowerCase() : realRoot;
  const targetCmp = process.platform === 'win32' ? realTarget.toLowerCase() : realTarget;
  if (!isPathInside(rootCmp, targetCmp) && rootCmp !== targetCmp) {
    return { error: `${label} escapes plugin directory: ${relPath}` };
  }
  return { abs, real: realTarget };
}

/**
 * Parse and validate plugin.json in a directory. Never executes plugin code.
 * Returns { manifest, error }.
 */
export function parsePluginManifest(pluginDir) {
  const manifestPath = join(pluginDir, 'plugin.json');
  let raw;
  try {
    raw = readFileSync(manifestPath, 'utf-8');
  } catch {
    return { error: 'missing plugin.json' };
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    return { error: `plugin.json is not valid JSON: ${err.message}` };
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { error: 'plugin.json must be an object' };
  }
  if (!validatePluginName(json.name)) {
    return { error: `invalid plugin name: ${JSON.stringify(json.name)} (must match ${PLUGIN_NAME_RE})` };
  }
  const manifest = {
    name: json.name,
    version: typeof json.version === 'string' ? json.version : null,
    description: typeof json.description === 'string' ? json.description : null,
    raw: raw,
  };

  // main: optional; probed from candidate names by default. When declared explicitly it must live inside the plugin directory
  if (json.main !== undefined) {
    const r = resolveInsidePluginDir(pluginDir, json.main, 'main');
    if (r.error) return { error: r.error };
    manifest.mainRel = json.main;
    manifest.mainPath = r.real;
  } else {
    manifest.mainRel = null;
    manifest.mainPath = null;
    for (const candidate of MAIN_CANDIDATES) {
      const r = resolveInsidePluginDir(pluginDir, candidate, 'main');
      if (!r.error) {
        manifest.mainRel = candidate;
        manifest.mainPath = r.real;
        break;
      }
    }
  }

  // service: optional; entry is required and must exist inside the plugin directory.
  // prefix is locked to /plugins/<name> for now (the mount table routes by name); opening
  // custom prefixes later requires a prefix index so a half-state cannot ship.
  if (json.service !== undefined) {
    if (!json.service || typeof json.service !== 'object') {
      return { error: 'service must be an object' };
    }
    const prefix = json.service.prefix !== undefined ? json.service.prefix : defaultServicePrefix(manifest.name);
    if (!validateServicePrefix(prefix)) {
      return { error: `invalid service.prefix: ${JSON.stringify(prefix)} (must match ${SERVICE_PREFIX_RE})` };
    }
    if (prefix !== defaultServicePrefix(manifest.name)) {
      return { error: `service.prefix must be ${defaultServicePrefix(manifest.name)} in v1 (custom prefixes are not routable yet)` };
    }
    const r = resolveInsidePluginDir(pluginDir, json.service.entry, 'service.entry');
    if (r.error) return { error: r.error };
    const env = {};
    if (json.service.env !== undefined) {
      if (!json.service.env || typeof json.service.env !== 'object' || Array.isArray(json.service.env)) {
        return { error: 'service.env must be an object of string values' };
      }
      for (const [k, v] of Object.entries(json.service.env)) {
        if (k.startsWith('CCV_') || k.startsWith('CCVIEWER_')) {
          return { error: `service.env must not override reserved variable: ${k}` };
        }
        if (typeof v !== 'string') {
          return { error: `service.env.${k} must be a string` };
        }
        env[k] = v;
      }
    }
    manifest.service = { entryRel: json.service.entry, entryPath: r.real, prefix, env };
  } else {
    manifest.service = null;
  }

  // panel: optional; entry must be a .js bundle in a subdirectory (dirname != plugin root, so main/service never become the static root)
  if (json.panel !== undefined) {
    if (!json.panel || typeof json.panel !== 'object') {
      return { error: 'panel must be an object' };
    }
    const entry = json.panel.entry;
    if (typeof entry !== 'string' || !entry.endsWith('.js')) {
      return { error: 'panel.entry must be a .js bundle path (iframe-style .html panels are no longer supported)' };
    }
    if (dirname(entry) === '.') {
      return { error: 'panel.entry must live inside a subdirectory (e.g. panel/index.js), not the plugin root' };
    }
    const r = resolveInsidePluginDir(pluginDir, entry, 'panel.entry');
    if (r.error) return { error: r.error };
    const panel = {
      entryRel: entry,
      entryPath: r.real,
      // static root = the directory containing entry (after realpath)
      rootDir: dirname(r.real),
      cssRel: null,
      cssPath: null,
      title: null,
      titleI18n: null,
      icon: 'appstore',
      width: 1100,
      desktopOnly: false,
    };
    if (json.panel.css !== undefined) {
      const css = json.panel.css;
      if (typeof css !== 'string' || !css.endsWith('.css') || dirname(css) === '.') {
        return { error: 'panel.css must be a .css path inside a subdirectory' };
      }
      const rc = resolveInsidePluginDir(pluginDir, css, 'panel.css');
      if (rc.error) return { error: rc.error };
      if (dirname(rc.real) !== panel.rootDir) {
        return { error: 'panel.css must live in the same directory as panel.entry' };
      }
      panel.cssRel = css;
      panel.cssPath = rc.real;
    }
    if (typeof json.panel.title === 'string') {
      panel.title = json.panel.title;
    } else if (json.panel.title && typeof json.panel.title === 'object') {
      panel.titleI18n = {};
      for (const [lang, text] of Object.entries(json.panel.title)) {
        if (typeof text === 'string') panel.titleI18n[lang] = text;
      }
    }
    if (json.panel.icon !== undefined) {
      panel.icon = PANEL_ICON_WHITELIST.has(json.panel.icon) ? json.panel.icon : 'appstore';
    }
    if (json.panel.width !== undefined) {
      const w = Number(json.panel.width);
      if (Number.isFinite(w)) panel.width = Math.min(1600, Math.max(360, Math.round(w)));
    }
    panel.desktopOnly = json.panel.desktopOnly === true;
    manifest.panel = panel;
  } else {
    manifest.panel = null;
  }

  // config.defaults: optional static defaults (does not go through the preferences write path)
  manifest.configDefaults = {};
  if (json.config !== undefined) {
    if (!json.config || typeof json.config !== 'object' || Array.isArray(json.config)) {
      return { error: 'config must be an object' };
    }
    if (json.config.defaults !== undefined) {
      if (!json.config.defaults || typeof json.config.defaults !== 'object' || Array.isArray(json.config.defaults)) {
        return { error: 'config.defaults must be an object' };
      }
      manifest.configDefaults = json.config.defaults;
    }
  }

  return { manifest };
}

/**
 * Collect static relative imports of a main module (one level deep), so helper
 * edits also bust the fingerprint. Best-effort: unparseable imports are ignored.
 */
export function collectMainDependencyPaths(mainPath, pluginDir) {
  const deps = [];
  let src;
  try {
    src = readFileSync(mainPath, 'utf-8');
  } catch (err) {
    reportSwallowed('plugin-manifest.read-main', err);
    return deps;
  }
  const importRe = /import\s+(?:[^'"]*\s+from\s+)?['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = importRe.exec(src)) !== null) {
    // import specifiers commonly start with './'; the realpath containment check is the escape backstop
    const r = resolvePluginPath(pluginDir, m[1], 'import');
    if (!r.error) deps.push(r.real);
    if (deps.length >= FINGERPRINT_MAX_FILES) break;
  }
  return deps.sort();
}

/**
 * Fingerprint for the main-process module: manifest bytes + main bytes +
 * one-level helper bytes. Falls back to manifest+main when deps are unreadable.
 */
export function computeMainFingerprint(manifestRaw, mainPath, pluginDir) {
  const hash = createHash('sha256');
  hash.update(manifestRaw || '');
  if (mainPath) {
    try {
      hash.update(readFileSync(mainPath));
    } catch (err) {
      reportSwallowed('plugin-manifest.fp-main', err);
    }
    let total = 0;
    for (const dep of collectMainDependencyPaths(mainPath, pluginDir)) {
      try {
        const st = statSync(dep);
        if (total + st.size > FINGERPRINT_MAX_BYTES) break;
        total += st.size;
        hash.update(dep);
        hash.update(readFileSync(dep));
      } catch (err) {
        reportSwallowed('plugin-manifest.fp-dep', err);
      }
    }
  }
  return hash.digest('hex');
}

/**
 * Fingerprint for the panel bundle (entry + css): used by the panel manifest API
 * so the frontend reloads the bundle after it actually changed on disk.
 */
export function computePanelFingerprint(panel) {
  const hash = createHash('sha256');
  for (const p of [panel.entryPath, panel.cssPath]) {
    if (!p) continue;
    try {
      const st = statSync(p);
      hash.update(p);
      hash.update(String(st.mtimeMs));
      hash.update(String(st.size));
    } catch (err) {
      reportSwallowed('plugin-manifest.fp-panel', err);
    }
  }
  return hash.digest('hex').slice(0, 16);
}

/**
 * List directory-plugin candidate dirs directly under a plugins dir.
 * Returns sorted directory names that contain a plugin.json.
 */
export function listPluginDirs(pluginsDir) {
  let entries;
  try {
    entries = readdirSync(pluginsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort();
}
