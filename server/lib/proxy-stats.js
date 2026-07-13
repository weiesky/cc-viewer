// Proxy Stats — pure functions for proxy retry statistics.
// Detail record schema, per-day sharding, aggregate computation (availability / percentiles / streak / by-model by-path).
//
// Design notes:
//   - All pure functions, independently unit-testable; no I/O side effects (except appendRecord, which only writes files and reads no state).
//   - Details are sharded per day as proxy_YYYY-MM-DD.jsonl, synonymous with llm-retry-proxy's retry_YYYY-MM-DD.jsonl.
//   - Aggregation is done by stats-worker (Worker thread) calling aggregateRecords; the main thread only handles appendRecord.
//   - Fully separated from cc-viewer's existing session logs (*.jsonl written by interceptor), no cross-contamination.
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ── Detail record schema ──────────────────────────────────────────────
// Appends one JSON line after each proxied LLM API request completes. Fields align with llm-retry-proxy's retry records.
//
//   ts             ISO timestamp (millisecond precision, at request completion)
//   method         HTTP method
//   path           Request path (without host, includes query)
//   model          Model name (parsed from request body.model; empty string if absent)
//   upstream_status Last upstream response status code (0 on request error / network failure)
//   final_status   Status code returned to the client (the real last upstream failure code when retries are exhausted, e.g. 429/503; no longer hardcodes 503)
//   attempts       Total attempt count (including the first)
//   retries        Retry count = attempts - 1
//   duration_ms    Total duration (milliseconds)
//   succeeded      Whether a <400 response was ultimately received
//   retry_codes    List of upstream error codes returned during retries, e.g. [503, 503, 429]; [] when no retries
//
// Note: duration uses milliseconds (cc-viewer standardizes on ms throughout), unlike llm-retry-proxy which uses seconds.

/**
 * Build a standardized proxy detail record. Fills in defaults and derives retries/succeeded.
 * @param {object} r Raw fields
 * @returns {object} Standardized record
 */
export function buildRecord(r) {
  const attempts = Math.max(1, Number(r.attempts) || 1);
  const retries = Math.max(0, attempts - 1);
  const finalStatus = Number(r.finalStatus) || 0;
  const upstreamStatus = Number(r.upstreamStatus) || 0;
  return {
    ts: r.ts || new Date().toISOString(),
    method: r.method || 'POST',
    path: r.path || '/',
    model: typeof r.model === 'string' ? r.model : '',
    // Profile identifier (for byProfile aggregation): defaults to 'default', compatible with the built-in max profile
    profile_id: typeof r.profileId === 'string' && r.profileId ? r.profileId : 'default',
    profile_name: typeof r.profileName === 'string' && r.profileName ? r.profileName : 'Default',
    upstream_status: upstreamStatus,
    final_status: finalStatus,
    attempts,
    retries,
    duration_ms: Math.max(0, Number(r.durationMs) || 0),
    succeeded: typeof r.succeeded === 'boolean' ? r.succeeded : finalStatus > 0 && finalStatus < 400,
    retry_codes: Array.isArray(r.retryCodes) ? r.retryCodes.filter(c => Number.isFinite(c)) : [],
  };
}

/**
 * Determine whether a record is "successful": final_status < 400 (2xx/3xx success, 4xx/5xx failure).
 * Synonymous with llm-retry-proxy's _req_succeeded.
 */
export function isRecordSucceeded(r) {
  return Number(r?.final_status) > 0 && Number(r?.final_status) < 400;
}

/**
 * Per-day sharded detail file name: proxy_YYYY-MM-DD.jsonl
 * @param {string} dateStr e.g. "2026-07-08"
 */
export function dailyFileName(dateStr) {
  return `proxy_${dateStr}.jsonl`;
}

/**
 * Absolute path of the per-day sharded detail file.
 * @param {string} projectDir Project log directory (LOG_DIR/<project>)
 * @param {string} dateStr e.g. "2026-07-08"
 */
export function dailyFilePath(projectDir, dateStr) {
  return join(projectDir, dailyFileName(dateStr));
}

