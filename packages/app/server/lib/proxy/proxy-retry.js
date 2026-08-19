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
import { resolveProfileModel } from '../interceptor-core.js';
import { readFileSync, existsSync } from 'node:fs';
import { reportSwallowed } from '../error-report.js';

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
    } catch (err) {
      // retry-config.json written by the UI is corrupt/unreadable → fall back to env.
      // Not fatal, but a silent swallow would hide a config the user believes is active.
      reportSwallowed('proxyRetry.load-config-file', err);
    }
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
  } catch (err) {
    // A misbehaving header object would make us misclassify the response, which
    // changes retry behavior (streaming 200 is never retried). Surface it.
    reportSwallowed('proxyRetry.is-stream-response', err);
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
  } catch (err) {
    // Unparseable body → stats detail record loses the model field. Surface it
    // so a regression in request-body handling isn't hidden behind empty models.
    reportSwallowed('proxyRetry.extract-model', err);
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
  } catch (err) {
    // JSON.parse failure means model replacement silently no-ops; the request
    // still goes out with the original (un-replaced) model. Surface it so the
    // mismatch between configured replacement and actual body isn't silent.
    reportSwallowed('proxyRetry.apply-model-replacement', err);
    return body;
  }
}

/**
 * Abortable sleep: resolves early (never rejects) when the signal fires, so a
 * client disconnect interrupts retry waits instead of parking the loop for the
 * full interval (a large upstream Retry-After would otherwise pin an abandoned
 * request for its whole duration).
 */
function sleep(ms, signal) {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve();
    let timer = null;
    const done = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

/** Never sleep past the total-duration deadline (0 = no deadline). */
function clampWaitToDeadline(wait, deadline) {
  if (deadline > 0) return Math.max(0, Math.min(wait, deadline - Date.now()));
  return wait;
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
 * Attaches a streaming-idle watchdog to a streaming response body.
 *
 * Why: connectTimeoutMs only bounds time-to-HEADERS; once headers arrive the
 * connect timer is cleared and the retry loop breaks (streaming 200 is never
 * retried — retry-before-first-byte strategy). If the upstream then stalls
 * (200 headers but no body chunk ever arrives — a hung upstream), the piped
 * response would hang indefinitely, pinning the client socket and the upstream
 * socket until the client gives up. streamIdleTimeoutMs bounds the max gap
 * between two chunks; exceeding it errors the body so proxy.js's pipeline
 * surfaces the stall instead of hanging.
 *
 * Implemented as a TransformStream pass-through so response.body stays a valid
 * ReadableStream (Readable.fromWeb in proxy.js keeps working): each enqueued
 * chunk resets the timer; a stalled stream fires the timer, which calls
 * controller.error(), aborting the fetch's underlying body and breaking the
 * pipeline.
 *
 * @param {ReadableStream} body original streaming body
 * @param {number} idleMs max gap between chunks (0 = disabled)
 * @param {AbortSignal} signal external signal (race/stagger loser cancel + client disconnect)
 * @returns {ReadableStream} watched body (same chunks, bounded idle)
 */
function applyStreamIdleWatchdog(body, idleMs, signal) {
  if (!body || typeof body?.pipeThrough !== 'function') return body;
  if (!idleMs || idleMs <= 0) return body;
  let timer = null;
  let aborted = false;
  const arm = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      aborted = true;
      controller.error(new Error(`proxy stream idle timeout (${idleMs}ms)`));
    }, idleMs);
  };
  let controller;
  const transform = new TransformStream({
    start(ctl) { controller = ctl; arm(); if (signal) signal.addEventListener('abort', disarm, { once: true }); },
    transform(chunk, ctl) {
      if (aborted) return; // already errored — drop late chunks
      ctl.enqueue(chunk);
      arm(); // reset on each chunk
    },
    flush() { disarm(); },
    cancel() { disarm(); },
  });
  function disarm() { if (timer) { clearTimeout(timer); timer = null; } }
  // teeThrough keeps our transform in the path; pipeThrough returns the readable end.
  // Only pass signal when present — pipeThrough rejects a null/undefined signal.
  return signal
    ? body.pipeThrough(transform, { signal })
    : body.pipeThrough(transform);
}

