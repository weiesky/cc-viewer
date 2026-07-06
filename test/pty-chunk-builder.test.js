import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ============================================================================
// Inline ptyChunkBuilder logic (src/utils/ptyChunkBuilder.js is ESM/Vite module)
// ============================================================================

const ARROW_DOWN = '\x1b[B';
const ARROW_UP = '\x1b[A';
const ARROW_RIGHT = '\x1b[C';
const SPACE = ' ';
const ENTER = '\r';

function buildArrows(currentIdx, targetIdx) {
  const chunks = [];
  const diff = targetIdx - currentIdx;
  const arrow = diff > 0 ? ARROW_DOWN : ARROW_UP;
  for (let i = 0; i < Math.abs(diff); i++) chunks.push(arrow);
  return chunks;
}

function getCursorIdx(prompt) {
  if (prompt && prompt.options) {
    const idx = prompt.options.findIndex(o => o.selected);
    return idx >= 0 ? idx : 0;
  }
  return 0;
}

function buildSingleSelectChunks(answer, prompt, isMultiQuestion = false) {
  const chunks = [];
  let currentIdx = getCursorIdx(prompt);
  let targetIdx = answer.optionIndex;
  if (prompt && prompt.options) {
    const targetNumber = answer.optionIndex + 1;
    const found = prompt.options.findIndex(o => o.number === targetNumber);
    if (found >= 0) targetIdx = found;
  }
  chunks.push(...buildArrows(currentIdx, targetIdx));
  chunks.push(ENTER);
  if (isMultiQuestion && answer.isLast) chunks.push(ENTER);
  return chunks;
}

function buildMultiSelectChunks(answer, prompt, isMultiQuestion = false) {
  const chunks = [];
  const indices = (answer.selectedIndices || []).slice().sort((a, b) => a - b);
  let currentIdx = getCursorIdx(prompt);
  for (const targetIdx of indices) {
    chunks.push(...buildArrows(currentIdx, targetIdx));
    chunks.push(SPACE);
    currentIdx = targetIdx;
  }
  chunks.push(ARROW_RIGHT);
  if (answer.isLast || !isMultiQuestion) chunks.push(ENTER);
  return chunks;
}

function buildOtherChunks(answer, prompt, isMultiQuestion = false) {
  const chunks = [];
  let currentIdx = getCursorIdx(prompt);
  const targetIdx = answer.optionIndex;
  chunks.push(...buildArrows(currentIdx, targetIdx));
  const text = answer.text || '';
  for (const ch of text) chunks.push(ch);
  chunks.push(ENTER);
  if (isMultiQuestion && answer.isLast) chunks.push(ENTER);
  return chunks;
}

function buildMultiSelectOtherChunks(answer, prompt, isMultiQuestion = false) {
  const chunks = [];
  let currentIdx = getCursorIdx(prompt);
  const targetIdx = answer.optionIndex;
  chunks.push(...buildArrows(currentIdx, targetIdx));
  const text = answer.text || '';
  for (const ch of text) chunks.push(ch);
  if (text.length > 0) {
    const chars = [...text];
    chunks.push(chars[chars.length - 1]); // sacrifice for ↑
  }
  chunks.push(ARROW_RIGHT); // no-op in text mode, provides settle delay
  chunks.push(ARROW_UP);    // exit text input, drops sacrifice char, cursor moves UP
  chunks.push(ARROW_RIGHT); // go to next tab (Submit tab or next question tab)
  if (answer.isLast || !isMultiQuestion) {
    chunks.push(ENTER);     // confirm Submit answers (only for last/single question)
  }
  return chunks;
}

function buildChunksForAnswer(answer, prompt, isMultiQuestion = false) {
  if (answer.type === 'multi') return buildMultiSelectChunks(answer, prompt, isMultiQuestion);
  if (answer.type === 'other' && answer.isMultiSelect) return buildMultiSelectOtherChunks(answer, prompt, isMultiQuestion);
  if (answer.type === 'other') return buildOtherChunks(answer, prompt, isMultiQuestion);
  return buildSingleSelectChunks(answer, prompt, isMultiQuestion);
}

