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
// @returns {boolean} true when the kind's dismissed entries must be wiped
export function shouldWipeApprovalDismissal(prevId, nextId) {
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
  // id → null (clear) or id → different-id (genuinely new pending): wipe.
  return true;
}
