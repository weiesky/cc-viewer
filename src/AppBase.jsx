import React from 'react';
import { ConfigProvider, theme, Modal, Table, Tag, Spin, Button, Checkbox, Popover, message } from 'antd';
import { DownloadOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import { isMobile } from './env';
import WorkspaceList from './components/WorkspaceList';
import OpenFolderIcon from './components/OpenFolderIcon';
import { t, getLang, setLang } from './i18n';
import { formatTokenCount, filterRelevantRequests, isRelevantRequest, appendCacheLossMap, extractCachedContent } from './utils/helpers';
import { isMainAgent } from './utils/contentFilter';
import { apiUrl } from './utils/apiUrl';
import { saveEntries, loadEntries, clearEntries, getCacheMeta, saveSessionEntries, loadSessionEntries, saveSessionIndex } from './utils/entryCache';
import { buildSessionIndex, splitHotCold, mergeSessionIndices, HOT_SESSION_COUNT } from './utils/sessionManager';
import { mergeMainAgentSessions as _mergeMainAgentSessions } from './utils/sessionMerge';
import { reconstructEntries } from '../lib/delta-reconstructor.js';
import { createEntrySlimmer, createIncrementalSlimmer } from './utils/entry-slim.js';
import styles from './App.module.css';

export { styles };

export const MAX_SESSIONS = isMobile ? 30 : 100;

/**
 * 共享基类：包含 PC 和 Mobile 通用的状态管理、SSE 通信、数据处理、偏好设置等逻辑。
 * 子类 App (PC) 和 Mobile 各自实现 render() 方法。
 */
class AppBase extends React.Component {
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
      cacheExpireAt,
      cacheType,
      mainAgentSessions: [], // [{ messages, response }]
      importModalVisible: false,
      localLogs: {},       // { projectName: [{file, timestamp, size}] }
      localLogsLoading: false,
      refreshingStats: false,
      showAll: false,
      lang: getLang(),
      userProfile: null,    // { name, avatar }
      projectName: '',      // 当前监控的项目名称
      resumeModalVisible: false,
      resumeFileName: '',
      resumeRememberChoice: false,
      resumeAutoChoice: null, // null | "continue" | "new"
      collapseToolResults: true,
      expandThinking: true,
      expandDiff: false,
      logDir: '',
      showFullToolContent: false,
      showThinkingSummaries: false,
      themeColor: 'dark',
      fileLoading: false,
      fileLoadingCount: 0,
      isDragging: false,
      selectedLogs: new Set(),   // Set<file>
      githubStars: null,
      cliMode: false,
      sdkMode: false,
      workspaceMode: false,
      serverCachedContent: null,
      updateInfo: null,
      pendingUploadPaths: [],
      contextWindow: null,
      isStreaming: false,
      hasMoreHistory: false,
      loadingMore: false,
      sessionIndex: [],
      loadingSessionId: null,
      proxyProfiles: [],
      activeProxyId: 'max',
      defaultConfig: null,
    };
    this.eventSource = null;
    this._currentSessionId = null;
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

  /**
   * 单次遍历完成 timestamp 赋值 + session 构建 + 过滤 + index 重建。
   * 合并 assignMessageTimestamps + buildSessionsFromEntries + filterRelevantRequests + _rebuildRequestIndex，
   * 减少 3 次 O(n) 全量扫描。
   */
  _processEntries(entries) {
    let timestamps = [];
    let prevUserId = null;
    let sessions = [];
    const filtered = [];

    // _rebuildRequestIndex 内联
    this._requestIndexMap.clear();
    this._cacheLossProcessedCount = 0;
    this._cacheLossLastMainAgent = null;
    this._cacheLossMap = new Map();
    this._lastKvCacheContent = null;
    this._sseSlimmer = null;

    let currentSessionId = null;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      // requestIndex
      this._requestIndexMap.set(`${entry.timestamp}|${entry.url}`, i);

      // filterRelevant
      if (isRelevantRequest(entry)) filtered.push(entry);

      // assignTimestamps + buildSessions（仅 mainAgent）
      if (isMainAgent(entry) && entry.body && Array.isArray(entry.body.messages)) {
        const messages = entry.body.messages;
        const count = entry._messageCount || messages.length;
        const userId = entry.body.metadata?.user_id || null;
        const timestamp = entry.timestamp || new Date().toISOString();

        const prevCount = timestamps.length;
        const isNewSession = prevCount > 0 && (
          (count < prevCount * 0.5 && (prevCount - count) > 4) ||
          (prevUserId && userId && userId !== prevUserId)
        );
        // Transient 保护：极短 entry（<=4 msgs）在长对话后不应重置 timestamps 累积
        // 这些通常是中间态请求（request body 只有 user message，尚未拿到 response）
        const isTransient = isNewSession && count <= 4 && prevCount > 4 && count < prevCount * 0.5;
        if (isNewSession && !isTransient) {
          currentSessionId = timestamp;
          timestamps = [];
        } else if (currentSessionId === null) {
          currentSessionId = timestamp;
        }
        for (let j = timestamps.length; j < count; j++) timestamps.push(timestamp);
        if (messages.length > 0) {
          for (let j = 0; j < messages.length; j++) messages[j]._timestamp = timestamps[j];
        }
        prevUserId = userId;

        // session 合并（跳过 _slimmed）
        if (!entry._slimmed) {
          sessions = this.mergeMainAgentSessions(sessions, entry);
        }
      }

      entry._sessionId = currentSessionId;
    }

    this._currentSessionId = currentSessionId;
    return { mainAgentSessions: sessions, filtered };
  }

  componentDidMount() {
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
        if (data.showFullToolContent !== undefined) {
          this.setState({ showFullToolContent: !!data.showFullToolContent });
        }
        if (data.resumeAutoChoice) {
          this.setState({ resumeAutoChoice: data.resumeAutoChoice });
        }
        if (data.themeColor) {
          this.setState({ themeColor: data.themeColor });
          document.documentElement.setAttribute('data-theme', data.themeColor === 'light' ? 'light' : 'dark');
        }
        // filterIrrelevant 默认 true，showAll = !filterIrrelevant
        const filterIrrelevant = data.filterIrrelevant !== undefined ? !!data.filterIrrelevant : true;
        this.setState({ showAll: !filterIrrelevant });
        if (data.logDir) {
          this.setState({ logDir: data.logDir });
        }
        return data;
      })
      .catch(() => ({}));

    // 获取系统用户头像和名字
    fetch(apiUrl('/api/user-profile'))
      .then(res => res.json())
      .then(data => this.setState({ userProfile: data }))
      .catch(() => { });

    // 获取 proxy profile 配置
    fetch(apiUrl('/api/proxy-profiles'))
      .then(res => res.json())
      .then(data => {
        if (!data.profiles) return;
        let activeId = data.active || 'max';
        const dc = data.defaultConfig;
        // 如果当前是 Default 且启动配置匹配了某个 proxy profile（origin + apiKey + model），自动指定到那一项
        if (activeId === 'max' && dc?.origin) {
          const match = data.profiles.find(p => {
            if (p.id === 'max' || !p.baseURL) return false;
            try {
              if (new URL(p.baseURL).origin !== dc.origin) return false;
            } catch { return false; }
            // apiKey 匹配（mask 格式比较：都取后 4 位）
            if (dc.apiKey && p.apiKey) {
              const dcTail = dc.apiKey.slice(-4);
              const pTail = p.apiKey.slice(-4);
              if (dcTail !== pTail) return false;
            }
            // model 匹配
            if (dc.model && p.activeModel && dc.model !== p.activeModel) return false;
            return true;
          });
          if (match) {
            activeId = match.id;
            this.handleProxyProfileChange({ active: match.id, profiles: data.profiles });
          }
        }
        this.setState({ proxyProfiles: data.profiles, activeProxyId: activeId, defaultConfig: dc || null });
      })
      .catch(() => { });

    // 获取当前监控的项目名称
    const params = new URLSearchParams(window.location.search);
    const logfile = params.get('logfile');
    fetch(apiUrl('/api/project-name'))
      .then(res => res.json())
      .then(data => {
        const projectName = data.projectName || '';
        this.setState({ projectName });
        if (projectName) document.title = projectName;
        // 移动端：从缓存恢复数据，在 SSE 数据到达前立即渲染
        if (isMobile && projectName && !logfile && this.state.requests.length === 0) {
          loadEntries(projectName).then(cached => {
            if (cached && this.state.requests.length === 0) {
              const { mainAgentSessions, filtered } = this._processEntries(cached);
              // P1: 缓存恢复也做 hot/cold 分层，避免全量数据驻留内存
              if (mainAgentSessions.length > HOT_SESSION_COUNT) {
                const sessionIndex = buildSessionIndex(cached, mainAgentSessions);
                const { hotEntries, allSessions } = splitHotCold(
                  cached, mainAgentSessions, sessionIndex, HOT_SESSION_COUNT
                );
                const hotFiltered = hotEntries.filter(e => isRelevantRequest(e));
                // 计算 _oldestTs 供"加载更多"使用
                this._oldestTs = hotEntries.length > 0 ? hotEntries[0].timestamp : null;
                this.setState({
                  requests: hotEntries,
                  selectedIndex: hotFiltered.length > 0 ? hotFiltered.length - 1 : null,
                  mainAgentSessions: allSessions,
                  sessionIndex,
                  hasMoreHistory: !!this._oldestTs,
                  fileLoading: false,
                });
              } else {
                this._oldestTs = cached.length > 0 ? cached[0].timestamp : null;
                this.setState({
                  requests: cached,
                  selectedIndex: filtered.length > 0 ? filtered.length - 1 : null,
                  mainAgentSessions,
                  hasMoreHistory: !!this._oldestTs,
                  fileLoading: false,
                });
              }
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
          this.setState({ cliMode: true, sdkMode: !!data.sdkMode, viewMode: 'chat' });
        }
      })
      .catch(() => { });

    // 检查是否是通过 ?logfile= 打开的历史日志
    if (logfile) {
      this.loadLocalLogFile(logfile);
    } else {
      this.initSSE();
    }
  }

  componentWillUnmount() {
    if (this.eventSource) this.eventSource.close();
    if (this._localLogES) { this._localLogES.close(); this._localLogES = null; }
    if (this._autoSelectTimer) clearTimeout(this._autoSelectTimer);
    if (this._loadingCountTimer) cancelAnimationFrame(this._loadingCountTimer);
    if (this._loadingCountRafId) cancelAnimationFrame(this._loadingCountRafId);
    if (this._cacheSaveTimer) clearTimeout(this._cacheSaveTimer);
    if (this._evictionTimer) clearTimeout(this._evictionTimer);
    if (this._sseTimeoutTimer) clearTimeout(this._sseTimeoutTimer);
    if (this._sseReconnectTimer) clearTimeout(this._sseReconnectTimer);
    if (this._streamingOffTimer) clearTimeout(this._streamingOffTimer);
  }

  // ─── SSE 通信 ───────────────────────────────────────────

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
    if (this._streamingOffTimer) { clearTimeout(this._streamingOffTimer); this._streamingOffTimer = null; }
    if (this._flushRafId) { cancelAnimationFrame(this._flushRafId); this._flushRafId = null; }

    // 增量恢复：如果加载中断，保存已收到的 chunked entries 以便重连后增量续传
    if (this._chunkedEntries && this._chunkedEntries.length > 0 && isMobile) {
      try {
        const partial = reconstructEntries([...this._chunkedEntries]);
        if (Array.isArray(partial) && partial.length > 0) {
          const { mainAgentSessions } = this._processEntries(partial);
          // 保持 fileLoading: true，重连后继续加载
          this.setState({ requests: partial, mainAgentSessions });
          if (this.state.projectName) {
            const meta = getCacheMeta();
            const existingCount = (meta && meta.projectName === this.state.projectName) ? meta.count : 0;
            if (partial.length >= existingCount) {
              saveEntries(this.state.projectName, partial);
            }
          }
        }
      } catch (e) {
        console.warn('Failed to save partial entries on reconnect:', e);
      }
    }
    this._chunkedEntries = [];
    this._chunkedTotal = 0;
    this._isIncremental = false;
    if (this._loadingCountRafId) { cancelAnimationFrame(this._loadingCountRafId); this._loadingCountRafId = null; }

    this._pendingEntries = [];
    this.setState({ isStreaming: false });
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

  async loadMoreHistory() {
    if (!this.state.hasMoreHistory || this._loadingMore) return;
    this._loadingMore = true;
    this.setState({ loadingMore: true });
    try {
      const res = await fetch(apiUrl(`/api/entries/page?before=${encodeURIComponent(this._oldestTs)}&limit=100`));
      const data = await res.json();
      if (Array.isArray(data.entries) && data.entries.length > 0) {
        const reconstructed = reconstructEntries(data.entries);
        const merged = [...reconstructed, ...this.state.requests];
        const { mainAgentSessions } = this._processEntries(merged);
        this._oldestTs = data.oldestTimestamp;

        // P1: 移动端 hot/cold 分层
        if (isMobile && mainAgentSessions.length > HOT_SESSION_COUNT) {
          const sessionIndex = buildSessionIndex(merged, mainAgentSessions);
          const fullIndex = mergeSessionIndices(this.state.sessionIndex, sessionIndex);
          const { hotEntries, allSessions, coldGroups } = splitHotCold(
            merged, mainAgentSessions, fullIndex, HOT_SESSION_COUNT
          );
          const pn = this.state.projectName;
          if (pn) {
            for (const [sid, coldEntries] of coldGroups) {
              saveSessionEntries(pn, sid, coldEntries);
            }
            saveSessionIndex(pn, fullIndex);
            saveEntries(pn, merged);
          }
          this.setState({
            requests: hotEntries,
            mainAgentSessions: allSessions,
            sessionIndex: fullIndex,
            hasMoreHistory: !!data.hasMore,
            loadingMore: false,
          });
        } else {
          this.setState({
            requests: merged,
            mainAgentSessions,
            hasMoreHistory: !!data.hasMore,
            loadingMore: false,
          });
          if (isMobile && this.state.projectName) {
            saveEntries(this.state.projectName, merged);
          }
        }
      } else {
        this.setState({ hasMoreHistory: false, loadingMore: false });
      }
    } catch (e) {
      console.error('loadMoreHistory failed:', e);
      this.setState({ loadingMore: false });
    }
    this._loadingMore = false;
  }

  initSSE() {
    try {
      // 尝试使用缓存元数据进行增量加载
      let url = '/events';
      let hasCache = false;
      if (isMobile) {
        const meta = getCacheMeta();
        if (meta && meta.lastTs && meta.count > 0) {
          url = `/events?since=${encodeURIComponent(meta.lastTs)}&cc=${meta.count}&project=${encodeURIComponent(meta.projectName || '')}`;
          hasCache = true;
        }
      }
      // 移动端无缓存时只加载最近 200 条，剩余按需分页
      if (!hasCache && isMobile) {
        url = '/events?limit=200';
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
        this._resetSSETimeout();
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
        this._resetSSETimeout();
        this.setState({ resumeModalVisible: false, resumeFileName: '', resumeRememberChoice: false });
      });
      this.eventSource.addEventListener('update_completed', (event) => {
        this._resetSSETimeout();
        try {
          const data = JSON.parse(event.data);
          this.setState({ updateInfo: { type: 'completed', version: data.version } });
        } catch { }
      });
      this.eventSource.addEventListener('update_major_available', (event) => {
        this._resetSSETimeout();
        try {
          const data = JSON.parse(event.data);
          this.setState({ updateInfo: { type: 'major', version: data.version } });
        } catch { }
      });
      this.eventSource.addEventListener('load_start', (event) => {
        this._resetSSETimeout();
        try {
          const data = JSON.parse(event.data);
          this._chunkedEntries = [];
          this._chunkedTotal = data.total || 0;
          this._isIncremental = !!data.incremental;
          this._hasMoreHistory = !!data.hasMore;
          this._oldestTs = data.oldestTs || null;
          // 增量模式下已有缓存数据在显示，不需要 loading 遮罩
          if (!this._isIncremental) {
            this.setState({ fileLoading: true, fileLoadingCount: 0 });
          }
        } catch { }
      });
      this.eventSource.addEventListener('load_chunk', (event) => {
        this._resetSSETimeout();
        try {
          const chunk = JSON.parse(event.data);
          if (Array.isArray(chunk)) {
            this._chunkedEntries.push(...chunk);
            // 增量模式下静默累积；非增量模式用 rAF 节流，每帧最多更新一次计数
            if (!this._isIncremental && !this._loadingCountRafId) {
              this._loadingCountRafId = requestAnimationFrame(() => {
                this._loadingCountRafId = null;
                this.setState({ fileLoadingCount: this._chunkedEntries.length });
              });
            }
          }
        } catch { }
      });
      this.eventSource.addEventListener('load_end', () => {
        this._resetSSETimeout();
        if (this._loadingCountRafId) { cancelAnimationFrame(this._loadingCountRafId); this._loadingCountRafId = null; }
        const delta = this._chunkedEntries;
        this._chunkedEntries = [];
        this._chunkedTotal = 0;
        const isIncremental = this._isIncremental;
        this._isIncremental = false;

        // 增量模式：Map 去重合并（delta 条目覆盖同 key 的缓存条目）
        let rawEntries;
        if (isIncremental && isMobile && this.state.requests.length > 0) {
          if (delta.length === 0) {
            // 无新数据，缓存已是最新，跳过重建（保留缓存恢复时已设置的 hasMoreHistory）
            this.setState({ fileLoading: false, fileLoadingCount: 0 });
            return;
          }
          const eKey = (e, i) => (e.timestamp && e.url) ? `${e.timestamp}|${e.url}` : `__nokey_c${i}`;
          const map = new Map();
          this.state.requests.forEach((e, i) => map.set(eKey(e, i), e));
          delta.forEach((e, i) => map.set((e.timestamp && e.url) ? `${e.timestamp}|${e.url}` : `__nokey_d${i}`, e));
          rawEntries = Array.from(map.values());
        } else {
          rawEntries = delta;
        }

        // Delta 重建：server 发送原始 delta 条目，客户端重建为完整 messages
        const entries = Array.isArray(rawEntries) ? reconstructEntries(rawEntries) : rawEntries;

        if (Array.isArray(entries) && entries.length > 0) {
          const { mainAgentSessions, filtered } = this._processEntries(entries);

          // P1: 移动端 hot/cold 分层
          if (isMobile && mainAgentSessions.length > HOT_SESSION_COUNT) {
            const sessionIndex = buildSessionIndex(entries, mainAgentSessions);
            const fullIndex = isIncremental
              ? mergeSessionIndices(this.state.sessionIndex, sessionIndex)
              : sessionIndex;
            const { hotEntries, allSessions, coldGroups } = splitHotCold(
              entries, mainAgentSessions, fullIndex, HOT_SESSION_COUNT
            );
            // 冷 session entries 异步写入 IndexedDB
            const pn = this.state.projectName;
            if (pn) {
              for (const [sid, coldEntries] of coldGroups) {
                saveSessionEntries(pn, sid, coldEntries);
              }
              saveSessionIndex(pn, fullIndex);
              // 主缓存保存全量 entries（而非 hotEntries），确保下次缓存恢复时有完整数据
              saveEntries(pn, entries);
            }
            // Fix #4: selectedIndex 基于 hotEntries 而非全量 filtered
            const hotFiltered = hotEntries.filter(e => isRelevantRequest(e));
            const newState = {
              requests: hotEntries,
              selectedIndex: hotFiltered.length > 0 ? hotFiltered.length - 1 : null,
              mainAgentSessions: allSessions,
              sessionIndex: fullIndex,
              fileLoading: false,
              fileLoadingCount: 0,
            };
            // 增量模式保留缓存恢复时设的 hasMoreHistory；非增量（limit）模式用服务端的值
            if (!isIncremental) newState.hasMoreHistory = !!this._hasMoreHistory;
            this.setState(newState);
          } else {
            const newState = {
              requests: entries,
              selectedIndex: filtered.length > 0 ? filtered.length - 1 : null,
              mainAgentSessions,
              fileLoading: false,
              fileLoadingCount: 0,
            };
            if (!isIncremental) newState.hasMoreHistory = !!this._hasMoreHistory;
            this.setState(newState);
            if (isMobile && this.state.projectName) {
              saveEntries(this.state.projectName, entries);
            }
          }
        } else {
          this.setState({ fileLoading: false, fileLoadingCount: 0 });
        }
      });
      this.eventSource.addEventListener('full_reload', (event) => {
        this._resetSSETimeout();
        try {
          const entries = JSON.parse(event.data);
          if (Array.isArray(entries)) {
            const { mainAgentSessions, filtered } = entries.length > 0 ? this._processEntries(entries) : { mainAgentSessions: [], filtered: [] };
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
        this._resetSSETimeout();
        try {
          const data = JSON.parse(event.data);
          // 取消旧动画，防止旧 full_reload 回调覆盖新数据
          if (this._loadingCountTimer) {
            cancelAnimationFrame(this._loadingCountTimer);
            this._loadingCountTimer = null;
          }
          this._rebuildRequestIndex([]);
          if (data.projectName) document.title = `${data.projectName} - CC Viewer`;
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
        this._resetSSETimeout();
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
        this._resetSSETimeout();
        try {
          const data = JSON.parse(event.data);
          this.setState({ contextWindow: data });
        } catch { }
      });
      this.eventSource.addEventListener('kv_cache_content', (event) => {
        this._resetSSETimeout();
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
      this.eventSource.addEventListener('proxy_profile', (event) => {
        this._resetSSETimeout();
        try {
          const data = JSON.parse(event.data);
          if (data.active) this.setState({ activeProxyId: data.active });
          if (data.profile) {
            // 刷新完整列表
            fetch(apiUrl('/api/proxy-profiles')).then(r => r.json()).then(d => {
              if (d.profiles) this.setState({ proxyProfiles: d.profiles, activeProxyId: d.active || 'max' });
            }).catch(() => { });
          }
        } catch { }
      });
      this.eventSource.addEventListener('ping', () => { this._resetSSETimeout(); });
      this.eventSource.addEventListener('streaming_status', (e) => {
        this._resetSSETimeout();
        try {
          const data = JSON.parse(e.data);
          if (data.active) {
            // 立即显示 loading
            clearTimeout(this._streamingOffTimer);
            this.setState({ isStreaming: true });
          } else {
            // 延迟隐藏，避免工具调用间隙导致 spinner 频繁闪烁
            clearTimeout(this._streamingOffTimer);
            this._streamingOffTimer = setTimeout(() => {
              this.setState({ isStreaming: false });
            }, 2000);
          }
        } catch (err) { console.error('Failed to parse streaming_status:', err); }
      });
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
            entries.push(entry);
          }
          this.setState({ fileLoadingCount: entries.length });
        }
      } catch { }
    });

    es.addEventListener('load_end', () => {
      es.close();
      // Delta 重建必须在 entry-slim 之前：delta 条目的 body.messages 只有增量部分，
      // 如果先 slim 会永久丢失增量数据，导致重建后 messages 为空
      const reconstructed = reconstructEntries(entries);
      const slimmer = createEntrySlimmer(isMainAgent);
      for (let i = 0; i < reconstructed.length; i++) {
        slimmer.process(reconstructed[i], reconstructed, i);
      }
      slimmer.finalize(reconstructed);
      if (Array.isArray(reconstructed) && reconstructed.length > 0) {
        const { mainAgentSessions, filtered } = this._processEntries(reconstructed);
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

          const isTransient = prevCount > 4 && messages.length <= 4 && messages.length < prevCount * 0.5;
          if (isTransient) continue;

          // Fix #2: 标记 _sessionId
          if (isNewSession) {
            this._currentSessionId = timestamp;
          } else if (this._currentSessionId === null) {
            this._currentSessionId = timestamp;
          }

          for (let i = 0; i < messages.length; i++) {
            if (!isNewSession && i < prevCount && prevMessages[i]._timestamp) {
              messages[i]._timestamp = prevMessages[i]._timestamp;
            } else if (!messages[i]._timestamp) {
              messages[i]._timestamp = timestamp;
            }
          }
          mainAgentSessions = this.mergeMainAgentSessions(mainAgentSessions, entry);
        }

        // 标记 entry 的 _sessionId
        entry._sessionId = this._currentSessionId;
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
          // hot/cold 分层激活时跳过 saveEntries（state.requests 只有热数据，
          // 写入会覆盖 load_end 保存的全量缓存）。冷数据已通过 per-session 存储持久化。
          if (this.state.projectName && this.state.sessionIndex.length === 0) {
            saveEntries(this.state.projectName, this.state.requests);
          }
        }, 5000);
        // P1: 延迟淘汰冷 session，避免频繁触发
        if (this.state.mainAgentSessions.length > HOT_SESSION_COUNT + 2) {
          if (!this._evictionTimer) {
            this._evictionTimer = setTimeout(() => {
              this._evictionTimer = null;
              this._evictColdSessions();
            }, 10000);
          }
        }
      }
    });
  };

  // ─── P1: cold session 加载 / 淘汰 ──────────────────────────

  async loadSession(sessionId) {
    if (this._loadingSessionId != null) return;
    this._loadingSessionId = sessionId;
    this.setState({ loadingSessionId: sessionId });

    try {
      // 1. 从 IndexedDB 加载
      let entries = await loadSessionEntries(this.state.projectName, sessionId);

      // 2. fallback: 从 REST API 加载
      if (!entries || entries.length === 0) {
        const meta = (this.state.sessionIndex || []).find(s => s.sessionId === sessionId);
        if (meta && meta.lastTs) {
          const res = await fetch(apiUrl(`/api/entries/page?before=${encodeURIComponent(meta.lastTs)}&limit=200`));
          const data = await res.json();
          entries = data.entries || [];
        }
      }

      if (entries && entries.length > 0) {
        const reconstructed = reconstructEntries(entries);
        const merged = [...reconstructed, ...this.state.requests];
        const { mainAgentSessions } = this._processEntries(merged);

        const sessionIndex = buildSessionIndex(merged, mainAgentSessions);
        const fullIndex = mergeSessionIndices(this.state.sessionIndex, sessionIndex);
        // Fix #3: pin 加载的 session，防止 splitHotCold 立即淘汰
        const { hotEntries, allSessions, coldGroups } = splitHotCold(
          merged, mainAgentSessions, fullIndex, HOT_SESSION_COUNT,
          new Set([sessionId])
        );
        const pn = this.state.projectName;
        if (pn) {
          for (const [sid, coldEntries] of coldGroups) {
            saveSessionEntries(pn, sid, coldEntries);
          }
          saveSessionIndex(pn, fullIndex);
          saveEntries(pn, merged);
        }

        this.setState({
          requests: hotEntries,
          mainAgentSessions: allSessions,
          sessionIndex: fullIndex,
          loadingSessionId: null,
        });
      } else {
        this.setState({ loadingSessionId: null });
      }
    } catch (e) {
      console.error('loadSession failed:', e);
      this.setState({ loadingSessionId: null });
    }
    this._loadingSessionId = null;
  }

  _evictColdSessions() {
    const { requests, mainAgentSessions, projectName } = this.state;
    if (!isMobile || mainAgentSessions.length <= HOT_SESSION_COUNT) return;

    const { hotEntries, allSessions, coldGroups } = splitHotCold(
      requests, mainAgentSessions, this.state.sessionIndex, HOT_SESSION_COUNT
    );
    const fullIndex = this.state.sessionIndex;
    if (projectName) {
      for (const [sid, coldEntries] of coldGroups) {
        saveSessionEntries(projectName, sid, coldEntries);
      }
      saveSessionIndex(projectName, fullIndex);
      // 不调 saveEntries：state.requests 可能已是 hotEntries，写入会覆盖全量缓存。
      // 冷数据已通过 saveSessionEntries 持久化，全量缓存由 load_end 维护。
    }
    this.setState({
      requests: hotEntries,
      mainAgentSessions: allSessions,
      sessionIndex: fullIndex,
    });
  }

  // ─── 数据处理 ───────────────────────────────────────────

  mergeMainAgentSessions(prevSessions, entry) {
    return _mergeMainAgentSessions(prevSessions, entry);
  }

  // ─── 选中 & 导航 ───────────────────────────────────────

  handleSelectRequest = (index) => {
    this.setState({ selectedIndex: index, scrollCenter: false });
  };

  handleScrollDone = () => { this.setState({ scrollCenter: false }); };
  handleScrollTsDone = () => { this.setState({ chatScrollToTs: null }); };

  // ─── 模式切换 ──────────────────────────────────────────

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

  // ─── Proxy Profile ─────────────────────────────────────

  handleProxyProfileChange = (data) => {
    fetch(apiUrl('/api/proxy-profiles'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
      .then(r => r.json())
      .then(() => {
        this.setState({ proxyProfiles: data.profiles, activeProxyId: data.active });
      })
      .catch(() => { });
  };

  // ─── 偏好设置 ──────────────────────────────────────────

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

  handleThemeColorChange = (value) => {
    this.setState({ themeColor: value });
    document.documentElement.setAttribute('data-theme', value === 'light' ? 'light' : 'dark');
    fetch(apiUrl('/api/preferences'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ themeColor: value }),
    }).catch(() => { });
  };

  handleLogDirChange = (value) => {
    if (!value || typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed) return;
    this.setState({ logDir: trimmed });
    fetch(apiUrl('/api/preferences'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logDir: trimmed }),
    }).then(r => r.json()).then(data => {
      if (data.logDir) this.setState({ logDir: data.logDir });
    }).catch(() => { });
  };

  handleShowFullToolContentChange = (checked) => {
    this.setState({ showFullToolContent: checked });
    fetch(apiUrl('/api/preferences'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showFullToolContent: checked }),
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

  // ─── 日志管理 ──────────────────────────────────────────

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
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-hover)',
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

    const indices = [];
    logs.forEach((log, i) => {
      if (selectedLogs.has(log.file)) indices.push(i);
    });
    indices.sort((a, b) => a - b);

    if (selectedLogs.has(logs[0].file)) {
      message.warning(t('ui.mergeLatestNotAllowed'));
      return;
    }

    for (let i = 1; i < indices.length; i++) {
      if (indices[i] - indices[i - 1] !== 1) {
        message.warning(t('ui.mergeNotConsecutive'));
        return;
      }
    }

    const totalSize = indices.reduce((sum, i) => sum + logs[i].size, 0);
    if (totalSize > 500 * 1024 * 1024) {
      message.warning(t('ui.mergeTooLarge'));
      return;
    }

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

  handleOpenLogFile = async (file) => {
    // 优先使用当前 URL 的 token（远程访问时已有）；本地访问时从 /api/local-url 获取带 token 的基础 URL
    let base = `${window.location.protocol}//${window.location.host}`;
    let token = new URLSearchParams(window.location.search).get('token');
    if (!token) {
      try {
        const r = await fetch(apiUrl('/api/local-url'));
        if (r.ok) {
          const data = await r.json();
          if (data.url) { base = data.url.split('?')[0]; token = new URL(data.url).searchParams.get('token'); }
        }
      } catch {}
    }
    const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
    window.open(`${base}?logfile=${encodeURIComponent(file)}${tokenParam}`, '_blank');
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

  // ─── 恢复会话 ──────────────────────────────────────────

  handleResumeChoice = (choice) => {
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

  _finishLocalLoad = (entries, fileNames) => {
    if (entries.length === 0) {
      message.error(t('ui.noLogs'));
      this.setState({ fileLoading: false, fileLoadingCount: 0 });
      return;
    }
    this.animateLoadingCount(entries.length, () => {
      const { mainAgentSessions, filtered } = this._processEntries(entries);
      this._isLocalLog = true;
      this._localLogFile = fileNames.length === 1 ? fileNames[0] : `${fileNames.length} files`;
      if (this.eventSource) { this.eventSource.close(); this.eventSource = null; }
      if (this._streamingOffTimer) { clearTimeout(this._streamingOffTimer); this._streamingOffTimer = null; }
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

  // ─── 格式化 ────────────────────────────────────────────

  formatTimestamp(ts, mobile) {
    if (!ts || ts.length < 15) return ts;
    if (mobile) return `${ts.slice(4, 6)}-${ts.slice(6, 8)} ${ts.slice(9, 11)}:${ts.slice(11, 13)}:${ts.slice(13, 15)}`;
    return `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)} ${ts.slice(9, 11)}:${ts.slice(11, 13)}:${ts.slice(13, 15)}`;
  }

  formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // ─── 共享渲染辅助 ─────────────────────────────────────

  /** render() 前置计算，子类在 render 开头调用 */
  renderPrepare() {
    const { requests, selectedIndex, showAll, fileLoading, fileLoadingCount, mainAgentSessions, viewMode } = this.state;

    // 过滤心跳请求
    if (this._filteredSource !== requests || this._filteredShowAll !== showAll) {
      this._filteredSource = requests;
      this._filteredShowAll = showAll;
      this._filteredRequests = showAll ? requests : filterRelevantRequests(requests);
    }
    const filteredRequests = this._filteredRequests;

    // 增量 cache loss map
    if (this._cacheLossShowAll !== showAll) {
      this._cacheLossShowAll = showAll;
      this._cacheLossMap = new Map();
      this._cacheLossLastMainAgent = null;
      this._cacheLossProcessedCount = 0;
    }
    if (filteredRequests.length < this._cacheLossProcessedCount) {
      this._cacheLossMap = new Map();
      this._cacheLossLastMainAgent = null;
      this._cacheLossProcessedCount = 0;
    }
    if (filteredRequests.length > this._cacheLossProcessedCount) {
      this._cacheLossLastMainAgent = appendCacheLossMap(
        this._cacheLossMap, filteredRequests,
        this._cacheLossProcessedCount, this._cacheLossLastMainAgent
      );
      this._cacheLossProcessedCount = filteredRequests.length;
    }

    const selectedRequest = selectedIndex !== null ? filteredRequests[selectedIndex] : null;

    return { filteredRequests, selectedRequest, fileLoading, fileLoadingCount, mainAgentSessions, viewMode };
  }

  /** 工作区选择器渲染（PC/Mobile 共用） */
  renderWorkspaceMode() {
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

  /** Ant Design 主题配置 (dark/light) */
  get themeConfig() {
    if (this.state.themeColor === 'light') {
      return {
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#0969DA',
          colorBgContainer: '#FFFFFF',
          colorBgLayout: '#FAFAFA',
          colorBgElevated: '#FFFFFF',
          colorBorder: '#E0E0E0',
          controlOutline: 'transparent',
          controlOutlineWidth: 0,
        },
      };
    }
    return {
      algorithm: theme.darkAlgorithm,
      token: {
        colorPrimary: '#1668dc',
        colorBgContainer: '#111',
        colorBgLayout: '#0a0a0a',
        colorBgElevated: '#1e1e1e',
        colorBorder: '#2a2a2a',
        controlOutline: 'transparent',
        controlOutlineWidth: 0,
      },
    };
  }
}

export default AppBase;
