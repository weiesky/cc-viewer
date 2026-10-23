// Tests for packages/app/server/lib/cron.js — parse / match / nextCronRun.
// DST cases run in a child process with TZ pinned (node:test single-process TZ
// mutation is unreliable; the host CI runs UTC which has no DST at all).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseCron, cronMatches, nextCronRun } from '../server/lib/cron.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CRON = join(HERE, '..', 'server', 'lib', 'cron.js');

test('parseCron: accepts valid 5-field forms', () => {
  for (const e of ['* * * * *', '0 9 * * *', '*/15 9-18 * * 1-5', '0 0 1 * 1', '30 4 1,15 * 0', '7 7 7 7 7']) {
    assert.equal(parseCron(e).ok, true, e);
  }
});

test('parseCron: rejects malformed expressions', () => {
  for (const e of ['', '* * * *', '* * * * * *', '61 * * * *', '* 24 * * *', '0 9 * * MON', '0 9 * *', 'a b c d e', '*/0 * * * *', '5-1 * * * *']) {
    assert.equal(parseCron(e).ok, false, e);
  }
});

test('parseCron: DOW 7 normalizes to Sunday(0)', () => {
  const p = parseCron('0 9 * * 7');
  assert.equal(p.ok, true);
  assert.equal(p.fields[4].values.has(0), true);
  assert.equal(p.fields[4].values.has(7), false);
});

test('cronMatches: minute/hour/dom/month', () => {
  // 2026-10-23 is a Friday.
  const at0900 = new Date(2026, 9, 23, 9, 0, 0);
  assert.equal(cronMatches('0 9 * * *', at0900), true);
  assert.equal(cronMatches('0 10 * * *', at0900), false);
  assert.equal(cronMatches('0 9 23 * *', at0900), true);
  assert.equal(cronMatches('0 9 24 * *', at0900), false);
  assert.equal(cronMatches('0 9 * 10 *', at0900), true);
  assert.equal(cronMatches('0 9 * 11 *', at0900), false);
});

test('cronMatches: vixie DOM/DOW OR semantics', () => {
  // `0 0 1 * 5`: dom=1 OR dow=Friday. 2026-10-23 is a Friday but not the 1st.
  const friday = new Date(2026, 9, 23, 0, 0, 0);
  assert.equal(cronMatches('0 0 1 * 5', friday), true, 'dow hit alone');
  // The 1st of Oct 2026 is a Thursday: dom hit alone.
  const first = new Date(2026, 9, 1, 0, 0, 0);
  assert.equal(cronMatches('0 0 1 * 5', first), true, 'dom hit alone');
  // Neither: 2026-10-24 (Saturday, not 1st).
  const neither = new Date(2026, 9, 24, 0, 0, 0);
  assert.equal(cronMatches('0 0 1 * 5', neither), false);
  // Only dom restricted: `0 0 2 * *` → must be the 2nd regardless of weekday.
  assert.equal(cronMatches('0 0 2 * *', new Date(2026, 9, 2, 0, 0, 0)), true);
  assert.equal(cronMatches('0 0 2 * *', new Date(2026, 9, 3, 0, 0, 0)), false);
});

test('nextCronRun: strictly greater than after, minute granularity', () => {
  const base = new Date(2026, 9, 23, 8, 30, 30, 500).getTime(); // 08:30:30.500
  const n = nextCronRun('0 9 * * *', base);
  assert.ok(n > base);
  assert.equal(n % 60000, 0);
  assert.equal(new Date(n).getHours(), 9);
  assert.equal(new Date(n).getMinutes(), 0);
});

test('nextCronRun: every-minute expression lands on the next minute', () => {
  const base = new Date(2026, 9, 23, 8, 30, 30, 500).getTime();
  const n = nextCronRun('* * * * *', base);
  assert.equal(n, Math.floor(base / 60000) * 60000 + 60000);
});

test('nextCronRun: weekday gate (Mon-Fri) skips the weekend', () => {
  // Friday 2026-10-23 18:00 → next weekday 09:00 is Monday 2026-10-26.
  const fri = new Date(2026, 9, 23, 18, 0, 0).getTime();
  const n = nextCronRun('0 9 * * 1-5', fri);
  const d = new Date(n);
  assert.equal(d.getDay(), 1); // Monday
  assert.equal(d.getDate(), 26);
});

test('nextCronRun: strictly-greater when after == a fire time (no stuck-in-place)', () => {
  const fire = new Date(2026, 9, 24, 9, 0, 0, 0).getTime();
  const n = nextCronRun('0 9 * * *', fire);
  assert.ok(n > fire, 'must move forward, not return the same minute');
  assert.equal(new Date(n).getDate(), 25);
});

test('nextCronRun: no solution within 5 years → null', () => {
  // Feb 30 never exists.
  assert.equal(nextCronRun('0 0 30 2 *', Date.now()), null);
});

test('nextCronRun: DST spring-forward skips the missing wall time', () => {
  const script = `import { nextCronRun } from ${JSON.stringify(CRON)};
    const before = new Date(2026, 2, 7, 12, 0, 0).getTime();
    const n = nextCronRun('30 2 * * *', before);
    const d = new Date(n);
    // 2026-03-08 02:30 does not exist in America/New_York → must NOT land there.
    if (d.getMonth() === 2 && d.getDate() === 8 && d.getHours() === 2) { console.error('rolled onto missing time'); process.exit(1); }
    if (!(n > before)) { console.error('not strictly after'); process.exit(1); }
    console.log('ok:' + d.toString());`;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf-8',
  });
  assert.match(out, /^ok:/);
});

test('nextCronRun: DST fall-back fires once, not twice', () => {
  const script = `import { nextCronRun } from ${JSON.stringify(CRON)};
    // 2026-11-01 01:30 happens twice in America/New_York. After the first
    // occurrence, the next must be the FOLLOWING day, not the second 01:30.
    const first = new Date(2026, 10, 1, 1, 30, 0).getTime();
    const n = nextCronRun('30 1 * * *', first);
    const d = new Date(n);
    if (!(n > first)) { console.error('not strictly after'); process.exit(1); }
    if (d.getDate() === 1) { console.error('double-fired the repeated hour'); process.exit(1); }
    console.log('ok:' + d.toString());`;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf-8',
  });
  assert.match(out, /^ok:/);
});
