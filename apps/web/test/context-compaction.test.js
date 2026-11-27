/**
 * context-compaction.test.js — pure-logic unit tests for contextCompaction.js.
 * Covers: config normalization / payload serialization / /compact command assembly / usage reading normalization / trigger state machine.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPACTION_DEFAULTS,
  DEFAULT_COMPACTION_ITEM,
  BUILTIN_COMPACTION_IDS,
  FORCE_COMPACT_THRESHOLD_TOKENS,
  FORCE_COMPACT_CHECK_INTERVAL_MS,
  FORCE_COMPACT_COOLDOWN_MS,
  forceCompactTokens,
  isForceCompactLatched,
  normalizeCompactionConfig,
  normalizeCompactionItem,
  buildContextCompactionPayload,
  buildCompactCommand,
  normalizeUsageReading,
  isAboveThreshold,
  isBelowHysteresis,
  compactionWatermarkPercent,
  compactionWatermarkTokens,
  shouldShowWatermark,
  createTriggerState,
  resetTriggerState,
  markTurnStart,
  applyCheckpoint,
  markInjected,
  markExternalCompaction,
  markIgnored,
  markDeferred,
  advanceTurn,
  shouldReleaseDeferral,
  markInjectRolledBack,
  EXECUTION_TIMINGS,
  TIMING_COUNTDOWN_MS,
  markInjectFailed,
  markInjectBusy,
  assignCompactionIds,
} from '../src/utils/contextCompaction.js';

/* ---------------- Config normalization ---------------- */