/**
 * Executes a single fetch request with the x-cc-viewer-trace header + network proxy dispatcher.
 * Returns the raw Response. Does not throw (on network errors returns { __networkError: true, status: 0 }).
 *
 * @param {string} url full URL
 * @param {object} fetchOptions method/headers/body
 * @param {object} ctx { dispatcher, connectTimeoutMs, streamIdleTimeoutMs, signal }
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

  // Compose the fetch signal from the external signal (race/stagger loser
  // cancellation + client disconnect) and the header-arrival timeout. The
  // composition must stay live for the WHOLE response lifetime — the previous
  // listener-bridge design detached the external signal the moment fetch
  // resolved (headers in), which made a loser's already-streaming body
  // un-cancellable: ctl.abort() no longer reached the signal fetch was holding.
  // AbortSignal.any keeps the linkage for as long as the body exists; the
  // finally below only clears the timeout timer, never the external linkage.
  let timeoutTimer = null;
  let timeoutCtl = null;
  const signals = [];
  if (ctx.signal) signals.push(ctx.signal);
  if (ctx.connectTimeoutMs > 0) {
    timeoutCtl = new AbortController();
    timeoutTimer = setTimeout(() => timeoutCtl.abort(), ctx.connectTimeoutMs);
    signals.push(timeoutCtl.signal);
  }
  if (signals.length === 1) opts.signal = signals[0];
  else if (signals.length > 1) opts.signal = AbortSignal.any(signals);

  try {
    const response = await fetch(url, opts);
    // Streaming responses: attach the idle watchdog so a hung body (headers in,
    // no chunks) breaks within streamIdleTimeoutMs instead of pinning sockets.
    // connectTimeoutMs already cleared below can't help — it only bound headers.
    if (response?.body && ctx.streamIdleTimeoutMs > 0 && isStreamResponse(response)) {
      const watched = applyStreamIdleWatchdog(response.body, ctx.streamIdleTimeoutMs, ctx.signal);
      return new Response(watched, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
    return response;
  } catch (err) {
    // Network error/timeout/cancellation → return a pseudo response; status=0 indicates an error
    const aborted = ctx.signal?.aborted || timeoutCtl?.signal.aborted;
    // Aborts are expected (race loser cancellation, client disconnect, connect
    // timeout) — not diagnostic. Only surface genuine network errors so a
    // failing upstream isn't hidden behind status=0 pseudo-responses.
    if (err && !aborted) reportSwallowed('proxyRetry.single-fetch', err);
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
  }
}

/**
 * Best-effort release of a response body that will never be piped to the
 * client (failed attempts, losers of a settled race, replaced lastFailed).
 * Leaving these undrained keeps the upstream socket out of undici's pool and
 * pins memory for the life of the stream.
 */
