/**
 * compact-inject-guard.js — per-scope dedup gate for "context compaction injection".
 *
 * When multiple tabs/devices watch the same session, the confirm bar may be clicked on
 * both ends at once. This module dedups server-side by "resolved target identity" so a
 * single confirmation injects only once:
 *   - inFlight:      holds the scope from injection start until ack; concurrent requests
 *                    inside the window are judged duplicate (not sent again)
 *   - lastSuccessAt: keeps a time window after a successful injection, blocking late
 *                    duplicate confirmations from the other end while compaction runs
 *                    (compaction itself is a tens-of-seconds LLM call)
 *
 * busy/failure releases immediately (does not hold the window), so genuine retries pass right away.
 * In-memory only, single process (module-level singleton in server.js); each Electron tab is
 * an independent server subprocess, so no cross-process handling needed.
 */

export function createCompactInjectGuard({ successWindowMs = 60000 } = {}) {
  /** scopeKey -> { inFlight:boolean, lastSuccessAt:number } */
  const scopes = new Map();

  function _entry(scopeKey) {
    let e = scopes.get(scopeKey);
    if (!e) { e = { inFlight: false, lastSuccessAt: 0 }; scopes.set(scopeKey, e); }
    return e;
  }

  /**
   * Try to acquire the injection right for a scope. Returns:
   *   { allowed:true }                    — this call acquired the right (must commit or release afterwards)
   *   { allowed:false, inFlight:true }    — an injection is already in flight (retryable; frontend should reply busy, not fake success)
   *   { allowed:false, duplicate:true }   — still inside the window since the last success (already injected; frontend treats as success)
   */
  function tryBegin(scopeKey, now = Date.now()) {
    if (!scopeKey) return { allowed: false, duplicate: false, badScope: true };
    const e = _entry(scopeKey);
    // In-flight ≠ succeeded: the PTY lock holder may still be polling for idle; if it ends up
    // busy/failed, treating it as duplicate would fake success on the other end (nothing was
    // actually injected). Distinguish the two: in-flight returns inFlight (retryable).
    if (e.inFlight) return { allowed: false, inFlight: true };
    if (e.lastSuccessAt && now - e.lastSuccessAt < successWindowMs) return { allowed: false, duplicate: true };
    e.inFlight = true;
    return { allowed: true };
  }

  /** Injection failed / busy: release the in-flight slot without recording a success time, allowing immediate retry. */
  function release(scopeKey) {
    const e = scopes.get(scopeKey);
    if (e) e.inFlight = false;
  }

  /** Injection succeeded: release the in-flight slot and record the success time (enters the successWindowMs dedup window). */
  function commit(scopeKey, now = Date.now()) {
    const e = _entry(scopeKey);
    e.inFlight = false;
    e.lastSuccessAt = now;
  }

  /** Revoke an "optimistic success" (early not-delivered rollback after SDK ack-on-acceptance):
   *  clears both the in-flight slot and the success window so genuine retries are not judged duplicate. */
  function rollback(scopeKey) {
    const e = scopes.get(scopeKey);
    if (e) { e.inFlight = false; e.lastSuccessAt = 0; }
  }

  /** Called after observing a compaction event / the next turn end: clears the success window,
   *  allowing the next decision. minAgeMs: windows younger than this are kept — prevents the
   *  interrupted round's result from prematurely clearing the success window just established by
   *  a forced compaction, which would let multiple tabs slip through and chain forced compactions (review P1-3). */
  function clearSuccess(scopeKey, { minAgeMs = 0, now = Date.now() } = {}) {
    const e = scopes.get(scopeKey);
    if (!e) return;
    if (minAgeMs > 0 && e.lastSuccessAt && now - e.lastSuccessAt < minAgeMs) return;
    e.lastSuccessAt = 0;
  }

  /** Clear success windows by project: clears the project-level key and all `${project}\0<instance>` instance keys.
   *  On the PTY turn-end production side the scope is already normalized (instances folded away), while the
   *  injecting guard's key carries the instance stamp; the mismatch would leave the 60s window unreleased by
   *  turn end (review P2-2). turn-end calls this function instead.
   *  Also prunes fully idle entries (inFlight=false and lastSuccessAt=0) to keep the Map bounded (P3).
   *  minAgeMs: same as clearSuccess; protects a freshly established success window from early release. */
  function clearProject(project, { minAgeMs = 0, now = Date.now() } = {}) {
    if (!project) return;
    for (const [key, e] of scopes) {
      // Matches the project-level key (project itself) or instance keys (`${project}\0<instance>`); the \0 boundary prevents false matches on projects sharing a name prefix.
      if (key === project || key.startsWith(`${project}\0`)) {
        // Windows younger than minAgeMs are kept (compaction still running), not cleared.
        const tooFresh = minAgeMs > 0 && e && e.lastSuccessAt && now - e.lastSuccessAt < minAgeMs;
        if (e && !tooFresh) e.lastSuccessAt = 0;
        // Reclaim fully idle entries (not in flight, no success window) to avoid one resident entry per instance.
        if (e && !e.inFlight && !e.lastSuccessAt) scopes.delete(key);
      }
    }
  }

  function reset() { scopes.clear(); }

  return { tryBegin, release, commit, rollback, clearSuccess, clearProject, reset };
}
