// Re-export shell — the implementation moved VERBATIM to server/lib/error-report.js
// in wire-v2 step S2: server-side modules (server/lib/v2/*) must honor the same
// reportSwallowed convention (CLAUDE.md), and `src/` is not shipped in the npm
// package (`files` array), so the canonical home has to live under server/.
// The module is dependency-free (console.warn + Map), hence CLIENT-SAFE.
export { reportSwallowed, MAX_REPORTS_PER_TAG, _resetForTest } from '../../../../packages/app/server/lib/error-report.js';
