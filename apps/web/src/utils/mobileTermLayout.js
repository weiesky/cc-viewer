// ============================================================================
// Mobile fixed-column layout, shared by TerminalPanel and ScratchTerminal.
// History: the old implementation approximated the available area as
// window.innerWidth/innerHeight minus hardcoded chrome constants (top bar, keybar,
// padding); the constants drifted between the main panel and the scratch panel,
// and the window formula cannot see the iOS soft keyboard (the root is pinned to
// visualViewport.height, so innerHeight never changes). Measuring the xterm parent
// container directly excludes tab rail / keybar / borders by construction and
// tracks soft-keyboard shrinkage for free.
// ============================================================================

import { reportSwallowed } from './errorReport.js';

/**
 * Compute the fontSize/cols/rows that make `cols` columns exactly fill the
 * container width.
 * @param {object} terminal xterm instance (reads _core._renderService.dimensions.css.cell)
 * @param {Element|null} container xterm's actual parent element (clientWidth/clientHeight)
 * @param {{ cols?: number }} [opts]
 * @returns {{ fontSize: number, cols: number, rows: number } | null}
 *   null when the container cannot be measured right now (hidden / zero-sized /
 *   renderer not ready); the caller decides whether to retry or skip.
 */
export function computeMobileFixedLayout(terminal, container, { cols = 60 } = {}) {
  if (!terminal || !container) return null;
  if (!(container.clientWidth > 0) || !(container.clientHeight > 0)) return null; // also rejects NaN
  if (!(cols > 0)) return null;

  const cellDims = terminal._core?._renderService?.dimensions?.css?.cell;
  if (!cellDims || !cellDims.width || !cellDims.height) return null;

  const availableWidth = container.clientWidth;
  const availableHeight = container.clientHeight;

  // Scale the font so `cols` columns fill the width exactly.
  const currentFontSize = terminal.options.fontSize;
  if (!(currentFontSize > 0)) return null; // 0/undefined/NaN would yield NaN/Infinity below
  const currentCharWidth = cellDims.width;
  const fontSize = Math.floor(currentFontSize * availableWidth / (cols * currentCharWidth) * 10) / 10;

  // Rows come from the container height at the scaled line height (clamp 5-100,
  // same bounds as the original implementation).
  const lineHeight = cellDims.height * (fontSize / currentFontSize);
  const rows = Math.max(5, Math.min(Math.floor(availableHeight / lineHeight), 100));

  return { fontSize, cols, rows };
}

/**
 * Apply the fixed-column layout to xterm: set fontSize first (triggers a renderer
 * relayout), then re-measure on the next frame and resize.
 * Returns false when the container is not measurable (caller may retry/skip).
 *
 * `isAlive` guards the deferred frame: xterm's dispose() never nulls `_core`, and
 * reading `dimensions` on a disposed renderer throws. Callers pass
 * `() => this.terminal === terminal` (components null their field on unmount).
 */
export function applyMobileFixedLayout(terminal, container, { cols = 60, isAlive, onResized } = {}) {
  const layout = computeMobileFixedLayout(terminal, container, { cols });
  if (!layout) return false;

  terminal.options.fontSize = layout.fontSize;

  // Recompute rows once the renderer has picked up the new font size.
  requestAnimationFrame(() => {
    if (isAlive && !isAlive()) return; // unmounted before the frame landed
    const relayout = computeMobileFixedLayout(terminal, container, { cols });
    const rows = relayout ? relayout.rows : layout.rows;
    try {
      terminal.resize(cols, rows);
    } catch (err) {
      reportSwallowed('term.mobile-fixed-layout.resize', err);
      return;
    }
    try {
      onResized?.(cols, rows);
    } catch (err) {
      // onResized performs the ws resize send — diagnostic-relevant, never silent.
      reportSwallowed('term.mobile-fixed-layout.onResized', err);
    }
  });
  return true;
}
