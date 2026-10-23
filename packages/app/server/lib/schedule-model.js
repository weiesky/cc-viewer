// Structured schedule model for cc-viewer scheduled tasks.
//
// The six schedule kinds the UI offers are normalized here and mapped to cron where
// applicable, so the cron engine (./cron.js) stays the single source of truth for
// "when is the next fire". Storage keeps the structured `schedule` (not the cron
// string) so the UI can round-trip the form and render a localized description.
//
//   { kind:'hourly',  minute: 0-59 }
//   { kind:'daily',   time: 'HH:MM' }
//   { kind:'weekdays',time: 'HH:MM' }            → Monday..Friday
//   { kind:'weekly',  day: 1-7 (ISO, 1=Mon..7=Sun), time: 'HH:MM' }
//   { kind:'cron',    expr: '5-field cron' }
//   { kind:'once',    at: epochMs }
//
// Boundary: L1-lib. Imports only ./cron.js (L1) + node builtins.

import { parseCron, nextCronRun } from './cron.js';

const KINDS = new Set(['hourly', 'daily', 'weekdays', 'weekly', 'cron', 'once']);
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function _err(code, detail) { return { ok: false, error: code, detail }; }

/** Validate + normalize a schedule input. Returns { ok:true, schedule } | { ok:false, error, detail }. */
export function normalizeSchedule(input, now = Date.now()) {
  if (!input || typeof input !== 'object') return _err('invalid_schedule', 'not an object');
  const kind = input.kind;
  if (!KINDS.has(kind)) return _err('invalid_schedule', `unknown kind ${kind}`);

  if (kind === 'hourly') {
    const minute = Number(input.minute);
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) return _err('invalid_schedule', 'minute must be 0-59');
    return { ok: true, schedule: { kind, minute } };
  }

  if (kind === 'daily' || kind === 'weekdays') {
    const m = TIME_RE.exec(String(input.time || ''));
    if (!m) return _err('invalid_schedule', 'time must be HH:MM');
    return { ok: true, schedule: { kind, time: `${m[1].padStart(2, '0')}:${m[2]}` } };
  }

  if (kind === 'weekly') {
    const day = Number(input.day);
    if (!Number.isInteger(day) || day < 1 || day > 7) return _err('invalid_schedule', 'day must be 1-7 (ISO)');
    const m = TIME_RE.exec(String(input.time || ''));
    if (!m) return _err('invalid_schedule', 'time must be HH:MM');
    return { ok: true, schedule: { kind, day, time: `${m[1].padStart(2, '0')}:${m[2]}` } };
  }

  if (kind === 'cron') {
    const expr = String(input.expr || '').trim();
    const p = parseCron(expr);
    if (!p.ok) return _err('invalid_schedule', p.error);
    if (nextCronRun(expr, now) === null) return _err('invalid_schedule', 'no fire time within 5 years');
    return { ok: true, schedule: { kind, expr } };
  }

  // once
  const at = Number(input.at);
  if (!Number.isFinite(at)) return _err('invalid_schedule', 'at must be epoch ms');
  if (at < now + 60_000) return _err('once_in_past', 'once.at must be at least 60s in the future');
  return { ok: true, schedule: { kind, at } };
}

/** Map a preset schedule to its cron equivalent. `once` has no cron form → null. */
export function scheduleToCron(schedule) {
  if (!schedule || typeof schedule !== 'object') return null;
  switch (schedule.kind) {
    case 'hourly': return `${schedule.minute} * * * *`;
    case 'daily': {
      const [h, m] = schedule.time.split(':');
      return `${Number(m)} ${Number(h)} * * *`;
    }
    case 'weekdays': {
      const [h, m] = schedule.time.split(':');
      return `${Number(m)} ${Number(h)} * * 1-5`;
    }
    case 'weekly': {
      const [h, m] = schedule.time.split(':');
      return `${Number(m)} ${Number(h)} * * ${schedule.day % 7}`; // ISO 7(Sun) → cron 0
    }
    case 'cron': return schedule.expr;
    default: return null; // once
  }
}

/**
 * Next BASE fire time (before jitter) strictly after `afterMs`. Epoch ms or null.
 * `once` returns its `at` when still in the future, else null.
 */
export function nextBaseFor(schedule, afterMs) {
  if (!schedule || typeof schedule !== 'object') return null;
  if (schedule.kind === 'once') return schedule.at > afterMs ? schedule.at : null;
  const expr = scheduleToCron(schedule);
  return expr ? nextCronRun(expr, afterMs) : null;
}

/**
 * Occurrences in (fromMs, nowMs]. Returns { latest, count } or null when none.
 *
 * Review P1-1: "latest" and "count" are decoupled from any enumeration cap. We first
 * check whether ANY occurrence exists within the 7-day catch-up window; the enumeration
 * then starts from the max(fromMs, windowStart) so `latest` is the true most-recent fire,
 * not a truncation point. `count` is therefore exact for the catch-up decision.
 */
export function occurrencesAtOrBefore(schedule, fromMs, nowMs, { windowMs = 7 * 24 * 3600 * 1000 } = {}) {
  if (!schedule || typeof schedule !== 'object') return null;
  if (schedule.kind === 'once') {
    const hit = schedule.at > fromMs && schedule.at <= nowMs;
    return hit ? { latest: schedule.at, count: 1 } : null;
  }
  const expr = scheduleToCron(schedule);
  if (!expr) return null;

  // Cheap existence probe: is there any fire in the last `windowMs` at all? If not,
  // there's nothing worth enumerating (the caller marks the task missed/stale).
  const windowStart = nowMs - windowMs;
  if (nextCronRun(expr, windowStart) === null || nextCronRun(expr, windowStart) > nowMs) {
    // Still may have fires between fromMs and windowStart — but those are all stale.
    // Report them as stale via a probe at fromMs.
    const any = nextCronRun(expr, fromMs);
    if (any === null || any > nowMs) return null;
    return { latest: any, count: 1, stale: true };
  }

  // Enumerate from the later of (fromMs, windowStart) forward to nowMs. `fromMs` is a
  // scheduled BASE that may itself be due right now, and nextCronRun is strictly-greater,
  // so seed the cursor one ms BEFORE the start to include a fire exactly at the start.
  let cursor = Math.max(fromMs, windowStart) - 1;
  let latest = null;
  let count = 0;
  // Bounded: at most windowMs/1min iterations for `* * * * *` (10080) — acceptable.
  for (let guard = 0; guard < 11000; guard++) {
    const t = nextCronRun(expr, cursor);
    if (t === null || t > nowMs) break;
    latest = t;
    count += 1;
    cursor = t;
  }
  return latest === null ? null : { latest, count };
}

/** Deterministic per-task jitter in [0, maxMs] (FNV-1a over the task id). */
export function jitterForTaskId(id, maxMs = 120_000) {
  let h = 0x811c9dc5;
  const s = String(id);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0) % (maxMs + 1);
}
