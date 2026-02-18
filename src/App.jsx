import React from 'react';
import { ConfigProvider, Layout, theme } from 'antd';
import AppHeader from './components/AppHeader';
import RequestList from './components/RequestList';
import DetailPanel from './components/DetailPanel';
import ChatView from './components/ChatView';
import PanelResizer from './components/PanelResizer';

const chatMdStyles = `
.chat-md pre {
  background: #0d1117;
  border: 1px solid #2a2a2a;
  border-radius: 6px;
  padding: 12px;
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.5;
}
.chat-md code {
  background: #1a1a2e;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 13px;
  color: #e5e7eb;
}
.chat-md pre code {
  background: none;
  padding: 0;
}
.chat-md p { margin: 6px 0; }
.chat-md ul, .chat-md ol { padding-left: 20px; margin: 6px 0; }
.chat-md li { margin: 2px 0; }
.chat-md h1, .chat-md h2, .chat-md h3 { margin: 12px 0 6px 0; color: #fff; }
.chat-md h1 { font-size: 1.3em; }
.chat-md h2 { font-size: 1.15em; }
.chat-md h3 { font-size: 1.05em; }
.chat-md blockquote {
  border-left: 3px solid #3b82f6;
  margin: 8px 0;
  padding: 4px 12px;
  color: #9ca3af;
}
.chat-md table { border-collapse: collapse; margin: 8px 0; font-size: 13px; }
.chat-md th, .chat-md td { border: 1px solid #2a2a2a; padding: 6px 10px; }
.chat-md th { background: #1a1a1a; color: #fff; }
.chat-md a { color: #60a5fa; }
.chat-md hr { border: none; border-top: 1px solid #2a2a2a; margin: 12px 0; }
.chat-md strong { color: #f1f5f9; }
.chat-md em { color: #cbd5e1; }
`;

