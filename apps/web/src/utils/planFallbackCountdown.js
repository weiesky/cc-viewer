// Countdown decision for ApprovalModal's ptyPlan fallback PlanApprovalForm.
//
// The inline transcript plan card gets its live per-second countdown from
// ChatView state, but the modal fallback renders straight from the bubbled
// pending-plan payload — which carries NO per-second prop. It does, however,
// carry the server's wall-clock auto-approve deadline (`autoApproveAt`) on SDK
// plans, so the fallback can derive the SAME countdown from the deadline and
// still show + cancel a background auto-approve that would otherwise fire
// silently. PTY plans (payload { id, prompt }, no autoApproveAt) stay
// countdown-less, matching the inline PTY card.
//
// Returns the wall-clock deadline in ms to count down to, or null when the
// fallback should render without a countdown.

/**
 * @param {object|null|undefined} payload - approvalGlobal.ptyPlan.ptyPlan
 * @returns {number|null} autoApproveAt deadline ms, or null for no countdown
 */
export function planFallbackCountdownDeadline(payload) {
  const at = payload?.autoApproveAt;
  return (typeof at === 'number' && at > 0) ? at : null;
}
