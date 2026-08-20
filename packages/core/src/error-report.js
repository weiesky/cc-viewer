// CLIENT-SAFE: no node deps. Home: @ccv/core (error-report.js) — consumed by apps/web + packages/app. Do not add fs/process/node: imports.
/**
 * Error-reporting convention for swallowed catch blocks.
 *
 * Canonical home since wire-v2 S2 (moved verbatim from the client-side
 * errorReport.js; apps/web/src/utils/errorReport.js remains as a re-export
 * shell): server/lib/v2/* writers follow the same convention. Lives in
 * @ccv/core since the core extraction so both sides import one copy.
 *
 * The rule (see CLAUDE.md): a `catch` whose failure has diagnostic value —
 * anything where a throw means lost data or broken UI (SSE/WS event parsing,
 * entry ingest, state updates, fetch response handling) — must call
 * `reportSwallowed(tag, err)` instead of swallowing silently. Purely-benign
 * best-effort guards (localStorage get/set, tabBridge IPC, revokeObjectURL,
 * listener-cleanup `off()`) stay bare `catch {}`.
 *
 * Tag grammar: `<channel>.<event-name-verbatim>`, e.g. `sse.load_chunk`,
 * `sse.stream-progress`, `ws.terminal-msg`. Keep the event name exactly as it
 * appears in the code/protocol so a grep for the tag round-trips to the site.
 * All reports share the greppable `[ccv:` console prefix.
 *
 * Dedup: identical failures usually repeat (e.g. every SSE event of a changed
 * payload shape fails the same way), so each tag logs at most
 * MAX_REPORTS_PER_TAG occurrences per session, then one suppression notice,
 * then goes silent. Counter-based on purpose — no Date/timers, so this module
 * is statically loadable and deterministic under `node --test`.
 */
export const MAX_REPORTS_PER_TAG = 5;

const _counts = new Map();

export function reportSwallowed(tag, err, extra) {
  const n = (_counts.get(tag) || 0) + 1;
  _counts.set(tag, n);
  if (n > MAX_REPORTS_PER_TAG + 1) return;
  if (n === MAX_REPORTS_PER_TAG + 1) {
    console.warn(`[ccv:${tag}] further occurrences suppressed`);
    return;
  }
  if (extra !== undefined) console.warn(`[ccv:${tag}]`, err, extra);
  else console.warn(`[ccv:${tag}]`, err);
}

export function _resetForTest() {
  _counts.clear();
}
