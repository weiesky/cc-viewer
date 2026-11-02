import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { LOG_DIR } from '../../findcc.js';
import { PLUGINS_DIR } from '../_paths.js';
import {
  parsePluginManifest,
  computeMainFingerprint,
  computePanelFingerprint,
  listPluginDirs,
  validatePluginName,
  validateServicePrefix,
} from './plugin-manifest.js';
import { reportSwallowed } from './error-report.js';

// 动态获取（LOG_DIR 可能在运行时被 setLogDir 修改）
export function getPluginsDir() { return join(LOG_DIR, 'plugins'); }
function getPrefsFilePath() { return join(LOG_DIR, 'preferences.json'); }
const SHOULD_LOG = process.env.CCV_DEBUG_PLUGINS === '1';

// Hook 类型定义
const HOOK_TYPES = {
  beforeRequest: 'waterfall',
  onPermRequest: 'waterfall',
  onAskRequest: 'waterfall',
  onPlanRequest: 'waterfall',
  httpsOptions: 'waterfall',
  localUrl: 'waterfall',
  serverStarted: 'parallel',
  serverStopping: 'parallel',
  onNewEntry: 'parallel',
  onStreamChunk: 'parallel',
};

// Approval hooks gate an interactive UI modal, so a hung plugin must not park the approval
// forever: each invocation times out and falls back to the normal approval modal.
// Non-approval waterfall hooks (beforeRequest/httpsOptions/localUrl) are startup/auth-critical
// and stay UNTIMED.
const APPROVAL_HOOK_TIMEOUT_MS = 15 * 1000;
const APPROVAL_HOOKS = new Set(['onPlanRequest', 'onAskRequest', 'onPermRequest']);

let _plugins = [];
// Full result of the last loadPlugins (directory service/panel plugins and failures included)
let _entries = [];
let _generation = 0;
// Directory plugins with an unchanged fingerprint reuse the old module instance and import URL to avoid repeated reloads
// accumulate module namespaces in the ESM registry that are never released
const _moduleCache = new Map(); // mainPath -> { fingerprint, url, module }

// Runtime event dispatcher (bridge for ctx.events.on): loadPlugins rebuilds _plugins every time,
// and the loader re-attaches this after each scan so it stays online across hot reloads.
let _eventDispatcherPlugin = null;
export function registerEventDispatcherPlugin(plugin) {
  _eventDispatcherPlugin = plugin;
  if (plugin && !_plugins.some(p => p.name === plugin.name)) {
    _plugins.push(plugin);
  }
}

function readDisabledPlugins() {
  try {
    if (existsSync(getPrefsFilePath())) {
      const prefs = JSON.parse(readFileSync(getPrefsFilePath(), 'utf-8'));
      if (Array.isArray(prefs.disabledPlugins)) {
        return prefs.disabledPlugins;
      }
    }
  } catch (err) {
    reportSwallowed('plugin-loader.prefs', err);
  }
  return [];
}

async function importMainModule(mainPath, fingerprint, force) {
  const cacheKey = mainPath;
  const cached = _moduleCache.get(cacheKey);
  if (!force && cached && cached.fingerprint === fingerprint) {
    return { module: cached.module, url: cached.url, reused: true };
  }
  const tag = force ? randomBytes(8).toString('hex') : fingerprint.slice(0, 16);
  // Fingerprint cache-bust: pathToFileURL wraps the absolute path (Windows-safe); a new query yields a new module instance
  const mod = await import(pathToFileURL(mainPath).href + '?ccv=' + tag);
  const url = `${pathToFileURL(mainPath).href}?ccv=${tag}`;
  const module = mod.default || mod;
  _moduleCache.set(cacheKey, { fingerprint, url, module });
  return { module, url, reused: false };
}

/**
 * Scan plugin directories (user LOG_DIR/plugins/ and the bundled plugins/) and load every plugin.
 * - Top-level .js/.mjs: single-file hook plugins (legacy behavior unchanged)
 * - Top-level directories with plugin.json: directory plugins (hooks optional; service/panel/lifecycle allowed)
 * Never rejects: a single failure is recorded in that entry's loadError.
 */