/**
 * Today's date string (local timezone, consistent with stats-worker's file naming convention).
 */
export function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Parse the date string from a proxy_YYYY-MM-DD.jsonl file name. Returns null for non-proxy detail files.
 */
export function parseDailyFileName(fileName) {
  const m = /^proxy_(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(fileName);
  return m ? m[1] : null;
}

/**
 * Append a detail record to the per-day sharded file. Atomic append (appendFileSync), concurrency-safe.
 * Creates the directory automatically if it doesn't exist (mkdirSync recursive).
 * @param {string} filePath Absolute path of the detail file
 * @param {object} record Standardized record produced by buildRecord
 */
export function appendRecord(filePath, record) {
  try {
    mkdirSync(join(filePath, '..'), { recursive: true });
  } catch { /* Directory already exists or no permission; appendFileSync will report again */ }
  appendFileSync(filePath, JSON.stringify(record) + '\n', { flag: 'a' });
}

// ── Aggregate computation ──────────────────────────────────────────────────────

/**
 * Compute a percentile. Input must be a numerically ascending-sorted array.
 * Uses the same nearest-rank method as llm-retry-proxy (simple, no interpolation, sufficient for discrete distributions like durations).
 * @param {number[]} sorted Sorted array
 * @param {number} p 0~1, e.g. 0.95
 * @returns {number} Percentile value; returns 0 for empty array
 */
export function percentile(sorted, p) {
  if (!Array.isArray(sorted) || sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[idx];
}

/**
 * Compute the current consecutive success/failure streak and the longest failure streak.
 * Synonymous with llm-retry-proxy's streak logic: iterate records in time order, accumulating same-type consecutive runs.
 * @param {object[]} records Records sorted in ascending time order
 * @returns {{ current: {type:'success'|'failure', count:number}, worstFailure: number }}
 */
export function computeStreak(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return { current: { type: 'success', count: 0 }, worstFailure: 0 };
  }
  let worstFailure = 0;
  let curType = null;
  let curCount = 0;
  for (const r of records) {
    const ok = isRecordSucceeded(r);
    const type = ok ? 'success' : 'failure';
    if (type === curType) {
      curCount++;
    } else {
      curType = type;
      curCount = 1;
    }
    if (type === 'failure' && curCount > worstFailure) worstFailure = curCount;
  }
  return { current: { type: curType || 'success', count: curCount }, worstFailure };
}

/**
 * Aggregate a batch of detail records into a stats structure. Called by stats-worker, also used directly by /api/proxy-stats.
 *
 * Definitions (consistent with llm-retry-proxy):
 *   - Upstream availability = proportion of requests that succeeded on the first attempt (retries==0 && succeeded)
 *   - Downstream availability = proportion that ultimately succeeded after retries (succeeded)
 *   - Difference = number of requests rescued by retries
 *
 * @param {object[]} records Detail record array (order is irrelevant; sorted internally)
 * @param {object} [opts]
 * @param {number} [opts.recentLimit=50] Number of recent detail entries to keep
 * @returns {object} Aggregate result (proxyStats structure)
 */
export function aggregateRecords(records, opts = {}) {
  const recentLimit = Number(opts.recentLimit) || 50;
  if (!Array.isArray(records) || records.length === 0) {
    return emptyStats();
  }

  // Sort a copy in ascending time order (streak / recent depend on order)
  const sorted = [...records].sort((a, b) => {
    const ta = a.ts ? Date.parse(a.ts) : 0;
    const tb = b.ts ? Date.parse(b.ts) : 0;
    return ta - tb;
  });

  const total = sorted.length;
  let totalRetries = 0;
  let succeeded = 0;
  let failed = 0;
  let firstOk = 0; // Succeeded on the first attempt (retries==0 && succeeded)
  const durations = [];
  const retryDist = new Map(); // retries -> count
  const retryCodeCounts = new Map(); // code -> count
  const byModelMap = new Map();
  const byPathMap = new Map();
  const byProfileMap = new Map();
  let slowest = null;
  let fastest = null;

  for (const r of sorted) {
    const retries = Number(r.retries) || 0;
    const ok = isRecordSucceeded(r);
    const dur = Number(r.duration_ms) || 0;
    totalRetries += retries;
    if (ok) {
      succeeded++;
      if (retries === 0) firstOk++;
    } else {
      failed++;
    }
    durations.push(dur);
    retryDist.set(retries, (retryDist.get(retries) || 0) + 1);
    for (const c of (r.retry_codes || [])) {
      retryCodeCounts.set(c, (retryCodeCounts.get(c) || 0) + 1);
    }
    // by model
    const model = r.model || '(unknown)';
    if (!byModelMap.has(model)) byModelMap.set(model, newBucket());
    accBucket(byModelMap.get(model), retries, ok, dur);
    // by path
    const path = r.path || '/';
    if (!byPathMap.has(path)) byPathMap.set(path, newBucket());
    accBucket(byPathMap.get(path), retries, ok, dur);
    // by profile
    const profileKey = r.profile_id || 'default';
    if (!byProfileMap.has(profileKey)) byProfileMap.set(profileKey, { ...newBucket(), profile_name: r.profile_name || 'Default' });
    accBucket(byProfileMap.get(profileKey), retries, ok, dur);
    // slowest / fastest (fastest only counts successes with dur>0)
    const candidate = { ts: r.ts, path, model, attempts: r.attempts, retries, duration_ms: dur, final_status: r.final_status, retry_codes: r.retry_codes || [] };
    if (!slowest || dur > slowest.duration_ms) slowest = candidate;
    if (ok && dur > 0 && (!fastest || dur < fastest.duration_ms)) fastest = candidate;
  }

  durations.sort((a, b) => a - b);
  const p50 = percentile(durations, 0.5);
  const p95 = percentile(durations, 0.95);
  const p99 = percentile(durations, 0.99);
  const maxMs = durations.length ? durations[durations.length - 1] : 0;
  const avgMs = durations.length ? durations.reduce((s, x) => s + x, 0) / durations.length : 0;

  const upstreamAvail = total ? round2(firstOk / total * 100) : 0;
  const downstreamAvail = total ? round2(succeeded / total * 100) : 0;
  const streak = computeStreak(sorted);

  return {
    summary: {
      totalRequests: total,
      totalRetries,
      totalSucceeded: succeeded,
      totalFailed: failed,
      totalFirstOk: firstOk,
      upstreamAvailabilityPct: upstreamAvail,
      downstreamAvailabilityPct: downstreamAvail,
      p50Ms: round3(p50),
      p95Ms: round3(p95),
      p99Ms: round3(p99),
      maxMs: round3(maxMs),
      avgMs: round3(avgMs),
      currentStreakType: streak.current.type,
      currentStreakCount: streak.current.count,
      worstFailureStreak: streak.worstFailure,
    },
    byModel: mapToSortedArray(byModelMap, 'model'),
    byPath: mapToSortedArray(byPathMap, 'path').slice(0, 10), // Top 10 path
    byProfile: mapToSortedArrayWithExtra(byProfileMap, 'profile_id', 'profile_name'),
    retryDistribution: [...retryDist.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([retries, count]) => ({ retries, count })),
    retryCodes: [...retryCodeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([code, count]) => ({ code, count })),
    slowest,
    fastest,
    recentRecords: sorted.slice(-recentLimit).reverse(),
  };
}

function newBucket() {
  return { requests: 0, retries: 0, succeeded: 0, firstOk: 0, failed: 0, durations: [] };
}

function accBucket(b, retries, ok, dur) {
  b.requests++;
  b.retries += retries;
  if (ok) {
    b.succeeded++;
    if (retries === 0) b.firstOk++;
  } else {
    b.failed++;
  }
  b.durations.push(dur);
}

function mapToSortedArray(map, keyName) {
  const arr = [];
  for (const [k, b] of map.entries()) {
    b.durations.sort((a, c) => a - c);
    const entry = {
      [keyName]: k,
      requests: b.requests,
      retries: b.retries,
      succeeded: b.succeeded,
      firstOk: b.firstOk,
      failed: b.failed,
      availabilityPct: b.requests ? round2(b.succeeded / b.requests * 100) : 0,
      upstreamAvailabilityPct: b.requests ? round2(b.firstOk / b.requests * 100) : 0,
      p95Ms: round3(percentile(b.durations, 0.95)),
    };
    arr.push(entry);
  }
  arr.sort((a, b) => b.requests - a.requests);
  return arr;
}

// byProfile-specific: the bucket carries an extra profile_name field, included in the output
function mapToSortedArrayWithExtra(map, keyName, extraName) {
  const arr = [];
  for (const [k, b] of map.entries()) {
    b.durations.sort((a, c) => a - c);
    const entry = {
      [keyName]: k,
      [extraName]: b[extraName] || k,
      requests: b.requests,
      retries: b.retries,
      succeeded: b.succeeded,
      firstOk: b.firstOk,
      failed: b.failed,
      availabilityPct: b.requests ? round2(b.succeeded / b.requests * 100) : 0,
      upstreamAvailabilityPct: b.requests ? round2(b.firstOk / b.requests * 100) : 0,
      p95Ms: round3(percentile(b.durations, 0.95)),
    };
    arr.push(entry);
  }
  arr.sort((a, b) => b.requests - a.requests);
  return arr;
}

function emptyStats() {
  return {
    summary: {
      totalRequests: 0, totalRetries: 0, totalSucceeded: 0, totalFailed: 0, totalFirstOk: 0,
      upstreamAvailabilityPct: 0, downstreamAvailabilityPct: 0,
      p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0, avgMs: 0,
      currentStreakType: 'success', currentStreakCount: 0, worstFailureStreak: 0,
    },
    byModel: [],
    byPath: [],
    byProfile: [],
    retryDistribution: [],
    retryCodes: [],
    slowest: null,
    fastest: null,
    recentRecords: [],
  };
}

/**
 * Incremental cache merge at the proxy_YYYY-MM-DD.jsonl file granularity (pure function, no I/O).
 *
 * Proxy detail files are sharded per day and append-only: if a file's size+mtime is unchanged, its content is unchanged,
 * so the records parsed last time can be reused, skipping redundant readFileSync+JSON.parse. stats-worker calls this
 * function on each notifyProxyStats trigger, avoiding a full re-scan of all historical shards.
 *
 * @param {object} params
 * @param {object} [params.existingCache] Previous file cache: { [fileName]: { size, lastModified, records } }
 * @param {Array<{name:string,size:number,lastModified:string,records?:object[]}>} params.files
 *   All current proxy detail files (worker has already statSync'd; records are only re-parsed by the worker when the file changes;
 *   unchanged files leave records empty for cache reuse)
 * @returns {{records:object[], cache:object}} Merged full records + new cache (for writing the next stats JSON)
 */
export function mergeProxyFileCache({ existingCache, files }) {
  const cache = {};
  const allRecords = [];
  const existing = existingCache && typeof existingCache === 'object' ? existingCache : {};
  for (const f of files) {
    if (!f || !f.name) continue;
    const cached = existing[f.name];
    const unchanged = cached
      && cached.size === f.size
      && cached.lastModified === f.lastModified
      && Array.isArray(cached.records);
    if (unchanged) {
      // File unchanged: reuse cached records, skip re-parsing
      cache[f.name] = { size: f.size, lastModified: f.lastModified, records: cached.records };
      for (const r of cached.records) allRecords.push(r);
    } else if (Array.isArray(f.records)) {
      // File changed (or new): use the worker's re-parsed records, update cache
      cache[f.name] = { size: f.size, lastModified: f.lastModified, records: f.records };
      for (const r of f.records) allRecords.push(r);
    }
    // Neither cached nor has records (worker provided none and no cache) → skip (worker should ensure changed files carry records)
  }
  return { records: allRecords, cache };
}

function round2(n) { return Math.round(n * 100) / 100; }
function round3(n) { return Math.round(n * 1000) / 1000; }
