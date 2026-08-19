// wire-v2 S10b — in-flight coalescing + bounded TTL micro-cache for the
// windowed v2 reads (docs/refactor/WIRE_FORMAT_V2.md §14.1).
//
// Concurrent windowed loads of the SAME session (multi-tab /events cold loads,
// EventSource auto-reconnect storms, /api/local-log + IM popup on the live
// session) used to run one full synthesis EACH — 2-3 concurrent 1.5GB
// syntheses was the 2026-07-15 OOM trigger. Coalescing shares one run.
//
// Cache semantics (algorithm review F5b): callers pass `cached` per run.
//   cached=true  — read-only historical surfaces (/api/local-log tail, IM
//                  popup): may consume a ≤ttl-stale result. IM freshness is
//                  backfilled by the im_log_update SSE stream.
//   cached=false — the /events live-attach path: NEVER reads the ≤ttl cache,
//                  and still populates the cache for later historical readers.
//                  NOTE it does NOT guarantee a maximally-fresh window: it
//                  still JOINS a currently-executing run for the same key, so
//                  its result reflects the moment that run STARTED (staleness ≤
//                  one in-flight run's duration). For /events this is bounded
//                  because the live-attach path only uses the LEVEL-1 scan
//                  flight (a light descriptor pass), not the level-2 window
//                  flight; the client's next `since` reconnect heals any gap.
//                  Refusing to join would reopen the reconnect-storm OOM.
// Failed runs are never cached; the in-flight slot is always released.
//
// Bounded cache: a whole window object (entries: string[]) can be hundreds of
// MB, so beyond the TTL sweep the cache is capped at MAX_CACHE_ENTRIES
// (oldest-inserted evicted) — a burst of distinct keys (rapid `before`
// pagination, many sessions) within one TTL must not re-accumulate the very
// memory pressure S10 removes.
const MAX_CACHE_ENTRIES = 8;

export class SingleFlight {
  /**
   * @param {{ttlMs?: number, now?: () => number}} [opts] - ttlMs bounds the
   *   micro-cache; now is clock injection for tests.
   */
  constructor(opts = {}) {
    this._ttlMs = typeof opts.ttlMs === 'number' ? opts.ttlMs : 500;
    this._now = opts.now || Date.now;
    this._inflight = new Map(); // key → Promise
    this._cache = new Map();    // key → {value, expiresAt}
  }

  /**
   * Run `fn` under `key`, coalescing with any in-flight run of the same key.
   * @param {string} key
   * @param {() => Promise<any>|any} fn
   * @param {{cached?: boolean}} [opts] - cached=false bypasses the cache READ
   *   (live-attach safety) while still joining/populating.
   * @returns {Promise<any>}
   */
  run(key, fn, opts = {}) {
    const cached = opts.cached !== false;
    this._sweep();
    if (cached) {
      const c = this._cache.get(key);
      if (c && this._now() < c.expiresAt) return Promise.resolve(c.value);
    }
    const existing = this._inflight.get(key);
    if (existing) return existing;
    // Cache write + in-flight cleanup settle in the SAME continuation as the
    // run, BEFORE the returned promise resolves — so a later caller never joins
    // an already-settled run (which would defeat cached=false freshness) and
    // never sees a populated cache without the slot cleared.
    const p = (async () => {
      // Defer fn to a microtask so this._inflight.set(key, p) below runs FIRST
      // — otherwise a synchronous throw in fn would run the finally (delete)
      // before the slot is even registered, stranding it.
      try {
        const value = await Promise.resolve().then(fn);
        this._cache.set(key, { value, expiresAt: this._now() + this._ttlMs });
        this._evict();
        return value;
      } finally {
        this._inflight.delete(key); // errors are never cached; slot always released
      }
    })();
    this._inflight.set(key, p);
    return p;
  }

  /** Drop expired cache entries — values can be large (window objects), so
   *  they must not outlive their TTL just because no one asked again. */
  _sweep() {
    const t = this._now();
    for (const [key, e] of this._cache) {
      if (t >= e.expiresAt) this._cache.delete(key);
    }
  }

  /** Enforce the size cap: Map preserves insertion order, so the first keys are
   *  the oldest — evict them until at/under MAX_CACHE_ENTRIES. */
  _evict() {
    while (this._cache.size > MAX_CACHE_ENTRIES) {
      const oldest = this._cache.keys().next().value;
      this._cache.delete(oldest);
    }
  }

  /** Test hook: current cache/in-flight sizes. */
  _statsForTest() {
    return { cacheSize: this._cache.size, inflightSize: this._inflight.size };
  }
}
