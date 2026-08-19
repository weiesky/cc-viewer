// Re-export shell — the implementations moved VERBATIM to the shared client-safe
// module server/lib/session-boundary.js in wire-v2 step S1 so the server-side
// conversation router (S2+) and the client use ONE source of truth for session
// boundaries (docs/refactor/WIRE_FORMAT_V2_PLAN.md). Existing client imports of
// './clearCheckpoint.js' keep working through this shell; new code should import
// from server/lib/session-boundary.js directly.
export { isPostClearCheckpoint, isCompactContinuation, isSessionBoundary } from '../../server/lib/session-boundary.js';
