import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Layout, List, Tag, Radio, Empty, Spin, Typography, Space, Button } from 'antd';
import { ReloadOutlined, CloseOutlined } from '@ant-design/icons';
import { Virtuoso } from 'react-virtuoso';
import { apiUrl } from '../../utils/apiUrl';
import { t } from '../../i18n';

const { Sider, Content } = Layout;
const { Text } = Typography;

function formatTs(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

// Palette 用于 role 标签着色。协议不理解 role 语义，这里用字符串哈希到
// 固定色板的映射，保证同一 role 在一个会话里颜色稳定。
const ROLE_PALETTE = ['geekblue', 'purple', 'cyan', 'gold', 'magenta', 'green', 'volcano', 'blue'];
function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function roleBadgeColor(role) {
  if (!role || role === 'unknown') return 'default';
  return ROLE_PALETTE[hashString(role) % ROLE_PALETTE.length];
}

function ScopeSidebar({ roots, selectedRoot, selectedProvider, selectedScope, onSelectScope, refreshTick }) {
  const [scopesByProvider, setScopesByProvider] = useState({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const map = {};
      for (const root of roots) {
        for (const provider of (root.providers || [])) {
          try {
            const url = apiUrl(`/api/external/scopes?root=${root.index}&provider=${encodeURIComponent(provider.providerId)}`);
            const r = await fetch(url);
            const data = await r.json();
            map[`${root.index}:${provider.providerId}`] = data.scopes || [];
          } catch {
            map[`${root.index}:${provider.providerId}`] = [];
          }
        }
      }
      setScopesByProvider(map);
      setLoading(false);
    };
    load();
  }, [roots, refreshTick]);

  if (loading) return <div style={{ padding: 16 }}><Spin size="small" /></div>;

  const items = [];
  for (const root of roots) {
    for (const provider of (root.providers || [])) {
      const scopes = scopesByProvider[`${root.index}:${provider.providerId}`] || [];
      items.push({ type: 'provider', root, provider });
      for (const scope of scopes) {
        items.push({ type: 'scope', root, provider, scope });
      }
    }
  }
  if (items.length === 0) {
    return <Empty description={t('external.noScopes')} style={{ marginTop: 40 }} />;
  }

  return (
    <List
      size="small"
      dataSource={items}
      renderItem={(item) => {
        if (item.type === 'provider') {
          return (
            <List.Item style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.04)' }}>
              <Text strong>{item.provider.providerName || item.provider.providerId}</Text>
            </List.Item>
          );
        }
        const isSel = selectedRoot === item.root.index
          && selectedProvider === item.provider.providerId
          && selectedScope === item.scope.scopeId;
        return (
          <List.Item
            style={{
              padding: '8px 16px',
              cursor: 'pointer',
              background: isSel ? 'rgba(24,144,255,0.15)' : 'transparent',
              borderLeft: isSel ? '3px solid #1890ff' : '3px solid transparent',
            }}
            onClick={() => onSelectScope(item.root.index, item.provider.providerId, item.scope.scopeId)}
          >
            <div style={{ width: '100%' }}>
              <div><Text>{item.scope.title}</Text></div>
              {item.scope.subtitle && (
                <div><Text type="secondary" style={{ fontSize: 12 }}>{item.scope.subtitle}</Text></div>
              )}
            </div>
          </List.Item>
        );
      }}
    />
  );
}

