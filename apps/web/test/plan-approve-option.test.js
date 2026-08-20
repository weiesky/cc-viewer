/**
 * pickPlanApproveOptionNumber: picks the option number that approves a plan, for
 * the "Plan auto-approve" feature. Must mirror the approve-button heuristic in
 * ChatMessage._renderTool_ExitPlanMode (first /yes|approve|accept|proceed/i, else first, else 1).
 */
import assert from 'assert';
import { describe, it } from 'node:test';
import { pickPlanApproveOptionNumber } from '../src/utils/promptClassifier.js';

describe('pickPlanApproveOptionNumber', () => {
  it('picks the option matching approve keywords', () => {
    const opts = [
      { number: 1, text: 'Yes, and auto-accept edits' },
      { number: 2, text: 'Yes, and manually approve edits' },
      { number: 3, text: 'No, keep planning' },
    ];
    assert.strictEqual(pickPlanApproveOptionNumber(opts), 1);
  });

  it('picks the first approve option even when not number 1', () => {
    const opts = [
      { number: 1, text: 'No, keep planning' },
      { number: 2, text: 'Approve this plan' },
    ];
    assert.strictEqual(pickPlanApproveOptionNumber(opts), 2);
  });

  it('skips a feedback/edit option even when it is approve-worded', () => {
    // "Yes, but let me edit" opens a feedback textarea on manual click — must not be auto-submitted.
    const opts = [
      { number: 1, text: 'Yes, but let me edit the plan first' },
      { number: 2, text: 'Approve and run' },
      { number: 3, text: 'No, keep planning' },
    ];
    assert.strictEqual(pickPlanApproveOptionNumber(opts), 2);
  });

  it('matches proceed/accept wording', () => {
    assert.strictEqual(pickPlanApproveOptionNumber([
      { number: 1, text: 'Would you like to proceed?' },
      { number: 2, text: 'Cancel' },
    ]), 1);
  });

  it('falls back to the first option when nothing matches', () => {
    const opts = [
      { number: 1, text: 'Option A' },
      { number: 2, text: 'Option B' },
    ];
    assert.strictEqual(pickPlanApproveOptionNumber(opts), 1);
  });

  it('falls back to 1 for empty/invalid input', () => {
    assert.strictEqual(pickPlanApproveOptionNumber([]), 1);
    assert.strictEqual(pickPlanApproveOptionNumber(null), 1);
    assert.strictEqual(pickPlanApproveOptionNumber(undefined), 1);
  });

  it('honors the option number field over array index', () => {
    const opts = [
      { number: 5, text: 'Yes, approve' },
      { number: 6, text: 'No' },
    ];
    assert.strictEqual(pickPlanApproveOptionNumber(opts), 5);
  });
});
