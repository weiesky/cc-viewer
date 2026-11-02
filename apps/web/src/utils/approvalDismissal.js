// Dismissal-wipe policy for the global ApprovalModal, extracted from
// AppBase._setApprovalKind so the WS-reconnect edge is unit-testable without
// mounting the React class (mirrors the interactionOwnership.js precedent).
//
// The modal is dismissed (minimised) per `${kind}:${id}`; the dismissal must
// survive a same-pending re-bubble so the user's minimise is respected, but a
// genuinely new pending must reopen. The transition verdict below is the ONLY
// place that decides which case a frame is.
//
// @param {string|null} prevId - pending id before this frame (null when cleared)
// @param {string|null} nextId - pending id carried by this frame (null on clear)
// @param {object} [opts]
// @param {string} [opts.reason] - 'view-switch' marks the synthetic clear ChatView
//   bubbles when the viewed workspace/instance changes. That clear is NOT a real
//   dismissal: the attach full replay (replaySdkPendingApprovals) re-bubbles the
//   same id right after, so wiping here would reopen a modal the user minimised.
// @returns {boolean} true when the kind's dismissed entries must be wiped
export function shouldWipeApprovalDismissal(prevId, nextId, opts) {
  // Same id (or both null): a replay/clear — never reopen a minimised modal.
  if (prevId === nextId) return false;
  // null → id: either a brand-new pending (nothing dismissed for it yet, so a
  // wipe is a no-op) or a WS-reconnect REPLAY of the same plan the user already
  // minimised — the pending was cleared to null on the blip, so prevId reads
  // null even though the id is unchanged. Wiping here would reopen the
  // minimised modal, so keep dismissals; the wipe below only fires on a real
  // id → different-id swap, where a stale dismissal must not suppress the new
  // pending.
  if (prevId === null) return false;
  // id → null view-switch synthetic clear: keep the dismissal. The attach replay
  // re-bubbles the same id (null → id above), and the wipe already skipped here
  // is what keeps the minimise alive across the round-trip.
  if (nextId === null && opts && opts.reason === 'view-switch') return false;
  // id → null (real clear) or id → different-id (genuinely new pending): wipe.
  return true;
}
