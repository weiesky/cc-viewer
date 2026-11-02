// mobileTermLayout — pure-function tests for the fixed-column layout math and the
// apply path (fontSize write + deferred resize + onResized wiring).
// The layout measures the xterm parent container (no window chrome constants), so
// tests mock the terminal's cell dims and the container size.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeMobileFixedLayout, applyMobileFixedLayout } from '../src/utils/mobileTermLayout.js';

// Minimal terminal stub: options.fontSize + the _core renderer cell dimensions.
// Cell dims scale with fontSize like the real renderer (7px/15px at 13), but cell
// HEIGHT is quantized with Math.ceil — real renderers snap to whole pixels, so the
// deferred re-measure can disagree with the pre-write estimate; the apply path must
// use the re-measured rows (pinned by a test below).
function makeTerm({ fontSize = 13, cellWidth = 7, cellHeight = 15 } = {}) {
  const baseFontSize = 13;
  const baseCell = { width: cellWidth, height: cellHeight };
  const term = {
    options: { fontSize },
    resized: null,
    resize(cols, rows) { this.resized = [cols, rows]; },
  };
  Object.defineProperty(term, '_core', {
    get() {
      const scale = term.options.fontSize / baseFontSize;
      return { _renderService: { dimensions: { css: { cell: { width: baseCell.width * scale, height: Math.ceil(baseCell.height * scale) } } } } };
    },
  });
  return term;
}

function makeContainer(w, h) {
  return { clientWidth: w, clientHeight: h };
}

// Run the deferred rAF synchronously.
function flushRaf() {
  const cbs = globalThis.__rafQueue || [];
  globalThis.__rafQueue = [];
  for (const cb of cbs) cb();
}

function installRafStub() {
  globalThis.__rafQueue = [];
  globalThis.requestAnimationFrame = (cb) => { globalThis.__rafQueue.push(cb); return globalThis.__rafQueue.length; };
}

describe('computeMobileFixedLayout', () => {
  it('scales fontSize so `cols` exactly fill the container width', () => {
    // 60 cols * 7px = 420px at fontSize 13; container 210px → halve to 6.5.
    const term = makeTerm({ fontSize: 13, cellWidth: 7 });
    const layout = computeMobileFixedLayout(term, makeContainer(210, 600));
    assert.equal(layout.fontSize, 6.5);
    assert.equal(layout.cols, 60);
  });

  it('derives rows from the container height and the scaled line height', () => {
    // Font 13→6.5, line height 15→7.5 (compute uses unquantized math); 600/7.5 → 80 rows.
    const term = makeTerm({ fontSize: 13, cellHeight: 15 });
    const layout = computeMobileFixedLayout(term, makeContainer(210, 600));
    assert.equal(layout.rows, 80);
  });

  it('clamps rows to [5, 100]', () => {
    const term = makeTerm();
    // Too-short container → at least 5 rows.
    assert.equal(computeMobileFixedLayout(term, makeContainer(210, 10)).rows, 5);
    // Too-tall container → at most 100 rows.
    assert.equal(computeMobileFixedLayout(term, makeContainer(210, 100000)).rows, 100);
  });

  it('respects a custom cols target', () => {
    const term = makeTerm({ fontSize: 13, cellWidth: 7 });
    // 80 cols * 7px = 560px; container 280px → fontSize 6.5.
    const layout = computeMobileFixedLayout(term, makeContainer(280, 600), { cols: 80 });
    assert.equal(layout.fontSize, 6.5);
    assert.equal(layout.cols, 80);
  });

  it('returns null when the container is hidden / zero-sized (inactive tab)', () => {
    const term = makeTerm();
    assert.equal(computeMobileFixedLayout(term, makeContainer(0, 600)), null);
    assert.equal(computeMobileFixedLayout(term, makeContainer(210, 0)), null);
    assert.equal(computeMobileFixedLayout(term, null), null);
  });

  it('returns null when the renderer has not measured cells yet', () => {
    const noDims = { options: { fontSize: 13 }, _core: { _renderService: { dimensions: { css: {} } } } };
    assert.equal(computeMobileFixedLayout(noDims, makeContainer(210, 600)), null);
    assert.equal(computeMobileFixedLayout(null, makeContainer(210, 600)), null);
  });

  it('returns null on degenerate inputs instead of producing NaN/Infinity', () => {
    const zero = makeTerm({ fontSize: 0 });
    assert.equal(computeMobileFixedLayout(zero, makeContainer(210, 600)), null);
    const undef = { options: {}, _core: { _renderService: { dimensions: { css: { cell: { width: 7, height: 15 } } } } } };
    assert.equal(computeMobileFixedLayout(undef, makeContainer(210, 600)), null);
    assert.equal(computeMobileFixedLayout(makeTerm(), makeContainer(NaN, 600)), null);
    assert.equal(computeMobileFixedLayout(makeTerm(), makeContainer(210, 600), { cols: 0 }), null);
  });
});

describe('applyMobileFixedLayout', () => {
  it('writes fontSize immediately, resizes on the next frame, then fires onResized', () => {
    installRafStub();
    const term = makeTerm({ fontSize: 13, cellWidth: 7, cellHeight: 15 });
    let resizedArgs = null;
    const ok = applyMobileFixedLayout(term, makeContainer(210, 600), {
      isAlive: () => true,
      onResized: (cols, rows) => { resizedArgs = [cols, rows]; },
    });
    assert.equal(ok, true);
    assert.equal(term.options.fontSize, 6.5); // immediate
    assert.equal(term.resized, null); // deferred
    flushRaf();
    assert.deepEqual(term.resized, [60, 75]); // re-measured at ceil(15*0.5)=8px rows
    assert.deepEqual(resizedArgs, [60, 75]);
  });

  it('uses the re-measured rows after the font write (quantized line height)', () => {
    installRafStub();
    // ceil(15 * 6.5/13) = ceil(7.5) = 8 — the deferred re-measure sees 8px rows, so
    // rows = floor(600/8) = 75, NOT the pre-write estimate floor(600/7.5) = 80.
    const term = makeTerm({ fontSize: 13, cellWidth: 7, cellHeight: 15 });
    let resizedArgs = null;
    applyMobileFixedLayout(term, makeContainer(210, 600), {
      isAlive: () => true,
      onResized: (cols, rows) => { resizedArgs = [cols, rows]; },
    });
    flushRaf();
    assert.deepEqual(term.resized, [60, 75], 'rows must come from the re-measured cell height');
    assert.deepEqual(resizedArgs, [60, 75]);
  });

  it('skips the deferred resize when isAlive flips false (unmounted before the frame)', () => {
    installRafStub();
    const term = makeTerm();
    let alive = true;
    applyMobileFixedLayout(term, makeContainer(210, 600), { isAlive: () => alive });
    alive = false;
    flushRaf();
    assert.equal(term.resized, null);
  });

  it('returns false and schedules nothing when the container is not measurable', () => {
    installRafStub();
    const term = makeTerm();
    const ok = applyMobileFixedLayout(term, makeContainer(0, 0), { isAlive: () => true });
    assert.equal(ok, false);
    assert.equal(term.options.fontSize, 13); // untouched
    flushRaf();
    assert.equal(term.resized, null);
  });
});
