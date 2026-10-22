// Plugin panel manifest utilities: fetch /api/plugin-panels with a short TTL and
// in-flight dedup, resolve localized titles at render time, and build bundle URLs.
// The failed fetch keeps the last successful list (menu pins must not flicker away).
import { apiUrl, getBasePath, appendToken } from './apiUrl';
import { getLang, t } from '../i18n';
import { resolveLocalized } from './resolveLocalized';
import { reportSwallowed } from './errorReport';

const TTL_MS = 5000;

let cache = { at: 0, panels: [], basePath: '' };
let inFlight = null;

export async function fetchPluginPanels({ force = false } = {}) {
  if (!force && inFlight) return inFlight;
  if (!force && cache.at && Date.now() - cache.at < TTL_MS) {
    return { panels: cache.panels, basePath: cache.basePath };
  }
  inFlight = (async () => {
    try {
      const res = await fetch(apiUrl('/api/plugin-panels'));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const panels = Array.isArray(data.panels) ? data.panels : [];
      cache = { at: Date.now(), panels, basePath: data.basePath || getBasePath() };
      return { panels: cache.panels, basePath: cache.basePath };
    } catch (err) {
      reportSwallowed('plugin-panels.fetch', err);
      // Keep the last successful list on failure (pins do not disappear, the menu does not flicker)
      return { panels: cache.panels, basePath: cache.basePath, error: err };
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export function invalidatePluginPanels() {
  cache.at = 0;
}

/** Panel bundle URL: getBasePath + entryUrl (already fingerprinted by the server). Not apiUrl (no token). */
export function panelAssetUrl(entryUrl) {
  if (!entryUrl || typeof entryUrl !== 'string') return null;
  // The server validated the entryUrl prefix; this is a backstop against absolute/protocol-relative/data URLs:
  if (/^(https?:)?\/\//i.test(entryUrl) || entryUrl.startsWith('data:')) return null;
  return `${normalizedBase()}${entryUrl.startsWith('/') ? entryUrl : `/${entryUrl}`}`;
}

// getBasePath() always has a trailing slash ('/' or '/ccv/') - strip it before joining absolute
// paths, or '//plugin-panels/...' is treated as a protocol-relative URL to the wrong host
function normalizedBase() {
  return getBasePath().replace(/\/$/, '');
}

export function panelTitle(panel) {
  return resolveLocalized(panel.titleI18n || panel.title, getLang()) || panel.name;
}

const SERVICE_STATE_KEYS = {
  pending: 'ui.plugins.status.pending',
  starting: 'ui.plugins.status.starting',
  ready: 'ui.plugins.status.ready',
  active: 'ui.plugins.status.active',
  restarting: 'ui.plugins.status.restarting',
  crashed: 'ui.plugins.status.crashed',
  error: 'ui.plugins.status.error',
  stopping: 'ui.plugins.status.stopping',
  stopped: 'ui.plugins.status.stopped',
  blocked: 'ui.plugins.status.blocked',
};

/** Localized label for a service runtime state; falls back to the raw state string. */
export function serviceStateLabel(state) {
  const key = SERVICE_STATE_KEYS[state];
  return key ? t(key) : (state || 'unknown');
}

/** Call the panel's own service API through the host apiUrl (base + token/cookie interceptors) */
export function pluginApiUrl(panel, path) {
  if (!panel || !panel.prefix) return null;
  const p = path.startsWith('/') ? path : `/${path}`;
  return apiUrl(`${panel.prefix}${p}`);
}

/** Panel WS to its own service: tokenInterceptor skips cross-origin ws://, so appendToken explicitly */
export function pluginWsUrl(panel, path) {
  if (!panel || !panel.prefix) return null;
  const p = path.startsWith('/') ? path : `/${path}`;
  const base = normalizedBase();
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const raw = `${proto}://${window.location.host}${base}${panel.prefix}${p}`;
  return appendToken(raw);
}
