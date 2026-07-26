import React from 'react';
import { Tag } from 'antd';
import { t } from '../../i18n';

// Format a millisecond duration into a human-readable string.
// `ms` is a positive number on the happy path; 0/NaN/undefined/null (e.g. the
// `0` latency fields emptyStats() emits when there are no records) render as '-'.
export function fmtMs(ms) {
  if (!(ms > 0)) return '-';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

// Status code → antd Tag color
export function statusColor(status) {
  if (status === 0) return 'default';
  if (status < 400) return 'green';
  if (status < 500) return 'orange';
  return 'red';
}

// Availability percentage → semantic CSS color. Uses the app's REAL tokens
// (global.css :root) so it themes in both light and dark mode; hex fallbacks
// only apply when the tokens are absent.
// Aligned with llm-retry-proxy's availColor thresholds (>=95 green / >=80 amber / else red).
export function availColor(pct) {
  if (pct >= 95) return 'var(--color-success, #22c55e)';
  if (pct >= 80) return 'var(--color-warning, #f59e0b)';
  return 'var(--color-error, #ef4444)';
}

// Render a "dominant fail code × count" Tag for a byModel/byPath/byProfile bucket.
// Returns null when the bucket had no retry codes (dominantFailStatus === null).
export function dominantFailCell(bucket) {
  if (!bucket || bucket.dominantFailStatus == null) return null;
  return (
    <Tag color={statusColor(bucket.dominantFailStatus)}>
      {bucket.dominantFailStatus} × {bucket.dominantFailCount}
    </Tag>
  );
}

// Resolve the i18n label for a retry-burden bucket key
export function burdenBucketLabel(key) {
  return t(`ui.proxyStats.retryBurdenBuckets.${key}`);
}
