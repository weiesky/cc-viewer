// attachMobileTouchScroll — unit tests with a fake .xterm-screen EventTarget,
// stubbed rAF, and a controllable performance.now(). Covers: move → scrollLines,
// rAF batching, stop() cancelling momentum, touchcancel flushing without momentum,
// multi-touch sample reset, and the no-screen null case.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { attachMobileTouchScroll } from '../src/utils/mobileTouchScroll.js';

// Minimal DOM stand-ins (node has none): an EventTarget-ish element record.
function makeScreen() {
  const listeners = {};
  return {
    listeners,
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    emit(type, event) { for (const fn of listeners[type] || []) fn(event); },
  };
}

function makeContainer(screen) {
  return { querySelector: (sel) => (sel === '.xterm-screen' ? screen : null) };
}

function makeTerm() {
  return {
    scrolled: [],
    scrollLines(n) { this.scrolled.push(n); },
    _core: { _renderService: { dimensions: { css: { cell: { height: 10 } } } } },
  };
}

function touch(y) {
  return { touches: [{ clientY: y }] };
}

// 120Hz touch dispatch: one move per 8.33ms frame (iPhone ProMotion cadence) so
// per-move dt > 0 and each sample lands in a distinct 100ms bucket.

// Controllable clock: velocity math depends on performance.now() deltas.
let nowMs = 0;
function advance(ms) { nowMs += ms; }

function installStubs() {
  globalThis.__rafQueue = [];
  globalThis.requestAnimationFrame = (cb) => { globalThis.__rafQueue.push(cb); return globalThis.__rafQueue.length; };
  globalThis.cancelAnimationFrame = (id) => { globalThis.__rafQueue[id - 1] = null; };
}

function flushRaf(times = 1) {
  for (let i = 0; i < times; i++) {
    const cbs = globalThis.__rafQueue.filter(Boolean);
    globalThis.__rafQueue = [];
    for (const cb of cbs) cb();
  }
}

describe('attachMobileTouchScroll', () => {
  let realNow;
  beforeEach(() => {
    installStubs();
    nowMs = 0;
    realNow = performance.now;
    performance.now = () => nowMs;
  });
  afterEach(() => { performance.now = realNow; });

  it('returns null when the container has no .xterm-screen', () => {
    assert.equal(attachMobileTouchScroll(makeTerm(), makeContainer(null)), null);
    assert.equal(attachMobileTouchScroll(makeTerm(), null), null);
  });

  it('touchmove scrolls by whole lines via rAF batching (pixel accumulator)', () => {
    const screen = makeScreen();
    const term = makeTerm();
    attachMobileTouchScroll(term, makeContainer(screen));

    screen.emit('touchstart', touch(100));
    // drag up 25px over 20ms → 2.5 lines at 10px/line → 2 lines, 5px remain accumulated
    advance(20);
    screen.emit('touchmove', touch(75));
    flushRaf();
    assert.deepEqual(term.scrolled, [2]);
    // 10px more → 5+10=15px accum → 1 more line
    advance(20);
    screen.emit('touchmove', touch(65));
    flushRaf();
    assert.deepEqual(term.scrolled, [2, 1]);
  });

  it('touchend flushes the remainder and starts momentum on a fast flick', () => {
    const screen = makeScreen();
    const term = makeTerm();
    attachMobileTouchScroll(term, makeContainer(screen));

    screen.emit('touchstart', touch(200));
    // fast flick: 5 moves of 8px each, 8ms apart → tail velocity ~0.96px/ms ≈ 15px/frame,
    // far above the 0.5 px/frame momentum threshold
    for (let i = 1; i <= 5; i++) {
      advance(8);
      screen.emit('touchmove', touch(200 - 8 * i));
    }
    flushRaf(); // flushScroll: 40px → 4 lines at 10px/line
    assert.deepEqual(term.scrolled, [4]);

    screen.emit('touchend', { touches: [] });
    for (let i = 0; i < 60; i++) flushRaf();
    assert.ok(term.scrolled.length > 1, 'momentum must keep scrolling after release');
  });

  it('stop() cancels in-flight momentum', () => {
    const screen = makeScreen();
    const term = makeTerm();
    const stop = attachMobileTouchScroll(term, makeContainer(screen));

    screen.emit('touchstart', touch(200));
    for (let i = 1; i <= 5; i++) {
      advance(8);
      screen.emit('touchmove', touch(200 - 8 * i));
    }
    flushRaf();
    screen.emit('touchend', { touches: [] });
    const countAtStop = term.scrolled.length;
    stop();
    flushRaf(30);
    assert.equal(term.scrolled.length, countAtStop, 'no scrolling after stop()');
  });

  it('touchcancel flushes pending scroll but produces no momentum', () => {
    const screen = makeScreen();
    const term = makeTerm();
    attachMobileTouchScroll(term, makeContainer(screen));

    screen.emit('touchstart', touch(200));
    advance(10);
    screen.emit('touchmove', touch(160));
    // cancel BEFORE the rAF flush: pending dy must still be flushed by the cancel
    screen.emit('touchcancel', { touches: [] });
    assert.deepEqual(term.scrolled, [4], 'cancel flushes the pending delta');
    flushRaf(30);
    assert.equal(term.scrolled.length, 1, 'no momentum after a cancel');
  });

  it('multi-touch start clears velocity samples (no stale momentum)', () => {
    const screen = makeScreen();
    const term = makeTerm();
    attachMobileTouchScroll(term, makeContainer(screen));

    screen.emit('touchstart', touch(200));
    advance(10);
    screen.emit('touchmove', touch(160)); // fast streak accumulates samples
    flushRaf();
    // second finger lands → samples must reset; lifting ends with no momentum
    screen.emit('touchstart', { touches: [{ clientY: 160 }, { clientY: 170 }] });
    screen.emit('touchend', { touches: [] });
    const n = term.scrolled.length;
    flushRaf(30);
    assert.equal(term.scrolled.length, n, 'no momentum from the pre-multitouch streak');
  });

  it('multi-touch → single-finger transition does not jump the viewport (review P2-8)', () => {
    const screen = makeScreen();
    const term = makeTerm();
    attachMobileTouchScroll(term, makeContainer(screen));

    // single-finger drag starts at y=200
    screen.emit('touchstart', touch(200));
    advance(10);
    screen.emit('touchmove', touch(190));
    flushRaf();
    assert.deepEqual(term.scrolled, [1]); // 10px → 1 line at 10px/line
    term.scrolled.length = 0;

    // second finger lands far away and moves — anchor must track touches[0],
    // not stay frozen at y=190 from the single-finger streak.
    screen.emit('touchstart', { touches: [{ clientY: 50 }, { clientY: 300 }] });
    advance(10);
    screen.emit('touchmove', { touches: [{ clientY: 45 }, { clientY: 300 }] }); // multi-touch move
    flushRaf();
    assert.deepEqual(term.scrolled, [], 'multi-touch produces no scroll');

    // second finger lifts → back to single finger at y≈45. The next move must
    // compute dy against the refreshed anchor (~45), NOT the stale 190 — a
    // frozen anchor would yield dy≈190-40=150px ≈ 15 lines (a huge jump).
    advance(10);
    screen.emit('touchmove', touch(40)); // single finger resumes near the anchor
    flushRaf();
    // dy = 45-40 = 5px → 0 lines (below one line). Anything ≥1 line means the
    // anchor was stale and the viewport jumped.
    assert.deepEqual(term.scrolled, [], 'no jump on multi→single transition');
  });
});
