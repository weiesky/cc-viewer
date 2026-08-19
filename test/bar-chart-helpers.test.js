/**
 * src/components/charts/BarChart — pure helpers extracted for testability.
 *
 * The fold (maxBars long-tail collapse) and the tooltip title are the two pieces
 * of BarChart logic with real correctness weight; the rest is SVG plumbing.
 * Extracting them lets a backend-style unit test pin the behavior the PR ships
 * (grouped-bar tooltip disambiguates series; maxBars fold keeps the series
 * structure intact instead of summing percentages across series).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { foldBars, groupedBarTitle, singleBarTitle } from '../apps/web/src/components/charts/barChartHelpers.js';

describe('barChartHelpers foldBars', () => {
  it('single-series: folds tail into one "…" bar summing values', () => {
    const data = Array.from({ length: 13 }, (_, i) => ({ label: `m${i}`, value: i }));
    const rows = foldBars(data, { maxBars: 10 });
    assert.equal(rows.length, 11);
    assert.equal(rows[10].label, '…');
    // tail m10..m12 = 10+11+12 = 33
    assert.equal(rows[10].value, 33);
    assert.deepEqual(rows[10].values, [33]);
  });

  it('no maxBars → returns data unchanged', () => {
    const data = [{ label: 'a', value: 1 }];
    assert.equal(foldBars(data, {}), data);
  });

  it('at or under maxBars → no fold', () => {
    const data = [{ label: 'a', value: 1 }, { label: 'b', value: 2 }];
    const rows = foldBars(data, { maxBars: 10 });
    assert.equal(rows.length, 2);
    assert.equal(rows[1].label, 'b');
  });

  it('grouped: folds tail per-series (NOT summing across series)', () => {
    // 12 models, each with [upstream%, downstream%]. maxBars=10 → fold last 2.
    const data = Array.from({ length: 12 }, (_, i) => ({
      label: `m${i}`,
      values: [i, i + 100], // upstream=i, downstream=i+100
    }));
    const rows = foldBars(data, { maxBars: 10, grouped: true });
    assert.equal(rows.length, 11);
    assert.equal(rows[10].label, '…');
    // tail m10,m11: upstream 10+11=21, downstream 110+111=221 — kept separate
    assert.deepEqual(rows[10].values, [21, 221]);
    // The folded row must have the SAME series count as the head rows, so the
    // chart's per-group bar width (sized off rows[0].values.length) stays valid.
    assert.equal(rows[10].values.length, rows[0].values.length);
  });

  it('grouped fold preserves series count when tail rows have uneven values', () => {
    const data = [
      { label: 'a', values: [1, 2] },
      { label: 'b', values: [3, 4] },
      { label: 'c', values: [5, 6] },
    ];
    const rows = foldBars(data, { maxBars: 1, grouped: true });
    assert.equal(rows.length, 2);
    // folded row sums b+c per series: [3+5, 4+6] = [8, 10]
    assert.deepEqual(rows[1].values, [8, 10]);
    assert.equal(rows[1].values.length, 2);
  });
});

describe('barChartHelpers groupedBarTitle', () => {
  const fmt = (n) => `${n}%`;
  it('includes the series name when legend is provided', () => {
    const legend = ['Upstream', 'Downstream'];
    assert.equal(groupedBarTitle('opus', 50, 0, legend, fmt), 'opus (Upstream): 50%');
    assert.equal(groupedBarTitle('opus', 100, 1, legend, fmt), 'opus (Downstream): 100%');
  });

  it('omits the parenthetical when the legend has no entry for that index', () => {
    // legend shorter than series count → no name for that index. No synthetic
    // "series N" text, which would be an untranslated user-visible string.
    assert.equal(groupedBarTitle('opus', 7, 2, ['Upstream'], fmt), 'opus: 7%');
  });

  it('omits the parenthetical entirely when there is no legend', () => {
    assert.equal(groupedBarTitle('opus', 50, 0, undefined, fmt), 'opus: 50%');
  });
});

describe('barChartHelpers singleBarTitle', () => {
  it('label: value', () => {
    assert.equal(singleBarTitle('503', 12, (n) => String(n)), '503: 12');
  });
});
