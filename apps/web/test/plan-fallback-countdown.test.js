// Unit tests for src/utils/planFallbackCountdown.js — the countdown decision behind
// ApprovalModal's ptyPlan fallback PlanApprovalForm.
//
// Regression guarded (fork review 2026-10-29): the fallback hard-coded
// planAutoApproveCountdown={null}, so when the inline transcript card was not
// portaled in, a background server auto-approve fired with NO visible countdown
// and NO cancel affordance. The SDK pending-plan payload already carries the
// server's wall-clock deadline (autoApproveAt); this helper surfaces it so the
// fallback can count down to (and cancel) the auto-approve. PTY plans carry no
// deadline and must stay countdown-less.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planFallbackCountdownDeadline } from '../src/utils/planFallbackCountdown.js';

describe('planFallbackCountdownDeadline', () => {
  it('returns the deadline for an SDK plan carrying a positive autoApproveAt', () => {
    assert.equal(planFallbackCountdownDeadline({ id: 'p1', autoApproveAt: 1700000000000 }), 1700000000000);
  });

  it('returns null for a PTY plan payload (no autoApproveAt)', () => {
    assert.equal(planFallbackCountdownDeadline({ id: 'p1', prompt: null }), null);
  });

  it('returns null for a zero / negative / non-number deadline', () => {
    assert.equal(planFallbackCountdownDeadline({ id: 'p1', autoApproveAt: 0 }), null);
    assert.equal(planFallbackCountdownDeadline({ id: 'p1', autoApproveAt: -5 }), null);
    assert.equal(planFallbackCountdownDeadline({ id: 'p1', autoApproveAt: 'soon' }), null);
  });

  it('returns null for a missing payload', () => {
    assert.equal(planFallbackCountdownDeadline(null), null);
    assert.equal(planFallbackCountdownDeadline(undefined), null);
  });
});