function SessionList({ rootIndex, providerId, scopeId, selectedSession, onSelectSession, refreshTick }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [roleFilter, setRoleFilter] = useState('all');

  useEffect(() => {
    if (rootIndex == null || !providerId || !scopeId) {
      setSessions([]);
      return;
    }
    setLoading(true);
    const url = apiUrl(`/api/external/sessions?root=${rootIndex}&provider=${encodeURIComponent(providerId)}&scope=${encodeURIComponent(scopeId)}`);
    fetch(url)
      .then(r => r.json())
      .then(data => { setSessions(data.sessions || []); setLoading(false); })
      .catch(() => { setSessions([]); setLoading(false); });
  }, [rootIndex, providerId, scopeId, refreshTick]);

  // 动态从 sessions 里抽所有 role 作为过滤选项——协议不固定 role 取值域。
  const availableRoles = useMemo(() => {
    const set = new Set();
    for (const s of sessions) {
      if (s.role && s.role !== 'unknown') set.add(s.role);
    }
    return Array.from(set).sort();
  }, [sessions]);

  // sessions 变化后，如果当前 filter 的 role 不在新集合里，回到 all
  useEffect(() => {
    if (roleFilter !== 'all' && !availableRoles.includes(roleFilter)) {
      setRoleFilter('all');
    }
  }, [availableRoles, roleFilter]);

  const filtered = useMemo(() => {
    if (roleFilter === 'all') return sessions;
    return sessions.filter(s => s.role === roleFilter);
  }, [sessions, roleFilter]);

  if (!scopeId) {
    return <Empty description={t('external.selectScope')} style={{ marginTop: 60 }} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {availableRoles.length > 0 && (
        <div style={{ padding: 12, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          <Radio.Group value={roleFilter} onChange={e => setRoleFilter(e.target.value)} size="small">
            <Radio.Button value="all">{t('external.roleAll')}</Radio.Button>
            {availableRoles.map(r => (
              <Radio.Button key={r} value={r}>{r}</Radio.Button>
            ))}
          </Radio.Group>
        </div>
      )}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading && <div style={{ padding: 16 }}><Spin size="small" /></div>}
        {!loading && filtered.length === 0 && <Empty description={t('external.noSessions')} style={{ marginTop: 40 }} />}
        {!loading && filtered.length > 0 && (
          <List
            size="small"
            dataSource={filtered}
            renderItem={(s) => {
              const isSel = selectedSession === s.sessionId;
              const isLive = !s.endedAt;
              return (
                <List.Item
                  style={{
                    padding: '10px 16px',
                    cursor: 'pointer',
                    background: isSel ? 'rgba(24,144,255,0.15)' : 'transparent',
                    borderLeft: isSel ? '3px solid #1890ff' : '3px solid transparent',
                  }}
                  onClick={() => onSelectSession(s.sessionId)}
                >
                  <div style={{ width: '100%' }}>
                    <Space size={6} style={{ marginBottom: 4 }}>
                      <Tag color={roleBadgeColor(s.role)} style={{ margin: 0 }}>{s.role}</Tag>
                      {isLive && <Tag color="success" style={{ margin: 0 }}>live</Tag>}
                    </Space>
                    <div><Text>{s.title}</Text></div>
                    <div><Text type="secondary" style={{ fontSize: 12 }}>{formatTs(s.startedAt)}</Text></div>
                  </div>
                </List.Item>
              );
            }}
          />
        )}
      </div>
    </div>
  );
}

function EntryTimeline({ rootIndex, providerId, scopeId, sessionId }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [atBottom, setAtBottom] = useState(true);
  const esRef = useRef(null);
  const virtuosoRef = useRef(null);

  useEffect(() => {
    setEntries([]);
    setError(null);
    if (rootIndex == null || !providerId || !scopeId || !sessionId) return;

    setLoading(true);
    const url = apiUrl(`/api/external/events?root=${rootIndex}&provider=${encodeURIComponent(providerId)}&scope=${encodeURIComponent(scopeId)}&session=${encodeURIComponent(sessionId)}`);
    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener('load_start', () => { setLoading(true); });
    es.addEventListener('load_chunk', (ev) => {
      try {
        const arr = JSON.parse(ev.data);
        if (Array.isArray(arr)) {
          setEntries(prev => {
            const merged = [...prev];
            for (const item of arr) {
              try {
                const e = typeof item === 'string' ? JSON.parse(item) : item;
                merged.push(e);
              } catch {}
            }
            return merged;
          });
        }
      } catch {}
    });
    es.addEventListener('load_end', () => setLoading(false));
    es.addEventListener('error', (ev) => {
      try {
        if (ev.data) {
          const parsed = JSON.parse(ev.data);
          setError(parsed.message || 'stream error');
        }
      } catch {}
      setLoading(false);
    });
    es.onmessage = (ev) => {
      try {
        const entry = JSON.parse(ev.data);
        setEntries(prev => [...prev, entry]);
      } catch {}
    };

    return () => { try { es.close(); } catch {} esRef.current = null; };
  }, [rootIndex, providerId, scopeId, sessionId]);

  if (!sessionId) {
    return <Empty description={t('external.selectSession')} style={{ marginTop: 80 }} />;
  }
  if (error) {
    return <div style={{ padding: 16, color: '#ff7875' }}>{t('external.streamError')}: {error}</div>;
  }
  if (loading && entries.length === 0) {
    return <div style={{ padding: 16 }}><Spin /> {t('external.loading')}</div>;
  }
  if (entries.length === 0) {
    return <Empty description={t('external.noEntries')} style={{ marginTop: 80 }} />;
  }

  return (
    <Virtuoso
      ref={virtuosoRef}
      style={{ height: '100%' }}
      data={entries}
      // 用户主动离开底部后就不再追尾，避免打断阅读历史
      followOutput={atBottom ? 'smooth' : false}
      atBottomStateChange={setAtBottom}
      itemContent={(index, entry) => {
        const method = entry.method || '';
        const ts = entry.timestamp ? formatTs(entry.timestamp) : '';
        const model = entry.body?.model || '';
        const messagesCount = Array.isArray(entry.body?.messages) ? entry.body.messages.length : 0;
        const isStream = entry.isStream ? 'stream' : '';
        const status = entry.response?.status || (entry.inProgress ? '...' : '');
        const lastMsg = messagesCount > 0 ? entry.body.messages[messagesCount - 1] : null;
        const preview = lastMsg ? (typeof lastMsg.content === 'string'
          ? lastMsg.content.slice(0, 200)
          : JSON.stringify(lastMsg.content).slice(0, 200)) : '';

        return (
          <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <Space size={6} style={{ marginBottom: 4 }}>
              <Tag>{method}</Tag>
              {model && <Tag color="blue">{model}</Tag>}
              {status && <Tag color={String(status).startsWith('2') ? 'success' : 'default'}>{status}</Tag>}
              {isStream && <Tag color="processing">{isStream}</Tag>}
              <Text type="secondary" style={{ fontSize: 12 }}>{ts}</Text>
              {messagesCount > 0 && <Text type="secondary" style={{ fontSize: 12 }}>msgs={messagesCount}</Text>}
            </Space>
            {preview && (
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', whiteSpace: 'pre-wrap', marginTop: 4 }}>
                {preview}
              </div>
            )}
            <details style={{ marginTop: 6 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
                {t('external.rawJson')}
              </summary>
              <pre style={{ fontSize: 11, background: 'rgba(0,0,0,0.3)', padding: 8, borderRadius: 4, overflow: 'auto', maxHeight: 400 }}>
                {JSON.stringify(entry, null, 2)}
              </pre>
            </details>
          </div>
        );
      }}
    />
  );
}

/**
 * Top-level view for CCV External Sessions Protocol browsing.
 * URL: ?view=external[&root=0&provider=X&scope=Y&session=Z]
 */
export default function ExternalSessionsView({ initial, onExit }) {
  const [roots, setRoots] = useState([]);
  const [rootsLoading, setRootsLoading] = useState(true);
  const [rootIndex, setRootIndex] = useState(initial?.root ?? null);
  const [providerId, setProviderId] = useState(initial?.provider ?? null);
  const [scopeId, setScopeId] = useState(initial?.scope ?? null);
  const [sessionId, setSessionId] = useState(initial?.session ?? null);
  const [refreshTick, setRefreshTick] = useState(0);

  const loadRoots = useCallback(async () => {
    setRootsLoading(true);
    try {
      const r = await fetch(apiUrl('/api/external/roots'));
      const data = await r.json();
      setRoots(data.roots || []);
    } catch {
      setRoots([]);
    }
    setRootsLoading(false);
  }, []);

  useEffect(() => { loadRoots(); }, [loadRoots]);

  // Listen to global /events SSE for external:changed events → refresh lists
  useEffect(() => {
    const es = new EventSource(apiUrl('/events'));
    const handler = () => setRefreshTick(t => t + 1);
    es.addEventListener('external:changed', handler);
    return () => { try { es.close(); } catch {} };
  }, []);

  const handleSelectScope = useCallback((rIdx, pId, sId) => {
    setRootIndex(rIdx);
    setProviderId(pId);
    setScopeId(sId);
    setSessionId(null);
  }, []);

  const handleSelectSession = useCallback((sessId) => {
    setSessionId(sessId);
  }, []);

  return (
    <Layout style={{ height: '100vh' }}>
      <div style={{ padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <Space>
          <Text strong>{t('external.title')}</Text>
          <Button size="small" icon={<ReloadOutlined />} onClick={() => { loadRoots(); setRefreshTick(t => t + 1); }}>
            {t('external.refresh')}
          </Button>
        </Space>
        {onExit && (
          <Button size="small" icon={<CloseOutlined />} onClick={onExit}>
            {t('external.close')}
          </Button>
        )}
      </div>
      <Layout>
        <Sider width={260} theme="dark" style={{ borderRight: '1px solid rgba(255,255,255,0.1)', overflow: 'auto' }}>
          {rootsLoading ? (
            <div style={{ padding: 16 }}><Spin size="small" /></div>
          ) : roots.length === 0 ? (
            <Empty description={t('external.noRoots')} style={{ marginTop: 40 }} />
          ) : (
            <ScopeSidebar
              roots={roots}
              selectedRoot={rootIndex}
              selectedProvider={providerId}
              selectedScope={scopeId}
              onSelectScope={handleSelectScope}
              refreshTick={refreshTick}
            />
          )}
        </Sider>
        <Sider width={320} theme="dark" style={{ borderRight: '1px solid rgba(255,255,255,0.1)' }}>
          <SessionList
            rootIndex={rootIndex}
            providerId={providerId}
            scopeId={scopeId}
            selectedSession={sessionId}
            onSelectSession={handleSelectSession}
            refreshTick={refreshTick}
          />
        </Sider>
        <Content style={{ overflow: 'hidden' }}>
          <EntryTimeline
            rootIndex={rootIndex}
            providerId={providerId}
            scopeId={scopeId}
            sessionId={sessionId}
          />
        </Content>
      </Layout>
    </Layout>
  );
}

/**
 * Helper for App.jsx / Mobile.jsx render() guard.
 * Returns JSX when ?view=external is in URL, otherwise null.
 * ConfigProvider is passed in to avoid circular imports.
 */
export function maybeRenderExternalView(ConfigProvider, themeConfig) {
  try {
    const qs = new URLSearchParams(window.location.search);
    if (qs.get('view') !== 'external') return null;
    const initial = {};
    const r = qs.get('root'); if (r != null) initial.root = parseInt(r, 10);
    const p = qs.get('provider'); if (p) initial.provider = p;
    const s = qs.get('scope'); if (s) initial.scope = s;
    const se = qs.get('session'); if (se) initial.session = se;
    const onExit = () => {
      const url = new URL(window.location.href);
      url.searchParams.delete('view');
      url.searchParams.delete('root');
      url.searchParams.delete('provider');
      url.searchParams.delete('scope');
      url.searchParams.delete('session');
      window.location.href = url.toString();
    };
    return (
      <ConfigProvider theme={themeConfig}>
        <ExternalSessionsView initial={initial} onExit={onExit} />
      </ConfigProvider>
    );
  } catch {
    return null;
  }
}
