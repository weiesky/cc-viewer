import React from 'react';
import { ConfigProvider, theme, Modal, Spin, Button, message } from 'antd';
import { DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import { isMobile, isPad } from './env';
import WorkspaceList from './components/WorkspaceList';
import OpenFolderIcon from './components/OpenFolderIcon';
import LogTable from './components/LogTable';
import { t, getLang, setLang } from './i18n';
import { SettingsContext } from './contexts/SettingsContext';
import { formatTokenCount, filterRelevantRequests, isRelevantRequest, appendCacheLossMap, extractCachedContent } from './utils/helpers';
import { isMainAgent, isPostClearCheckpoint } from './utils/contentFilter';
import { apiUrl } from './utils/apiUrl';
import { saveEntries, loadEntries, clearEntries, getCacheMeta, saveSessionEntries, loadSessionEntries, saveSessionIndex } from './utils/entryCache';
import { buildSessionIndex, splitHotCold, mergeSessionIndices, HOT_SESSION_COUNT, assignMessageTimestamps, applyInPlaceLastMsgReplace } from './utils/sessionManager';
import { mergeMainAgentSessions as _mergeMainAgentSessions } from './utils/sessionMerge';
import { reconstructEntries, createIncrementalReconstructor } from '../lib/delta-reconstructor.js';
import { createEntrySlimmer, createIncrementalSlimmer, restoreSlimmedEntry, internEntryBigFields } from './utils/entry-slim.js';
import { reinitializeMermaid } from './hooks/useMermaidRender';
import styles from './App.module.css';

export { styles };

export const MAX_SESSIONS = (isMobile && !isPad) ? 30 : 100;
// /clear 后乐观水位：把上下文血条压到这个百分比，下一次 context_window SSE 推送会自动覆盖回真实值
export const OPTIMISTIC_CLEAR_PERCENT = 5;

// AntD 主题配置：模块顶层冻结常量。
// 旧实现是 getter 每次 render 返回新字面量，导致 antd cssinjs useTheme cache 永远 miss、
// flattenToken 反复跑。顶层常量保证主题不变时引用稳定。
const LIGHT_THEME_CONFIG = Object.freeze({
  algorithm: theme.defaultAlgorithm,
  token: Object.freeze({
    colorPrimary: '#0969DA',
    colorBgContainer: '#FFFFFF',
    colorBgLayout: '#FAFAFA',
    colorBgElevated: '#FFFFFF',
    colorBorder: '#E0E0E0',
    controlOutline: 'transparent',
    controlOutlineWidth: 0,
  }),
});

const DARK_THEME_CONFIG = Object.freeze({
  algorithm: theme.darkAlgorithm,
  token: Object.freeze({
    colorPrimary: '#1668dc',
    colorBgContainer: '#111',
    colorBgLayout: '#0a0a0a',
    colorBgElevated: '#1e1e1e',
    colorBorder: '#2a2a2a',
    controlOutline: 'transparent',
    controlOutlineWidth: 0,
  }),
});

/**
 * 共享基类：包含 PC 和 Mobile 通用的状态管理、SSE 通信、数据处理、偏好设置等逻辑。
 * 子类 App (PC) 和 Mobile 各自实现 render() 方法。
 *
 * settings 数据(claude-settings + preferences)集中由 SettingsContext 提供;
 * setLang / setClaudeConfigDir 这两个全局副作用已搬到 SettingsProvider 的 fetch 回调。
 * AppBase 仍保留本地 state 副本用于即时 UI 反馈,POST 写入走 this.context.updatePreferences。
 */
class AppBase extends React.Component {
  static contextType = SettingsContext;

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
      autoApproveSeconds: 0, // 自动审批倒计时秒数，0=关闭
      collapseToolResults: true,
      expandThinking: false,
      expandDiff: false,
      logDir: '',
      showFullToolContent: false,
      showThinkingSummaries: false,
      themeColor: 'light',
      claudeMissing: false,
      updateModalVisible: false,
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
      contextBarOptimistic: false, // /clear 后的乐观水位重置，下一次 context_window SSE 自动清除
      isStreaming: false,
      streamingLatest: null, // { timestamp, url, content, model } — Live typewriter overlay for latest assistant message
      hasMoreHistory: false,
      loadingMore: false,
      sessionIndex: [],
      loadingSessionId: null,
      proxyProfiles: [],
      activeProxyId: 'max',
      defaultConfig: null,
      // ─── Approval modal global state ───
      // approvalGlobal: { ptyPlan?, ask? } currently active in the (single) ChatView mounted in this app instance.
      // Each entry carries { id, ..., handlers } as bubbled by ChatView.componentDidUpdate.
      // Permission and SDK ExitPlanMode stay inline-only — they do NOT pop the global modal.
      approvalGlobal: { ptyPlan: null, ask: null },
      // approvalDismissedIds: pending ids the user has chosen to minimize. Reopens via bell / chip.
      approvalDismissedIds: new Set(),
      // approvalOtherTabs: aggregated state from other Electron tabs, pushed by main via tabBridge.onApprovalBroadcast.
      approvalOtherTabs: [],
      // approvalOwnPending: 当前 tab 在 main 进程聚合的 pending 计数（来自 approval-broadcast.ownPending）。
      // 仅信息性使用（bell badge 显示「服务端记得有 N 条 pending」），不试图重写 approvalGlobal——
      // approvalGlobal 含 questions / handlers 闭包无法跨 IPC 序列化，权威源是 ChatView 的 pendingAsk / pendingPtyPlan。
      approvalOwnPending: { ask: 0, ptyPlan: 0 },
      // ownTabId: numeric tab id pushed by main once on view init (electron only). null in pure web mode.
      ownTabId: null,
      // approvalPrefs: user toggles persisted to /api/preferences (defaults sized for least surprise).
      approvalPrefs: { modalEnabled: true, soundEnabled: false, notifyOnlyWhenHidden: true },
    };
    this.eventSource = null;
    this._currentSessionId = null;
    // 跟踪上一次 mainAgent entry 的 timestamp，给新增 assistant msg 赋 _generatedTs（生成时 ts）。
    // 解决 bubble 时间标签晚一拍的 bug：assistant 响应是上一次 API 调用产出的，
    // 被这次 API 调用带进 body.messages，旧逻辑统一赋 entry.timestamp 导致显示成"下一次 ts"。
    this._prevMainAgentTs = null;
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
    this._sseSlimmer = null; this._sseReconstructor = null;
  }

  /** 批量剪枝 entries：清空旧 MainAgent 的 body.messages，保留最后一条完整。
   *  v3: intern body.tools / body.system 让所有 entry 共享 pool 引用 */
  _batchSlim(entries) {
    for (let i = 0; i < entries.length; i++) entries[i] = internEntryBigFields(entries[i]);
    const slimmer = createEntrySlimmer(isMainAgent);
    for (let i = 0; i < entries.length; i++) slimmer.process(entries[i], entries, i);
    slimmer.finalize(entries);
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
    this._sseSlimmer = null; this._sseReconstructor = null;
  }

  // 给子组件(ChatView / TerminalPanel)一次性注入 SettingsContext 的所有字段。
  // 不能直接给它们绑 contextType — 它们已绑 TerminalWsContext,class 一次只能一个。
  _settingsProps() {
    const ctx = this.context || {};
    return {
      claudeSettings: ctx.claudeSettings,
      preferences: ctx.preferences,
      onUpdatePreferences: ctx.updatePreferences,
      onUpdateClaudeSettings: ctx.updateClaudeSettings,
    };
  }

  /**
   * 单次遍历完成 timestamp 赋值 + session 构建 + 过滤 + index 重建。
   * 合并 assignMessageTimestamps + buildSessionsFromEntries + filterRelevantRequests + _rebuildRequestIndex，
   * 减少 3 次 O(n) 全量扫描。
   */
  _processEntries(entries) {
    let timestamps = [];
    let generatedTimestamps = [];   // 跟 timestamps 平行：position → _generatedTs（assistant 才有）
    let prevMainAgentTs = null;      // 上一次 mainAgent entry 的 ts，给本次新增 assistant msg 赋
    let prevUserId = null;
    let sessions = [];
    const filtered = [];

    // _rebuildRequestIndex 内联
    this._requestIndexMap.clear();
    this._cacheLossProcessedCount = 0;
    this._cacheLossLastMainAgent = null;
    this._cacheLossMap = new Map();
    this._lastKvCacheContent = null;
    this._sseSlimmer = null; this._sseReconstructor = null;

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
        // /clear 后的首个 checkpoint：必须当成新会话起点，绕过 transient 过滤。
        // 否则 delta 重建后第一个条目（count=1）会被 isTransient 吞掉，
        // 导致 /clear 标记+用户输入的 _timestamp 被后面第一个 count>4 的条目"挪走"。
        const postClearCheckpoint = isPostClearCheckpoint(entry, prevCount);
        const isNewSession = postClearCheckpoint || (prevCount > 0 && (
          (count < prevCount * 0.5 && (prevCount - count) > 4) ||
          (prevUserId && userId && userId !== prevUserId)
        ));
        // Transient 保护：极短 entry（<=4 msgs）在长对话后不应重置 timestamps 累积
        // 这些通常是中间态请求（request body 只有 user message，尚未拿到 response）。
        // postClearCheckpoint 是真实的会话起点，必须豁免。
        const isTransient = isNewSession && !postClearCheckpoint && count <= 4 && prevCount > 4 && count < prevCount * 0.5;
        if (isNewSession && !isTransient) {
          currentSessionId = timestamp;
          timestamps = [];
          generatedTimestamps = [];
          prevMainAgentTs = null;       // 新 session 起点：reset，防跨 session 串场
        } else if (currentSessionId === null) {
          currentSessionId = timestamp;
        }
        // 扩展两个平行数组：新增 position 拿当前 entry 的 ts；并记录 prevMainAgentTs
        // 作为该位置「首次加入时上一个 mainAgent 的 ts」。
        // 注意：不在 push 时 gate isAsst —— offline 批量路径下，本次 entry 可能是 _slimmed
        // （body.messages=[]）只靠 _messageCount 占位，messages[j] 是 undefined 会让 isAsst=false
        // 永远 push null，导致后续 unslimmed checkpoint 的 inner loop 无法 backfill _generatedTs。
        // 角色判断挪到 inner loop（msg 对象一定存在那时），用 m.role 在写入时 gate。
        for (let j = timestamps.length; j < count; j++) {
          timestamps.push(timestamp);
          generatedTimestamps.push(prevMainAgentTs || null);
        }
        if (messages.length > 0) {
          for (let j = 0; j < messages.length; j++) {
            const m = messages[j];
            if (!m) continue;
            m._timestamp = timestamps[j];
            if (m.role === 'assistant' && generatedTimestamps[j]) {
              m._generatedTs = generatedTimestamps[j];
            }
          }
        }
        prevUserId = userId;
        // 记录本次 mainAgent entry 的 ts，下一次循环用作 prevMainAgentTs
        prevMainAgentTs = timestamp;

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
    // claude-settings / preferences fetch 由 SettingsProvider 集中触发;
    // 这里仅订阅其 Promise,把字段同步到本地 state(沿用现有 13+ 个 setState 消费链路)。
    this.context._claudeSettingsReady.then(data => {
      if (!data) return;
      if (data.showThinkingSummaries) this.setState({ showThinkingSummaries: true });
      if (data.claudeAvailable === false) this.setState({ claudeMissing: true });
    });

    // ─── Approval modal: subscribe to electron main → tabBridge ──────────────────
    // No-op when running in pure web mode — window.tabBridge is only injected by tab-content-preload.js.
    // Subscription handles保存到 instance 以便 unmount 时卸载，避免 webContents reload 累加监听。
    this._tabBridgeDisposers = [];
    if (typeof window !== 'undefined' && window.tabBridge) {
      try {
        const offTabId = window.tabBridge.onTabIdInit?.((tabId) => {
          this.setState({ ownTabId: tabId });
        });
        const offBroadcast = window.tabBridge.onApprovalBroadcast?.((payload) => {
          if (!payload) return;
          // ownPending 只取计数（main 进程的 ptyPlan/ask Map 序列化为 [{id, projectName, ...}]）。
          // 不重写 approvalGlobal——闭包内的 handlers / questions 无法跨 IPC 还原，
          // 权威源仍是 ChatView 的 pendingAsk / pendingPtyPlan（WS 重连服务端会重放）。
          const op = payload.ownPending;
          const ownPendingCount = (op && typeof op === 'object')
            ? { ask: Array.isArray(op.ask) ? op.ask.length : 0, ptyPlan: Array.isArray(op.ptyPlan) ? op.ptyPlan.length : 0 }
            : { ask: 0, ptyPlan: 0 };
          this.setState((prev) => ({
            ownTabId: payload.ownTabId != null ? payload.ownTabId : prev.ownTabId,
            approvalOtherTabs: Array.isArray(payload.others) ? payload.others : [],
            approvalOwnPending: ownPendingCount,
          }));
        });
        if (typeof offTabId === 'function') this._tabBridgeDisposers.push(offTabId);
        if (typeof offBroadcast === 'function') this._tabBridgeDisposers.push(offBroadcast);
      } catch {}
    }

    // 等 SettingsProvider 完成 /api/preferences fetch,把字段同步到本地 state。
    // setLang / setClaudeConfigDir 已由 Provider 处理,这里不再重复。
    // initSSE 仍可读 this._prefsReady(getter 代理到 context),resume_prompt 行为不变。
    this.context._prefsReady.then(data => {
      if (!data) return;
      if (data.lang) this.setState({ lang: data.lang });
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
      if (typeof data.autoApproveSeconds === 'number') {
        this.setState({ autoApproveSeconds: data.autoApproveSeconds });
      }
      // Approval modal preferences (defaults already in initial state — only override when persisted).
      if (data.approvalModal && typeof data.approvalModal === 'object') {
        this.setState(prev => {
          const next = {
            modalEnabled: data.approvalModal.modalEnabled !== undefined ? !!data.approvalModal.modalEnabled : prev.approvalPrefs.modalEnabled,
            soundEnabled: data.approvalModal.soundEnabled !== undefined ? !!data.approvalModal.soundEnabled : prev.approvalPrefs.soundEnabled,
            notifyOnlyWhenHidden: data.approvalModal.notifyOnlyWhenHidden !== undefined ? !!data.approvalModal.notifyOnlyWhenHidden : prev.approvalPrefs.notifyOnlyWhenHidden,
          };
          // 同步给 electron main 进程,让 maybeNotify 用最新的 notifyOnlyWhenHidden 决策。
          // 非 electron 环境下 tabBridge 不存在,可选链跳过。
          try { window.tabBridge?.setApprovalPref?.(next); } catch (e) { console.warn('[approvalPref IPC] hydrate sync failed:', e); }
          return { approvalPrefs: next };
        });
      }
      // hydrate：prefs 没保存过 themeColor 时回退到当前 state（首次安装是 'light'）。
      // 不写回 prefs（这一路是从 prefs 读出来的），但写 localStorage 让 inline boot script 抢占。
      const effective = (data.themeColor === 'light' || data.themeColor === 'dark')
        ? data.themeColor
        : this.state.themeColor;
      this._applyTheme(effective);
      // filterIrrelevant 默认 true，showAll = !filterIrrelevant
      const filterIrrelevant = data.filterIrrelevant !== undefined ? !!data.filterIrrelevant : true;
      this.setState({ showAll: !filterIrrelevant });
      if (data.logDir) {
        this.setState({ logDir: data.logDir });
      }
      // URL 参数覆盖主题（白名单校验防 XSS）。一次性覆盖，不写回 prefs，但同步 localStorage。
      const urlTheme = new URLSearchParams(window.location.search).get('theme');
      if (urlTheme === 'light' || urlTheme === 'dark') {
        this._applyTheme(urlTheme);
      }
    });

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
              this._batchSlim(cached);
              const { mainAgentSessions, filtered } = this._processEntries(cached);
              // P1: 缓存恢复也做 hot/cold 分层，避免全量数据驻留内存
              if (mainAgentSessions.length > HOT_SESSION_COUNT) {
                const sessionIndex = buildSessionIndex(cached, mainAgentSessions);
                // slimmer 全平台：split 前还原 slimmed entries，确保 IndexedDB / hot 数据完整
                const unslimmed = cached.map(e => e._slimmed ? restoreSlimmedEntry(e, cached) : e);
                const { hotEntries, allSessions } = splitHotCold(
                  unslimmed, mainAgentSessions, sessionIndex, HOT_SESSION_COUNT
                );
                this._sseSlimmer = null; this._sseReconstructor = null; // 重置，下帧 SSE 重建
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

  componentDidUpdate(prevProps, prevState) {
    // context.claudeSettings 后续变化(如 ChatMessage 触发的 showThinkingSummaries 启用)
    // 同步到本地 state,让 props.showThinkingSummaries 下游消费方立即响应。
    // contextType 不提供 prevContext,只能比对 context value 与本地 state。
    const cs = this.context && this.context.claudeSettings;
    if (cs && !!cs.showThinkingSummaries !== !!this.state.showThinkingSummaries) {
      this.setState({ showThinkingSummaries: !!cs.showThinkingSummaries });
    }
  }

  componentWillUnmount() {
    if (Array.isArray(this._tabBridgeDisposers)) {
      for (const off of this._tabBridgeDisposers) {
        try { off(); } catch {}
      }
      this._tabBridgeDisposers = null;
    }
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
    if (this._streamingRaf) { cancelAnimationFrame(this._streamingRaf); this._streamingRaf = null; }
    if (this._clearOptimisticTimer) clearTimeout(this._clearOptimisticTimer);
    this._pendingStreamingLatest = null;
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

  // 不关闭 EventSource —— 连接是会话级单例，workspace 切换复用同一条连接。
  _teardownTransientLiveState = () => {
    this._pendingEntries = [];
    if (this._flushRafId) { cancelAnimationFrame(this._flushRafId); this._flushRafId = null; }
    if (this._streamingOffTimer) { clearTimeout(this._streamingOffTimer); this._streamingOffTimer = null; }
    if (this._loadingCountRafId) { cancelAnimationFrame(this._loadingCountRafId); this._loadingCountRafId = null; }
    this._chunkedEntries = [];
    this._chunkedTotal = 0;
    this._isIncremental = false;
    this._sseSlimmer = null;
    this._sseReconstructor = null;
  };

  _reconnectSSE() {
    // SSE 连接真死（心跳超时 / 重试上限），清除流式 overlay 避免卡死
    if (this.state.streamingLatest) this.setState({ streamingLatest: null });
    if (this._sseReconnectCount >= 10) {
      console.error('SSE reconnect limit reached');
      return;
    }
    this._sseReconnectCount = (this._sseReconnectCount || 0) + 1;
    if (this.eventSource) { this.eventSource.close(); this.eventSource = null; }

    // 必须在 _teardownTransientLiveState() 之前，否则 _chunkedEntries 会被清零。
    if (this._chunkedEntries && this._chunkedEntries.length > 0 && isMobile) {
      try {
        const partial = reconstructEntries([...this._chunkedEntries]);
        if (Array.isArray(partial) && partial.length > 0) {
          this._batchSlim(partial);
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

    this._teardownTransientLiveState();
    this.setState({ isStreaming: false });
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
    // 防御 _hasMoreHistory=true 而 _oldestTs 为 null 的不一致状态：
    // 没有锚点时间戳就别去拼 before=null，否则服务端 400。把 hasMoreHistory 同步
    // 关掉避免上层 loader 反复触发。
    if (!this._oldestTs) {
      this.setState({ hasMoreHistory: false });
      return;
    }
    this._loadingMore = true;
    this.setState({ loadingMore: true });
    try {
      const res = await fetch(apiUrl(`/api/entries/page?before=${encodeURIComponent(this._oldestTs)}&limit=100`));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data.entries) && data.entries.length > 0) {
        const reconstructed = reconstructEntries(data.entries);
        const merged = [...reconstructed, ...this.state.requests];
        this._batchSlim(merged);
        const { mainAgentSessions } = this._processEntries(merged);
        this._oldestTs = data.oldestTimestamp;

        // P1: 移动端 hot/cold 分层
        if (isMobile && mainAgentSessions.length > HOT_SESSION_COUNT) {
          const sessionIndex = buildSessionIndex(merged, mainAgentSessions);
          const fullIndex = mergeSessionIndices(this.state.sessionIndex, sessionIndex);
          const unslimmed = merged.map(e => e._slimmed ? restoreSlimmedEntry(e, merged) : e);
          const { hotEntries, allSessions, coldGroups } = splitHotCold(
            unslimmed, mainAgentSessions, fullIndex, HOT_SESSION_COUNT
          );
          this._sseSlimmer = null; this._sseReconstructor = null;
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
            hasMoreHistory: !!data.hasMore && !!data.oldestTimestamp,
            loadingMore: false,
          });
        } else {
          this.setState({
            requests: merged,
            mainAgentSessions,
            hasMoreHistory: !!data.hasMore && !!data.oldestTimestamp,
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
      message.error(t('ui.loadMoreHistoryFailed'));
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
      // Live streaming overlay: 直接更新 streamingLatest state（不走 reconstructor / dedup）
      // rAF coalesce + startTransition：每个 SSE chunk 只在下一帧合并成一次 setState，
      // 并标记为低优先级渲染，避免阻塞用户输入。最终 chunk 经 entry path 交付而非
      // stream-progress，所以丢掉 trailing stream-progress 是安全的。
      this.eventSource.addEventListener('stream-progress', (event) => {
        this._resetSSETimeout();
        try {
          const data = JSON.parse(event.data);
          // 防 stale：若 requests 中已有同 timestamp 的完成条目，说明最终 entry 已到达，
          // 此 chunk 是乱序/延迟到达的旧包，直接丢弃以免复活已清除的 overlay
          const existingFinal = this.state.requests.find(r =>
            r && r.timestamp === data.timestamp && !r.inProgress
          );
          if (existingFinal) return;
          // streamingLatest 生命周期只由两种信号终结（不再用短 timeout 兜底）：
          // 1) 正常：最终 entry 到达时 _flushPendingEntries 原子清除
          // 2) 异常：SSE 连接真死 (_reconnectSSE)
          // 避免长 thinking / 网络抖动 / 切 tab 等场景误杀 overlay。
          this._pendingStreamingLatest = {
            timestamp: data.timestamp,
            url: data.url,
            content: data.content || [],
            model: data.model,
            updatedAt: Date.now(),
          };
          if (this._streamingRaf) return;
          this._streamingRaf = requestAnimationFrame(() => {
            this._streamingRaf = null;
            const pending = this._pendingStreamingLatest;
            this._pendingStreamingLatest = null;
            if (!pending) return;
            React.startTransition(() => {
              this.setState({ streamingLatest: pending });
            });
          });
        } catch { }
      });
      this.eventSource.addEventListener('resume_prompt', (event) => {
        this._resetSSETimeout();
        try {
          const data = JSON.parse(event.data);
          // 等待偏好加载完成再判断是否跳过弹窗（避免竞态）
          (this.context._prefsReady || Promise.resolve({})).then((prefs) => {
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
      // update_completed 事件已废弃：自 1.6.203 起后台 detached npm install 负责升级，
      // 当前进程内存里仍是旧版本，广播"已升级完成"会误导用户。保留 update_major_available
      // 作为"有新版可用"的统一信号（包含跨大版本提示 + 本版本忙时跳过两种场景）。
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
          this._batchSlim(entries);
          const { mainAgentSessions, filtered } = this._processEntries(entries);

          // P1: 移动端 hot/cold 分层
          if (isMobile && mainAgentSessions.length > HOT_SESSION_COUNT) {
            const sessionIndex = buildSessionIndex(entries, mainAgentSessions);
            const fullIndex = isIncremental
              ? mergeSessionIndices(this.state.sessionIndex, sessionIndex)
              : sessionIndex;
            const unslimmed = entries.map(e => e._slimmed ? restoreSlimmedEntry(e, entries) : e);
            const { hotEntries, allSessions, coldGroups } = splitHotCold(
              unslimmed, mainAgentSessions, fullIndex, HOT_SESSION_COUNT
            );
            this._sseSlimmer = null; this._sseReconstructor = null;
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
            // hasMoreHistory 必须 AND 上 _oldestTs 非空，否则后续 loadMoreHistory() 会拼 before=null 触发 400
            if (!isIncremental) newState.hasMoreHistory = !!this._hasMoreHistory && !!this._oldestTs;
            this.setState(newState);
          } else {
            const newState = {
              requests: entries,
              selectedIndex: filtered.length > 0 ? filtered.length - 1 : null,
              mainAgentSessions,
              fileLoading: false,
              fileLoadingCount: 0,
            };
            if (!isIncremental) newState.hasMoreHistory = !!this._hasMoreHistory && !!this._oldestTs;
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
            if (entries.length > 0) this._batchSlim(entries);
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
            streamingLatest: null,
          });
          if (isMobile) clearEntries();
        } catch {}
      });
      this.eventSource.addEventListener('workspace_stopped', () => {
        this._resetSSETimeout();
        this._teardownTransientLiveState();
        this._rebuildRequestIndex([]);
        this.setState({
          workspaceMode: true,
          requests: [],
          mainAgentSessions: [],
          projectName: '',
          selectedIndex: null,
          streamingLatest: null,
        });
      });
      this.eventSource.addEventListener('context_window', (event) => {
        this._resetSSETimeout();
        try {
          const data = JSON.parse(event.data);
          this.setState({ contextWindow: data, contextBarOptimistic: false });
          if (this._clearOptimisticTimer) { clearTimeout(this._clearOptimisticTimer); this._clearOptimisticTimer = null; }
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
      this.eventSource.onerror = () => {
        console.error('SSE连接错误');
        // 不清 streamingLatest：浏览器会自动 3s 重连，新 chunk 到达会覆盖 state；
        // 若彻底断连，45s heartbeat 超时触发 _reconnectSSE，那里会清 overlay；
        // 若流式已完成，最终 entry 的原子清除会收走 overlay。
      };
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
      this._batchSlim(reconstructed);
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
      let shouldClearStreaming = false;  // 检测到最终 entry 时原子清除 Live overlay

      // P0 perf: lazy init 增量剪枝器
      if (!this._sseSlimmer) {
        this._sseSlimmer = createIncrementalSlimmer(isMainAgent);
      }
      // Delta 增量重建器：SSE 逐条到达的 delta entry 只有增量 messages，
      // 需要拼接为完整 messages（与批量加载时 reconstructEntries 对应）
      if (!this._sseReconstructor) {
        this._sseReconstructor = createIncrementalReconstructor();
      }

      for (const rawEntry of batch) {
        // v3: intern body.tools / body.system → pool 共享引用，消除 fullEntry 累积
        // v5: 同时 intern body.messages 内 tool_result block.content（lazy-clone 三层
        //     messages/content/block）。下方 L1170-1175 mutate `messages[i]._timestamp`
        //     的安全前提：浅 clone 仅 spread 顶层字段保留 _timestamp 写位；共享的
        //     block.content 是 string primitive 不可变，跨 entry 共享 ref 不会串扰。
        const entry = internEntryBigFields(this._sseReconstructor.reconstruct(rawEntry));
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

        // Live overlay 原子清除：最终 entry（非 inProgress）到达且 timestamp 匹配 → 同 setState 清除 overlay
        if (!entry.inProgress && isMainAgent(entry) && prev.streamingLatest
            && prev.streamingLatest.timestamp === entry.timestamp) {
          shouldClearStreaming = true;
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
          // /clear 后首个 checkpoint：同 device 下 sameUser 永远 true，会让 isNewSession 失效，
          // 导致 L1058 的 inheritance 把旧 session 的 _timestamp 灌到新 /clear 后的 msg 上。
          const postClearCheckpoint = isPostClearCheckpoint(entry, prevCount);
          const isNewSession = postClearCheckpoint || (!sameUser && prevCount > 0 && messages.length < prevCount * 0.5 && (prevCount - messages.length) > 4);

          // SSE 实时流每条 entry 都是完整 request+response，不存在"中间态"；
          // 历史代码曾在此处 `if (isTransient) continue` 跳过极短 entry 防中间态污染，
          // 但这会把真实的 /clear → 短对话（如 "hi"）也丢掉 —— 交给 mergeMainAgentSessions
          // 的 skipTransientFilter: true 统一放行，isNewSession 单独驱动 _currentSessionId。
          if (isNewSession) {
            this._currentSessionId = timestamp;
            // 新 session 起点：reset _prevMainAgentTs 防跨 session 串场（旧 session 的末尾 ts
            // 不应作为新 session 第一条 assistant msg 的"生成时 ts"）
            this._prevMainAgentTs = null;
          } else if (this._currentSessionId === null) {
            this._currentSessionId = timestamp;
          }

          // 赋 _timestamp 和 _generatedTs（assistant 角色新增 msg 拿 prevMainAgentTs 反映生成时 ts）
          assignMessageTimestamps(messages, prevMessages, isNewSession, prevCount, timestamp, this._prevMainAgentTs);
          // 信号驱动短路：服务端已检测到末位替换（_inPlaceReplaceDetected:true）→ 直接 in-place
          // 替换 lastSession.messages 末位，避开 sessionMerge prefix-overlap 算法在
          // newLen===currentLen+末位fp异 场景必然 overlap=0 → push 整段 → 翻倍的陷阱。
          // helper 协议详见 src/utils/sessionManager.js applyInPlaceLastMsgReplace JSDoc。
          const inPlaceResult = applyInPlaceLastMsgReplace(mainAgentSessions, entry, timestamp, isNewSession);
          if (inPlaceResult.applied) {
            mainAgentSessions = inPlaceResult.sessions;
          } else {
            // SSE 实时追加：每条 entry 都已是完整 request+response，不存在中间态，
            // 跳过 transient 过滤以避免误伤真实的 /clear → 短消息对话。
            mainAgentSessions = this.mergeMainAgentSessions(mainAgentSessions, entry, { skipTransientFilter: true });
          }

          // 记录本次 mainAgent entry 的 timestamp，给下一次 entry 处理时
          // 当作 _generatedTs 赋给新增 assistant msg（反映"生成时刻"）。
          // 必须放在 if (isMainAgent && !_slimmed) 块内 —— timestamp 是该块内的 const
          this._prevMainAgentTs = timestamp;
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

      return {
        requests, cacheExpireAt, cacheType, mainAgentSessions,
        ...(shouldClearStreaming && { streamingLatest: null }),
      };
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
        this._batchSlim(merged);
        const { mainAgentSessions } = this._processEntries(merged);

        const sessionIndex = buildSessionIndex(merged, mainAgentSessions);
        const fullIndex = mergeSessionIndices(this.state.sessionIndex, sessionIndex);
        // Fix #3: pin 加载的 session，防止 splitHotCold 立即淘汰
        const unslimmed = merged.map(e => e._slimmed ? restoreSlimmedEntry(e, merged) : e);
        const { hotEntries, allSessions, coldGroups } = splitHotCold(
          unslimmed, mainAgentSessions, fullIndex, HOT_SESSION_COUNT,
          new Set([sessionId])
        );
        this._sseSlimmer = null; this._sseReconstructor = null;
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

    const unslimmed = requests.map(e => e._slimmed ? restoreSlimmedEntry(e, requests) : e);
    const { hotEntries, allSessions, coldGroups } = splitHotCold(
      unslimmed, mainAgentSessions, this.state.sessionIndex, HOT_SESSION_COUNT
    );
    this._sseSlimmer = null; this._sseReconstructor = null;
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

  mergeMainAgentSessions(prevSessions, entry, options) {
    return _mergeMainAgentSessions(prevSessions, entry, options);
  }

  // ─── 选中 & 导航 ───────────────────────────────────────

  handleSelectRequest = (index) => {
    this.setState({ selectedIndex: index, scrollCenter: false });
  };

  handleScrollDone = () => { this.setState({ scrollCenter: false }); };
  handleScrollTsDone = () => { this.setState({ chatScrollToTs: null }); };
  // 用户点 /clear 时立即把 Header 上下文血条降到 OPTIMISTIC_CLEAR_PERCENT 水位；
  // 正常路径下一次 context_window SSE 推送会自动取消。
  // 30s 兜底：SSE 没及时来（PTY 未连接、后端没推、CLI 崩了）时自动清掉，避免血条卡在低位。
  handleClearContextOptimistic = () => {
    this.setState({ contextBarOptimistic: true });
    if (this._clearOptimisticTimer) clearTimeout(this._clearOptimisticTimer);
    this._clearOptimisticTimer = setTimeout(() => {
      this.setState({ contextBarOptimistic: false });
      this._clearOptimisticTimer = null;
    }, 30000);
  };

  // ─── 模式切换 ──────────────────────────────────────────

  handleWorkspaceLaunch = ({ projectName }) => {
    this._isLocalLog = false;
    this._localLogFile = null;
    this.setState({
      workspaceMode: false,
      projectName,
      viewMode: 'chat',
      cliMode: true,
      terminalVisible: false,
    });
  };

  handleReturnToWorkspaces = () => {
    fetch(apiUrl('/api/workspaces/stop'), { method: 'POST' })
      .then(() => {
        this._teardownTransientLiveState();
        this._rebuildRequestIndex([]);
        this.setState({
          workspaceMode: true,
          requests: [],
          mainAgentSessions: [],
          projectName: '',
          selectedIndex: null,
          streamingLatest: null,
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
    this.context.updatePreferences({ lang });
  };

  handleCollapseToolResultsChange = (checked) => {
    this.setState({ collapseToolResults: checked });
    this.context.updatePreferences({ collapseToolResults: checked });
  };

  handleExpandThinkingChange = (checked) => {
    this.setState({ expandThinking: checked });
    this.context.updatePreferences({ expandThinking: checked });
  };

  handleExpandDiffChange = (checked) => {
    this.setState({ expandDiff: checked });
    this.context.updatePreferences({ expandDiff: checked });
  };

  handleAutoApproveChange = (seconds) => {
    this.setState({ autoApproveSeconds: seconds });
    this.context.updatePreferences({ autoApproveSeconds: seconds });
  };

  // ─── Approval modal: ChatView -> AppBase bubbling handlers ───────────────────────
  // Inject projectName from AppBase state so the modal chip / Notification body have
  // human-readable session context. ChatView itself doesn't track project name.
  _injectProjectName = (data, slot) => {
    if (!data) return data;
    const projectName = this.state.projectName || '';
    if (!projectName) return data;
    const innerKey = slot; // 'ptyPlan' | 'ask'
    if (data[innerKey] && data[innerKey].projectName === undefined) {
      return { ...data, [innerKey]: { ...data[innerKey], projectName } };
    }
    return data;
  };

  // Generic transition helper that mirrors a kind in/out of approvalGlobal AND wipes stale
  // dismissed entries for that kind. Used by both ask (static id reuse) and ptyPlan (timestamp ids
  // could repeat after long sessions). PTY plan and ask share the same dismiss-on-transition policy.
  _setApprovalKind = (kind, data) => {
    const enriched = this._injectProjectName(data, kind);
    this.setState(prev => {
      const next = { ...prev.approvalGlobal };
      if (enriched) next[kind] = enriched;
      else next[kind] = null;
      const dismissed = new Set(prev.approvalDismissedIds);
      let changed = false;
      for (const id of dismissed) {
        if (id.startsWith(`${kind}:`)) { dismissed.delete(id); changed = true; }
      }
      return changed
        ? { approvalGlobal: next, approvalDismissedIds: dismissed }
        : { approvalGlobal: next };
    });
  };

  handleApprovalAsk = (data) => this._setApprovalKind('ask', data);
  handleApprovalPtyPlan = (data) => this._setApprovalKind('ptyPlan', data);

  // Modal calls this when user presses ESC / clicks backdrop. Pending state untouched — only UI hides.
  handleApprovalDismiss = (kind, id) => {
    if (!kind || !id) return;
    this.setState(prev => {
      const next = new Set(prev.approvalDismissedIds);
      next.add(`${kind}:${id}`);
      return { approvalDismissedIds: next };
    });
  };

  // Bell / chip click reopens minimised modal — clear all dismissed entries currently pending.
  handleApprovalReopen = () => {
    this.setState({ approvalDismissedIds: new Set() });
  };

  // Cross-tab jump (electron only). Renderer doesn't directly switch — main does it.
  handleApprovalJumpTab = (tabId) => {
    if (typeof window !== 'undefined' && window.tabBridge?.jumpToTab && tabId != null) {
      try { window.tabBridge.jumpToTab(tabId); } catch {}
    }
  };

  handleApprovalPrefsChange = (patch) => {
    // 同源 next：setState + POST body 都用同一个 next，避免 rapid toggle 下第二次 POST 读到 stale state 漏 patch
    const next = { ...this.state.approvalPrefs, ...patch };
    this.setState({ approvalPrefs: next });
    // 同步给 electron main 进程,maybeNotify 立即用新 notifyOnlyWhenHidden 决策。
    try { window.tabBridge?.setApprovalPref?.(next); } catch (e) { console.warn('[approvalPref IPC] onChange sync failed:', e); }
    this.context.updatePreferences({ approvalModal: next });
  };

  /**
   * 主题应用收口：state / <html data-theme> / localStorage 三处镜像同步。
   * 三个调用方（hydrate / urlTheme / handleThemeColorChange）行为差异收敛到 opts。
   *
   * 幂等：setAttribute 只在值变化时调用，避免唤醒 TerminalPanel MutationObserver
   *       重赋 xterm theme（80×24 cell 重算 1-3ms）。
   */
  _applyTheme = (value, opts = {}) => {
    const theme = value === 'light' ? 'light' : 'dark';
    const { persistPref = false, remountMermaid = false } = opts;
    if (this.state.themeColor !== theme) this.setState({ themeColor: theme });
    if (document.documentElement.getAttribute('data-theme') !== theme) {
      document.documentElement.setAttribute('data-theme', theme);
    }
    try { localStorage.setItem('ccv_themeColor', theme); } catch {}
    if (remountMermaid) reinitializeMermaid();
    if (persistPref) this.context.updatePreferences({ themeColor: theme });
  };

  handleThemeColorChange = (value) => {
    this._applyTheme(value, { persistPref: true, remountMermaid: true });
    // 切换主题后让终端获得焦点，便于用户看到 /theme 切换效果
    window.dispatchEvent(new CustomEvent('ccv-focus-terminal'));
  };

  handleLogDirChange = (value) => {
    if (!value || typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed) return;
    this.setState({ logDir: trimmed });
    // logDir 服务端可能 normalize 后回写,read response.logDir 覆盖本地
    this.context.updatePreferences({ logDir: trimmed }).then(data => {
      if (data && data.logDir) this.setState({ logDir: data.logDir });
    });
  };

  handleShowFullToolContentChange = (checked) => {
    this.setState({ showFullToolContent: checked });
    this.context.updatePreferences({ showFullToolContent: checked });
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
    this.context.updatePreferences({ filterIrrelevant: checked });
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
    return (
      <LogTable
        logs={logs}
        mobile={mobile}
        selectedLogs={this.state.selectedLogs}
        onToggleSelect={this.handleToggleLogSelect}
        onOpenLog={this.handleOpenLogFile}
        onDownloadLog={this.handleDownloadLogFile}
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
      this.context.updatePreferences({ resumeAutoChoice: choice });
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
    this.context.updatePreferences({ resumeAutoChoice: value });
  };

  handleResumeAutoChoiceChange = (value) => {
    this.setState({ resumeAutoChoice: value });
    this.context.updatePreferences({ resumeAutoChoice: value });
  };

  _finishLocalLoad = (entries, fileNames) => {
    if (entries.length === 0) {
      message.error(t('ui.noLogs'));
      this.setState({ fileLoading: false, fileLoadingCount: 0 });
      return;
    }
    this.animateLoadingCount(entries.length, () => {
      this._batchSlim(entries);
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
      <ConfigProvider theme={this.themeConfig}>
        <WorkspaceList onLaunch={this.handleWorkspaceLaunch} />
      </ConfigProvider>
    );
  }

  /** Ant Design 主题配置 (dark/light)
   *
   * 历史尝试 `cssVar: true`（antd 5.14+）想砍 useToken/useGlobalCache 开销，但实测是性能
   * 负优化：trace3 vs trace2 显示 cssinjs 自身耗时 +170%，`flattenToken` +1426%，GC +56%，
   * 主线程 idle 从 16% 崩到 0.5%，dropped frames +64%。原因：启用 cssVar 后每个 token 多走
   * 一层 CSSVarRegister.path + flattenToken；4 处 ConfigProvider + 主题切换 + 大量 antd
   * 组件叠加，cache miss 路径被放大。antd 文档宣传的 20-35% 收益建立在「单 ConfigProvider
   * + 主题不切换」理想场景，本仓库不符合。结论：保持 hash style，不要开 cssVar。
   *
   * 引用稳定性：返回模块顶层冻结常量（LIGHT_THEME_CONFIG / DARK_THEME_CONFIG），
   * 主题不变时 React 每次 render 都拿到同一引用 → cssinjs useTheme useMemo 真正命中。
   */
  get themeConfig() {
    return this.state.themeColor === 'light' ? LIGHT_THEME_CONFIG : DARK_THEME_CONFIG;
  }
}

export default AppBase;
