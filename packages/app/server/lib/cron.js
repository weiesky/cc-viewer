// Minimal 5-field cron parser + next-run computation, local timezone.
//
// Scope (deliberately small — this backs the scheduled-task feature, not a
// general cron service):
//   - fields: minute(0-59) hour(0-23) day-of-month(1-31) month(1-12) day-of-week(0-7, 7=Sunday)
//   - syntax: `*`, `a`, `a-b`, `*/n`, `a-b/n`, comma lists of those. No names (JAN/MON).
//   - vixie DOM/DOW OR semantics: when BOTH dom and dow are restricted, a day matches
//     if either matches; otherwise both must match (an unrestricted side = full range).
//   - `*/n` counts as RESTRICTED (not a star) for the DOM/DOW OR rule.
//
// Invariants nextCronRun MUST keep (review P1-5 — violating any of these causes a
// claim loop or a double fire):
//   1. The result is STRICTLY greater than `afterMs` (never equal), so callers that
//      recompute `next` from the previous occurrence always move forward.
//   2. Spring-forward: a local wall time that does not exist (e.g. 02:30 on the DST
//      jump day) is SKIPPED, not "rolled over" — we read back the constructed Date's
//      fields and reject the candidate when they differ from what we asked for.
//   3. Fall-back: a repeated wall time resolves (via `new Date`) to its FIRST
//      occurrence; it fires at most once. When `after` already sits at/after that
//      first occurrence, the day is not double-counted.

const MIN = 60 * 1000;

const FIELD_DEFS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'dom', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'dow', min: 0, max: 7 }, // 7 normalized to 0 (Sunday)
];

/** Parse one field into { values:Set<number>, restricted:boolean }. */
function _parseField(text, def) {
  const values = new Set();
  let restricted = false;
  const add = (v) => {
    if (v < def.min || v > def.max) throw new Error(`${def.name} out of range: ${v}`);
    values.add(def.name === 'dow' && v === 7 ? 0 : v); // 7 → Sunday(0)
  };
  for (const part of String(text).split(',')) {
    if (!part) throw new Error(`${def.name}: empty list item`);
    const stepMatch = /^(.+)\/(\d+)$/.exec(part);
    const stepBase = stepMatch ? stepMatch[1] : part;
    const step = stepMatch ? parseInt(stepMatch[2], 10) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error(`${def.name}: bad step ${stepMatch?.[2]}`);
    if (stepBase === '*') {
      restricted = restricted || !!stepMatch; // `*` alone = full range; `*/n` = restricted
      for (let v = def.min; v <= def.max; v += step) add(v);
      continue;
    }
    restricted = true;
    const rangeMatch = /^(\d+)-(\d+)$/.exec(stepBase);
    if (rangeMatch) {
      const lo = parseInt(rangeMatch[1], 10);
      const hi = parseInt(rangeMatch[2], 10);
      if (lo > hi) throw new Error(`${def.name}: reversed range ${lo}-${hi}`);
      for (let v = lo; v <= hi; v += step) add(v);
      continue;
    }
    if (/^\d+$/.test(stepBase)) {
      const single = parseInt(stepBase, 10);
      if (stepMatch) {
        // `a/n`: vixie treats as `a-max/n`.
        for (let v = single; v <= def.max; v += step) add(v);
      } else {
        add(single);
      }
      continue;
    }
    throw new Error(`${def.name}: unsupported token "${stepBase}"`);
  }
  if (values.size === 0) throw new Error(`${def.name}: no values`);
  return { values, restricted };
}

/**
 * Parse a 5-field cron expression.
 * Returns { ok:true, fields:[{values,restricted}×5], source } or { ok:false, error }.
 */
