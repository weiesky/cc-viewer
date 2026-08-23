/**
 * sdk-adapter.js — SDK-mode approval helpers.
 *
 * NOTE: SDK-mode display entries are no longer synthesized here. The SDK child
 * process talks to the API through cc-viewer's loopback proxy, so entries reach
 * the frontend via the same wire path as PTY mode (fetch hook → V2Writer →
 * live-feed → SSE). Only the approval-close mapping below remains in use
 * (server.js interruptTurn fan-out).
 */

/**
 * Map an SDK approval `kind` to the WS broadcast message type that closes that
 * kind's modal on every client. Used when interruptTurn() drains pending approvals
 * and server.js must tell all clients to dismiss the corresponding modal.
 *
 * `kind` originates in sdk-manager `_waitForApproval` ('ask' | 'plan' | 'perm') and
 * may be null (unknown / legacy). Pure + dependency-free so server.js imports it
 * directly and it stays unit-testable.
 *
 *   ask  → 'ask-hook-cancelled'   (typed-interrupt / ask-cancel ack channel)
 *   plan → 'sdk-plan-resolved'    (ExitPlanMode modal close)
 *   else → 'perm-hook-resolved'   ('perm' + null/unknown fall back to permission close)
 */
export function sdkApprovalCloseType(kind) {
  if (kind === 'ask') return 'ask-hook-cancelled';
  if (kind === 'plan') return 'sdk-plan-resolved';
  return 'perm-hook-resolved';
}
