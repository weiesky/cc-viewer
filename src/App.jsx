import React from 'react';
import { ConfigProvider, Layout, theme, Modal, Collapse, List, Tag, Spin, Button, message } from 'antd';
import { FolderOutlined, FileTextOutlined, UploadOutlined } from '@ant-design/icons';
import AppHeader from './components/AppHeader';
import RequestList from './components/RequestList';
import DetailPanel from './components/DetailPanel';
import ChatView from './components/ChatView';
import PanelResizer from './components/PanelResizer';
import { t, getLang } from './i18n';
import styles from './App.module.css';

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
      importModalVisible: false,
      localLogs: {},       // { projectName: [{file, timestamp, size}] }
      localLogsLoading: false,
      showAll: false,
      lang: getLang(),      // 是否显示心跳请求
      userProfile: null,    // { name, avatar }
      resumeModalVisible: false,
      resumeFileName: '',
    };
    this.eventSource = null;
    this._autoSelectTimer = null;
    this.mainContainerRef = React.createRef();
  }

  componentDidMount() {
    // 查询是否显示全部请求
    fetch('/api/show-all')
      .then(res => res.json())
      .then(data => this.setState({ showAll: !!data.showAll }))
      .catch(() => {});

    // 获取系统用户头像和名字
    fetch('/api/user-profile')
      .then(res => res.json())
      .then(data => this.setState({ userProfile: data }))
      .catch(() => {});

    // 检查是否是通过 ?logfile= 打开的历史日志
    const params = new URLSearchParams(window.location.search);
    const logfile = params.get('logfile');
    if (logfile) {
      this.loadLocalLogFile(logfile);
    } else {
      this.initSSE();
    }
  }

  componentWillUnmount() {
    if (this.eventSource) this.eventSource.close();
    if (this._autoSelectTimer) clearTimeout(this._autoSelectTimer);
  }

  initSSE() {
    try {
      this.eventSource = new EventSource('/events');
      this.eventSource.onmessage = (event) => this.handleEventMessage(event);
      this.eventSource.addEventListener('resume_prompt', (event) => {
        try {
          const data = JSON.parse(event.data);
          this.setState({ resumeModalVisible: true, resumeFileName: data.recentFileName || '' });
        } catch {}
      });
      this.eventSource.addEventListener('resume_resolved', () => {
        this.setState({ resumeModalVisible: false, resumeFileName: '' });
      });
      this.eventSource.addEventListener('full_reload', (event) => {
        try {
          const entries = JSON.parse(event.data);
          if (Array.isArray(entries)) {
            let mainAgentSessions = [];
            for (const entry of entries) {
              if (entry.mainAgent && entry.body && Array.isArray(entry.body.messages)) {
                mainAgentSessions = this.mergeMainAgentSessions(mainAgentSessions, entry);
              }
            }
            const filtered = entries.filter(r =>
              !r.isHeartbeat && !/\/api\/eval\/sdk-/.test(r.url || '') && !/\/messages\/count_tokens/.test(r.url || '')
            );
            this.setState({
              requests: entries,
              selectedIndex: filtered.length > 0 ? filtered.length - 1 : null,
              mainAgentSessions,
            });
          }
        } catch {}
      });
      this.eventSource.onerror = () => console.error('SSE连接错误');
    } catch (error) {
      console.error('EventSource初始化失败:', error);
    }
  }

  loadLocalLogFile(file) {
    // 加载本地历史日志文件（非实时模式）
    this._isLocalLog = true;
    this._localLogFile = file;
    fetch(`/api/local-log?file=${encodeURIComponent(file)}`)
      .then(res => res.json())
      .then(entries => {
        if (Array.isArray(entries)) {
          // 合并 mainAgent sessions
          let mainAgentSessions = [];
          for (const entry of entries) {
            if (entry.mainAgent && entry.body && Array.isArray(entry.body.messages)) {
              mainAgentSessions = this.mergeMainAgentSessions(mainAgentSessions, entry);
            }
          }
          const filtered = entries.filter(r =>
            !r.isHeartbeat && !/\/api\/eval\/sdk-/.test(r.url || '') && !/\/messages\/count_tokens/.test(r.url || '')
          );
          this.setState({
            requests: entries,
            selectedIndex: filtered.length > 0 ? filtered.length - 1 : null,
            mainAgentSessions,
          });
        }
      })
      .catch(err => console.error('加载日志文件失败:', err));
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
                const filtered = s.showAll ? s.requests : s.requests.filter(r =>
                  !r.isHeartbeat && !/\/api\/eval\/sdk-/.test(r.url || '') && !/\/messages\/count_tokens/.test(r.url || '')
                );
                return filtered.length > 0 ? { selectedIndex: filtered.length - 1 } : null;
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

    // 消息数量大幅缩减（不到之前的一半且减少超过 4 条）视为新对话（/clear 等）
    const prevMsgCount = lastSession.messages ? lastSession.messages.length : 0;
    const isNewConversation = prevMsgCount > 0 && newMessages.length < prevMsgCount * 0.5 && (prevMsgCount - newMessages.length) > 4;

    if (userId && userId === lastSession.userId && !isNewConversation) {
      // 同一 session，更新最后一段
      // 保留已有的时间戳，新增消息或内容变化的消息用当前 entry 的时间戳
      const prevTs = lastSession.msgTimestamps || [];
      const prevMsgs = lastSession.messages || [];
      const msgTimestamps = newMessages.map((msg, i) => {
        if (i >= prevTs.length) return timestamp;
        // 如果消息内容发生了变化，更新时间戳
        const prevMsg = prevMsgs[i];
        if (prevMsg && msg.role === 'user' && prevMsg.role === 'user') {
          const prevContent = JSON.stringify(prevMsg.content);
          const newContent = JSON.stringify(msg.content);
          if (prevContent !== newContent) return timestamp;
        }
        return prevTs[i];
      });
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

  handleLangChange = () => {
    this.setState({ lang: getLang() });
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

  handleImportLocalLogs = () => {
    this.setState({ importModalVisible: true, localLogsLoading: true });
    fetch('/api/local-logs')
      .then(res => res.json())
      .then(data => {
        this.setState({ localLogs: data, localLogsLoading: false });
      })
      .catch(() => {
        this.setState({ localLogs: {}, localLogsLoading: false });
      });
  };

  handleCloseImportModal = () => {
    this.setState({ importModalVisible: false });
  };

  handleOpenLogFile = (file) => {
    // 在新窗口打开日志文件，避免覆盖当前监控窗口
    const port = window.location.port || window.location.host.split(':')[1] || '7008';
    window.open(`${window.location.protocol}//${window.location.hostname}:${port}?logfile=${encodeURIComponent(file)}`, '_blank');
    this.setState({ importModalVisible: false });
  };

  handleResumeChoice = (choice) => {
    fetch('/api/resume-choice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ choice }),
    }).catch(err => console.error('resume-choice failed:', err));
  };

  handleLoadLocalJsonlFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.jsonl';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 200 * 1024 * 1024) {
        message.error(t('ui.fileTooLarge'));
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const content = ev.target.result;
          const entries = content.split('\n---\n').filter(line => line.trim()).map(entry => {
            try { return JSON.parse(entry); } catch { return null; }
          }).filter(Boolean);
          if (entries.length === 0) {
            message.error(t('ui.noLogs'));
            return;
          }
          let mainAgentSessions = [];
          for (const entry of entries) {
            if (entry.mainAgent && entry.body && Array.isArray(entry.body.messages)) {
              mainAgentSessions = this.mergeMainAgentSessions(mainAgentSessions, entry);
            }
          }
          const filtered = entries.filter(r =>
            !r.isHeartbeat && !/\/api\/eval\/sdk-/.test(r.url || '') && !/\/messages\/count_tokens/.test(r.url || '')
          );
          this._isLocalLog = true;
          this._localLogFile = file.name;
          if (this.eventSource) { this.eventSource.close(); this.eventSource = null; }
          this.setState({
            requests: entries,
            selectedIndex: filtered.length > 0 ? filtered.length - 1 : null,
            mainAgentSessions,
            importModalVisible: false,
          });
        } catch (err) {
          message.error(t('ui.noLogs'));
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  formatTimestamp(ts) {
    // 20260217_224218 -> 2026-02-17 22:42:18
    if (!ts || ts.length < 15) return ts;
    return `${ts.slice(0,4)}-${ts.slice(4,6)}-${ts.slice(6,8)} ${ts.slice(9,11)}:${ts.slice(11,13)}:${ts.slice(13,15)}`;
  }

  formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  render() {
    const { requests, selectedIndex, viewMode, currentTab, cacheExpireAt, cacheType, leftPanelWidth, mainAgentSessions, showAll } = this.state;

    // 过滤心跳请求（eval/sdk-* 和 count_tokens），除非 showAll
    const filteredRequests = showAll ? requests : requests.filter(r =>
      !r.isHeartbeat && !/\/api\/eval\/sdk-/.test(r.url || '') && !/\/messages\/count_tokens/.test(r.url || '')
    );

    const selectedRequest = selectedIndex !== null ? filteredRequests[selectedIndex] : null;

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
        <Layout className={styles.layout}>
          <Layout.Header className={styles.header}>
            <AppHeader
              requestCount={filteredRequests.length}
              requests={filteredRequests}
              viewMode={viewMode}
              cacheExpireAt={cacheExpireAt}
              cacheType={cacheType}
              onToggleViewMode={this.handleToggleViewMode}
              onLangChange={this.handleLangChange}
              onImportLocalLogs={this.handleImportLocalLogs}
              isLocalLog={!!this._isLocalLog}
              localLogFile={this._localLogFile}
            />
          </Layout.Header>

          <Layout.Content className={styles.content}>
            {viewMode === 'raw' ? (
              <div
                ref={this.mainContainerRef}
                className={styles.mainContainer}
              >
                <div className={styles.leftPanel} style={{ width: leftPanelWidth }}>
                  <div className={styles.leftPanelHeader}>
                    <span>{t('ui.requestList')}</span>
                    <span className={styles.leftPanelCount}>{t('ui.totalRequests', { count: filteredRequests.length })}</span>
                  </div>
                  <div className={styles.leftPanelBody}>
                    <RequestList
                      requests={filteredRequests}
                      selectedIndex={selectedIndex}
                      onSelect={this.handleSelectRequest}
                    />
                  </div>
                </div>

                <PanelResizer onResize={this.handleResize} />

                <div className={styles.rightPanel}>
                  <DetailPanel
                    request={selectedRequest}
                    requests={filteredRequests}
                    selectedIndex={selectedIndex}
                    currentTab={currentTab}
                    onTabChange={this.handleTabChange}
                  />
                </div>
              </div>
            ) : (
              <ChatView requests={filteredRequests} mainAgentSessions={mainAgentSessions} userProfile={this.state.userProfile} />
            )}
          </Layout.Content>
        </Layout>

        <Modal
          title={t('ui.resume.title')}
          open={this.state.resumeModalVisible}
          closable={false}
          maskClosable={false}
          keyboard={false}
          footer={[
            <Button key="continue" type="primary" onClick={() => this.handleResumeChoice('continue')}>
              {t('ui.resume.continue')}
            </Button>,
            <Button key="new" onClick={() => this.handleResumeChoice('new')}>
              {t('ui.resume.new')}
            </Button>,
          ]}
        >
          <p>{t('ui.resume.message', { file: this.state.resumeFileName })}</p>
        </Modal>

        <Modal
          title={t('ui.importLocalLogs')}
          open={this.state.importModalVisible}
          onCancel={this.handleCloseImportModal}
          footer={null}
          width={600}
          styles={{ body: { maxHeight: '60vh', overflow: 'auto' } }}
        >
          <div className={styles.modalActions}>
            <Button icon={<UploadOutlined />} onClick={this.handleLoadLocalJsonlFile}>
              {t('ui.loadLocalJsonl')}
            </Button>
          </div>
          {this.state.localLogsLoading ? (
            <div className={styles.spinCenter}><Spin /></div>
          ) : Object.keys(this.state.localLogs).length === 0 ? (
            <div className={styles.emptyCenter}>
              {t('ui.noLogs')}
            </div>
          ) : (
            <Collapse
              defaultActiveKey={Object.keys(this.state.localLogs)}
              items={Object.entries(this.state.localLogs).map(([project, logs]) => ({
                key: project,
                label: (
                  <span>
                    <FolderOutlined className={styles.folderIcon} />
                    {project}
                    <Tag className={styles.logTag}>{t('ui.logCount', { count: logs.length })}</Tag>
                  </span>
                ),
                children: (
                  <List
                    size="small"
                    dataSource={logs}
                    renderItem={(log) => (
                      <List.Item
                        className={styles.logListItem}
                        onClick={() => this.handleOpenLogFile(log.file)}
                      >
                        <div className={styles.logItemRow}>
                          <span>
                            <FileTextOutlined className={styles.logFileIcon} />
                            {this.formatTimestamp(log.timestamp)}
                          </span>
                          <Tag color="blue">{this.formatSize(log.size)}</Tag>
                        </div>
                      </List.Item>
                    )}
                  />
                ),
              }))}
            />
          )}
        </Modal>
      </ConfigProvider>
    );
  }
}

export default App;
