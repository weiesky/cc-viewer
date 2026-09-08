/**
 * Client-side orchestration for the markdown codespan file-path probe.
 *
 * The render phase (markdownCodeSpanRenderer.js) tags path-looking inline code
 * spans with an inert `data-md-path-candidate` attribute. ChatView's
 * MutationObserver loop collects unverified candidates and calls
 * checkPathsExist() here; paths that provably exist are upgraded in the DOM
 * with `data-md-file-verified` (the attribute the click handler and CSS key
 * on). Everything DOM-touching lives in ChatView — this module is the testable,
 * DOM-free core (fetch is injectable).
 *
 * Caching contract:
 *  - verdicts are keyed by `${projectKey}${path}` so workspace switches never
 *    reuse another project's verdict;
 *  - `true` is cached for the session (files rarely disappear; if one does, the
 *    click path re-validates via /api/file-content anyway);
 *  - `false` carries a TTL — an LLM routinely mentions a path in backticks
 *    BEFORE creating the file, so a permanent negative cache would pin the span
 *    as plain code forever. Expired negatives are re-probed on the next flush.
 *  - fetch failures are reported via reportSwallowed (CLAUDE.md rule) and NOT
 *    cached, so a transient network blip self-heals on the next mutation flush.
 */
import { apiUrl } from './apiUrl';
import { reportSwallowed } from './errorReport';

export const MD_PATH_CANDIDATE_ATTR = 'data-md-path-candidate';
export const MD_FILE_VERIFIED_ATTR = 'data-md-file-verified';

export const MD_EXISTS_MAX_BATCH = 50; // server enforces the same cap
const CACHE_MAX = 2000;
const NEGATIVE_TTL_MS = 30 * 1000;

const _existsCache = new Map(); // key → { value: boolean, ts: number }
const _inFlight = new Map();    // key → Promise<boolean>

// NUL separator: without it, ("a","b/c") and ("","ab/c") would collide.
function _key(projectKey, path) { return `${projectKey}\u0000${path}`; }

/**
 * Peek the cached verdict for a path (respecting the negative TTL). Used by
 * ChatView's probe loop to pick batches from UNPROBED paths only — otherwise a
 * >200-candidate DOM whose first 200 all miss would re-flush the same cached
 * prefixes every frame and never reach the tail (drain spin).
 */
export function peekPathExists(path, projectKey = '') {
  return _cacheGet(_key(projectKey, path));
}

function _cacheGet(key) {
  const hit = _existsCache.get(key);
  if (!hit) return undefined;
  if (hit.value === false && Date.now() - hit.ts > NEGATIVE_TTL_MS) {
    _existsCache.delete(key);
    return undefined;
  }
  return hit.value;
}

function _cacheSet(key, value) {
  if (_existsCache.size >= CACHE_MAX) _existsCache.delete(_existsCache.keys().next().value);
  _existsCache.set(key, { value, ts: Date.now() });
}

/** Dedupe preserving first-seen order. */
export function dedupePaths(paths) {
  return [...new Set(paths)];
}

/**
 * Probe which of `paths` exist as readable regular files.
 * Returns a Map<path, boolean> covering every input path. Never throws:
 * fetch failure degrades the whole batch to false (uncached).
 */
export async function checkPathsExist(paths, { projectKey = '', fetchImpl } = {}) {
  const fetchFn = fetchImpl || globalThis.fetch;
  const results = new Map();
  const owned = [];  // entries that own a fresh in-flight slot: { p, key, resolve }
  const joined = []; // entries that joined an existing in-flight slot: { p, promise }

  for (const p of dedupePaths(paths)) {
    const key = _key(projectKey, p);
    const cached = _cacheGet(key);
    if (cached !== undefined) {
      results.set(p, cached);
      continue;
    }
    const existing = _inFlight.get(key);
    if (existing) {
      joined.push({ p, promise: existing });
      continue;
    }
    let resolveFn;
    const promise = new Promise((resolve) => { resolveFn = resolve; });
    _inFlight.set(key, promise);
    owned.push({ p, key, promise, resolve: resolveFn });
  }

  // Fetch sequentially in ≤50-path chunks — at most one request outstanding,
  // keeping server load flat on pathological messages.
  for (let i = 0; i < owned.length; i += MD_EXISTS_MAX_BATCH) {
    const chunk = owned.slice(i, i + MD_EXISTS_MAX_BATCH);
    let chunkResults = null;
    try {
      const res = await fetchFn(apiUrl('/api/files-exists'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: chunk.map(e => e.p) }),
      });
      if (res && res.ok) {
        const data = await res.json();
        chunkResults = new Map((data.results || []).map(r => [r.path, r.exists === true]));
      }
    } catch (err) {
      reportSwallowed('md-probe.files-exists', err);
    }
    for (const e of chunk) {
      const value = chunkResults ? chunkResults.get(e.p) === true : false;
      // Only cache when the server actually answered — failures stay uncached.
      if (chunkResults) _cacheSet(e.key, value);
      e.resolve(value);
      _inFlight.delete(e.key);
    }
  }

  for (let i = 0; i < owned.length; i++) results.set(owned[i].p, await owned[i].promise);
  for (let i = 0; i < joined.length; i++) results.set(joined[i].p, await joined[i].promise);
  return results;
}

/** Test hook: clear caches and in-flight slots. */
export function _resetForTests() {
  _existsCache.clear();
  _inFlight.clear();
}
