import React from 'react';
import { Tooltip, Tag, Typography } from 'antd';
import { t } from '../../i18n';
import { formatTokenCount } from '../../utils/helpers';
import palette from './SdkContextPalette.module.css';
import styles from './SdkContextComposition.module.css';

const { Text } = Typography;

function BarMeta({ bar }) {
  return (
    <div className={styles.barMeta}>
      <Text>{t('ui.contextUsage.usedOf', { used: formatTokenCount(bar.totalTokens), max: formatTokenCount(bar.maxTokens) })}</Text>
      <Text type="secondary">{bar.percentage.toFixed(1)}%</Text>
    </div>
  );
}

function BarTrack({ bar, interactive = true }) {
  const track = (
    <div className={styles.barTrack}>
      {bar.segments.map((segment, index) => {
        const part = <div className={styles.barSeg} style={{ width: `${segment.pct}%`, background: segment.color }} />;
        return interactive ? (
          <Tooltip key={`${segment.name}-${index}`} title={`${segment.name}: ${formatTokenCount(segment.tokens)}${segment.isDeferred ? ' · ' + t('ui.contextUsage.deferred') : ''}`}>
            {part}
          </Tooltip>
        ) : <React.Fragment key={`${segment.name}-${index}`}>{part}</React.Fragment>;
      })}
      {bar.isAutoCompactEnabled && bar.autoCompactThreshold != null && bar.maxTokens > 0 && (
        <div
          className={styles.thresholdMark}
          style={{ left: `${Math.min(100, (bar.autoCompactThreshold / bar.maxTokens) * 100)}%` }}
          title={t('ui.contextUsage.autoCompactAt', { tokens: formatTokenCount(bar.autoCompactThreshold) })}
        />
      )}
    </div>
  );
  return interactive ? <Tooltip title={`rawMaxTokens: ${formatTokenCount(bar.rawMaxTokens)}`}>{track}</Tooltip> : track;
}

function Legend({ bar }) {
  return (
    <div className={styles.legend}>
      {bar.segments.map((segment, index) => (
        <span key={`${segment.name}-${index}`} className={styles.legendItem}>
          <i className={styles.legendDot} style={{ background: segment.color }} />
          {segment.name} · {formatTokenCount(segment.tokens)}
          {segment.isDeferred && <Tag className={styles.deferredTag}>{t('ui.contextUsage.deferred')}</Tag>}
        </span>
      ))}
    </div>
  );
}

export default function SdkContextComposition({ bar, variant = 'overview', apiUsage = null }) {
  if (!bar) return null;
  if (variant === 'strip') {
    return (
      <div
        className={`${palette.root} ${styles.strip}`}
        role="img"
        aria-label={`${t('ui.contextUsage.title')}: ${bar.percentage.toFixed(1)}%`}
      >
        <BarTrack bar={bar} interactive={false} />
      </div>
    );
  }
  return (
    <div className={`${palette.root} ${styles.barSection} ${variant === 'compact' ? styles.compact : ''}`}>
      <BarMeta bar={bar} />
      <BarTrack bar={bar} />
      {!bar.isAutoCompactEnabled && <Text type="secondary" className={styles.autoCompactOff}>{t('ui.contextUsage.autoCompactOff')}</Text>}
      <Legend bar={bar} />
      {variant === 'compact' && apiUsage && (
        <div className={styles.apiUsage}>
          <Text type="secondary">{t('ui.contextUsage.section.apiUsage')}</Text>
          <span>in: {formatTokenCount(apiUsage.input)}</span>
          <span>out: {formatTokenCount(apiUsage.output)}</span>
          <span>cache+: {formatTokenCount(apiUsage.cacheCreate)}</span>
          <span>cache·: {formatTokenCount(apiUsage.cacheRead)}</span>
        </div>
      )}
    </div>
  );
}
