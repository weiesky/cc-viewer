// CLIENT-SAFE: no node deps. Home: @ccv/core (ask-auto-answer.js) — consumed by packages/app
// (server auto-answer timers) and importable by apps/web. Do not add fs/process/node: imports.
// AskUserQuestion auto-answer ("managed answering") picker logic.
//
// When the hosting setting (approvalModal.askAutoAnswerMinutes) is enabled, the server
// answers a pending AskUserQuestion itself at a wall-clock deadline. This module decides
// WHICH option to pick, pure and locale-aware:
//   1. first option (array order) whose label contains a "Recommended" marker in any
//      supported UI language — Claude Code localizes the "(Recommended)" suffix;
//   2. otherwise the first selectable option.
// The synthetic "Other" option is never auto-picked.

// Lower-cased marker vocabulary covering the 18 supported locales
// (zh, en, zh-TW, ko, ja, de, es, fr, it, da, pl, ru, ar, no, pt-BR, th, tr, uk).
// Matching is a case-insensitive substring test, so surrounding decorations like
// "(推荐)", "（推荐）", "- Recommended" all match without extra normalization.
export const RECOMMENDED_MARKERS = Object.freeze([
  '推荐',          // zh
  '推薦',          // zh-TW
  'recommended',   // en
  '推奨',          // ja
  '추천',          // ko
  'empfohlen',     // de
  'recomendado',   // es + pt-BR
  'recommandé',    // fr
  'consigliato',   // it
  'anbefalet',     // da
  'anbefalt',      // no
  'zalecane',      // pl
  'рекомендуется', // ru
  'рекомендовано', // uk
  'موصى به',       // ar
  'แนะนำ',         // th
  'önerilen',      // tr
]);

// The form's synthetic free-text option — recognized case-insensitively, same as
// AskQuestionForm (/^other$/i). Never a valid auto-pick target.
const OTHER_LABEL_RE = /^other$/i;

// Negation prefixes that immediately precede a marker and turn it into a
// DIScouragement ("不推荐", "Not recommended", "Nicht empfohlen", …). A label whose
// only marker occurrence is negated must NOT be treated as recommended — otherwise
// the picker would auto-confirm the exact option the model advised against.
// Multi-language, lower-cased, matched against the lower-cased label.
const NEGATION_PREFIXES = Object.freeze([
  '不', '非', '未', '勿',           // zh / zh-TW
  'not ', 'no ', "isn't ", "aren't ", 'never ', // en
  'nicht ', 'kein ',                // de
  'não ',                           // pt-BR (es uses 'no ', shared with en above)
  'pas ',                           // fr
  'non ',                           // it
  'ikke ',                          // da + no
  'nie ',                           // pl
  'не ',                            // ru + uk
  '비', '추천하지',                  // ko
  '非推奨', '推奨しない',             // ja (非推奨 is itself a full negated form)
  'لا ',                            // ar
  'ไม่',                            // th
  'değil', 'önerilmez',             // tr
]);

/**
 * @param {unknown} label
 * @returns {boolean} true when the label contains a Recommended marker (any locale)
 *   that is NOT negated (e.g. "Not recommended" / "不推荐" are excluded).
 */
export function isRecommendedLabel(label) {
  if (typeof label !== 'string' || label.length === 0) return false;
  const hay = label.toLowerCase();
  for (const marker of RECOMMENDED_MARKERS) {
    let idx = hay.indexOf(marker);
    while (idx !== -1) {
      const before = hay.slice(0, idx);
      const negated = NEGATION_PREFIXES.some((neg) => before.endsWith(neg));
      if (!negated) return true;
      idx = hay.indexOf(marker, idx + 1);
    }
  }
  return false;
}

/**
 * A selectable option: an object with a non-empty string label that is not the
 * synthetic "Other" option.
 */
function _isSelectableOption(opt) {
  return !!opt
    && typeof opt === 'object'
    && typeof opt.label === 'string'
    && opt.label.length > 0
    && !OTHER_LABEL_RE.test(opt.label);
}

/**
 * Build the auto-answer payload for an AskUserQuestion questions array.
 *
 * All-or-nothing: the answers map must cover every question (the upstream tool
 * expects an answer per question), so if ANY question has no selectable option
 * the whole ask is left for a human and this returns null.
 *
 * @param {unknown} questions - array of { question, options, multiSelect? }
 * @returns {Object<string, string>|null} { [questionText]: label } or null
 */
export function pickAutoAnswers(questions) {
  if (!Array.isArray(questions) || questions.length === 0) return null;
  const answers = {};
  for (const q of questions) {
    if (!q || typeof q !== 'object') return null;
    const questionText = q.question;
    if (typeof questionText !== 'string' || questionText.length === 0) return null;
    const options = Array.isArray(q.options) ? q.options : [];
    const selectable = options.filter(_isSelectableOption);
    if (selectable.length === 0) return null;
    const recommended = selectable.find((opt) => isRecommendedLabel(opt.label));
    // First recommended match wins; without any marker the first option wins.
    // multiSelect degenerates to the single picked label (the client-side ", "
    // join of one label is just that label).
    answers[questionText] = (recommended || selectable[0]).label;
  }
  return answers;
}
