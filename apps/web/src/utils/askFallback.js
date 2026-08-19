// Decision helper for ApprovalModal's fallback AskQuestionForm.
//
// The Question modal body is normally filled by the transcript tool_use block
// portaling an AskQuestionForm into the modal's ask slot (see askPortalMatcher.js).
// When no block portals in — a stale replayed ask whose block is old history, or a
// fresh ask arriving before transcript ingest — the modal would show an empty body.
// The fallback renders a form directly from the authoritative pending-ask broadcast.
//
// Contract: `slotOccupied` is DOM occupancy of the ask slot (MutationObserver on
// childList + sync initial read); `graceElapsed` flips true ASK_FALLBACK_GRACE_MS
// after the ask becomes visible, giving the real portal one commit cycle so fresh
// asks never flash the fallback before the portaled form mounts.

export const ASK_FALLBACK_GRACE_MS = 120;

export function shouldRenderAskFallback({ isAskActive, slotOccupied, graceElapsed, questions, submitHandler }) {
  if (!isAskActive || slotOccupied || !graceElapsed) return false;
  if (!Array.isArray(questions) || questions.length === 0) return false;
  if (typeof submitHandler !== 'function') return false;
  return true;
}
