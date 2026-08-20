/**
 * Gap top-up for src/utils/formatters.js
 *
 * test/formatters.test.js covers formatPromptNavTime / formatHms / formatMonthDayTime
 * but never imports formatSize (L4-11) or formatTimestamp (L13-17). This file exercises
 * both, covering every unit-bump in formatSize and both desktop/mobile branches +
 * the short-circuit of formatTimestamp.
 *
 * Pure module, no browser globals — direct static import.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatSize, formatTimestamp } from '../src/utils/formatters.js';

describe('formatSize', () => {
  it('returns "0 B" for falsy byte counts (0, null, undefined, NaN)', () => {
    assert.equal(formatSize(0), '0 B');
    assert.equal(formatSize(null), '0 B');
    assert.equal(formatSize(undefined), '0 B');
    assert.equal(formatSize(NaN), '0 B');
  });

  it('formats bytes with no decimal (i === 0 branch)', () => {
    assert.equal(formatSize(1), '1 B');
    assert.equal(formatSize(512), '512 B');
    assert.equal(formatSize(1023), '1023 B');
  });

  it('formats kilobytes with one decimal', () => {
    assert.equal(formatSize(1024), '1.0 KB');
    assert.equal(formatSize(1536), '1.5 KB'); // 1.5 * 1024
  });

  it('formats megabytes', () => {
    assert.equal(formatSize(1024 * 1024), '1.0 MB');
    assert.equal(formatSize(5 * 1024 * 1024 + 512 * 1024), '5.5 MB');
  });

  it('caps at GB — the largest unit (loop stops at i === units.length-1)', () => {
    assert.equal(formatSize(1024 ** 3), '1.0 GB');
    // Beyond GB still reports in GB (no TB unit), so a terabyte is "1024.0 GB".
    assert.equal(formatSize(1024 ** 4), '1024.0 GB');
  });
});

describe('formatTimestamp', () => {
  // cc-viewer log ts format: YYYYMMDD_HHMMSS (positions 0-3 yyyy, 4-5 mm, 6-7 dd,
  // 9-10 HH, 11-12 MM, 13-14 SS — index 8 is the '_').
  const TS = '20260601_143005'; // 2026-06-01 14:30:05

  it('formats full desktop timestamp "YYYY-MM-DD HH:MM:SS"', () => {
    assert.equal(formatTimestamp(TS, false), '2026-06-01 14:30:05');
  });

  it('omits the year in mobile mode "MM-DD HH:MM:SS"', () => {
    assert.equal(formatTimestamp(TS, true), '06-01 14:30:05');
  });

  it('returns the raw input untouched when ts is missing or too short (< 15 chars)', () => {
    assert.equal(formatTimestamp(null), null);
    assert.equal(formatTimestamp(''), '');
    assert.equal(formatTimestamp('2026'), '2026');
    assert.equal(formatTimestamp('20260601_1430'), '20260601_1430'); // 13 chars
  });

  it('accepts trailing precision beyond the 15-char prefix', () => {
    assert.equal(formatTimestamp('20260601_143005_123', false), '2026-06-01 14:30:05');
  });
});