function discardBody(response) {
  try { response?.body?.cancel?.()?.catch?.(() => {}); } catch { /* best effort */ }
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
  // Client-disconnect signal from the proxy: when it fires, every in-flight
  // attempt is aborted and no further attempts/waits are scheduled — a request
  // whose client is gone must not keep billing the upstream for up to
  // maxRetryDurationMs.
  const clientSignal = ctx?.signal || null;

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

  // Backward-compat guarantee for mode 'off': the legacy proxy path awaited
  // fetch with NO timeout at all (undici's own default only). connectTimeoutMs
  // actually bounds time-to-HEADERS, and non-streaming completions can hold
  // headers well past 10s — so with retry disabled we must not introduce a new
  // failure mode. The timeout applies only when a retry mode is active.
  const effectiveConnectTimeoutMs = cfg.mode === 'off' ? 0 : cfg.connectTimeoutMs;
  // streamIdleTimeoutMs is gated to retry modes only (NOT off), mirroring the
  // connectTimeoutMs off-exclusion above. The watchdog wraps response.body in a
  // TransformStream, but the interceptor (server/interceptor.js) already
  // reconstructs response.body via getReader() + a new ReadableStream for
  // logging/live-streaming; under concurrent load the watchdog's pipeThrough
  // races that reconstruction and surfaces as a spurious `fetch failed` →
  // status 0 → 502. off mode is the legacy pass-through path (no retry), so the
  // watchdog's value (bound idle on a hung stream) is marginal here and the
  // interceptor already observes the stream — serial/race/stagger keep the guard.
  const effectiveStreamIdleMs = cfg.mode === 'off' ? 0 : (cfg.streamIdleTimeoutMs > 0 ? cfg.streamIdleTimeoutMs : 0);
  const commonCtx = { dispatcher, connectTimeoutMs: effectiveConnectTimeoutMs, streamIdleTimeoutMs: effectiveStreamIdleMs };

  if (cfg.mode === 'off' || cfg.mode === 'serial') {
    // off / serial: serial retry. off = no retry (break on any status); serial = controlled by maxRetries (0=infinite, capped by deadline)
    const isOff = cfg.mode === 'off';
    const effectiveMax = isOff ? 0 : cfg.maxRetries;
    while (true) {
      // Total duration fallback: when maxRetries=0 (infinite), prevent permanent hang under sustained upstream congestion
      if (deadline > 0 && Date.now() >= deadline) break;
      if (clientSignal?.aborted) break;

      attempts++;
      lastResponse = await singleFetch(url, finalFetchOptions, { ...commonCtx, signal: clientSignal });
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

      // Release the failed response's body BEFORE waiting — holding an
      // undrained body across the sleep pins the upstream socket for the
      // whole interval.
      discardBody(lastResponse);

      // Wait (abortable: a client disconnect ends it early; clamped so a huge
      // Retry-After can never sleep past the total-duration deadline)
      const retryAfter = lastResponse.headers?.get?.('retry-after') || lastResponse.headers?.get?.('Retry-After');
      const wait = clampWaitToDeadline(computeWaitMs(status, retryAfter, cfg), deadline);
      if (wait > 0) await sleep(wait, clientSignal);
    }
  } else if (cfg.mode === 'race') {
    const result = await raceMode({ url, fetchOptions: finalFetchOptions, cfg, commonCtx, deadline, clientSignal });
    attempts = result.attempts;
    retryCodes.push(...result.retryCodes);
    lastResponse = result.response;
    if (result.upstreamStatus !== undefined) upstreamStatus = result.upstreamStatus;
  } else if (cfg.mode === 'stagger') {
    const result = await staggerMode({ url, fetchOptions: finalFetchOptions, cfg, commonCtx, deadline, clientSignal });
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

async function raceMode({ url, fetchOptions, cfg, commonCtx, deadline, clientSignal }) {
  const retryCodes = [];
  let attempts = 0;
  let round = 0;
  // Real last upstream response (returned on failure fallback, instead of hard-coded 503)
  let lastFailed = null;
  const maxRounds = cfg.maxRetries > 0 ? cfg.maxRetries : Infinity;

  while (round < maxRounds) {
    // Total duration fallback + client gone
    if (deadline > 0 && Date.now() >= deadline) break;
    if (clientSignal?.aborted) break;

    round++;
    // Hedged round: launch maxConcurrent attempts and resolve the round the
    // moment ANY attempt succeeds — the winner must not wait for the slowest
    // straggler (the old Promise.all design gated the round on the slowest
    // header arrival and "aborted" losers only after they had already
    // settled, i.e. never). Losers still pending are aborted immediately;
    // late settlers after the win just have their bodies discarded.
    const controllers = [];
    const roundWinner = await new Promise((resolveRound) => {
      let settled = 0;
      let won = false;
      for (let i = 0; i < cfg.maxConcurrent; i++) {
        const ctl = new AbortController();
        controllers.push(ctl);
        const signal = clientSignal ? AbortSignal.any([clientSignal, ctl.signal]) : ctl.signal;
        attempts++;
        singleFetch(url, fetchOptions, { ...commonCtx, signal }).then((r) => {
          settled++;
          if (won) {
            // A winner already streamed to the client — this attempt's body is unwanted.
            discardBody(r);
            return;
          }
          if (r.status > 0 && r.status < 400) {
            won = true;
            for (const c of controllers) {
              if (c !== ctl) try { c.abort(); } catch { /* best effort */ }
            }
            resolveRound(r);
            return;
          }
          // Failure: keep the latest REAL failed response for the final
          // fallback (discarding the body of the one it replaces), count it.
          if (r.status !== 0) {
            retryCodes.push(r.status);
            if (lastFailed) discardBody(lastFailed);
            lastFailed = r;
          } else {
            retryCodes.push(0);
          }
          if (settled >= controllers.length) resolveRound(null);
        });
      }
    });

    if (roundWinner) {
      if (lastFailed) discardBody(lastFailed); // fallback candidate no longer needed
      return { response: roundWinner, attempts, retryCodes, upstreamStatus: roundWinner.status };
    }
    if (clientSignal?.aborted) break;

    // All failed → wait then next round. Base the wait on the last real
    // failure (a network-errored attempt has empty headers and status 0 and
    // would silently drop an upstream Retry-After carried by a sibling 429).
    const waitSrc = lastFailed;
    const retryAfter = waitSrc?.headers?.get?.('retry-after') || waitSrc?.headers?.get?.('Retry-After');
    const wait = clampWaitToDeadline(computeWaitMs(waitSrc ? waitSrc.status : 0, retryAfter, cfg), deadline);
    if (wait > 0) await sleep(wait, clientSignal);
  }

  // Reached limit/timeout: return the last real failed response (preserving the real status code); fall back to 503 when there is no real failure
  const response = lastFailed || lastFailedResponse();
  return { response, attempts, retryCodes, upstreamStatus: response.status };
}

function lastFailedResponse() {
  return { status: 503, statusText: 'Upstream Overloaded', headers: new Map(), ok: false, body: null, text: async () => 'Upstream Overloaded', json: async () => ({}) };
}

// ── stagger mode: send interleaved, cancel in-flight on any 200 ────────

async function staggerMode({ url, fetchOptions, cfg, commonCtx, deadline, clientSignal }) {
  const retryCodes = [];
  let attempts = 0;
  const inflight = []; // { ctl, promise }
  let resolved = null;
  let lastFailed = null; // real last failed response (returned on fallback instead of hard-coded 503)
  let totalAttempts = 0;
  const maxTotal = cfg.maxRetries > 0 ? cfg.maxRetries : Infinity;
  let consecutive429 = 0;

  // Timeout/limit/resolved/client-gone → stop dispatching
  const canLaunch = () => !resolved
    && !clientSignal?.aborted
    && inflight.length < cfg.maxConcurrent
    && totalAttempts < maxTotal
    && !(deadline > 0 && Date.now() >= deadline);

  function launchOne() {
    if (!canLaunch()) return false;
    const ctl = new AbortController();
    const signal = clientSignal ? AbortSignal.any([clientSignal, ctl.signal]) : ctl.signal;
    const p = singleFetch(url, fetchOptions, { ...commonCtx, signal }).then(r => {
      // Remove self from inflight
      const idx = inflight.findIndex(x => x.ctl === ctl);
      if (idx >= 0) inflight.splice(idx, 1);

      // Single-winner latch: two attempts can land a 200 in the same tick.
      // Without this guard the second would overwrite `resolved` with a
      // response whose body the first winner's cleanup just aborted — the
      // client would receive a truncated 200.
      if (resolved) {
        discardBody(r);
        return;
      }
      if (r.status > 0 && r.status < 400) {
        // Success → set resolved FIRST (canLaunch relies on it), then cancel all in-flight
        resolved = { response: r, attempts: totalAttempts, retryCodes: [...retryCodes], upstreamStatus: r.status };
        for (const x of inflight) try { x.ctl.abort(); } catch { /* best effort */ }
        return;
      }
      // Failure: record the real failed response (keep only the newest body
      // for the final fallback; drain the one it replaces)
      if (r.status !== 0) {
        retryCodes.push(r.status);
        if (lastFailed) discardBody(lastFailed);
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
    if (clientSignal?.aborted) return;
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

  // Wait for resolved, all complete, client disconnect, or total duration expiry
  await new Promise((resolve) => {
    const check = () => {
      if (resolved) { resolve(); return; }
      if (clientSignal?.aborted && inflight.length === 0) { resolve(); return; }
      if (deadline > 0 && Date.now() >= deadline) { resolve(); return; }
      if (inflight.length === 0 && (totalAttempts >= maxTotal || !canLaunch())) { resolve(); return; }
      setTimeout(check, 50);
    };
    // A client disconnect aborts every in-flight attempt right away (their
    // settle handlers then drain via the aborted pseudo-responses).
    clientSignal?.addEventListener('abort', () => {
      for (const x of inflight) try { x.ctl.abort(); } catch { /* best effort */ }
    }, { once: true });
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
