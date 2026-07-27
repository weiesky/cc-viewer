import React from 'react';
import { ConfigProvider, theme, Modal, Spin, Button, message } from 'antd';
import { uploadFileAndGetPath } from './components/terminal/TerminalPanel';
import { DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import { isMobile, isPad, hasNativeZoom } from './env';
import WorkspaceList from './components/dashboard/WorkspaceList';
import OpenFolderIcon from './components/common/OpenFolderIcon';
import LogTable from './components/viewers/LogTable';
import { t, getLang, setLang } from './i18n';
import { SettingsContext } from './contexts/SettingsContext';
import { formatTokenCount, filterRelevantRequests, isRelevantRequest, visibleRequests, appendCacheLossMap, extractCachedContent } from './utils/helpers';
import { snapToPreset, stepPreset } from './utils/displayScaleHelper';
import { getProjectAlias, subscribeToAlias } from './utils/projectAlias';
import { isMainAgent, isSessionBoundary } from './utils/contentFilter';
import { apiUrl, getBasePath } from './utils/apiUrl';
import { publish as publishWorkflowUpdate } from './utils/workflowStore';
import { reportSwallowed } from './utils/errorReport';
import { playEvent as playVoiceEvent, unlockAudio, setTurnEndCooldownMs } from './utils/voicePackPlayer';
import { getDefaultBindingsForLocale as vpDefaultBindingsForLocale } from '../server/lib/voice-pack-events';
import { mergeVoicePackInto } from '../server/lib/approval-modal-prefs';
import { saveEntries, loadEntries, clearEntries, getCacheMeta } from './utils/entryCache';
import { assignMessageTimestamps, applyInPlaceLastMsgReplace, getSessionStableId, resolveDisplaySessions, getLatestSessionByActivity, resolveHydratedPin, runPinHydration, applyBatchEntryTimestamps } from './utils/sessionManager';
import { mergeMainAgentSessions as _mergeMainAgentSessions, isMergeBlockedEntry } from './utils/sessionMerge';
import { reconstructEntries, createIncrementalReconstructor } from '../server/lib/delta-reconstructor.js';
import { createEntrySlimmer, createIncrementalSlimmer, internEntryBigFields } from './utils/entry-slim.js';
import { yieldToMain, runChunkedPass, INGEST_BATCH_SIZE } from './utils/ingestPipeline.js';
import { rowToListItem } from './utils/v3Rows.js';
import { createV3Assembler } from './utils/v3Assembler.js';
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
      // Wire v3 (flagged): request-list metadata rows — the list's data source
      // when the server announces wireV3 via server_config. Row identity for
      // live upserts is (sessionId, seq); timestamp|url stays the cross-channel
      // locate/dedup identity shared with `requests`.
      v2Rows: [],
      v2RowsMeta: { totalCount: 0, hasMore: false, oldestTs: '' },
      selectedIndex: null,
      viewMode: 'raw',
      cacheExpireAt,
      cacheType,
      mainAgentSessions: [], // [{ messages, response }]
      // 「仅展示当前会话」锁定的会话稳定 id（= 会话起点 ts）；null = 未锁定。
      // 服务端持久化（按项目），同进程多端经 SSE 实时一致。
      // 命名提示：本字段就是服务端 /api/session-pin 里的 `pinnedSessionId`（同一个值，Ts/Id 同物）。
      pinnedSessionTs: null,
      importModalVisible: false,
      migratePromptVisible: false, // 1.7.0 P2: startup v1→v2 migration prompt
      migratePromptData: null,     // {files, totalBytes, otherProjects, continued}
      unmigratedV1Count: 0,        // v1-view hint row + migrate-button gating
      unmigratedV1Bytes: 0,
      v1FileCount: 0,      // v1 files ON DISK — gates the v1-view entry link
      logView: 'v2',       // logs-modal view: 'v2' (default) | 'v1' (legacy files)
      localLogs: {},       // { projectName: [{file, timestamp, size}] }
      localLogsV1: {},     // v1 view data ({ projectName: [{file, timestamp, size}] })
      localLogsLoading: false,
      refreshingStats: false,
      wireV2Convert: null, // wire-v2 S8 迁移任务状态快照（GET /api/wire-v2-convert），弹窗打开期间轮询
      showAll: false,
      lang: getLang(),
      userProfile: null,    // { name, avatar }
      projectName: '',      // 当前监控的项目名称
      // claude 自己存的项目偏好 model（~/.claude.json projects[cwd].lastModelUsage 推断），
      // 用作 AppHeader 血条 calibration 'auto' 启动期的回落 hint（避 haiku init ping 误判 200K）。
      // 初值 null = 还没拿到；/api/claude-settings 与 workspace_started SSE 都会塞值。
      claudeProjectModel: null,
      resumeRememberChoice: false,
      autoApproveSeconds: 0, // 自动审批倒计时秒数，0=关闭
      logDir: '',
      themeColor: /Windows/i.test(navigator.userAgent) ? 'dark' : 'light',
      displayScale: 100, // 整体显示缩放百分比(100=原始大小),仅 Electron 桌面经 webFrame.setZoomFactor 原生缩放;浏览器交由原生快捷键

      claudeMissing: false,
      updateModalVisible: false,
      fileLoading: false,
      fileLoadingCount: 0,
      fileLoadingBytes: null,
      isDragging: false,
      selectedLogs: new Set(),   // Set<file>
      githubStars: null,
      cliMode: false,
      sdkMode: false,
      workspaceMode: false,
      serverCachedContent: null,
      updateInfo: null,
      pendingUploadPaths: [],
      uploadingDrop: [], // [{id,name}] — 拖拽上传在途占位(spinner-only),供 ChatView 调谐 uploadingItems 实现「上传未完成时按发送→缓发不漏图」
      contextWindow: null,
      contextBarOptimistic: false, // /clear 后的乐观水位重置，下一次 context_window SSE 自动清除
      contextBarLocked: false, // /clear 触发后强制血条 0K (0%)，到用户发出非 /clear 消息时解锁
      isStreaming: false,
      streamingLatest: null, // { timestamp, url, content, model } — Live typewriter overlay for latest assistant message
      proxyProfiles: [],
      activeProxyId: 'max',
      defaultConfig: null,
      // 代理重试配置（GET /api/retry-config 注入；SSE 'retry_config' 刷新）
      retryConfig: null,
      retryDefaults: null,
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
      // approvalPrefs: user toggles persisted to /api/preferences.
      // soundEnabled = 合并后的"审批提示音"主开关（默认 ON），voicePack.enabled 始终 == soundEnabled。
      // hydrate 时如检测到老版本独立两字段不一致，会强制对齐并一次性写回 server。
      // events.turnEnd 仍默认 null（disabled，避免每轮都响）。
      // Locale-aware initial seed: zh / zh-TW 新用户首次拿 sanguo，其它走 default (butler)。
      // getLang() 在 i18n.js 模块加载时已调过 setLang(detectLanguage())（i18n.js:9465），
      // AppBase constructor 进入这里时 currentLang 已就绪 — 单测见 voice-pack-events.test.js。
      // 注意：这是 React state 初始 seed，不是 dynamic 重计算。运行时切语言不会重 seed
      // binding（避免静默改变用户持久化选择 — "no silent migration" P0 规则）。
      approvalPrefs: {
        modalEnabled: true,
        soundEnabled: true,
        notifyOnlyWhenHidden: true,
        planAutoApproveSeconds: 0, // 「Plan 自动审批」倒计时秒数（同 autoApproveSeconds 语义：0=关 / N=N 秒后自动批准 / -1=立即）；仅 CLI(PTY) 路径
        voicePack: {
          enabled: true,
          volume: 0.3,
          events: { ...vpDefaultBindingsForLocale(getLang()) },
        },
      },
    };
    this.eventSource = null;
    this._currentSessionId = null;
    // pin 竞态守卫（_maintainPinState/_hydratePin/session_pin SSE 用）：
    //  _isHydratingPin   — 服务端 pin 的 GET 在途；期间禁 lazy-lock + 禁 persist，防抢在真值返回前误锁/回写。
    //  _applyingRemotePin — 正在采纳服务端值（hydrate/SSE）；期间禁 persist，防把服务端值当本地改动回 POST（防回环）。
    //  _hydratePinSeq    — monotonic token per hydrate round; a GET that resolves after a
    //                      newer hydrate started (project switch, another reconnect) is discarded.
    this._isHydratingPin = false;
    this._applyingRemotePin = false;
    this._hydratePinSeq = 0;
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
    // 冷启动分帧摄取管线（_runColdIngestCore）并发控制：
    // - _ingestRunning 在途时 live 条目入 _liveGateBuffer（见 handleEventMessage），
    //   提交后统一泄洪，防止 live 条目与未提交基线交错污染 sessionMerge
    // - _ingestToken 自增令牌：任何 baseline 重置路径（重连/full_reload/workspace 切换/
    //   新管线启动）bump 即废弃在途管线，废弃管线不 setState
    this._ingestRunning = false;
    this._ingestToken = 0;
    this._liveGateBuffer = [];
    this._ingestProgressCount = 0;
  }

  /** 批量剪枝 entries：清空旧 MainAgent 的 body.messages，保留最后一条完整。
   *  v3: intern body.tools / body.system 让所有 entry 共享 pool 引用 */
  // Centralised document.title writer. All paths that used to do
  //   document.title = projectName
  //   document.title = `${projectName} - CC Viewer`
  // route through here so a user-configured per-project alias (utils/projectAlias)
  // can override consistently. Without this, the SSE workspace_started handler
  // would clobber alias on every switch.
  // Empty / missing projectName falls back to the literal app name to keep the
  // browser tab from showing a stale name across reloads.
  _applyDocTitle = (projectName) => {
    try {
      if (typeof document === 'undefined') return;
      const alias = getProjectAlias(projectName);
      if (alias) {
        document.title = alias;
      } else if (projectName) {
        document.title = projectName;
      } else {
        document.title = 'CC Viewer';
      }
    } catch { /* ignore — title is cosmetic, never block */ }
  };

  // Subscribe the current projectName to alias mutations (same-tab pubsub +
  // cross-tab storage event). Re-called whenever projectName changes so we
  // don't end up listening to an old project's key.
  _resubscribeAlias = (projectName) => {
    if (typeof this._aliasOff === 'function') {
      try { this._aliasOff(); } catch {}
      this._aliasOff = null;
    }
    if (!projectName) return;
    this._aliasOff = subscribeToAlias(projectName, () => {
      this._applyDocTitle(projectName);
    });
  };

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
      // 把 lang 塞进 settings spread,让 App / Mobile 入口都自动拿到,
      // 避免 ChatMessage 切语言时只在桌面端刷新而漏移动端。
      lang: this.state.lang,
    };
  }

  // 这 5 个偏好的唯一真相源是 SettingsContext(preferences/claudeSettings);
  // App/Mobile render 时直接派生往下传 prop,不再镜像进本地 state。
  // context 未就绪(fetch 前)时用与原初始 state 一致的默认值兜底。
  _prefValues() {
    const prefs = (this.context && this.context.preferences) || {};
    const cs = (this.context && this.context.claudeSettings) || {};
    return {
      collapseToolResults: prefs.collapseToolResults ?? true,
      expandThinking: !!prefs.expandThinking,
      expandDiff: !!prefs.expandDiff,
      showFullToolContent: !!prefs.showFullToolContent,
      showThinkingSummaries: !!cs.showThinkingSummaries,
    };
  }

  // 把 /api/preferences 回包水合进散落在 this.state 的偏好字段（autoApproveSeconds / approvalPrefs /
  // themeColor / displayScale / resumeAutoChoice 等，区别于 _prefValues() 直接读 context 的那几个）。
  // 初次加载与 refreshAllPrefs（toggle「项目独立配置」后）共用，避免抽屉里这半数控件读到旧的全局值。
  _hydratePrefsFromData = (data) => {
    if (!data) return;
    if (data.lang) this.setState({ lang: data.lang });
    // collapseToolResults / expandThinking / expandDiff / showFullToolContent
    // 不再镜像进 state —— render 经 _prefValues() 直接读 context.preferences。
    if (typeof data.autoApproveSeconds === 'number') {
      this.setState({ autoApproveSeconds: data.autoApproveSeconds });
    }
    // Approval modal preferences (defaults already in initial state — only override when persisted).
    if (data.approvalModal && typeof data.approvalModal === 'object') {
      // setState updater 不做 side effect，先在外层算 next + mismatch，再 setState + POST + IPC。
      const prevPrefs = this.state.approvalPrefs;
      const mergedVP = mergeVoicePackInto(prevPrefs.voicePack, data.approvalModal.voicePack);
      const next = {
        modalEnabled: data.approvalModal.modalEnabled !== undefined ? !!data.approvalModal.modalEnabled : prevPrefs.modalEnabled,
        soundEnabled: data.approvalModal.soundEnabled !== undefined ? !!data.approvalModal.soundEnabled : prevPrefs.soundEnabled,
        notifyOnlyWhenHidden: data.approvalModal.notifyOnlyWhenHidden !== undefined ? !!data.approvalModal.notifyOnlyWhenHidden : prevPrefs.notifyOnlyWhenHidden,
        planAutoApproveSeconds: typeof data.approvalModal.planAutoApproveSeconds === 'number' ? data.approvalModal.planAutoApproveSeconds : prevPrefs.planAutoApproveSeconds,
        voicePack: mergedVP,
      };
      // 合并开关迁移：server 端 soundEnabled !== voicePack.enabled 时以 soundEnabled 为准强制对齐（幂等回写）。
      const mismatch = !!next.voicePack.enabled !== !!next.soundEnabled;
      if (mismatch) {
        next.voicePack = { ...next.voicePack, enabled: next.soundEnabled };
      }
      this.setState({ approvalPrefs: next });
      // updatePreferences 顶层浅 merge：必须传完整 next（含 voicePack 子树），否则 events/volume 被砍。
      if (mismatch) {
        this.context?.updatePreferences?.({ approvalModal: next });
      }
      // 同步给 electron main 进程（voicePack 不发——播放在 renderer）。
      try {
        const { voicePack: _omit, ...forIpc } = next;
        window.tabBridge?.setApprovalPref?.(forIpc);
      } catch (e) { console.warn('[approvalPref IPC] hydrate sync failed:', e); }
    }
    // hydrate：prefs 没存过 themeColor 时回退当前 state（首次安装 'light'）。不写回 prefs，但同步 localStorage。
    const effective = (data.themeColor === 'light' || data.themeColor === 'dark')
      ? data.themeColor
      : this.state.themeColor;
    this._applyTheme(effective);
    // 整体显示大小：prefs 为准（跨设备），没存过回退当前 state(默认 100)。
    this._applyDisplayScale(data.displayScale ?? this.state.displayScale);
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
  };

  // 重新拉取偏好并重跑本地 state 水合（toggle 项目独立配置后、admin 改完他人 fork 后调用）。
  refreshAllPrefs = () => {
    const p = this.context?.refreshPreferences?.();
    if (!p || typeof p.then !== 'function') return Promise.resolve(null);
    return p.then(d => { if (d) this._hydratePrefsFromData(d); return d; });
  };

  // 切换「启动项目独立配置」：开启 = 把当前全局偏好 fork 到本项目；关闭 = 删除该 fork。
  // 服务端按当前项目 key 处理；成功后整刷一遍偏好（GET 会据 fork 解析出有效值）。
  handleToggleProjectScoped = (enabled) => {
    return fetch(apiUrl('/api/project-prefs/toggle'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !!enabled }),
    }).then(r => (r.ok ? r.json() : null))
      .then((resp) => {
        // 服务端确认后立刻乐观翻 _projectScoped，关掉"确认→refresh 到位"窗口内偏好写误投全局的风险；
        // 随后 refreshAllPrefs 再按 fork 解析出的有效值整体校准。toggle 失败(resp 为 null)则只刷新校准。
        if (resp) this.context?.mergeLocalPreferences?.({ _projectScoped: !!enabled });
        return this.refreshAllPrefs();
      })
      .catch(() => this.refreshAllPrefs());
  };

  // ─── 「仅展示当前会话」会话锁定（pin） ──────────────────────────
  // 生效的「仅展示当前会话」值：本地日志模式强制关闭（须看全量历史），否则取 _prefValues()
  // （含 Windows 未设时默认开启），与 App.jsx render 传给 ChatView 的口径一致。
  // 1.7.0: 「仅展示当前会话」是唯一模式（v2 无跨文件日志连续性）；本地日志查看
  // （一个 v2 会话可含多个 /clear epoch 展示会话）仍展示全部。
  _effectiveOnlyCurrentSession() {
    return !this._isLocalLog;
  }

  // Single definition of "the current session's stable id" — used by follow-latest
  // (_maintainPinState), hydrate adoption (_hydratePin), and the session_pin SSE
  // listener. Keep all three on this helper so the derivation can never drift
  // between the paths again (that divergence class is the bug this fixes).
  _derivedLatestId() {
    return getSessionStableId(getLatestSessionByActivity(this.state.mainAgentSessions));
  }

  // 一次性清理旧版浏览器本地 pin（ccv_pinnedSession_<项目>）。pin 已改服务端存储，这些键不再使用，
  // 历史上每访问一个项目就攒一个、永不回收。mount 时调用一次即可。
  _cleanupLegacyPinKeys() {
    try {
      const stale = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('ccv_pinnedSession_')) stale.push(k);
      }
      for (const k of stale) localStorage.removeItem(k);
    } catch {}
  }

  // pin 持久化 → 服务端（POST /api/session-pin），由 server 按项目落盘并 SSE 广播本进程，
  // 多端实时一致。本地日志模式无 server，短路不发。
  _persistPin() {
    if (this._isLocalLog) return;
    const val = this.state.pinnedSessionTs;
    try {
      fetch(apiUrl('/api/session-pin'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinnedSessionId: val == null ? null : String(val) }),
      }).catch(() => {});
    } catch {}
  }

  // 从服务端读回 pin（刷新/切项目/重连后恢复）。异步：hydrate 在途时置 _isHydratingPin，
  // 抑制 _maintainPinState 的 lazy-lock / persist，避免抢在 GET 返回前误锁并 POST 覆盖服务端真值。
  // 采纳服务端值时置 _applyingRemotePin，避免被 persist 分支当成本地改动回写。
  //
  // Orchestration lives in runPinHydration (sessionManager.js) so the race-sensitive
  // ordering is unit-tested: a stale server pin loses to the locally derived latest
  // when the toggle is on (resolveHydratedPin); a superseded GET (newer hydrate
  // started meanwhile) is discarded without touching the gate; and after settling,
  // the gate is cleared BEFORE _maintainPinState(null) re-runs follow-latest — so a
  // reconnect on an idle stream self-heals instead of sticking to a stale pin.
  _hydratePin() {
    if (this._isLocalLog) return;
    const seq = ++this._hydratePinSeq;
    this._isHydratingPin = true;
    runPinHydration({
      fetchPin: () => fetch(apiUrl('/api/session-pin'))
        .then(res => res.ok ? res.json() : null)
        .then(data => data && data.pinnedSessionId),
      // Unmount counts as supersession: a GET resolving after teardown must not
      // setState (adopt/self-heal) or clear a gate nobody owns anymore.
      isCurrent: () => seq === this._hydratePinSeq && !this._unmounted,
      getDerived: () => this._derivedLatestId(),
      effOnly: () => this._effectiveOnlyCurrentSession(),
      getLocalPin: () => this.state.pinnedSessionTs,
      adopt: (val) => {
        this._applyingRemotePin = true;
        this.setState({ pinnedSessionTs: val }, () => { this._applyingRemotePin = false; });
      },
      persistLocal: () => this._persistPin(),
      clearGate: () => { this._isHydratingPin = false; },
      selfHeal: () => this._maintainPinState(null),
    });
  }

  // App / Mobile 子类的 componentDidUpdate 都 `super.componentDidUpdate(...)`，故 pin 维护集中在此。
  componentDidUpdate(prevProps, prevState) {
    this._maintainPinState(prevState);
  }

  // 维护 pin：过滤开启时始终把 pin 跟随到「当前会话」（= 最新会话的稳定 id）；切项目重 hydrate；
  // pin 变化持久化。「当前会话」以日志最新条目所属会话为准，不依赖界面 /clear 交互 —— 从新终端
  // (如 Ghostty)启动的会话，重载/实时都能自动切过去（配合 _flushPendingEntries 的实时推进）。
  _maintainPinState(prevState) {
    const effOnly = this._effectiveOnlyCurrentSession();

    // _isHydratingPin：服务端 pin 的 GET 在途时，不要抢先推进（否则会在真值返回前误锁到最新）。
    if (effOnly && !this._isHydratingPin) {
      // "Current session" = newest ACTIVITY among hot sessions, NOT the last list
      // element: mainAgentSessions is insertion-ordered, and with interleaved
      // multi-terminal sessions or a truncated reconnect replay the tail is often
      // an old session — following it anchored (and persisted) the wrong pin.
      const latestId = this._derivedLatestId() || this._currentSessionId || null;
      // 始终跟随最新会话（不再只在「开关刚打开 / pin 为空」时锁一次）：这样即便持久化的 pin
      // 指向旧会话（cc-viewer 关闭期间新终端已启动，重开后 batch 重载出新会话），也会自动切到
      // 最新会话。因为没有「手动锁定任意旧会话」的 UI，「当前会话」恒等于最新会话，此推进安全。
      // 不变式：切项目那一拍这里的乐观锁不会被持久化——下面同一趟的 _hydratePin() 会同步置
      // _isHydratingPin=true，把下一拍 persist 分支挡掉（由 hydrate 的服务端真值收口），故无需在此回写。
      if (latestId && this.state.pinnedSessionTs !== latestId) {
        this.setState({ pinnedSessionTs: latestId });
      }
    }

    if (prevState && prevState.projectName !== this.state.projectName) {
      // 切项目：从服务端重新 hydrate（旧 pin 已在切换 setState 里清空）。
      this._hydratePin();
    } else if (prevState && prevState.pinnedSessionTs !== this.state.pinnedSessionTs && this.state.projectName
               && !this._applyingRemotePin && !this._isHydratingPin) {
      // pin 本地变化且 projectName 稳定 → 持久化到服务端。
      // _applyingRemotePin：来自 hydrate/SSE 的服务端值不回写（防回环）；_isHydratingPin：hydrate 在途不写。
      this._persistPin();
    }
  }

  // App / Mobile render 共用：按生效的「仅展示当前会话」+ pin 切出传给 ChatView 的会话与上界。
  _displaySessionsFor(mainAgentSessions) {
    return resolveDisplaySessions(mainAgentSessions, this.state.pinnedSessionTs, this._effectiveOnlyCurrentSession());
  }

  /**
   * 单次遍历完成 timestamp 赋值 + session 构建 + 过滤 + index 重建。
   * 合并 assignMessageTimestamps + buildSessionsFromEntries + filterRelevantRequests + _rebuildRequestIndex，
   * 减少 3 次 O(n) 全量扫描。
   */
  _processEntries(entries) {
    const st = this._initProcessState();
    for (let i = 0; i < entries.length; i++) {
      this._processOneEntry(entries[i], i, st);
    }
    this._currentSessionId = st.currentSessionId;
    return { mainAgentSessions: st.sessions, filtered: st.filtered };
  }

  /** _processEntries 的循环前置：实例状态重置（_rebuildRequestIndex 内联）+ 遍历局部状态对象。
   *  同步 _processEntries 与分帧 _processEntriesChunked 共用，保证两条路径前置完全一致。 */
  _initProcessState() {
    // _rebuildRequestIndex 内联
    this._requestIndexMap.clear();
    this._cacheLossProcessedCount = 0;
    this._cacheLossLastMainAgent = null;
    this._cacheLossMap = new Map();
    this._lastKvCacheContent = null;
    this._sseSlimmer = null; this._sseReconstructor = null;

    return {
      timestamps: [],
      generatedTimestamps: [],   // 跟 timestamps 平行：position → _generatedTs（assistant 才有）
      prevMainAgentTs: null,      // 上一次 mainAgent entry 的 ts，给本次新增 assistant msg 赋
      prevUserId: null,
      prevEpoch: null,            // task B: 上一条 mainAgent 的 _seqEpoch，epoch 变化=确定性会话边界
      sessions: [],
      filtered: [],
      currentSessionId: null,
    };
  }

  /** _processEntries 的循环体原样抽取（局部变量改读写 st.*，其余逐行一致）。
   *  同步与分帧路径共用此方法 —— mergeMainAgentSessions 的调用序列/参数/
   *  _sessionId 赋值因此与抽取前完全相同（sessionMerge 脆弱区零语义变化）。 */
  _processOneEntry(entry, i, st) {
    // Legacy v1 rotation-context sentinel: metadata frame from un-migrated
    // logs — never a renderable request (v2 sessions have no rotation).
    if (entry && entry.ccvRotationContext) return;

    // requestIndex
    this._requestIndexMap.set(`${entry.timestamp}|${entry.url}`, i);

    // filterRelevant
    if (isRelevantRequest(entry)) st.filtered.push(entry);

    // assignTimestamps + buildSessions（仅 mainAgent）
    if (isMainAgent(entry) && entry.body && Array.isArray(entry.body.messages)) {
      // Boundary detection + positional timestamp accumulation extracted to
      // applyBatchEntryTimestamps (sessionManager.js) — shares isSessionBoundary
      // with the live SSE path (_flushPendingEntries) so batch reload and live
      // streaming segment sessions identically (the "only show current session"
      // pin depends on stable ids matching across the two paths).
      // KEEP IN SYNC: test/session-boundary-parity.test.js runBatchLeg mirrors
      // this slim → applyBatchEntryTimestamps → merge call order.
      applyBatchEntryTimestamps(st, entry);

      // session 合并（跳过 _slimmed；批量路径额外跳过 stale/broken/inProgress，见谓词 JSDoc）
      if (!entry._slimmed && !isMergeBlockedEntry(entry, { batch: true })) {
        st.sessions = this.mergeMainAgentSessions(st.sessions, entry);
      }
    }

    entry._sessionId = st.currentSessionId;
  }

  /** _processEntries 的分帧版：同一循环插入让步，调用序列与同步版完全一致。 */
  async _processEntriesChunked(entries, ctl) {
    const st = this._initProcessState();
    const r = await runChunkedPass(entries.length, (i) => this._processOneEntry(entries[i], i, st), ctl);
    if (r.aborted) return { aborted: true };
    this._currentSessionId = st.currentSessionId;
    return { aborted: false, mainAgentSessions: st.sessions, filtered: st.filtered };
  }

  /** _batchSlim 的分帧版：与同步版完全同序 —— intern 全量 pass → slimmer.process 全量 pass
   *  → finalize 一次。两个 pass 各自分帧（保持"intern 先全部完成"的既有顺序假设）。 */
  async _batchSlimChunked(entries, ctl) {
    const r1 = await runChunkedPass(entries.length, (i) => { entries[i] = internEntryBigFields(entries[i]); }, ctl);
    if (r1.aborted) return { aborted: true };
    const slimmer = createEntrySlimmer(isMainAgent);
    const r2 = await runChunkedPass(entries.length, (i) => { slimmer.process(entries[i], entries, i); }, ctl);
    if (r2.aborted) return { aborted: true };
    slimmer.finalize(entries);
    return { aborted: false };
  }

  /** 分帧管线的并发控制句柄。progress 经 _loadingCountRafId rAF 节流写 fileLoadingCount。
   *  _loadingCountRafId/_ingestProgressCount 跨管线共享 —— onProgress 与 rAF 回调都按
   *  token 过滤，防被 supersede 的旧管线最后一批写入陈旧计数（进度数字乱跳）。 */
  _makeIngestCtl(myToken) {
    return {
      shouldAbort: () => this._ingestToken !== myToken || this._unmounted,
      onProgress: (count) => {
        if (this._ingestToken !== myToken) return;
        this._ingestProgressCount = count;
        if (this._loadingCountRafId) return;
        this._loadingCountRafId = requestAnimationFrame(() => {
          this._loadingCountRafId = null;
          if (this._ingestToken === myToken && !this._unmounted) {
            this.setState({ fileLoadingCount: this._ingestProgressCount });
          }
        });
      },
      yieldFn: yieldToMain,
      batchSize: INGEST_BATCH_SIZE,
    };
  }

  /** 冷启动共享分帧管线：reconstruct（整体一次）→ 分帧 slim → 分帧 process。
   *  reconstructEntries 有状态（running accumulated + _compensateBrokenEntries 全数组
   *  前向补偿），不可切片 —— 作为独立任务隔离，算法不动。
   *  Delta 重建必须在 entry-slim 之前：delta 条目的 body.messages 只有增量部分，
   *  先 slim 会永久丢失增量数据，导致重建后 messages 为空。 */
  async _runColdIngestCore(rawEntries, ctl) {
    const entries = Array.isArray(rawEntries) ? reconstructEntries(rawEntries) : rawEntries;
    if (ctl.shouldAbort()) return { aborted: true };
    if (!(Array.isArray(entries) && entries.length > 0)) {
      return { aborted: false, empty: true, entries: Array.isArray(entries) ? entries : [], mainAgentSessions: [], filtered: [] };
    }
    await ctl.yieldFn();   // reconstruct 是长任务，先让出一帧再进分帧 passes
    if (ctl.shouldAbort()) return { aborted: true };
    const s = await this._batchSlimChunked(entries, ctl);
    if (s.aborted) return { aborted: true };
    const p = await this._processEntriesChunked(entries, ctl);
    if (p.aborted) return { aborted: true };
    return { aborted: false, empty: false, entries, mainAgentSessions: p.mainAgentSessions, filtered: p.filtered };
  }

  /** 管线提交：单次原子 setState；回调里关闸 + 泄洪 live 缓冲（对已提交基线重建）。 */
  _commitColdIngest(myToken, newState, after) {
    if (this._ingestToken !== myToken || this._unmounted) return; // 已被 supersede
    this.setState(newState, () => {
      if (this._ingestToken !== myToken) return; // setState 提交期间又被 supersede
      this._ingestRunning = false;
      const buffered = this._liveGateBuffer;
      this._liveGateBuffer = [];
      if (buffered.length > 0) {
        this._pendingEntries.push(...buffered);
        if (!this._flushRafId) {
          this._flushRafId = requestAnimationFrame(this._flushPendingEntries);
        }
      }
      if (after) after();
    });
  }

  /** 废弃在途分帧管线（baseline 重置路径调用：重连/full_reload/workspace 切换）。
   *  drain=true 时把闸门缓冲送回 _pendingEntries 走正常 flush（dedup 兜底重复）。 */
  _abortColdIngest({ drain = false } = {}) {
    this._ingestToken++;
    this._ingestRunning = false;
    const buffered = this._liveGateBuffer;
    this._liveGateBuffer = [];
    if (drain && buffered.length > 0) {
      this._pendingEntries.push(...buffered);
      if (!this._flushRafId) {
        this._flushRafId = requestAnimationFrame(this._flushPendingEntries);
      }
    }
  }

  /** initSSE load_end 的分帧版主流程。 */
  async _runSseColdIngest(rawEntries, { isIncremental, unlockContextBar }) {
    const myToken = ++this._ingestToken;
    this._ingestRunning = true;
    const ctl = this._makeIngestCtl(myToken);
    const core = await this._runColdIngestCore(rawEntries, ctl);
    if (core.aborted) return;
    if (core.empty) {
      const st = { fileLoading: false, fileLoadingCount: 0, fileLoadingBytes: null };
      if (unlockContextBar) st.contextBarLocked = false;
      this._commitColdIngest(myToken, st);
      return;
    }
    const { entries, mainAgentSessions, filtered } = core;

    const newState = {
      requests: entries,
      selectedIndex: filtered.length > 0 ? filtered.length - 1 : null,
      mainAgentSessions,
      fileLoading: false,
      fileLoadingCount: 0,
      fileLoadingBytes: null,
    };
    if (unlockContextBar) newState.contextBarLocked = false;
    this._commitColdIngest(myToken, newState, () => {
      if (isMobile && this.state.projectName) {
        saveEntries(this.state.projectName, entries);
      }
    });
  }

  /** loadLocalLogFile load_end 的分帧版主流程。 */
  async _runLocalLogIngest(rawEntries) {
    const myToken = ++this._ingestToken;
    this._ingestRunning = true;
    const ctl = this._makeIngestCtl(myToken);
    const core = await this._runColdIngestCore(rawEntries, ctl);
    if (core.aborted) return;
    if (core.empty) {
      this._commitColdIngest(myToken, { fileLoading: false, fileLoadingCount: 0, fileLoadingBytes: null, serverCachedContent: null });
      return;
    }
    this._commitColdIngest(myToken, {
      requests: core.entries,
      selectedIndex: core.filtered.length > 0 ? core.filtered.length - 1 : null,
      mainAgentSessions: core.mainAgentSessions,
      fileLoading: false,
      fileLoadingCount: 0,
      fileLoadingBytes: null,
      serverCachedContent: null,
    });
  }

  componentDidMount() {
    // pin 已改服务端存储：清掉旧版浏览器本地 ccv_pinnedSession_* 残留（一次性）。
    this._cleanupLegacyPinKeys();
    // 全局键盘缩放监听(Cmd/Ctrl +/-/0)仅 Electron 注册——驱动原生 setZoomFactor 并与下拉同步。
    // 纯浏览器**不**注册,把 Cmd/Ctrl +/- 交还浏览器原生缩放(不拦截)。unmount 时按同一 ref 卸载。
    if (hasNativeZoom) window.addEventListener('keydown', this._onScaleKeydown);
    // claude-settings / preferences fetch 由 SettingsProvider 集中触发;
    // 这里仅订阅其 Promise,把字段同步到本地 state(沿用现有 13+ 个 setState 消费链路)。
    this.context._claudeSettingsReady.then(data => {
      if (!data) return;
      // showThinkingSummaries 不再镜像进 state —— render 经 _prefValues() 直接读
      // context.claudeSettings,fetch 回包触发 Provider 重渲染即生效。勿在此重加 setState。
      if (data.claudeAvailable === false) this.setState({ claudeMissing: true });
      if (typeof data.claudeProjectModel === 'string' && data.claudeProjectModel) {
        this.setState({ claudeProjectModel: data.claudeProjectModel });
      }
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
    this.context._prefsReady.then(data => this._hydratePrefsFromData(data));

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
            // model 匹配（主模型优先，回退老 activeModel）
            const pModel = p.ANTHROPIC_MODEL || p.activeModel;
            if (dc.model && pModel && dc.model !== pModel) return false;
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

    // 获取代理重试配置（mode/interval/maxRetries 等，运行时热切换）
    fetch(apiUrl('/api/retry-config'))
      .then(res => res.json())
      .then(data => {
        if (data?.config) this.setState({ retryConfig: data.config, retryDefaults: data.defaults || null });
      })
      .catch(() => { });

    // 获取当前监控的项目名称
    const params = new URLSearchParams(window.location.search);
    const logfile = params.get('logfile');
    fetch(apiUrl('/api/project-name'))
      .then(res => res.json())
      .then(data => {
        const projectName = data.projectName || '';
        this.setState({ projectName }, () => this._applyDocTitle(projectName));
        this._resubscribeAlias(projectName);
        // 移动端：从缓存恢复数据，在 SSE 数据到达前立即渲染
        if (isMobile && projectName && !logfile && this.state.requests.length === 0) {
          loadEntries(projectName).then(cached => {
            if (cached && this.state.requests.length === 0) {
              this._batchSlim(cached);
              const { mainAgentSessions, filtered } = this._processEntries(cached);
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
          this.setState({ cliMode: true, sdkMode: !!data.sdkMode, viewMode: 'chat' });
        }
      })
      .catch(() => { });

    // 检查是否是通过 ?logfile= 打开的历史日志
    if (logfile) {
      this.loadLocalLogFile(logfile);
    } else {
      this._scheduleInitSSE();
    }
  }

  componentWillUnmount() {
    this._stopWireV2ConvertPoll();
    window.removeEventListener('keydown', this._onScaleKeydown);
    if (Array.isArray(this._tabBridgeDisposers)) {
      for (const off of this._tabBridgeDisposers) {
        try { off(); } catch {}
      }
      this._tabBridgeDisposers = null;
    }
    this._unmounted = true;
    if (this.eventSource) this.eventSource.close();
    if (this._localLogES) { this._localLogES.close(); this._localLogES = null; }
    if (this._autoSelectTimer) clearTimeout(this._autoSelectTimer);
    if (this._loadingCountTimer) cancelAnimationFrame(this._loadingCountTimer);
    if (this._loadingCountRafId) cancelAnimationFrame(this._loadingCountRafId);
    if (this._cacheSaveTimer) clearTimeout(this._cacheSaveTimer);
    if (this._sseTimeoutTimer) clearTimeout(this._sseTimeoutTimer);
    if (this._sseReconnectTimer) clearTimeout(this._sseReconnectTimer);
    if (this._streamingOffTimer) clearTimeout(this._streamingOffTimer);
    if (this._streamingRaf) { cancelAnimationFrame(this._streamingRaf); this._streamingRaf = null; }
    if (this._clearOptimisticTimer) clearTimeout(this._clearOptimisticTimer);
    if (typeof this._aliasOff === 'function') { try { this._aliasOff(); } catch {} this._aliasOff = null; }
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
  _scheduleInitSSE() {
    const start = () => { if (!this._unmounted) this.initSSE(); };
    // Windows 冷启动时 V8 需要 3-5 秒编译 ~7MB JS bundle（热启动有 Code Cache 则 <0.5s）。
    // timeout 设为 5 秒确保编译完成后再建 SSE 连接，避免数据处理与编译竞争导致 tab 崩溃。
    // 浏览器空闲时会提前触发（不必等满 5 秒），所以对热启动/Mac 无感知延迟。
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(start, { timeout: 5000 });
    } else {
      requestAnimationFrame(() => requestAnimationFrame(start));
    }
  }

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
    // 分帧管线闸门兜底复位（_pendingEntries 已清空，缓冲不泄洪直接丢弃）
    this._ingestToken++;
    this._ingestRunning = false;
    this._liveGateBuffer = [];
  };

  /** Loading progress fragment: byte progress on the v3 wire (server sends
   *  the exact frame byte total in load_start), legacy count-up otherwise. */
  _loadingProgressText() {
    const b = this.state.fileLoadingBytes;
    if (b && b.total > 0) {
      const mb = (n) => (n / 1048576).toFixed(1);
      const pct = Math.min(100, Math.round((b.recv / b.total) * 100));
      return `${mb(b.recv)}/${mb(b.total)} MB (${pct}%)`;
    }
    return `(${this.state.fileLoadingCount})`;
  }

  /** Wire v3 loading progress: accumulate received frame bytes, rAF-throttled
   *  into state (mirrors the legacy count-up throttling). */
  _v3TrackBytes(event) {
    if (!this._v3BytesTotal || this._isIncremental) return;
    this._v3RecvBytes += (event?.data?.length || 0);
    if (!this._v3BytesRafId) {
      this._v3BytesRafId = requestAnimationFrame(() => {
        this._v3BytesRafId = null;
        if (this.state.fileLoading) {
          this.setState({ fileLoadingBytes: { recv: Math.min(this._v3RecvBytes, this._v3BytesTotal), total: this._v3BytesTotal } });
        }
      });
    }
  }

  /** Wire v3 (V3.S5): lazy assembler — replays native conv/responses lines
   *  into v1-shape entries for the existing ingest pipeline. */
  _v3Assembler() {
    if (!this._v3AssemblerInst) this._v3AssemblerInst = createV3Assembler();
    return this._v3AssemblerInst;
  }

  /** Wire v3 baseline reset (review P0-2): every path that resets the entry
   *  baseline (fresh cold reset frame, workspace switch, full_reload) must
   *  also drop the v3 client state, or the assembler's channel pointers, the
   *  live dedup set and the rows list leak across cycles — stale-project rows
   *  in the list, 404 detail fetches, unbounded growth on reconnecting tabs. */
  _v3ResetClientState() {
    try { this._v3AssemblerInst?.reset(); } catch (e) { reportSwallowed('v3.reset', e); }
    this._v3SeenLive?.clear();
    this._v3ColdRows = null;
    this._v3PendingLive = [];
    this._v3AdaptSource = null;
    this._v3Adapted = null;
  }

  /** Apply one live v3 frame to the assembler. Split out from the SSE
   *  handlers so frames buffered during the async cold assembly (review
   *  P1-1: a live delta advancing the shared channel ptr mid-assembly
   *  corrupts the remaining cold rows) replay through identical logic. */
  _applyV3Conv(data) {
    if (data.lines) this._v3Assembler().addConvLines(data.sessionId, data.channel, data.lines);
    else if (data.line) this._v3Assembler().addConvLines(data.sessionId, data.channel, data.line);
  }

  _applyV3Resp(data) {
    this._v3Assembler().addRespLines(data.sessionId, data.lines ?? data.line);
  }

  _applyV3Delta(row) {
    this._ingestV2Rows([row], { reset: false });
    // Correction re-sends replace the ROW (typeTag/cacheLoss); only new
    // seqs or the placeholder→completed transition rebuild an entry.
    const k = `${row.sessionId}\x00${row.seq}\x00${row.inProgress ? 1 : 0}`;
    if (this._v3SeenLive?.has(k)) return;
    (this._v3SeenLive ??= new Set()).add(k);
    this._ingestLiveEntry(this._v3Assembler().buildEntry(row));
  }

  /** Drain frames buffered while the cold assembly owned the assembler. */
  _v3DrainPendingLive() {
    const pending = this._v3PendingLive || [];
    this._v3PendingLive = [];
    for (const p of pending) {
      try {
        if (p.kind === 'conv') this._applyV3Conv(p.data);
        else if (p.kind === 'resp') this._applyV3Resp(p.data);
        else if (p.kind === 'delta') this._applyV3Delta(p.data);
      } catch (e) { reportSwallowed('v3.pending-drain', e); }
    }
  }

  /** Live entry injection shared by the legacy `data:` frames (via
   *  handleEventMessage) and the V3.S5 assembler-built entries. Gated during
   *  the ingest pipeline AND the v3 chunked cold assembly (both commit via
   *  the pipeline, which drains the gate buffer). */
  _ingestLiveEntry(entry) {
    if (this._ingestRunning || this._v3Assembling) {
      this._liveGateBuffer.push(entry);
      return;
    }
    this._pendingEntries.push(entry);
    if (!this._flushRafId) {
      this._flushRafId = requestAnimationFrame(this._flushPendingEntries);
    }
  }

  /** Wire v3 (V3.S3a): ingest metadata rows. `reset` replaces the whole list
   *  (cold v2_requests frame — reconnects re-send it, so replace is idempotent);
   *  otherwise upsert by (sessionId, seq) — live deltas send a placeholder row,
   *  its completed upgrade, and possibly a classification correction. */
  _ingestV2Rows(rows, { reset = false, totalCount, hasMore, oldestTs } = {}) {
    this.setState((prev) => {
      let next;
      if (reset) {
        next = rows;
      } else {
        next = prev.v2Rows.slice();
        const idx = new Map(next.map((r, i) => [`${r.sessionId}\x00${r.seq}`, i]));
        for (const row of rows) {
          const k = `${row.sessionId}\x00${row.seq}`;
          const at = idx.get(k);
          if (at !== undefined) next[at] = row;
          else { idx.set(k, next.length); next.push(row); }
        }
      }
      const meta = reset
        ? { totalCount: totalCount ?? rows.length, hasMore: !!hasMore, oldestTs: oldestTs || '' }
        : { ...prev.v2RowsMeta, totalCount: prev.v2RowsMeta.totalCount + (next.length - prev.v2Rows.length) };
      return { v2Rows: next, v2RowsMeta: meta };
    });
  }

  _reconnectSSE() {
    // SSE 连接真死（心跳超时 / 重试上限），清除流式 overlay 避免卡死
    if (this.state.streamingLatest) this.setState({ streamingLatest: null });
    if (this._sseReconnectCount >= 10) {
      console.error('SSE reconnect limit reached');
      return;
    }
    this._sseReconnectCount = (this._sseReconnectCount || 0) + 1;
    if (this.eventSource) { this.eventSource.close(); this.eventSource = null; }

    // 必须在部分保存之前废弃在途分帧管线（review P1）：下方部分保存会同步跑
    // _processEntries → 清空 _requestIndexMap 等实例状态，若在途管线未先废弃，
    // 其下一批会基于被污染的状态继续写。
    // 不 drain 是有意的：闸门缓冲条目已由 interceptor 落盘，重连后 server replay
    // 必然重发；且下方 _teardownTransientLiveState 会清空 _pendingEntries，
    // drain 进去也会被立即清掉 —— 泄洪在此既无意义也有合并陈旧基线的风险。
    this._abortColdIngest();

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
    this.setState({ isStreaming: false, contextBarLocked: false });
    if (this._sseReconnectTimer) clearTimeout(this._sseReconnectTimer);
    const delay = Math.min(2000 * Math.pow(2, (this._sseReconnectCount || 1) - 1), 32000);
    this._sseReconnectTimer = setTimeout(() => { this.initSSE(); }, delay);
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
          url = `/events?since=${encodeURIComponent(meta.lastTs)}&cc=${meta.count}&project=${encodeURIComponent(meta.projectName || '')}`;
          hasCache = true;
        }
      }
      // 桌面端重连：用最后接收到的时间戳做增量加载，避免全量重载放大卡顿
      if (!hasCache && !isMobile && this._sseReconnectCount > 0 && this.state.requests.length > 0) {
        const reqs = this.state.requests;
        let lastTs = null;
        for (let i = reqs.length - 1; i >= 0; i--) {
          if (reqs[i]?.timestamp) { lastTs = reqs[i].timestamp; break; }
        }
        if (lastTs && this.state.projectName) {
          url = `/events?since=${encodeURIComponent(lastTs)}&cc=${reqs.length}&project=${encodeURIComponent(this.state.projectName)}`;
          hasCache = true;
        }
      }
      // 无缓存时限制首屏加载量，剩余按需分页。
      // 移动端 200 条；桌面端 400 条（Windows 上 1000 条的同步重建 + React 渲染
      // 可达 10-15s，超出 Chrome tab kill 阈值导致崩溃）。
      if (!hasCache) {
        url = `/events?limit=${isMobile ? 200 : 400}`;
      }
      // 只有在无缓存时才显示 loading 遮罩
      if (!hasCache) {
        this.setState({ fileLoading: true, fileLoadingCount: 0 });
      }
      this.eventSource = new EventSource(apiUrl(url));
      // 每次收到任何 SSE 事件（包括心跳注释帧触发的隐式活动）都重置超时
      this.eventSource.onmessage = (event) => { this._resetSSETimeout(); this.handleEventMessage(event); };
      this.eventSource.onopen = () => {
        this._resetSSETimeout();
        // 每次连上都补一次 pin GET 同步：浏览器原生 EventSource 自愈重连复用同一 EventSource、
        // 不走 _reconnectSSE（不增 _sseReconnectCount），故不能只在 wasReconnect 时同步，否则原生重连
        // 期间他端改的 pin 会一直 stale 到下次 session_pin 或切项目。GET 幂等，_applyingRemotePin 防回写。
        this._hydratePin();
      };
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
        } catch (e) { reportSwallowed('sse.stream-progress', e); }
      });
      // update_completed 事件已废弃：自 1.6.203 起后台 detached npm install 负责升级，
      // 当前进程内存里仍是旧版本，广播"已升级完成"会误导用户。保留 update_major_available
      // 作为"有新版可用"的统一信号（包含跨大版本提示 + 本版本忙时跳过两种场景）。
      // 1.7.0 P2：存在未迁移 v1 日志 → 弹迁移引导。是否展示由客户端决定：
      // 「不再提醒」偏好挡常规提示；continued=true（-c 续接旧对话）无视 dismissed
      // 再提醒——前半段对话在旧格式里，不迁移就看不到。
      // One-shot per page load (review P1)：/events 每次【重连】（心跳超时、网络
      // 抖动）都会重推本帧，且 continued 分支绕过 dismissed —— 不设一次性守卫
      // 会反复弹窗，甚至在用户已行动后再弹。工作区切换的广播携带新项目语境，
      // 由 workspace_started 重置守卫。
      this.eventSource.addEventListener('migrate_prompt', (event) => {
        this._resetSSETimeout();
        try {
          const data = JSON.parse(event.data);
          if (this._migratePromptShown) return; // already shown/acted this page
          (this.context._prefsReady || Promise.resolve({})).then((initialPrefs) => {
            if (this._migratePromptShown) return; // raced a second frame
            const prefs = this.context?.preferences || initialPrefs;
            if (prefs?.wireV2MigratePromptDismissed && !data.continued) return;
            this._migratePromptShown = true;
            this.setState({ migratePromptVisible: true, migratePromptData: data });
          });
        } catch (e) { reportSwallowed('sse.migrate_prompt', e); }
      });
      this.eventSource.addEventListener('update_major_available', (event) => {
        this._resetSSETimeout();
        try {
          const data = JSON.parse(event.data);
          this.setState({ updateInfo: { type: 'major', version: data.version } });
        } catch (e) { reportSwallowed('sse.update_major_available', e); }
      });
      this.eventSource.addEventListener('load_start', (event) => {
        this._resetSSETimeout();
        try {
          const data = JSON.parse(event.data);
          this._chunkedEntries = [];
          this._chunkedTotal = data.total || 0;
          this._isIncremental = !!data.incremental;
          // Wire v3: the server pre-computes the exact frame byte total —
          // progress is received/total bytes instead of the legacy count-up.
          this._v3BytesTotal = data.v3Bytes || 0;
          this._v3RecvBytes = 0;
          // 增量模式下已有缓存数据在显示，不需要 loading 遮罩
          if (!this._isIncremental) {
            this.setState({ fileLoading: true, fileLoadingCount: 0, fileLoadingBytes: this._v3BytesTotal > 0 ? { recv: 0, total: this._v3BytesTotal } : null });
          }
        } catch (e) { reportSwallowed('sse.load_start', e); }
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
        } catch (e) { reportSwallowed('sse.load_chunk', e, { dataLen: event.data?.length }); }
      });
      this.eventSource.addEventListener('load_end', () => {
        this._resetSSETimeout();
        if (this._loadingCountRafId) { cancelAnimationFrame(this._loadingCountRafId); this._loadingCountRafId = null; }
        // Wire v3 (V3.S5): flagged cold loads carry no legacy chunks — build
        // the window's entries from rows + native lines instead. All v3
        // frames precede load_end on the wire, so the assembler is complete.
        // Assembly is CHUNKED with main-thread yields (a synchronous build
        // over the whole window blocks paint — the loading UI would freeze);
        // live entries arriving during the async window are gated into
        // _liveGateBuffer (drained by the pipeline commit, same as during
        // the ingest pipeline itself).
        const finish = () => {
        const delta = this._chunkedEntries;
        this._chunkedEntries = [];
        this._chunkedTotal = 0;
        const isIncremental = this._isIncremental;
        this._isIncremental = false;
        // 解锁信号：增量模式下出现至少一条**带 body.messages 的 mainAgent** 条目，说明
        // mainAgent 真有新一轮请求落盘。仅看 delta.length>0 会被 SSE 重连时 backlog
        // replay 的旧 entry（synthetic、post-stop hook 等）误触发；mainAgent + body.messages
        // 才是"用户实际发了内容"的最强信号。覆盖 TerminalPanel /clear 后用户没走 ChatView
        // 输入框（pty 直接键入 / 外部 hook / Agent 自驱）时血条卡 0% 的场景。
        // 注：解锁不再单独 setState，并入分帧管线末段的原子提交（避免与主提交分帧）。
        let unlockContextBar = false;
        if (isIncremental && this.state.contextBarLocked) {
          const hasMainAgentTurn = delta.some(e => {
            if (!e || !e.mainAgent) return false;
            const msgs = e.body?.messages;
            return Array.isArray(msgs) && msgs.length > 0;
          });
          if (hasMainAgentTurn) unlockContextBar = true;
        }

        // 增量模式：Map 去重合并（delta 条目覆盖同 key 的缓存条目）
        let rawEntries;
        if (isIncremental && isMobile && this.state.requests.length > 0) {
          if (delta.length === 0) {
            // 无新数据，缓存已是最新，跳过重建
            const st = { fileLoading: false, fileLoadingCount: 0, fileLoadingBytes: null };
            if (unlockContextBar) st.contextBarLocked = false;
            this.setState(st);
            return;
          }
          const eKey = (e, i) => (e.timestamp && e.url) ? `${e.timestamp}|${e.url}` : `__nokey_c${i}`;
          const map = new Map();
          this.state.requests.forEach((e, i) => map.set(eKey(e, i), e));
          delta.forEach((e, i) => map.set((e.timestamp && e.url) ? `${e.timestamp}|${e.url}` : `__nokey_d${i}`, e));
          // 注意：合并结果含 state.requests 的 live 引用 —— 分帧 slim/process 期间这些对象被
          // 原地变异（intern/_slimmed），让步间隙的 render 会看到中间态。旧同步代码同样原地
          // 变异（只是单任务内完成）；最终原子提交会以干净引用整体覆盖。
          rawEntries = Array.from(map.values());
        } else {
          rawEntries = delta;
        }

        // 分帧管线：reconstruct → 分帧 slim → 分帧 process → 原子提交。
        // async 不 await（EventSource 回调）；在途期间 live 条目入闸门缓冲（handleEventMessage）。
        this._runSseColdIngest(rawEntries, { isIncremental, unlockContextBar });
        };

        if (this._wireV3 && this._v3ColdRows && this._chunkedEntries.length === 0) {
          const rows = this._v3ColdRows;
          this._v3ColdRows = null;
          this._v3Assembling = true;
          (async () => {
            const entries = [];
            const asm = this._v3Assembler();
            try {
              for (let i = 0; i < rows.length; i++) {
                try { entries.push(asm.buildEntry(rows[i])); } catch (e) { reportSwallowed('v3.cold-assemble', e); }
                if ((i + 1) % 100 === 0) await yieldToMain();
              }
            } finally {
              this._v3Assembling = false;
            }
            this._chunkedEntries = entries;
            // finish() enters the ingest pipeline synchronously (sets
            // _ingestRunning before any await), so draining the buffered live
            // frames AFTER it routes their entries into the pipeline's gate
            // buffer — no window where a live entry merges against the
            // pre-commit baseline (review P1-1).
            finish();
            this._v3DrainPendingLive();
          })();
          return;
        }
        this._v3ColdRows = null;
        finish();
      });
      this.eventSource.addEventListener('full_reload', (event) => {
        this._resetSSETimeout();
        // 服务端要求整体重载 = baseline 重置：废弃在途分帧管线（防其稍后提交陈旧基线），
        // 闸门缓冲泄回 _pendingEntries（dedup 兜底与重载数据的重复）。
        this._abortColdIngest({ drain: true });
        // Baseline reset also drops the v3 client state (review P0-2): stale
        // rows would keep feeding _listSource after the reload's new baseline.
        this._v3ResetClientState();
        this.setState({ v2Rows: [], v2RowsMeta: { totalCount: 0, hasMore: false, oldestTs: '' } });
        // animateLoadingCount 回调有数百 ms 窗口：期间若新分帧管线启动（token 再 bump），
        // 本次 full_reload 的延迟 setState 不得覆盖新管线提交 —— 回调内按 token 失配丢弃。
        const reloadToken = this._ingestToken;
        try {
          const entries = JSON.parse(event.data);
          if (Array.isArray(entries)) {
            if (entries.length > 0) this._batchSlim(entries);
            const { mainAgentSessions, filtered } = entries.length > 0 ? this._processEntries(entries) : { mainAgentSessions: [], filtered: [] };
            if (entries.length > 0) {
              this.animateLoadingCount(entries.length, () => {
                if (this._ingestToken !== reloadToken) return; // 已被新管线 supersede
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
        } catch (e) {
          // A silently failed full reload discards the server's baseline — report, then recover.
          reportSwallowed('sse.full_reload', e);
          this.setState({ fileLoading: false, fileLoadingCount: 0 });
        }
      });
      // 工作区模式事件
      this.eventSource.addEventListener('workspace_started', (event) => {
        this._resetSSETimeout();
        try {
          const data = JSON.parse(event.data);
          // 新项目语境：允许迁移引导针对切入的项目再弹一次（P2 one-shot 守卫复位）。
          this._migratePromptShown = false;
          // 取消旧动画，防止旧 full_reload 回调覆盖新数据
          if (this._loadingCountTimer) {
            cancelAnimationFrame(this._loadingCountTimer);
            this._loadingCountTimer = null;
          }
          // workspace 切换 = baseline 重置：废弃在途分帧管线，防旧项目的巨型基线
          // 在切换后才提交、覆盖新项目数据（闸门缓冲属旧项目，直接丢弃不泄洪）
          this._abortColdIngest();
          this._v3ResetClientState(); // review P0-2: old project's rows/assembler must not survive the switch
          this._rebuildRequestIndex([]);
          // 切项目要连 _currentSessionId 一并清掉：否则 _maintainPinState 的 lazy-lock 兜底
          // (getSessionStableId(null) || this._currentSessionId) 会拿旧项目的会话 id 误锁新项目，
          // 在 hydrate GET 抢先返回前可能把旧 id POST 进新项目的 pin 文件。
          this._currentSessionId = null;
          // SSE workspace switch — rebind alias subscription to the new
          // project before writing the title so the title reflects the new
          // alias if one exists. _applyDocTitle handles the "no alias"
          // fallback (used to be `${projectName} - CC Viewer` here; that
          // suffix is dropped — pure projectName for consistency with the
          // initial mount path).
          this._resubscribeAlias(data.projectName || '');
          this._applyDocTitle(data.projectName || '');
          // Reset isStreaming alongside streamingLatest — workspace switches happen
          // between user prompts and shouldn't leave streaming flags stuck. (turnEnd
          // false-fire on this transition is no longer a concern since we hook
          // turnEnd to the Stop SSE event, not to isStreaming falling-edge.)
          this.setState({
            workspaceMode: false,
            projectName: data.projectName || '',
            viewMode: 'chat',
            cliMode: true,
            requests: [],
            v2Rows: [],
            v2RowsMeta: { totalCount: 0, hasMore: false, oldestTs: '' },
            mainAgentSessions: [],
            // 切项目：清空旧项目 pin，由 App.componentDidUpdate 按新 projectName 重新 hydrate
            pinnedSessionTs: null,
            selectedIndex: null,
            streamingLatest: null,
            isStreaming: false,
            // workspace 切换 = cwd 切换 → claude 的 lastModelUsage 也要重查；
            // 后端在 workspace_started 一并塞了新 cwd 对应的 hint，没有就清空。
            claudeProjectModel: (typeof data.claudeProjectModel === 'string' && data.claudeProjectModel) ? data.claudeProjectModel : null,
          });
          if (isMobile) clearEntries();
        } catch (e) { reportSwallowed('sse.workspace_started', e); }
      });
      this.eventSource.addEventListener('workspace_stopped', () => {
        this._resetSSETimeout();
        this._teardownTransientLiveState();
        this._v3ResetClientState(); // review P0-2
        this._rebuildRequestIndex([]);
        this._currentSessionId = null; // 同 workspace_started：清旧会话 id，避免 lazy-lock 误锁
        this.setState({
          workspaceMode: true,
          v2Rows: [],
          v2RowsMeta: { totalCount: 0, hasMore: false, oldestTs: '' },
          requests: [],
          mainAgentSessions: [],
          projectName: '',
          pinnedSessionTs: null,
          selectedIndex: null,
          streamingLatest: null,
          contextBarLocked: false,
          isStreaming: false,
        });
      });
      this.eventSource.addEventListener('context_window', (event) => {
        this._resetSSETimeout();
        try {
          const data = JSON.parse(event.data);
          // 收到新的 context_window 测量 → 同步解锁血条。
          // 兜底场景：onUserMessageSent / load_end fallback 都没触发解锁时
          //（WS 抖动、非增量 load、纯外部输入），SSE 推送的真实测量值就是
          //「会话已推进」的最强信号，避免 lock 永久卡 0%。
          this.setState({ contextWindow: data, contextBarOptimistic: false, contextBarLocked: false });
          if (this._clearOptimisticTimer) { clearTimeout(this._clearOptimisticTimer); this._clearOptimisticTimer = null; }
        } catch (e) { reportSwallowed('sse.context_window', e); }
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
      this.eventSource.addEventListener('workflow_update', (event) => {
        this._resetSSETimeout();
        try {
          publishWorkflowUpdate(JSON.parse(event.data));
        } catch (e) { reportSwallowed('sse.workflow_update', e); }
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
        } catch (e) { reportSwallowed('sse.proxy_profile', e); }
      });
      this.eventSource.addEventListener('retry_config', (event) => {
        this._resetSSETimeout();
        try {
          const data = JSON.parse(event.data);
          if (data?.config) this.setState({ retryConfig: data.config });
        } catch (e) { reportSwallowed('sse.retry_config', e); }
      });
      this.eventSource.addEventListener('ping', () => { this._resetSSETimeout(); });
      // server_config: server 启动时一次性推 turnEnd debounce ms（CCV_TURN_END_DEBOUNCE_MS
      // 可能改过默认值），前端拿这个值同步 voicePackPlayer 的 turnEnd cooldown，避免硬常数漂移。
      this.eventSource.addEventListener('server_config', (event) => {
        this._resetSSETimeout();
        try {
          const cfg = JSON.parse(event?.data || '{}');
          if (typeof cfg.turnEndDebounceMs === 'number') setTurnEndCooldownMs(cfg.turnEndDebounceMs);
          // Wire v3 flag: synchronous instance field (NOT React state) — the
          // load_chunk/v2_requests handlers in this same load cycle must read
          // the fresh value; setState would lag a task behind. A forceUpdate
          // is unnecessary: rows arriving (setState) re-render, and flag-off
          // keeps v2Rows empty so _listSource stays on the legacy source.
          this._wireV3 = cfg.wireV3 === true;
          // Version-skew guard (review P2-a): a reconnect that reaches an
          // UPGRADED server would feed this stale bundle a wire it may not
          // understand — reload to pull the matching dist (index.html is
          // no-store, assets content-hashed, so this always heals).
          if (cfg.build) {
            if (this._serverBuild && this._serverBuild !== cfg.build) {
              window.location.reload();
              return;
            }
            this._serverBuild = cfg.build;
          }
        } catch { /* tolerate parse error */ }
      });
      // Wire v3 (V3.S2/S3a): request-list metadata rows. Cold frame replaces
      // the row source wholesale; live deltas upsert by (sessionId, seq).
      // V3.S5: the same rows drive the entry assembler — the cold frame's
      // entries land in _chunkedEntries (the legacy chunk buffer, processed at
      // load_end by the existing pipeline); live rows inject one entry each.
      this.eventSource.addEventListener('v2_requests', (event) => {
        this._resetSSETimeout();
        this._v3TrackBytes(event);
        try {
          const data = JSON.parse(event?.data || '{}');
          const rows = Array.isArray(data.rows) ? data.rows : [];
          // Full reset frame (fresh cold load / reconnect replay): drop every
          // piece of v3 client state FIRST — a reconnect re-sends the window
          // and the assembler/seen-set/rows must not accumulate across cycles
          // (review P0-2: stale rows after workspace switch; unbounded growth;
          // stale channel ptr mis-assembly). Incremental frames (since-scoped
          // delta window, review P1-2) upsert instead.
          if (data.incremental) {
            this._ingestV2Rows(rows, { reset: false });
          } else {
            this._v3ResetClientState();
            this._ingestV2Rows(rows, { reset: true, totalCount: data.totalCount, hasMore: data.hasMore, oldestTs: data.oldestTs });
          }
          this._v3ColdRows = rows; // consumed at load_end (after v3_conv/v3_resp frames land)
        } catch (e) { reportSwallowed('sse.v2_requests', e); }
      });
      this.eventSource.addEventListener('v2_requests_delta', (event) => {
        this._resetSSETimeout();
        try {
          const row = JSON.parse(event?.data || '{}');
          if (!row || !Number.isInteger(row.seq)) return;
          if (this._v3Assembling) { this._v3PendingLive.push({ kind: 'delta', data: row }); return; }
          this._applyV3Delta(row);
        } catch (e) { reportSwallowed('sse.v2_requests_delta', e); }
      });
      this.eventSource.addEventListener('v3_conv', (event) => {
        this._resetSSETimeout();
        this._v3TrackBytes(event);
        try {
          const data = JSON.parse(event?.data || '{}');
          if (this._v3Assembling) { this._v3PendingLive.push({ kind: 'conv', data }); return; }
          this._applyV3Conv(data);
        } catch (e) { reportSwallowed('sse.v3_conv', e); }
      });
      this.eventSource.addEventListener('v3_resp', (event) => {
        this._resetSSETimeout();
        this._v3TrackBytes(event);
        try {
          const data = JSON.parse(event?.data || '{}');
          if (this._v3Assembling) { this._v3PendingLive.push({ kind: 'resp', data }); return; }
          this._applyV3Resp(data);
        } catch (e) { reportSwallowed('sse.v3_resp', e); }
      });
      // session_pin SSE — 本进程任一端改了「当前会话」pin 后广播，让同实例多端（电脑+手机）实时一致。
      // 采纳服务端值时置 _applyingRemotePin，避免 _maintainPinState 把它当本地改动回 POST（防回环）。
      // A broadcast value that mismatches the locally derived latest is rejected via
      // resolveHydratedPin (another client may have derived a stale "latest"). No
      // POST-back on reject — re-persisting inside the broadcast handler could
      // ping-pong between clients; healing flows through _maintainPinState's
      // normal persist path instead.
      this.eventSource.addEventListener('session_pin', (event) => {
        this._resetSSETimeout();
        try {
          const data = JSON.parse(event?.data || '{}');
          const r = resolveHydratedPin(data.pinnedSessionId, this._derivedLatestId(), this._effectiveOnlyCurrentSession());
          if (r.adopt && r.value !== this.state.pinnedSessionTs) {
            this._applyingRemotePin = true;
            this.setState({ pinnedSessionTs: r.value }, () => { this._applyingRemotePin = false; });
          }
        } catch { /* tolerate parse error */ }
      });
      // turn_end SSE — broadcast by /api/turn-end-notify whenever Claude Code's Stop hook
      // fires (real end of a user-prompt turn). This is the **authoritative** turnEnd
      // signal — far more accurate than isStreaming falling-edge, which resets per-API-call
      // and would mis-fire during slow tool execution. 30s cooldown lives in voicePackPlayer.
      this.eventSource.addEventListener('turn_end', (event) => {
        // Guard against a teardown race: SSE chunks in flight when _reconnectSSE
        // closes the current EventSource can still fire here before the listener
        // unbinds (round-3 quality P1).
        if (!this.eventSource) return;
        this._resetSSETimeout();
        const vp = this.state.approvalPrefs && this.state.approvalPrefs.voicePack;
        if (vp && vp.enabled && vp.events && vp.events.turnEnd) {
          let serverTs = null;
          try { serverTs = (JSON.parse(event?.data || '{}'))?.ts || null; } catch { /* fine */ }
          try {
            playVoiceEvent('turnEnd', vp, {
              // Prefer the server-supplied ts so a re-broadcast (server bug, two
              // SSE delivery paths) is deduped by the player. Falls back to a
              // unique key if absent — relies on COOLDOWN_MS.turnEnd to suppress.
              dedupeKey: `turnEnd:${serverTs || Date.now()}`,
            });
          } catch { /* never propagate */ }
        }
      });
      // im_log_update SSE — 主服务 fs.watch 到某 IM worker 日志目录写入时广播（IM worker 独立端口，
      // turn_end 落在 worker 自己进程，主服务收不到，故用日志落盘信号驱动「对话记录」自动刷新）。
      // AppBase 不直接持有 ImConversationModal，转成 window 事件解耦派发，弹窗打开时自行监听并重拉。
      this.eventSource.addEventListener('im_log_update', (event) => {
        if (!this.eventSource) return;
        this._resetSSETimeout();
        let platform = null;
        if (typeof event?.data === 'string') {
          try { platform = JSON.parse(event.data)?.platform || null; } catch { /* tolerate */ }
        }
        if (platform) {
          try { window.dispatchEvent(new CustomEvent('ccv:im-log-update', { detail: { platform } })); } catch { /* noop */ }
        }
      });
      this.eventSource.addEventListener('streaming_status', (e) => {
        this._resetSSETimeout();
        try {
          const data = JSON.parse(e.data);
          if (data.active) {
            // 立即显示 loading
            clearTimeout(this._streamingOffTimer);
            // agent 开始响应 = 新一轮已落实 → 顺手解锁血条。
            // 覆盖 onUserMessageSent 没触发的极端情况（WS 抖动 / 外部输入 /
            // pty 直接键入），避免 lock 永久卡 0%。
            const patch = { isStreaming: true };
            if (this.state.contextBarLocked) patch.contextBarLocked = false;
            this.setState(patch);
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
    // logfile 只读模式一次性全量加载（含移动端）：走服务端全量流式分支，
    // 由分帧管线 _runLocalLogIngest 消化大文件，避免「加载更早」手工分页。
    const es = new EventSource(apiUrl(`/api/local-log?file=${encodeURIComponent(file)}`));
    this._localLogES = es;

    es.addEventListener('load_start', () => {
      try {
        this.setState({ fileLoadingCount: 0 });
      } catch (e) { reportSwallowed('sse.local-log.load_start', e); }
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
      } catch (e) { reportSwallowed('sse.local-log.load_chunk', e, { dataLen: event.data?.length }); }
    });

    es.addEventListener('load_end', () => {
      es.close();
      // 分帧管线（reconstruct → 分帧 slim → 分帧 process → 原子提交）：
      // 历史日志同样可能含巨型 checkpoint，同步管线会卡死主线程。
      this._runLocalLogIngest(entries);
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
      // 冷启动分帧管线在途：live 条目入闸门缓冲，提交后统一泄洪（_commitColdIngest）。
      // 否则 live flush 会基于旧 prev.requests 合并、随后被管线的基线提交整体覆盖，
      // 且 _sseSlimmer/_sseReconstructor 会对错误基线初始化（sessionMerge 脆弱区）。
      this._ingestLiveEntry(entry);
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
      // 本窗口实时新会话（/clear、/resume）时推进 pin —— 仅实时追加路径会跟随，
      // 整体重载（_processEntries）不动 pin，于是多开时 [对话] 不被重载/他实例拖走。
      let _newPinTs = null;

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
        // Legacy v1 rotation sentinel: never a renderable request.
        if (rawEntry && rawEntry.ccvRotationContext) continue;
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

        // 合并 mainAgent sessions（跳过被剪枝的 entry，其 messages 已被清空；
        // 跳过重建层标记的乱序/断裂条目，防完成序倒置翻倍，见 isMergeBlockedEntry JSDoc）
        // KEEP IN SYNC: test/delta-reorder.test.js clientMergeSse 镜像本块守卫顺序
        // （mainAgent 形态 → teammate/blocked → applyInPlaceLastMsgReplace → merge），改动需同步
        if (isMainAgent(entry) && entry.body && Array.isArray(entry.body.messages) && !entry._slimmed && !isMergeBlockedEntry(entry)) {
          const timestamp = entry.timestamp || new Date().toISOString();
          const lastSession = mainAgentSessions.length > 0 ? mainAgentSessions[mainAgentSessions.length - 1] : null;
          const prevMessages = lastSession?.messages || [];
          const messages = entry.body.messages;
          const prevCount = prevMessages.length;

          const userId = entry.body.metadata?.user_id || null;
          // Session-boundary detection shares isSessionBoundary (clearCheckpoint.js)
          // with the batch path (applyBatchEntryTimestamps) so live streaming and
          // reload segment sessions identically: post-/clear checkpoint always
          // splits; a big count drop splits unless it's a /compact continuation
          // (same-machine multi-terminal user_id is identical, so the summary
          // msg[0] is the only reliable /compact-vs-new-terminal discriminator);
          // a user_id change splits (previously batch-only — without it, merge
          // appended a new session while timestamps were inherited positionally,
          // yielding two sessions with the SAME stable id and a mis-resolved pin).
          // KEEP IN SYNC: test/session-boundary-parity.test.js runLiveLeg mirrors
          // this boundary → assignMessageTimestamps → in-place/merge call order.
          const isNewSession = isSessionBoundary(entry, {
            prevCount,
            count: messages.length,
            prevUserId: lastSession ? lastSession.userId : null,
            userId,
            // task B: v2 session epoch change is a definitive boundary — split
            // even a short prior session (cold-load fallback → live supersede).
            prevEpoch: lastSession ? lastSession._seqEpoch : null,
            epoch: entry._seqEpoch || null,
          });

          // SSE 实时流每条 entry 都是完整 request+response，不存在"中间态"；
          // 历史代码曾在此处 `if (isTransient) continue` 跳过极短 entry 防中间态污染，
          // 但这会把真实的 /clear → 短对话（如 "hi"）也丢掉 —— 交给 mergeMainAgentSessions
          // 的 skipTransientFilter: true 统一放行，isNewSession 单独驱动 _currentSessionId。
          if (isNewSession) {
            this._currentSessionId = timestamp;
            // 新 session 起点：reset _prevMainAgentTs 防跨 session 串场（旧 session 的末尾 ts
            // 不应作为新 session 第一条 assistant msg 的"生成时 ts"）
            this._prevMainAgentTs = null;
            // 开启「仅展示当前会话」时，跟随本窗口新会话：把 pin 推进到新会话起点 ts
            //（= 新会话 messages[0]._timestamp，与 getSessionStableId 一致）。
            if (this._effectiveOnlyCurrentSession()) _newPinTs = timestamp;
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
              const filtered = visibleRequests(s.requests, s.showAll);
              return filtered.length > 0 ? { selectedIndex: filtered.length - 1 } : null;
            }
            return null;
          });
        }, 200);
      }

      return {
        requests, cacheExpireAt, cacheType, mainAgentSessions,
        ...(shouldClearStreaming && { streamingLatest: null }),
        ...(_newPinTs != null && { pinnedSessionTs: _newPinTs }),
      };
    }, () => {
      // 移动端：防抖 5s 批量写入缓存
      if (isMobile && this.state.projectName) {
        if (this._cacheSaveTimer) clearTimeout(this._cacheSaveTimer);
        this._cacheSaveTimer = setTimeout(() => {
          if (this.state.projectName) {
            saveEntries(this.state.projectName, this.state.requests);
          }
        }, 5000);
      }
    });
  };

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
  // 同时进入 locked 状态：忽略 SSE / 其他 re-render，强制血条 0K (0%)，直到用户
  // 通过 _sendUserMessageImmediate 发出一条非 /clear 消息（见 handleUserMessageSent）。
  handleClearContextOptimistic = () => {
    this.setState({ contextBarOptimistic: true, contextBarLocked: true });
    if (this._clearOptimisticTimer) clearTimeout(this._clearOptimisticTimer);
    this._clearOptimisticTimer = setTimeout(() => {
      this.setState({ contextBarOptimistic: false });
      this._clearOptimisticTimer = null;
    }, 30000);
  };

  // ChatView 在 _sendUserMessageImmediate 里对非 /clear 文本调用本方法解锁血条。
  handleUserMessageSent = () => {
    if (this.state.contextBarLocked) this.setState({ contextBarLocked: false });
  };

  // ─── 模式切换 ──────────────────────────────────────────

  handleWorkspaceLaunch = ({ projectName }) => {
    this._isLocalLog = false;
    this._localLogFile = null;
    // 切 project：清掉旧 project 残留的 /clear optimistic 30s timer，避免延迟到新 project 触发。
    if (this._clearOptimisticTimer) {
      clearTimeout(this._clearOptimisticTimer);
      this._clearOptimisticTimer = null;
    }
    this.setState({
      workspaceMode: false,
      projectName,
      viewMode: 'chat',
      cliMode: true,
      terminalVisible: false,
      contextBarLocked: false,
      contextBarOptimistic: false,
    });
  };

  handleReturnToWorkspaces = () => {
    fetch(apiUrl('/api/workspaces/stop'), { method: 'POST' })
      .then(() => {
        this._teardownTransientLiveState();
        this._rebuildRequestIndex([]);
        this._currentSessionId = null; // 同 workspace_started：清旧会话 id，避免 lazy-lock 误锁
        this.setState({
          workspaceMode: true,
          requests: [],
          mainAgentSessions: [],
          projectName: '',
          pinnedSessionTs: null,
          selectedIndex: null,
          streamingLatest: null,
          contextBarLocked: false,
          isStreaming: false,
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

  // Proxy retry config save: POST /api/retry-config (server writes retry-config.json
  // + watchFile hot-reload + pushes back via SSE). Optimistically update the local
  // retryConfig (the SSE retry_config event re-confirms it); roll back on failure.
  // Returns the POST Promise: resolves on success (SSE retry_config refreshes state);
  // on failure rolls back state + shows message.error, then rejects so the caller
  // (ProxyStatsModal / RetryConfigForm) can decide whether to keep the form open.
  handleRetryConfigChange = (config) => {
    const prev = this.state.retryConfig;
    this.setState({ retryConfig: config });
    return fetch(apiUrl('/api/retry-config'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config }),
    })
      .then((r) => {
        // Check HTTP status BEFORE .json(): a 4xx/5xx with a JSON body (the
        // server returns 400/403 + JSON on rejection) would otherwise let
        // r.json() resolve, skip the .catch, and leave the optimistic update
        // un-rolled-back while the form reports a false "saved".
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(() => { /* SSE retry_config refreshes state; nothing to do here */ })
      .catch((err) => {
        this.setState({ retryConfig: prev }); // roll back the optimistic update
        message.error(t('ui.retryConfig.saveFail'));
        throw err; // let the caller sense the failure (no false success, keep Modal open)
      });
  };

  // ─── 偏好设置 ──────────────────────────────────────────

  handleLangChange = () => {
    const lang = getLang();
    this.setState({ lang });
    this.context.updatePreferences({ lang });
  };

  handleCollapseToolResultsChange = (checked) => {
    // 单一真相源 = context;updatePreferences 内乐观 setState 即驱动重渲染。
    this.context.updatePreferences({ collapseToolResults: checked });
  };

  handleExpandThinkingChange = (checked) => {
    this.context.updatePreferences({ expandThinking: checked });
  };

  handleAutoApproveChange = (seconds) => {
    this.setState({ autoApproveSeconds: seconds });
    this.context.updatePreferences({ autoApproveSeconds: seconds });
  };

  // 终端工具栏快捷设置菜单的 Plan 档位回调。稳定引用（类属性而非调用处内联箭头），
  // 避免 App/Mobile 每次 render 生成新闭包穿透 ChatView.shouldComponentUpdate。
  handlePlanAutoApproveChange = (seconds) => {
    this.handleApprovalPrefsChange({ planAutoApproveSeconds: seconds });
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
    // voicePack 不发给 main —— renderer 自己播放，main 只关心 OS notification。
    try {
      const { voicePack: _omit, ...forIpc } = next;
      window.tabBridge?.setApprovalPref?.(forIpc);
    } catch (e) { console.warn('[approvalPref IPC] onChange sync failed:', e); }
    this.context.updatePreferences({ approvalModal: next });
  };

  // Deep-merge change handler for the voicePack subtree — patches `events` field-by-field
  // so e.g. updating only `events.askQuestion` doesn't drop the bindings for other events.
  // Uses the shared mergeVoicePackInto helper (single source of truth across hydrate /
  // server POST / this handler — review dedup).
  handleVoicePackChange = (patch) => {
    if (!patch || typeof patch !== 'object') return;
    const nextVP = mergeVoicePackInto(this.state.approvalPrefs?.voicePack, patch);
    const nextPrefs = { ...this.state.approvalPrefs, voicePack: nextVP };
    this.setState({ approvalPrefs: nextPrefs });
    // SettingsContext.updatePreferences 是顶层浅 merge — 必须带完整 approvalModal，否则会把
    // modalEnabled / soundEnabled / notifyOnlyWhenHidden 抹成 undefined（直到下次 GET 才回来）。
    this.context.updatePreferences({ approvalModal: nextPrefs });
  };

  // 合并开关「审批提示音」的统一入口：原子地双写 soundEnabled + voicePack.enabled。
  // updatePreferences patch 带完整 next（含 voicePack.events / volume），因为 SettingsContext 是
  // 顶层浅 merge — 若只传 voicePack:{enabled} 会擦掉 events，AskTimeoutCountdown 与 ChatView SDK
  // 直接读 ctx.approvalModal.voicePack.events 立即变 undefined 致静音。
  // unlockAudio 在用户手势内立即调用，绕过移动浏览器的 autoplay policy（onChange 是 trusted gesture）。
  handleApprovalSoundToggle = (checked) => {
    if (checked) {
      try { unlockAudio(); } catch (e) { /* 内部已 try/catch，理论上 unreachable */ }
    }
    const prev = this.state.approvalPrefs;
    const nextVP = { ...prev.voicePack, enabled: checked };
    const next = { ...prev, soundEnabled: checked, voicePack: nextVP };
    this.setState({ approvalPrefs: next });
    try {
      const { voicePack: _omit, ...forIpc } = next;
      window.tabBridge?.setApprovalPref?.(forIpc);
    } catch (e) { console.warn('[approvalPref IPC] sound toggle sync failed:', e); }
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

  /**
   * 整体显示缩放收口：state / 原生缩放(webFrame.setZoomFactor)/ localStorage 三处同步。
   * 仅 Electron 桌面生效——用真·原生缩放(等同浏览器 Cmd/Ctrl +/-),避开 CSS zoom 的坐标空间分裂。
   * 纯浏览器无 JS API 设原生缩放,该档位不渲染下拉而提示用户用浏览器快捷键,故 hasNativeZoom=false 时早返回。
   * @param {number} pct 目标百分比
   * @param {{persistPref?: boolean}} opts persistPref=true 时写回 preferences.json
   */
  _applyDisplayScale = (pct, opts = {}) => {
    // 「显示大小」仅 Electron 桌面有效——经 webFrame.setZoomFactor 做真·原生缩放(不再用 CSS zoom,
    // 后者会引发 Chromium 128 标准化 zoom 的坐标空间分裂)。纯浏览器无法用 JS 设原生缩放,该档位
    // 不渲染下拉、改提示用户用浏览器快捷键,故这里直接早返回。
    if (!hasNativeZoom) return;
    const { persistPref = false } = opts;
    const scale = snapToPreset(pct);
    if (this.state.displayScale !== scale) this.setState({ displayScale: scale });
    try { window.tabBridge.setZoomFactor(scale / 100); } catch {}
    try { localStorage.setItem('ccv_displayScale', String(scale)); } catch {}
    if (persistPref) this.context.updatePreferences({ displayScale: scale });
  };

  handleDisplayScaleChange = (pct) => {
    this._applyDisplayScale(pct, { persistPref: true });
  };

  // 全局键盘缩放:Cmd/Ctrl + "+"/"-" 步进,Cmd/Ctrl + 0 复位 100%。
  // 行为对齐 Chrome —— 即便焦点在输入框内也生效。stored ref 以便 unmount 卸载。
  _onScaleKeydown = (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    if (isMobile && !isPad) return;
    const key = e.key;
    const code = e.code;
    let next = null;
    if (key === '=' || key === '+' || code === 'NumpadAdd') {
      next = stepPreset(this.state.displayScale, +1);
    } else if (key === '-' || key === '_' || code === 'NumpadSubtract') {
      next = stepPreset(this.state.displayScale, -1);
    } else if (key === '0' || code === 'Numpad0') {
      next = 100;
    }
    if (next === null) return;
    e.preventDefault();
    this.handleDisplayScaleChange(next);
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
    this.context.updatePreferences({ showFullToolContent: checked });
  };

  handleFilterIrrelevantChange = (checked) => {
    this.setState(prev => {
      const newShowAll = !checked;
      const newFiltered = visibleRequests(prev.requests, newShowAll);
      return {
        showAll: newShowAll,
        selectedIndex: newFiltered.length > 0 ? newFiltered.length - 1 : null,
      };
    });
    this.context.updatePreferences({ filterIrrelevant: checked });
  };

  // ─── 日志管理 ──────────────────────────────────────────

  // 集中构造 /api/local-logs URL：打开弹窗 / 刷新统计 / 删除后这几处 refetch 都经此
  // helper（apiUrl 的 token 追加已正确处理已有 ?）。1.7.0 起列表恒为 v2 会话。
  _localLogsUrl() {
    return apiUrl('/api/local-logs');
  }

  handleImportLocalLogs = () => {
    this.setState({ importModalVisible: true, localLogsLoading: true });
    fetch(this._localLogsUrl())
      .then(res => res.json())
      .then(data => {
        const { _currentProject, _unmigratedV1Count, _unmigratedV1Bytes, _v1FileCount, ...logs } = data;
        this.setState({
          localLogs: logs,
          currentProject: _currentProject || '',
          localLogsLoading: false,
          unmigratedV1Count: _unmigratedV1Count || 0,
          unmigratedV1Bytes: _unmigratedV1Bytes || 0,
          v1FileCount: _v1FileCount || 0,
        });
      })
      .catch(() => {
        this.setState({ localLogs: {}, localLogsLoading: false });
      });
    if (this.state.logView === 'v1') this._fetchV1Logs();
    this._startWireV2ConvertPoll();
  };

  // v1 view data — fetched lazily on entering the view (and on refreshes while
  // in it), never as part of the default modal open.
  _fetchV1Logs = () => {
    fetch(apiUrl('/api/local-logs?view=v1'))
      .then(res => res.json())
      .then(data => {
        const { _currentProject, ...logs } = data;
        this.setState({ localLogsV1: logs });
      })
      .catch(() => this.setState({ localLogsV1: {} }));
  };

  // Switch between the v2 (default) and v1 (legacy files) views of the logs
  // modal. Selection is view-scoped — clear it so a hidden row can't be deleted.
  handleSetLogView = (view) => {
    this.setState({ logView: view, selectedLogs: new Set() });
    if (view === 'v1') this._fetchV1Logs();
  };

  // wire-v2 S8: poll the resident migration task while the modal is open. The
  // task itself is server-side and survives the modal (and the browser); the
  // poll is pure presentation. A done-transition refreshes the list once.
  _fetchWireV2Convert = () => {
    fetch(apiUrl('/api/wire-v2-convert'))
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!data) return;
        const prev = this.state.wireV2Convert;
        const wasActive = !!(prev && (prev.running || (prev.state && (prev.state.status === 'running' || prev.state.status === 'verifying'))));
        const isActive = !!(data.running || (data.state && (data.state.status === 'running' || data.state.status === 'verifying')));
        this.setState({ wireV2Convert: data });
        if (wasActive && !isActive && data.state && data.state.status === 'done' && this.state.importModalVisible) {
          this.handleImportLocalLogs(); // migration finished while watching — show the result
        }
      })
      .catch(() => { });
  };

  _startWireV2ConvertPoll = () => {
    this._fetchWireV2Convert();
    if (this._wireV2ConvertTimer) return;
    this._wireV2ConvertTimer = setInterval(this._fetchWireV2Convert, 2000);
  };

  _stopWireV2ConvertPoll = () => {
    if (this._wireV2ConvertTimer) {
      clearInterval(this._wireV2ConvertTimer);
      this._wireV2ConvertTimer = null;
    }
  };

  handleStartWireV2Convert = () => {
    fetch(apiUrl('/api/wire-v2-convert'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start' }),
    })
      .then(res => res.json())
      .then(data => {
        if (data && data.error) throw new Error(data.error);
        message.success(t('ui.wireV2ConvertStarted'));
        this._fetchWireV2Convert();
      })
      .catch((err) => {
        reportSwallowed('fetch.wire-v2-convert', err);
        message.error(String(err?.message || err));
      });
  };

  handleStopWireV2Convert = () => {
    fetch(apiUrl('/api/wire-v2-convert'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop' }),
    })
      .then(res => res.json())
      .then(() => this._fetchWireV2Convert())
      .catch((err) => reportSwallowed('fetch.wire-v2-convert', err));
  };

  // 1.7.0 P2 迁移引导弹窗：立即迁移 = 启动常驻转换任务并打开日志弹窗看进度；
  // 暂不 = 关闭（勾选「不再提醒」则持久化偏好；continued 场景服务端会再次提示）。
  handleMigrateNow = () => {
    this.setState({ migratePromptVisible: false });
    this.handleStartWireV2Convert();
    // Progress UI lives in the modal's v1 view since 1.7.0 — open straight into it.
    this.handleSetLogView('v1');
    this.handleImportLocalLogs();
  };

  handleMigrateLater = (dontRemind) => {
    this.setState({ migratePromptVisible: false });
    if (dontRemind) {
      this.context.updatePreferences({ wireV2MigratePromptDismissed: true });
    }
  };

  handleCloseImportModal = () => {
    this._stopWireV2ConvertPoll();
    // Reset to the v2 view so a reopened modal always starts on the default list.
    this.setState({ importModalVisible: false, selectedLogs: new Set(), logView: 'v2' });
  };

  handleRefreshStats = () => {
    this.setState({ refreshingStats: true });
    fetch(apiUrl('/api/refresh-stats'), { method: 'POST' })
      .then(res => res.json())
      .then(data => {
        if (!data.ok) throw new Error(data.error || 'refresh failed');
        return fetch(this._localLogsUrl());
      })
      .then(res => res.json())
      .then(data => {
        const { _currentProject, _unmigratedV1Count, _unmigratedV1Bytes, ...logs } = data;
        this.setState({ localLogs: logs, refreshingStats: false, unmigratedV1Count: _unmigratedV1Count || 0, unmigratedV1Bytes: _unmigratedV1Bytes || 0 });
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
    let base = `${window.location.protocol}//${window.location.host}${getBasePath()}`;
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
    // v2 sessions are folders → download the lossless session-dir zip
    // (`format=raw`). v1 `.jsonl` keeps the rebuilt-stream default unchanged.
    const raw = file.startsWith('v2:') ? '&format=raw' : '';
    const url = apiUrl(`/api/download-log?file=${encodeURIComponent(file)}${raw}`);
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // ─── 恢复会话 ──────────────────────────────────────────

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

  // ─── 拖拽上传（App / Mobile 共享）─────────────────────────
  // 文件拖入窗口 → 上传 → 落入 pendingUploadPaths。子类用 _captureDropContext()/
  // _dispatchUploadedFiles() 两个 prototype 钩子定制分发（Mobile 按终端可见性分流）。
  _isInternalDrag = (e) => e.dataTransfer.types.includes('text/x-preset-reorder');

  _onDragOver = (e) => {
    e.preventDefault();
    if (this._isInternalDrag(e)) return;
    // FileExplorer 区域不显示全屏 overlay，由 FileExplorer 自己处理外部拖入反馈
    const overFileExplorer = e.target.closest && e.target.closest('[data-file-explorer]');
    if (overFileExplorer) {
      if (this.state.isDragging) this.setState({ isDragging: false });
      return;
    }
    if (!this.state.isDragging) this.setState({ isDragging: true });
  };

  _onDragLeave = (e) => {
    const layout = this._layoutRef.current;
    if (layout && !layout.contains(e.relatedTarget)) {
      this.setState({ isDragging: false });
    }
  };

  _onDrop = (e) => {
    e.preventDefault();
    if (this._isInternalDrag(e)) return;
    this.setState({ isDragging: false });
    const files = Array.from(e.dataTransfer.files);
    if (!files.length) return;
    // drop 时刻同步捕获分发上下文（Mobile 需要 mobileTerminalVisible 的当时值，非上传完成后的值）
    const ctx = this._captureDropContext();
    // 拖拽上传在途占位:每文件登记 {id,name}(spinner-only,不建 objectURL 以免跨组件 revoke 竞态)。
    // ChatView 据 uploadingDrop 调谐占位 + 缓发,使图不漏发。
    const items = files.map(file => ({ id: `drop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: file.name }));
    this.setState(prev => ({ uploadingDrop: [...(prev.uploadingDrop || []), ...items] }));
    Promise.all(
      files.map(file =>
        uploadFileAndGetPath(file).then(path => ({ name: file.name, path }))
          .catch(err => { message.error(`${file.name}: ${err.message}`); return null; })
      )
    ).then(results => {
      // 关键顺序:先派发已 resolve 路径(落 pendingUploadPaths→pendingImages),再在同一 .then(同 tick,
      // React 批处理合并)清掉本批占位 —— 保证 ChatView 的 drain 重发在同一次渲染里读到已就绪的 pendingImages,
      // 不会出现「占位先清空、路径还没到 → drain 发出纯文字」的拖拽路径丢图竞态。
      this._dispatchUploadedFiles(results, ctx);
      const ids = new Set(items.map(i => i.id));
      this.setState(prev => ({ uploadingDrop: (prev.uploadingDrop || []).filter(d => !ids.has(d.id)) }));
    });
  };

  // 子类可 override（prototype 方法）。默认＝桌面行为：全落入 pendingUploadPaths。
  _captureDropContext() { return undefined; }

  _dispatchUploadedFiles(results) {
    const paths = results.filter(Boolean).map(r => `"${r.path}"`);
    if (paths.length > 0) {
      this.setState(prev => ({
        pendingUploadPaths: [...(prev.pendingUploadPaths || []), ...paths],
      }));
    }
  }

  handleUploadPathsConsumed = () => {
    this.setState({ pendingUploadPaths: [] });
  };

  // ─── 共享渲染辅助 ─────────────────────────────────────

  /** render() 前置计算，子类在 render 开头调用 */
  /** Wire v3 (V3.S3a): the request-list data source — metadata rows (adapted
   *  to list-item shape, memoized by rows-array reference) when the server
   *  announced wireV3 and rows have arrived; the legacy entries otherwise.
   *  EVERY selectedIndex-coupled call site must use this, not state.requests,
   *  or selection desynchronizes between the two shapes. */
  _listSource() {
    const rows = this.state.v2Rows;
    if (!this._wireV3 || !rows || rows.length === 0) return this.state.requests;
    if (this._v3AdaptSource !== rows) {
      this._v3AdaptSource = rows;
      this._v3Adapted = rows.map(rowToListItem);
    }
    return this._v3Adapted;
  }

  renderPrepare() {
    const { selectedIndex, showAll, fileLoading, fileLoadingCount, mainAgentSessions, viewMode } = this.state;
    const requests = this._listSource();
    const useRows = requests !== this.state.requests;

    // 过滤心跳请求
    if (this._filteredSource !== requests || this._filteredShowAll !== showAll) {
      this._filteredSource = requests;
      this._filteredShowAll = showAll;
      this._filteredRequests = visibleRequests(requests, showAll);
    }
    const filteredRequests = this._filteredRequests;

    // 增量 cache loss map — legacy path only: rows carry server-computed
    // cacheLoss inline (adapted items have no bodies for the client compute).
    if (useRows) {
      this._cacheLossMap = new Map();
      this._cacheLossLastMainAgent = null;
      this._cacheLossProcessedCount = 0;
    } else {
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
    }

    const selectedRequest = selectedIndex !== null ? filteredRequests[selectedIndex] : null;

    // Wire v3 (V3.S5): deep consumers (ChatView bubbles, AppHeader stats and
    // prompts, team modal, tool-result maps) need entry bodies. On the rows
    // path those live in state.requests (assembler-built entries), NOT in the
    // adapted rows the list renders — hand them a separate filtered view.
    let deepRequests = filteredRequests;
    if (useRows) {
      if (this._deepSource !== this.state.requests || this._deepShowAll !== showAll) {
        this._deepSource = this.state.requests;
        this._deepShowAll = showAll;
        this._deepRequests = visibleRequests(this.state.requests, showAll);
      }
      deepRequests = this._deepRequests;
    }

    return { filteredRequests, deepRequests, selectedRequest, fileLoading, fileLoadingCount, mainAgentSessions, viewMode };
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
