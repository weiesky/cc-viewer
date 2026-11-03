// ============================================================================
// Phone touch scrolling for xterm, shared by TerminalPanel and ScratchTerminal.
// xterm's viewport sits below the screen layer, so native touch cannot scroll.
// Uses the official terminal.scrollLines() API to stay in sync with xterm's
// internal state; rAF batching + inertia for smoothness.
// Ref: https://github.com/xtermjs/xterm.js/issues/594
// ============================================================================

import { reportSwallowed } from './errorReport.js';

/**
 * Attach touch scrolling to the `.xterm-screen` element under `container`.
 * @param {object} terminal xterm instance
 * @param {Element|null} container element that contains .xterm-screen
 * @returns {(() => void) | null} stop() cancels any in-flight momentum/scroll
 *   animation — call it on unmount (scrollLines on a disposed terminal throws).
 *   null when the screen element is not found.
 */
export function attachMobileTouchScroll(terminal, container) {
  const screen = container?.querySelector('.xterm-screen');
  if (!screen) return null;

  const term = terminal;
  // Line height converts pixel deltas into row counts.
  const getLineHeight = () => {
    const cellDims = term._core?._renderService?.dimensions?.css?.cell;
    return cellDims?.height || 15;
  };

  let lastY = 0;
  let lastTime = 0;
  let momentumRaf = null;
  // Sub-line pixel accumulator: fractional parts survive between frames.
  let pixelAccum = 0;
  let pendingDy = 0;
  let scrollRaf = null;
  let velocitySamples = [];

  const stopMomentum = () => {
    if (momentumRaf) {
      cancelAnimationFrame(momentumRaf);
      momentumRaf = null;
    }
    if (scrollRaf) {
      cancelAnimationFrame(scrollRaf);
      scrollRaf = null;
    }
    pendingDy = 0;
    pixelAccum = 0;
  };

  // scrollLines throws after the terminal is disposed (its DOM lives on briefly);
  // report instead of letting an uncaught rAF error escape.
  const scrollLines = (lines) => {
    try {
      term.scrollLines(lines);
    } catch (err) {
      reportSwallowed('term.mobile-touch-scroll.scrollLines', err);
    }
  };

  const flushScroll = () => {
    scrollRaf = null;
    if (pendingDy === 0) return;
    pixelAccum += pendingDy;
    pendingDy = 0;
    const lh = getLineHeight();
    const lines = Math.trunc(pixelAccum / lh);
    if (lines !== 0) {
      scrollLines(lines);
      pixelAccum -= lines * lh;
    }
  };

  screen.addEventListener('touchstart', (e) => {
    stopMomentum();
    // Reset samples even for multi-touch — a 2nd finger mid-gesture must not let
    // touchend compute momentum from the previous single-finger streak.
    velocitySamples = [];
    // Always re-seed the anchor, even for multi-touch (review P2-8): otherwise a
    // 2nd-finger land/lift leaves lastY frozen, and the next single-finger
    // touchmove computes dy against a stale anchor → a large viewport jump.
    if (e.touches.length > 0) {
      lastY = e.touches[0].clientY;
      lastTime = performance.now();
    }
  }, { passive: true });

  screen.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 1) {
      // Keep the anchor fresh on multi-touch (review P2-8) so the transition
      // back to a single finger never computes dy from a frozen lastY.
      if (e.touches.length > 0) {
        lastY = e.touches[0].clientY;
        lastTime = performance.now();
      }
      return;
    }
    const y = e.touches[0].clientY;
    const now = performance.now();
    const dt = now - lastTime;
    const dy = lastY - y; // positive = scroll up

    if (dt > 0) {
      const v = dy / dt * 16;
      velocitySamples.push({ v, t: now });
      // keep only the last 100ms of samples
      while (velocitySamples.length > 0 && now - velocitySamples[0].t > 100) {
        velocitySamples.shift();
      }
    }

    pendingDy += dy;
    if (!scrollRaf) {
      scrollRaf = requestAnimationFrame(flushScroll);
    }

    lastY = y;
    lastTime = now;
  }, { passive: true });

  const flushRemainder = () => {
    if (scrollRaf) {
      cancelAnimationFrame(scrollRaf);
      scrollRaf = null;
    }
    if (pendingDy !== 0) {
      pixelAccum += pendingDy;
      pendingDy = 0;
      const lh = getLineHeight();
      const lines = Math.trunc(pixelAccum / lh);
      if (lines !== 0) scrollLines(lines);
      pixelAccum = 0;
    }
  };

  // Interrupted gesture (system gesture / call): flush pending scroll but no momentum.
  screen.addEventListener('touchcancel', () => {
    flushRemainder();
    velocitySamples = [];
  }, { passive: true });

  screen.addEventListener('touchend', () => {
    flushRemainder();

    // tail velocity via weighted average (pixels/frame)
    let velocity = 0;
    if (velocitySamples.length >= 2) {
      let totalWeight = 0;
      let weightedV = 0;
      const latest = velocitySamples[velocitySamples.length - 1].t;
      for (const s of velocitySamples) {
        const w = Math.max(0, 1 - (latest - s.t) / 100);
        weightedV += s.v * w;
        totalWeight += w;
      }
      velocity = totalWeight > 0 ? weightedV / totalWeight : 0;
    }
    velocitySamples = [];

    // inertial scroll (still pixel-accumulated for precision)
    if (Math.abs(velocity) < 0.5) return;
    const friction = 0.95;
    let mAccum = 0;
    const tick = () => {
      if (Math.abs(velocity) < 0.3) {
        // round the final sub-line residue
        const lh = getLineHeight();
        const rest = Math.round(mAccum / lh);
        if (rest !== 0) scrollLines(rest);
        momentumRaf = null;
        return;
      }
      mAccum += velocity;
      const lh = getLineHeight();
      const lines = Math.trunc(mAccum / lh);
      if (lines !== 0) {
        scrollLines(lines);
        mAccum -= lines * lh;
      }
      velocity *= friction;
      momentumRaf = requestAnimationFrame(tick);
    };
    momentumRaf = requestAnimationFrame(tick);
  }, { passive: true });

  return stopMomentum;
}