export async function loadPlugins(opts = {}) {
  const force = opts.force === true;
  _plugins = [];
  _entries = [];
  if (force) _moduleCache.clear();

  const disabledPlugins = readDisabledPlugins();
  const seenNames = new Set();
  const usedPrefixes = new Set();

  const loadFilePlugin = async (dir, file, source) => {
    const filePath = join(dir, file);
    const entry = {
      name: file,
      source,
      shape: 'file',
      file,
      dir: null,
      pluginDir: null,
      manifest: null,
      plugin: null,
      service: null,
      panel: null,
      fingerprints: null,
      enabled: true,
      loadError: null,
    };
    try {
      // On Windows `file://${C:\...}` yields `file://C:\...` (no third slash, unescaped backslashes);
      // pathToFileURL guarantees the correct cross-platform form. On POSIX it matches the old string concatenation.
      const mod = await import(pathToFileURL(filePath).href);
      const plugin = mod.default || mod;
      const name = plugin.name || (source === 'bundled' ? file.replace(/\.[cm]?js$/, '') : file);
      entry.name = name;
      entry.plugin = plugin;

      if (plugin.service !== undefined) {
        entry.loadError = 'single-file plugins cannot declare "service"; use a directory plugin with plugin.json';
        if (SHOULD_LOG) console.error(`[CC Viewer] Plugin "${name}": ${entry.loadError}`);
        _entries.push(entry);
        return;
      }
      if (disabledPlugins.includes(name)) {
        entry.enabled = false;
        if (SHOULD_LOG) console.error(`[CC Viewer] Plugin "${name}" is disabled, skipping.`);
        _entries.push(entry);
        return;
      }
      if (source === 'user') seenNames.add(name);
      if (plugin.hooks && typeof plugin.hooks === 'object') {
        const alreadyLoaded = source === 'bundled' && _plugins.some(p => p.name === name);
        if (!alreadyLoaded) {
          _plugins.push({ name, hooks: plugin.hooks, file, ...(source === 'bundled' ? { source } : {}) });
          if (SHOULD_LOG) console.error(`[CC Viewer] Plugin loaded: ${name} (${file})`);
        }
      }
      _entries.push(entry);
    } catch (err) {
      entry.loadError = err.message;
      if (SHOULD_LOG) console.error(`[CC Viewer] Failed to load plugin "${file}":`, err.message);
      _entries.push(entry);
    }
  };

  const loadDirPlugin = async (parentDir, dirName, source) => {
    const pluginDir = join(parentDir, dirName);
    const entry = {
      name: dirName,
      source,
      shape: 'dir',
      file: null,
      dir: dirName,
      pluginDir,
      manifest: null,
      plugin: null,
      service: null,
      panel: null,
      fingerprints: null,
      enabled: true,
      loadError: null,
    };
    const { manifest, error } = parsePluginManifest(pluginDir);
    if (error) {
      // Directories without plugin.json: ignored (may be a user's asset folder)
      if (error === 'missing plugin.json') return;
      entry.loadError = error;
      _entries.push(entry);
      return;
    }
    entry.manifest = manifest;
    entry.name = manifest.name;

    if (manifest.panel) {
      entry.panel = {
        entryRel: manifest.panel.entryRel,
        entryPath: manifest.panel.entryPath,
        rootDir: manifest.panel.rootDir,
        cssRel: manifest.panel.cssRel,
        cssPath: manifest.panel.cssPath,
        title: manifest.panel.title,
        titleI18n: manifest.panel.titleI18n,
        icon: manifest.panel.icon,
        width: manifest.panel.width,
        desktopOnly: manifest.panel.desktopOnly,
        fingerprint: computePanelFingerprint(manifest.panel),
      };
    }
    if (manifest.service) {
      entry.service = {
        entryRel: manifest.service.entryRel,
        entryPath: manifest.service.entryPath,
        prefix: manifest.service.prefix,
        env: manifest.service.env,
      };
    }

    if (disabledPlugins.includes(manifest.name)) {
      entry.enabled = false;
      _entries.push(entry);
      return;
    }
    if (!validatePluginName(manifest.name)) {
      entry.loadError = `invalid plugin name: ${manifest.name}`;
      _entries.push(entry);
      return;
    }
    if (seenNames.has(manifest.name)) {
      // User source overrides bundled source: a same-named bundled directory plugin silently yields (same as single-file plugins)
      if (source === 'bundled') return;
      entry.enabled = false;
      entry.loadError = `duplicate plugin name: ${manifest.name}`;
      _entries.push(entry);
      return;
    }
    if (manifest.service) {
      if (!validateServicePrefix(manifest.service.prefix) || usedPrefixes.has(manifest.service.prefix)) {
        entry.loadError = `invalid or duplicate service.prefix: ${manifest.service.prefix}`;
        _entries.push(entry);
        return;
      }
    }

    // main module (optional): hooks + activate/deactivate/onError
    let plugin = null;
    if (manifest.mainPath) {
      const fingerprint = computeMainFingerprint(manifest.raw, manifest.mainPath, pluginDir);
      entry.fingerprints = { main: fingerprint };
      try {
        const { module } = await importMainModule(manifest.mainPath, fingerprint, force);
        plugin = module;
        entry.plugin = plugin;
        if (plugin && plugin.name && plugin.name !== manifest.name && SHOULD_LOG) {
          console.error(`[CC Viewer] Plugin "${manifest.name}": module name "${plugin.name}" differs from manifest name, manifest wins.`);
        }
      } catch (err) {
        entry.loadError = `failed to import ${manifest.mainRel}: ${err.message}`;
        if (SHOULD_LOG) console.error(`[CC Viewer] ${entry.loadError}`);
        _entries.push(entry);
        return;
      }
    }

    seenNames.add(manifest.name);
    if (manifest.service) usedPrefixes.add(manifest.service.prefix);

    // hooks still use the same pipeline; service/panel/activate info lives in entries (filled above)
    if (plugin && plugin.hooks && typeof plugin.hooks === 'object') {
      _plugins.push({ name: manifest.name, hooks: plugin.hooks, file: dirName, ...(source === 'bundled' ? { source } : {}) });
    }
    if (SHOULD_LOG) console.error(`[CC Viewer] Directory plugin loaded: ${manifest.name} (${dirName})`);
    _entries.push(entry);
  };

  // ---- User plugin directory ----
  const userDir = getPluginsDir();
  if (existsSync(userDir)) {
    let dirents;
    try {
      dirents = readdirSync(userDir, { withFileTypes: true });
    } catch {
      dirents = [];
    }
    const files = dirents
      .filter(d => d.isFile() && (d.name.endsWith('.js') || d.name.endsWith('.mjs')))
      .map(d => d.name)
      .sort();
    for (const file of files) {
      await loadFilePlugin(userDir, file, 'user');
    }
    for (const dirName of listPluginDirs(userDir)) {
      await loadDirPlugin(userDir, dirName, 'user');
    }
  }

  // ---- Bundled plugin directory (user source wins) ----
  const bundledDir = PLUGINS_DIR;
  if (existsSync(bundledDir)) {
    let dirents;
    try {
      dirents = readdirSync(bundledDir, { withFileTypes: true });
    } catch {
      dirents = [];
    }
    const files = dirents
      .filter(d => d.isFile() && (d.name.endsWith('.js') || d.name.endsWith('.mjs')))
      .map(d => d.name)
      .sort();
    for (const file of files) {
      await loadFilePlugin(bundledDir, file, 'bundled');
    }
    for (const dirName of listPluginDirs(bundledDir)) {
      await loadDirPlugin(bundledDir, dirName, 'bundled');
    }
  }

  // Re-attach the runtime's event dispatcher (_plugins was cleared at the top)
  if (_eventDispatcherPlugin && !_plugins.some(p => p.name === _eventDispatcherPlugin.name)) {
    _plugins.push(_eventDispatcherPlugin);
  }

  _generation += 1;
  return { generation: _generation, entries: _entries };
}

