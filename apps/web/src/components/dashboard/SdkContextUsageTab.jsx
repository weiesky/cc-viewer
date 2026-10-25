import React, { useState } from 'react';
import { Button, Typography, Tooltip, Empty, Collapse, Tag } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { t } from '../../i18n';
import { formatTokenCount } from '../../utils/helpers';
import Loading from '../common/Loading';
import { buildUsageBar, gridToRows, buildDetailSections, buildApiUsage } from '../../utils/contextUsageView';
import { useSdkContextUsage } from './SdkContextUsageProvider';
import SdkContextComposition from './SdkContextComposition';
import palette from './SdkContextPalette.module.css';
import styles from './SdkContextUsageTab.module.css';

const { Text } = Typography;

const GRID_FILL_CLASS = {
  full: styles.gridCellFull,
  partial: styles.gridCellPartial,
  empty: styles.gridCellEmpty,
  buffer: styles.gridCellBuffer,
};

/** Full session-level context view; the shared Provider owns refresh and subscriptions. */
export default function SdkContextUsageTab() {
  const { detail, status, refreshing, refresh } = useSdkContextUsage();
  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    setRetrying(true);
    try { await refresh(); } finally { setRetrying(false); }
  };

  if (status === 'loading') {
    return <div className={styles.center}><Loading /></div>;
  }
  if (status === 'inactive') {
    return <div className={styles.center}><Empty description={<Text type="secondary">{t('ui.contextUsage.inactive')}</Text>} /></div>;
  }
  if (status === 'error' && !detail) {
    return (
      <div className={styles.center}>
        <Empty description={<Text type="secondary">{t('ui.contextUsage.loadFailed')}</Text>} />
        <Button size="small" icon={<ReloadOutlined />} onClick={retry} loading={retrying}>{t('ui.contextUsage.retry')}</Button>
      </div>
    );
  }

  const usage = detail && detail.usage;
  if (!usage) {
    return <div className={styles.center}><Empty description={<Text type="secondary">{t('ui.contextUsage.inactive')}</Text>} /></div>;
  }

  const bar = buildUsageBar(usage);
  const grid = gridToRows(usage);
  const sections = buildDetailSections(usage);
  const apiUsage = buildApiUsage(usage);

  return (
    <div className={`${palette.root} ${styles.root}`}>
      <div className={styles.headerRow}>
        <Text strong>{t('ui.contextUsage.title')}</Text>
        {usage.model && <Tag className={styles.modelTag}>{usage.model}</Tag>}
        <span className={styles.headerSpacer} />
        {detail.ts && (
          <Text type="secondary" className={styles.updatedAt}>
            {t('ui.contextUsage.updatedAt', { time: new Date(detail.ts).toLocaleTimeString() })}
          </Text>
        )}
        <Button size="small" type="text" icon={<ReloadOutlined />} onClick={refresh} loading={refreshing} disabled={refreshing} aria-label={t('ui.contextUsage.refresh')} />
      </div>

      <SdkContextComposition bar={bar} />

      {grid.rows.length > 0 && (
        <div className={styles.gridSection}>
          <Text type="secondary" className={styles.gridLabel}>{t('ui.contextUsage.grid')}</Text>
          <div className={styles.grid}>
            {grid.rows.map((row, ri) => (
              <div key={ri} className={styles.gridRow}>
                {row.map((cell, ci) => (
                  <Tooltip key={ci} title={`${cell.categoryName}: ${formatTokenCount(cell.tokens)}`}>
                    <span
                      className={`${styles.gridCell} ${GRID_FILL_CLASS[cell.fill]}`}
                      style={{ '--cell-color': cell.color }}
                    />
                  </Tooltip>
                ))}
              </div>
            ))}
          </div>
          {grid.truncated && <Text type="secondary" className={styles.truncatedNote}>…</Text>}
        </div>
      )}

      {sections.length > 0 && (
        <Collapse
          ghost
          className={styles.sections}
          items={sections.map((sec) => ({
            key: sec.key,
            label: t(`ui.contextUsage.section.${sec.key}`),
            children: (
              <div className={styles.sectionBody}>
                {sec.summary && (
                  <div className={styles.sectionSummary}>
                    {Object.entries(sec.summary).map(([k, v]) => (
                      <span key={k} className={styles.summaryItem}>{k}: {formatTokenCount(v)}</span>
                    ))}
                  </div>
                )}
                {(sec.items || []).map((item, i) => (
                  <div key={i} className={styles.sectionRow}>
                    <span className={styles.sectionRowName}>{item.name || item.path || item.agentType || ''}</span>
                    <span className={styles.sectionRowTokens}>{formatTokenCount(item.tokens)}</span>
                  </div>
                ))}
                {(sec.toolCallsByType || []).map((item, i) => (
                  <div key={`tc${i}`} className={styles.sectionRow}>
                    <span className={styles.sectionRowName}>{item.name}</span>
                    <span className={styles.sectionRowTokens}>{formatTokenCount(item.callTokens)} / {formatTokenCount(item.resultTokens)}</span>
                  </div>
                ))}
              </div>
            ),
          }))}
        />
      )}

      {apiUsage && (
        <div className={styles.footer}>
          <Text type="secondary" className={styles.apiUsageLabel}>{t('ui.contextUsage.section.apiUsage')}</Text>
          <span className={styles.summaryItem}>in: {formatTokenCount(apiUsage.input)}</span>
          <span className={styles.summaryItem}>out: {formatTokenCount(apiUsage.output)}</span>
          <span className={styles.summaryItem}>cache+: {formatTokenCount(apiUsage.cacheCreate)}</span>
          <span className={styles.summaryItem}>cache·: {formatTokenCount(apiUsage.cacheRead)}</span>
        </div>
      )}
    </div>
  );
}
