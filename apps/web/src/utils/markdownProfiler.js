/**
 * Dev-only instrumentation for the Markdown render pipeline.
 *
 * Gated on `import.meta.env.DEV` — production builds compile every export to a
 * no-op and tree-shake the module state away, so runtime cost in prod is zero.
 *
 * API:
 *   measureParse(fn)        — wrap a sync parse call; records duration as a
 *                             parse sample and emits an `md-parse` measure.
 *   recordMountSample(ms)   — append a mount-cycle duration (typically the
 *                             delta between render-return and the next effect)
 *                             and emit an `md-mount` measure.
 *
 * Inspection:
 *   window.__mdStats.summary()  → { parseP50, parseP95, mountP50, mountP95, ... }
 *   window.__mdStats.reset()
 *   window.__mdStats.samples    → raw { parse: [], mount: [] }
 *
 * DevTools Performance timeline shows `md-parse` / `md-mount` measures under
 * the User Timing track. A recorded slice of a streaming session can then be
 * inspected to attribute time between parse, reconcile, layout, and paint.
 *
 * The module auto-prunes performance.measure entries once per 500 samples so
 * long-running dev sessions do not accumulate unbounded DevTools entries.
 */

const DEV = typeof import.meta !== 'undefined'
  && import.meta.env
  && import.meta.env.DEV === true;

const MAX_SAMPLES = 2000;
const CLEAR_MARKS_EVERY = 500;

export function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

export function createStats() {
  const parse = [];
  const mount = [];
  let writeCount = 0;

  function pushBounded(arr, v) {
    arr.push(v);
    if (arr.length > MAX_SAMPLES) arr.splice(0, arr.length - MAX_SAMPLES);
  }

  function maybeClearMarks() {
    writeCount += 1;
    if (writeCount % CLEAR_MARKS_EVERY === 0
        && typeof performance !== 'undefined'
        && typeof performance.clearMeasures === 'function') {
      try {
        performance.clearMeasures('md-parse');
        performance.clearMeasures('md-mount');
      } catch { /* ignore */ }
    }
  }

  return {
    samples: { parse, mount },
    recordParse(ms) { pushBounded(parse, ms); maybeClearMarks(); },
    recordMount(ms) { pushBounded(mount, ms); maybeClearMarks(); },
    summary() {
      const p = [...parse].sort((a, b) => a - b);
      const m = [...mount].sort((a, b) => a - b);
      return {
        parseN: parse.length,
        parseP50: +percentile(p, 0.5).toFixed(2),
        parseP95: +percentile(p, 0.95).toFixed(2),
        parseMax: +(p[p.length - 1] || 0).toFixed(2),
        mountN: mount.length,
        mountP50: +percentile(m, 0.5).toFixed(2),
        mountP95: +percentile(m, 0.95).toFixed(2),
        mountMax: +(m[m.length - 1] || 0).toFixed(2),
      };
    },
    reset() {
      parse.length = 0;
      mount.length = 0;
      writeCount = 0;
    },
  };
}

const stats = DEV ? createStats() : null;

if (DEV && typeof window !== 'undefined') {
  window.__mdStats = stats;
}

export function measureParse(fn) {
  if (!DEV) return fn();
  const start = performance.now();
  const result = fn();
  const ms = performance.now() - start;
  stats.recordParse(ms);
  try { performance.measure('md-parse', { start, end: start + ms }); } catch { /* ignore */ }
  return result;
}

export function recordMountSample(ms) {
  if (!DEV || !Number.isFinite(ms) || ms < 0) return;
  stats.recordMount(ms);
  try {
    const start = performance.now() - ms;
    performance.measure('md-mount', { start, end: start + ms });
  } catch { /* ignore */ }
}

export const DEV_PROFILER_ENABLED = DEV;
