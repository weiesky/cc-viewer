// Unit tests for src/utils/askFallback.js — the decision helper behind
// ApprovalModal's fallback AskQuestionForm (renders the pending ask directly
// when no transcript tool_use block portals into the modal's ask slot).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldRenderAskFallback, ASK_FALLBACK_GRACE_MS } from '../src/utils/askFallback.js';

const QS = [{ question: 'a', options: [{ label: 'x' }] }];
const OK = {
  isAskActive: true,
  slotOccupied: false,
  graceElapsed: true,
  questions: QS,
  submitHandler: () => {},
};

describe('shouldRenderAskFallback', () => {
  it('true when ask is active, slot empty, grace elapsed, questions and handler present', () => {
    assert.equal(shouldRenderAskFallback(OK), true);
  });

  it('false when the ask is not active/visible', () => {
    assert.equal(shouldRenderAskFallback({ ...OK, isAskActive: false }), false);
  });

  it('false when the slot is occupied by the portaled form', () => {
    assert.equal(shouldRenderAskFallback({ ...OK, slotOccupied: true }), false);
  });

  it('false before the grace delay elapses (no flash over the incoming portal)', () => {
    assert.equal(shouldRenderAskFallback({ ...OK, graceElapsed: false }), false);
  });

  it('false for missing/empty/non-array questions', () => {
    assert.equal(shouldRenderAskFallback({ ...OK, questions: [] }), false);
    assert.equal(shouldRenderAskFallback({ ...OK, questions: undefined }), false);
    assert.equal(shouldRenderAskFallback({ ...OK, questions: 'nope' }), false);
  });

  it('false when the submit handler is missing or not a function', () => {
    assert.equal(shouldRenderAskFallback({ ...OK, submitHandler: undefined }), false);
    assert.equal(shouldRenderAskFallback({ ...OK, submitHandler: 42 }), false);
  });

  it('grace constant is a small positive number', () => {
    assert.ok(Number.isFinite(ASK_FALLBACK_GRACE_MS));
    assert.ok(ASK_FALLBACK_GRACE_MS > 0 && ASK_FALLBACK_GRACE_MS < 5000);
  });
});