/**
 * waterfall hook：串行管道执行，前一个的返回值传给下一个
 * `timeoutMsOverride` is test-only; approval hooks default to APPROVAL_HOOK_TIMEOUT_MS.
 */
export async function runWaterfallHook(name, initialValue, timeoutMsOverride) {
  let value = initialValue;
  // Only approval hooks are timed out; the override is ignored for the other hooks.
  const timeoutMs = APPROVAL_HOOKS.has(name)
    ? (timeoutMsOverride ?? APPROVAL_HOOK_TIMEOUT_MS)
    : undefined;
  for (const plugin of _plugins) {
    const hookFn = plugin.hooks[name];
    if (typeof hookFn !== 'function') continue;
    try {
      let result;
      if (timeoutMs !== undefined) {
        // A timed-out hook promise itself is not cancellable (bounded leak: it may keep
        // running in the background); the timer is cleared as soon as the hook settles.
        let timer;
        try {
          result = await Promise.race([
            Promise.resolve().then(() => hookFn(value)),
            new Promise((_, reject) => {
              timer = setTimeout(
                () => reject(new Error(`hook timed out after ${timeoutMs} ms`)),
                timeoutMs
              );
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      } else {
        result = await hookFn(value);
      }
      if (result != null && typeof result === 'object') {
        value = { ...value, ...result };
      }
    } catch (err) {
      if (SHOULD_LOG) console.error(`[CC Viewer] Plugin "${plugin.name}" hook "${name}" error:`, err.message);
    }
  }
  return value;
}

/**
 * parallel hook：并行通知执行，返回值忽略
 */
export async function runParallelHook(name, context = {}) {
  const tasks = [];
  for (const plugin of _plugins) {
    const hookFn = plugin.hooks[name];
    if (typeof hookFn !== 'function') continue;
    tasks.push(
      Promise.resolve()
        .then(() => hookFn(context))
        .catch(err => {
          if (SHOULD_LOG) console.error(`[CC Viewer] Plugin "${plugin.name}" hook "${name}" error:`, err.message);
        })
    );
  }
  await Promise.all(tasks);
}

// ---- Structured access for plugin-runtime ----

export function getPluginEntries() {
  return _entries;
}

export function getServiceEntries() {
  return _entries.filter(e => e.enabled && !e.loadError && e.service);
}

export function getPluginsGeneration() {
  return _generation;
}

// Test-only: reset the module cache (does not affect already imported modules; only later loadPlugins)
export function _resetModuleCacheForTest() {
  _moduleCache.clear();
}

/**
 * 返回所有插件文件信息（含已禁用的），供 /api/plugins 使用
 */
export function getPluginsInfo() {
  const info = [];
  const disabledPlugins = readDisabledPlugins();

  // Single-file plugins: keep legacy behavior (regex-extract name from source when not loaded)
  if (existsSync(getPluginsDir())) {
    let files;
    try {
      files = readdirSync(getPluginsDir())
        .filter(f => f.endsWith('.js') || f.endsWith('.mjs'))
        .sort();
    } catch {
      files = [];
    }

    for (const file of files) {
      const loaded = _plugins.find(p => p.file === file);
      const fileEntry = _entries.find(e => e.shape === 'file' && e.file === file && e.source === 'user');
      let name = file;
      let resolvedFromSource = false;

      if (loaded) {
        name = loaded.name;
      } else {
        try {
          const filePath = join(getPluginsDir(), file);
          const content = readFileSync(filePath, 'utf-8');
          // Simple match for name: 'xxx' or name: "xxx"
          const match = content.match(/name\s*:\s*['"]([^'"]+)['"]/);
          if (match) {
            name = match[1];
            resolvedFromSource = true;
          }
        } catch (err) {
          reportSwallowed('plugin-loader.info-read', err);
        }
        if (!resolvedFromSource && fileEntry) {
          name = fileEntry.name;
        }
      }

      const hooks = loaded ? Object.keys(loaded.hooks) : [];
      const enabled = !disabledPlugins.includes(name);
      const item = { name, file, hooks, enabled, type: 'hook' };
      if (fileEntry && fileEntry.loadError) item.loadError = fileEntry.loadError;
      info.push(item);
    }
  }

  // Directory plugins: merge the last loadPlugins result (manifest reads execute no plugin code,
  // but the list only reflects known state; reload refreshes it)
  for (const entry of _entries) {
    if (entry.shape !== 'dir') continue;
    const item = {
      name: entry.name,
      dir: entry.dir,
      hooks: entry.plugin && entry.plugin.hooks ? Object.keys(entry.plugin.hooks) : [],
      enabled: entry.enabled && !disabledPlugins.includes(entry.name),
      type: entry.service ? 'service' : (entry.panel ? 'panel' : (entry.manifest && entry.manifest.mainPath ? 'hook' : 'dir')),
      source: entry.source,
    };
    if (entry.service) item.service = { prefix: entry.service.prefix };
    if (entry.panel) {
      item.panel = {
        title: entry.panel.title,
        titleI18n: entry.panel.titleI18n,
        icon: entry.panel.icon,
        width: entry.panel.width,
        desktopOnly: entry.panel.desktopOnly,
      };
    }
    if (entry.loadError) item.loadError = entry.loadError;
    info.push(item);
  }

  return info;
}
