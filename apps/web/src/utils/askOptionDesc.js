import { isPlaceholderAskId } from './askPortalMatcher.js';

// AskUserQuestion options[].description is schema-optional; centralize fallback
// so AskQuestionForm and ChatMessage recap stay aligned.

export function optionAriaLabel(opt) {
  if (!opt || opt.label == null) return '';
  return opt.description
    ? `${opt.label}: ${opt.description}`
    : String(opt.label);
}

export function hasOptionDescription(opt) {
  return Boolean(opt && opt.description);
}

// Pick the questions the interactive AskUserQuestion card actually renders.
//
// The modal body is filled by the inline tool_use block (reconstructed from the log
// stream) portaling into the modal's askSlot — it does not read pendingAsk.questions
// (the authoritative copy broadcast over WS ask-hook-pending / sdk-ask-pending, fully
// parsed server-side before the hook fires) directly. During streaming of a large
// payload there is a window where the modal is already open but the reconstructed
// block's input is still partial JSON. Crucially, partial-JSON parsing materializes
// the outer questions[] array shape before the element content arrives, so the
// streamed copy can be HOLLOW AT EQUAL LENGTH (e.g. two question objects with empty
// text/options while big options[].preview strings are still streaming — the
// 2026-07-04 blank-popup regression; a strictly-longer length heuristic missed it).
//
// So: for the currently pending ask (toolId === lastPendingAskId, id-matched), always
// prefer the authoritative copy. It is complete by construction, and the submit path
// (handleAskQuestionSubmit in askFlowController) maps answer indices through the same
// authoritative _askHookQuestions copy — rendering it keeps rendered indices aligned
// with the mapping array. Historical blocks never match lastPendingAskId and always
// keep their own streamed questions (history view unchanged).
//
// Legacy/no-id servers use placeholder pendingAsk ids ('__ask__', 'ask_<ts>_<rnd>')
// that can never equal the real tool_use id. There the authoritative copy is only
// borrowed when the streamed render would otherwise be completely empty — it can fill
// a blank popup but never override visible content (a stale legacy pendingAsk must
// not inject a previous ask's questions over a rendered one).
export function resolveAskQuestions(streamedQuestions, toolId, lastPendingAskId, pendingAsk) {
  const streamed = Array.isArray(streamedQuestions) ? streamedQuestions : [];
  if (!pendingAsk || toolId == null || toolId !== lastPendingAskId) {
    return streamed;
  }
  const idMatches = pendingAsk.id === toolId;
  if (!idMatches && !(isPlaceholderAskId(pendingAsk.id) && streamed.length === 0)) {
    return streamed;
  }
  const authoritative = Array.isArray(pendingAsk.questions) ? pendingAsk.questions : [];
  if (authoritative.length === 0) return streamed; // defensive: WS handlers guarantee non-empty
  if (streamed.length > authoritative.length) return streamed; // never shrink (belt-and-braces)
  return authoritative;
}