export function parseCron(expr) {
  if (typeof expr !== 'string') return { ok: false, error: 'not a string' };
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return { ok: false, error: `expected 5 fields, got ${parts.length}` };
  try {
    const fields = parts.map((p, i) => _parseField(p, FIELD_DEFS[i]));
    return { ok: true, fields, source: expr.trim() };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Does `date` match the parsed expression (local time)? dom/dow use the vixie OR rule.
 * `fields` is the array from parseCron(...).fields.
 */
export function cronMatchesFields(fields, date) {
  const minute = date.getMinutes();
  const hour = date.getHours();
  const dom = date.getDate();
  const month = date.getMonth() + 1;
  const dow = date.getDay();
  if (!fields[0].values.has(minute)) return false;
  if (!fields[1].values.has(hour)) return false;
  if (!fields[3].values.has(month)) return false;
  const domF = fields[2];
  const dowF = fields[4];
  const domHit = domF.values.has(dom);
  const dowHit = dowF.values.has(dow);
  if (domF.restricted && dowF.restricted) return domHit || dowHit; // vixie OR
  return domHit && dowHit;
}

/** Convenience: parse + match. Returns false on parse error. */
export function cronMatches(expr, date) {
  const p = parseCron(expr);
  if (!p.ok) return false;
  return cronMatchesFields(p.fields, date);
}

/**
 * Next fire time STRICTLY after `afterMs` (local time). Returns epoch ms, or null when
 * no solution within ~5 years. Minute granularity.
 *
 * Strategy: iterate day-by-day from the day after `after`'s day when needed, but jump
 * straight to the next matching time-of-day within a matching day. We never scan
 * minute-by-minute, so even `* * * * *` over a 30-day sleep is ~30 iterations.
 */
export function nextCronRun(expr, afterMs) {
  const p = typeof expr === 'string' ? parseCron(expr) : expr;
  if (!p || p.ok === false) return null;
  const fields = p.fields;

  // Start at the next minute boundary strictly after `afterMs`.
  let cursor = Math.floor(afterMs / MIN) * MIN + MIN;
  const limit = cursor + 5 * 366 * 24 * 60 * MIN; // ~5 years of minutes (upper bound)

  // Ordered candidate times-of-day (minutes/hours) for quick within-day search.
  const minutes = [...fields[0].values].sort((a, b) => a - b);
  const hours = [...fields[1].values].sort((a, b) => a - b);

  for (let guard = 0; guard < 5 * 366 && cursor < limit; guard++) {
    const dayStart = new Date(cursor);
    dayStart.setHours(0, 0, 0, 0);
    // Does this calendar DAY match month + dom/dow? (Match the day fields only —
    // probing with a specific time like noon would wrongly reject a day whose only
    // matching time-of-day is, say, 09:00.) If not, jump a day.
    const probe = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), 12, 0, 0, 0);
    const monthHit = fields[3].values.has(probe.getMonth() + 1);
    const domF = fields[2];
    const dowF = fields[4];
    const domHit = domF.values.has(probe.getDate());
    const dowHit = dowF.values.has(probe.getDay());
    const dayHit = monthHit && (domF.restricted && dowF.restricted ? (domHit || dowHit) : (domHit && dowHit));
    if (!dayHit) {
      // Advance by CALENDAR day (setDate+1), not +24h: a DST transition day is 23h
      // or 25h long, and a fixed +24h can land back on the same day (fall-back,
      // infinite loop) or skip one (spring-forward).
      const next = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1, 0, 0, 0, 0);
      cursor = next.getTime();
      continue;
    }
    // Within a matching day, find the earliest matching hour:minute strictly > afterMs.
    let found = null;
    for (const h of hours) {
      for (const m of minutes) {
        const t = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), h, m, 0, 0);
        // Spring-forward guard: a non-existent wall time gets normalized by Date
        // (02:30 → 03:30). Read the fields back and reject the rollover.
        if (t.getHours() !== h || t.getMinutes() !== m || t.getDate() !== dayStart.getDate()) continue;
        const ms = t.getTime();
        // Strictly greater than `afterMs` AND not before this iteration's floor.
        if (ms > afterMs && ms >= cursor) { found = ms; break; }
      }
      if (found !== null) break;
    }
    if (found !== null) return found;
    const nextDay = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1, 0, 0, 0, 0);
    cursor = nextDay.getTime();
  }
  return null;
}
