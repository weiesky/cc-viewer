// Extracted from helpers.js so pure session modules (sessionMerge/sessionManager) and node:test
// can import it without pulling helpers' Vite-only svg imports; helpers.js re-exports it to keep
// existing import paths unchanged (same pattern as autoApproveOptions.js).

/**
 * Resolve the effective model name for a log request entry, preferring the
 * server-reported model in `response.body.model` (authoritative under proxy
 * hot-switch) over the client-supplied `body.model`. Returns null when both
 * are missing — callers should fall back to a sensible default.
 *
 * KEEP IN SYNC: server/lib/context-watcher.js getContextSizeForModel reuses
 * this precedence for its entry path — changing the priority here must be
 * mirrored there (and vice versa).
 */
export function getEffectiveModel(request) {
  return request?.response?.body?.model || request?.body?.model || null;
}
