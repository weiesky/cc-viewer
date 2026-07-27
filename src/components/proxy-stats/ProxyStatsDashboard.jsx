import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, Statistic, Table, Tag, Button, Switch, Spin, Empty, Space } from 'antd';
import { ReloadOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { t } from '../../i18n';
import { apiUrl } from '../../utils/apiUrl';
import { reportSwallowed } from '../../utils/errorReport';
import BarChart from '../charts/BarChart';
import { fmtMs, statusColor, availColor, dominantFailCell, burdenBucketLabel } from './RetryStatsHelpers';
import styles from './ProxyStatsDashboard.module.css';

const AUTO_REFRESH_MS = 15000;

// Stable formatter identity so the memoized BarChart can short-circuit when its
// other props are unchanged (an inline arrow would force a re-render every poll).
const fmtPercent = (n) => `${n}%`;

export default function ProxyStatsDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchData = useCallback(() => {
    setLoading(true);
    fetch(apiUrl('/api/proxy-stats'))
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then(d => { setData(d.proxyStats); setLoading(false); })
      .catch((err) => {
        // Keep the last rendered data — a transient poll failure must not collapse the panel.
        reportSwallowed('proxyStats.fetch', err);
        setLoading(false);
      });
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!autoRefresh) return;
    // Hold the id in a local so the cleanup closes over this effect's own timer
    // rather than whatever a later run left on a ref.
    const id = setInterval(fetchData, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [autoRefresh, fetchData]);

  // Derived views of `data`. Memoized so the memoized BarChart (and antd Tables)
  // get stable prop identities across the 15s poll when data is unchanged.
  // Declared before the early returns below so hook order is stable.
  // No pre-slice here: BarChart's `maxBars` does the truncation so the long tail
  // is folded into a visible "…" bar rather than silently dropped.
  const byModelBars = useMemo(
    () => (data?.byModel || []).map(m => ({
      label: m.model,
      values: [m.upstreamAvailabilityPct, m.availabilityPct],
    })),
    [data],
  );
  const retryDistBars = useMemo(
    () => (data?.retryDistribution || []).map(d => ({ label: String(d.retries), value: d.count })),
    [data],
  );
  const retryBurdenBars = useMemo(
    () => (data?.retryBurden || []).map(b => ({ label: burdenBucketLabel(b.key), value: b.count })),
    [data],
  );
  // Show only "interesting" requests: a failure (4xx/5xx), any retry, or a
  // network-level failure (final_status === 0: no response / DNS / conn refused).
  const recentRecords = useMemo(
    () => (data?.recentRecords || []).filter((r) => {
      const status = Number(r.final_status);
      return status === 0 || status >= 400 || (Number(r.retries) || 0) > 0;
    }),
    [data],
  );

  if (loading && !data) {
    return <div className={`${styles.embedded} ${styles.centerState}`}><Spin size="large" /></div>;
  }

  if (!data || !data.summary || data.summary.totalRequests === 0) {
    return (
      <div className={styles.embedded}>
        <DashboardHeader onRefresh={fetchData} autoRefresh={autoRefresh} setAutoRefresh={setAutoRefresh} />
        <div className={styles.centerState}>
          <Empty description={t('ui.proxyStats.noData')} />
        </div>
      </div>
    );
  }

  const s = data.summary;
  const rescued = Math.max(0, s.totalSucceeded - s.totalFirstOk);

  return (
    <div className={styles.embedded}>
      <DashboardHeader onRefresh={fetchData} autoRefresh={autoRefresh} setAutoRefresh={setAutoRefresh} />

      {/* §Range Overview */}
      <div className={styles.cardRow}>
        <Card className={styles.statCard}><Statistic title={t('ui.proxyStats.totalRequests')} value={s.totalRequests} /></Card>
        <Card className={styles.statCard}>
          <Statistic title={t('ui.proxyStats.totalRetries')} value={s.totalRetries}
            suffix={s.totalRequests ? `(${(s.totalRetries / s.totalRequests).toFixed(1)}/req)` : ''} />
        </Card>
        <Card className={styles.statCard} style={{ '--stat-accent': availColor(s.upstreamAvailabilityPct) }}>
          <Statistic title={t('ui.proxyStats.upstreamAvailability')} value={s.upstreamAvailabilityPct} suffix="%"
            valueStyle={{ color: availColor(s.upstreamAvailabilityPct) }} />
        </Card>
        <Card className={styles.statCard} style={{ '--stat-accent': availColor(s.downstreamAvailabilityPct) }}>
          <Statistic title={t('ui.proxyStats.downstreamAvailability')} value={s.downstreamAvailabilityPct} suffix="%"
            valueStyle={{ color: availColor(s.downstreamAvailabilityPct) }} />
          {rescued > 0 && (
            <span className={styles.rescuedBadge}>{t('ui.proxyStats.rescuedByRetry', { count: rescued })}</span>
          )}
        </Card>
        <Card className={styles.statCard} style={{ '--stat-accent': 'var(--color-error, #ef4444)' }}><Statistic title={t('ui.proxyStats.failedRequests')} value={s.totalFailed} valueStyle={{ color: 'var(--color-error, #ef4444)' }} /></Card>
        <Card className={styles.statCard}><Statistic title={t('ui.proxyStats.p95Duration')} value={fmtMs(s.p95Ms)} /></Card>
      </div>

      {/* §Availability */}
      <Card title={t('ui.proxyStats.availabilityAnalysis')} className={styles.section}>
        <div className={styles.streakRow}>
          <Space>
            <span>{t('ui.proxyStats.currentStreak')}:</span>
            <Tag icon={s.currentStreakType === 'success' ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
              color={s.currentStreakType === 'success' ? 'green' : 'red'}>
              {s.currentStreakType === 'success' ? t('ui.proxyStats.success') : t('ui.proxyStats.failure')} × {s.currentStreakCount}
            </Tag>
          </Space>
          <Space>
            <span>{t('ui.proxyStats.worstFailureStreak')}:</span>
            <Tag color="red">{s.worstFailureStreak}</Tag>
          </Space>
        </div>
        {/* Dual availability grouped bars: upstream vs downstream per model */}
        <div className={styles.chartWrap}>
          <div className={styles.chartTitle}>{t('ui.proxyStats.upstreamVsDownstream')}</div>
          <BarChart
            height={180}
            grouped
            legend={[t('ui.proxyStats.upstreamAvailability'), t('ui.proxyStats.downstreamAvailability')]}
            ariaLabel={t('ui.proxyStats.upstreamVsDownstream')}
            data={byModelBars}
            valueFormatter={fmtPercent}
            maxBars={10}
          />
        </div>
        <Table
          dataSource={data.byModel || []}
          rowKey="model" size="small" pagination={false} className={styles.section}
          columns={[
            { title: t('ui.proxyStats.byModel'), dataIndex: 'model', key: 'model' },
            { title: t('ui.proxyStats.totalRequests'), dataIndex: 'requests', key: 'requests' },
            { title: t('ui.proxyStats.retries'), dataIndex: 'retries', key: 'retries' },
            { title: t('ui.proxyStats.upstreamAvailability'), dataIndex: 'upstreamAvailabilityPct', key: 'upAvail', render: v => `${v}%` },
            { title: t('ui.proxyStats.downstreamAvailability'), dataIndex: 'availabilityPct', key: 'dsAvail', render: v => `${v}%` },
            { title: t('ui.proxyStats.dominantFail'), key: 'domFail', render: (_, r) => dominantFailCell(r) || '-' },
            { title: t('ui.proxyStats.p95Duration'), dataIndex: 'p95Ms', key: 'p95', render: fmtMs },
          ]}
        />
      </Card>

      {/* §Retry Analysis */}
      <Card title={t('ui.proxyStats.retryDistribution')} className={styles.section}>
        <div className={styles.chartWrap}>
          <BarChart
            height={160}
            ariaLabel={t('ui.proxyStats.retryDistribution')}
            data={retryDistBars}
            maxBars={15}
          />
        </div>
        <div className={styles.chartWrap}>
          <div className={styles.chartTitle}>{t('ui.proxyStats.retryBurden')}</div>
          <BarChart
            height={160}
            ariaLabel={t('ui.proxyStats.retryBurden')}
            data={retryBurdenBars}
          />
        </div>
        <div className={styles.codeTags}>
          <span>{t('ui.proxyStats.retryCodes')}:</span>
          <Space wrap>
            {(data.retryCodes || []).map(c => (
              <Tag key={c.code} color={statusColor(c.code)}>{c.code} × {c.count}</Tag>
            ))}
          </Space>
        </div>
      </Card>

      {/* §Duration */}
      <Card title={t('ui.proxyStats.durationAnalysis')} className={styles.section}>
        <div className={styles.cardRow}>
          <Card className={styles.statCard}><Statistic title={t('ui.proxyStats.p50Duration')} value={fmtMs(s.p50Ms)} /></Card>
          <Card className={styles.statCard}><Statistic title={t('ui.proxyStats.p95Duration')} value={fmtMs(s.p95Ms)} /></Card>
          <Card className={styles.statCard}><Statistic title={t('ui.proxyStats.p99Duration')} value={fmtMs(s.p99Ms)} /></Card>
          <Card className={styles.statCard}><Statistic title={t('ui.proxyStats.maxDuration')} value={fmtMs(s.maxMs)} /></Card>
          <Card className={styles.statCard}><Statistic title={t('ui.proxyStats.avgDuration')} value={fmtMs(s.avgMs)} /></Card>
        </div>
        <div className={styles.topRow}>
          <DurationRecordTable title={t('ui.proxyStats.slowest')} record={data.slowest} />
          <DurationRecordTable title={t('ui.proxyStats.fastest')} record={data.fastest} />
        </div>
      </Card>

      {/* §By Dimension */}
      {data.byPath && data.byPath.length > 0 && (
        <Card title={t('ui.proxyStats.byPath')} className={styles.section}>
          <Table dataSource={data.byPath} rowKey="path" size="small" pagination={false}
            columns={[
              { title: t('ui.proxyStats.colPath'), dataIndex: 'path', key: 'path', ellipsis: true },
              { title: t('ui.proxyStats.totalRequests'), dataIndex: 'requests', key: 'requests' },
              { title: t('ui.proxyStats.retries'), dataIndex: 'retries', key: 'retries' },
              { title: t('ui.proxyStats.downstreamAvailability'), dataIndex: 'availabilityPct', key: 'avail', render: v => `${v}%` },
              { title: t('ui.proxyStats.dominantFail'), key: 'domFail', render: (_, r) => dominantFailCell(r) || '-' },
            ]} />
        </Card>
      )}
      {data.byProfile && data.byProfile.length > 0 && (
        <Card title={t('ui.proxyStats.byProfile')} className={styles.section}>
          <Table dataSource={data.byProfile} rowKey="profile_id" size="small" pagination={false}
            columns={[
              { title: t('ui.proxyStats.byProfile'), dataIndex: 'profile_name', key: 'profile_name' },
              { title: t('ui.proxyStats.totalRequests'), dataIndex: 'requests', key: 'requests' },
              { title: t('ui.proxyStats.retries'), dataIndex: 'retries', key: 'retries' },
              { title: t('ui.proxyStats.upstreamAvailability'), dataIndex: 'upstreamAvailabilityPct', key: 'upAvail', render: v => `${v}%` },
              { title: t('ui.proxyStats.downstreamAvailability'), dataIndex: 'availabilityPct', key: 'dsAvail', render: v => `${v}%` },
              { title: t('ui.proxyStats.dominantFail'), key: 'domFail', render: (_, r) => dominantFailCell(r) || '-' },
              { title: t('ui.proxyStats.p95Duration'), dataIndex: 'p95Ms', key: 'p95', render: fmtMs },
            ]} />
        </Card>
      )}

      {/* §Recent Errors */}
      <Card title={t('ui.proxyStats.recentErrors')} className={styles.section}>
        <Table dataSource={recentRecords} rowKey="ts" size="small" pagination={{ pageSize: 20, size: 'small' }} scroll={{ x: 'max-content' }}
          columns={[
            { title: t('ui.proxyStats.colTime'), dataIndex: 'ts', key: 'ts', width: 180, ellipsis: true, render: v => v ? new Date(v).toLocaleString() : '-' },
            { title: t('ui.proxyStats.colMethod'), dataIndex: 'method', key: 'method', width: 70 },
            { title: t('ui.proxyStats.colPath'), dataIndex: 'path', key: 'path', ellipsis: true },
            { title: t('ui.proxyStats.colModel'), dataIndex: 'model', key: 'model', ellipsis: true },
            { title: t('ui.proxyStats.colStatus'), dataIndex: 'final_status', key: 'status', width: 70, render: v => <Tag color={statusColor(v)}>{v || '-'}</Tag> },
            { title: t('ui.proxyStats.attempts'), dataIndex: 'attempts', key: 'attempts', width: 80 },
            { title: t('ui.proxyStats.retries'), dataIndex: 'retries', key: 'retries', width: 80 },
            { title: t('ui.proxyStats.colDuration'), dataIndex: 'duration_ms', key: 'dur', width: 100, render: fmtMs },
            { title: t('ui.proxyStats.retryCodes'), dataIndex: 'retry_codes', key: 'rc', width: 120, render: v => v && v.length ? v.map(c => <Tag key={c} color={statusColor(c)}>{c}</Tag>) : '-' },
          ]} />
      </Card>
    </div>
  );
}

// Slowest/fastest single-record table — the two share identical columns, only the
// title and source record differ. Extracted so the column shape lives in one place.
function DurationRecordTable({ title, record }) {
  return (
    <Table
      title={() => title}
      dataSource={record ? [record] : []}
      rowKey="ts" size="small" pagination={false}
      columns={[
        { title: t('ui.proxyStats.colPath'), dataIndex: 'path', key: 'path', ellipsis: true },
        { title: t('ui.proxyStats.colModel'), dataIndex: 'model', key: 'model', ellipsis: true },
        { title: t('ui.proxyStats.attempts'), dataIndex: 'attempts', key: 'attempts' },
        { title: t('ui.proxyStats.colDuration'), dataIndex: 'duration_ms', key: 'dur', render: fmtMs },
      ]}
    />
  );
}

// Stats-tab controls row. The panel title lives in the ProxyStatsModal toolbar,
// so this row carries only the refresh affordances and right-aligns them.
function DashboardHeader({ onRefresh, autoRefresh, setAutoRefresh }) {
  return (
    <div className={styles.header}>
      <Space>
        <span>{t('ui.proxyStats.autoRefresh')}</span>
        <Switch checked={autoRefresh} onChange={setAutoRefresh} size="small" aria-label={t('ui.proxyStats.autoRefresh')} />
        <Button size="small" icon={<ReloadOutlined />} onClick={onRefresh}>{t('ui.proxyStats.refresh')}</Button>
      </Space>
    </div>
  );
}
