// Tests for packages/app/server/lib/schedule-model.js — the six schedule kinds,
// cron mapping, next-base computation, catch-up occurrence enumeration, jitter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSchedule, scheduleToCron, nextBaseFor, occurrencesAtOrBefore, jitterForTaskId,
} from '../server/lib/schedule-model.js';

const NOW = new Date(2026, 9, 23, 12, 0, 0).getTime(); // Friday 2026-10-23 12:00 local

test('normalizeSchedule: hourly', () => {
  assert.deepEqual(normalizeSchedule({ kind: 'hourly', minute: 15 }, NOW), { ok: true, schedule: { kind: 'hourly', minute: 15 } });
  assert.equal(normalizeSchedule({ kind: 'hourly', minute: 60 }, NOW).ok, false);
  assert.equal(normalizeSchedule({ kind: 'hourly', minute: -1 }, NOW).ok, false);
});

test('normalizeSchedule: daily/weekdays time format', () => {
  assert.deepEqual(normalizeSchedule({ kind: 'daily', time: '09:30' }, NOW), { ok: true, schedule: { kind: 'daily', time: '09:30' } });
  assert.equal(normalizeSchedule({ kind: 'daily', time: '9:30' }, NOW).ok, true); // padded
  assert.equal(normalizeSchedule({ kind: 'daily', time: '24:00' }, NOW).ok, false);
  assert.equal(normalizeSchedule({ kind: 'weekdays', time: '09:00' }, NOW).ok, true);
});

test('normalizeSchedule: weekly day 1-7 (ISO)', () => {
  assert.equal(normalizeSchedule({ kind: 'weekly', day: 1, time: '09:00' }, NOW).ok, true);
  assert.equal(normalizeSchedule({ kind: 'weekly', day: 7, time: '09:00' }, NOW).ok, true);
  assert.equal(normalizeSchedule({ kind: 'weekly', day: 0, time: '09:00' }, NOW).ok, false);
  assert.equal(normalizeSchedule({ kind: 'weekly', day: 8, time: '09:00' }, NOW).ok, false);
});

test('normalizeSchedule: cron validity + 5-year solvability', () => {
  assert.equal(normalizeSchedule({ kind: 'cron', expr: '0 9 * * *' }, NOW).ok, true);
  assert.equal(normalizeSchedule({ kind: 'cron', expr: 'bad' }, NOW).ok, false);
  assert.equal(normalizeSchedule({ kind: 'cron', expr: '0 0 30 2 *' }, NOW).ok, false); // Feb 30
});

test('normalizeSchedule: once must be ≥60s in the future', () => {
  assert.equal(normalizeSchedule({ kind: 'once', at: NOW + 3600_000 }, NOW).ok, true);
  assert.equal(normalizeSchedule({ kind: 'once', at: NOW + 30_000 }, NOW).error, 'once_in_past');
  assert.equal(normalizeSchedule({ kind: 'once', at: NOW - 1000 }, NOW).error, 'once_in_past');
});

test('scheduleToCron: presets map to cron', () => {
  assert.equal(scheduleToCron({ kind: 'hourly', minute: 15 }), '15 * * * *');
  assert.equal(scheduleToCron({ kind: 'daily', time: '09:30' }), '30 9 * * *');
  assert.equal(scheduleToCron({ kind: 'weekdays', time: '09:30' }), '30 9 * * 1-5');
  assert.equal(scheduleToCron({ kind: 'weekly', day: 1, time: '09:30' }), '30 9 * * 1');
  assert.equal(scheduleToCron({ kind: 'weekly', day: 7, time: '09:30' }), '30 9 * * 0'); // ISO Sun → cron 0
  assert.equal(scheduleToCron({ kind: 'cron', expr: '*/5 * * * *' }), '*/5 * * * *');
  assert.equal(scheduleToCron({ kind: 'once', at: NOW }), null);
});

test('nextBaseFor: once fires only when still future', () => {
  assert.equal(nextBaseFor({ kind: 'once', at: NOW + 1000 }, NOW), NOW + 1000);
  assert.equal(nextBaseFor({ kind: 'once', at: NOW - 1000 }, NOW), null);
});

test('nextBaseFor: daily returns the next 09:30', () => {
  const n = nextBaseFor({ kind: 'daily', time: '09:30' }, NOW);
  const d = new Date(n);
  assert.ok(n > NOW);
  assert.equal(d.getHours(), 9);
  assert.equal(d.getMinutes(), 30);
});

test('occurrencesAtOrBefore: once inside the window', () => {
  const at = NOW - 1000;
  assert.deepEqual(occurrencesAtOrBefore({ kind: 'once', at }, NOW - 2000, NOW), { latest: at, count: 1 });
  assert.equal(occurrencesAtOrBefore({ kind: 'once', at: NOW + 1000 }, NOW - 2000, NOW), null);
});

test('occurrencesAtOrBefore: catch-up "latest" is the true most-recent fire (review P1-1)', () => {
  // Every-minute cron, fromMs 8 days ago: with the 7-day window the enumeration must
  // land on a fire within the last few minutes, NOT a truncation point 8 days ago.
  const from = NOW - 8 * 24 * 3600 * 1000;
  const occ = occurrencesAtOrBefore({ kind: 'cron', expr: '* * * * *' }, from, NOW);
  assert.ok(occ, 'there ARE fires in the window');
  assert.ok(occ.latest > NOW - 120000, `latest should be recent, got ${new Date(occ.latest)}`);
  assert.ok(occ.count > 0);
});

test('occurrencesAtOrBefore: entirely stale (nothing in 7 days) reports stale', () => {
  // A yearly-ish cron that last fired > 7 days ago relative to NOW.
  // `0 0 1 1 *` = Jan 1st 00:00; on 2026-10-23 the last fire was 2026-01-01 (>7d ago).
  const occ = occurrencesAtOrBefore({ kind: 'cron', expr: '0 0 1 1 *' }, NOW - 300 * 24 * 3600 * 1000, NOW);
  // latest exists (Jan 1) but is stale.
  assert.ok(occ === null || occ.stale === true || occ.latest < NOW - 7 * 24 * 3600 * 1000);
});

test('jitterForTaskId: deterministic and within range', () => {
  const a = jitterForTaskId('st_7f3a9c2d1e40');
  assert.equal(a, jitterForTaskId('st_7f3a9c2d1e40'));
  assert.ok(a >= 0 && a <= 120000);
  assert.notEqual(jitterForTaskId('st_a'), jitterForTaskId('st_b'));
});
