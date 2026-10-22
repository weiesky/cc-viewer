import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportSwallowed, MAX_REPORTS_PER_TAG, _resetForTest } from '../server/lib/error-report.js';

// The server wrapper gates every [ccv:*] console.warn on CCV_DEBUG. These
// tests pin the gate behavior (silent by default, passes through when the
// env is set) and confirm core's per-tag cap is still enforced when enabled.

function captureWarn() {
  const calls = [];
  const orig = console.warn;
  console.warn = (...args) => calls.push(args);
  return {
    calls,
    restore() { console.warn = orig; },
  };
}

test('server error-report: silent by default (no CCV_DEBUG)', () => {
  delete process.env.CCV_DEBUG;
  _resetForTest();
  const { calls, restore } = captureWarn();
  try {
    reportSwallowed('test.silent', new Error('boom'));
    reportSwallowed('test.silent', new Error('boom'));
    assert.equal(calls.length, 0);
  } finally {
    restore();
    _resetForTest();
  }
});

test('server error-report: passes through when CCV_DEBUG=1, still capped', () => {
  process.env.CCV_DEBUG = '1';
  _resetForTest();
  const { calls, restore } = captureWarn();
  try {
    // Exceed the cap by 2 — expect MAX reports + 1 suppression notice.
    for (let i = 0; i < MAX_REPORTS_PER_TAG + 2; i++) {
      reportSwallowed('test.loud', new Error(`boom ${i}`));
    }
    assert.equal(calls.length, MAX_REPORTS_PER_TAG + 1);
    // First MAX are the actual reports, last is the suppression notice.
    const lastMsg = String(calls[calls.length - 1][0]);
    assert.match(lastMsg, /\[ccv:test\.loud\] further occurrences suppressed/);
  } finally {
    restore();
    delete process.env.CCV_DEBUG;
    _resetForTest();
  }
});

test('server error-report: extra arg forwarded when enabled', () => {
  process.env.CCV_DEBUG = '1';
  _resetForTest();
  const { calls, restore } = captureWarn();
  try {
    const err = new Error('boom');
    reportSwallowed('test.extra', err, { key: 'value' });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0][2], { key: 'value' });
  } finally {
    restore();
    delete process.env.CCV_DEBUG;
    _resetForTest();
  }
});
