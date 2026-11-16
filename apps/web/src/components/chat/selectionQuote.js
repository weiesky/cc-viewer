// Selection → "add to chat" helpers for ChatView.
//
// The assistant bubble root carries a build-stable `data-ccv-role="assistant"` attribute
// (added in ChatMessage.renderHighlightBubble) because CSS-module class names are hashed at
// build time and cannot be matched with `closest('.bubbleAssistant')`. Selection anchor/focus
// are usually Text nodes, which have no `.closest`, so they are normalized to their parent
// element before matching.
//
// A selection is quotable when both endpoints share the same assistant bubble AND the same
// quotable region: `.chat-md` for markdown prose/thinking, or a `[data-ccv-quotable]` element —
// Edit/Write diff code lines (DiffView.codeWrap), tool-card KV params (ChatMessage kvContainer),
// or the AskUserQuestion card's question+options (AskQuestionForm). The bubble-scope check alone
// is not enough — tool cards render outside `.chat-md`.

// Normalize a Selection/Range node (often a Text node) to an Element for `.closest`.
export function toElement(node) {
  if (!node) return null;
  if (node.nodeType === 3) return node.parentElement;
  // Only Elements expose `.closest`; guard against Document/comment/fragment endpoints.
  return node.nodeType === 1 ? node : null;
}

const ASSISTANT_SEL = '[data-ccv-role="assistant"]';
const MD_SEL = '.chat-md';
const QUOTABLE_SEL = '[data-ccv-quotable]';

// The closest `sel` ancestor shared by BOTH endpoints, or null when they don't share one.
function sharedClosest(startEl, endEl, sel) {
  const a = startEl.closest(sel);
  const b = endEl.closest(sel);
  return a && a === b ? a : null;
}

// True when a non-collapsed single-range selection's endpoints share the SAME assistant
// bubble AND the SAME `.chat-md` markdown body. Stricter than
// selectionInSingleAssistantQuoteRegion: [data-ccv-quotable] (diff/KV/ask) regions are
// rejected because they are not a lossless HTML→Markdown source.
export function selectionInSingleAssistantMarkdown(selection) {
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return false;
  const range = selection.getRangeAt(0);
  const startEl = toElement(range.startContainer);
  const endEl = toElement(range.endContainer);
  if (!startEl || !endEl) return false;
  const startBubble = startEl.closest(ASSISTANT_SEL);
  const endBubble = endEl.closest(ASSISTANT_SEL);
  if (!startBubble || !endBubble || startBubble !== endBubble) return false;
  return !!sharedClosest(startEl, endEl, MD_SEL);
}

// True when every selection endpoint sits inside the SAME assistant bubble AND the SAME
// quotable region (a `.chat-md` markdown body, or a `[data-ccv-quotable]` region: Edit/Write
// diff code, tool-card KV params, or the AskUserQuestion card). User bubbles, cross-message,
// and cross-region (markdown↔diff↔KV↔ask, or two different diff cards) selections are rejected.
// The `[data-ccv-quotable]` attribute is presence-only — its value is just a debug label.
export function selectionInSingleAssistantQuoteRegion(selection) {
  // rangeCount > 1 (e.g. a Firefox Ctrl+drag multi-range) is rejected: only range[0] is checked
  // here, but toString() would concatenate every range, so a second out-of-region range would
  // otherwise leak into the quote.
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return false;
  const range = selection.getRangeAt(0);
  const startEl = toElement(range.startContainer);
  const endEl = toElement(range.endContainer);
  if (!startEl || !endEl) return false;
  const startBubble = startEl.closest(ASSISTANT_SEL);
  const endBubble = endEl.closest(ASSISTANT_SEL);
  if (!startBubble || !endBubble || startBubble !== endBubble) return false;
  return !!(sharedClosest(startEl, endEl, MD_SEL) || sharedClosest(startEl, endEl, QUOTABLE_SEL));
}

// Viewport-fixed position for the floating button: horizontally centered over the selection,
// placed just above its top edge (clamped into the viewport, flipping below when near the top).
// The button is rendered with translate(-50%, …), so clamp `left` with a half-width margin and
// clamp the "below" branch so neither edge can push it off-screen.
const BTN_HALF_W = 80; // approx half the floating button width (label is short)
const BTN_H = 34;      // approx button height, for the below-branch bottom clamp
export function selectionPopupPosition(selection) {
  if (!selection || selection.rangeCount === 0) return null;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) return null;
  const left = Math.max(8 + BTN_HALF_W, Math.min(window.innerWidth - 8 - BTN_HALF_W, rect.left + rect.width / 2));
  // Button is translated -100% vertically (rendered above `top`); fall below the selection
  // when there is not enough room above.
  const above = rect.top - 8;
  const showAbove = above > BTN_H + 8;
  const top = showAbove ? above : Math.min(rect.bottom + 8, window.innerHeight - BTN_H - 8);
  return { left, top, above: showAbove };
}

// Build the markdown blockquote prefix for outgoing text. Each selected quote becomes a
// `> `-prefixed block; blocks are joined with a bare `>` divider line and the whole prefix is
// blank-line separated from the user's message. Returns '' when there are no quotes.
// (The slash-command skip lives in the caller, which never invokes this for `/…` text.)
export function buildQuotePrefix(quotes) {
  if (!quotes || quotes.length === 0) return '';
  const blocks = quotes
    .map(q => (q && q.text ? String(q.text) : ''))
    .map(text => text.trim())
    .filter(Boolean)
    .map(text => text.split('\n').map(line => `> ${line}`).join('\n'));
  if (blocks.length === 0) return '';
  return blocks.join('\n>\n') + '\n\n';
}

// True when the (trimmed) composer text is a slash command. A quote prefix must never precede
// a slash command — prefixing would break CLI/SDK command recognition (incl. /clear).
export function isSlashCommandText(userText) {
  return /^\s*\//.test(userText || '');
}

// True when the current selection is a real (non-collapsed) text selection. Clickable rows that
// become text-selectable (e.g. AskUserQuestion option rows) use this to skip their click-toggle
// while the user is actually drag-selecting text, so selecting an option's label does not also
// toggle that option.
export function hasActiveTextSelection() {
  if (typeof window === 'undefined' || !window.getSelection) return false;
  const sel = window.getSelection();
  return !!(sel && !sel.isCollapsed && sel.rangeCount > 0 && sel.toString().trim().length > 0);
}

// Cap a single quote's size so selecting an entire long answer cannot produce a multi-MB
// bracketed paste / oversized optimistic bubble. Truncates on a line boundary when one is
// comfortably past the 60% mark; otherwise hard-cuts. Appends an ellipsis marker.
export const MAX_QUOTE_LEN = 4000;
export function truncateQuote(text, maxLen = MAX_QUOTE_LEN) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  if (trimmed.length <= maxLen) return trimmed;
  const cut = trimmed.slice(0, maxLen);
  const lastNl = cut.lastIndexOf('\n');
  const base = (lastNl > maxLen * 0.6 ? cut.slice(0, lastNl) : cut).trimEnd();
  return base + ' …';
}
