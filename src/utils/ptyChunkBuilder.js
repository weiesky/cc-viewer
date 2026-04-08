/**
 * PTY Chunk Builder — pure functions for building keystroke sequences.
 * Separates "what to send" from "how to send".
 *
 * Claude Code AskUserQuestion prompt model:
 * - Single question: options list, Enter selects and submits
 * - Multi question: tabbed form [Q1] [Q2] ... [Submit]
 *   - Single select: ↓↓...Enter (selects and auto-advances to next tab)
 *   - Multi select: ↓Space↓Space...→ (toggles then → to next tab)
 *   - Last tab → to Submit, Enter to confirm
 */

const ARROW_DOWN = '\x1b[B';
const ARROW_UP = '\x1b[A';
const ARROW_RIGHT = '\x1b[C';
const SPACE = ' ';
const ENTER = '\r';

/**
 * Build navigation arrows from currentIdx to targetIdx.
 */
function buildArrows(currentIdx, targetIdx) {
  const chunks = [];
  const diff = targetIdx - currentIdx;
  const arrow = diff > 0 ? ARROW_DOWN : ARROW_UP;
  for (let i = 0; i < Math.abs(diff); i++) {
    chunks.push(arrow);
  }
  return chunks;
}

/**
 * Get current cursor position from prompt.
 */
function getCursorIdx(prompt) {
  if (prompt && prompt.options) {
    const idx = prompt.options.findIndex(o => o.selected);
    return idx >= 0 ? idx : 0;
  }
  return 0;
}

/**
 * Build chunks for a single-select answer.
 * Navigate to target option, then Enter.
 * @param {object} answer - { optionIndex, isLast }
 * @param {object} prompt - ptyPrompt with options
 * @param {boolean} isMultiQuestion - whether this is part of a multi-question form
 */
export function buildSingleSelectChunks(answer, prompt, isMultiQuestion = false) {
  const chunks = [];
  let currentIdx = getCursorIdx(prompt);

  // For multi-question, map optionIndex to prompt option by number
  let targetIdx = answer.optionIndex;
  if (prompt && prompt.options) {
    const targetNumber = answer.optionIndex + 1;
    const found = prompt.options.findIndex(o => o.number === targetNumber);
    if (found >= 0) targetIdx = found;
  }

  chunks.push(...buildArrows(currentIdx, targetIdx));
  chunks.push(ENTER); // Select and confirm (auto-advances in multi-question)

  // Multi-question last question: Enter above advances to Review page,
  // need another Enter to confirm "Submit answers"
  if (isMultiQuestion && answer.isLast) {
    chunks.push(ENTER);
  }
  return chunks;
}

/**
 * Build chunks for a multi-select answer.
 * Navigate + Space for each selection, then → to advance tab.
 * @param {object} answer - { selectedIndices, isLast }
 * @param {object} prompt - ptyPrompt with options
 * @param {boolean} isMultiQuestion - whether this is part of a multi-question form
 */
export function buildMultiSelectChunks(answer, prompt, isMultiQuestion = false) {
  const chunks = [];
  const indices = (answer.selectedIndices || []).slice().sort((a, b) => a - b);
  let currentIdx = getCursorIdx(prompt);

  for (const targetIdx of indices) {
    chunks.push(...buildArrows(currentIdx, targetIdx));
    chunks.push(SPACE); // Toggle
    currentIdx = targetIdx;
  }

  // → to advance to next tab (or Submit tab if last)
  chunks.push(ARROW_RIGHT);

  // Last question in multi-question, or single question: Enter on Submit tab
  if (answer.isLast || !isMultiQuestion) {
    chunks.push(ENTER);
  }

  return chunks;
}

/**
 * Build chunks for a single-select "Other" (free text) answer.
 *
 * Single-question mode:
 *   Navigate to "Type something" → Enter (activate text input) → type text → Enter (confirm)
 *
 * Multi-question tabbed form:
 *   In tabbed forms, Enter on "Type something" auto-advances to the next tab
 *   (same as regular single-select). Text input is NOT inline — Claude Code
 *   prompts for it separately after the form is submitted.
 *   So we treat it like a regular single-select: navigate → Enter.
 *
 * @param {object} answer - { optionIndex, text, isLast }
 * @param {object} prompt - ptyPrompt with options
 * @param {boolean} isMultiQuestion - whether part of multi-question form
 */
