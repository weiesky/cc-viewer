// Re-export shell — the implementations live in the sibling client-safe module
// session-boundary.js (wire-v2 step S1) so the server-side conversation router
// (S2+) and the client use ONE source of truth for session boundaries
// (docs/refactor/WIRE_FORMAT_V2_PLAN.md). Existing client imports of
// '@ccv/core/clearCheckpoint' keep working through this shell; new code should
// import from '@ccv/core/session-boundary' directly.
export { isPostClearCheckpoint, isCompactContinuation, isSessionBoundary } from './session-boundary.js';
