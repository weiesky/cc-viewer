/**
 * Pure geometry for the ChatView terminal/sidebar drag-resize with snap lines.
 * Extracted from ChatView's handleSplitMouseDown/handleSidebarMouseDown so the
 * math is unit-testable; the drag lifecycle (document listeners, body cursor)
 * lives in chat/controllers/splitDragController.js.
 *
 * Snap-line object shape is shared by both axes and consumed by
 * SnapLineOverlay: { cols, terminalPx, linePosition }. For the sidebar axis
 * cols/terminalPx/linePosition are all the same pixel width (legacy shape).
 */

// Terminal font is 13px Menlo/Monaco; a character cell is ~7.8px wide.
export const TERMINAL_CHAR_WIDTH = 7.8;
export const TERMINAL_SNAP_COLS = [60, 80, 100, 120];
export const SIDEBAR_SNAP_WIDTHS = [180, 240, 300, 360];
export const SNAP_THRESHOLD_PX = 60;
export const RESIZER_WIDTH_PX = 5;

/**
 * Snap lines for the terminal split, positioned so the terminal lands on a
 * standard column count. Lines outside the usable band (terminal wider than
 * 75% or narrower than 15% of the container) are dropped.
 */
export function computeTerminalSnapLines(containerWidth, {
  charWidth = TERMINAL_CHAR_WIDTH,
  cols = TERMINAL_SNAP_COLS,
  resizerWidth = RESIZER_WIDTH_PX,
} = {}) {
  if (!containerWidth || containerWidth <= 0) return [];
  return cols.map(c => {
    const terminalPx = c * charWidth;
    const totalTerminalWidth = terminalPx + resizerWidth;
    if (totalTerminalWidth > containerWidth * 0.75 || totalTerminalWidth < containerWidth * 0.15) return null;
    // Line position = container width - terminal pixel width - resizer width.
    return { cols: c, terminalPx, linePosition: containerWidth - terminalPx - resizerWidth };
  }).filter(snap => snap !== null);
}

/** Sidebar snap lines; widths at or beyond 40% of the container are dropped. */
export function computeSidebarSnapLines(containerWidth, widths = SIDEBAR_SNAP_WIDTHS) {
  if (!containerWidth || containerWidth <= 0) return [];
  return widths
    .filter(w => w < containerWidth * 0.4)
    .map(w => ({ cols: w, terminalPx: w, linePosition: w }));
}

/** Terminal width from a drag position: right-edge anchored, 200px..75% band. */
export function clampTerminalWidth(rectRight, clientX, containerWidth) {
  return Math.max(200, Math.min(containerWidth * 0.75, rectRight - clientX));
}

/** Sidebar width from a drag position: left-edge anchored, 160px..40% band. */
export function clampSidebarWidth(clientX, rectLeft, containerWidth) {
  return Math.max(160, Math.min(containerWidth * 0.4, clientX - rectLeft));
}

/**
 * Nearest snap line to `position` (already in the same coordinate space as
 * linePosition), or null when none is within the threshold.
 */
export function findActiveSnapLine(position, snapLines, threshold = SNAP_THRESHOLD_PX) {
  if (!snapLines || snapLines.length === 0) return null;
  let minDistance = Infinity;
  let closestSnap = null;
  for (const snap of snapLines) {
    const distance = Math.abs(position - snap.linePosition);
    if (distance < minDistance) {
      minDistance = distance;
      closestSnap = snap;
    }
  }
  return (closestSnap && minDistance < threshold) ? closestSnap : null;
}