describe('normalizeCompactionConfig', () => {
  // Built-in rules are always merged to the front; customs() extracts the custom-rule portion for assertions.
  const customs = (out) => out.filter((i) => i.builtinId == null);
  it('unconfigured (undefined/null) → built-in default rule only', () => {
    for (const raw of [undefined, null]) {
      const out = normalizeCompactionConfig(raw);
      assert.equal(out.length, 1);
      assert.equal(out[0].builtinId, 'default');
      assert.equal(out[0].title, DEFAULT_COMPACTION_ITEM.title);
      assert.equal(out[0].script, DEFAULT_COMPACTION_ITEM.script);
      assert.deepEqual(out[0].threshold, { mode: 'percent', value: 75 });
      assert.equal(out[0].enabled, true);
      assert.equal(out[0].executionTiming, 'user');
    }
  });
  it('any input merges the built-in default rule to the front (including dirty data/empty arrays)', () => {
    for (const raw of [{}, 'x', []]) {
      const out = normalizeCompactionConfig(raw);
      assert.equal(out.length, 1);
      assert.equal(out[0].builtinId, 'default');
    }
  });
  it('with custom rules present, the built-in default is inserted first and customs are kept after', () => {
    const out = normalizeCompactionConfig([{ title: 'mine', script: 's', threshold: { mode: 'percent', value: 80 } }]);
    assert.equal(out[0].builtinId, 'default');
    assert.equal(customs(out).length, 1);
    assert.equal(customs(out)[0].title, 'mine');
  });
  it('does not re-insert when disk already has default; duplicate builtinIds are deduped to one', () => {
    const out = normalizeCompactionConfig([
      { builtinId: 'default', script: 'x' },
      { builtinId: 'default', script: 'y' },
      { title: 'mine', script: 's', threshold: { mode: 'percent', value: 80 } },
    ]);
    assert.equal(out.filter((i) => i.builtinId === 'default').length, 1);
    assert.equal(customs(out).length, 1);
  });
  it('built-in rule is editable: user edits to script/threshold/enabled/timing are preserved', () => {
    const out = normalizeCompactionConfig([
      { builtinId: 'default', title: 'my default', script: 'custom script', threshold: { mode: 'percent', value: 60 }, enabled: false, executionTiming: 'auto' },
    ]);
    const d = out.find((i) => i.builtinId === 'default');
    assert.equal(d.title, 'my default');
    assert.equal(d.script, 'custom script');
    assert.deepEqual(d.threshold, { mode: 'percent', value: 60 });
    assert.equal(d.enabled, false);
    assert.equal(d.executionTiming, 'auto');
  });
  it('built-in rule with a cleared script falls back to the built-in script (960K never fires empty)', () => {
    const out = normalizeCompactionConfig([
      { builtinId: 'default', title: 'x', script: '   ', threshold: { mode: 'percent', value: 75 } },
    ]);
    const d = out.find((i) => i.builtinId === 'default');
    assert.equal(d.script, DEFAULT_COMPACTION_ITEM.script);
  });
  it('invalid builtinId is stripped (treated as an ordinary custom rule)', () => {
    const out = normalizeCompactionConfig([{ builtinId: 'nope', title: 'a', script: 's', threshold: { mode: 'percent', value: 80 } }]);
    const c = customs(out);
    assert.equal(c.length, 1);
    assert.equal(c[0].builtinId, undefined);
    assert.equal(c[0].title, 'a');
  });
  it('custom entries with empty script are discarded', () => {
    const out = normalizeCompactionConfig([
      { title: 'a', script: '  ', threshold: { mode: 'percent', value: 80 } },
      { title: 'b', script: 'keep decisions', threshold: { mode: 'percent', value: 80 } },
    ]);
    const c = customs(out);
    assert.equal(c.length, 1);
    assert.equal(c[0].title, 'b');
  });
  it('invalid mode falls back to percent; out-of-range/NaN value converges', () => {
    const out = customs(normalizeCompactionConfig([
      { script: 's', threshold: { mode: 'bogus', value: 999 } },
      { script: 's', threshold: { mode: 'percent', value: 'not-a-number' } },
      { script: 's', threshold: { mode: 'tokens', value: 0 } },
      { script: 's', threshold: { mode: 'tokens', value: 999999 } },
    ]));
    assert.equal(out[0].threshold.mode, 'percent');
    assert.equal(out[0].threshold.value, 100); // clamp to maxPercent
    assert.equal(out[1].threshold.value, COMPACTION_DEFAULTS.percentDefault); // NaN → default
    assert.equal(out[2].threshold.value, 1);   // tokens clamp to minTokensK
    assert.equal(out[3].threshold.value, COMPACTION_DEFAULTS.maxTokensK);
  });
  it('enabled defaults to true; explicit false is preserved', () => {
    const out = customs(normalizeCompactionConfig([{ script: 's', threshold: { mode: 'percent', value: 80 } }, { script: 's', threshold: { mode: 'percent', value: 80 }, enabled: false }]));
    assert.equal(out[0].enabled, true);
    assert.equal(out[1].enabled, false);
  });
  it('executionTiming missing/invalid → user; valid enums preserved', () => {
    const out = customs(normalizeCompactionConfig([
      { script: 's', threshold: { mode: 'percent', value: 80 } },                    // missing
      { script: 's', threshold: { mode: 'percent', value: 80 }, executionTiming: 'bogus' }, // invalid
      { script: 's', threshold: { mode: 'percent', value: 80 }, executionTiming: 'auto' },  // valid
      { script: 's', threshold: { mode: 'percent', value: 80 }, executionTiming: 's30' },
      { script: 's', threshold: { mode: 'percent', value: 80 }, executionTiming: 'm3' },
    ]));
    assert.equal(out[0].executionTiming, 'user');
    assert.equal(out[1].executionTiming, 'user'); // unknown values never fall to auto
    assert.equal(out[2].executionTiming, 'auto');
    assert.equal(out[3].executionTiming, 's30');
    assert.equal(out[4].executionTiming, 'm3');
    assert.deepEqual(EXECUTION_TIMINGS, ['user', 's30', 'm3', 'auto']);
  });
  it('countdown mapping: only s30/m3 have a countdown; user/auto do not', () => {
    assert.equal(TIMING_COUNTDOWN_MS.s30, 30 * 1000);
    assert.equal(TIMING_COUNTDOWN_MS.m3, 3 * 60 * 1000);
    assert.equal(TIMING_COUNTDOWN_MS.user, undefined);
    assert.equal(TIMING_COUNTDOWN_MS.auto, undefined);
  });
  it('truncates beyond maxItems; built-ins kept preferentially', () => {
    const many = Array.from({ length: 30 }, () => ({ script: 's', threshold: { mode: 'percent', value: 80 } }));
    const out = normalizeCompactionConfig(many);
    assert.equal(out.length, COMPACTION_DEFAULTS.maxItems);
    assert.equal(out[0].builtinId, 'default'); // built-in rule always keeps first place
  });
  it('title/script lengths are truncated', () => {
    const out = normalizeCompactionItem({ title: 't'.repeat(200), script: 'x'.repeat(9000), threshold: { mode: 'percent', value: 80 } });
    assert.equal(out.title.length, COMPACTION_DEFAULTS.maxTitleLen);
    assert.equal(out.script.length, COMPACTION_DEFAULTS.maxScriptLen);
  });
});

/* ---------------- Health-bar watermark ---------------- */
describe('compactionWatermarkPercent', () => {
  const norm = (arr) => arr.map((i) => normalizeCompactionItem(i)).filter(Boolean);
  it('no rules/all disabled → null', () => {
    assert.equal(compactionWatermarkPercent([], 1000000), null);
    assert.equal(compactionWatermarkPercent(null, 1000000), null);
    assert.equal(compactionWatermarkPercent(norm([{ script: 's', threshold: { mode: 'percent', value: 75 }, enabled: false }]), 1000000), null);
  });
  it('percent mode uses the value directly; takes the minimum across enabled rules', () => {
    const items = norm([
      { script: 'a', threshold: { mode: 'percent', value: 80 } },
      { script: 'b', threshold: { mode: 'percent', value: 75 } },
      { script: 'c', threshold: { mode: 'percent', value: 90 } },
    ]);
    assert.equal(compactionWatermarkPercent(items, 1000000), 75);
  });
  it('tokens mode converts via maxTokens (K×1000/max×100)', () => {
    const items = norm([{ script: 's', threshold: { mode: 'tokens', value: 750 } }]); // 750K
    assert.equal(compactionWatermarkPercent(items, 1000000), 75); // 1M window → 75%
  });
  it('tokens mode without a window cap → skipped; percent entries can still draw a line', () => {
    const tokensOnly = norm([{ script: 's', threshold: { mode: 'tokens', value: 750 } }]);
    assert.equal(compactionWatermarkPercent(tokensOnly, null), null);
    const mixed = norm([
      { script: 's', threshold: { mode: 'tokens', value: 750 } },
      { script: 'p', threshold: { mode: 'percent', value: 60 } },
    ]);
    assert.equal(compactionWatermarkPercent(mixed, null), 60);
  });
  it('result clamps to 0-100; over-limit truncates to 100', () => {
    const items = norm([{ script: 's', threshold: { mode: 'tokens', value: 2000 } }]); // 2000K > 1M
    assert.equal(compactionWatermarkPercent(items, 1000000), 100);
  });
});

