/**
 * Unit tests for resolveAskQuestions (src/utils/askOptionDesc.js).
 *
 * Regression guard for the 2026-07-02 blank multi-question popup and the 2026-07-04
 * hollow-at-equal-length variant (large options[].preview payloads materialize the
 * outer questions[] shape before element content): the modal body is filled by the
 * streamed tool_use block, which can carry empty/hollow questions while the stream is
 * still assembling. resolveAskQuestions prefers the authoritative pendingAsk.questions
 * for the currently-pending ask so the popup never renders blank, and only borrows it
 * on legacy placeholder ids when the streamed render would otherwise be empty.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAskQuestions } from '../src/utils/askOptionDesc.js';

const Q1 = [{ question: 'a', header: 'A', options: [{ label: 'x' }] }];
const Q2 = [
  { question: 'a', header: 'A', options: [{ label: 'x' }] },
  { question: 'b', header: 'B', options: [{ label: 'y' }] },
];
const TOOL_ID = 'tooluse_abc';

describe('resolveAskQuestions', () => {
  it('uses authoritative pendingAsk.questions when streamed is empty (owner block)', () => {
    const pendingAsk = { id: TOOL_ID, questions: Q2 };
    const out = resolveAskQuestions([], TOOL_ID, TOOL_ID, pendingAsk);
    assert.equal(out, Q2);
  });

  it('uses authoritative when streamed is shorter than authoritative', () => {
    const pendingAsk = { id: TOOL_ID, questions: Q2 };
    const out = resolveAskQuestions(Q1, TOOL_ID, TOOL_ID, pendingAsk);
    assert.equal(out, Q2);
  });

  it('prefers authoritative for the pending ask even when streamed looks complete', () => {
    const streamed = Q2.map((q) => ({ ...q }));
    const pendingAsk = { id: TOOL_ID, questions: Q2 };
    const out = resolveAskQuestions(streamed, TOOL_ID, TOOL_ID, pendingAsk);
    assert.equal(out, Q2);
  });

  it('uses authoritative when streamed has equal length but hollow questions', () => {
    // Partial-JSON assembly materializes the array shape before element content:
    // two question objects exist but carry no text/options yet.
    const pendingAsk = { id: TOOL_ID, questions: Q2 };
    const out = resolveAskQuestions([{}, {}], TOOL_ID, TOOL_ID, pendingAsk);
    assert.equal(out, Q2);
  });

  it('uses authoritative when streamed is partially hollow at equal length', () => {
    const streamed = [
      { question: 'a', header: 'A', options: [{ label: 'x' }] },
      { question: '', options: [] },
    ];
    const pendingAsk = { id: TOOL_ID, questions: Q2 };
    const out = resolveAskQuestions(streamed, TOOL_ID, TOOL_ID, pendingAsk);
    assert.equal(out, Q2);
  });

  it('uses authoritative when streamed options are missing labels', () => {
    const streamed = [
      { question: 'a', header: 'A', options: [{}, {}] },
      { question: 'b', header: 'B', options: [{}] },
    ];
    const pendingAsk = { id: TOOL_ID, questions: Q2 };
    const out = resolveAskQuestions(streamed, TOOL_ID, TOOL_ID, pendingAsk);
    assert.equal(out, Q2);
  });

  it('preserves preview and multiSelect fields on the authoritative copy', () => {
    const questions = [
      {
        question: 'a',
        header: 'A',
        multiSelect: false,
        options: [{ label: 'x', description: 'dx', preview: 'line1\nline2\nline3' }],
      },
      { question: 'b', header: 'B', multiSelect: true, options: [{ label: 'y' }] },
    ];
    const pendingAsk = { id: TOOL_ID, questions };
    const out = resolveAskQuestions([{}, {}], TOOL_ID, TOOL_ID, pendingAsk);
    assert.equal(out, questions);
    assert.equal(out[0].options[0].preview, 'line1\nline2\nline3');
    assert.equal(out[1].multiSelect, true);
  });

  it('keeps streamed when authoritative is empty or non-array despite matching ids', () => {
    assert.equal(
      resolveAskQuestions(Q1, TOOL_ID, TOOL_ID, { id: TOOL_ID, questions: [] }),
      Q1
    );
    assert.equal(
      resolveAskQuestions(Q1, TOOL_ID, TOOL_ID, { id: TOOL_ID, questions: null }),
      Q1
    );
  });

  it('fills an empty render from placeholder-id pendingAsk (legacy servers)', () => {
    for (const placeholderId of ['__ask__', 'ask_123_abc']) {
      const pendingAsk = { id: placeholderId, questions: Q2 };
      const out = resolveAskQuestions([], TOOL_ID, TOOL_ID, pendingAsk);
      assert.equal(out, Q2, `placeholder id ${placeholderId}`);
    }
  });

  it('never overrides a non-empty render from placeholder-id pendingAsk', () => {
    // Compatibility gate: a stale legacy pendingAsk must not inject a previous
    // ask's questions over content the owner block already renders.
    for (const placeholderId of ['__ask__', 'ask_123_abc']) {
      const pendingAsk = { id: placeholderId, questions: Q2 };
      const out = resolveAskQuestions(Q1, TOOL_ID, TOOL_ID, pendingAsk);
      assert.equal(out, Q1, `placeholder id ${placeholderId}`);
    }
  });

  it('keeps streamed for placeholder-id pendingAsk when block is not the owner', () => {
    const pendingAsk = { id: '__ask__', questions: Q2 };
    const out = resolveAskQuestions([], TOOL_ID, 'someone_else', pendingAsk);
    assert.deepEqual(out, []);
  });

  it('does not borrow from a real (non-placeholder) mismatched pendingAsk id even when empty', () => {
    // Guards the placeholder gate against widening: a different real tool id is a
    // different ask, never a naming fallback for this block.
    const pendingAsk = { id: 'toolu_other', questions: Q2 };
    assert.deepEqual(resolveAskQuestions([], TOOL_ID, TOOL_ID, pendingAsk), []);
  });

  it('keeps streamed when toolId is not the pending ask (history block)', () => {
    const pendingAsk = { id: 'other_id', questions: Q2 };
    const out = resolveAskQuestions(Q1, TOOL_ID, 'other_id', pendingAsk);
    assert.equal(out, Q1);
  });

  it('keeps streamed when toolId is not the last pending ask id', () => {
    // block matches pendingAsk.id but is not the interactive owner (lastPendingAskId differs)
    const pendingAsk = { id: TOOL_ID, questions: Q2 };
    const out = resolveAskQuestions(Q1, TOOL_ID, 'someone_else', pendingAsk);
    assert.equal(out, Q1);
  });

  it('returns [] and never throws when streamed is non-array and no pendingAsk', () => {
    assert.deepEqual(resolveAskQuestions(undefined, TOOL_ID, TOOL_ID, null), []);
    assert.deepEqual(resolveAskQuestions(null, null, null, undefined), []);
  });

  it('does not fall back when authoritative is not longer (never shrinks streamed)', () => {
    const pendingAsk = { id: TOOL_ID, questions: Q1 };
    const out = resolveAskQuestions(Q2, TOOL_ID, TOOL_ID, pendingAsk);
    assert.equal(out, Q2);
  });
});
