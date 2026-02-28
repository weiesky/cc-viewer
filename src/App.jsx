import React from 'react';
import { ConfigProvider, Layout, theme, Modal, List, Tag, Spin, Button, Checkbox, message } from 'antd';
import { FileTextOutlined, UploadOutlined } from '@ant-design/icons';
import AppHeader from './components/AppHeader';
import RequestList from './components/RequestList';
import DetailPanel from './components/DetailPanel';
import ChatView from './components/ChatView';
import PanelResizer from './components/PanelResizer';
import { t, getLang, setLang } from './i18n';
import { formatTokenCount, filterRelevantRequests, findPrevMainAgentTimestamp } from './utils/helpers';
import { isMainAgent } from './utils/contentFilter';
import styles from './App.module.css';

class App extends React.Component {
  constructor(props) {
    super(props);
    // 从 localStorage 恢复缓存倒计时
    const savedExpireAt = parseInt(localStorage.getItem('ccv_cacheExpireAt'), 10) || null;
    const savedCacheType = localStorage.getItem('ccv_cacheType') || null;
    // 只恢复尚未过期的缓存
    const now = Date.now();
    const cacheExpireAt = savedExpireAt && savedExpireAt > now ? savedExpireAt : null;
    const cacheType = cacheExpireAt ? savedCacheType : null;
    this.state = {
      requests: [],
      selectedIndex: null,
      viewMode: 'raw',
      currentTab: 'request',
      cacheExpireAt,
      cacheType,
      leftPanelWidth: 380,
      mainAgentSessions: [], // [{ messages, response }]
      importModalVisible: false,
      localLogs: {},       // { projectName: [{file, timestamp, size}] }
      localLogsLoading: false,
      showAll: false,
      lang: getLang(),      // 是否显示心跳请求
      userProfile: null,    // { name, avatar }
      projectName: '',      // 当前监控的项目名称
      resumeModalVisible: false,
      resumeFileName: '',
      collapseToolResults: true,
      expandThinking: true,
      expandDiff: false,
      fileLoading: false,
      fileLoadingCount: 0,
      selectedLogs: new Set(),   // Set<file>
    };
    this.eventSource = null;
    this._autoSelectTimer = null;
    this.mainContainerRef = React.createRef();
  }

  componentDidMount() {
    // 获取用户偏好设置（包含 filterIrrelevant）
    fetch('/api/preferences')
      .then(res => res.json())
      .then(data => {
        if (data.lang) {
          setLang(data.lang);
          this.setState({ lang: data.lang });
        }
        if (data.collapseToolResults !== undefined) {
          this.setState({ collapseToolResults: !!data.collapseToolResults });
        }
        if (data.expandThinking !== undefined) {
          this.setState({ expandThinking: !!data.expandThinking });
        }
        if (data.expandDiff !== undefined) {
          this.setState({ expandDiff: !!data.expandDiff });
        }
        // filterIrrelevant 默认 true，showAll = !filterIrrelevant
        const filterIrrelevant = data.filterIrrelevant !== undefined ? !!data.filterIrrelevant : true;
        this.setState({ showAll: !filterIrrelevant });
      })
      .catch(() => { });

    // 获取系统用户头像和名字
    fetch('/api/user-profile')
      .then(res => res.json())
      .then(data => this.setState({ userProfile: data }))
      .catch(() => { });

    // 获取当前监控的项目名称
    fetch('/api/project-name')
      .then(res => res.json())
      .then(data => this.setState({ projectName: data.projectName || '' }))
      .catch(() => { });

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
    if (this._loadingCountTimer) cancelAnimationFrame(this._loadingCountTimer);
  }

