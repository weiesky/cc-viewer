/**
 * Unit tests for apps/web/src/utils/scheduleDescription.js — schedule descriptions,
 * status derivation, timezone-correct formatting, reason/error label mapping.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeSchedule, deriveTaskUiStatus, formatNextRun, runStatusLabel, reasonLabel, errorLabel,
} from '../src/utils/scheduleDescription.js';
import { setLang } from '../src/i18n.js';

// Pin the app language so locale-dependent labels are stable across dev machines
// (the i18n module auto-detects navigator.language on import — review: frontend P3-14).
before(() => setLang('en'));

describe('describeSchedule', () => {
  it('describes each kind', () => {
    assert.match(describeSchedule({ kind: 'hourly', minute: 15 }), /15/);
    assert.match(describeSchedule({ kind: 'daily', time: '09:30' }), /09:30/);
    assert.match(describeSchedule({ kind: 'weekdays', time: '09:30' }), /09:30/);
    assert.match(describeSchedule({ kind: 'weekly', day: 1, time: '09:30' }), /09:30/);
    assert.match(describeSchedule({ kind: 'cron', expr: '*/5 * * * *' }), /\*\/5/);
    assert.ok(typeof describeSchedule({ kind: 'once', at: Date.now() }) === 'string');
  });

  it('falls back to previewInvalid on bad input (P3-6, never throws)', () => {
    assert.equal(describeSchedule(null), 'Invalid schedule');
    assert.equal(describeSchedule({ kind: 'nope' }), 'Invalid schedule');
    assert.equal(describeSchedule(undefined), 'Invalid schedule');
  });
});

describe('deriveTaskUiStatus', () => {
  it('prioritizes running > completed > error > paused > active', () => {
    assert.equal(deriveTaskUiStatus({ running: true }), 'running');
    assert.equal(deriveTaskUiStatus({ completedAt: 123 }), 'completed');
    assert.equal(deriveTaskUiStatus({ lastResult: 'error' }), 'error');
    assert.equal(deriveTaskUiStatus({ lastResult: 'failed' }), 'error');
    assert.equal(deriveTaskUiStatus({ enabled: false }), 'paused');
    assert.equal(deriveTaskUiStatus({ enabled: true }), 'active');
    assert.equal(deriveTaskUiStatus({}), 'active');
  });
});

describe('formatNextRun', () => {
  it('renders null as the none label', () => {
    assert.equal(formatNextRun(null), 'None');
    assert.equal(formatNextRun(undefined), 'None');
  });
  it('formats in the SERVER timezone, not the browser (P1-5)', () => {
    // 2026-10-24 00:30 in Asia/Shanghai. Rendered in an 8h-behind timezone it would
    // shift to the previous day; with the server tz pinned it must stay 00:30.
    const ms = new Date('2026-10-24T00:30:00+08:00').getTime();
    const shanghai = formatNextRun(ms, 'Asia/Shanghai');
    assert.match(shanghai, /00:30|12:30/);
  });
});

describe('reasonLabel / errorLabel', () => {
  it('maps server reason codes to localized text (no raw key leak)', () => {
    assert.equal(reasonLabel('no_live_session'), 'No live session for the target');
    assert.equal(reasonLabel('turn-error'), 'Run error');
    assert.equal(reasonLabel('queue_rejected'), 'Session queue is full');
    // Unknown codes fall back to internal, never the raw code.
    assert.equal(reasonLabel('bogus_xyz'), 'Internal error');
    assert.equal(reasonLabel(''), '');
  });
  it('maps API error codes to localized text', () => {
    assert.equal(errorLabel('task_limit'), 'Task limit reached (50 per project)');
    assert.equal(errorLabel('once_in_past'), 'A one-time task must be scheduled in the future');
  });
});

describe('runStatusLabel', () => {
  it('maps run statuses', () => {
    assert.equal(runStatusLabel('dispatched'), 'Dispatched');
    assert.equal(runStatusLabel('completed'), 'Completed');
    assert.equal(runStatusLabel('missed'), 'Missed');
  });
});
