import React, { useContext, useState, useEffect, useCallback, useReducer } from 'react';
import { Button, Typography, Tooltip, Empty, Collapse, Tag } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { t } from '../../i18n';
import { apiUrl } from '../../utils/apiUrl';
import { reportSwallowed } from '../../utils/errorReport';
import { formatTokenCount } from '../../utils/helpers';
import { TerminalWsContext } from '../terminal/TerminalWsContext';
import Loading from '../common/Loading';
import { buildUsageBar, gridToRows, buildDetailSections, buildApiUsage, nextPanelState } from '../../utils/contextUsageView';
import styles from './SdkContextUsageTab.module.css';

const { Text } = Typography;

const GRID_FILL_CLASS = {
  full: styles.gridCellFull,
  partial: styles.gridCellPartial,
  empty: styles.gridCellEmpty,
  buffer: styles.gridCellBuffer,
};

/**
 * SDK-mode "Context usage" panel. Data is SESSION-level (vs ContextTab's per-request), so
 * it lives as its own DetailPanel tab. Sources: a WS `sdk-context-usage` push on turn-end /
 * compact (plus reconnect replay), and an on-demand HTTP pull on mount / manual refresh /
 * WS reconnect-open (covers the disconnected-during-switch window where the replayed frame
 * is null). HTTP and WS can arrive out of order — the state machine (nextPanelState)
 * applies a ts-monotone guard so a stale frame never clobbers a newer one.
 */
export default function SdkContextUsageTab() {
  const ws = useContext(TerminalWsContext);
  // useReducer (not useState+useCallback): the reducer's dispatch is a STABLE identity by
  // React contract, so `load`'s [dispatch] dep never churns and the mount effect below runs
  // exactly once per `ws` change. With useState+useCallback([detail,status]) the dispatch
  // identity changed on every successful pull → load/effect re-ran → infinite refetch loop.
  const [{ detail, status }, dispatch] = useReducer(nextPanelState, { detail: null, status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch(apiUrl('/api/sdk-context-usage'));
      const data = await res.json();
      dispatch({ kind: 'http', body: data });
    } catch (e) {
      reportSwallowed('sdk-context-usage.fetch', e);
      dispatch({ kind: 'http-error' });
    } finally {
      setRefreshing(false);
    }
  }, [dispatch]);

  useEffect(() => {
    const offMsg = ws.addMessageHandler((msg) => {
      try {
        if (!msg || msg.type !== 'sdk-context-usage') return;
        dispatch({ kind: 'ws', frame: msg });
      } catch (e) { reportSwallowed('sdk-context-usage.ws', e); }
    });
    // Re-pull on reconnect: a session switch during the disconnect window replays a null
    // snapshot (no frame), so the panel would otherwise keep the previous session's numbers.
    const offState = ws.addStateListener((s) => { if (s === 'open') load(); });
    load();
    return () => { offMsg(); offState(); };
  }, [ws, load, dispatch]);

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
        <Button size="small" icon={<ReloadOutlined />} onClick={load} loading={refreshing}>{t('ui.contextUsage.retry')}</Button>
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
    <div className={styles.root}>
      <div className={styles.headerRow}>
        <Text strong>{t('ui.contextUsage.title')}</Text>
        {usage.model && <Tag className={styles.modelTag}>{usage.model}</Tag>}
        <span className={styles.headerSpacer} />
        {detail.ts && (
          <Text type="secondary" className={styles.updatedAt}>
            {t('ui.contextUsage.updatedAt', { time: new Date(detail.ts).toLocaleTimeString() })}
          </Text>
        )}
        <Button size="small" type="text" icon={<ReloadOutlined />} onClick={load} loading={refreshing} aria-label={t('ui.contextUsage.refresh')} />
      </div>

      {bar && (
        <div className={styles.barSection}>
          <div className={styles.barMeta}>
            <Text>{t('ui.contextUsage.usedOf', { used: formatTokenCount(bar.totalTokens), max: formatTokenCount(bar.maxTokens) })}</Text>
            <Text type="secondary">{bar.percentage.toFixed(1)}%</Text>
          </div>
          <Tooltip title={`rawMaxTokens: ${formatTokenCount(bar.rawMaxTokens)}`}>
            <div className={styles.barTrack}>
              {bar.segments.map((s, i) => (
                <Tooltip key={i} title={`${s.name}: ${formatTokenCount(s.tokens)}${s.isDeferred ? ' · ' + t('ui.contextUsage.deferred') : ''}`}>
                  <div className={styles.barSeg} style={{ width: `${s.pct}%`, background: s.color }} />
                </Tooltip>
              ))}
              {bar.isAutoCompactEnabled && bar.autoCompactThreshold != null && bar.maxTokens > 0 && (
                <div
                  className={styles.thresholdMark}
                  style={{ left: `${Math.min(100, (bar.autoCompactThreshold / bar.maxTokens) * 100)}%` }}
                  title={t('ui.contextUsage.autoCompactAt', { tokens: formatTokenCount(bar.autoCompactThreshold) })}
                />
              )}
            </div>
          </Tooltip>
          {!bar.isAutoCompactEnabled && (
            <Text type="secondary" className={styles.autoCompactOff}>{t('ui.contextUsage.autoCompactOff')}</Text>
          )}
          <div className={styles.legend}>
            {bar.segments.map((s, i) => (
              <span key={i} className={styles.legendItem}>
                <i className={styles.legendDot} style={{ background: s.color }} />
                {s.name} · {formatTokenCount(s.tokens)}
                {s.isDeferred && <Tag className={styles.deferredTag}>{t('ui.contextUsage.deferred')}</Tag>}
              </span>
            ))}
          </div>
        </div>
      )}

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
