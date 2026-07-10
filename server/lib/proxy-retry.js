// Proxy Retry Engine — proxy retry core engine.
//
// Reimplements the proxy retry capability of llm-retry-proxy (Python) in Node.js within cc-viewer.
// Three modes: serial (serial retry) / race (request racing) / stagger (rolling race). off = no retry.
//
// Key integration constraints (see .omo/plans/proxy-retry-stats.md C1-C5):
//   - The fetch called by the retry engine carries the `x-cc-viewer-trace` header and goes through the
//     interceptor's recording branch (interceptor.js); each retry attempt is recorded to the session log
//     (the data source of the network view). Model replacement is done by this engine via the pure
//     function resolveProfileModel before the call; the interceptor runs resolveProfileModel again on the
//     trace request — since the model in the body has already been replaced with the final value, the second
//     resolve returns null (idempotent no-op), so no double replacement occurs. Writing one session log entry
//     per retry attempt is expected: the network view can see every attempt.
//   - Network proxy: fetchOptions still passes dispatcher = getProxyDispatcher(), ensuring the user's http_proxy is used.
//   - Streaming responses: only read status + headers to decide whether to retry; never retry after the body has
//     started being sent (retry-before-first-byte strategy).
//   - race/stagger use AbortController; cancelled requests must be released correctly.
import { resolveProfileModel } from './interceptor-core.js';
import { readFileSync, existsSync } from 'node:fs';

// ── Configuration ─────────────────────────────────────────────────

// Runtime hot-swappable config file path. Injected by interceptor.js after _logDir initialization
// (setRetryConfigPath), mirroring the hot-swap pattern of PROFILE_PATH: UI changes config → writes this
// file → watchFile 1.5s triggers _loadRetryConfigState. Initially null: before the path is ready,
// resolveRetryConfig uses only env (backward compatible with the legacy ccv-retry.sh workflow).
let _retryConfigPath = null;
/** @param {string|null} p */
export function setRetryConfigPath(p) { _retryConfigPath = p; }

/**
 * Default retry config. Aligned with the .env defaults of llm-retry-proxy.
 * mode=off ensures backward compatibility (no retry, consistent with existing proxy.js behavior).
 * Note: the "recommended" values from ccv-retry.sh are serial/maxConcurrent=4 (safest), which differ
 * semantically from the code defaults here (off/10) — the UI "restore defaults" returns to the code
 * defaults here (off = no retry), not to the script's recommended values.
 */
export const DEFAULT_RETRY_CONFIG = {
  mode: 'off',                       // 'off' | 'serial' | 'race' | 'stagger'
  retryStatusCodes: [502, 503, 504, 529, 429],
  retryIntervalMs: 1000,             // retry interval for 503/502/504/529
  retryInterval429Ms: 5000,          // interval specific to 429
  maxRetries: 60,                    // 0 = retry indefinitely until success (capped by maxRetryDurationMs total duration)
  maxConcurrent: 10,                 // max in-flight requests for race/stagger
  connectTimeoutMs: 10000,           // upstream connection timeout
  streamIdleTimeoutMs: 300000,       // max gap between two data chunks in streaming (reserved field, not consumed in current version)
  maxRetryDurationMs: 4 * 60 * 60 * 1000, // total retry duration cap per request (4 hours): safety net when maxRetries=0
                                          // (infinite), prevents unattended tasks from hanging forever under sustained upstream congestion;
                                          // explicit finite maxRetries is unaffected
};

const VALID_MODES = ['off', 'serial', 'race', 'stagger'];

/**
 * Computes the adaptive backoff interval for consecutive 429s in stagger mode (exponential growth, capped at 64x).
 * When 429s occur consecutively, progressively lengthen the resend interval to avoid continuously hammering an
 * already rate-limited upstream; non-429 still uses retryIntervalMs. If the upstream returns Retry-After,
 * parseRetryAfter already uses it preferentially in computeWaitMs; this function is only used when there is no Retry-After.
 */