/* ---------------- Watermark tokens + proximity visibility ---------------- */
describe('compactionWatermarkTokens / shouldShowWatermark', () => {
  const norm = (arr) => arr.map((i) => normalizeCompactionItem(i)).filter(Boolean);
  it('tokens mode reads K×1000; percent mode converts via maxTokens', () => {
    assert.equal(compactionWatermarkTokens(norm([{ script: 's', threshold: { mode: 'tokens', value: 750 } }]), 1000000), 750000);
    assert.equal(compactionWatermarkTokens(norm([{ script: 's', threshold: { mode: 'percent', value: 75 } }]), 1000000), 750000);
  });
  it('takes the minimum across enabled rules; skips disabled', () => {
    const items = norm([
      { script: 'a', threshold: { mode: 'percent', value: 80 } },
      { script: 'b', threshold: { mode: 'percent', value: 75 } },
      { script: 'c', threshold: { mode: 'percent', value: 70 }, enabled: false },
    ]);
    assert.equal(compactionWatermarkTokens(items, 1000000), 750000);
  });
  it('percent mode without a window cap → null (cannot convert); tokens-only still works', () => {
    assert.equal(compactionWatermarkTokens(norm([{ script: 's', threshold: { mode: 'percent', value: 75 } }]), null), null);
    assert.equal(compactionWatermarkTokens(norm([{ script: 's', threshold: { mode: 'tokens', value: 750 } }]), null), 750000);
  });
  it('no enabled rule → null', () => {
    assert.equal(compactionWatermarkTokens([], 1000000), null);
    assert.equal(compactionWatermarkTokens(norm([{ script: 's', threshold: { mode: 'percent', value: 75 }, enabled: false }]), 1000000), null);
  });
  it('shouldShowWatermark: hidden until within 100K of the line, shown at/past it', () => {
    // watermark 750K, near window 100K → visible from 650K up
    assert.equal(shouldShowWatermark(750000, 649999), false);
    assert.equal(shouldShowWatermark(750000, 650000), true);   // exactly 100K away
    assert.equal(shouldShowWatermark(750000, 749000), true);
    assert.equal(shouldShowWatermark(750000, 800000), true);   // already past the line
  });
  it('shouldShowWatermark: invalid inputs → false', () => {
    assert.equal(shouldShowWatermark(null, 800000), false);
    assert.equal(shouldShowWatermark(750000, 0), false);
    assert.equal(shouldShowWatermark(0, 100), false);
  });
});

/* ---------------- Payload serialization ---------------- */

describe('buildContextCompactionPayload', () => {
  it('writes business fields only, without id; empty script filtered out', () => {
    const p = buildContextCompactionPayload([
      { id: 123, title: 'a', script: 'keep it', threshold: { mode: 'percent', value: 75 }, enabled: true },
      { id: 456, title: 'b', script: '   ', threshold: { mode: 'percent', value: 80 } },
    ]);
    assert.equal(p.contextCompaction.length, 1);
    assert.deepEqual(Object.keys(p.contextCompaction[0]).sort(), ['enabled', 'executionTiming', 'script', 'threshold', 'title']);
    assert.equal(p.contextCompaction[0].threshold.mode, 'percent');
    assert.equal(p.contextCompaction[0].executionTiming, 'user');
  });
  it('payload preserves valid executionTiming, invalid falls back to user', () => {
    const p = buildContextCompactionPayload([
      { title: 'a', script: 's1', threshold: { mode: 'percent', value: 80 }, executionTiming: 'auto' },
      { title: 'b', script: 's2', threshold: { mode: 'percent', value: 80 }, executionTiming: 'xxx' },
    ]);
    assert.equal(p.contextCompaction[0].executionTiming, 'auto');
    assert.equal(p.contextCompaction[1].executionTiming, 'user');
  });
  it('non-array input → empty array', () => {
    assert.deepEqual(buildContextCompactionPayload(null), { contextCompaction: [] });
  });
  it('built-in rules: payload keeps builtinId and the user edits (not a locked canonical form)', () => {
    const p = buildContextCompactionPayload([
      { id: 9, builtinId: 'default', title: 'my default', script: 'custom script', threshold: { mode: 'percent', value: 60 }, enabled: false, executionTiming: 'auto' },
    ]);
    assert.equal(p.contextCompaction.length, 1);
    const o = p.contextCompaction[0];
    assert.equal(o.builtinId, 'default');
    assert.equal(o.title, 'my default');
    assert.equal(o.script, 'custom script');
    assert.deepEqual(o.threshold, { mode: 'percent', value: 60 });
    assert.equal(o.enabled, false);
    assert.equal(o.executionTiming, 'auto');
  });
  it('built-in payload with a cleared script falls back to the built-in script', () => {
    const p = buildContextCompactionPayload([{ id: 9, builtinId: 'default', title: 'x', script: '  ', threshold: { mode: 'percent', value: 75 } }]);
    assert.equal(p.contextCompaction[0].script, DEFAULT_COMPACTION_ITEM.script);
  });
  it('invalid builtinId is not written into payload (stripped)', () => {
    const p = buildContextCompactionPayload([{ builtinId: 'nope', title: 'a', script: 's', threshold: { mode: 'percent', value: 80 } }]);
    assert.equal(p.contextCompaction[0].builtinId, undefined);
  });
});

