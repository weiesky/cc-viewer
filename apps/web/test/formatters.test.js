// Unit tests for src/utils/formatters.js — pure display formatters (no DOM / browser globals),
// so we import the real module directly.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatPromptNavTime, formatHms, formatMonthDayTime, contextSeverityColor } from '../src/utils/formatters.js';

describe('formatPromptNavTime', () => {
  it('formats a timestamp as "MM-DD HH:MM:SS" in local time', () => {
    // Build from LOCAL components, then round-trip through ISO so the test is timezone-agnostic:
    // the expected string is derived from the same Date getters the formatter uses.
    const d = new Date(2026, 4, 1, 8, 7, 6); // local: 2026-05-01 08:07:06
    const p = n => String(n).padStart(2, '0');
    const expected = `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    assert.equal(formatPromptNavTime(d.toISOString()), expected);
    assert.match(formatPromptNavTime(d.toISOString()), /^\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('zero-pads single-digit month/day/time fields', () => {
    const d = new Date(2026, 0, 3, 4, 5, 9); // 2026-01-03 04:05:09
    assert.match(formatPromptNavTime(d.toISOString()), /^01-03 04:05:09$/);
  });

  it('returns "" for missing or invalid input', () => {
    assert.equal(formatPromptNavTime(null), '');
    assert.equal(formatPromptNavTime(undefined), '');
    assert.equal(formatPromptNavTime(''), '');
    assert.equal(formatPromptNavTime('not-a-date'), '');
  });

  it('accepts any Date-parseable string, not only ISO-with-Z (parsed as local time)', () => {
    // No trailing 'Z' → JS Date treats it as local time, so fields map straight through.
    assert.match(formatPromptNavTime('2026-05-01T08:07:06'), /^05-01 08:07:06$/);
  });

  it('treats falsy numeric 0 as missing (returns "")', () => {
    // `if (!ts)` short-circuits before `new Date(0)`; 0 is "no timestamp", not the epoch.
    assert.equal(formatPromptNavTime(0), '');
  });
});

describe('formatHms / formatMonthDayTime (shared clock primitives)', () => {
  it('formatHms: zero-padded HH:MM:SS in local time', () => {
    assert.equal(formatHms(new Date(2026, 0, 3, 4, 5, 9)), '04:05:09');
    assert.equal(formatHms(new Date(2026, 4, 1, 23, 59, 0)), '23:59:00');
  });

  it('formatMonthDayTime: zero-padded MM-DD HH:MM:SS in local time', () => {
    assert.equal(formatMonthDayTime(new Date(2026, 0, 3, 4, 5, 9)), '01-03 04:05:09');
    assert.equal(formatMonthDayTime(new Date(2026, 11, 25, 8, 7, 6)), '12-25 08:07:06');
  });

  it('formatPromptNavTime composes formatMonthDayTime (pins the nav↔bubble format invariant)', () => {
    // The two formatters used to be hand-synced via comments; now both derive from formatMonthDayTime
    // (ChatMessage.formatTime full-mode also calls it), so this equality guarantees they can't diverge.
    const d = new Date(2026, 4, 1, 8, 7, 6);
    assert.equal(formatPromptNavTime(d.toISOString()), formatMonthDayTime(d));
  });
});

describe('contextSeverityColor', () => {
  it('maps percent to the shared severity CSS vars with 75/55 thresholds', () => {
    assert.equal(contextSeverityColor(0), 'var(--color-success)');
    assert.equal(contextSeverityColor(54), 'var(--color-success)');
    assert.equal(contextSeverityColor(55), 'var(--color-warning-light)');
    assert.equal(contextSeverityColor(74), 'var(--color-warning-light)');
    assert.equal(contextSeverityColor(75), 'var(--color-error-light)');
    assert.equal(contextSeverityColor(100), 'var(--color-error-light)');
  });

  it('pins the exact boundary semantics (>= not >) so header bar, mobile tag and popover agree', () => {
    // 77% was the drift repro: header bar (75/55) showed error while the popover (80/60) showed warning.
    assert.equal(contextSeverityColor(77), 'var(--color-error-light)');
  });
});
