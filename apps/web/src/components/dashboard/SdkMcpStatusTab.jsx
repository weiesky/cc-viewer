import React, { useContext, useState, useEffect, useCallback, useReducer } from 'react';
import { Button, Typography, Empty, Tag } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { t } from '../../i18n';
import { apiUrl } from '../../utils/apiUrl';
import { reportSwallowed } from '../../utils/errorReport';
import { TerminalWsContext } from '../terminal/TerminalWsContext';
import Loading from '../common/Loading';
import { nextMcpPanelState, statusKey, statusColor, toolCountOf } from '../../utils/mcpStatusView';
import styles from './SdkMcpStatusTab.module.css';

const { Text } = Typography;

/**
 * SDK-mode "MCP server status" panel. Session-level MCP connection state, mounted as its
 * own DetailPanel tab. Unlike the context-usage panel there is NO turn-driven push (MCP
 * connect/disconnect is not turn-correlated) — sources are an on-demand HTTP pull on mount /
 * manual refresh / WS reconnect-open, plus a `sdk-mcp-status` snapshot replayed on WS
 * reconnect and a servers:null clear frame on session switch. HTTP and WS can arrive out of
 * order — the state machine (nextMcpPanelState) applies a ts-monotone guard so a stale frame
 * never clobbers a newer one. An empty server list renders a distinct `empty` state; the
 * `inactive` state is reserved for "no session / query dead" (servers:null).
 */
export default function SdkMcpStatusTab() {
  const ws = useContext(TerminalWsContext);
  // useReducer (not useState+useCallback): the reducer's dispatch is a STABLE identity by
  // React contract, so `load`'s [dispatch] dep never churns and the mount effect below runs
  // exactly once per `ws` change. With useState+useCallback([detail,status]) the dispatch
  // identity changed on every successful pull → load/effect re-ran → infinite refetch loop.
  const [{ detail, status }, dispatch] = useReducer(nextMcpPanelState, { detail: null, status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch(apiUrl('/api/sdk-mcp-server-status'));
      const data = await res.json();
      dispatch({ kind: 'http', body: data });
    } catch (e) {
      reportSwallowed('sdk-mcp-status.fetch', e);
      dispatch({ kind: 'http-error' });
    } finally {
      setRefreshing(false);
    }
  }, [dispatch]);

  useEffect(() => {
    const offMsg = ws.addMessageHandler((msg) => {
      try {
        if (!msg || msg.type !== 'sdk-mcp-status') return;
        dispatch({ kind: 'ws', frame: msg });
      } catch (e) { reportSwallowed('sdk-mcp-status.ws', e); }
    });
    // Re-pull on reconnect: a session switch during the disconnect window replays a null
    // snapshot (no frame), so the panel would otherwise keep the previous session's list.
    const offState = ws.addStateListener((s) => { if (s === 'open') load(); });
    load();
    return () => { offMsg(); offState(); };
  }, [ws, load, dispatch]);

  if (status === 'loading') {
    return <div className={styles.center}><Loading /></div>;
  }
  if (status === 'inactive') {
    return <div className={styles.center}><Empty description={<Text type="secondary">{t('ui.mcpStatus.inactive')}</Text>} /></div>;
  }
  if (status === 'error' && !detail) {
    return (
      <div className={styles.center}>
        <Empty description={<Text type="secondary">{t('ui.mcpStatus.loadFailed')}</Text>} />
        <Button size="small" icon={<ReloadOutlined />} onClick={load} loading={refreshing}>{t('ui.mcpStatus.retry')}</Button>
      </div>
    );
  }

  const servers = detail && detail.servers;
  if (!Array.isArray(servers)) {
    return <div className={styles.center}><Empty description={<Text type="secondary">{t('ui.mcpStatus.inactive')}</Text>} /></div>;
  }

  return (
    <div className={styles.root}>
      <div className={styles.headerRow}>
        <Text strong>{t('ui.mcpStatus.title')}</Text>
        <span className={styles.headerSpacer} />
        {detail.ts && (
          <Text type="secondary" className={styles.updatedAt}>
            {t('ui.mcpStatus.updatedAt', { time: new Date(detail.ts).toLocaleTimeString() })}
          </Text>
        )}
        <Button size="small" type="text" icon={<ReloadOutlined />} onClick={load} loading={refreshing} aria-label={t('ui.mcpStatus.refresh')} />
      </div>

      {servers.length === 0 ? (
        <div className={styles.center}><Empty description={<Text type="secondary">{t('ui.mcpStatus.empty')}</Text>} /></div>
      ) : (
        <div className={styles.list}>
          {servers.map((srv, i) => {
            const key = statusKey(srv?.status);
            const tools = toolCountOf(srv);
            return (
              <div key={srv?.name || i} className={styles.listRow}>
                <span className={styles.serverName}>{srv?.name || `#${i + 1}`}</span>
                {srv?.serverInfo?.version && (
                  <Text type="secondary" className={styles.version}>v{srv.serverInfo.version}</Text>
                )}
                <span className={styles.headerSpacer} />
                {tools > 0 && (
                  <Text type="secondary" className={styles.toolCount}>{t('ui.mcpStatus.toolCount', { count: tools })}</Text>
                )}
                <Tag color={statusColor(srv?.status)} className={styles.statusTag}>{t(`ui.mcpStatus.status.${key}`)}</Tag>
              </div>
            );
          })}
          {servers.some((srv) => srv?.status === 'failed' && srv?.error) && (
            <div className={styles.errorBlock}>
              {servers.filter((srv) => srv?.status === 'failed' && srv?.error).map((srv, i) => (
                <div key={srv?.name || i} className={styles.errorRow}>
                  <Text type="danger" className={styles.errorLabel}>{t('ui.mcpStatus.errorLabel')}</Text>
                  <Text type="secondary" className={styles.errorText}>{srv.name}: {srv.error}</Text>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