/* ---------------- Forced compaction constants + streaming reading ---------------- */
describe('FORCE compact constants', () => {
  it('960K threshold hard-coded + streaming evaluation interval + cooldown', () => {
    assert.equal(FORCE_COMPACT_THRESHOLD_TOKENS, 960000);
    assert.equal(FORCE_COMPACT_CHECK_INTERVAL_MS, 2000);
    assert.equal(FORCE_COMPACT_COOLDOWN_MS, 60000);
  });
});

describe('forceCompactTokens (streaming 960K dedicated reading)', () => {
  it('context_window uses input+output sum; does not depend on maxTokens', () => {
    const r = forceCompactTokens({ contextWindow: { total_input_tokens: 900000, total_output_tokens: 70000, context_window_size: 1000000 } });
    assert.equal(r.tokens, 970000); // ≥ 960K, will trigger
  });
  it('context_window without token fields converts via used_percentage×size', () => {
    const r = forceCompactTokens({ contextWindow: { used_percentage: 97, context_window_size: 1000000 } });
    assert.equal(r.tokens, 970000);
  });
  it('falls back to the request fallback when there is no context_window (sumUsageContextTokens)', () => {
    const r = forceCompactTokens({ mainAgentUsage: { input_tokens: 500000, cache_read_input_tokens: 470000, output_tokens: 1000 } });
    assert.equal(r.tokens, 971000);
  });
  it('all unavailable → null (no trigger)', () => {
    assert.equal(forceCompactTokens({}), null);
    assert.equal(forceCompactTokens({ contextWindow: null, mainAgentUsage: null }), null);
    assert.equal(forceCompactTokens({ contextWindow: { total_input_tokens: 0, total_output_tokens: 0 } }), null);
  });
  it('returns a content fingerprint key (same value same key, changed value changed key)', () => {
    const a = forceCompactTokens({ contextWindow: { total_input_tokens: 970000, context_window_size: 1000000 } });
    const b = forceCompactTokens({ contextWindow: { total_input_tokens: 970000, context_window_size: 1000000 } });
    const c = forceCompactTokens({ contextWindow: { total_input_tokens: 500000, context_window_size: 1000000 } });
    assert.equal(a.key, b.key);
    assert.notEqual(a.key, c.key);
  });
});

/* ---------------- 960K post-compaction latch ---------------- */
describe('isForceCompactLatched (960K latch)', () => {
  const TH = FORCE_COMPACT_THRESHOLD_TOKENS;
  const mkReading = (tokens, key) => ({ tokens, key });
  it('no latch → not latched (false)', () => {
    assert.equal(isForceCompactLatched(null, mkReading(970000, 'k1'), TH), false);
  });
  it('latched + reading still ≥ threshold and not clearly dropped → still latched (true)', () => {
    const latch = { tokens: 970000, key: 'cw|970000|1000000|' };
    // the same stale reading (same key, same value) polled repeatedly: still latched, no re-trigger
    assert.equal(isForceCompactLatched(latch, mkReading(970000, 'cw|970000|1000000|'), TH), true);
  });
  it('latched + reading falls below threshold → cleared (false)', () => {
    const latch = { tokens: 970000, key: 'cw|970000|1000000|' };
    assert.equal(isForceCompactLatched(latch, mkReading(300000, 'cw|300000|1000000|'), TH), false);
  });
  it('latched + new reading that clearly dropped (>2%) → cleared (false)', () => {
    const latch = { tokens: 970000, key: 'k1' };
    // new key and dropped below 98% of the trigger baseline → treated as post-compaction reading, cleared
    assert.equal(isForceCompactLatched(latch, mkReading(900000, 'k2'), TH), false);
  });
  it('latched + new reading but no clear drop (slight drop only) → still latched (true)', () => {
    const latch = { tokens: 970000, key: 'k1' };
    assert.equal(isForceCompactLatched(latch, mkReading(965000, 'k2'), TH), true); // 965000 > 970000*0.98
  });
  it('latched + no reading → stays latched (true)', () => {
    assert.equal(isForceCompactLatched({ tokens: 970000, key: 'k1' }, null, TH), true);
  });
  it('cross-end latch (key:null) clears only by falling below the threshold', () => {
    const latch = { tokens: TH, key: null };
    assert.equal(isForceCompactLatched(latch, mkReading(965000, 'k9'), TH), true); // still ≥ threshold
    assert.equal(isForceCompactLatched(latch, mkReading(200000, 'k9'), TH), false); // below → cleared
  });
});

