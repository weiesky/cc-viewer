import React from 'react';
import { ConfigProvider, Layout, theme, Modal, Table, Tag, Spin, Button, Checkbox, Badge, Switch, Popover, message } from 'antd';
import { UploadOutlined, MessageOutlined, BranchesOutlined, DownloadOutlined, DeleteOutlined, RollbackOutlined, ReloadOutlined } from '@ant-design/icons';
import { isMobile, isIOS } from './env';
import { uploadFileAndGetPath } from './components/TerminalPanel';

const MAX_SESSIONS = isMobile ? 30 : 100;
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
import { formatTokenCount, filterRelevantRequests, findPrevMainAgentTimestamp, appendCacheLossMap, extractCachedContent } from './utils/helpers';
import { isMainAgent, isSystemText, classifyUserContent } from './utils/contentFilter';
import { classifyRequest } from './utils/requestType';
import styles from './App.module.css';
import { apiUrl } from './utils/apiUrl';
import OpenFolderIcon from './components/OpenFolderIcon';
import { saveEntries, loadEntries, clearEntries, getCacheMeta } from './utils/entryCache';
import { reconstructEntries } from '../lib/delta-reconstructor.js';
import { createEntrySlimmer, createIncrementalSlimmer } from './utils/entry-slim.js';

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
      pendingCacheHighlight: null,
      cacheExpireAt,
      cacheType,
      leftPanelWidth: 380,
      mainAgentSessions: [], // [{ messages, response }]
      importModalVisible: false,
      localLogs: {},       // { projectName: [{file, timestamp, size}] }
      localLogsLoading: false,
      refreshingStats: false,
      showAll: false,
      lang: getLang(),      // 是否显示心跳请求
      userProfile: null,    // { name, avatar }
      projectName: '',      // 当前监控的项目名称
      resumeModalVisible: false,
      resumeFileName: '',
      resumeRememberChoice: false,
      resumeAutoChoice: null, // null | "continue" | "new"
      collapseToolResults: true,
      expandThinking: true,
      expandDiff: false,
      showThinkingSummaries: false,
      fileLoading: false,
      fileLoadingCount: 0,
      isDragging: false,
      selectedLogs: new Set(),   // Set<file>
      githubStars: null,
      cliMode: false,
      terminalVisible: true,
      workspaceMode: false,
      mobileMenuVisible: false,
      mobileStatsVisible: false,
      mobileGitDiffVisible: false,
      mobileChatVisible: false,
      mobileLogMgmtVisible: false,
      mobileSettingsVisible: false,
      mobilePromptVisible: false,
      serverCachedContent: null,
    };
    this.eventSource = null;
    this._autoSelectTimer = null;
    this._chunkedEntries = [];   // 分段加载缓冲
    this._chunkedTotal = 0;
    this.mainContainerRef = React.createRef();
    this._layoutRef = React.createRef();
    // P0 perf: O(1) request dedup index
    this._requestIndexMap = new Map();
    // P0 perf: rAF batching for SSE messages
    this._pendingEntries = [];
    this._flushRafId = null;
    // P0 perf: pre-computed cache loss map
    this._cacheLossMap = new Map();
    this._cacheLossProcessedCount = 0;
    this._cacheLossLastMainAgent = null;
    this._cacheLossShowAll = undefined;
    // 增量维护的 KV-Cache 缓存内容（稳定引用，不受 inProgress 闪烁影响）
    this._lastKvCacheContent = null;
    // P0 perf: 实时 SSE 增量剪枝（默认关闭，localStorage ccv_sseSlim=true 启用）
    this._sseSlimEnabled = !isMobile && localStorage.getItem('ccv_sseSlim') === 'true';
    this._sseSlimmer = null;
  }

  /** Rebuild the O(1) request dedup index from a full entries array. */
  _rebuildRequestIndex(entries) {
    this._requestIndexMap.clear();
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      this._requestIndexMap.set(`${e.timestamp}|${e.url}`, i);
    }
    // Reset incremental cache loss state — next render will do a full pass
    this._cacheLossProcessedCount = 0;
    this._cacheLossLastMainAgent = null;
    this._cacheLossMap = new Map();
    this._lastKvCacheContent = null;
    this._sseSlimmer = null;
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

    // 获取 claude settings（showThinkingSummaries 等）
    fetch(apiUrl('/api/claude-settings')).then(r => r.json()).then(data => {
      if (data.showThinkingSummaries) this.setState({ showThinkingSummaries: true });
    }).catch(() => {});

    // 获取用户偏好设置（包含 filterIrrelevant）
    // 用 Promise 保存，供 initSSE 等待（resume_prompt 需要知道 resumeAutoChoice）
    this._prefsReady = fetch(apiUrl('/api/preferences'))
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
        if (data.resumeAutoChoice) {
          this.setState({ resumeAutoChoice: data.resumeAutoChoice });
        }
        // filterIrrelevant 默认 true，showAll = !filterIrrelevant
        const filterIrrelevant = data.filterIrrelevant !== undefined ? !!data.filterIrrelevant : true;
        this.setState({ showAll: !filterIrrelevant });
        return data;
      })
      .catch(() => ({}));

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
              this._rebuildRequestIndex(cached);
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
    if (this._localLogES) { this._localLogES.close(); this._localLogES = null; }
    if (this._autoSelectTimer) clearTimeout(this._autoSelectTimer);
    if (this._loadingCountTimer) cancelAnimationFrame(this._loadingCountTimer);
    if (this._cacheSaveTimer) clearTimeout(this._cacheSaveTimer);
    if (this._sseTimeoutTimer) clearTimeout(this._sseTimeoutTimer);
    if (this._sseReconnectTimer) clearTimeout(this._sseReconnectTimer);
  }

  // SSE 心跳超时检测：45s 内无任何事件则判定连接断开
  _resetSSETimeout = () => {
    if (this._sseTimeoutTimer) clearTimeout(this._sseTimeoutTimer);
    this._sseReconnectCount = 0; // 收到事件说明连接正常，重置重连计数
    this._sseTimeoutTimer = setTimeout(() => {
      console.warn('SSE heartbeat timeout, reconnecting...');
      this._reconnectSSE();
    }, 45000);
  };

  _reconnectSSE() {
    if (this._sseReconnectCount >= 10) {
      console.error('SSE reconnect limit reached');
      return;
    }
    this._sseReconnectCount = (this._sseReconnectCount || 0) + 1;
    if (this.eventSource) { this.eventSource.close(); this.eventSource = null; }
    if (this._flushRafId) { cancelAnimationFrame(this._flushRafId); this._flushRafId = null; }
    this._pendingEntries = [];
    this._sseSlimmer = null;
    if (this._sseReconnectTimer) clearTimeout(this._sseReconnectTimer);
    this._sseReconnectTimer = setTimeout(() => { this.initSSE(); }, 2000);
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
      // 每次收到任何 SSE 事件（包括心跳注释帧触发的隐式活动）都重置超时
      this.eventSource.onmessage = (event) => { this._resetSSETimeout(); this.handleEventMessage(event); };
      this.eventSource.onopen = () => { this._resetSSETimeout(); };
      this.eventSource.addEventListener('resume_prompt', (event) => {
        try {
          const data = JSON.parse(event.data);
          // 等待偏好加载完成再判断是否跳过弹窗（避免竞态）
          (this._prefsReady || Promise.resolve({})).then((prefs) => {
            if (prefs?.resumeAutoChoice) {
              // 自动跳过：直接发送选择到服务端，不触碰偏好设置（避免 setState 竞态清除偏好）
              fetch(apiUrl('/api/resume-choice'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ choice: prefs.resumeAutoChoice }),
              }).catch(err => console.error('resume-choice failed:', err));
            } else {
              this.setState({ resumeModalVisible: true, resumeFileName: data.recentFileName || '' });
            }
          });
        } catch { }
      });
      this.eventSource.addEventListener('resume_resolved', () => {
        this.setState({ resumeModalVisible: false, resumeFileName: '', resumeRememberChoice: false });
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
        const rawEntries = (isIncremental && isMobile && this.state.requests.length > 0)
          ? [...this.state.requests, ...delta]
          : delta;

        // Delta 重建：server 发送原始 delta 条目，客户端重建为完整 messages
        const entries = Array.isArray(rawEntries) ? reconstructEntries(rawEntries) : rawEntries;

        if (Array.isArray(entries) && entries.length > 0) {
          this.assignMessageTimestamps(entries);
          const mainAgentSessions = this.buildSessionsFromEntries(entries);
          const filtered = filterRelevantRequests(entries);
          this._rebuildRequestIndex(entries);
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
            this._rebuildRequestIndex(entries);
            if (entries.length > 0) {
              this.animateLoadingCount(entries.length, () => {
                this.setState({
                  requests: entries,
                  selectedIndex: filtered.length > 0 ? filtered.length - 1 : null,
                  mainAgentSessions,
                  fileLoading: false,
                  fileLoadingCount: 0,
                  serverCachedContent: null,
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
                serverCachedContent: null,
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
          this._rebuildRequestIndex([]);
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
        this._rebuildRequestIndex([]);
        this.setState({
          workspaceMode: true,
          requests: [],
          mainAgentSessions: [],
          projectName: '',
          selectedIndex: null,
        });
      });
      this.eventSource.addEventListener('context_window', (event) => {
        try {
          const data = JSON.parse(event.data);
          this.setState({ contextWindow: data });
        } catch { }
      });
      this.eventSource.addEventListener('kv_cache_content', (event) => {
        try {
          const cached = JSON.parse(event.data);
          // 防御：忽略无实际内容的 kv_cache_content（避免空数据覆盖有效缓存）
          if (cached && (cached.system?.length > 0 || cached.messages?.length > 0 || cached.tools?.length > 0)) {
            this.setState({ serverCachedContent: cached });
          }
        } catch (err) {
          console.error('Failed to parse kv_cache_content:', err);
        }
      });
      this.eventSource.addEventListener('ping', () => { this._resetSSETimeout(); });
      this.eventSource.onerror = () => console.error('SSE连接错误');
    } catch (error) {
      console.error('EventSource初始化失败:', error);
      this.setState({ fileLoading: false, fileLoadingCount: 0 });
    }
  }

  loadLocalLogFile(file) {
    // 独立 SSE 链路加载历史日志：/api/local-log 返回 event-stream，
    // 与 /events (CLI 模式) 完全隔离，不会触发 terminal/workspace 等 CLI 行为
    this._isLocalLog = true;
    this._localLogFile = file;
    this.setState({ fileLoading: true, fileLoadingCount: 0, serverCachedContent: null });

    // 关闭上一次的加载连接（防止快速切换时资源泄漏）
    if (this._localLogES) { this._localLogES.close(); this._localLogES = null; }

    const entries = [];
    const slimmer = createEntrySlimmer(isMainAgent);
    const es = new EventSource(apiUrl(`/api/local-log?file=${encodeURIComponent(file)}`));
    this._localLogES = es;

    es.addEventListener('load_start', (event) => {
      try {
        const data = JSON.parse(event.data);
        this.setState({ fileLoadingCount: 0 });
      } catch { }
    });

    es.addEventListener('load_chunk', (event) => {
      try {
        const chunk = JSON.parse(event.data);
        if (Array.isArray(chunk)) {
          for (const entry of chunk) {
            slimmer.process(entry, entries, entries.length);
            entries.push(entry);
          }
          this.setState({ fileLoadingCount: entries.length });
        }
      } catch { }
    });

    es.addEventListener('load_end', () => {
      es.close();
      slimmer.finalize(entries);
      // Delta 重建：server 发送原始 delta 条目，客户端重建为完整 messages
      const reconstructed = reconstructEntries(entries);
      if (Array.isArray(reconstructed) && reconstructed.length > 0) {
        this.assignMessageTimestamps(reconstructed);
        const mainAgentSessions = this.buildSessionsFromEntries(reconstructed);
        const filtered = filterRelevantRequests(reconstructed);
        this._rebuildRequestIndex(reconstructed);
        this.setState({
          requests: reconstructed,
          selectedIndex: filtered.length > 0 ? filtered.length - 1 : null,
          mainAgentSessions,
          fileLoading: false,
          fileLoadingCount: 0,
          serverCachedContent: null,
        });
      } else {
        this.setState({ fileLoading: false, fileLoadingCount: 0, serverCachedContent: null });
      }
    });

    es.onerror = () => {
      es.close();
      console.error('加载日志文件 SSE 连接错误');
      this.setState({ fileLoading: false, fileLoadingCount: 0 });
    };
  }

  handleEventMessage(event) {
    try {
      const entry = JSON.parse(event.data);
      this._pendingEntries.push(entry);
      if (!this._flushRafId) {
        this._flushRafId = requestAnimationFrame(this._flushPendingEntries);
      }
    } catch (error) {
      console.error('处理事件消息失败:', error);
    }
  }

  _flushPendingEntries = () => {
    this._flushRafId = null;
    const batch = this._pendingEntries;
    this._pendingEntries = [];
    if (batch.length === 0) return;

    this.setState(prev => {
      const requests = [...prev.requests]; // one copy per frame, not per message

      let cacheExpireAt = prev.cacheExpireAt;
      let cacheType = prev.cacheType;
      let mainAgentSessions = prev.mainAgentSessions;

      // P0 perf: lazy init 增量剪枝器
      if (this._sseSlimEnabled && !this._sseSlimmer) {
        this._sseSlimmer = createIncrementalSlimmer(isMainAgent);
      }

      for (const entry of batch) {
        const key = `${entry.timestamp}|${entry.url}`;
        const existingIndex = this._requestIndexMap.get(key);

        if (existingIndex !== undefined) {
          requests[existingIndex] = entry;
          if (this._sseSlimmer) this._sseSlimmer.onDedup(existingIndex);
        } else {
          const newIdx = requests.length;
          // processEntry 在 push 前调用：slimmer 需要修改 requests 中的 prev entry，
          // _fullEntryIndex = newIdx 指向即将 push 的位置，push 紧随其后保证索引有效
          // IMPORTANT: processEntry sets _fullEntryIndex = requests.length (current newIdx).
          // The push below MUST follow immediately — do NOT insert code between these two lines.
          if (this._sseSlimmer) this._sseSlimmer.processEntry(entry, requests, newIdx);
          this._requestIndexMap.set(key, newIdx);
          requests.push(entry);
        }

        // 增量维护 KV-Cache 缓存内容：只在 completed MainAgent（有 usage）时更新，避免 inProgress 闪烁
        if (isMainAgent(entry) && !entry.inProgress && entry.response?.body?.usage) {
          const kvCached = extractCachedContent([entry]);
          if (kvCached && (kvCached.system.length > 0 || kvCached.messages.length > 0 || kvCached.tools.length > 0)) {
            this._lastKvCacheContent = kvCached;
          }
        }

        // 记录 mainAgent 缓存信息
        if (isMainAgent(entry)) {
          const usage = entry.response?.body?.usage;
          if (usage?.cache_creation) {
            const cc = usage.cache_creation;
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
              const cacheTotal = (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
              cacheType = cacheTotal > 0 ? formatTokenCount(cacheTotal) : newType;
              localStorage.setItem('ccv_cacheExpireAt', String(cacheExpireAt));
              localStorage.setItem('ccv_cacheType', cacheType);
            }
          }
        }

        // 合并 mainAgent sessions（跳过被剪枝的 entry，其 messages 已被清空）
        if (isMainAgent(entry) && entry.body && Array.isArray(entry.body.messages) && !entry._slimmed) {
          const timestamp = entry.timestamp || new Date().toISOString();
          const lastSession = mainAgentSessions.length > 0 ? mainAgentSessions[mainAgentSessions.length - 1] : null;
          const prevMessages = lastSession?.messages || [];
          const messages = entry.body.messages;
          const prevCount = prevMessages.length;

          const userId = entry.body.metadata?.user_id || null;
          const sameUser = userId !== null && lastSession?.userId === userId;
          const isNewSession = !sameUser && prevCount > 0 && messages.length < prevCount * 0.5 && (prevCount - messages.length) > 4;

          // Claude Code 客户端偶尔发送只有 1-2 条消息的 mainAgent 瞬态请求。
          // 如果直接用它替换已有的大 session（300+ 条消息），会导致对话视图闪烁——
          // 大量 MainAgent 消息瞬间丢失，随后完整响应到达又恢复（331→2→331 反复交替）。
          // 三重条件防止误杀：原 session 须有一定量(>4)、新消息极少(≤4)、且缩减超过 50%。
          // 注：阈值从 >10 降至 >4，保护对话早期（5-10 条消息）不受瞬态请求干扰。
          const isTransient = prevCount > 4 && messages.length <= 4 && messages.length < prevCount * 0.5;
          if (isTransient) continue;

          for (let i = 0; i < messages.length; i++) {
            if (!isNewSession && i < prevCount && prevMessages[i]._timestamp) {
              messages[i]._timestamp = prevMessages[i]._timestamp;
            } else if (!messages[i]._timestamp) {
              messages[i]._timestamp = timestamp;
            }
          }
          mainAgentSessions = this.mergeMainAgentSessions(mainAgentSessions, entry);
        }
      }

      let selectedIndex = prev.selectedIndex;

      if (mainAgentSessions.length > MAX_SESSIONS) {
        mainAgentSessions = mainAgentSessions.slice(-MAX_SESSIONS);
      }
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
  };

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
      // 被剪枝的 entry：用 _messageCount 维持 timestamps 数组增长，但不注入
      const count = entry._messageCount || messages.length;
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

      // 只对有实际 messages 的 entry 注入 _timestamp（跳过被剪枝的空 entry）
      if (messages.length > 0) {
        for (let i = 0; i < messages.length; i++) {
          messages[i]._timestamp = timestamps[i];
        }
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
      if (isMainAgent(entry) && entry.body && Array.isArray(entry.body.messages) && !entry._slimmed) {
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
    const sameUser = userId !== null && userId === lastSession.userId;

    // Claude Code 客户端偶尔发送只有 1-2 条消息的 mainAgent 瞬态请求。
    // 如果直接用它替换已有的大 session（300+ 条消息），会导致对话视图闪烁——
    // 大量 MainAgent 消息瞬间丢失，随后完整响应到达又恢复（331→2→331 反复交替）。
    // 三重条件防止误杀：原 session 须有一定量(>4)、新消息极少(≤4)、且消息数大幅缩减。
    // 注：阈值与 _flushPendingEntries 中的 isTransient 保持一致（>4）。
    if (isNewConversation && newMessages.length <= 4 && prevMsgCount > 4) {
      return prevSessions;
    }

    // sameUser 时允许 context compression（消息缩减但仍有合理数量）
    if (sameUser || (userId === lastSession.userId && !isNewConversation)) {
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

  handleScrollDone = () => { this.setState({ scrollCenter: false }); };
  handleCacheHighlightDone = () => { this.setState({ pendingCacheHighlight: null }); };
  handleScrollTsDone = () => { this.setState({ chatScrollToTs: null }); };

  handleViewInChat = () => {
    this.setState(prev => {
      const filteredRequests = prev.showAll ? prev.requests : filterRelevantRequests(prev.requests);
      const selectedReq = filteredRequests[prev.selectedIndex];
      if (!selectedReq) return null;
      let targetTs = null;
      if (isMainAgent(selectedReq) && selectedReq.timestamp) {
        targetTs = selectedReq.timestamp;
      } else {
        // SubAgent / Teammate 请求直接用自身 timestamp
        const cls = classifyRequest(selectedReq);
        if ((cls.type === 'SubAgent' || cls.type === 'Teammate') && selectedReq.timestamp) {
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
        this._rebuildRequestIndex([]);
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
          // SubAgent / Teammate 请求直接用自身 timestamp
          const cls = classifyRequest(selectedReq);
          if ((cls.type === 'SubAgent' || cls.type === 'Teammate') && selectedReq.timestamp) {
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
    }, () => {
      // 切换到对话模式后，仅在终端可见且为 CLI 模式时将焦点转移到终端 textarea
      if (this.state.viewMode === 'chat' && this.state.terminalVisible && this.state.cliMode && !isMobile) {
        requestAnimationFrame(() => {
          const ta = document.querySelector('.xterm-helper-textarea');
          if (ta) ta.focus();
        });
      }
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
          if (/Implement the following plan:/i.test(text)) continue;
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
          if (/Implement the following plan:/i.test((b.text || '').trim())) continue;
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

  handleNavigateCacheMsg = (msgIdx) => {
    const filteredRequests = this.state.showAll ? this.state.requests : filterRelevantRequests(this.state.requests);
    let targetIdx = -1;
    for (let i = filteredRequests.length - 1; i >= 0; i--) {
      if (isMainAgent(filteredRequests[i])) { targetIdx = i; break; }
    }
    if (targetIdx < 0) return;
    this.setState({ selectedIndex: targetIdx, scrollCenter: true, currentTab: 'kv-cache-text', pendingCacheHighlight: { msgIdx, key: Date.now() } });
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

  handleRefreshStats = () => {
    this.setState({ refreshingStats: true });
    fetch(apiUrl('/api/refresh-stats'), { method: 'POST' })
      .then(res => res.json())
      .then(data => {
        if (!data.ok) throw new Error(data.error || 'refresh failed');
        // Worker 已完成扫描，直接重新加载日志列表
        return fetch(apiUrl('/api/local-logs'));
      })
      .then(res => res.json())
      .then(data => {
        const { _currentProject, ...logs } = data;
        this.setState({ localLogs: logs, refreshingStats: false });
        message.success(t('ui.refreshStatsSuccess'));
      })
      .catch(() => {
        this.setState({ refreshingStats: false });
        message.error(t('ui.refreshStatsFailed'));
      });
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
        width: mobile ? 150 : 180,
        render: (ts) => <span className={styles.tableTimestampCell}>{this.formatTimestamp(ts, mobile)}</span>,
      },
      {
        title: t('ui.logPreview'),
        dataIndex: 'preview',
        key: 'preview',
        width: mobile ? 150 : undefined,
        ellipsis: true,
        render: (arr) => {
          if (!Array.isArray(arr) || arr.length === 0) return '—';
          const first = arr[0];
          const displayText = (first.length <= 30 && arr.length > 1) ? `${first} | ${arr[1]}` : first;
          if (arr.length <= 1) return <span className={styles.tablePreviewText}>{displayText}</span>;
          return (
            <Popover
              trigger={mobile ? 'click' : 'hover'}
              placement={mobile ? 'bottomLeft' : 'leftTop'}
              autoAdjustOverflow={{ adjustX: false, adjustY: true }}
              overlayInnerStyle={{
                background: '#1e1e1e',
                border: '1px solid #3a3a3a',
                borderRadius: 8,
                padding: 0,
                maxHeight: 400,
                overflowY: 'auto',
              }}
              content={
                <div className={styles.previewPopover}>
                  {arr.map((text, i) => (
                    <div key={i} className={styles.previewItem}>
                      <pre className={styles.previewText}>{text}</pre>
                    </div>
                  ))}
                </div>
              }
            >
              <span className={styles.tablePreviewTextClickable} style={{ textDecoration: mobile ? 'underline dotted #666' : 'none' }}>{displayText}</span>
            </Popover>
          );
        },
      },
      ...(!mobile ? [{
        title: t('ui.logTurns'),
        dataIndex: 'turns',
        key: 'turns',
        width: 80,
        render: (v) => <Tag className={styles.tableTag}>{v || 0}</Tag>,
      }] : []),
      {
        title: t('ui.logSize'),
        dataIndex: 'size',
        key: 'size',
        width: 90,
        render: (v) => <Tag className={styles.tableTag}>{this.formatSize(v)}</Tag>,
      },
      {
        title: t('ui.logActions'),
        key: 'actions',
        width: mobile ? 160 : 180,
        render: (_, log) => (
          <span className={styles.tableActionsCell}>
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
    // 如果勾选了"记住选择"，保存到偏好
    if (this.state.resumeRememberChoice) {
      this.setState({ resumeAutoChoice: choice });
      fetch(apiUrl('/api/preferences'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeAutoChoice: choice }),
      }).catch(() => {});
    }
    fetch(apiUrl('/api/resume-choice'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ choice }),
    }).catch(err => console.error('resume-choice failed:', err));
  };

  handleResumeAutoChoiceToggle = (enabled) => {
    const value = enabled ? 'continue' : null;
    this.setState({ resumeAutoChoice: value });
    fetch(apiUrl('/api/preferences'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resumeAutoChoice: value }),
    }).catch(() => {});
  };

  handleResumeAutoChoiceChange = (value) => {
    this.setState({ resumeAutoChoice: value });
    fetch(apiUrl('/api/preferences'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resumeAutoChoice: value }),
    }).catch(() => {});
  };

  handleLoadLocalJsonlFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.jsonl';
    input.multiple = true;
    input.onchange = (e) => {
      const files = Array.from(e.target.files);
      if (files.length === 0) return;
      const totalSize = files.reduce((s, f) => s + f.size, 0);
      if (totalSize > 500 * 1024 * 1024) {
        message.error(t('ui.fileTooLarge'));
        return;
      }
      this.setState({ fileLoading: true, fileLoadingCount: 0 });
      let readCount = 0;
      const allEntries = [];
      const fileNames = [];
      files.forEach(file => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const content = ev.target.result;
            const entries = content.split('\n---\n').filter(line => line.trim()).map(entry => {
              try { return JSON.parse(entry); } catch { return null; }
            }).filter(Boolean);
            allEntries.push(...entries);
            fileNames.push(file.name);
          } catch {}
          readCount++;
          if (readCount === files.length) {
            this._finishLocalLoad(allEntries, fileNames);
          }
        };
        reader.readAsText(file);
      });
    };
    input.click();
  };

  _processJsonlFiles = (files) => {
    if (!files || files.length === 0) return;
    const totalSize = files.reduce((s, f) => s + f.size, 0);
    if (totalSize > 500 * 1024 * 1024) {
      message.error(t('ui.fileTooLarge'));
      return;
    }
    this.setState({ fileLoading: true, fileLoadingCount: 0 });
    let readCount = 0;
    const allEntries = [];
    const fileNames = [];
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const content = ev.target.result;
          const entries = content.split('\n---\n').filter(line => line.trim()).map(entry => {
            try { return JSON.parse(entry); } catch { return null; }
          }).filter(Boolean);
          allEntries.push(...entries);
          fileNames.push(file.name);
        } catch {}
        readCount++;
        if (readCount === files.length) {
          this._finishLocalLoad(allEntries, fileNames);
        }
      };
      reader.readAsText(file);
    });
  };

  _isInternalDrag = (e) => e.dataTransfer.types.includes('text/x-preset-reorder');

  _onDragOver = (e) => {
    e.preventDefault();
    if (this._isInternalDrag(e)) return; // 忽略内部预置拖拽排序
    if (!this.state.isDragging) this.setState({ isDragging: true });
  };

  _onDragLeave = (e) => {
    // Only set false when truly leaving the container
    const layout = this._layoutRef.current;
    if (layout && !layout.contains(e.relatedTarget)) {
      this.setState({ isDragging: false });
    }
  };

  _onDrop = (e) => {
    e.preventDefault();
    if (this._isInternalDrag(e)) return; // 忽略内部预置拖拽排序
    this.setState({ isDragging: false });
    const files = Array.from(e.dataTransfer.files);
    if (!files.length) return;
    // Upload files to server, collect paths, pass to ChatView
    Promise.all(
      files.map(file =>
        uploadFileAndGetPath(file).then(path => ({ name: file.name, path }))
          .catch(err => { message.error(`${file.name}: ${err.message}`); return null; })
      )
    ).then(results => {
      const paths = results.filter(Boolean).map(r => `"${r.path}"`);
      if (paths.length > 0) {
        this.setState(prev => ({
          pendingUploadPaths: [...(prev.pendingUploadPaths || []), ...paths],
        }));
      }
    });
  };

  handleUploadPathsConsumed = () => {
    this.setState({ pendingUploadPaths: [] });
  };

  _finishLocalLoad = (entries, fileNames) => {
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
      this._localLogFile = fileNames.length === 1 ? fileNames[0] : `${fileNames.length} files`;
      if (this.eventSource) { this.eventSource.close(); this.eventSource = null; }
      this._rebuildRequestIndex(entries);
      this.setState({
        requests: entries,
        selectedIndex: filtered.length > 0 ? filtered.length - 1 : null,
        mainAgentSessions,
        importModalVisible: false,
        fileLoading: false,
        fileLoadingCount: 0,
      });
    });
  };

  formatTimestamp(ts, mobile) {
    // 20260217_224218 -> 2026-02-17 22:42:18
    if (!ts || ts.length < 15) return ts;
    if (mobile) return `${ts.slice(4, 6)}-${ts.slice(6, 8)} ${ts.slice(9, 11)}:${ts.slice(11, 13)}:${ts.slice(13, 15)}`;
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
    // P0 perf: cache filteredRequests by reference to avoid new array every render
    if (this._filteredSource !== requests || this._filteredShowAll !== showAll) {
      this._filteredSource = requests;
      this._filteredShowAll = showAll;
      this._filteredRequests = showAll ? requests : filterRelevantRequests(requests);
    }
    const filteredRequests = this._filteredRequests;

    // P0 perf: incremental cache loss map — only process new entries
    if (this._cacheLossShowAll !== showAll) {
      // showAll toggled → full recompute (rare)
      this._cacheLossShowAll = showAll;
      this._cacheLossMap = new Map();
      this._cacheLossLastMainAgent = null;
      this._cacheLossProcessedCount = 0;
    }
    if (filteredRequests.length < this._cacheLossProcessedCount) {
      // full_reload shrunk the array → full recompute
      this._cacheLossMap = new Map();
      this._cacheLossLastMainAgent = null;
      this._cacheLossProcessedCount = 0;
    }
    if (filteredRequests.length > this._cacheLossProcessedCount) {
      // incremental: only process newly appended entries
      this._cacheLossLastMainAgent = appendCacheLossMap(
        this._cacheLossMap, filteredRequests,
        this._cacheLossProcessedCount, this._cacheLossLastMainAgent
      );
      this._cacheLossProcessedCount = filteredRequests.length;
    }

    const selectedRequest = selectedIndex !== null ? filteredRequests[selectedIndex] : null;

    // 工作区选择器模式
    if (this.state.workspaceMode) {
      return (
        <ConfigProvider
          theme={{
            algorithm: theme.darkAlgorithm,
            token: {
              colorPrimary: '#1668dc',
              colorBgContainer: '#111',
              colorBgLayout: '#0a0a0a',
              colorBgElevated: '#1e1e1e',
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
        <div className={styles.mobileCLIRoot}>
          <div className={styles.mobileCLIHeader}>
            <div className={styles.mobileCLIHeaderLeft}>
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
              <span className={styles.mobileCLIStatusLabel}>{mobileIsLocalLog ? t('ui.historyLog', { file: this._localLogFile }) : (t('ui.liveMonitoring') + (this.state.projectName ? `: ${this.state.projectName}` : ''))}</span>
            </div>
            <div className={styles.mobileCLIHeaderRight}>
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
          <div className={styles.mobileCLIBody}>
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
              <ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: { colorPrimary: '#1668dc', colorBgContainer: '#111', colorBgLayout: '#0a0a0a', colorBgElevated: '#1e1e1e', colorBorder: '#2a2a2a' } }}>
                <div className={styles.mobileChatInner}>
                  <ChatView
                    requests={filteredRequests}
                    mainAgentSessions={mainAgentSessions}
                    userProfile={this.state.userProfile}
                    collapseToolResults={this.state.collapseToolResults}
                    expandThinking={this.state.expandThinking}
                    showThinkingSummaries={this.state.showThinkingSummaries}
                    onViewRequest={null}
                    scrollToTimestamp={null}
                    onScrollTsDone={() => {}}
                    cliMode={false}
                    terminalVisible={false}
                    mobileChatVisible={this.state.mobileChatVisible}
                    fileLoading={this.state.fileLoading}
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
                <span className={styles.mobileLogMgmtTitle}><OpenFolderIcon apiEndpoint={apiUrl('/api/open-log-dir')} title={t('ui.openLogDir')} size={14} />{t('ui.importLocalLogs')}</span>
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
                <Button
                  size="small"
                  icon={<ReloadOutlined spin={this.state.refreshingStats} />}
                  loading={this.state.refreshingStats}
                  onClick={this.handleRefreshStats}
                >
                  {t('ui.refreshStats')}
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
                    <ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: { colorPrimary: '#1668dc', colorBgContainer: '#111', colorBgLayout: '#0a0a0a', colorBgElevated: '#1e1e1e', colorBorder: '#2a2a2a' } }}>
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
              <div className={styles.mobileSettingsBody}>
                <div className={styles.mobileSettingsSectionTitle}>{t('ui.chatDisplaySwitches')}</div>
                <div className={styles.mobileSettingsRow}>
                  <span className={styles.mobileSettingsLabel}>{t('ui.collapseToolResults')}</span>
                  <Switch
                    checked={!!this.state.collapseToolResults}
                    onChange={this.handleCollapseToolResultsChange}
                  />
                </div>
                <div className={styles.mobileSettingsRow}>
                  <span className={styles.mobileSettingsLabel}>{t('ui.expandThinking')}</span>
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
                      <div className={styles.mobilePromptEmpty}>
                        {t('ui.noPrompt')}
                      </div>
                    );
                  }
                  return (
                    <>
                      <div className={styles.mobilePromptHeader}>
                        <span className={styles.mobilePromptCount}>
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
            colorPrimary: '#1668dc',
            colorBgContainer: '#111',
            colorBgLayout: '#0a0a0a',
            colorBgElevated: '#1e1e1e',
            colorBorder: '#2a2a2a',
          },
        }}
      >
        {fileLoading && (
          <div className={styles.loadingOverlay}>
            <div className={styles.loadingText}>Loading...({fileLoadingCount})</div>
          </div>
        )}
        {this.state.isDragging && (
          <div className={styles.dragOverlay}>
            <div className={styles.dragOverlayContent}>
              <UploadOutlined style={{ fontSize: 48 }} />
              <p>{t('ui.dragDropHint')}</p>
            </div>
          </div>
        )}
        <Layout className={styles.layout} ref={this._layoutRef} onDragOver={this._onDragOver} onDragLeave={this._onDragLeave} onDrop={this._onDrop}>
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
              contextWindow={this.state.contextWindow}
              onNavigateCacheMsg={this.handleNavigateCacheMsg}
              serverCachedContent={this.state.serverCachedContent || this._lastKvCacheContent}
              resumeAutoChoice={this.state.resumeAutoChoice}
              onResumeAutoChoiceToggle={this.handleResumeAutoChoiceToggle}
              onResumeAutoChoiceChange={this.handleResumeAutoChoiceChange}
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
                      onScrollDone={this.handleScrollDone}
                      cacheLossMap={this._cacheLossMap}
                    />
                  </div>
                </div>

                <PanelResizer onResize={this.handleResize} />

                <div className={styles.rightPanel}>
                  <DetailPanel
                    request={selectedRequest}
                    requests={filteredRequests}
                    allRequests={this.state.requests}
                    selectedIndex={selectedIndex}
                    currentTab={currentTab}
                    onTabChange={this.handleTabChange}
                    onViewInChat={this.handleViewInChat}
                    expandDiff={this.state.expandDiff}
                    pendingCacheHighlight={this.state.pendingCacheHighlight}
                    onCacheHighlightDone={this.handleCacheHighlightDone}
                  />
                </div>
              </div>
              )
            )}
            <div className={styles.chatViewWrapper} style={{ display: viewMode === 'chat' ? 'flex' : 'none' }}>
              <ChatView requests={filteredRequests} mainAgentSessions={mainAgentSessions} userProfile={this.state.userProfile} collapseToolResults={this.state.collapseToolResults} expandThinking={this.state.expandThinking} showThinkingSummaries={this.state.showThinkingSummaries} onViewRequest={this.handleViewRequest} scrollToTimestamp={this.state.chatScrollToTs} onScrollTsDone={this.handleScrollTsDone} cliMode={this._isLocalLog ? false : this.state.cliMode} terminalVisible={this._isLocalLog ? false : this.state.terminalVisible} onToggleTerminal={() => this.setState(prev => ({ terminalVisible: !prev.terminalVisible }))} pendingUploadPaths={this.state.pendingUploadPaths} onUploadPathsConsumed={this.handleUploadPathsConsumed} fileLoading={this.state.fileLoading} />
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
          footer={
            <div>
              <div className={styles.resumeFooterRight}>
                <Button key="continue" type="primary" onClick={() => this.handleResumeChoice('continue')} className={styles.btnMarginRight}>
                  {t('ui.resume.continue')}
                </Button>
                <Button key="new" onClick={() => this.handleResumeChoice('new')}>
                  {t('ui.resume.new')}
                </Button>
              </div>
              <div className={styles.resumeFooterLeft}>
                <Checkbox
                  checked={this.state.resumeRememberChoice}
                  onChange={(e) => this.setState({ resumeRememberChoice: e.target.checked })}
                  className={styles.resumeCheckboxOpacity}
                >
                  <span className={styles.resumeCheckboxOpacity}>{t('ui.resume.remember')}</span>
                </Checkbox>
              </div>
            </div>
          }
        >
          <p>{t('ui.resume.message', { file: this.state.resumeFileName })}</p>
        </Modal>

        <Modal
          title={<span className={styles.modalTitleInline}><OpenFolderIcon apiEndpoint={apiUrl('/api/open-log-dir')} title={t('ui.openLogDir')} size={16} />{t('ui.importLocalLogs')}</span>}
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
              className={styles.btnMarginLeft}
            >
              {t('ui.mergeLogs')}
            </Button>
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              disabled={this.state.selectedLogs.size === 0}
              onClick={this.handleDeleteLogs}
              className={styles.btnMarginLeft}
            >
              {t('ui.deleteLogs')}
            </Button>
            <Button
              size="small"
              icon={<ReloadOutlined spin={this.state.refreshingStats} />}
              loading={this.state.refreshingStats}
              onClick={this.handleRefreshStats}
              className={styles.btnMarginLeft}
            >
              {t('ui.refreshStats')}
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