export function buildOtherChunks(answer, prompt, isMultiQuestion = false) {
  const chunks = [];
  let currentIdx = getCursorIdx(prompt);
  const targetIdx = answer.optionIndex;

  chunks.push(...buildArrows(currentIdx, targetIdx));

  // "Type something" 选项：直接输入文字，不需要 Enter 激活
  // inquirer 在光标停在此选项时接受直接键入文字
  const text = answer.text || '';
  for (const ch of text) {
    chunks.push(ch);
  }
  chunks.push(ENTER); // Confirm text and submit

  // Multi-question last question: Enter above auto-advances to Submit tab,
  // need another Enter to confirm
  if (isMultiQuestion && answer.isLast) {
    chunks.push(ENTER);
  }
  return chunks;
}

/**
 * Build chunks for a multi-select "Other" (Type something) answer.
 * "Type something" is a text-input option in the checkbox list.
 * Sequence: navigate → type text + sacrifice_char → → (settle) → ↑ (exit, drops sacrifice_char) → → (next tab) → Enter (if last)
 * inquirer drops the last char on ↓/↑ exit; sacrifice char absorbs the loss.
 * Uses ↑ instead of ↓ to exit: "Type something" is the last option, so ↓ keeps cursor there
 * and → may re-enter text mode. ↑ moves to a non-text option, making → reliably navigate tabs.
 * @param {object} answer - { optionIndex, text, isLast }
 * @param {object} prompt - ptyPrompt with options
 * @param {boolean} isMultiQuestion - whether part of multi-question form
 */
export function buildMultiSelectOtherChunks(answer, prompt, isMultiQuestion = false) {
  const chunks = [];
  let currentIdx = getCursorIdx(prompt);
  const targetIdx = answer.optionIndex;

  chunks.push(...buildArrows(currentIdx, targetIdx));

  // Type text directly into the "Type something" field
  // Typing auto-checks the checkbox — no Space/Enter needed
  const text = answer.text || '';
  for (const ch of text) {
    chunks.push(ch);
  }

  // Sacrifice char: ↑/↓ drops exactly one character when exiting text input mode.
  // Append ONE duplicate of the last char so the exit key drops the sacrifice, not the real text.
  if (text.length > 0) {
    const chars = [...text]; // handle multi-byte (e.g. CJK) correctly
    chunks.push(chars[chars.length - 1]); // sacrifice for ↑
  }

  // → in text input mode: no-op (cursor already at end), provides settleMs delay
  chunks.push(ARROW_RIGHT);
  // ↑ exits text input mode — drops one char (the sacrifice above), real text preserved.
  // Use ↑ instead of ↓: "Type something" is typically the last option, so ↓ may leave
  // cursor on the same item (no option below). ↑ moves to the previous *non-text* option,
  // ensuring the subsequent → is interpreted as tab navigation, not text cursor movement.
  chunks.push(ARROW_UP);
  // → goes to next tab (Submit tab for last/single question, next question tab otherwise)
  chunks.push(ARROW_RIGHT);

  // Enter on Submit/Review page to confirm — only for last question or single-question form
  if (answer.isLast || !isMultiQuestion) {
    chunks.push(ENTER);
  }

  return chunks;
}

/**
 * Build chunks for a single answer (dispatches by type).
 * @param {object} answer - { type, optionIndex, selectedIndices, text, isLast, isMultiSelect }
 * @param {object} prompt - ptyPrompt with options
 * @param {boolean} isMultiQuestion - whether part of multi-question form
 */
export function buildChunksForAnswer(answer, prompt, isMultiQuestion = false) {
  if (answer.type === 'multi') {
    return buildMultiSelectChunks(answer, prompt, isMultiQuestion);
  }
  if (answer.type === 'other' && answer.isMultiSelect) {
    return buildMultiSelectOtherChunks(answer, prompt, isMultiQuestion);
  }
  if (answer.type === 'other') {
    return buildOtherChunks(answer, prompt, isMultiQuestion);
  }
  return buildSingleSelectChunks(answer, prompt, isMultiQuestion);
}