// ============================================================================
// Helpers
// ============================================================================

function makePrompt(count, cursorAt = 0) {
  const options = [];
  for (let i = 0; i < count; i++) {
    options.push({ number: i + 1, label: `Option ${i + 1}`, selected: i === cursorAt });
  }
  return { options };
}

function describeChunks(chunks) {
  return chunks.map(c => {
    if (c === ARROW_DOWN) return '↓';
    if (c === ARROW_UP) return '↑';
    if (c === ARROW_RIGHT) return '→';
    if (c === SPACE) return 'Space';
    if (c === ENTER) return 'Enter';
    return c;
  }).join(' ');
}

// ============================================================================
// Tests
// ============================================================================

describe('ptyChunkBuilder', () => {

  // --------------------------------------------------------------------------
  // TC-1: 单题单选
  // --------------------------------------------------------------------------
  describe('single select — single question', () => {
    it('selects first option (no movement needed)', () => {
      const prompt = makePrompt(3, 0);
      const chunks = buildSingleSelectChunks({ optionIndex: 0 }, prompt);
      assert.deepEqual(chunks, [ENTER]);
    });

    it('selects second option (↓ Enter)', () => {
      const prompt = makePrompt(3, 0);
      const chunks = buildSingleSelectChunks({ optionIndex: 1 }, prompt);
      assert.deepEqual(chunks, [ARROW_DOWN, ENTER]);
    });

    it('selects last option from first', () => {
      const prompt = makePrompt(4, 0);
      const chunks = buildSingleSelectChunks({ optionIndex: 3 }, prompt);
      assert.deepEqual(chunks, [ARROW_DOWN, ARROW_DOWN, ARROW_DOWN, ENTER]);
    });

    it('navigates up when cursor is below target', () => {
      const prompt = makePrompt(4, 3);
      const chunks = buildSingleSelectChunks({ optionIndex: 0 }, prompt);
      assert.deepEqual(chunks, [ARROW_UP, ARROW_UP, ARROW_UP, ENTER]);
    });
  });

  // --------------------------------------------------------------------------
  // TC-2: 单题多选
  // --------------------------------------------------------------------------
  describe('multi select — single question', () => {
    it('selects A, C, D (skip B) — TC-2', () => {
      const prompt = makePrompt(4, 0);
      const answer = { type: 'multi', selectedIndices: [0, 2, 3], isLast: true };
      const chunks = buildMultiSelectChunks(answer, prompt, false);
      // Space(A) ↓↓ Space(C) ↓ Space(D) → Enter
      assert.deepEqual(chunks, [
        SPACE, ARROW_DOWN, ARROW_DOWN, SPACE, ARROW_DOWN, SPACE, ARROW_RIGHT, ENTER,
      ]);
    });

    it('selects only last option — TC-3', () => {
      const prompt = makePrompt(4, 0);
      const answer = { type: 'multi', selectedIndices: [3], isLast: true };
      const chunks = buildMultiSelectChunks(answer, prompt, false);
      assert.deepEqual(chunks, [
        ARROW_DOWN, ARROW_DOWN, ARROW_DOWN, SPACE, ARROW_RIGHT, ENTER,
      ]);
    });

    it('selects A and D (skip B, C) — TC-7 跳跃选择', () => {
      const prompt = makePrompt(4, 0);
      const answer = { type: 'multi', selectedIndices: [0, 3], isLast: true };
      const chunks = buildMultiSelectChunks(answer, prompt, false);
      assert.deepEqual(chunks, [
        SPACE, ARROW_DOWN, ARROW_DOWN, ARROW_DOWN, SPACE, ARROW_RIGHT, ENTER,
      ]);
    });

    it('sorts indices even if provided out of order', () => {
      const prompt = makePrompt(4, 0);
      const answer = { type: 'multi', selectedIndices: [3, 0, 2], isLast: true };
      const chunks = buildMultiSelectChunks(answer, prompt, false);
      // Should sort to [0, 2, 3]
      assert.deepEqual(chunks, [
        SPACE, ARROW_DOWN, ARROW_DOWN, SPACE, ARROW_DOWN, SPACE, ARROW_RIGHT, ENTER,
      ]);
    });
  });

  // --------------------------------------------------------------------------
  // TC-4: 连续两题多选
  // --------------------------------------------------------------------------
  describe('multi-question multi select — TC-4', () => {
    it('Q1 (not last): → without Enter', () => {
      const prompt = makePrompt(3, 0);
      const answer = { type: 'multi', selectedIndices: [0, 2], isLast: false };
      const chunks = buildMultiSelectChunks(answer, prompt, true);
      // Space(A) ↓↓ Space(C) → (no Enter — not last)
      assert.deepEqual(chunks, [
        SPACE, ARROW_DOWN, ARROW_DOWN, SPACE, ARROW_RIGHT,
      ]);
    });

    it('Q2 (last): → + Enter', () => {
      const prompt = makePrompt(3, 0);
      const answer = { type: 'multi', selectedIndices: [1, 2], isLast: true };
      const chunks = buildMultiSelectChunks(answer, prompt, true);
      // ↓ Space(B) ↓ Space(C) → Enter
      assert.deepEqual(chunks, [
        ARROW_DOWN, SPACE, ARROW_DOWN, SPACE, ARROW_RIGHT, ENTER,
      ]);
    });
  });

  // --------------------------------------------------------------------------
  // TC-5: 混合��型 — 单选 + 多选
  // --------------------------------------------------------------------------
  describe('mixed: single + multi — TC-5', () => {
    it('Q1 single select in multi-question form (not last)', () => {
      const prompt = makePrompt(3, 0);
      const answer = { type: 'single', optionIndex: 1, isLast: false };
      const chunks = buildSingleSelectChunks(answer, prompt, true);
      // ↓ Enter (single select auto-advances, no extra Enter)
      assert.deepEqual(chunks, [ARROW_DOWN, ENTER]);
    });

    it('Q2 multi select (last) in multi-question form', () => {
      const prompt = makePrompt(3, 0);
      const answer = { type: 'multi', selectedIndices: [1, 2], isLast: true };
      const chunks = buildMultiSelectChunks(answer, prompt, true);
      assert.deepEqual(chunks, [
        ARROW_DOWN, SPACE, ARROW_DOWN, SPACE, ARROW_RIGHT, ENTER,
      ]);
    });
  });

  // --------------------------------------------------------------------------
  // TC-6: 连续两题单选
  // --------------------------------------------------------------------------
  describe('multi-question single select — TC-6', () => {
    it('Q1 (not last): Enter only', () => {
      const prompt = makePrompt(3, 0);
      const answer = { type: 'single', optionIndex: 1, isLast: false };
      const chunks = buildSingleSelectChunks(answer, prompt, true);
      assert.deepEqual(chunks, [ARROW_DOWN, ENTER]);
    });

    it('Q2 (last): Enter + Enter (submit)', () => {
      const prompt = makePrompt(3, 0);
      const answer = { type: 'single', optionIndex: 2, isLast: true };
      const chunks = buildSingleSelectChunks(answer, prompt, true);
      assert.deepEqual(chunks, [ARROW_DOWN, ARROW_DOWN, ENTER, ENTER]);
    });
  });

  // --------------------------------------------------------------------------
  // TC-9: Other 选项
  // --------------------------------------------------------------------------
  describe('other option — TC-9', () => {
    it('navigates to Other, enters text, confirms', () => {
      const prompt = makePrompt(4, 0); // Other is index 3
      const answer = { type: 'other', optionIndex: 3, text: 'hello' };
      const chunks = buildOtherChunks(answer, prompt);
      assert.deepEqual(chunks, [
        ARROW_DOWN, ARROW_DOWN, ARROW_DOWN,
        'h', 'e', 'l', 'l', 'o',
        ENTER,
      ]);
    });

    it('empty text still sends Enter to confirm', () => {
      const prompt = makePrompt(3, 0);
      const answer = { type: 'other', optionIndex: 2, text: '' };
      const chunks = buildOtherChunks(answer, prompt);
      assert.deepEqual(chunks, [ARROW_DOWN, ARROW_DOWN, ENTER]);
    });
  });

  // --------------------------------------------------------------------------
  // TC-11: 单题多选 Other (Case 11)
  // --------------------------------------------------------------------------
  describe('multi-select Other — single question (Case 11)', () => {
    it('types text with 1 sacrifice char (↑ drops it), Review Enter confirms', () => {
      const prompt = makePrompt(3, 0); // Other at index 2
      const answer = { type: 'other', isMultiSelect: true, optionIndex: 2, text: '测试', isLast: true };
      const chunks = buildMultiSelectOtherChunks(answer, prompt);
      // ↓↓ navigate, '测','试','试'(sacrifice), →(no-op), ↑(drops sacrifice, cursor up), →(Submit tab), Enter
      assert.deepEqual(chunks, [
        ARROW_DOWN, ARROW_DOWN,
        '测', '试', '试',
        ARROW_RIGHT, ARROW_UP, ARROW_RIGHT, ENTER,
      ]);
    });

    it('single ASCII char: one sacrifice copy', () => {
      const prompt = makePrompt(2, 0);
      const answer = { type: 'other', isMultiSelect: true, optionIndex: 1, text: 'a', isLast: true };
      const chunks = buildMultiSelectOtherChunks(answer, prompt);
      assert.deepEqual(chunks, [
        ARROW_DOWN,
        'a', 'a',
        ARROW_RIGHT, ARROW_UP, ARROW_RIGHT, ENTER,
      ]);
    });

    it('multi-char ASCII text: last char duplicated once as sacrifice', () => {
      const prompt = makePrompt(3, 0);
      const answer = { type: 'other', isMultiSelect: true, optionIndex: 2, text: 'hello', isLast: true };
      const chunks = buildMultiSelectOtherChunks(answer, prompt);
      assert.deepEqual(chunks, [
        ARROW_DOWN, ARROW_DOWN,
        'h', 'e', 'l', 'l', 'o', 'o',
        ARROW_RIGHT, ARROW_UP, ARROW_RIGHT, ENTER,
      ]);
    });

    it('empty text: no sacrifice char', () => {
      const prompt = makePrompt(2, 0);
      const answer = { type: 'other', isMultiSelect: true, optionIndex: 1, text: '', isLast: true };
      const chunks = buildMultiSelectOtherChunks(answer, prompt);
      assert.deepEqual(chunks, [
        ARROW_DOWN,
        ARROW_RIGHT, ARROW_UP, ARROW_RIGHT, ENTER,
      ]);
    });
  });

  // --------------------------------------------------------------------------
  // TC-12: 多题混合含多选 Other (Case 12)
  // --------------------------------------------------------------------------
  describe('multi-question with multi-select Other (Case 12)', () => {
    it('Q1 single Other (not last): navigates, types, Enter (auto-advances)', () => {
      const prompt = makePrompt(3, 0);
      const answer = { type: 'other', isMultiSelect: false, optionIndex: 2, text: '测试', isLast: false };
      const chunks = buildOtherChunks(answer, prompt, true);
      assert.deepEqual(chunks, [
        ARROW_DOWN, ARROW_DOWN,
        '测', '试',
        ENTER,
        // no extra Enter — not last
      ]);
    });

    it('Q2 multi-select Other (not last): 1 sacrifice char, ↑ exit, → tab, NO Enter', () => {
      const prompt = makePrompt(3, 0);
      const answer = { type: 'other', isMultiSelect: true, optionIndex: 2, text: '测试', isLast: false };
      const chunks = buildMultiSelectOtherChunks(answer, prompt, true);
      // Not last question: no Enter at the end
      assert.deepEqual(chunks, [
        ARROW_DOWN, ARROW_DOWN,
        '测', '试', '试',
        ARROW_RIGHT, ARROW_UP, ARROW_RIGHT,
      ]);
    });

    it('Q3 single select (last): ↓↓ Enter Enter', () => {
      const prompt = makePrompt(3, 0);
      const answer = { type: 'single', optionIndex: 2, isLast: true };
      const chunks = buildSingleSelectChunks(answer, prompt, true);
      assert.deepEqual(chunks, [ARROW_DOWN, ARROW_DOWN, ENTER, ENTER]);
    });

    it('buildChunksForAnswer dispatches multi-select Other correctly', () => {
      const prompt = makePrompt(3, 0);
      const answer = { type: 'other', isMultiSelect: true, optionIndex: 2, text: 'abc', isLast: true };
      const chunks = buildChunksForAnswer(answer, prompt, false);
      assert.deepEqual(chunks, [
        ARROW_DOWN, ARROW_DOWN,
        'a', 'b', 'c', 'c',
        ARROW_RIGHT, ARROW_UP, ARROW_RIGHT, ENTER,
      ]);
    });
  });

  // --------------------------------------------------------------------------
  // buildChunksForAnswer dispatcher
  // --------------------------------------------------------------------------
  describe('buildChunksForAnswer', () => {
    it('dispatches single type', () => {
      const prompt = makePrompt(3, 0);
      const chunks = buildChunksForAnswer({ type: 'single', optionIndex: 1 }, prompt);
      assert.deepEqual(chunks, [ARROW_DOWN, ENTER]);
    });

    it('dispatches multi type', () => {
      const prompt = makePrompt(3, 0);
      const chunks = buildChunksForAnswer(
        { type: 'multi', selectedIndices: [0], isLast: true }, prompt,
      );
      assert.deepEqual(chunks, [SPACE, ARROW_RIGHT, ENTER]);
    });

    it('dispatches other type', () => {
      const prompt = makePrompt(2, 0);
      const chunks = buildChunksForAnswer(
        { type: 'other', optionIndex: 1, text: 'ab' }, prompt,
      );
      assert.deepEqual(chunks, [ARROW_DOWN, 'a', 'b', ENTER]);
    });
  });

  // --------------------------------------------------------------------------
  // Edge cases
  // --------------------------------------------------------------------------
  describe('edge cases', () => {
    it('no prompt (null) — cursor defaults to 0', () => {
      const chunks = buildSingleSelectChunks({ optionIndex: 2 }, null);
      assert.deepEqual(chunks, [ARROW_DOWN, ARROW_DOWN, ENTER]);
    });

    it('prompt with no selected option — cursor defaults to 0', () => {
      const prompt = { options: [{ number: 1 }, { number: 2 }] };
      const chunks = buildSingleSelectChunks({ optionIndex: 1 }, prompt);
      assert.deepEqual(chunks, [ARROW_DOWN, ENTER]);
    });

    it('multi select with empty selectedIndices', () => {
      const prompt = makePrompt(3, 0);
      const chunks = buildMultiSelectChunks(
        { selectedIndices: [], isLast: true }, prompt, false,
      );
      // No Space, just → Enter
      assert.deepEqual(chunks, [ARROW_RIGHT, ENTER]);
    });

    it('cursor already at target — no arrows', () => {
      const prompt = makePrompt(3, 2);
      const chunks = buildSingleSelectChunks({ optionIndex: 2 }, prompt);
      assert.deepEqual(chunks, [ENTER]);
    });
  });
});