/* ---------------- /compact command ---------------- */

describe('buildCompactCommand', () => {
  it('prepends the /compact prefix', () => {
    assert.equal(buildCompactCommand('keep decisions'), '/compact keep decisions');
  });
  it('does not duplicate when the script already has /compact', () => {
    assert.equal(buildCompactCommand('/compact keep it'), '/compact keep it');
    assert.equal(buildCompactCommand('  /compact   keep it  '), '/compact keep it');
  });
  it('empty script → bare /compact', () => {
    assert.equal(buildCompactCommand('   '), '/compact');
  });
});

/* ---------------- Usage reading normalization ---------------- */

describe('normalizeUsageReading', () => {
  it('SDK totalTokens/maxTokens', () => {
    const r = normalizeUsageReading({ sdkUsage: { totalTokens: 150000, maxTokens: 200000 } });
    assert.equal(r.ok, true);
    assert.equal(r.source, 'sdk');
    assert.equal(r.tokens, 150000);
    assert.equal(r.percent, 75);
  });
  it('SDK rawMaxTokens fallback + percentage derivation', () => {
    const r = normalizeUsageReading({ sdkUsage: { rawMaxTokens: 1000000, percentage: 40 } });
    assert.equal(r.ok, true);
    assert.equal(r.tokens, 400000);
  });
  it('SDK over-limit clamps to 100 without discarding', () => {
    const r = normalizeUsageReading({ sdkUsage: { totalTokens: 250000, maxTokens: 200000 } });
    assert.equal(r.ok, true);
    assert.equal(r.percent, 100);
    assert.equal(r.tokens, 250000); // tokens keeps the real value
  });
  it('SDK percentage 0-1 form normalized (0.4 → 40)', () => {
    const r = normalizeUsageReading({ sdkUsage: { maxTokens: 200000, percentage: 0.4 } });
    assert.equal(r.tokens, 80000);
  });
  it('PTY total_input+total_output', () => {
    const r = normalizeUsageReading({ contextWindow: { context_window_size: 200000, total_input_tokens: 150000, total_output_tokens: 10000 } });
    assert.equal(r.ok, true);
    assert.equal(r.source, 'pty');
    assert.equal(r.tokens, 160000);
    assert.equal(r.percent, 80);
  });
  it('PTY used_percentage fallback', () => {
    const r = normalizeUsageReading({ contextWindow: { context_window_size: 200000, used_percentage: 60 } });
    assert.equal(r.tokens, 120000);
  });
  it('request fallback (mainAgentUsage + contextWindow size)', () => {
    const r = normalizeUsageReading({
      mainAgentUsage: { input_tokens: 100000, cache_read_input_tokens: 40000, output_tokens: 10000 },
      contextWindow: { context_window_size: 200000 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.source, 'requests');
    assert.equal(r.tokens, 150000);
  });
  it('max≤0 / raw≤0 / all missing → ok:false', () => {
    assert.equal(normalizeUsageReading({ sdkUsage: { totalTokens: 100, maxTokens: 0 } }).ok, false);
    assert.equal(normalizeUsageReading({ sdkUsage: { totalTokens: 0, maxTokens: 200000 } }).ok, false);
    assert.equal(normalizeUsageReading({}).ok, false);
    assert.equal(normalizeUsageReading({ sdkUsage: { maxTokens: 200000 } }).ok, false); // neither tokens nor percentage
  });

  it('SDK totalTokens:0 falls through to PTY context_window (not judged unavailable)', () => {
    const r = normalizeUsageReading({
      sdkUsage: { totalTokens: 0, maxTokens: 200000 },
      contextWindow: { context_window_size: 200000, total_input_tokens: 150000, total_output_tokens: 0 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.source, 'pty');
    assert.equal(r.tokens, 150000);
  });
});

/* ---------------- Threshold/hysteresis ---------------- */

describe('threshold helpers', () => {
  const pctItem = { threshold: { mode: 'percent', value: 80 } };
  const tokItem = { threshold: { mode: 'tokens', value: 150 } }; // 150K
  it('isAboveThreshold percent / tokens (K conversion)', () => {
    assert.equal(isAboveThreshold(pctItem, { ok: true, percent: 80, tokens: 160000 }), true);
    assert.equal(isAboveThreshold(pctItem, { ok: true, percent: 79.9 }), false);
    assert.equal(isAboveThreshold(tokItem, { ok: true, tokens: 150000 }), true);
    assert.equal(isAboveThreshold(tokItem, { ok: true, tokens: 149999 }), false);
  });
  it('isBelowHysteresis percent (threshold-5pt) / tokens (×0.95)', () => {
    assert.equal(isBelowHysteresis(pctItem, { ok: true, percent: 74.9 }), true);  // <75
    assert.equal(isBelowHysteresis(pctItem, { ok: true, percent: 75 }), false);
    assert.equal(isBelowHysteresis(tokItem, { ok: true, tokens: 150000 * 0.94 }), true);  // <142500
    assert.equal(isBelowHysteresis(tokItem, { ok: true, tokens: 150000 * 0.95 }), false);
  });
});

/* ---------------- Trigger state machine ---------------- */

function reading(percent, tokens) {
  return { ok: true, percent, tokens: tokens ?? 0, maxTokens: 200000, source: 'sdk', ts: 1 };
}

describe('trigger state machine', () => {
  // The state machine targets the two custom rules only; strip the built-in default rule (75%) that
  // normalizeCompactionConfig merges in automatically, otherwise reading(85) would hit it and shift the indices.
  const items = normalizeCompactionConfig([
    { title: 'a', script: 'sa', threshold: { mode: 'percent', value: 80 } },
    { title: 'b', script: 'sb', threshold: { mode: 'percent', value: 90 } },
  ]).filter((i) => i.builtinId == null);

  it('shows on the first fresh above-threshold reading (no consecutive debounce)', () => {
    // Product decision (2026-11): the previous two-consecutive-readings debounce is removed — a single
    // fresh above-threshold reading is enough to show the confirm bar. Pin the constant so a future
    // revert is caught by intent.
    assert.equal(COMPACTION_DEFAULTS.consecutiveRequired, 1, 'product decision: first above-threshold reading triggers');
    const s = createTriggerState();
    const pick = applyCheckpoint(s, items, reading(85));
    assert.equal(pick?.index, 0);
    assert.equal('released' in pick, false, 'threshold hit, not a deferral release');
  });

  it('one above-threshold reading is enough after a below-threshold one (no accumulation needed)', () => {
    const s = createTriggerState();
    assert.equal(applyCheckpoint(s, items, reading(75)), null); // below both thresholds (80/90)
    assert.equal(applyCheckpoint(s, items, reading(85))?.index, 0); // first above-threshold reading shows
  });

  it('takes the first candidate in list order (a before b)', () => {
    const s = createTriggerState();
    const pick = applyCheckpoint(s, items, reading(95)); // both above threshold → a wins
    assert.equal(pick.index, 0);
  });

  it('markIgnored → permanent snooze, cleared only after dropping below hysteresis', () => {
    const s = createTriggerState();
    const pick = applyCheckpoint(s, items, reading(85));
    markIgnored(s, pick.index);
    // still above threshold but snoozed → no longer shows (even after many turns)
    assert.equal(applyCheckpoint(s, items, reading(85)), null);
    assert.equal(applyCheckpoint(s, items, reading(85)), null);
    // dropping below hysteresis (80-5=75) clears snooze; the first above-threshold reading after re-arm shows
    assert.equal(applyCheckpoint(s, items, reading(70)), null);
    assert.equal(applyCheckpoint(s, items, reading(85))?.index, 0);
  });

  it('markDeferred (x decline) → with no context growth, re-reminds on the per-turn fallback (+2 turns)', () => {
    const s = createTriggerState();
    const pick = applyCheckpoint(s, items, reading(85));
    markDeferred(s, pick.index, reading(85), 'x'); // releaseAtTurn = completedTurns+2 = 2
    // next turn ends (completedTurns=1): zero context growth, growth not reached, per-turn not due (+2) → still deferred, no show
    advanceTurn(s);
    assert.equal(applyCheckpoint(s, items, reading(85)), null);
    // another turn ends (completedTurns=2 ≥ releaseAtTurn=2): per-turn fallback releases and shows immediately (skips consecutive counting)
    advanceTurn(s);
    const again = applyCheckpoint(s, items, reading(85));
    assert.equal(again?.index, 0);
    assert.equal(again?.released, true);
  });

  it('markDeferred (x decline) → context growth +5% releases at the next turn first (growth outranks the per-turn fallback)', () => {
    const s = createTriggerState();
    const pick = applyCheckpoint(s, items, reading(85, 170000));   // 85% of 200K = 170K, baseline tokens non-zero
    markDeferred(s, pick.index, reading(85, 170000), 'x'); // baseline 170K/200K, releaseAtTurn=2
    // next turn ends: advanceTurn(completedTurns=1, +2 fallback not due) → but context already grew to 180K (+5pt) → growth release shows immediately via dPercent branch
    advanceTurn(s);
    const r = { ok: true, percent: 90, tokens: 180000, maxTokens: 200000, source: 'sdk', ts: 2 };
    const again = applyCheckpoint(s, items, r);
    assert.equal(again?.index, 0);
    assert.equal(again?.released, true);
  });

  it('markDeferred: context growth +5% arrives first and releases first (without waiting for the next turn)', () => {
    const s = createTriggerState();
    const pick = applyCheckpoint(s, items, reading(85, 170000));   // 85% of 200K = 170K, baseline tokens non-zero
    markDeferred(s, pick.index, reading(85, 170000), 'x'); // baseline 170K/200K
    // context grows to 180K (+10K tokens = +5pt of 200K) → growth release via dPercent branch, re-remind immediately (no turn advance)
    const r = { ok: true, percent: 90, tokens: 180000, maxTokens: 200000, source: 'sdk', ts: 2 };
    const again = applyCheckpoint(s, items, r);
    assert.equal(again?.index, 0);
    assert.equal(again?.released, true);
  });

  it('markDeferred: context growth +50K tokens arrives first and releases first', () => {
    const s = createTriggerState();
    const pick = applyCheckpoint(s, items, reading(85));
    markDeferred(s, pick.index, reading(85), 'x'); // baseline 170K
    // +49K does not release (< 50K and < 5% of 200K=10K? 49K>10K would release via 5pt first — use a larger window to isolate the tokens condition)
    // here the +50K tokens condition is tested directly (with maxTokens=200K, 5%=10K would trigger first, so verify the tokens path separately via shouldReleaseDeferral)
    const def = { baseline: { tokens: 100000, maxTokens: 1000000 } }; // 1M window, 5%=50K
    // +30K: below 50K tokens and below 50K (5% of 1M) → no release
    assert.equal(shouldReleaseDeferral(def, items[0], { ok: true, tokens: 130000, maxTokens: 1000000 }), false);
    // +50K tokens: reaches 50K → release
    assert.equal(shouldReleaseDeferral(def, items[0], { ok: true, tokens: 150000, maxTokens: 1000000 }), true);
  });

  it('shouldReleaseDeferral: dPercent branch (5pt) fires independently of dTokens', () => {
    // Baseline 170K/200K. +5pt means tokens grew by 10K (5% of 200K). To isolate
    // the dPercent branch from dTokens (which would also release at +50K), use
    // a window where +50K < +5pt — i.e., a smaller window so 5pt is reached first.
    const def = { baseline: { tokens: 170000, maxTokens: 200000 } };
    // +4.5pt (179K): below 5pt AND below +50K tokens → no release
    assert.equal(shouldReleaseDeferral(def, items[0], { ok: true, tokens: 179000, maxTokens: 200000 }), false);
    // +5pt (180K): reaches 5pt → release (dPercent branch, dTokens = +10K < 50K)
    assert.equal(shouldReleaseDeferral(def, items[0], { ok: true, tokens: 180000, maxTokens: 200000 }), true);
  });

  it('shouldReleaseDeferral: window drift / context drop → release', () => {
    const def = { baseline: { tokens: 170000, maxTokens: 200000 } };
    // window changed (model switch) → release directly and rebaseline
    assert.equal(shouldReleaseDeferral(def, items[0], { ok: true, tokens: 170000, percent: 17, maxTokens: 1000000 }), true);
    // context drops below hysteresis (percent 50% < threshold 80-5=75) → release (the item should no longer remind; defer does not linger)
    assert.equal(shouldReleaseDeferral(def, items[0], { ok: true, tokens: 100000, percent: 50, maxTokens: 200000 }), true);
    // reading unavailable → no release
    assert.equal(shouldReleaseDeferral(def, items[0], { ok: false }), false);
    // no baseline → no release (per-turn only)
    assert.equal(shouldReleaseDeferral({ baseline: null }, items[0], { ok: true, tokens: 999999, maxTokens: 200000 }), false);
  });

  it('markInjected → cooldown 2 turns (released per-turn by advanceTurn)', () => {
    const s = createTriggerState();
    const pick = applyCheckpoint(s, items, reading(85));
    markInjected(s, pick.index); // releaseAtTurn = 0+2 = 2
    // turn 1: advanceTurn → completedTurns=1 < 2, still cooling, no show
    advanceTurn(s);
    assert.equal(applyCheckpoint(s, items, reading(85)), null);
    // turn 2: advanceTurn → completedTurns=2 ≥ 2, released; the first above-threshold reading after release shows
    advanceTurn(s);
    assert.equal(applyCheckpoint(s, items, reading(85))?.index, 0);
  });

  it('below hysteresis during cooldown → cleared early', () => {
    const s = createTriggerState();
    const pick = applyCheckpoint(s, items, reading(85));
    markInjected(s, pick.index);
    // cooling, but the reading drops below hysteresis → clears immediately; the next above-threshold reading shows
    assert.equal(applyCheckpoint(s, items, reading(70)), null);
    assert.equal(applyCheckpoint(s, items, reading(85))?.index, 0);
  });

  it('3 consecutive failures trip the circuit breaker; no more shows after circuitOpen', () => {
    const s = createTriggerState();
    assert.equal(markInjectFailed(s, 0), false);
    assert.equal(markInjectFailed(s, 0), false);
    assert.equal(markInjectFailed(s, 0), true); // circuit breaker
    assert.equal(applyCheckpoint(s, items, reading(95)), null);
  });

  it('markInjectBusy is not counted as a failure and does not enter cooldown', () => {
    const s = createTriggerState();
    s.pendingInject = { reqId: 'r', index: 0 };
    markInjectBusy(s);
    assert.equal(s.pendingInject, null);
    assert.equal(s.failures, 0);
    assert.equal(s.cooldown.size, 0);
  });

  it('markExternalCompaction cools down all items and clears deferrals and snoozes (rebaseline)', () => {
    const s = createTriggerState();
    // create one deferral and one snooze
    const pick = applyCheckpoint(s, items, reading(85));
    markDeferred(s, pick.index, reading(85), 'x');
    markIgnored(s, 1);
    assert.equal(s.deferral.size, 1);
    assert.equal(s.snoozed.size, 1);
    markExternalCompaction(s, items);
    assert.equal(s.deferral.size, 0, 'external compaction clears deferrals');
    assert.equal(s.snoozed.size, 0, 'external compaction clears snoozes');
    // no show during cooldown
    assert.equal(applyCheckpoint(s, items, reading(95)), null);
  });

  it('assignCompactionIds content addressing is stable: same content same id, independent of index/time', () => {
    const items = normalizeCompactionConfig([
      { title: 'a', script: 'sa', threshold: { mode: 'percent', value: 80 } },
      { title: 'b', script: 'sb', threshold: { mode: 'percent', value: 90 } },
    ]).filter((i) => i.builtinId == null);
    const r1 = assignCompactionIds(items);
    const r2 = assignCompactionIds(items);
    assert.deepEqual(r1.map(i => i.id), r2.map(i => i.id), 'same content hydrated twice yields the same ids');
    // after swapping order, ids still follow the content (not the index)
    const swapped = assignCompactionIds([items[1], items[0]]);
    assert.equal(swapped[0].id, r1[1].id, 'id follows content, not index');
    assert.equal(swapped[1].id, r1[0].id);
    // duplicate entries with the same content are deduped by sequence; ids still stable individually
    const dup = assignCompactionIds([items[0], items[0]]);
    assert.notEqual(dup[0].id, dup[1].id, 'two items with the same content get deduped ids');
  });

  it('resetTriggerState clears everything (including deferral/snoozed/completedTurns/justReleased)', () => {
    const s = createTriggerState();
    markInjectFailed(s, 0); markInjectFailed(s, 0); markInjectFailed(s, 0);
    markTurnStart(s);
    advanceTurn(s); advanceTurn(s);
    markDeferred(s, 0, reading(85), 'x');
    markIgnored(s, 1);
    resetTriggerState(s, { viewKey: 'p|i|null', configSignature: '[]' });
    assert.equal(s.circuitOpen, false);
    assert.equal(s.failures, 0);
    assert.equal(s.turnSeq, 0);
    assert.equal(s.completedTurns, 0);
    assert.equal(s.deferral.size, 0);
    assert.equal(s.snoozed.size, 0);
    assert.equal(s.justReleasedDeferral.size, 0);
    assert.equal(applyCheckpoint(s, items, reading(95))?.index, 0); // shows on the first reading after reset
  });

  it('markInjectRolledBack revokes cooldown + clears pending/lastAcked, not counted as failure (SDK not-delivered rollback)', () => {
    const s = createTriggerState();
    const pick = applyCheckpoint(s, items, reading(85));
    markInjected(s, pick.index);              // optimistic ok: cooldown + lastAcked
    s.lastAckedReqId = 'r1'; s.lastAckedIndex = pick.index;
    assert.equal(s.cooldown.has(pick.index), true, 'cooldown in place after ok');
    markInjectRolledBack(s, pick.index);      // not-delivered rollback
    assert.equal(s.cooldown.has(pick.index), false, 'revokes that cooldown');
    assert.equal(s.lastAckedReqId, null);
    assert.equal(s.lastAckedIndex, null);
    assert.equal(s.failures, 0, 'rollback is not counted as a failure (not a compaction execution failure)');
  });

  it('markInjectRolledBack without index only clears pending/lastAcked (leaves cooldown)', () => {
    const s = createTriggerState();
    markInjected(s, 0);
    s.pendingInject = { reqId: 'r', index: 0 };
    markInjectRolledBack(s, undefined);
    assert.equal(s.pendingInject, null);
    assert.equal(s.cooldown.has(0), true, 'no index → cooldown not revoked');
  });

  it('markInjectRolledBack with clearPending:false (late rollback) leaves the current pendingInject untouched', () => {
    const s = createTriggerState();
    markInjected(s, 0);
    s.lastAckedReqId = 'r1'; s.lastAckedIndex = 0;
    // the first item already optimistically ok'd, then the user/countdown fires a second one → the current pending is the new injection
    s.pendingInject = { reqId: 'r2', index: 1 };
    // the first item's late not-delivered arrives: revoke only its cooldown/ack markers, never clear the new pending (review P2-1)
    markInjectRolledBack(s, 0, { clearPending: false });
    assert.deepEqual(s.pendingInject, { reqId: 'r2', index: 1 }, 'new pending ownership is not wrongly deleted by the late rollback');
    assert.equal(s.cooldown.has(0), false, 'old item cooldown still revoked');
    assert.equal(s.lastAckedReqId, null);
  });

  it('normalizeUsageReading freshness fingerprint key: same source/value/ts equal; different ts/source different', () => {
    const a = normalizeUsageReading({ sdkUsage: { totalTokens: 150000, maxTokens: 200000 }, sdkTs: 100 });
    const a2 = normalizeUsageReading({ sdkUsage: { totalTokens: 150000, maxTokens: 200000 }, sdkTs: 100 });
    const b = normalizeUsageReading({ sdkUsage: { totalTokens: 150000, maxTokens: 200000 }, sdkTs: 200 });
    const c = normalizeUsageReading({ contextWindow: { context_window_size: 200000, total_input_tokens: 150000, total_output_tokens: 0 } });
    assert.equal(a.ok && a2.ok && b.ok && c.ok, true);
    assert.equal(a.key, a2.key, 'same reading same fingerprint (not double counted)');
    assert.notEqual(a.key, b.key, 'different ts → different fingerprint (new reading)');
    assert.notEqual(a.key, c.key, 'different source → different fingerprint');
  });
});
