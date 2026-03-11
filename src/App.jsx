import React from 'react';
import { ConfigProvider, Layout, theme, Modal, Table, Tag, Spin, Button, Checkbox, Badge, Switch, message } from 'antd';
import { UploadOutlined, MessageOutlined, BranchesOutlined, DownloadOutlined, DeleteOutlined, RollbackOutlined } from '@ant-design/icons';
import { isMobile, isIOS } from './env';
import AppHeader from './components/AppHeader';
import RequestList from './components/RequestList';
import DetailPanel from './components/DetailPanel';
import ChatView from './components/ChatView';
import TerminalPanel from './components/TerminalPanel';
import PanelResizer from './components/PanelResizer';
import MobileGitDiff from './components/MobileGitDiff';
import MobileStats from './components/MobileStats';
import WorkspaceList from './components/WorkspaceList';
import { t, getLang, setLang } from './i18n';
import { formatTokenCount, filterRelevantRequests, findPrevMainAgentTimestamp } from './utils/helpers';
import { isMainAgent, isSystemText, classifyUserContent } from './utils/contentFilter';
import { classifyRequest } from './utils/requestType';
import styles from './App.module.css';
import { apiUrl } from './utils/apiUrl';
import { saveEntries, loadEntries, clearEntries, getCacheMeta } from './utils/entryCache';

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
      githubStars: null,
      cliMode: false,
      terminalVisible: true,
      workspaceMode: false,
      mobileMenuVisible: false,
      mobileLogMgmtVisible: false,
      mobileSettingsVisible: false,
      mobilePromptVisible: false,
    };
    this.eventSource = null;
    this._autoSelectTimer = null;
    this._chunkedEntries = [];   // 分段加载缓冲
    this._chunkedTotal = 0;
    this.mainContainerRef = React.createRef();
    this._layoutRef = React.createRef();
  }

  componentDidMount() {
    // iOS 虚拟键盘弹出时，Safari 会滚动整个文档将页面上推，
    // 导致导航栏消失在视口之外。通过 visualViewport 的 resize + scroll
    // 事件同步可见区域的高度和偏移，用 fixed 定位将布局锁定在可见区域内。
    if (isIOS && window.visualViewport) {
      this._onVisualViewportChange = () => {
        const el = this._layoutRef.current;
        if (!el) return;
        const vv = window.visualViewport;
        el.style.position = 'fixed';
        el.style.top = `${vv.offsetTop}px`;
        el.style.height = `${vv.height}px`;
        el.style.width = '100%';
        el.style.left = '0';
      };
      window.visualViewport.addEventListener('resize', this._onVisualViewportChange);
      window.visualViewport.addEventListener('scroll', this._onVisualViewportChange);
      this._onVisualViewportChange();
    }

    // 获取用户偏好设置（包含 filterIrrelevant）
    fetch(apiUrl('/api/preferences'))
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
    fetch(apiUrl('/api/user-profile'))
      .then(res => res.json())
      .then(data => this.setState({ userProfile: data }))
      .catch(() => { });

    // 获取当前监控的项目名称
    const params = new URLSearchParams(window.location.search);
    const logfile = params.get('logfile');
    fetch(apiUrl('/api/project-name'))
      .then(res => res.json())
      .then(data => {
        const projectName = data.projectName || '';
        this.setState({ projectName });
        // 移动端：从缓存恢复数据，在 SSE 数据到达前立即渲染
        if (isMobile && projectName && !logfile && this.state.requests.length === 0) {
          loadEntries(projectName).then(cached => {
            if (cached && this.state.requests.length === 0) {
              this.assignMessageTimestamps(cached);
              const mainAgentSessions = this.buildSessionsFromEntries(cached);
              const filtered = filterRelevantRequests(cached);
              this.setState({
                requests: cached,
                selectedIndex: filtered.length > 0 ? filtered.length - 1 : null,
                mainAgentSessions,
                fileLoading: false,
              });
            }
          });
        }
      })
      .catch(() => { });

    // 获取 GitHub star 数
    fetch('https://api.github.com/repos/weiesky/cc-viewer')
      .then(res => res.json())
      .then(data => { if (data.stargazers_count != null) this.setState({ githubStars: data.stargazers_count }); })
      .catch(() => { });

    // 检测 CLI 模式 / 工作区模式
    fetch(apiUrl('/api/cli-mode'))
      .then(res => res.json())
      .then(data => {
        if (data.workspaceMode) {
          this.setState({ cliMode: true, workspaceMode: true, isWorkspaceServer: true });
        } else if (data.cliMode) {
          this.setState({ cliMode: true, viewMode: 'chat' });
        }
      })
      .catch(() => { });

    // 检查是否是通过 ?logfile= 打开的历史日志
    if (logfile) {
      this.loadLocalLogFile(logfile);
    } else {
      // 工作区模式下延迟到选择工作区后再初始化 SSE
      // 需要等 /api/cli-mode 返回才知道是否是工作区模式
      // 因此先正常初始化，initSSE 内部会处理工作区模式的 SSE 事件
      this.initSSE();
    }
  }

  componentWillUnmount() {
    if (this._onVisualViewportChange && window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this._onVisualViewportChange);
      window.visualViewport.removeEventListener('scroll', this._onVisualViewportChange);
    }
    if (this.eventSource) this.eventSource.close();
    if (this._autoSelectTimer) clearTimeout(this._autoSelectTimer);
    if (this._loadingCountTimer) cancelAnimationFrame(this._loadingCountTimer);
    if (this._cacheSaveTimer) clearTimeout(this._cacheSaveTimer);
  }

  animateLoadingCount(target, onDone) {
    if (this._loadingCountTimer) {
      cancelAnimationFrame(this._loadingCountTimer);
      this._loadingCountTimer = null;
    }
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
    try {
      // 尝试使用缓存元数据进行增量加载
      let url = '/events';
      let hasCache = false;
      if (isMobile) {
        const meta = getCacheMeta();
        if (meta && meta.lastTs && meta.count > 0) {
          url = `/events?since=${encodeURIComponent(meta.lastTs)}&cc=${meta.count}`;
          hasCache = true;
        }
      }
      // 只有在无缓存时才显示 loading 遮罩
      if (!hasCache) {
        this.setState({ fileLoading: true, fileLoadingCount: 0 });
      }
      this.eventSource = new EventSource(apiUrl(url));
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
      this.eventSource.addEventListener('load_start', (event) => {
        try {
          const data = JSON.parse(event.data);
          this._chunkedEntries = [];
          this._chunkedTotal = data.total || 0;
          this._isIncremental = !!data.incremental;
          // 增量模式下已有缓存数据在显示，不需要 loading 遮罩
          if (!this._isIncremental) {
            this.setState({ fileLoading: true, fileLoadingCount: 0 });
          }
        } catch { }
      });
      this.eventSource.addEventListener('load_chunk', (event) => {
        try {
          const chunk = JSON.parse(event.data);
          if (Array.isArray(chunk)) {
            this._chunkedEntries.push(...chunk);
            // 增量模式下静默累积，不更新 loading 计数
            if (!this._isIncremental) {
              this.setState({ fileLoadingCount: this._chunkedEntries.length });
            }
          }
        } catch { }
      });
      this.eventSource.addEventListener('load_end', () => {
        const delta = this._chunkedEntries;
        this._chunkedEntries = [];
        this._chunkedTotal = 0;
        const isIncremental = this._isIncremental;
        this._isIncremental = false;

        // 增量模式：将增量数据拼接到已有缓存后面
        const entries = (isIncremental && isMobile && this.state.requests.length > 0)
          ? [...this.state.requests, ...delta]
          : delta;

        if (Array.isArray(entries) && entries.length > 0) {
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
          if (isMobile && this.state.projectName) {
            saveEntries(this.state.projectName, entries);
          }
        } else {
          this.setState({ fileLoading: false, fileLoadingCount: 0 });
        }
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
                if (isMobile && this.state.projectName) {
                  saveEntries(this.state.projectName, entries);
                }
              });
            } else {
              this.setState({
                requests: entries,
                selectedIndex: null,
                mainAgentSessions,
                fileLoading: false,
                fileLoadingCount: 0,
              });
              if (isMobile) clearEntries();
            }
          } else {
            this.setState({ fileLoading: false, fileLoadingCount: 0 });
          }
        } catch {
          this.setState({ fileLoading: false, fileLoadingCount: 0 });
        }
      });
      // 工作区模式事件
      this.eventSource.addEventListener('workspace_started', (event) => {
        try {
          const data = JSON.parse(event.data);
          // 取消旧动画，防止旧 full_reload 回调覆盖新数据
          if (this._loadingCountTimer) {
            cancelAnimationFrame(this._loadingCountTimer);
            this._loadingCountTimer = null;
          }
          this.setState({
            workspaceMode: false,
            projectName: data.projectName || '',
            viewMode: 'chat',
            cliMode: true,
            requests: [],
            mainAgentSessions: [],
            selectedIndex: null,
          });
          if (isMobile) clearEntries();
        } catch {}
      });
      this.eventSource.addEventListener('workspace_stopped', () => {
        this.setState({
          workspaceMode: true,
          requests: [],
          mainAgentSessions: [],
          projectName: '',
          selectedIndex: null,
        });
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
      .then(res => {
        // 检查响应状态和 Content-Type
        if (!res.ok) {
          return res.text().then(text => {
            throw new Error(`HTTP ${res.status}: ${text}`);
          });
        }
        const contentType = res.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          return res.text().then(text => {
            throw new Error(`Invalid content type: ${contentType}. Response: ${text.substring(0, 100)}`);
          });
        }
        return res.json();
      })
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
      }, () => {
        // 移动端：防抖 5s 批量写入缓存
        if (isMobile && this.state.projectName) {
          if (this._cacheSaveTimer) clearTimeout(this._cacheSaveTimer);
          this._cacheSaveTimer = setTimeout(() => {
            if (this.state.projectName) saveEntries(this.state.projectName, this.state.requests);
          }, 5000);
        }
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
        // SubAgent 请求直接用自身 timestamp
        const cls = classifyRequest(selectedReq);
        if (cls.type === 'SubAgent' && selectedReq.timestamp) {
          targetTs = selectedReq.timestamp;
        } else {
          const idx = prev.requests.indexOf(selectedReq);
          if (idx >= 0) {
            targetTs = findPrevMainAgentTimestamp(prev.requests, idx);
          }
        }
        if (!targetTs) {
          message.info(t('ui.cannotMap'));
        }
      }
      return { viewMode: 'chat', chatScrollToTs: targetTs };
    });
  };

  handleWorkspaceLaunch = ({ projectName }) => {
    this._isLocalLog = false;
    this._localLogFile = null;
    this.setState({
      workspaceMode: false,
      projectName,
      viewMode: 'chat',
      cliMode: true,
    });
  };

  handleReturnToWorkspaces = () => {
    fetch(apiUrl('/api/workspaces/stop'), { method: 'POST' })
      .then(() => {
        this.setState({
          workspaceMode: true,
          requests: [],
          mainAgentSessions: [],
          projectName: '',
          selectedIndex: null,
        });
      })
      .catch(() => {});
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
          // SubAgent 请求直接用自身 timestamp
          const cls = classifyRequest(selectedReq);
          if (cls.type === 'SubAgent' && selectedReq.timestamp) {
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
        }
        return { viewMode: newMode, chatScrollToTs: targetTs };
      }
      return { viewMode: newMode, chatScrollToTs: null };
    });
  };

  handleLangChange = () => {
    const lang = getLang();
    this.setState({ lang });
    fetch(apiUrl('/api/preferences'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang }),
    }).catch(() => { });
  };

  handleCollapseToolResultsChange = (checked) => {
    this.setState({ collapseToolResults: checked });
    fetch(apiUrl('/api/preferences'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collapseToolResults: checked }),
    }).catch(() => { });
  };

  handleExpandThinkingChange = (checked) => {
    this.setState({ expandThinking: checked });
    fetch(apiUrl('/api/preferences'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expandThinking: checked }),
    }).catch(() => { });
  };

  handleExpandDiffChange = (checked) => {
    this.setState({ expandDiff: checked });
    fetch(apiUrl('/api/preferences'), {
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
    fetch(apiUrl('/api/preferences'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filterIrrelevant: checked }),
    }).catch(() => { });
  };

  // Extract user prompts from requests (for mobile prompt viewer)
  // 命令相关的标签集合，已作为独立 prompt 输出，在 segments 中直接丢弃
  static COMMAND_TAGS = new Set([
    'command-name', 'command-message', 'command-args',
    'local-command-caveat', 'local-command-stdout',
  ]);

  // 将一段文本拆分为普通文本和 XML 标签片段（可折叠）
  static parseSegments(text) {
    const segments = [];
    // 匹配所有成对的 XML 标签: <tag-name ...>...</tag-name>
    const regex = /<([a-zA-Z_][\w-]*)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g;
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const before = text.slice(lastIndex, match.index).trim();
      if (before) segments.push({ type: 'text', content: before });
      const tagName = match[1];
      lastIndex = match.index + match[0].length;
      // 命令相关标签直接跳过
      if (App.COMMAND_TAGS.has(tagName)) continue;
      // 提取标签内的内容（去掉外层开闭标签）
      const innerRegex = new RegExp(`^<${tagName}(?:\\s[^>]*)?>([\\s\\S]*)<\\/${tagName}>$`);
      const innerMatch = match[0].match(innerRegex);
      const content = innerMatch ? innerMatch[1].trim() : match[0].trim();
      segments.push({ type: 'system', content, label: tagName });
    }
    const after = text.slice(lastIndex).trim();
    if (after) segments.push({ type: 'text', content: after });
    return segments;
  }

  // 从消息列表中提取用户文本
  static extractUserTexts(messages) {
    const userMsgs = [];   // 纯用户文本（不含系统标签），用于去重
    const fullTexts = [];  // 完整文本（含系统标签），用于展示
    let slashCmd = null;
    for (const msg of messages) {
      if (msg.role !== 'user') continue;
      if (typeof msg.content === 'string') {
        const text = msg.content.trim();
        if (!text) continue;
        if (!isSystemText(text)) {
          if (/^Implement the following plan:/i.test(text)) continue;
          userMsgs.push(text);
          fullTexts.push(text);
        }
      } else if (Array.isArray(msg.content)) {
        const { commands, textBlocks } = classifyUserContent(msg.content);
        // 取最后一个 slash command（与之前行为一致）
        if (commands.length > 0) {
          slashCmd = commands[commands.length - 1];
        }
        // 过滤掉 plan prompt
        const userParts = [];
        for (const b of textBlocks) {
          if (/^Implement the following plan:/i.test((b.text || '').trim())) continue;
          userParts.push(b.text.trim());
        }
        // 收集完整文本用于 context 视图
        const allParts = msg.content
          .filter(b => b.type === 'text' && b.text?.trim())
          .map(b => b.text.trim());
        if (userParts.length > 0) {
          userMsgs.push(userParts.join('\n'));
          fullTexts.push(allParts.join('\n'));
        }
      }
    }
    return { userMsgs, fullTexts, slashCmd };
  }

  extractUserPrompts(requests) {
    const prompts = [];
    const seen = new Set();
    let prevSlashCmd = null;
    const mainAgentRequests = requests.filter(r => isMainAgent(r));

    for (let ri = 0; ri < mainAgentRequests.length; ri++) {
      const req = mainAgentRequests[ri];
      const messages = req.body?.messages || [];
      const timestamp = req.timestamp || '';
      const { userMsgs, fullTexts, slashCmd } = App.extractUserTexts(messages);

      // 斜杠命令去重
      if (slashCmd && slashCmd !== '/compact' && slashCmd !== prevSlashCmd) {
        prompts.push({ type: 'prompt', segments: [{ type: 'text', content: slashCmd }], timestamp });
      }
      prevSlashCmd = slashCmd;

      // 逐条检查用户消息，用内容哈希去重
      for (let i = 0; i < userMsgs.length; i++) {
        const key = userMsgs[i];
        if (seen.has(key)) continue;
        seen.add(key);
        const raw = fullTexts[i] || key;
        prompts.push({ type: 'prompt', segments: App.parseSegments(raw), timestamp });
      }
    }
    return prompts;
  }

  // Render original prompt (mobile version)
  renderOriginalPrompt(p) {
    const textSegments = p.segments.filter(seg => seg.type === 'text');
    if (textSegments.length === 0) return null;
    return (
      <div className={styles.mobilePromptCard}>
        {textSegments.map((seg, j) => (
          <pre key={j} className={styles.mobilePromptPreText}>{seg.content}</pre>
        ))}
      </div>
    );
  }

  // Export prompts to .txt file
  handleExportPromptsTxt = (prompts) => {
    if (!prompts || prompts.length === 0) return;
    const blocks = [];
    for (const p of prompts) {
      const lines = [];
      const ts = p.timestamp ? new Date(p.timestamp).toLocaleString() : '';
      if (ts) lines.push(`${ts}:\n`);
      // 只输出纯文本 segments，跳过 system 标签
      const textParts = (p.segments || [])
        .filter(seg => seg.type === 'text')
        .map(seg => seg.content);
      if (textParts.length > 0) lines.push(textParts.join('\n'));
      blocks.push(lines.join('\n'));
    }
    if (blocks.length === 0) return;
    const blob = new Blob([blocks.join('\n\n\n\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `user-prompts-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
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
    fetch(apiUrl('/api/local-logs'))
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

  renderLogTable(logs, mobile) {
    const columns = [
      {
        title: '',
        dataIndex: 'file',
        key: 'check',
        width: 40,
        fixed: mobile ? 'left' : false,
        render: (file) => (
          <Checkbox
            checked={this.state.selectedLogs.has(file) || false}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => { e.stopPropagation(); this.handleToggleLogSelect(file, e.target.checked); }}
          />
        ),
      },
      {
        title: t('ui.logTime'),
        dataIndex: 'timestamp',
        key: 'time',
        width: mobile ? 150 : undefined,
        render: (ts) => <span style={{ whiteSpace: 'nowrap' }}>{this.formatTimestamp(ts)}</span>,
      },
      ...(!mobile ? [{
        title: t('ui.logTurns'),
        dataIndex: 'turns',
        key: 'turns',
        width: 80,
        render: (v) => <Tag style={{ background: '#0a0a0a', border: '1px solid #444', color: '#999' }}>{v || 0}</Tag>,
      }] : []),
      {
        title: t('ui.logSize'),
        dataIndex: 'size',
        key: 'size',
        width: 90,
        render: (v) => <Tag style={{ background: '#0a0a0a', border: '1px solid #444', color: '#999' }}>{this.formatSize(v)}</Tag>,
      },
      {
        title: t('ui.logActions'),
        key: 'actions',
        width: mobile ? 160 : 180,
        render: (_, log) => (
          <span style={{ display: 'flex', gap: 4 }}>
            <Button size="small" type="primary" onClick={(e) => { e.stopPropagation(); this.handleOpenLogFile(log.file); }}>
              {t('ui.openLog')}
            </Button>
            <Button size="small" icon={<DownloadOutlined />} onClick={(e) => { e.stopPropagation(); this.handleDownloadLogFile(log.file); }}>
              {t('ui.downloadLog')}
            </Button>
          </span>
        ),
      },
    ];

    return (
      <Table
        size="small"
        dataSource={logs}
        columns={columns}
        rowKey="file"
        pagination={false}
        scroll={mobile ? { x: 'max-content', y: 'calc(100vh - 160px)' } : { y: 400 }}
        onRow={(log) => ({
          onClick: () => {
            const checked = !this.state.selectedLogs.has(log.file);
            this.handleToggleLogSelect(log.file, checked);
          },
          style: { cursor: 'pointer' },
        })}
      />
    );
  }

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

    fetch(apiUrl('/api/merge-logs'), {
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

  handleDeleteLogs = () => {
    const { selectedLogs } = this.state;
    if (selectedLogs.size === 0) return;

    Modal.confirm({
      title: t('ui.deleteLogs'),
      content: t('ui.deleteLogsConfirm', { count: selectedLogs.size }),
      okText: t('ui.deleteLogs'),
      okButtonProps: { danger: true },
      cancelText: t('ui.cancel'),
      onOk: () => {
        const files = [...selectedLogs];
        fetch(apiUrl('/api/delete-logs'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files }),
        })
          .then(res => res.json())
          .then(data => {
            if (data.results) {
              const deleted = data.results.filter(r => r.ok).length;
              const failed = data.results.filter(r => r.error).length;
              if (deleted > 0) message.success(t('ui.deleteSuccess', { count: deleted }));
              if (failed > 0) message.error(t('ui.deleteFailed', { count: failed }));
              this.setState({ selectedLogs: new Set() });
              this.handleImportLocalLogs();
            }
          })
          .catch(() => message.error('Delete failed'));
      },
    });
  };

  handleOpenLogFile = (file) => {
    // 在新窗口打开日志文件，避免覆盖当前监控窗口
    const port = window.location.port || window.location.host.split(':')[1] || '7008';
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
    window.open(`${window.location.protocol}//${window.location.hostname}:${port}?logfile=${encodeURIComponent(file)}${tokenParam}`, '_blank');
    this.setState({ importModalVisible: false });
  };

  handleDownloadLogFile = (file) => {
    const url = apiUrl(`/api/download-log?file=${encodeURIComponent(file)}`);
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  handleResumeChoice = (choice) => {
    fetch(apiUrl('/api/resume-choice'), {
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

    // 工作区选择器模式
    if (this.state.workspaceMode) {
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
          <WorkspaceList onLaunch={this.handleWorkspaceLaunch} />
        </ConfigProvider>
      );
    }

    // CLI 模式 + 手机端：只显示终端，顶部显示监控状态
    if (this.state.cliMode && isMobile) {
      const mobileIsLocalLog = !!this._isLocalLog;
      const mobileChatActive = mobileIsLocalLog || this.state.mobileChatVisible;
      return (
        <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', background: '#000' }}>
          <div style={{ padding: '10px 12px', background: '#111', borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                className={styles.mobileMenuBtn}
                onClick={() => this.setState(prev => ({ mobileMenuVisible: !prev.mobileMenuVisible }))}
                aria-label={t('ui.mobileMenu')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>
              <Badge status="processing" color="green" />
              <span style={{ fontSize: 12, color: '#aaa' }}>{mobileIsLocalLog ? t('ui.historyLog', { file: this._localLogFile }) : (t('ui.liveMonitoring') + (this.state.projectName ? `: ${this.state.projectName}` : ''))}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {mobileIsLocalLog ? (
                <Button
                  type="text"
                  size="small"
                  icon={<RollbackOutlined />}
                  onClick={() => history.back()}
                  style={{ color: '#888', fontSize: 12 }}
                >
                  {t('ui.mobileGoBack')}
                </Button>
              ) : (
                <Button
                  type="text"
                  size="small"
                  icon={<BranchesOutlined />}
                  onClick={() => this.setState(prev => ({ mobileGitDiffVisible: !prev.mobileGitDiffVisible, mobileChatVisible: false, mobileStatsVisible: false, mobileLogMgmtVisible: false, mobileSettingsVisible: false }))}
                  style={{ color: this.state.mobileGitDiffVisible ? '#fff' : '#888', fontSize: 12 }}
                >
                  {this.state.mobileGitDiffVisible ? t('ui.mobileGitDiffExit') : t('ui.mobileGitDiffBrowse')}
                </Button>
              )}
              {!mobileIsLocalLog && (
                <Button
                  type="text"
                  size="small"
                  icon={<MessageOutlined />}
                  onClick={() => this.setState(prev => ({ mobileChatVisible: !prev.mobileChatVisible, mobileGitDiffVisible: false, mobileStatsVisible: false, mobileLogMgmtVisible: false, mobileSettingsVisible: false }))}
                  style={{ color: this.state.mobileChatVisible ? '#fff' : '#888', fontSize: 12 }}
                >
                  {this.state.mobileChatVisible ? t('ui.mobileChatExit') : t('ui.mobileChatBrowse')}
                </Button>
              )}
            </div>
            {this.state.mobileMenuVisible && (
              <>
                <div className={styles.mobileMenuOverlay} onClick={() => this.setState({ mobileMenuVisible: false })} />
                <div className={styles.mobileMenuDropdown}>
                  <button
                    className={styles.mobileMenuItem}
                    onClick={() => { this.setState({ mobileMenuVisible: false, mobileLogMgmtVisible: true, mobileStatsVisible: false, mobileGitDiffVisible: false, mobileChatVisible: false, mobileSettingsVisible: false, mobilePromptVisible: false }); this.handleImportLocalLogs(); }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                    </svg>
                    {t('ui.logManagement')}
                  </button>
                  <button
                    className={styles.mobileMenuItem}
                    onClick={() => { this.setState({ mobileMenuVisible: false, mobileStatsVisible: true, mobileGitDiffVisible: false, mobileChatVisible: false, mobileLogMgmtVisible: false, mobileSettingsVisible: false, mobilePromptVisible: false }); }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="7" height="7" />
                      <rect x="14" y="3" width="7" height="7" />
                      <rect x="3" y="14" width="7" height="7" />
                      <rect x="14" y="14" width="7" height="7" />
                    </svg>
                    {t('ui.tokenStats')}
                  </button>
                  <button
                    className={styles.mobileMenuItem}
                    onClick={() => { this.setState({ mobileMenuVisible: false, mobileSettingsVisible: true, mobileStatsVisible: false, mobileGitDiffVisible: false, mobileChatVisible: false, mobileLogMgmtVisible: false, mobilePromptVisible: false }); }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                    {t('ui.settings')}
                  </button>
                  <button
                    className={styles.mobileMenuItem}
                    onClick={() => { this.setState({ mobileMenuVisible: false, mobilePromptVisible: true, mobileStatsVisible: false, mobileGitDiffVisible: false, mobileChatVisible: false, mobileLogMgmtVisible: false, mobileSettingsVisible: false }); }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="12" y1="18" x2="12" y2="12" />
                      <line x1="12" y1="12" x2="9" y2="15" />
                      <line x1="12" y1="12" x2="15" y2="15" />
                    </svg>
                    {t('ui.userPrompt')}
                  </button>
                </div>
              </>
            )}
          </div>
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            {!mobileIsLocalLog && <TerminalPanel />}
            <div className={`${styles.mobileGitDiffOverlay} ${this.state.mobileGitDiffVisible ? styles.mobileGitDiffOverlayVisible : ''}`}>
              <div className={styles.mobileGitDiffInner}>
                <MobileGitDiff visible={this.state.mobileGitDiffVisible} />
              </div>
            </div>
            <div className={`${styles.mobileChatOverlay} ${mobileChatActive ? styles.mobileChatOverlayVisible : ''}`}>
              {fileLoading && (
                <div className={styles.mobileLoadingOverlay}>
                  <div className={styles.mobileLoadingSpinner} />
                  <div className={styles.mobileLoadingLabel}>{t('ui.loadingChat')}{fileLoadingCount > 0 ? ` (${fileLoadingCount})` : ''}</div>
                </div>
              )}
              <ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: { colorBgContainer: '#111', colorBgLayout: '#0a0a0a', colorBgElevated: '#1a1a1a', colorBorder: '#2a2a2a' } }}>
                <div className={styles.mobileChatInner}>
                  <ChatView
                    requests={filteredRequests}
                    mainAgentSessions={mainAgentSessions}
                    userProfile={this.state.userProfile}
                    collapseToolResults={this.state.collapseToolResults}
                    expandThinking={this.state.expandThinking}
                    onViewRequest={null}
                    scrollToTimestamp={null}
                    onScrollTsDone={() => {}}
                    cliMode={false}
                    terminalVisible={false}
                    mobileChatVisible={this.state.mobileChatVisible}
                  />
                </div>
              </ConfigProvider>
            </div>
            <div className={`${styles.mobileStatsOverlay} ${this.state.mobileStatsVisible ? styles.mobileStatsOverlayVisible : ''}`}>
              <div className={styles.mobileStatsInner}>
                <MobileStats
                  requests={filteredRequests}
                  visible={this.state.mobileStatsVisible}
                  onClose={() => this.setState({ mobileStatsVisible: false })}
                />
              </div>
            </div>
            <div className={`${styles.mobileLogMgmtOverlay} ${this.state.mobileLogMgmtVisible ? styles.mobileLogMgmtOverlayVisible : ''}`}>
              <div className={styles.mobileLogMgmtHeader}>
                <span className={styles.mobileLogMgmtTitle}>{t('ui.importLocalLogs')}</span>
                <button className={styles.mobileLogMgmtClose} onClick={() => this.setState({ mobileLogMgmtVisible: false, selectedLogs: new Set() })}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div className={styles.mobileLogMgmtActions}>
                <Button
                  size="small"
                  type={this.state.selectedLogs.size >= 2 ? 'primary' : 'default'}
                  disabled={this.state.selectedLogs.size < 2}
                  onClick={this.handleMergeLogs}
                  style={this.state.selectedLogs.size < 2 ? { color: '#666', borderColor: '#333' } : undefined}
                >
                  {t('ui.mergeLogs')}
                </Button>
                <Button
                  size="small"
                  icon={<DeleteOutlined />}
                  disabled={this.state.selectedLogs.size === 0}
                  onClick={this.handleDeleteLogs}
                  style={this.state.selectedLogs.size === 0 ? { color: '#666', borderColor: '#333' } : { color: '#ff4d4f', borderColor: '#ff4d4f' }}
                >
                  {t('ui.deleteLogs')}
                </Button>
              </div>
              <div className={styles.mobileLogMgmtBody}>
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
                    <ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: { colorBgContainer: '#111', colorBgLayout: '#0a0a0a', colorBgElevated: '#1a1a1a', colorBorder: '#2a2a2a' } }}>
                    <div className={styles.logListContainer}>
                      {this.renderLogTable(currentLogs, true)}
                    </div>
                    </ConfigProvider>
                  );
                })()}
              </div>
            </div>
            <div className={`${styles.mobileSettingsOverlay} ${this.state.mobileSettingsVisible ? styles.mobileSettingsOverlayVisible : ''}`}>
              <div className={styles.mobileLogMgmtHeader}>
                <span className={styles.mobileLogMgmtTitle}>{t('ui.settings')}</span>
                <button className={styles.mobileLogMgmtClose} onClick={() => this.setState({ mobileSettingsVisible: false })}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div style={{ padding: '12px 16px' }}>
                <div style={{ fontSize: 13, color: '#888', fontWeight: 500, marginBottom: 12 }}>{t('ui.chatDisplaySwitches')}</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #222' }}>
                  <span style={{ color: '#ccc', fontSize: 14 }}>{t('ui.collapseToolResults')}</span>
                  <Switch
                    checked={!!this.state.collapseToolResults}
                    onChange={this.handleCollapseToolResultsChange}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #222' }}>
                  <span style={{ color: '#ccc', fontSize: 14 }}>{t('ui.expandThinking')}</span>
                  <Switch
                    checked={!!this.state.expandThinking}
                    onChange={this.handleExpandThinkingChange}
                  />
                </div>
              </div>
            </div>
            <div className={`${styles.mobilePromptOverlay} ${this.state.mobilePromptVisible ? styles.mobilePromptOverlayVisible : ''}`}>
              <div className={styles.mobileLogMgmtHeader}>
                <span className={styles.mobileLogMgmtTitle}>{t('ui.userPrompt')}</span>
                <button className={styles.mobileLogMgmtClose} onClick={() => this.setState({ mobilePromptVisible: false })}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div className={styles.mobilePromptBody}>
                {(() => {
                  const prompts = this.extractUserPrompts(filteredRequests);
                  if (prompts.length === 0) {
                    return (
                      <div style={{ textAlign: 'center', color: '#666', padding: '40px 20px', fontSize: 14 }}>
                        {t('ui.noPrompt')}
                      </div>
                    );
                  }
                  return (
                    <>
                      <div style={{ padding: '8px 12px', borderBottom: '1px solid #222', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 13, color: '#888' }}>
                          {prompts.length} {t('ui.promptCountUnit')}
                        </span>
                        <Button
                          size="small"
                          icon={<DownloadOutlined />}
                          onClick={() => this.handleExportPromptsTxt(prompts)}
                        >
                          {t('ui.exportPromptsTxt')}
                        </Button>
                      </div>
                      <div className={styles.mobilePromptList}>
                        {prompts.map((p, i) => (
                          <div key={i} className={styles.mobilePromptItem}>
                            {p.timestamp && (
                              <div className={styles.mobilePromptTimestamp}>
                                {new Date(p.timestamp).toLocaleString()}
                              </div>
                            )}
                            {this.renderOriginalPrompt(p)}
                          </div>
                        ))}
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      );
    }

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
        <Layout className={styles.layout} ref={this._layoutRef}>
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
              cliMode={this.state.cliMode}
              terminalVisible={this.state.terminalVisible}
              onToggleTerminal={() => this.setState(prev => ({ terminalVisible: !prev.terminalVisible }))}
              onReturnToWorkspaces={this.state.cliMode ? this.handleReturnToWorkspaces : null}
            />
          </Layout.Header>

          <Layout.Content className={styles.content}>
            {viewMode === 'raw' && (
              filteredRequests.length === 0 ? (
                <div className={styles.guideContainer}>
                  <div className={styles.guideContent}>
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
            )}
            <div style={{ display: viewMode === 'chat' ? 'flex' : 'none', height: '100%', flexDirection: 'column' }}>
              <ChatView requests={filteredRequests} mainAgentSessions={mainAgentSessions} userProfile={this.state.userProfile} collapseToolResults={this.state.collapseToolResults} expandThinking={this.state.expandThinking} onViewRequest={this.handleViewRequest} scrollToTimestamp={this.state.chatScrollToTs} onScrollTsDone={() => this.setState({ chatScrollToTs: null })} cliMode={this._isLocalLog ? false : this.state.cliMode} terminalVisible={this._isLocalLog ? false : this.state.terminalVisible} />
            </div>
          </Layout.Content>
          <div className={styles.footer}>
            <div className={styles.footerRight}>
              <span className={styles.footerText}>{t('ui.footer.starRequest')}</span>
              <a href="https://github.com/weiesky/cc-viewer" target="_blank" rel="noopener noreferrer" className={styles.footerLink}>
                <svg className={styles.footerIcon} viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>
                GitHub{this.state.githubStars != null ? ` ★ ${this.state.githubStars}` : ''}
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
          styles={{ body: { overflow: 'hidden' } }}
        >
          <div className={styles.modalActions}>
            <Button icon={<UploadOutlined />} onClick={this.handleLoadLocalJsonlFile}>
              {t('ui.loadLocalJsonl')}
            </Button>
            <Button
              size="small"
              type={this.state.selectedLogs.size > 1 ? 'primary' : 'default'}
              disabled={this.state.selectedLogs.size < 2}
              onClick={this.handleMergeLogs}
              style={{ marginLeft: 8 }}
            >
              {t('ui.mergeLogs')}
            </Button>
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              disabled={this.state.selectedLogs.size === 0}
              onClick={this.handleDeleteLogs}
              style={{ marginLeft: 8 }}
            >
              {t('ui.deleteLogs')}
            </Button>
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
                {this.renderLogTable(currentLogs, false)}
              </div>
            );
          })()}
        </Modal>
      </ConfigProvider>
    );
  }
}

export default App;
