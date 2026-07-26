// Pure helpers for BarChart — extracted so the fold + tooltip logic (the only
// pieces with real correctness weight) are unit-testable, not buried in JSX.
// BarChart.jsx imports these; the rest of the chart is SVG plumbing.

/**
 * Fold a long-tail bar list into a single "…" bar when `maxBars` is set and the
 * data exceeds it.
 *
 * Grouped vs single behave differently:
 *  - single: sum tail `value`s into one `{ value, values: [sum] }` row.
 *  - grouped: sum tail `values` *per series index* into `values: [sum0, sum1, …]`,
 *    preserving the series count. Summing across series (upstream% + downstream%)
 *    would be meaningless for percentage data and would also drop a bar from a
 *    group sized off `rows[0].values.length` — so the folded row must keep the
 *    same number of values as the head rows.
 *
 * @param {Array} data input rows ({ label, value } | { label, values: number[] })
 * @param {{ maxBars?: number, grouped?: boolean }} opts
 * @returns {Array} rows, possibly with a trailing "…" fold row
 */
export function foldBars(data, { maxBars, grouped = false } = {}) {
  if (!maxBars || !Array.isArray(data) || data.length <= maxBars) return data;
  const head = data.slice(0, maxBars);
  const tail = data.slice(maxBars);

  if (grouped) {
    // Per-series sum. Establish series count from the head (rows[0]); pad missing
    // values with 0 so every tail row contributes to every series index.
    const seriesCount = (head[0]?.values?.length || 1);
    const sums = new Array(seriesCount).fill(0);
    for (const d of tail) {
      const vals = d.values || [];
      for (let i = 0; i < seriesCount; i++) sums[i] += (vals[i] || 0);
    }
    return [...head, { label: '…', value: sums[0], values: sums }];
  }

  const otherCount = tail.reduce((s, d) => s + (d.value || 0), 0);
  return [...head, { label: '…', value: otherCount, values: [otherCount] }];
}

/**
 * Tooltip text for a grouped bar. Disambiguates the series — without it, two bars
 * in one group (e.g. upstream vs downstream availability) both read "opus: 50%".
 *
 * - With a legend entry for this series index: "label (seriesName): value"
 * - Otherwise (no legend, or no name at this index): "label: value". No synthetic
 *   "series N" fallback: it would be an untranslated user-visible string, and the
 *   group label plus bar order already identify the series.
 *
 * @param {string} label the group (row) label, e.g. the model name
 * @param {number} value the value of this particular bar
 * @param {number} bi bar/series index within the group
 * @param {string[]|undefined} legend optional series labels
 * @param {(n:number)=>string} valueFormatter
 * @returns {string}
 */
export function groupedBarTitle(label, value, bi, legend, valueFormatter) {
  const formatted = valueFormatter(value);
  const name = Array.isArray(legend) ? legend[bi] : undefined;
  if (name) return `${label} (${name}): ${formatted}`;
  return `${label}: ${formatted}`;
}

/**
 * Tooltip text for a single-series bar.
 * @param {string} label
 * @param {number} value
 * @param {(n:number)=>string} valueFormatter
 * @returns {string}
 */
export function singleBarTitle(label, value, valueFormatter) {
  return `${label}: ${valueFormatter(value)}`;
}
