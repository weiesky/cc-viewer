// CCV External Sessions Protocol v1 - reader side.
// Scans external-root directories, reads index/scope/session JSON, watches for changes.
// Spec: docs/ccv-external-sessions-protocol.md

import { existsSync, readFileSync, readdirSync, watch } from 'node:fs';
import { isAbsolute, join, sep } from 'node:path';
import { homedir } from 'node:os';

export const PROTOCOL_VERSION = 1;
export const SLUG_RE = /^[a-z0-9][a-z0-9_\-\.]{0,63}$/;

/** Expand ~ and $HOME in a path string. */
export function expandHome(p) {
  if (!p || typeof p !== 'string') return p;
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p.replace(/\$HOME/g, homedir());
}

/** Parse comma-separated env value into an array of absolute paths. */
export function parseRootsEnv(envValue) {
  if (!envValue || typeof envValue !== 'string') return [];
  return envValue
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(expandHome)
    .filter(isAbsolute);
}

/**
 * Load external roots from env. Returns [{ index, path }] with dedup.
 * v1: env is the only input — no preferences.json or auto-discovery.
 */
export function loadRoots({ envValue } = {}) {
  const fromEnv = parseRootsEnv(envValue);
  const seen = new Set();
  const result = [];
  for (const p of fromEnv) {
    if (seen.has(p)) continue;
    seen.add(p);
    result.push({ index: result.length, path: p });
  }
  return result;
}

function readJsonSafe(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function listValidSlugDirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory() && SLUG_RE.test(d.name))
      .map(d => d.name);
  } catch {
    return [];
  }
}

/** List providers under a root (checks index.json + protocolVersion). */
export function scanProviders(rootPath) {
  if (!rootPath || !isAbsolute(rootPath) || !existsSync(rootPath)) return [];
  const providers = [];
  for (const name of listValidSlugDirs(rootPath)) {
    const indexPath = join(rootPath, name, 'index.json');
    if (!existsSync(indexPath)) continue;
    const data = readJsonSafe(indexPath);
    if (!data || typeof data !== 'object') continue;
    if (data.protocolVersion !== PROTOCOL_VERSION) {
      console.warn(
        `[CC Viewer] Protocol version mismatch in ${indexPath}: expected ${PROTOCOL_VERSION}, got ${data.protocolVersion}`
      );
      continue;
    }
    providers.push({
      providerId: name,
      providerName: typeof data.providerName === 'string' ? data.providerName : name,
      protocolVersion: data.protocolVersion,
      updatedAt: data.updatedAt || null,
    });
  }
  return providers;
}

/** List scopes under a provider. Falls back to directory-only listing if scope.json missing. */
export function listScopes(rootPath, providerId) {
  if (!SLUG_RE.test(providerId)) return [];
  const scopesDir = join(rootPath, providerId, 'scopes');
  if (!existsSync(scopesDir)) return [];
  const scopes = [];
  for (const name of listValidSlugDirs(scopesDir)) {
    const jsonPath = join(scopesDir, name, 'scope.json');
    const data = existsSync(jsonPath) ? readJsonSafe(jsonPath) : null;
    if (!data) {
      scopes.push({
        scopeId: name, title: name, subtitle: '',
        kind: '', updatedAt: null,
      });
      continue;
    }
    scopes.push({
      scopeId: name,
      title: typeof data.title === 'string' ? data.title : name,
      subtitle: typeof data.subtitle === 'string' ? data.subtitle : '',
      kind: typeof data.kind === 'string' ? data.kind : '',
      updatedAt: data.updatedAt || null,
    });
  }
  return scopes;
}

/** List sessions under a scope. Sorted by startedAt desc (most recent first). */
export function listSessions(rootPath, providerId, scopeId) {
  if (!SLUG_RE.test(providerId) || !SLUG_RE.test(scopeId)) return [];
  const sessionsDir = join(rootPath, providerId, 'scopes', scopeId, 'sessions');
  if (!existsSync(sessionsDir)) return [];
  const sessions = [];
  for (const name of listValidSlugDirs(sessionsDir)) {
    const jsonPath = join(sessionsDir, name, 'session.json');
    const data = existsSync(jsonPath) ? readJsonSafe(jsonPath) : null;
    if (!data) {
      sessions.push({
        sessionId: name, title: name, role: 'unknown',
        logFile: 'log.jsonl', startedAt: null, endedAt: null,
        updatedAt: null,
      });
      continue;
    }
    sessions.push({
      sessionId: name,
      title: typeof data.title === 'string' ? data.title : name,
      role: typeof data.role === 'string' ? data.role : 'unknown',
      logFile: typeof data.logFile === 'string' ? data.logFile : 'log.jsonl',
      startedAt: data.startedAt || null,
      endedAt: data.endedAt || null,
      updatedAt: data.updatedAt || null,
    });
  }
  sessions.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
  return sessions;
}

/**
 * Resolve an absolute log file path, ensuring it stays within rootPath.
 * Returns null if slug invalid, session.json claims an absolute/traversal logFile,
 * or the resolved file doesn't exist.
 */
export function resolveLogFile(rootPath, providerId, scopeId, sessionId) {
  if (!isAbsolute(rootPath)) return null;
  if (!SLUG_RE.test(providerId) || !SLUG_RE.test(scopeId) || !SLUG_RE.test(sessionId)) return null;
  const sessionDir = join(rootPath, providerId, 'scopes', scopeId, 'sessions', sessionId);
  if (!sessionDir.startsWith(rootPath + sep)) return null;

  let logFileName = 'log.jsonl';
  const jsonPath = join(sessionDir, 'session.json');
  if (existsSync(jsonPath)) {
    const data = readJsonSafe(jsonPath);
    if (data && typeof data.logFile === 'string' && data.logFile) {
      if (data.logFile.includes('..') || isAbsolute(data.logFile)) return null;
      logFileName = data.logFile;
    }
  }
  const fullPath = join(sessionDir, logFileName);
  if (!fullPath.startsWith(rootPath + sep)) return null;
  if (!existsSync(fullPath)) return null;
  return fullPath;
}

/**
 * Watch all roots recursively. Returns a stop function.
 * Callback signature: ({ rootIndex, rootPath, relPath, eventType }) => void
 */
export function watchExternalRoots(roots, onChange) {
  const watchers = [];
  for (const root of roots) {
    try {
      const w = watch(root.path, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        try {
          onChange({ rootIndex: root.index, rootPath: root.path, relPath: String(filename), eventType });
        } catch {}
      });
      watchers.push(w);
    } catch (err) {
      console.error(`[CC Viewer] watch failed for ${root.path}: ${err.message}`);
    }
  }
  return () => {
    for (const w of watchers) {
      try { w.close(); } catch {}
    }
  };
}
