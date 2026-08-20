// Unit tests for src/utils/errorReport.js — the swallowed-catch reporting
// convention (pure module, no browser globals; imported statically).
import { describe, it, beforeEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { reportSwallowed, MAX_REPORTS_PER_TAG, _resetForTest } from '../src/utils/errorReport.js';

// Save→stub→restore discipline for console.warn (same pattern as the
// localStorage stubs in branch-utils-projectAlias.test.js).
let calls;
let savedWarn;
before(() => { savedWarn = console.warn; });
after(() => { console.warn = savedWarn; });
beforeEach(() => {
  calls = [];
  console.warn = (...args) => { calls.push(args); };
  _resetForTest();
});

describe('reportSwallowed', () => {
  it('warns with the [ccv:<tag>] prefix and the error object', () => {
    const err = new Error('boom');
    reportSwallowed('sse.load_chunk', err);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], ['[ccv:sse.load_chunk]', err]);
  });

  it('appends extra as a third arg only when defined', () => {
    const err = new Error('boom');
    reportSwallowed('ws.terminal-msg', err, { msgType: 'exit' });
    assert.deepEqual(calls[0], ['[ccv:ws.terminal-msg]', err, { msgType: 'exit' }]);
    reportSwallowed('ws.terminal-msg', err);
    assert.equal(calls[1].length, 2);
  });

  it('caps at MAX_REPORTS_PER_TAG, then emits exactly one suppression line, then goes silent', () => {
    const err = new Error('repeat');
    for (let i = 0; i < MAX_REPORTS_PER_TAG + 10; i++) reportSwallowed('sse.stream-progress', err);
    assert.equal(calls.length, MAX_REPORTS_PER_TAG + 1);
    for (let i = 0; i < MAX_REPORTS_PER_TAG; i++) {
      assert.deepEqual(calls[i], ['[ccv:sse.stream-progress]', err]);
    }
    assert.deepEqual(calls[MAX_REPORTS_PER_TAG], ['[ccv:sse.stream-progress] further occurrences suppressed']);
  });

  it('counts tags independently', () => {
    const err = new Error('x');
    for (let i = 0; i < MAX_REPORTS_PER_TAG + 5; i++) reportSwallowed('sse.a', err);
    reportSwallowed('sse.b', err);
    const bLines = calls.filter(c => String(c[0]).startsWith('[ccv:sse.b]'));
    assert.equal(bLines.length, 1, 'a exhausting its cap does not affect b');
  });

  it('_resetForTest clears the counters', () => {
    const err = new Error('x');
    for (let i = 0; i < MAX_REPORTS_PER_TAG + 5; i++) reportSwallowed('sse.a', err);
    _resetForTest();
    reportSwallowed('sse.a', err);
    assert.deepEqual(calls[calls.length - 1], ['[ccv:sse.a]', err]);
  });
});