  animateLoadingCount(target, onDone) {
    const duration = Math.min(800, Math.max(300, target * 0.5));
    const start = performance.now();
    const step = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      const current = Math.round(progress * target);
      this.setState({ fileLoadingCount: current });
      if (progress < 1) {
        this._loadingCountTimer = requestAnimationFrame(step);
      } else {
        this._loadingCountTimer = null;
        onDone();
      }
    };
    this._loadingCountTimer = requestAnimationFrame(step);
  }

  initSSE() {
    this.setState({ fileLoading: true, fileLoadingCount: 0 });
    try {
      this.eventSource = new EventSource('/events');
      this.eventSource.onmessage = (event) => this.handleEventMessage(event);
      this.eventSource.addEventListener('resume_prompt', (event) => {
        try {
          const data = JSON.parse(event.data);
          this.setState({ resumeModalVisible: true, resumeFileName: data.recentFileName || '' });
        } catch { }
      });
      this.eventSource.addEventListener('resume_resolved', () => {
        this.setState({ resumeModalVisible: false, resumeFileName: '' });
      });
      this.eventSource.addEventListener('update_completed', (event) => {
        try {
          const data = JSON.parse(event.data);
          this.setState({ updateInfo: { type: 'completed', version: data.version } });
        } catch { }
      });
      this.eventSource.addEventListener('update_major_available', (event) => {
        try {
          const data = JSON.parse(event.data);
          this.setState({ updateInfo: { type: 'major', version: data.version } });
        } catch { }
      });
      this.eventSource.addEventListener('full_reload', (event) => {
        try {
          const entries = JSON.parse(event.data);
          if (Array.isArray(entries)) {
            this.assignMessageTimestamps(entries);
            const mainAgentSessions = this.buildSessionsFromEntries(entries);
            const filtered = filterRelevantRequests(entries);
            if (entries.length > 0) {
              this.animateLoadingCount(entries.length, () => {
                this.setState({
                  requests: entries,
                  selectedIndex: filtered.length > 0 ? filtered.length - 1 : null,
                  mainAgentSessions,
                  fileLoading: false,
                  fileLoadingCount: 0,
                });
              });
            } else {
              this.setState({
                requests: entries,
                selectedIndex: null,
                mainAgentSessions,
                fileLoading: false,
                fileLoadingCount: 0,
              });
            }
          } else {
            this.setState({ fileLoading: false, fileLoadingCount: 0 });
          }
        } catch {
          this.setState({ fileLoading: false, fileLoadingCount: 0 });
        }
      });
      this.eventSource.onerror = () => console.error('SSE连接错误');
    } catch (error) {
      console.error('EventSource初始化失败:', error);
      this.setState({ fileLoading: false, fileLoadingCount: 0 });
    }
  }

  loadLocalLogFile(file) {
    // 加载本地历史日志文件（非实时模式）
    this._isLocalLog = true;
    this._localLogFile = file;
    this.setState({ fileLoading: true, fileLoadingCount: 0 });
    fetch(`/api/local-log?file=${encodeURIComponent(file)}`)
      .then(res => res.json())
      .then(entries => {
        if (Array.isArray(entries)) {
          this.animateLoadingCount(entries.length, () => {
            this.assignMessageTimestamps(entries);
            const mainAgentSessions = this.buildSessionsFromEntries(entries);
            const filtered = filterRelevantRequests(entries);
            this.setState({
              requests: entries,
              selectedIndex: filtered.length > 0 ? filtered.length - 1 : null,
              mainAgentSessions,
              fileLoading: false,
              fileLoadingCount: 0,
            });
          });
        } else {
          this.setState({ fileLoading: false, fileLoadingCount: 0 });
        }
      })
      .catch(err => {
        console.error('加载日志文件失败:', err);
        this.setState({ fileLoading: false, fileLoadingCount: 0 });
      });
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
        if (isMainAgent(entry)) {
          const usage = entry.response?.body?.usage;
          if (usage?.cache_creation) {
            const cc = usage.cache_creation;
            // 基于请求时间计算过期时间，而非当前时间
            const reqTime = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now();
            let newExpireAt = null;
            let newType = null;
            if (cc.ephemeral_1h_input_tokens > 0) {
              newExpireAt = reqTime + 3600 * 1000;
              newType = '1h';
            } else if (cc.ephemeral_5m_input_tokens > 0) {
              newExpireAt = reqTime + 5 * 60 * 1000;
              newType = '5m';
            }
            if (newExpireAt && newExpireAt > Date.now()) {
              cacheExpireAt = newExpireAt;
              // 计算最后一条 mainAgent 的 cache read + creation token 总和
              const cacheTotal = (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
              cacheType = cacheTotal > 0 ? formatTokenCount(cacheTotal) : newType;
              localStorage.setItem('ccv_cacheExpireAt', String(cacheExpireAt));
              localStorage.setItem('ccv_cacheType', cacheType);
            }
          }
        }

        // 合并 mainAgent sessions
        let mainAgentSessions = prev.mainAgentSessions;
        if (isMainAgent(entry) && entry.body && Array.isArray(entry.body.messages)) {
          const timestamp = entry.timestamp || new Date().toISOString();
          const lastSession = mainAgentSessions.length > 0 ? mainAgentSessions[mainAgentSessions.length - 1] : null;
          const prevMessages = lastSession?.messages || [];
          const messages = entry.body.messages;
          const prevCount = prevMessages.length;

          // 检测 session 切换（消息数量骤降）
          const isNewSession = prevCount > 0 && messages.length < prevCount * 0.5 && (prevCount - messages.length) > 4;

          for (let i = 0; i < messages.length; i++) {
            if (!isNewSession && i < prevCount && prevMessages[i]._timestamp) {
              messages[i]._timestamp = prevMessages[i]._timestamp;
            } else if (!messages[i]._timestamp) {
              messages[i]._timestamp = timestamp;
            }
          }
          mainAgentSessions = this.mergeMainAgentSessions(prev.mainAgentSessions, entry);
        }

        let selectedIndex = prev.selectedIndex;

        // 没有选中状态时，等初始数据加载完后选中最后一条
        if (selectedIndex === null && requests.length > 0) {
          if (this._autoSelectTimer) clearTimeout(this._autoSelectTimer);
          this._autoSelectTimer = setTimeout(() => {
            this.setState(s => {
              if (s.selectedIndex === null && s.requests.length > 0) {
                const filtered = s.showAll ? s.requests : filterRelevantRequests(s.requests);
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
   * 前置处理：遍历所有 MainAgent entries，根据消息数量递增关系，
   * 给每条消息注入 _timestamp（首次出现时的 entry.timestamp）。
   */
  assignMessageTimestamps(entries) {
    let timestamps = []; // 累积的时间戳数组，索引对应消息位置
    let prevUserId = null;
    for (const entry of entries) {
      if (!isMainAgent(entry) || !entry.body || !Array.isArray(entry.body.messages)) continue;
      const messages = entry.body.messages;
      const count = messages.length;
      const userId = entry.body.metadata?.user_id || null;
      const timestamp = entry.timestamp || new Date().toISOString();

      // 检测 session 切换：消息数量骤降或 userId 变化
      const prevCount = timestamps.length;
      const isNewSession = prevCount > 0 && (
        (count < prevCount * 0.5 && (prevCount - count) > 4) ||
        (prevUserId && userId && userId !== prevUserId)
      );
      if (isNewSession) {
        timestamps = [];
      }

      // 新增的消息用当前 entry.timestamp
      for (let i = timestamps.length; i < count; i++) {
        timestamps.push(timestamp);
      }

      // 把累积的时间戳写入当前 entry 的所有消息（每个 entry 的 messages 是独立对象）
      for (let i = 0; i < count; i++) {
        messages[i]._timestamp = timestamps[i];
      }
      prevUserId = userId;
    }
  }

  /**
   * 从批量 entries 构建 sessions。
   * 消息时间戳已由 assignMessageTimestamps 预先注入到 message._timestamp。
   */
  buildSessionsFromEntries(entries) {
    let sessions = [];
    for (const entry of entries) {
      if (isMainAgent(entry) && entry.body && Array.isArray(entry.body.messages)) {
        sessions = this.mergeMainAgentSessions(sessions, entry);
      }
    }
    return sessions;
  }

  /**
   * 合并 mainAgent sessions。
   * 通过 metadata.user_id 判断 session 归属，
   * user_id 变化时（/clear、session 切换等）新开一段，否则更新当前段。
   * 消息时间戳已由 assignMessageTimestamps 预先注入到 message._timestamp。
   */
  mergeMainAgentSessions(prevSessions, entry) {
    const newMessages = entry.body.messages;
    const newResponse = entry.response;
    const userId = entry.body.metadata?.user_id || null;

    const entryTimestamp = entry.timestamp || null;

    if (prevSessions.length === 0) {
      return [{ userId, messages: newMessages, response: newResponse, entryTimestamp }];
    }

    const lastSession = prevSessions[prevSessions.length - 1];

    // 消息数量大幅缩减（不到之前的一半且减少超过 4 条）视为新对话（/clear 等）
    const prevMsgCount = lastSession.messages ? lastSession.messages.length : 0;
    const isNewConversation = prevMsgCount > 0 && newMessages.length < prevMsgCount * 0.5 && (prevMsgCount - newMessages.length) > 4;

    if (userId && userId === lastSession.userId && !isNewConversation) {
      const updated = [...prevSessions];
      updated[updated.length - 1] = { userId, messages: newMessages, response: newResponse, entryTimestamp };
      return updated;
    } else {
      return [...prevSessions, { userId, messages: newMessages, response: newResponse, entryTimestamp }];
    }
  }

  handleSelectRequest = (index) => {
    this.setState({ selectedIndex: index, scrollCenter: false });
  };

  handleViewRequest = (index) => {
    this.setState({ viewMode: 'raw', selectedIndex: index, scrollCenter: true });
  };

  handleViewInChat = () => {
    this.setState(prev => {
      const filteredRequests = prev.showAll ? prev.requests : filterRelevantRequests(prev.requests);
      const selectedReq = filteredRequests[prev.selectedIndex];
      if (!selectedReq) return null;
      let targetTs = null;
      if (isMainAgent(selectedReq) && selectedReq.timestamp) {
        targetTs = selectedReq.timestamp;
      } else {
        const idx = prev.requests.indexOf(selectedReq);
        if (idx >= 0) {
          targetTs = findPrevMainAgentTimestamp(prev.requests, idx);
        }
        if (!targetTs) {
          message.info(t('ui.cannotMap'));
        }
      }
      return { viewMode: 'chat', chatScrollToTs: targetTs };
    });
  };

  handleToggleViewMode = () => {
    this.setState(prev => {
      const newMode = prev.viewMode === 'raw' ? 'chat' : 'raw';
      if (newMode === 'raw') {
        // 从对话模式切回 raw 模式
        if (prev.selectedIndex === null) {
          const filtered = prev.showAll ? prev.requests : filterRelevantRequests(prev.requests);
          return {
            viewMode: newMode,
            selectedIndex: filtered.length > 0 ? filtered.length - 1 : null,
            scrollCenter: true,
          };
        }
        return { viewMode: newMode, scrollCenter: true };
      }
      // raw → chat：根据选中的请求定位到对话
      const filtered = prev.showAll ? prev.requests : filterRelevantRequests(prev.requests);
      const selectedReq = prev.selectedIndex != null ? filtered[prev.selectedIndex] : null;
      if (selectedReq) {
        // 找到选中请求对应的 mainAgent timestamp
        let targetTs = null;
        if (isMainAgent(selectedReq) && selectedReq.timestamp) {
          targetTs = selectedReq.timestamp;
        } else {
          // 非 mainAgent 请求，向前找最近的 mainAgent
          const idx = prev.requests.indexOf(selectedReq);
          if (idx >= 0) {
            targetTs = findPrevMainAgentTimestamp(prev.requests, idx);
          }
          if (!targetTs) {
            message.info(t('ui.cannotMap'));
          }
        }
        return { viewMode: newMode, chatScrollToTs: targetTs };
      }
      return { viewMode: newMode, chatScrollToTs: null };
    });
  };

  handleLangChange = () => {
    const lang = getLang();
    this.setState({ lang });
    fetch('/api/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang }),
    }).catch(() => { });
  };

  handleCollapseToolResultsChange = (checked) => {
    this.setState({ collapseToolResults: checked });
    fetch('/api/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collapseToolResults: checked }),
    }).catch(() => { });
  };

  handleExpandThinkingChange = (checked) => {
    this.setState({ expandThinking: checked });
    fetch('/api/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expandThinking: checked }),
    }).catch(() => { });
  };

  handleExpandDiffChange = (checked) => {
    this.setState({ expandDiff: checked });
    fetch('/api/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expandDiff: checked }),
    }).catch(() => { });
  };

  handleFilterIrrelevantChange = (checked) => {
    this.setState(prev => {
      const newShowAll = !checked;
      const newFiltered = newShowAll ? prev.requests : filterRelevantRequests(prev.requests);
      return {
        showAll: newShowAll,
        selectedIndex: newFiltered.length > 0 ? newFiltered.length - 1 : null,
      };
    });
    fetch('/api/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filterIrrelevant: checked }),
    }).catch(() => { });
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
        const { _currentProject, ...logs } = data;
        this.setState({ localLogs: logs, currentProject: _currentProject || '', localLogsLoading: false });
      })
      .catch(() => {
        this.setState({ localLogs: {}, localLogsLoading: false });
      });
  };

  handleCloseImportModal = () => {
    this.setState({ importModalVisible: false, selectedLogs: new Set() });
  };

  handleToggleLogSelect = (file, checked) => {
    this.setState(prev => {
      const selectedLogs = new Set(prev.selectedLogs);
      if (checked) selectedLogs.add(file);
      else selectedLogs.delete(file);
      return { selectedLogs };
    });
  };

  handleMergeLogs = () => {
    const { selectedLogs, localLogs, currentProject } = this.state;
    if (selectedLogs.size < 2) return;

    const logs = localLogs[currentProject];
    if (!logs) return;

    // 找到选中项在原始列表中的索引
    const indices = [];
    logs.forEach((log, i) => {
      if (selectedLogs.has(log.file)) indices.push(i);
    });
    indices.sort((a, b) => a - b);

    // 校验：最新日志文件不允许被合并（避免当前窗口日志丢失）
    if (selectedLogs.has(logs[0].file)) {
      message.warning(t('ui.mergeLatestNotAllowed'));
      return;
    }

    // 校验连续性
    for (let i = 1; i < indices.length; i++) {
      if (indices[i] - indices[i - 1] !== 1) {
        message.warning(t('ui.mergeNotConsecutive'));
        return;
      }
    }

    // 校验大小 ≤ 500MB
    const totalSize = indices.reduce((sum, i) => sum + logs[i].size, 0);
    if (totalSize > 500 * 1024 * 1024) {
      message.warning(t('ui.mergeTooLarge'));
      return;
    }

    // 按时间正序排列文件（原始列表是降序，所以反转选中的）
    const files = indices.map(i => logs[i].file).reverse();

    fetch('/api/merge-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
    })
      .then(res => res.json())
      .then(data => {
        if (data.ok) {
          message.success(t('ui.mergeSuccess'));
          this.setState({ selectedLogs: new Set() });
          this.handleImportLocalLogs();
        } else {
          message.error(data.error || 'Merge failed');
        }
      })
      .catch(() => message.error('Merge failed'));
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
      if (file.size > 500 * 1024 * 1024) {
        message.error(t('ui.fileTooLarge'));
        return;
      }
      this.setState({ fileLoading: true, fileLoadingCount: 0 });
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const content = ev.target.result;
          const entries = content.split('\n---\n').filter(line => line.trim()).map(entry => {
            try { return JSON.parse(entry); } catch { return null; }
          }).filter(Boolean);
          if (entries.length === 0) {
            message.error(t('ui.noLogs'));
            this.setState({ fileLoading: false, fileLoadingCount: 0 });
            return;
          }
          this.animateLoadingCount(entries.length, () => {
            let mainAgentSessions = [];
            for (const entry of entries) {
              if (isMainAgent(entry) && entry.body && Array.isArray(entry.body.messages)) {
                mainAgentSessions = this.mergeMainAgentSessions(mainAgentSessions, entry);
              }
            }
            const filtered = filterRelevantRequests(entries);
            this._isLocalLog = true;
            this._localLogFile = file.name;
            if (this.eventSource) { this.eventSource.close(); this.eventSource = null; }
            this.setState({
              requests: entries,
              selectedIndex: filtered.length > 0 ? filtered.length - 1 : null,
              mainAgentSessions,
              importModalVisible: false,
              fileLoading: false,
              fileLoadingCount: 0,
            });
          });
        } catch (err) {
          message.error(t('ui.noLogs'));
          this.setState({ fileLoading: false, fileLoadingCount: 0 });
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  formatTimestamp(ts) {
    // 20260217_224218 -> 2026-02-17 22:42:18
    if (!ts || ts.length < 15) return ts;
    return `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)} ${ts.slice(9, 11)}:${ts.slice(11, 13)}:${ts.slice(13, 15)}`;
  }

  formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  render() {
    const { requests, selectedIndex, viewMode, currentTab, cacheExpireAt, cacheType, leftPanelWidth, mainAgentSessions, showAll, fileLoading, fileLoadingCount } = this.state;

    // 过滤心跳请求（eval/sdk-* 和 count_tokens），除非 showAll
    const filteredRequests = showAll ? requests : filterRelevantRequests(requests);

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
        {fileLoading && (
          <div className={styles.loadingOverlay}>
            <div className={styles.loadingText}>Loading...({fileLoadingCount})</div>
          </div>
        )}
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
              projectName={this.state.projectName}
              collapseToolResults={this.state.collapseToolResults}
              onCollapseToolResultsChange={this.handleCollapseToolResultsChange}
              expandThinking={this.state.expandThinking}
              onExpandThinkingChange={this.handleExpandThinkingChange}
              expandDiff={this.state.expandDiff}
              onExpandDiffChange={this.handleExpandDiffChange}
              filterIrrelevant={!this.state.showAll}
              onFilterIrrelevantChange={this.handleFilterIrrelevantChange}
              updateInfo={this.state.updateInfo}
              onDismissUpdate={() => this.setState({ updateInfo: null })}
            />
          </Layout.Header>

          <Layout.Content className={styles.content}>
            {viewMode === 'raw' ? (
              filteredRequests.length === 0 ? (
                <div className={styles.guideContainer}>
                  <div className={styles.guideContent}>
                    <div className={styles.guideIcon}>
                      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                        <circle cx="24" cy="24" r="23" stroke="#333" strokeWidth="2" strokeDasharray="4 4" />
                        <path d="M16 24h16M24 16v16" stroke="#555" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </div>
                    <h2 className={styles.guideTitle}>{t('ui.guide.title')}</h2>

                    <div className={styles.guideStep}>
                      <div className={styles.guideStepNum}>1</div>
                      <div className={styles.guideStepBody}>
                        <p className={styles.guideText}>{t('ui.guide.step1')}</p>
                        <code className={styles.guideCode}>{t('ui.guide.exampleQuestion')}</code>
                      </div>
                    </div>

                    <div className={styles.guideStep}>
                      <div className={styles.guideStepNum}>2</div>
                      <div className={styles.guideStepBody}>
                        <p className={styles.guideText}>{t('ui.guide.step2')}</p>
                        <code className={styles.guideCode}>{t('ui.guide.troubleshootCmd')}</code>
                      </div>
                    </div>

                    <div className={styles.guideStep}>
                      <div className={styles.guideStepNum}>3</div>
                      <div className={styles.guideStepBody}>
                        <p className={styles.guideText}>{t('ui.guide.step3')}</p>
                        <code className={styles.guideCode}>npm install -g @anthropic-ai/claude-code</code>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
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
                      scrollCenter={this.state.scrollCenter}
                      onSelect={this.handleSelectRequest}
                      onScrollDone={() => this.setState({ scrollCenter: false })}
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
                    onViewInChat={this.handleViewInChat}
                    expandDiff={this.state.expandDiff}
                  />
                </div>
              </div>
              )
            ) : (
              <ChatView requests={filteredRequests} mainAgentSessions={mainAgentSessions} userProfile={this.state.userProfile} collapseToolResults={this.state.collapseToolResults} expandThinking={this.state.expandThinking} onViewRequest={this.handleViewRequest} scrollToTimestamp={this.state.chatScrollToTs} onScrollTsDone={() => this.setState({ chatScrollToTs: null })} />
            )}
          </Layout.Content>
          <div className={styles.footer}>
            <div className={styles.footerRight}>
              <a href="https://github.com/weiesky/cc-viewer" target="_blank" rel="noopener noreferrer" className={styles.footerLink}>
                <svg className={styles.footerIcon} viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>
                GitHub
              </a>
              <span className={styles.footerDivider}>|</span>
              <a href="dingtalk://dingtalkclient/action/sendmsg?dingtalk_id=sthk5es" className={styles.footerLink}>{t('ui.footer.contact')}</a>
            </div>
          </div>
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
          width={1000}
          styles={{ body: { maxHeight: '60vh', overflow: 'auto' } }}
        >
          <div className={styles.modalActions}>
            <Button icon={<UploadOutlined />} onClick={this.handleLoadLocalJsonlFile}>
              {t('ui.loadLocalJsonl')}
            </Button>
            {this.state.selectedLogs.size > 1 && (
              <Button
                size="small"
                type="primary"
                onClick={this.handleMergeLogs}
                style={{ marginLeft: 8 }}
              >
                {t('ui.mergeLogs')}
              </Button>
            )}
          </div>
          {this.state.localLogsLoading ? (
            <div className={styles.spinCenter}><Spin /></div>
          ) : (() => {
            const currentLogs = this.state.localLogs[this.state.currentProject];
            if (!currentLogs || currentLogs.length === 0) {
              return (
                <div className={styles.emptyCenter}>
                  {t('ui.noLogs')}
                </div>
              );
            }
            return (
              <div className={styles.logListContainer}>
                <List
                  size="small"
                  dataSource={currentLogs}
                  renderItem={(log) => (
                  <List.Item
                    className={styles.logListItem}
                    onClick={() => {
                      const checked = !this.state.selectedLogs.has(log.file);
                      this.handleToggleLogSelect(log.file, checked);
                    }}
                  >
                    <div className={styles.logItemRow}>
                      <span>
                        <Checkbox
                          className={styles.logCheckbox}
                          checked={this.state.selectedLogs.has(log.file) || false}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            e.stopPropagation();
                            this.handleToggleLogSelect(log.file, e.target.checked);
                          }}
                        />
                        <FileTextOutlined className={styles.logFileIcon} />
                        <span className={styles.logFileName}>{this.formatTimestamp(log.timestamp)}</span>
                      </span>
                      <span>
                        <Tag color="blue">{this.formatSize(log.size)}</Tag>
                        <Button size="small" type="primary" onClick={(e) => { e.stopPropagation(); this.handleOpenLogFile(log.file); }}>
                          {t('ui.openLog')}
                        </Button>
                      </span>
                    </div>
                  </List.Item>
                )}
              />
              </div>
            );
          })()}
        </Modal>
      </ConfigProvider>
    );
  }
}

export default App;
