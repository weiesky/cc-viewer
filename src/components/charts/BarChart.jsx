import React, { useEffect, useRef, useState } from 'react';
import styles from './BarChart.module.css';
import { foldBars, groupedBarTitle, singleBarTitle } from './barChartHelpers.js';

// Default colors cycle for grouped bars. These are IDENTITY colors (which
// series is this bar), not status colors — deliberately distinct from
// --color-success/-warning/-error so a chart series never gets misread as
// "good/bad" (e.g. upstream-vs-downstream availability bars). Maps to the
// app's REAL tokens (global.css :root) so bars theme correctly in light AND
// dark mode; hex fallbacks match the dark-theme values (the default root)
// and only apply if the tokens are somehow absent.
const DEFAULT_COLORS = [
  'var(--color-primary, #1668dc)',
  'var(--color-chart-series-2, #cf6c48)',
];

// Pure-SVG vertical bar chart, single or grouped series.
// No external chart lib — keeps cc-viewer dependency-free (CLAUDE.md).
// `memo`'d: the chart is a pure function of its props, so it skips re-render when
// the parent (ProxyStatsDashboard) re-renders on a poll tick with unchanged data.
function BarChart({
  data = [],
  height = 160,
  grouped = false,
  valueFormatter = (n) => String(n),
  maxBars,
  legend,     // optional series labels for grouped bars: ['Upstream', 'Downstream']
  ariaLabel,  // screen-reader summary for the chart (role="img" on the svg)
}) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    const update = () => setWidth(el.clientWidth || 0);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { try { ro.disconnect(); } catch { /* benign */ } };
  }, []);

  // Coerce to array defensively — a non-array `data` (e.g. a `null` from a bad
  // API shape overriding the `= []` default) must not crash flatMap/reduce below.
  const arr = Array.isArray(data) ? data : [];

  // Fold long-tail data into a single "other" (…) bar when maxBars is set.
  // Delegated to foldBars so the fold logic (grouped must sum per-series, not
  // across series — summing upstream% + downstream% is meaningless and drops a
  // bar from a group sized off rows[0].values.length) is unit-tested.
  const rows = foldBars(arr, { maxBars, grouped });

  if (!rows || rows.length === 0 || width === 0) {
    return <div ref={wrapRef} className={styles.wrap} style={{ height }} />;
  }

  // Series legend for grouped bars — color alone must not carry the meaning
  // (WCAG color-not-only); swatch colors follow the same per-series resolution
  // as the bars themselves.
  const legendEl = (grouped && Array.isArray(legend) && legend.length > 0) ? (
    <div className={styles.legend} aria-hidden="true">
      {legend.map((label, i) => (
        <span key={i} className={styles.legendItem}>
          <span className={styles.legendSwatch}
            style={{ background: DEFAULT_COLORS[i % DEFAULT_COLORS.length] }} />
          {label}
        </span>
      ))}
    </div>
  ) : null;

  const pad = 28;      // left/bottom padding for labels
  const labelPad = 16; // extra bottom room for the x-axis labels
  const innerW = Math.max(0, width - pad);
  const innerH = Math.max(0, height - pad - labelPad);

  // Max value across all bars (handle grouped multi-value). Use a reduce instead
  // of spreading into Math.max — a large rows array would otherwise risk the V8
  // spread-argument limit (RangeError).
  const maxVal = rows.reduce((m, d) => {
    const vals = grouped ? (d.values || [0]) : [d.value || 0];
    for (const v of vals) if (v > m) m = v;
    return m;
  }, 1);

  // Vertical layout (bars grow upward)
  const groupW = innerW / rows.length;
  const barW = grouped
    ? Math.max(2, (groupW * 0.6) / Math.max(1, rows[0]?.values?.length || 1))
    : Math.max(2, groupW * 0.5);
  const baseline = pad + innerH; // y of baseline
  return (
    <div ref={wrapRef} className={styles.wrap} style={{ height }}>
      {legendEl}
      <svg className={styles.svg} height={height} width={width} role="img" aria-label={ariaLabel}>
        {/* 3 gridlines */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} className={styles.gridLine}
            x1={pad} x2={width} y1={pad + innerH * (1 - f)} y2={pad + innerH * (1 - f)} />
        ))}
        <line className={styles.axisLine} x1={pad} x2={width} y1={baseline} y2={baseline} />
        {rows.map((d, gi) => {
          const gx = pad + gi * groupW + (groupW - (grouped ? (rows[0]?.values?.length || 1) * barW : barW)) / 2;
          const vals = grouped ? (d.values || [0]) : [d.value || 0];
          return (
            <g key={gi}>
              {vals.map((v, bi) => {
                const h = Math.max(0, (v / maxVal) * innerH);
                const x = gx + bi * barW;
                const y = baseline - h;
                const color = grouped
                  ? DEFAULT_COLORS[bi % DEFAULT_COLORS.length]
                  : DEFAULT_COLORS[0];
                return (
                  <g key={bi}>
                    <rect className={styles.bar} x={x} y={y} width={Math.max(1, barW - 1)} height={h}
                      fill={color} rx={1}>
                      <title>{grouped
                        ? groupedBarTitle(d.label, v, bi, legend, valueFormatter)
                        : singleBarTitle(d.label, v, valueFormatter)}</title>
                    </rect>
                    {/* Direct value label on single-series bars wide enough to
                        hold it — saves a hover for the common reading path. */}
                    {!grouped && barW >= 18 && (
                      <text className={styles.vValue} x={x + barW / 2} y={Math.max(8, y - 4)}
                        textAnchor="middle">{valueFormatter(v)}</text>
                    )}
                  </g>
                );
              })}
              <text className={styles.vLabel} x={pad + gi * groupW + groupW / 2} y={height - 4}
                textAnchor="middle">{String(d.label).slice(0, 8)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default React.memo(BarChart);