function compute429BackoffMs(cfg, consecutive429) {
  const base = cfg.retryInterval429Ms > 0 ? cfg.retryInterval429Ms : 5000;
  const exp = Math.min(consecutive429, 6); // cap at 2^6 = 64x, avoid unbounded growth
  return base * (2 ** exp);
}

/**
 * Validates and normalizes a single raw config field. Shared by resolveRetryConfig (reading env) and
 * retryConfigPost (reading UI body), ensuring both entry points share identical validation logic (single source
 * of truth) to avoid drift. Returns the normalized value; returns undefined when invalid (callers using spread
 * ignore undefined fields, equivalent to falling back to the default).
 *
 * @param {string} key field name
 * @param {any} raw raw value
 * @returns {any} normalized value or undefined
 */
export function validateRetryField(key, raw) {
  switch (key) {
    case 'mode':
      return typeof raw === 'string' && VALID_MODES.includes(raw.toLowerCase()) ? raw.toLowerCase() : undefined;
    case 'retryStatusCodes': {
      if (!Array.isArray(raw)) return undefined;
      const codes = raw
        .map(s => (typeof s === 'number' ? s : parseInt(String(s).trim(), 10)))
        .filter(n => Number.isFinite(n) && n > 0);
      return codes.length ? codes : undefined;
    }
    case 'retryIntervalMs':
    case 'retryInterval429Ms':
    case 'connectTimeoutMs':
    case 'streamIdleTimeoutMs':
    case 'maxRetryDurationMs': {
      const n = typeof raw === 'number' ? raw : parseFloat(raw);
      return Number.isFinite(n) && n >= 0 ? n : undefined;
    }
    case 'maxRetries': {
      const n = typeof raw === 'number' ? raw : parseInt(raw, 10);
      return Number.isFinite(n) && n >= 0 ? n : undefined;
    }
    case 'maxConcurrent': {
      const n = typeof raw === 'number' ? raw : parseInt(raw, 10);
      return Number.isFinite(n) && n >= 1 ? n : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * Validates an entire raw config object, returning a normalized config containing only valid fields (can be
 * merged directly into DEFAULT_RETRY_CONFIG).
 * @param {object} raw
 * @returns {object} normalized config (may be an empty object)
 */
export function validateRetryConfig(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const key of Object.keys(DEFAULT_RETRY_CONFIG)) {
    if (!(key in raw)) continue;
    const v = validateRetryField(key, raw[key]);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/**
 * Parses retry config from environment variables. Called by server.js at startup.
 * Environment variable prefix CCV_PROXY_RETRY_* (connect/streamIdle use CCV_PROXY_CONNECT_TIMEOUT_MS /
 * CCV_PROXY_STREAM_IDLE_TIMEOUT_MS, which were previously gaps, now filled in).
 *
 * @param {object} env environment variable object (defaults to process.env)
 * @param {{ fileOverride?: boolean }} [options] when fileOverride=true, also overrides env with retry-config.json
 * @returns {object} merged retry config
 */
export function resolveRetryConfig(env = process.env, options = {}) {
  const { fileOverride = false } = options;
  const cfg = { ...DEFAULT_RETRY_CONFIG };

  // env layer
  const envRaw = {
    mode: env.CCV_PROXY_RETRY_MODE,
    retryStatusCodes: env.CCV_PROXY_RETRY_STATUS_CODES,
    retryIntervalMs: env.CCV_PROXY_RETRY_INTERVAL_MS,
    retryInterval429Ms: env.CCV_PROXY_RETRY_INTERVAL_429_MS,
    maxRetries: env.CCV_PROXY_MAX_RETRIES,
    maxConcurrent: env.CCV_PROXY_MAX_CONCURRENT,
    connectTimeoutMs: env.CCV_PROXY_CONNECT_TIMEOUT_MS,
    streamIdleTimeoutMs: env.CCV_PROXY_STREAM_IDLE_TIMEOUT_MS,
    maxRetryDurationMs: env.CCV_PROXY_RETRY_DURATION_MS,
  };
  // retryStatusCodes is a comma-separated string in env; convert to array before passing to validateRetryField
  if (typeof envRaw.retryStatusCodes === 'string' && envRaw.retryStatusCodes.trim()) {
    envRaw.retryStatusCodes = envRaw.retryStatusCodes.split(',');
  } else {
    delete envRaw.retryStatusCodes;
  }
  Object.assign(cfg, validateRetryConfig(envRaw));

  // File override layer (retry-config.json written by the UI takes precedence over env; env remains the startup default/fallback)
  if (fileOverride && _retryConfigPath) {
    try {
      if (existsSync(_retryConfigPath)) {
        const fileRaw = JSON.parse(readFileSync(_retryConfigPath, 'utf-8'));
        Object.assign(cfg, validateRetryConfig(fileRaw));
      }
    } catch { /* file missing/corrupt → use env only, don't block */ }
  }

  return cfg;
}

/**
 * Loads the currently effective retry config (env base + file override). Called by the watchFile callback
 * and live binding consumers.
 * @returns {object}
 */
export function loadRetryConfig() {
  return resolveRetryConfig(process.env, { fileOverride: true });
}

// ── Retry-After parsing ───────────────────────────────────────────

/**
 * Parses the Retry-After header. Supports seconds ("120") and HTTP date ("Wed, 21 Oct 2026 07:28:00 GMT").
 * @param {string|null|undefined} headerValue
 * @returns {number|null} wait duration in milliseconds; null when unparseable
 */
export function parseRetryAfter(headerValue) {
  if (!headerValue || typeof headerValue !== 'string') return null;
  const s = headerValue.trim();
  if (!s) return null;
  // pure number = seconds
  if (/^\d+$/.test(s)) {
    const secs = parseInt(s, 10);
    return secs >= 0 ? secs * 1000 : null;
  }
  // HTTP date
  const date = Date.parse(s);
  if (Number.isFinite(date)) {
    const diff = date - Date.now();
    return diff > 0 ? diff : 0; // expired also returns 0 (retry immediately), distinct from null (unrecognized)
  }
  return null;
}

// ── Utilities ────────────────────────────────────────────────────

/**
 * Determines whether a status code should trigger a retry.
 */
export function shouldRetryStatus(status, retryStatusCodes) {
  return retryStatusCodes.includes(status);
}

/**
 * Determines whether a response is streaming (text/event-stream).
 * Defensive: some mock/pseudo responses have headers that are not Headers instances (no .get method).
 */
export function isStreamResponse(response) {
  try {
    const ct = response?.headers?.get?.('content-type') || '';
    return typeof ct === 'string' && ct.toLowerCase().includes('text/event-stream');
  } catch {
    return false;
  }
}

/**
 * Parses the model field from the request body (Buffer/string). Returns '' when unparseable.
 */
export function extractModel(body) {
  if (!body) return '';
  try {
    const s = typeof body === 'string' ? body : body.toString('utf-8');
    const obj = JSON.parse(s);
    return typeof obj.model === 'string' ? obj.model : '';
  } catch {
    return '';
  }
}

/**
 * Performs model replacement on the request body. Returns a new body (string) or the original body (nothing to replace).
 * Reuses the pure function resolveProfileModel from interceptor-core.js.
 */
export function applyModelReplacement(body, profile) {
  if (!body || !profile) return body;
  try {
    const s = typeof body === 'string' ? body : body.toString('utf-8');
    const obj = JSON.parse(s);
    const oldModel = typeof obj.model === 'string' ? obj.model : '';
    if (!oldModel) return body;
    const target = resolveProfileModel(oldModel, profile);
    if (!target) return body;
    obj.model = target;
    return JSON.stringify(obj);
  } catch {
    return body;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Computes the wait in milliseconds until the next retry.
 * 429 prefers Retry-After, then retryInterval429Ms; other status codes use retryIntervalMs.
 */
function computeWaitMs(status, retryAfterHeader, cfg) {
  if (status === 429) {
    const ra = parseRetryAfter(retryAfterHeader);
    if (ra !== null) return ra;
    return cfg.retryInterval429Ms;
  }
  return cfg.retryIntervalMs;
}

// ── Single fetch wrapper ─────────────────────────────────────────

/**
 * Executes a single fetch request with the x-cc-viewer-trace header + network proxy dispatcher.
 * Returns the raw Response. Does not throw (on network errors returns { __networkError: true, status: 0 }).
 *
 * @param {string} url full URL
 * @param {object} fetchOptions method/headers/body
 * @param {object} ctx { dispatcher, connectTimeoutMs, signal }
 */
async function singleFetch(url, fetchOptions, ctx) {
  const opts = {
    method: fetchOptions.method,
    headers: { ...fetchOptions.headers },
  };
  // Add trace header so the interceptor records the request to the session log (network view data source).
  // The interceptor performs model replacement (resolveProfileModel is idempotent, consistent with the replacement
  // already done by the engine).
  // Multiple retries → multiple records — this is expected: the network view can see each retry attempt.
  opts.headers['x-cc-viewer-trace'] = 'true';
  if (fetchOptions.body) opts.body = fetchOptions.body;
  if (ctx.dispatcher) opts.dispatcher = ctx.dispatcher;
  if (ctx.signal) opts.signal = ctx.signal;

  // Connection timeout (AbortController merged with the external signal)
  let timeoutTimer = null;
  let timeoutCtl = null;
  if (ctx.connectTimeoutMs > 0) {
    timeoutCtl = new AbortController();
    timeoutTimer = setTimeout(() => timeoutCtl.abort(), ctx.connectTimeoutMs);
  }

  // Merge external signal (used by race/stagger cancellation) and timeout signal
  const onExternalAbort = () => timeoutCtl?.abort();
  if (ctx.signal) {
    if (ctx.signal.aborted) timeoutCtl?.abort();
    else ctx.signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    // Note: when connectTimeoutMs===0, timeoutCtl is null; must fall back to opts.signal (the external
    // race/stagger AbortController), otherwise the cancel signal is dropped and in-flight requests cannot be
    // aborted (connection leak). When timeoutCtl exists, its signal is already bridged to the external signal
    // via onExternalAbort above, so the two are equivalent.
    const response = await fetch(url, { ...opts, signal: timeoutCtl ? timeoutCtl.signal : opts.signal });
    return response;
  } catch (err) {
    // Network error/timeout/cancellation → return a pseudo response; status=0 indicates an error
    const aborted = ctx.signal?.aborted || timeoutCtl?.signal.aborted;
    return {
      __networkError: true,
      __aborted: !!aborted,
      status: 0,
      statusText: aborted ? 'Aborted' : (err?.message || 'Network Error'),
      headers: new Map(),
      ok: false,
      body: null,
      text: async () => '',
      json: async () => ({}),
    };
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (ctx.signal && onExternalAbort) ctx.signal.removeEventListener('abort', onExternalAbort);
  }
}

// ── executeRequest ────────────────────────────────────────────────

/**
 * Executes a request with retries. Returns { response, attempts, retryCodes, durationMs, finalStatus, upstreamStatus, succeeded }.
 *
 * @param {object} params
 * @param {string} params.url full upstream URL
 * @param {object} params.fetchOptions { method, headers, body }
 * @param {object} params.retryConfig retry config
 * @param {object} params.ctx { dispatcher, profile } network proxy dispatcher + model replacement profile
 * @returns {Promise<object>}
 */
export async function executeRequest({ url, fetchOptions, retryConfig, ctx }) {
  const cfg = { ...DEFAULT_RETRY_CONFIG, ...(retryConfig || {}) };
  const dispatcher = ctx?.dispatcher || null;
  const profile = ctx?.profile || null;

  // Model replacement (one-time, done before retries; all retries use the same body)
  let finalBody = fetchOptions.body;
  if (finalBody && profile) {
    finalBody = applyModelReplacement(finalBody, profile);
  }
  const finalFetchOptions = { ...fetchOptions, body: finalBody };

  const startTime = Date.now();
  const deadline = startTime + (cfg.maxRetryDurationMs > 0 ? cfg.maxRetryDurationMs : 0);
  const retryCodes = [];
  let attempts = 0;
  let lastResponse = null;
  // Real last upstream response status (distinct from finalStatus: in race/stagger full-failure fallback,
  // the latter was once hard-coded to 503)
  let upstreamStatus = 0;

  const commonCtx = { dispatcher, connectTimeoutMs: cfg.connectTimeoutMs };

  if (cfg.mode === 'off' || cfg.mode === 'serial') {
    // off / serial: serial retry. off = no retry (break on any status); serial = controlled by maxRetries (0=infinite, capped by deadline)
    const isOff = cfg.mode === 'off';
    const effectiveMax = isOff ? 0 : cfg.maxRetries;
    while (true) {
      // Total duration fallback: when maxRetries=0 (infinite), prevent permanent hang under sustained upstream congestion
      if (deadline > 0 && Date.now() >= deadline) break;

      attempts++;
      lastResponse = await singleFetch(url, finalFetchOptions, { ...commonCtx });
      upstreamStatus = lastResponse.status;

      // Streaming request special handling: after getting the response, first check the status
      const status = lastResponse.status;
      const isStream = lastResponse.headers && isStreamResponse(lastResponse);

      // off mode: no retry on any status code, end immediately
      if (isOff) break;

      if (status === 0) {
        // Network error
        retryCodes.push(0);
      } else if (!shouldRetryStatus(status, cfg.retryStatusCodes)) {
        // No retry needed (success or non-retryable error code) → return
        break;
      }

      // Retry needed
      if (status !== 0) retryCodes.push(status);

      // Streaming response has already started returning 200 → never retry (body may have been sent already)
      if (isStream && status < 400) break;

      // Reached the limit (effectiveMax=0 in serial mode = infinite, no break; off already broke above)
      if (effectiveMax > 0 && attempts > effectiveMax) break;

      // Wait
      const retryAfter = lastResponse.headers?.get?.('retry-after') || lastResponse.headers?.get?.('Retry-After');
      const wait = computeWaitMs(status, retryAfter, cfg);
      if (wait > 0) await sleep(wait);

      // On network errors, also consume/discard the body (avoid socket hang)
      if (lastResponse.body && lastResponse.body.cancel) {
        try { await lastResponse.body.cancel(); } catch { /* best effort */ }
      }
    }
  } else if (cfg.mode === 'race') {
    const result = await raceMode({ url, fetchOptions: finalFetchOptions, cfg, commonCtx, deadline });
    attempts = result.attempts;
    retryCodes.push(...result.retryCodes);
    lastResponse = result.response;
    if (result.upstreamStatus !== undefined) upstreamStatus = result.upstreamStatus;
  } else if (cfg.mode === 'stagger') {
    const result = await staggerMode({ url, fetchOptions: finalFetchOptions, cfg, commonCtx, deadline });
    attempts = result.attempts;
    retryCodes.push(...result.retryCodes);
    lastResponse = result.response;
    if (result.upstreamStatus !== undefined) upstreamStatus = result.upstreamStatus;
  } else {
    // Unknown mode → fallback to single attempt
    attempts = 1;
    lastResponse = await singleFetch(url, finalFetchOptions, { ...commonCtx });
    upstreamStatus = lastResponse.status;
  }

  const durationMs = Date.now() - startTime;
  const finalStatus = lastResponse?.status || 0;
  // serial/fallback: upstreamStatus was assigned the real value in the loop; race/stagger: result brings back the real last upstream status.
  // If not set (theoretically impossible), fall back to finalStatus.
  if (!upstreamStatus) upstreamStatus = finalStatus;
  const succeeded = finalStatus > 0 && finalStatus < 400;
  const retries = Math.max(0, attempts - 1);

  return {
    response: lastResponse,
    attempts,
    retries,
    retryCodes,
    durationMs,
    finalStatus,
    upstreamStatus,
    succeeded,
  };
}

// ── race mode: each round fans out N concurrent requests, first 200 wins ────

async function raceMode({ url, fetchOptions, cfg, commonCtx, deadline }) {
  const retryCodes = [];
  let attempts = 0;
  let round = 0;
  // Real last upstream response (returned on failure fallback, instead of hard-coded 503)
  let lastFailed = null;
  const maxRounds = cfg.maxRetries > 0 ? cfg.maxRetries : Infinity;

  while (round < maxRounds) {
    // Total duration fallback
    if (deadline > 0 && Date.now() >= deadline) break;

    round++;
    const controllers = [];
    for (let i = 0; i < cfg.maxConcurrent; i++) {
      controllers.push(new AbortController());
    }

    const promises = controllers.map((ctl, i) => {
      // Each request counts independently (race mode attempts = total requests sent)
      return singleFetch(url, fetchOptions, { ...commonCtx, signal: ctl.signal }).then(r => ({ r, ctl, i }));
    });

    const results = await Promise.all(promises);
    attempts += results.length;

    // Find the first 200 (< 400)
    let winner = null;
    for (const { r, ctl } of results) {
      if (r.status > 0 && r.status < 400) {
        winner = r;
        // Cancel the rest
        for (const c of controllers) {
          if (c !== ctl) try { c.abort(); } catch { /* best effort */ }
        }
        break;
      }
    }

    if (winner) {
      return { response: winner, attempts, retryCodes, upstreamStatus: winner.status };
    }

    // All failed: collect error codes + record the last real failed response
    for (const { r } of results) {
      if (r.status !== 0) {
        retryCodes.push(r.status);
        lastFailed = r;
      } else {
        retryCodes.push(0);
      }
    }

    // Wait then next round
    // race mode computes the wait based on the first error code (429 prefers Retry-After)
    const firstErr = results[0].r;
    const retryAfter = firstErr.headers?.get?.('retry-after') || firstErr.headers?.get?.('Retry-After');
    const wait = computeWaitMs(firstErr.status, retryAfter, cfg);
    if (wait > 0) await sleep(wait);
  }

  // Reached limit/timeout: return the last real failed response (preserving the real status code); fall back to 503 when there is no real failure
  const response = lastFailed || lastFailedResponse();
  return { response, attempts, retryCodes, upstreamStatus: response.status };
}

function lastFailedResponse() {
  return { status: 503, statusText: 'Upstream Overloaded', headers: new Map(), ok: false, body: null, text: async () => 'Upstream Overloaded', json: async () => ({}) };
}

// ── stagger mode: send interleaved, cancel in-flight on any 200 ────────

async function staggerMode({ url, fetchOptions, cfg, commonCtx, deadline }) {
  const retryCodes = [];
  let attempts = 0;
  const inflight = []; // { ctl, promise }
  let resolved = null;
  let lastFailed = null; // real last failed response (returned on fallback instead of hard-coded 503)
  let totalAttempts = 0;
  const maxTotal = cfg.maxRetries > 0 ? cfg.maxRetries : Infinity;
  let consecutive429 = 0;

  // Timeout/limit/resolved → stop dispatching
  const canLaunch = () => !resolved
    && inflight.length < cfg.maxConcurrent
    && totalAttempts < maxTotal
    && !(deadline > 0 && Date.now() >= deadline);

  function launchOne() {
    if (!canLaunch()) return false;
    const ctl = new AbortController();
    const p = singleFetch(url, fetchOptions, { ...commonCtx, signal: ctl.signal }).then(r => {
      // Remove self from inflight
      const idx = inflight.findIndex(x => x.ctl === ctl);
      if (idx >= 0) inflight.splice(idx, 1);

      if (r.status > 0 && r.status < 400) {
        // Success → cancel all in-flight, set resolved
        for (const x of inflight) try { x.ctl.abort(); } catch { /* best effort */ }
        resolved = { response: r, attempts: totalAttempts, retryCodes: [...retryCodes], upstreamStatus: r.status };
        return;
      }
      // Failure: record the real failed response
      if (r.status !== 0) {
        retryCodes.push(r.status);
        lastFailed = r;
      } else {
        retryCodes.push(0);
      }

      if (r.status === 429) {
        // 429: after accumulating, the scheduler lengthens the next dispatch interval via adaptive backoff (no immediate refill)
        consecutive429++;
      } else {
        consecutive429 = 0;
        // Non-429 error → immediately dispatch a replacement (stagger semantics)
        launchOne();
      }
    }).catch(() => {
      const idx = inflight.findIndex(x => x.ctl === ctl);
      if (idx >= 0) inflight.splice(idx, 1);
      retryCodes.push(0);
    });
    inflight.push({ ctl, promise: p });
    totalAttempts++;
    attempts = totalAttempts;
    return true;
  }

  // Current dispatch interval: adaptive backoff when 429s occur consecutively (exponential growth, avoids
  // hammering a rate-limited upstream); otherwise uses retryIntervalMs
  function currentStaggerInterval() {
    if (consecutive429 > 0) return compute429BackoffMs(cfg, consecutive429);
    return cfg.retryIntervalMs > 0 ? cfg.retryIntervalMs : 0;
  }

  // Unified interleaved scheduler: the first wave is also staggered by interval (no longer synchronously
  // dispatching a full batch of maxConcurrent at once); subsequent refills reuse the same scheduler. When there
  // is an inflight slot and the limit/timeout has not been reached, dispatch one, then schedule the next by interval.
  // Dispatch the first immediately (ensures no idle wait); the rest are staggered by interval.
  let staggerTimer = null;
  const launch = () => {
    if (resolved) return;
    if (deadline > 0 && Date.now() >= deadline) return;
    if (canLaunch()) launchOne();
    const interval = currentStaggerInterval();
    if (interval > 0) {
      staggerTimer = setTimeout(launch, interval);
    } else if (inflight.length < cfg.maxConcurrent && totalAttempts < maxTotal && !resolved) {
      // interval=0: still need to keep filling (use a microtask to avoid synchronous infinite recursion)
      staggerTimer = setTimeout(launch, 0);
    }
  };
  // Dispatch the first immediately, starting the staggered loop
  launch();

  // Wait for resolved, all complete, or total duration expiry
  await new Promise((resolve) => {
    const check = () => {
      if (resolved) { resolve(); return; }
      if (deadline > 0 && Date.now() >= deadline) { resolve(); return; }
      if (inflight.length === 0 && (totalAttempts >= maxTotal || !canLaunch())) { resolve(); return; }
      setTimeout(check, 50);
    };
    check();
  });

  if (staggerTimer) clearTimeout(staggerTimer);
  // Clean up any remaining in-flight
  for (const x of inflight) try { x.ctl.abort(); } catch { /* best effort */ }

  if (resolved) return resolved;
  // Fallback: return the last real failed response (preserving the real status code); fall back to 503 when there is no real failure
  const response = lastFailed || lastFailedResponse();
  return { response, attempts, retryCodes, upstreamStatus: response.status };
}
