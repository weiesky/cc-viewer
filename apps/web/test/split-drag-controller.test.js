// Lifecycle tests for src/components/chat/controllers/splitDragController.js —
// document listener add/teardown, body cursor/userSelect restore (on mouseup AND
// on dispose-mid-drag), and the mouseup persistence branches. The controller
// only touches `document` inside the drag lifecycle, so a stubbed global
// document suffices (fake-DOM pattern per scroll-highlight-controller.test.js).
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { SplitDragController, TERMINAL_WIDTH_STORAGE_KEY, SIDEBAR_WIDTH_STORAGE_KEY } from '../src/components/chat/controllers/splitDragController.js';

const savedDocument = globalThis.document;
after(() => {
  if (savedDocument === undefined) delete globalThis.document;
  else globalThis.document = savedDocument;
});

let doc;
beforeEach(() => {
  const listeners = new Map(); // type -> Set<fn>
  doc = {
    listeners,
    body: { style: { cursor: '', userSelect: '' } },
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener: (type, fn) => { listeners.get(type)?.delete(fn); },
    emit: (type, ev) => { for (const fn of [...(listeners.get(type) || [])]) fn(ev); },
    count: (type) => (listeners.get(type)?.size || 0),
  };
  globalThis.document = doc;
});

function makeHost({ rect = { left: 0, right: 1400, width: 1400 }, state = {} } = {}) {
  const host = {
    _state: { isDragging: false, snapLines: [], activeSnapLine: null, terminalWidth: 400, sidebarWidth: 240, needsInitialSnap: true, ...state },
    persisted: [],
    getState: () => host._state,
    setState: (update) => {
      const partial = typeof update === 'function' ? update(host._state) : update;
      host._state = { ...host._state, ...partial };
    },
    getSplitRect: () => rect,
    persistWidth: (key, px) => host.persisted.push([key, px]),
  };
  return host;
}

const downEvent = () => ({ preventDefault: () => {} });

describe('SplitDragController', () => {
  it('mousedown arms listeners + body styles; mouseup restores and tears down', () => {
    const host = makeHost();
    const ctl = new SplitDragController(host);
    ctl.onTerminalHandleDown(downEvent());
    assert.equal(ctl.dragTarget(), 'terminal');
    assert.equal(doc.count('mousemove'), 1);
    assert.equal(doc.count('mouseup'), 1);
    assert.equal(doc.body.style.cursor, 'col-resize');
    assert.equal(doc.body.style.userSelect, 'none');
    assert.equal(host._state.isDragging, true);
    assert.ok(host._state.snapLines.length > 0, 'terminal snap lines computed');

    doc.emit('mouseup');
    assert.equal(ctl.dragTarget(), null);
    assert.equal(doc.count('mousemove'), 0, 'listeners removed');
    assert.equal(doc.count('mouseup'), 0);
    assert.equal(doc.body.style.cursor, '', 'cursor restored');
    assert.equal(doc.body.style.userSelect, '');
    assert.equal(host._state.isDragging, false);
  });

  it('mousemove clamps the terminal width and detects the active snap line', () => {
    const host = makeHost();
    const ctl = new SplitDragController(host);
    ctl.onTerminalHandleDown(downEvent());
    // 60-col line sits at 1400-468-5=927; cursor at x=930 → width 470, snap active.
    doc.emit('mousemove', { clientX: 930 });
    assert.equal(host._state.terminalWidth, 470);
    assert.equal(host._state.activeSnapLine?.cols, 60);
    // Far from any line → no snap.
    doc.emit('mousemove', { clientX: 700 });
    assert.equal(host._state.activeSnapLine, null);
  });

  it('mouseup with an active snap line persists the snapped width; without, the dragged width', () => {
    const host = makeHost();
    const ctl = new SplitDragController(host);
    ctl.onTerminalHandleDown(downEvent());
    doc.emit('mousemove', { clientX: 930 }); // snap to 60 cols (468px)
    doc.emit('mouseup');
    assert.deepEqual(host.persisted.at(-1), [TERMINAL_WIDTH_STORAGE_KEY, 468]);
    assert.equal(host._state.terminalWidth, 468, 'snapped width applied');
    assert.equal(host._state.needsInitialSnap, false);

    ctl.onTerminalHandleDown(downEvent());
    doc.emit('mousemove', { clientX: 700 }); // free position → width 700
    doc.emit('mouseup');
    assert.deepEqual(host.persisted.at(-1), [TERMINAL_WIDTH_STORAGE_KEY, 700]);
  });

  it('sidebar drag clamps left-anchored and persists linePosition on snap', () => {
    const host = makeHost();
    const ctl = new SplitDragController(host);
    ctl.onSidebarHandleDown(downEvent());
    assert.equal(ctl.dragTarget(), 'sidebar');
    doc.emit('mousemove', { clientX: 250 }); // near the 240 line (dist 10 < 60)
    assert.equal(host._state.sidebarWidth, 250);
    assert.equal(host._state.activeSnapLine?.linePosition, 240);
    doc.emit('mouseup');
    assert.deepEqual(host.persisted.at(-1), [SIDEBAR_WIDTH_STORAGE_KEY, 240]);
    assert.equal(host._state.sidebarWidth, 240);
  });

  it('dispose mid-drag tears down listeners and restores the body cursor (unmount safety)', () => {
    const host = makeHost();
    const ctl = new SplitDragController(host);
    ctl.onTerminalHandleDown(downEvent());
    assert.equal(doc.body.style.cursor, 'col-resize');
    ctl.dispose();
    assert.equal(doc.count('mousemove'), 0);
    assert.equal(doc.count('mouseup'), 0);
    assert.equal(doc.body.style.cursor, '', 'no stranded col-resize after unmount mid-drag');
    assert.equal(ctl.dragTarget(), null);
    // Idempotent when idle.
    ctl.dispose();
  });

  it('mousemove after a missing rect is a no-op (ref gone mid-drag)', () => {
    const host = makeHost();
    host.getSplitRect = () => null;
    const ctl = new SplitDragController(host);
    ctl.onTerminalHandleDown(downEvent());
    assert.deepEqual(host._state.snapLines, [], 'no rect → no snap lines');
    doc.emit('mousemove', { clientX: 930 });
    assert.equal(host._state.terminalWidth, 400, 'width untouched');
    doc.emit('mouseup'); // still tears down cleanly
    assert.equal(doc.body.style.cursor, '');
  });
});