class App extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      requests: [],
      selectedIndex: null,
      viewMode: 'raw',
      currentTab: 'request',
      cacheExpireAt: null,
      cacheType: null,
      leftPanelWidth: 380,
      mainAgentSessions: [], // [{ messages, response }]
    };
    this.eventSource = null;
    this._autoSelectTimer = null;
    this.mainContainerRef = React.createRef();
  }

  componentDidMount() {
    this.initSSE();
  }

  componentWillUnmount() {
    if (this.eventSource) this.eventSource.close();
    if (this._autoSelectTimer) clearTimeout(this._autoSelectTimer);
  }

  initSSE() {
    try {
      this.eventSource = new EventSource('/events');
      this.eventSource.onmessage = (event) => this.handleEventMessage(event);
      this.eventSource.onerror = () => console.error('SSE连接错误');
    } catch (error) {
      console.error('EventSource初始化失败:', error);
    }
  }

  handleEventMessage(event) {
    try {
      const entry = JSON.parse(event.data);

      this.setState(prev => {
        const requests = [...prev.requests];
        const existingIndex = requests.findIndex(r =>
          r.timestamp === entry.timestamp && r.url === entry.url
        );

        if (existingIndex >= 0) {
          requests[existingIndex] = entry;
        } else {
          requests.push(entry);
        }

        // 记录 mainAgent 缓存信息
        let cacheExpireAt = prev.cacheExpireAt;
        let cacheType = prev.cacheType;
        if (entry.mainAgent) {
          const usage = entry.response?.body?.usage;
          if (usage?.cache_creation) {
            const cc = usage.cache_creation;
            if (cc.ephemeral_1h_input_tokens > 0) {
              cacheExpireAt = Date.now() + 3600 * 1000;
              cacheType = '1h';
            } else if (cc.ephemeral_5m_input_tokens > 0) {
              cacheExpireAt = Date.now() + 5 * 60 * 1000;
              cacheType = '5m';
            }
          }
        }

        // 合并 mainAgent sessions
        let mainAgentSessions = prev.mainAgentSessions;
        if (entry.mainAgent && entry.body && Array.isArray(entry.body.messages)) {
          mainAgentSessions = this.mergeMainAgentSessions(prev.mainAgentSessions, entry);
        }

        let selectedIndex = prev.selectedIndex;

        // 没有选中状态时，等初始数据加载完后选中最后一条
        if (selectedIndex === null && requests.length > 0) {
          if (this._autoSelectTimer) clearTimeout(this._autoSelectTimer);
          this._autoSelectTimer = setTimeout(() => {
            this.setState(s => {
              if (s.selectedIndex === null && s.requests.length > 0) {
                return { selectedIndex: s.requests.length - 1 };
              }
              return null;
            });
          }, 200);
        }

        return { requests, cacheExpireAt, cacheType, mainAgentSessions };
      });
    } catch (error) {
      console.error('处理事件消息失败:', error);
    }
  }

  /**
   * 合并 mainAgent sessions。
   * 通过 metadata.user_id 判断 session 归属，
   * user_id 变化时（/clear、session 切换等）新开一段，否则更新当前段。
   */
  mergeMainAgentSessions(prevSessions, entry) {
    const newMessages = entry.body.messages;
    const newResponse = entry.response;
    const userId = entry.body.metadata?.user_id || null;
    const timestamp = entry.timestamp || new Date().toISOString();

    if (prevSessions.length === 0) {
      // 初始化：为每条消息分配当前时间戳
      const msgTimestamps = newMessages.map(() => timestamp);
      return [{ userId, messages: newMessages, response: newResponse, msgTimestamps }];
    }

    const lastSession = prevSessions[prevSessions.length - 1];

    if (userId && userId === lastSession.userId) {
      // 同一 session，更新最后一段
      // 保留已有的时间戳，新增消息用当前 entry 的时间戳
      const prevTs = lastSession.msgTimestamps || [];
      const msgTimestamps = newMessages.map((_, i) => i < prevTs.length ? prevTs[i] : timestamp);
      const updated = [...prevSessions];
      updated[updated.length - 1] = { userId, messages: newMessages, response: newResponse, msgTimestamps };
      return updated;
    } else {
      // session 变迁，新开一段
      const msgTimestamps = newMessages.map(() => timestamp);
      return [...prevSessions, { userId, messages: newMessages, response: newResponse, msgTimestamps }];
    }
  }

  handleSelectRequest = (index) => {
    this.setState({ selectedIndex: index });
  };

  handleToggleViewMode = () => {
    this.setState(prev => ({
      viewMode: prev.viewMode === 'raw' ? 'chat' : 'raw',
    }));
  };

  handleTabChange = (key) => {
    this.setState({ currentTab: key });
  };

  handleResize = (clientX) => {
    const container = this.mainContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const newWidth = clientX - rect.left;
    if (newWidth >= 250 && newWidth <= 800) {
      this.setState({ leftPanelWidth: newWidth });
    }
  };

  render() {
    const { requests, selectedIndex, viewMode, currentTab, cacheExpireAt, cacheType, leftPanelWidth, mainAgentSessions } = this.state;
    const selectedRequest = selectedIndex !== null ? requests[selectedIndex] : null;

    return (
      <ConfigProvider
        theme={{
          algorithm: theme.darkAlgorithm,
          token: {
            colorBgContainer: '#111',
            colorBgLayout: '#0a0a0a',
            colorBgElevated: '#1a1a1a',
            colorBorder: '#2a2a2a',
          },
        }}
      >
        <style>{chatMdStyles}</style>
        <Layout style={{ height: '100vh', overflow: 'hidden' }}>
          <Layout.Header style={{
            background: '#111',
            borderBottom: '1px solid #1f1f1f',
            padding: '0 24px',
            height: 60,
            lineHeight: '60px',
          }}>
            <AppHeader
              requestCount={requests.length}
              viewMode={viewMode}
              cacheExpireAt={cacheExpireAt}
              cacheType={cacheType}
              onToggleViewMode={this.handleToggleViewMode}
            />
          </Layout.Header>

          <Layout.Content style={{ flex: 1, overflow: 'hidden' }}>
            {viewMode === 'raw' ? (
              <div
                ref={this.mainContainerRef}
                style={{ display: 'flex', height: '100%' }}
              >
                <div style={{
                  width: leftPanelWidth,
                  flexShrink: 0,
                  borderRight: '1px solid #1f1f1f',
                  display: 'flex',
                  flexDirection: 'column',
                  background: '#0a0a0a',
                }}>
                  <div style={{
                    padding: '10px 16px',
                    borderBottom: '1px solid #1f1f1f',
                    fontSize: 13,
                    color: '#9ca3af',
                    fontWeight: 500,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}>
                    <span>请求列表</span>
                    <span style={{ fontSize: 12, color: '#555', fontWeight: 400 }}>总请求数: {requests.length}</span>
                  </div>
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <RequestList
                      requests={requests}
                      selectedIndex={selectedIndex}
                      onSelect={this.handleSelectRequest}
                    />
                  </div>
                </div>

                <PanelResizer onResize={this.handleResize} />

                <div style={{ flex: 1, overflow: 'hidden', background: '#0d0d0d' }}>
                  <DetailPanel
                    request={selectedRequest}
                    currentTab={currentTab}
                    onTabChange={this.handleTabChange}
                  />
                </div>
              </div>
            ) : (
              <ChatView requests={requests} mainAgentSessions={mainAgentSessions} />
            )}
          </Layout.Content>
        </Layout>
      </ConfigProvider>
    );
  }
}

export default App;
