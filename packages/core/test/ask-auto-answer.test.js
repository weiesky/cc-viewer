/**
 * Unit tests for @ccv/core/ask-auto-answer (packages/core/src/) — the Recommended-marker
 * vocabulary and the AskUserQuestion auto-answer picker.
 *
 * The picker feeds the server-side hosting timers: a regression here silently answers
 * real user questions with the wrong option.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RECOMMENDED_MARKERS, isRecommendedLabel, pickAutoAnswers } from '../src/ask-auto-answer.js';

describe('isRecommendedLabel', () => {
  it('matches every marker in the vocabulary (parametrized over all locales)', () => {
    for (const marker of RECOMMENDED_MARKERS) {
      assert.equal(isRecommendedLabel(`Option (${marker})`), true, `marker ${marker} should match`);
    }
  });

  it('pins the full vocabulary literally — dropping a locale marker must fail the test', () => {
    // Not self-referential: iterate a hard-coded expectation, not RECOMMENDED_MARKERS.
    const EXPECTED = [
      '推荐', '推薦', 'recommended', '推奨', '추천', 'empfohlen', 'recomendado',
      'recommandé', 'consigliato', 'anbefalet', 'anbefalt', 'zalecane',
      'рекомендуется', 'рекомендовано', 'موصى به', 'แนะนำ', 'önerilen',
    ];
    assert.deepEqual([...RECOMMENDED_MARKERS].sort(), [...EXPECTED].sort(),
      'a locale marker must not silently disappear from the vocabulary');
  });

  it('negated markers are NOT treated as recommended', () => {
    assert.equal(isRecommendedLabel('Delete everything (Not recommended)'), false);
    assert.equal(isRecommendedLabel('不推荐此方案'), false);
    assert.equal(isRecommendedLabel('非推奨の操作'), false);
    assert.equal(isRecommendedLabel('Nicht empfohlen'), false);
    assert.equal(isRecommendedLabel('No recomendado'), false);
    assert.equal(isRecommendedLabel('비추천 옵션'), false);
  });

  it('negation on one occurrence does not hide a later genuine marker', () => {
    assert.equal(isRecommendedLabel('Not the previous one, but Recommended here'), true);
  });

  it('is case-insensitive', () => {
    assert.equal(isRecommendedLabel('Yes (RECOMMENDED)'), true);
    assert.equal(isRecommendedLabel('Yes (ReCoMmEnDeD)'), true);
  });

  it('matches markers anywhere in the label (substring semantics)', () => {
    assert.equal(isRecommendedLabel('推荐方案 A'), true);
    assert.equal(isRecommendedLabel('Option B — Recommended for CI'), true);
  });

  it('rejects non-string and empty labels', () => {
    assert.equal(isRecommendedLabel(undefined), false);
    assert.equal(isRecommendedLabel(null), false);
    assert.equal(isRecommendedLabel(42), false);
    assert.equal(isRecommendedLabel(''), false);
  });

  it('does not match unrelated labels', () => {
    assert.equal(isRecommendedLabel('Just an option'), false);
    assert.equal(isRecommendedLabel('别的选项'), false);
  });
});

describe('pickAutoAnswers', () => {
  const q = (options, extra = {}) => ({
    question: 'Which option?',
    header: 'Choice',
    multiSelect: false,
    options,
    ...extra,
  });
  const opt = (label, description = '') => ({ label, description });

  it('picks the option carrying a Recommended marker', () => {
    const answers = pickAutoAnswers([q([opt('Plan A'), opt('Plan B (Recommended)')])]);
    assert.deepEqual(answers, { 'Which option?': 'Plan B (Recommended)' });
  });

  it('multiple markers → first matching option wins', () => {
    const answers = pickAutoAnswers([q([opt('A (推荐)'), opt('B (Recommended)')])]);
    assert.deepEqual(answers, { 'Which option?': 'A (推荐)' });
  });

  it('no marker → first option wins', () => {
    const answers = pickAutoAnswers([q([opt('First'), opt('Second'), opt('Third')])]);
    assert.deepEqual(answers, { 'Which option?': 'First' });
  });

  it('answers are keyed by the question text', () => {
    const answers = pickAutoAnswers([
      { question: 'Q1?', header: 'a', multiSelect: false, options: [opt('x')] },
      { question: 'Q2?', header: 'b', multiSelect: false, options: [opt('y (Recommended)'), opt('z')] },
    ]);
    assert.deepEqual(answers, { 'Q1?': 'x', 'Q2?': 'y (Recommended)' });
  });

  it('multiSelect degenerates to a single label (not a joined list)', () => {
    const answers = pickAutoAnswers([
      { question: 'Pick many?', header: 'm', multiSelect: true, options: [opt('a'), opt('b'), opt('c')] },
    ]);
    assert.deepEqual(answers, { 'Pick many?': 'a' });
  });

  it('never picks the synthetic Other option (even when it is the only option)', () => {
    assert.equal(pickAutoAnswers([q([opt('Other')])]), null);
    assert.equal(pickAutoAnswers([q([opt('other')])]), null);
    assert.equal(pickAutoAnswers([q([opt('OTHER')])]), null);
  });

  it('skips Other when picking the first option', () => {
    const answers = pickAutoAnswers([q([opt('Other'), opt('Real choice')])]);
    assert.deepEqual(answers, { 'Which option?': 'Real choice' });
  });

  it('returns null when any question has no selectable option (all-or-nothing)', () => {
    const questions = [
      q([opt('fine')]),
      { question: 'Empty?', header: 'e', multiSelect: false, options: [] },
    ];
    assert.equal(pickAutoAnswers(questions), null);
  });

  it('returns null for empty / malformed questions arrays', () => {
    assert.equal(pickAutoAnswers([]), null);
    assert.equal(pickAutoAnswers(null), null);
    assert.equal(pickAutoAnswers(undefined), null);
    assert.equal(pickAutoAnswers('nope'), null);
    assert.equal(pickAutoAnswers([null]), null);
    assert.equal(pickAutoAnswers([42]), null);
  });

  it('returns null when a question lacks a non-empty question string', () => {
    assert.equal(pickAutoAnswers([{ question: '', options: [opt('x')] }]), null);
    assert.equal(pickAutoAnswers([{ options: [opt('x')] }]), null);
  });

  it('ignores options with missing / non-string / empty labels', () => {
    const questions = [q([{ description: 'no label' }, { label: '' }, { label: 7 }, opt('valid')])];
    assert.deepEqual(pickAutoAnswers(questions), { 'Which option?': 'valid' });
    assert.equal(pickAutoAnswers([q([{ label: '' }, { description: 'x' }])]), null);
  });
});
