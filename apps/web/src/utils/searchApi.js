import { apiUrl } from './apiUrl';
import { reportSwallowed } from './errorReport';

/**
 * Search the project codebase for `params.query`.
 * @param {object} params { query, caseSensitive, wholeWord, regex, includeGlobs, excludeGlobs }
 * @param {AbortSignal} [signal] abort a superseded / cancelled search
 * @returns {Promise<{results, truncated, engine, filesScanned, error?}>}
 * @throws on network failure or non-OK status (except 400 invalid_regex, surfaced as {error})
 */
export async function searchCode(params, signal) {
  const res = await fetch(apiUrl('/api/search'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal,
  });
  if (res.status === 400) {
    // invalid_regex is an expected, user-facing outcome — return it as data, not a throw.
    const data = await res.json().catch(() => ({ error: 'error' }));
    return { results: [], truncated: false, engine: 'none', filesScanned: 0, error: data.error || 'error' };
  }
  if (!res.ok) throw new Error(`search failed: ${res.status}`);
  return res.json();
}

/**
 * Replace matches across files (or dry-run to count).
 * @param {object} params { query, caseSensitive, wholeWord, regex, includeGlobs, excludeGlobs,
 *                          replacement, scope:'all'|'file'|'match', file?, line?, col?, expectText?,
 *                          skipPaths?, dryRun? }
 * @returns {Promise<{changed, skipped, total, error?}>}
 */
export async function replaceInFiles(params, signal) {
  const res = await fetch(apiUrl('/api/search-replace'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal,
  });
  if (res.status === 400) {
    const data = await res.json().catch(() => ({ error: 'error' }));
    return { changed: [], skipped: [], total: 0, error: data.error || 'error' };
  }
  if (!res.ok) throw new Error(`replace failed: ${res.status}`);
  return res.json();
}
