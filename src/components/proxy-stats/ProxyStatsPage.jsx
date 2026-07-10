import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Statistic, Table, Tag, Button, Switch, Spin, Empty, Tooltip, Space } from 'antd';
import { ReloadOutlined, ArrowLeftOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { t } from '../../i18n';
import { apiUrl } from '../../utils/apiUrl';
import styles from './ProxyStatsPage.module.css';

const AUTO_REFRESH_MS = 15000;

// Format a millisecond duration into a human-readable string
function fmtMs(ms) {
  if (!ms || ms <= 0) return '-';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

// Status code → Tag color
function statusColor(status) {
  if (status === 0) return 'default';
  if (status < 400) return 'green';
  if (status < 500) return 'orange';
  return 'red';
}

export default function ProxyStatsPage({ onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const timerRef = useRef(null);

  const fetchData = useCallback(() => {
    setLoading(true);
    fetch(apiUrl('/api/proxy-stats'))
      .then(res => res.ok ? res.json() : { proxyStats: null })
      .then(d => { setData(d.proxyStats); setLoading(false); })
      .catch(() => { setData(null); setLoading(false); });
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (autoRefresh) {
      timerRef.current = setInterval(fetchData, AUTO_REFRESH_MS);
      return () => clearInterval(timerRef.current);
    }
  }, [autoRefresh, fetchData]);

  const goBack = () => {
    // Prefer the onBack passed from the parent (App.jsx in-app routing: setState switches back to the dashboard, no full-page reload);
    // fall back to clearing the URL params only when onBack is not provided (e.g. the standalone ?view=proxy-stats route entry).
    if (typeof onBack === 'function') onBack();
    else window.location.search = '';
  };

  if (loading && !data) {
    return (
      <div className={styles.center}>
        <Spin size="large" />
      </div>
    );
  }

  if (!data || !data.summary || data.summary.totalRequests === 0) {
    return (
      <div className={styles.page}>
        <Header onBack={goBack} onRefresh={fetchData} autoRefresh={autoRefresh} setAutoRefresh={setAutoRefresh} />
        <div className={styles.center}>
          <Empty description={t('ui.proxyStats.noData')} />
        </div>
      </div>
    );
  }

  const s = data.summary;

  return (
    <div className={styles.page}>
      <Header onBack={goBack} onRefresh={fetchData} autoRefresh={autoRefresh} setAutoRefresh={setAutoRefresh} />

      {/* Overview cards */}
      <div className={styles.cardRow}>
        <Card className={styles.statCard}>
          <Statistic title={t('ui.proxyStats.totalRequests')} value={s.totalRequests} />
        </Card>
        <Card className={styles.statCard}>
          <Statistic title={t('ui.proxyStats.totalRetries')} value={s.totalRetries} />
        </Card>
        <Card className={styles.statCard}>
          <Statistic title={t('ui.proxyStats.upstreamAvailability')} value={s.upstreamAvailabilityPct} suffix="%" />
        </Card>
        <Card className={styles.statCard}>
          <Statistic title={t('ui.proxyStats.downstreamAvailability')} value={s.downstreamAvailabilityPct} suffix="%" />
        </Card>
        <Card className={styles.statCard}>
          <Statistic title={t('ui.proxyStats.failedRequests')} value={s.totalFailed} valueStyle={{ color: '#cf1322' }} />
        </Card>
        <Card className={styles.statCard}>
          <Statistic title={t('ui.proxyStats.p95Duration')} value={fmtMs(s.p95Ms)} />
        </Card>
      </div>

      {/* Availability analysis */}
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
        <Table
          dataSource={data.byModel || []}
          rowKey="model"
          size="small"
          pagination={false}
          className={styles.table}
          columns={[
            { title: t('ui.proxyStats.byModel'), dataIndex: 'model', key: 'model' },
            { title: t('ui.proxyStats.totalRequests'), dataIndex: 'requests', key: 'requests' },
            { title: t('ui.proxyStats.retries'), dataIndex: 'retries', key: 'retries' },
            { title: t('ui.proxyStats.upstreamAvailability'), dataIndex: 'upstreamAvailabilityPct', key: 'upAvail', render: v => `${v}%` },
            { title: t('ui.proxyStats.downstreamAvailability'), dataIndex: 'availabilityPct', key: 'dsAvail', render: v => `${v}%` },
            { title: t('ui.proxyStats.p95Duration'), dataIndex: 'p95Ms', key: 'p95', render: fmtMs },
          ]}
        />
      </Card>

      {/* Retry analysis */}
      <Card title={t('ui.proxyStats.retryDistribution')} className={styles.section}>
        <Table
          dataSource={data.retryDistribution || []}
          rowKey="retries"
          size="small"
          pagination={false}
          className={styles.table}
          columns={[
            { title: t('ui.proxyStats.retries'), dataIndex: 'retries', key: 'retries' },
            { title: t('ui.proxyStats.totalRequests'), dataIndex: 'count', key: 'count' },
          ]}
        />
        <div className={styles.codeTags}>
          <span>{t('ui.proxyStats.retryCodes')}:</span>
          <Space wrap>
            {(data.retryCodes || []).map(c => (
              <Tag key={c.code} color={statusColor(c.code)}>{c.code} × {c.count}</Tag>
            ))}
          </Space>
        </div>
      </Card>

      {/* Latency analysis */}
      <Card title={t('ui.proxyStats.durationAnalysis')} className={styles.section}>
        <div className={styles.cardRow}>
          <Card className={styles.statCard}><Statistic title={t('ui.proxyStats.p50Duration')} value={fmtMs(s.p50Ms)} /></Card>
          <Card className={styles.statCard}><Statistic title={t('ui.proxyStats.p95Duration')} value={fmtMs(s.p95Ms)} /></Card>
          <Card className={styles.statCard}><Statistic title={t('ui.proxyStats.p99Duration')} value={fmtMs(s.p99Ms)} /></Card>
          <Card className={styles.statCard}><Statistic title={t('ui.proxyStats.maxDuration')} value={fmtMs(s.maxMs)} /></Card>
          <Card className={styles.statCard}><Statistic title={t('ui.proxyStats.avgDuration')} value={fmtMs(s.avgMs)} /></Card>
        </div>
        <div className={styles.topRow}>
          <Table
            title={() => t('ui.proxyStats.slowest')}
            dataSource={data.slowest ? [data.slowest] : []}
            rowKey="ts"
            size="small"
            pagination={false}
            className={styles.table}
            columns={[
              { title: t('ui.proxyStats.colPath'), dataIndex: 'path', key: 'path', ellipsis: true },
              { title: t('ui.proxyStats.colModel'), dataIndex: 'model', key: 'model', ellipsis: true },
              { title: t('ui.proxyStats.attempts'), dataIndex: 'attempts', key: 'attempts' },
              { title: t('ui.proxyStats.durationAnalysis'), dataIndex: 'duration_ms', key: 'dur', render: fmtMs },
            ]}
          />
          <Table
            title={() => t('ui.proxyStats.fastest')}
            dataSource={data.fastest ? [data.fastest] : []}
            rowKey="ts"
            size="small"
            pagination={false}
            className={styles.table}
            columns={[
              { title: t('ui.proxyStats.colPath'), dataIndex: 'path', key: 'path', ellipsis: true },
              { title: t('ui.proxyStats.colModel'), dataIndex: 'model', key: 'model', ellipsis: true },
              { title: t('ui.proxyStats.attempts'), dataIndex: 'attempts', key: 'attempts' },
              { title: t('ui.proxyStats.durationAnalysis'), dataIndex: 'duration_ms', key: 'dur', render: fmtMs },
            ]}
          />
        </div>
      </Card>

      {/* By path */}
      {data.byPath && data.byPath.length > 0 && (
        <Card title={t('ui.proxyStats.byPath')} className={styles.section}>
          <Table
            dataSource={data.byPath}
            rowKey="path"
            size="small"
            pagination={false}
            className={styles.table}
            columns={[
              { title: t('ui.proxyStats.colPath'), dataIndex: 'path', key: 'path', ellipsis: true },
              { title: t('ui.proxyStats.totalRequests'), dataIndex: 'requests', key: 'requests' },
              { title: t('ui.proxyStats.retries'), dataIndex: 'retries', key: 'retries' },
              { title: t('ui.proxyStats.downstreamAvailability'), dataIndex: 'availabilityPct', key: 'avail', render: v => `${v}%` },
            ]}
          />
        </Card>
      )}

      {/* By proxy profile */}
      {data.byProfile && data.byProfile.length > 0 && (
        <Card title={t('ui.proxyStats.byProfile')} className={styles.section}>
          <Table
            dataSource={data.byProfile}
            rowKey="profile_id"
            size="small"
            pagination={false}
            className={styles.table}
            columns={[
              { title: t('ui.proxyStats.byProfile'), dataIndex: 'profile_name', key: 'profile_name' },
              { title: t('ui.proxyStats.totalRequests'), dataIndex: 'requests', key: 'requests' },
              { title: t('ui.proxyStats.retries'), dataIndex: 'retries', key: 'retries' },
              { title: t('ui.proxyStats.upstreamAvailability'), dataIndex: 'upstreamAvailabilityPct', key: 'upAvail', render: v => `${v}%` },
              { title: t('ui.proxyStats.downstreamAvailability'), dataIndex: 'availabilityPct', key: 'dsAvail', render: v => `${v}%` },
              { title: t('ui.proxyStats.p95Duration'), dataIndex: 'p95Ms', key: 'p95', render: fmtMs },
            ]}
          />
        </Card>
      )}

      {/* Recent request details */}
      <Card title={t('ui.proxyStats.recentRecords')} className={styles.section}>
        <Table
          dataSource={data.recentRecords || []}
          rowKey="ts"
          size="small"
          pagination={{ pageSize: 20, size: 'small' }}
          className={styles.table}
          scroll={{ x: 'max-content' }}
          columns={[
            { title: t('ui.proxyStats.colTime'), dataIndex: 'ts', key: 'ts', width: 180, ellipsis: true, render: v => v ? new Date(v).toLocaleString() : '-' },
            { title: t('ui.proxyStats.colMethod'), dataIndex: 'method', key: 'method', width: 70 },
            { title: t('ui.proxyStats.colPath'), dataIndex: 'path', key: 'path', ellipsis: true },
            { title: t('ui.proxyStats.colModel'), dataIndex: 'model', key: 'model', ellipsis: true },
            { title: t('ui.proxyStats.colStatus'), dataIndex: 'final_status', key: 'status', width: 70, render: v => <Tag color={statusColor(v)}>{v || '-'}</Tag> },
            { title: t('ui.proxyStats.attempts'), dataIndex: 'attempts', key: 'attempts', width: 80 },
            { title: t('ui.proxyStats.retries'), dataIndex: 'retries', key: 'retries', width: 80 },
            { title: t('ui.proxyStats.durationAnalysis'), dataIndex: 'duration_ms', key: 'dur', width: 100, render: fmtMs },
            { title: t('ui.proxyStats.retryCodes'), dataIndex: 'retry_codes', key: 'rc', width: 120, render: v => v && v.length ? v.map(c => <Tag key={c} color={statusColor(c)}>{c}</Tag>) : '-' },
          ]}
        />
      </Card>
    </div>
  );
}

function Header({ onBack, onRefresh, autoRefresh, setAutoRefresh }) {
  return (
    <div className={styles.header}>
      <Space>
        <Button icon={<ArrowLeftOutlined />} onClick={onBack || (() => { window.location.search = ''; })}>{t('ui.proxyStats.back')}</Button>
        <h2 className={styles.title}>{t('ui.proxyStats.title')}</h2>
      </Space>
      <Space>
        <span>{t('ui.proxyStats.autoRefresh')}</span>
        <Switch checked={autoRefresh} onChange={setAutoRefresh} size="small" />
        <Button icon={<ReloadOutlined />} onClick={onRefresh}>{t('ui.proxyStats.refresh')}</Button>
      </Space>
    </div>
  );
}
