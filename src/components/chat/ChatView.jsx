import React from 'react';
import { Empty, Typography, Divider, Spin, Popover, Modal, message } from 'antd';
import ChatMessage from './ChatMessage';
import TerminalPanel, { uploadFileAndGetPath } from '../terminal/TerminalPanel';
import FileExplorer from '../files/FileExplorer';
import SearchPanel from '../search/SearchPanel';
import FileContentView from '../files/FileContentView';
import ImageViewer from '../viewers/ImageViewer';
import ImageLightbox from '../common/ImageLightbox';
import GitChanges from '../git/GitChanges';
import GitDiffView from '../git/GitDiffView';
import ToolApprovalPanel from '../approval/ToolApprovalPanel';
import { getModelInfo, getEffectiveModel, resolveProducerModelInfo, AUTO_APPROVE_INSTANT } from '../../utils/helpers';
import { formatPromptNavTime } from '../../utils/formatters';
import { buildPromptNavItems } from '../../utils/promptNav';
import { getTeammateAvatar } from '../../utils/teammateAvatars';
import { applyAvatarAnimationTargets } from '../../utils/avatarAnimationPostPass';
import { isSystemText, classifyUserContent, isMainAgent, isTeammate, resolveTeammateNames, extractDisplayText } from '../../utils/contentFilter';
import { classifyRequest, formatRequestTag, formatTeammateLabel } from '../../utils/requestType';
import { playEvent as playVoiceEvent } from '../../utils/voicePackPlayer';
import { buildChunksForAnswer, buildBracketPasteSubmitChunks, BRACKET_PASTE_SUBMIT_SETTLE_MS } from '../../utils/ptyChunkBuilder';
import { isPlanApprovalPrompt, isDangerousOperationPrompt, pickPlanApproveOptionNumber } from '../../utils/promptClassifier';
import { reportSwallowed } from '../../utils/errorReport';
import { isImageFile } from '../../utils/commandValidator';
import { loadExpandedPaths, saveExpandedPaths } from '../../utils/fileExpandedPathsStorage';
import { createEmptyToolState, appendToolResultMap, cachedBuildToolResultMap, getToolResultCache, setToolResultCache, buildSubAgentResultMap, createEmptyGlobalIndexState, appendToGlobalToolResultIndex } from '../../utils/toolResultBuilder';
import { refreshCachedItemProp } from '../../utils/refreshCachedItemProp';
import { refreshResolvedModelInfo, healUnresolvedTeammateEntries, needsFullReqRescan } from '../../utils/identityHeal';
import { resolveBubbleProducerTs } from '../../utils/sessionManager';
import { TeamButton, TeamModal } from '../dashboard/TeamSessionPanel';
import { WorkflowButton, WorkflowRunsModal } from '../dashboard/WorkflowRunsPanel';
import SnapLineOverlay from '../common/SnapLineOverlay';
import RoleFilterBar from './RoleFilterBar';
import ChatInputBar from './ChatInputBar';
import WorkflowLiveHud from '../viewers/WorkflowLiveHud';
import PresetModal from '../terminal/PresetModal';
import UltraPlanModal from '../terminal/UltraPlanModal';
import UltraplanPanel, { readUltraplanPopoverSize, ultraplanOverlayInnerStyle } from '../terminal/UltraplanPanel';
import UltraplanExpertManagerModal from '../terminal/UltraplanExpertManagerModal';
import { visibleExpertKeys } from '../../utils/ultraplanExperts';
import { TerminalWsContext } from '../terminal/TerminalWsContext';
import CustomUltraplanEditModal from '../terminal/CustomUltraplanEditModal';
import { buildLocalUltraplan } from '../../utils/ultraplanTemplates';
import { Virtuoso } from 'react-virtuoso';
import { StickyBottomController } from '../../utils/stickyBottomController';
import { AskFlowController, ASK_KIND, LEGACY_ASK_PLACEHOLDER_ID } from './controllers/askFlowController';
import { UltraplanController } from '../../utils/ultraplanController';
import { shouldDeferSend, reduceUploading } from './uploadDeferLogic';
import { computeMessagesPending, healStalePendingIds, computeLrOwnership, filterLrContent, hasVisibleLrContent, collectLrAskQuestions } from './interactionOwnership';
import { ScrollHighlightController } from './controllers/scrollHighlightController';
import { PermissionController } from './controllers/permissionController';
import { ToolFileChangeController } from './controllers/toolFileChangeController';
import { SplitDragController, TERMINAL_WIDTH_STORAGE_KEY, SIDEBAR_WIDTH_STORAGE_KEY } from './controllers/splitDragController';
import { PtyPromptController } from './controllers/ptyPromptController';
import { TERMINAL_CHAR_WIDTH, RESIZER_WIDTH_PX } from '../../utils/splitDragCalc';
import { isMobile, isIOS, isPad } from '../../env';
import { t } from '../../i18n';
import { apiUrl } from '../../utils/apiUrl';
import { tryOpenWithSystem } from '../../utils/fileOpen';
import { BUILTIN_PRESETS } from '../../utils/builtinPresets';
import defaultAvatarUrl from '../../img/default-avatar.svg';
import loadingPetUrl from '../../img/loading-pet.gif';
// 用 <object type="image/svg+xml"> 替代 <img>：WeChat / Android WebView 在 <img> 的 image 路径
// 下经常把 SMIL <animate> 当 raster 处理只渲染第 0 帧；<object> 走 SVG document 路径，所有 WebView
// 正确播放，且不依赖 dangerouslySetInnerHTML。
import shimmerUrl from '../../img/claude/shimmer.svg';
import orbitingUrl from '../../img/claude/orbiting.svg';
import styles from './ChatView.module.css';

const { Text } = Typography;

const QUEUE_THRESHOLD = 20;

// Normalize a viewer path to the project-relative form search results use (strip a leading ./),
// so the dirty-skip and post-replace open-file comparisons line up. (repo-prefixed git paths for
// non-root repos are an accepted edge — they simply won't match a project-relative search path.)
const normalizeProjectPath = (p) => (typeof p === 'string' && p.startsWith('./') ? p.slice(2) : p);

// 乐观停止兜底超时：到点仍未收到真实停止信号则强制清 stopOptimistic。必须 > AppBase 关闭路径
// （streaming_status{active:false} 的 SSE + 2s _streamingOffTimer），否则会在 isStreaming 仍为 true
// 时过早清除、让按钮回跳停止态。正常路径由 componentDidUpdate 的 isStreaming 下降沿先清除。
const STOP_OPTIMISTIC_FALLBACK_MS = 4000;
// CLI/PTY 停止：focus-in(\x1b[I) 与 ESC(\x1b) 之间的间隔——给 Claude 一次独立 PTY read 先更新聚焦态
// 再判定 ESC。对齐 _sendUserMessageImmediate 里 input→\r 的既有 50ms 约定（避免引入新魔数）。
const STOP_FOCUS_IN_ESC_DELAY_MS = 50;
// 图片上传在途时按发送 → 缓发(defer)等待上传 resolve 后自动带图发送的超时兜底:
// 到点仍未完成则提示重试,绝不静默发纯文字。
const UPLOAD_DEFER_TIMEOUT_MS = 10000;

// 免审批下 PTY 子代理 prompt 去重时窗：同一 prompt 在该窗口内被反复检测时只放行一次，
// 挡住 PTY 慢回显/重绘导致的二次自动放行（_promptSubmitting 仅 500ms，不足以覆盖）。

const MOBILE_ITEM_LIMIT = 240;
const IOS_ITEM_LIMIT = 150;
const MOBILE_LOAD_MORE_STEP = 100;
// 桌面端初始渲染上限。桌面不走虚拟化（useVirtuoso 仅 isMobile），长任务会把整段对话全量渲染成
// DOM，中后段 reconcile/layout 成本随条目数线性增长 → 主线程卡死（Windows 比 Mac 先撞上上限）。
// 与移动端一致：只渲染最近 N 条 item，更早的用「加载更早」按需展开。桌面给更大窗口。
const DESKTOP_ITEM_LIMIT = 400;
// 当前平台基础渲染上限。isMobile/isIOS 在模块加载时即固定（见 env.js），故可一次性求值。
const ITEM_LIMIT = isMobile ? (isIOS ? IOS_ITEM_LIMIT : MOBILE_ITEM_LIMIT) : DESKTOP_ITEM_LIMIT;
const useVirtuoso = isMobile && !isIOS && !isPad;

// 稳定空对象引用，避免每次 render 创建新 {} 导致子组件重渲染
const EMPTY_OBJ = {};
const EMPTY_MAP = {};

// ASK_KIND / LEGACY_ASK_PLACEHOLDER_ID 现由 ./controllers/askFlowController 定义并 import（见顶部）。

// Virtuoso custom Scroller — 定义在类外部，避免每次 render 创建新组件引用
const VirtuosoScroller = React.forwardRef((props, ref) => (
  <div ref={ref} {...props} className={styles.container} />
));

function randomInterval() {
  return 100 + Math.random() * 50;
}

// UltraPlan modal 拖拽尺寸持久化 helper —— 单值 key,与 PanelResizer 风格一致。
// 手机模式(isMobile && !isPad)不读 localStorage,初值 null,保留 modal CSS 默认尺寸。
const _ULTRAPLAN_W_KEY = 'cc-viewer-ultraplan-modal-width';
const _ULTRAPLAN_H_KEY = 'cc-viewer-ultraplan-modal-height';
function _readUltraplanModalSize() {
  if (isMobile && !isPad) return null;
  try {
    const w = parseFloat(localStorage.getItem(_ULTRAPLAN_W_KEY));
    const h = parseFloat(localStorage.getItem(_ULTRAPLAN_H_KEY));
    if (Number.isFinite(w) || Number.isFinite(h)) {
      return { w: Number.isFinite(w) ? w : null, h: Number.isFinite(h) ? h : null };
    }
  } catch {}
  return null;
}
function _writeUltraplanModalSize(size) {
  if (isMobile && !isPad) return;
  try {
    if (size?.w) localStorage.setItem(_ULTRAPLAN_W_KEY, String(size.w));
    if (size?.h) localStorage.setItem(_ULTRAPLAN_H_KEY, String(size.h));
  } catch {}
}

class ChatView extends React.Component {
  // 通过 Context 共享 App 层的单条 /ws/terminal,this.context = { send, isOpen, addMessageHandler, addStateListener }
  static contextType = TerminalWsContext;

  // 兼容 stub:历史代码大量使用 `this._inputWs.send(JSON.stringify(...))` 和
  // `this._inputWs.readyState === WebSocket.OPEN`。getter 返回一个轻量对象映射到 context API,
  // 这样现有发送/状态检查代码无需逐处替换(只删掉 connectInputWs/onclose/close 路径)。
  // ws 实例由 Provider 持有,readyState 仅区分 OPEN(1) / CLOSED(3),不暴露 CONNECTING/CLOSING 中间态。
  get _inputWs() {
    const ctx = this.context;
    if (!ctx || typeof ctx.send !== 'function') return null;
    return {
      get readyState() { return ctx.isOpen && ctx.isOpen() ? WebSocket.OPEN : WebSocket.CLOSED; },
      send: (s) => {
        let obj;
        try { obj = JSON.parse(s); } catch { return false; }
        return ctx.send(obj);
      },
    };
  }

  constructor(props) {
    super(props);
    this.containerRef = React.createRef();
    this.virtuosoRef = React.createRef();
    this.splitContainerRef = React.createRef();
    this.innerSplitRef = React.createRef();

    // 增量 tool result 状态
    this._incToolState = null;
    this._incToolProcessedCount = 0;
    this._incToolSessionIdx = -1;
    this._prevSessions = null;

    // requests 扫描增量缓存。按职责分 3 类，增量扫描时只追加不回溯：
    //
    // ── 扫描游标 ──
    //   processedCount       : requests 已扫到的位置（下次从此继续）
    //   subAgentProcessedCount: subAgentEntries 的扫描游标（由 buildAllItems 写入）
    //   tsToIndex            : req.timestamp → requests 数组下标；per-message modelInfo 解析的中转
    //
    // ── 模型状态机（区分"活跃 vs 已完成"）──
    //   modelName            : 最后扫到的 MainAgent req.body.model。即使 req 还在流式（没 response）也更新。
    //                          用于侧边栏角色菜单、权限模态、Last Response 面板等"需要最新态"的消费者。
    //   completedModelName   : 仅当 req.response 存在时才更新的 model。在流式进行中永远指向"上一次已完成的模型"，
    //                          用于 SSE streaming avatar —— 继承已完成而非推测 in-flight。避免头像闪烁。
    //   modelNameByReqIdx[i] : 每个 request 下标"当时活跃"的模型名（carry-over：无 body.model 的 req 继承前一个）。
    //                          per-message avatar 解析：tsToIndex[ts] → modelNameByReqIdx[idx] → getModelInfo。
    //
    // ── SubAgent/Teammate 渲染入口 ──
    //   subAgentEntries      : 非 MainAgent 的 Sub/Teammate 消息渲染数据（时序插入到主列表里）
    this._reqScanCache = { tsToIndex: {}, modelName: null, completedModelName: null, modelNameByReqIdx: [], subAgentEntries: [], processedCount: 0, subAgentProcessedCount: 0, requestCacheTokenMap: new Map(), globalIndexState: createEmptyGlobalIndexState(), globalIndexProcessedCount: 0 };

    // buildAllItems session 级缓存
    // 每项: { session, msgsLen, subCount, items, tsEntries, lastPendingAskId, lastPendingPlanId }
    this._sessionItemCache = [];
    this._itemCacheToggleSig = null;

    // 文件详情滚动位置快照（写/编辑触发 fileVersion remount 时跨实例传递）。
    // 故意用 instance ref 而非 React state：onScroll throttle 100ms 期间会高频写入，
    // 走 setState 会反复 re-render ChatView/FileContentView 拖累滚动顺滑度。
    // FileContentView 通过 props.getFileScrollSnapshot()（闭包稳定）按需读取。
    // 形态：{ path, viewerType: 'code'|'markdown'|'mdx', line?: number, percent?: number } | null
    this._fileScrollSnapshot = null;


    // 从 localStorage 读取用户偏好的终端宽度（像素）
    const savedWidth = localStorage.getItem(TERMINAL_WIDTH_STORAGE_KEY);
    const initialTerminalWidth = savedWidth ? parseFloat(savedWidth) : null;

    this.state = {
      visibleCount: 0,
      loading: false,
      allItems: [],
      lastResponseItems: null,
      highlightTs: null,
      highlightFading: false,
      highlightVisibleIdx: -1,
      sidebarWidth: parseInt(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY), 10) || 240,
      terminalWidth: initialTerminalWidth || 624, // 默认 80cols * 7.8px
      needsInitialSnap: initialTerminalWidth === null, // 标记是否需要初始化吸附
      inputEmpty: true,
      pendingInput: null,
      stickyBottom: true,
      userScrolling: false, // 用户滚动意图暂停窗口（wheel/touch/pointer 拖动进行中或空窗内）
      ptyPrompt: null,
      ptyPromptHistory: [],
      inputSuggestion: null,
      fileExplorerOpen: !isMobile
        ? localStorage.getItem('ccv_fileExplorerOpen') !== 'false'
        : (isPad ? localStorage.getItem('ccv_fileExplorerOpen') === 'true' : false),
      currentFile: null,
      currentGitDiff: null,
      scrollToLine: null,
      scrollToMatch: null,
      searchOpen: false,
      fileExplorerExpandedPaths: loadExpandedPaths(props.projectName),
      gitChangesOpen: false,
      hasGit: true,
      snapLines: [],
      activeSnapLine: null,
      isDragging: false,
      fileVersion: 0, // 用于强制 FileContentView 重新挂载
      editorSessionId: null, // active $EDITOR session
      editorFilePath: null,
      fileExplorerRefresh: 0,
      gitChangesRefresh: 0,
      roleFilterOpen: false,
      roleFilterSelected: new Set(),
      teamModalSession: null,
      workflowModalRun: null,
      mdLightboxSrc: null,
      streamingFading: false,
      stopOptimistic: false, // 点「停止」后乐观置 true：按钮/指示器立即切非运行态，真实 isStreaming 翻 false 或兜底超时后清除
      presetItems: [],
      mobilePresetModalVisible: false,
      localAskAnswers: {}, // 提交后的本地答案映射，用于 Last Response 立即切换到非交互式
      pendingPermission: null, // { id, toolName, input } — active permission approval request
      permissionQueue: [], // queued permission requests when one is already active
      pendingPlanApproval: null, // { id, input } — active ExitPlanMode approval in SDK mode
      pendingAsk: null, // { id, questions } — mirrored React state for global modal. _askHookQuestions / _sdkAskId 仍是提交路径权威源（handleAskQuestionSubmit 用于路由 SDK / hook bridge / PTY 三条提交路径）。
      askQueue: [], // queued asks ({ id, questions, kind: ASK_KIND.HOOK|SDK }) when one is already active — mirrors permissionQueue. server.js pendingAskHooks Map 来源；hook bridge 现已 id 多路复用，sub-agent 并发 / 上一轮没答的 ask 不再阻塞下一轮。
      askMetaMap: {}, // { [askId]: { startedAt, timeoutMs } } — 倒计时元数据。ask-pending 时 add，
      // ask resolve/cancel/timeout 时 delete，确保内存随 ask 生命周期回收（不会随会话增长无界累积）。
      pendingPtyPlan: null, // { id, prompt } — active plan approval. id 与 ExitPlanMode tool_use id (lastPendingPlanId) 同源，由 componentDidUpdate 从 _currentLastPendingPlanId 派生（cliMode 守卫 + _resolvedPlanIds 短暂窗口守卫）。
      planAutoApproveCountdown: null, // number|null — 「Plan 自动审批」开启时当前 pendingPtyPlan 的剩余秒数；null=未在倒计时。下发给 inline 卡片显示「{n}s 后自动批准 · 取消」。
      pendingImages: [], // [{ path, source }] — images uploaded/pasted, shown as previews in chat input
      uploadingItems: [], // [{ id, name, previewUrl }] — 上传在途的占位项(路径还没 resolve);预览条只从 pendingImages 渲染缩略图,故占位需独立 state
      sendDeferred: false, // 仅渲染用:有上传在途时按了发送 → 缓发态(发送按钮 spinner)。权威双发标志是实例字段 _sendDeferred
      // Optimistic: agent-teams is on by default at launch, so assume enabled until
      // /api/claude-settings resolves — avoids a first-paint layout shift on the common
      // path. Flips to false on mount/update only for the rare explicit opt-out.
      agentTeamEnabled: true,
      ultraplanModalOpen: false, // 移动端专用（桌面走 ultraplanPopoverOpen 的终端同款弹层）
      ultraplanVariant: 'codeExpert',
      ultraplanPrompt: '',
      ultraplanFiles: [],
      // UltraPlan modal 拖拽 resize 后的尺寸,持久化到 localStorage 两个 key
      // (与 PanelResizer 单值风格一致);手机模式不读不写,初值固定 null。
      ultraplanModalSize: _readUltraplanModalSize(),
      customUltraplanExperts: [],
      customUltraplanEditOpen: false,
      customUltraplanEditing: null,
      // 受控的 token 统计 hover 弹层：点开「所有工具」(?) 目录时需主动收起本弹层
      tokenStatsPopoverOpen: false,
      // 桌面隐藏终端的输入栏 UltraPlan 弹层（与终端工具栏共用 UltraplanPanel）
      ultraplanPopoverOpen: false,
      ultraplanPopoverSize: readUltraplanPopoverSize(), // 与终端弹层共享同一对 localStorage key
      ultraplanExpertOrder: [],
      ultraplanExpertHidden: [],
      ultraplanManagerOpen: false,
      ultraplanLightbox: null,
      ultraplanConfirming: false,
      // ExitPlanMode V2 input.planFilePath 异步读盘缓存：{ [planFilePath]: content }
      planFileContents: {},
    };
    this._projectDirCache = null; // 缓存项目目录绝对路径（toolFileChangeController 经 host 读）
    // 关闭期间累积的修改信号；下次面板打开时消费一次（与 setState 一并触发刷新计数 +1）。
    // toolFileChangeController 经 host.setPendingXxxRefresh 写，_setFileExplorerOpen / render Git 开关消费。
    this._pendingFileRefresh = false;
    this._pendingGitRefresh = false;
    this._queueTimer = null;
    this._prevItemsLen = 0;
    this._scrollTargetIdx = null;
    this._scrollTargetRef = React.createRef();
    // _inputWs 现在是 getter(挂在原型),不在 constructor 上设字段,避免覆盖 getter
    this._unsubWsHandler = null;
    this._unsubWsState = null;
    this._inputRef = React.createRef();
    this._stopOptimisticTimer = null; // 乐观停止兜底定时器
    // PTY byte-stream state (buffer/carry/debounce/current-prompt mirror/auto-allow
    // dedupe) is owned by this._ptyPrompt (PtyPromptController), see end of constructor.
    // 全部 ask 状态机字段 + 方法由 this._askFlow（AskFlowController）持有，见构造末尾。
    this._mobileExtraItems = 0;
    this._mobileSliceOffset = 0;
    this._totalItemCount = 0;
    this._autoFillRafId = null; // logfile 只读模式自动渐进扩窗的 rAF 句柄（_maybeScheduleLocalLogAutoFill）

    // PTY plan modal 触发：用 lastPendingPlanId（ExitPlanMode tool_use id）作权威信号源（与 inline 卡片同源）。
    // _currentLastPendingPlanId 由 buildAllItems 末尾镜像；componentDidUpdate 派生 pendingPtyPlan。
    // _resolvedPlanIds 守卫用户已操作但 JSONL 还没回写 planApprovalMap 的短暂窗口（防 modal 闪回）。
    this._currentLastPendingPlanId = null;
    this._resolvedPlanIds = new Set();
    this._lastObservedLpid = null;
    // 「Plan 自动审批」倒计时：_planAutoTimer 当前 setInterval 句柄；_planAutoCancelled 记录用户手动取消过的 plan id（避免取消后又重启）。
    this._planAutoTimer = null;
    this._planAutoCancelled = new Set();
    // Plan V2 文件型 plan 的异步内容缓存（input.planFilePath → 文件正文）
    this._planFileFetches = new Set();
    this._streamSpinnerUrl = props.isStreaming
      ? (Math.random() < 0.5 ? orbitingUrl : shimmerUrl)
      : null;
    this._unmounted = false;
    // 流式吸底控制器：收敛 7 处 scrollTop 写入、3 套并行机制、引用计数 lock、用户滚动意图暂停窗口
    // 详见 src/utils/stickyBottomController.js + plan modular-floating-hopper.md (v2.1)
    this._stickyController = new StickyBottomController({
      getSticky: () => this.state.stickyBottom,
      setSticky: (v) => {
        if (this._unmounted) return;
        if (this.state.stickyBottom === v) return;
        this.setState({ stickyBottom: v });
      },
      getMode: () => useVirtuoso ? 'virtuoso' : 'desktop',
      // 用户滚动窗口开/关沿 → state.userScrolling，驱动 Virtuoso followOutput 门控
      onUserScrollChange: (active) => {
        if (this._unmounted) return;
        if (this.state.userScrolling === active) return;
        this.setState({ userScrolling: active });
      },
    });

    // ── Ask 问答流状态机控制器（逻辑从 ChatView 抽出，见 ./controllers/askFlowController.js）──
    // host 适配器把 ChatView 的 state / props / ws / PTY 字段桥接给控制器；ChatView 的 ask 方法
    // 退化为一行委托。state 仍留在 ChatView.state，行为不变。
    this._askFlow = new AskFlowController({
      getState: () => this.state,
      setState: (updater, cb) => this.setState(updater, cb),
      getProps: () => this.props,
      ws: () => this._inputWs,
      ctxSend: (obj) => this.context?.send?.(obj),
      ctxIsOpen: () => this.context?.isOpen?.(),
      addMessageHandler: (fn) => this.context.addMessageHandler(fn),
      getCurrentPtyPrompt: () => this._ptyPrompt.getCurrent(),
      setCurrentPtyPrompt: (v) => this._ptyPrompt.setCurrent(v),
      clearPtyDebounce: () => this._ptyPrompt.clearDebounce(),
      sendUserMessageImmediate: (text, ta, skip) => this._sendUserMessageImmediate(text, ta, skip),
      takePendingFlush: (askId) => {
        if (!this._pendingFlushQueue || this._pendingFlushQueue.length === 0) return null;
        const idx = this._pendingFlushQueue.findIndex(e => e.askId === askId);
        if (idx < 0) return null;
        const entry = this._pendingFlushQueue.splice(idx, 1)[0];
        if (entry?.tid) clearTimeout(entry.tid);
        return entry;
      },
      isUnmounted: () => this._unmounted,
      fetchPendingAsks: () => fetch(apiUrl('/api/pending-asks')).then(r => r.ok ? r.json() : null),
      notifyAskResolved: (payload) => {
        try {
          if (typeof window !== 'undefined' && window.tabBridge?.notifyAskResolved) {
            window.tabBridge.notifyAskResolved({ tabId: this.props.ownTabId ?? null, ...payload });
          }
        } catch {}
      },
      // PTY 提交失败的用户提示（antd Modal + i18n + JSX 留在 ChatView，控制器保持 node:test 可 import）
      warnSubmitRetry: (reason) => {
        try {
          Modal.warning({
            title: t('ui.askSubmitRetryHint'),
            content: (
              <div>
                <div style={{ whiteSpace: 'pre-line' }}>{t('ui.askSubmitFailedDetail')}</div>
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>[reason] {String(reason || 'unknown')}</div>
              </div>
            ),
          });
        } catch {
          try { message.warning(t('ui.askSubmitRetryHint')); } catch {}
        }
      },
    });

    // UltraPlan 文件 / 自定义专家纯逻辑（与 TerminalPanel 共享，见 ../utils/ultraplanController）。
    // host 适配器桥接 state / 上传 / 提示 / 偏好 / 关闭编辑器；ChatView 的 6 个方法退化为委托。
    this._ultraplan = new UltraplanController({
      getState: () => this.state,
      setState: (updater) => this.setState(updater),
      onUpdatePreferences: (p) => this.props.onUpdatePreferences?.(p),
      uploadFile: (file) => uploadFileAndGetPath(file),
      messageError: (msg) => message.error(msg),
      closeEditor: () => this._closeCustomUltraplanEditor(),
    });

    // 跳转高亮「滚动即褪色」（见 ./controllers/scrollHighlightController）。
    this._scrollHighlight = new ScrollHighlightController({
      getScrollContainer: () => this._getScrollContainer(),
      setState: (updater) => this.setState(updater),
    });

    // 权限审批队列（见 ./controllers/permissionController）；state 仍留 ChatView.state。
    this._permission = new PermissionController({
      getState: () => this.state,
      setState: (updater) => this.setState(updater),
      ws: () => this._inputWs,
      promptOptionClick: (n) => this.handlePromptOptionClick(n),
    });

    // 工具文件变更监听 + LRU 去重（见 ./controllers/toolFileChangeController）。
    this._toolFileMonitor = new ToolFileChangeController({
      getState: () => this.state,
      setState: (updater) => this.setState(updater),
      getProps: () => this.props,
      getProjectDir: () => this._projectDirCache,
      setPendingFileRefresh: () => { this._pendingFileRefresh = true; },
      setPendingGitRefresh: () => { this._pendingGitRefresh = true; },
    });

    // Terminal/sidebar drag-resize lifecycle (see ./controllers/splitDragController;
    // pure snap geometry in utils/splitDragCalc.js).
    this._splitDrag = new SplitDragController({
      getState: () => this.state,
      setState: (update) => this.setState(update),
      getSplitRect: () => this.innerSplitRef.current?.getBoundingClientRect() ?? null,
      persistWidth: (key, px) => this._persistWidth(key, px),
    });

    // PTY prompt detection (buffer/carry/debounce/dedupe — see ./controllers/ptyPromptController).
    this._ptyPrompt = new PtyPromptController({
      getState: () => this.state,
      setState: (update, cb) => this.setState(update, cb),
      isInstantAutoApprove: () => this.props.autoApproveSeconds === AUTO_APPROVE_INSTANT,
      isAskSubmitting: () => this._askFlow._askSubmitting,
      permissionAutoAllow: (perm) => this._permission.autoAllow(perm),
      scrollToBottom: () => this.scrollToBottom(),
      now: () => Date.now(),
    });
  }

  _setFileExplorerOpen(open) {
    localStorage.setItem('ccv_fileExplorerOpen', String(open));
    if (open && this._pendingFileRefresh) {
      // 关闭期间累积的修改信号在打开瞬间消费一次
      this._pendingFileRefresh = false;
      this.setState(prev => ({
        fileExplorerOpen: true,
        fileExplorerRefresh: prev.fileExplorerRefresh + 1,
      }));
    } else {
      this.setState({ fileExplorerOpen: open });
    }
  }

  componentDidMount() {
    this.startRender();
    // 注册 ws 消息 handler。Provider 本身根据 cliMode/terminalVisible 决定何时建立 ws,
    // ChatView 不再自己 connect/close;handler 在 ws 重连后会自动继续收到新消息。
    if (this.context && this.context.addMessageHandler) {
      this._unsubWsHandler = this.context.addMessageHandler(this._onTerminalWsMessage);
    }
    if (this.context && this.context.addStateListener) {
      this._unsubWsState = this.context.addStateListener(this._onTerminalWsState);
    }
    // 检测项目是否有 git（优先多仓库 API，回退旧 API）
    fetch(apiUrl('/api/git-repos')).then(r => r.ok ? r.json() : Promise.reject()).then(data => {
      if (!data.repos?.length) this.setState({ hasGit: false, gitChangesOpen: false });
    }).catch(() => {
      fetch(apiUrl('/api/git-status')).then(r => {
        if (!r.ok) this.setState({ hasGit: false, gitChangesOpen: false });
      }).catch(() => this.setState({ hasGit: false, gitChangesOpen: false }));
    });
    // Agent Team 启用状态从 props.claudeSettings 派生(由 SettingsContext 集中 fetch);
    // mount 时若 settings 已 ready 立即同步(启用/关闭都要覆盖乐观默认),否则等
    // componentDidUpdate 接力。claudeSettings 未 ready(null)时保留乐观默认 true。
    if (this.props.claudeSettings) {
      const enabled = this.props.claudeSettings?.env?.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === '1';
      if (enabled !== this.state.agentTeamEnabled) this.setState({ agentTeamEnabled: enabled });
    }
    // 桌面模式：containerRef 在 first render 后就绪，cdU 第一帧调 controller.bind
    // virtuoso 模式：scrollerRef 回调里 controller.bind
    // touch 守卫与 ResizeObserver 由 controller 内部管理（首次 bind 时统一注册 document touch）
    if (!useVirtuoso && this.containerRef.current) {
      this._stickyController.bind(this.containerRef.current);
    }
    // 初始化时吸附到 60cols
    if (this.state.needsInitialSnap && this.props.cliMode && this.props.terminalVisible) {
      this._snapToInitialPosition();
    }
    // 加载 Agent Team 预置项 (props.preferences 已 ready 时立即加载,
    // 否则 componentDidUpdate 接力。preset 写入由 SettingsContext.updatePreferences
    // setState 触发 props 变化,无需 window event)
    this._loadPresets();
  }

  shouldComponentUpdate(nextProps, nextState) {
    return (
      nextProps.requests !== this.props.requests ||
      nextProps.mainAgentSessions !== this.props.mainAgentSessions ||
      nextProps.sessionUpperBoundTs !== this.props.sessionUpperBoundTs ||
      nextProps.streamingLatest !== this.props.streamingLatest ||
      nextProps.collapseToolResults !== this.props.collapseToolResults ||
      nextProps.expandThinking !== this.props.expandThinking ||
      nextProps.showFullToolContent !== this.props.showFullToolContent ||
      nextProps.onlyCurrentSession !== this.props.onlyCurrentSession ||
      nextProps.isLocalLog !== this.props.isLocalLog ||
      nextProps.scrollToTimestamp !== this.props.scrollToTimestamp ||
      nextProps.cliMode !== this.props.cliMode ||
      nextProps.terminalVisible !== this.props.terminalVisible ||
      nextProps.userProfile !== this.props.userProfile ||
      nextProps.pendingUploadPaths !== this.props.pendingUploadPaths ||
      nextProps.isStreaming !== this.props.isStreaming ||
      nextProps.hasMoreHistory !== this.props.hasMoreHistory ||
      nextProps.loadingMore !== this.props.loadingMore ||
      nextProps.loadingSessionId !== this.props.loadingSessionId ||
      nextProps.lang !== this.props.lang ||
      nextProps.showThinkingSummaries !== this.props.showThinkingSummaries ||
      nextProps.fileLoading !== this.props.fileLoading ||
      nextProps.claudeSettings !== this.props.claudeSettings ||
      nextProps.preferences !== this.props.preferences ||
      // 审批档位值要直达终端工具栏快捷菜单：不能只依赖 preferences 引用同批变化放行
      nextProps.autoApproveSeconds !== this.props.autoApproveSeconds ||
      nextProps.planAutoApproveSeconds !== this.props.planAutoApproveSeconds ||
      nextState !== this.state
    );
  }

  componentDidUpdate(prevProps, prevState) {
    if (prevProps.isStreaming !== this.props.isStreaming) {
      this._streamSpinnerUrl = this.props.isStreaming
        ? (Math.random() < 0.5 ? orbitingUrl : shimmerUrl)
        : null;
    }
    // workspace 切换：projectName 变了 → 按新 key 重新 hydrate；scroll 快照同样作废。
    // ChatView 是 class 组件不能直接用 useSessionStoragePersistedSet hook，这里手抄同款
    // 守卫语义：`空 → 非空` 是 /api/project-name 异步到达的延迟初始化，**跳过 rehydrate**
    // 保留 ctor lazy load 后用户在此窗口内的内存操作；非空 → 非空 / 非空 → 空 才是真切换。
    // （scroll 快照无所谓延迟初始化，工作流上用户必须先打开文件才有快照，每次都清安全。）
    if (prevProps.projectName !== this.props.projectName) {
      if (prevProps.projectName) {
        this.setState({ fileExplorerExpandedPaths: loadExpandedPaths(this.props.projectName) });
      }
      this._fileScrollSnapshot = null;
    }
    // currentFile 变（含切到 null）→ 上一文件的 scroll 快照失效，集中在 cdU 一处清，
    // 比在 8 个 setState({currentFile:...}) 站点各加一行更稳。fileVersion bump 走的是同
    // currentFile 的 remount 路径，currentFile 不变 → 快照保留 → 用于 restore，正合需求。
    if (prevState.currentFile !== this.state.currentFile) {
      this._fileScrollSnapshot = null;
    }
    // SettingsContext 异步 fetch 完成后,props.claudeSettings / props.preferences 才到达;
    // 同步派生的 agentTeamEnabled 与 _loadPresets 都需在这里接力。
    if (prevProps.claudeSettings !== this.props.claudeSettings) {
      const enabled = this.props.claudeSettings?.env?.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === '1';
      if (enabled !== this.state.agentTeamEnabled) {
        this.setState({ agentTeamEnabled: enabled });
      }
      this._loadPresets();
    }
    if (prevProps.preferences !== this.props.preferences) {
      this._loadPresets();
    }
    // 扫描 messages 中所有 ExitPlanMode tool_use 的 input.planFilePath，按需异步拉取磁盘内容
    // 仅在 messages 引用变化时遍历（O(N) 低频），fetch 去重 + _unmounted 守卫
    if (prevProps.messages !== this.props.messages) {
      const messages = this.props.messages || [];
      const cache = this.state.planFileContents || {};
      for (const msg of messages) {
        if (!msg || msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;
        for (const blk of msg.content) {
          if (!blk || blk.type !== 'tool_use' || blk.name !== 'ExitPlanMode') continue;
          const inp = blk.input || {};
          // 已有内联 plan 不需要读盘（input.plan 是首选）
          if (typeof inp.plan === 'string' && inp.plan.trim()) continue;
          const fp = inp.planFilePath;
          if (typeof fp !== 'string' || !fp) continue;
          if (cache[fp] !== undefined) continue;
          if (this._planFileFetches.has(fp)) continue;
          this._planFileFetches.add(fp);
          fetch(apiUrl(`/api/plan-file?path=${encodeURIComponent(fp)}`))
            .then(r => r.ok ? r.json() : null)
            .then(j => {
              if (this._unmounted) return;
              if (j && j.ok && typeof j.content === 'string') {
                this.setState(s => ({ planFileContents: { ...(s.planFileContents || {}), [fp]: j.content } }));
              }
            })
            .catch(() => { /* 文件不存在/拒绝 → 静默回退到其他源 */ });
        }
      }
    }
    // 派生 pendingPtyPlan from _currentLastPendingPlanId（与 inline 卡片同源）。
    // _currentLastPendingPlanId 由 buildAllItems 末尾镜像；只在 cliMode 下生效（红线 2：sdkMode 走 inline-only）。
    // _resolvedPlanIds 守用户已操作但 JSONL 还没回写 planApprovalMap 的短暂窗口（提交后到 tool_result 落盘之间），
    // 防 CDU 把 modal 重弹；过期项在 lpid 变化时（即旧 plan 真正 resolve）下面分支自动清出。
    {
      const lpid = this._currentLastPendingPlanId || null;
      const curPtyPlan = this.state.pendingPtyPlan;
      const skipped = lpid && this._resolvedPlanIds.has(lpid);
      if (this.props.cliMode && lpid && !skipped) {
        if (!curPtyPlan || curPtyPlan.id !== lpid) {
          this.setState({ pendingPtyPlan: { id: lpid, prompt: null } });
        }
      } else if (curPtyPlan) {
        this.setState({ pendingPtyPlan: null });
      }
      // lpid 变化才更新 _lastObservedLpid + 清出过期项；不变时 no-op 节省每帧无谓写
      if (this._lastObservedLpid !== lpid) {
        if (this._lastObservedLpid) {
          this._resolvedPlanIds.delete(this._lastObservedLpid);
        }
        this._lastObservedLpid = lpid;
      }
    }
    // 通知父组件权限审批状态变化（用于移动端全局浮层）
    if (prevState.pendingPermission !== this.state.pendingPermission && this.props.onPendingPermission) {
      if (this.state.pendingPermission) {
        this.props.onPendingPermission({
          permission: this.state.pendingPermission,
          modelName: this._reqScanCache?.modelName,
          handlers: {
            allow: this.handlePermissionAllow,
            allowSession: this.props.sdkMode ? this.handlePermissionAllowSession : null,
            deny: this.handlePermissionDeny,
          },
        });
      } else {
        this.props.onPendingPermission(null);
      }
    }
    if (prevState.pendingPlanApproval !== this.state.pendingPlanApproval && this.props.onPendingPlanApproval) {
      if (this.state.pendingPlanApproval) {
        this.props.onPendingPlanApproval({
          plan: this.state.pendingPlanApproval,
          handlers: { approve: this.handlePlanApprove, reject: this.handlePlanReject },
        });
        // SDK ExitPlanMode lives in an inline card, not the global ApprovalModal, so
        // ApprovalModal's sound effect never fires for this path. Hook the voice pack
        // here directly( — SDK plan was silent before this).
        try {
          const vp = this.props.preferences?.approvalModal?.voicePack;
          if (vp && vp.enabled && vp.events && vp.events.planApproval) {
            playVoiceEvent('planApproval', vp, { dedupeKey: `planApproval:${this.state.pendingPlanApproval.id}` });
          }
        } catch { /* never throw from componentDidUpdate */ }
      } else {
        this.props.onPendingPlanApproval(null);
      }
    }
    if (prevState.pendingAsk !== this.state.pendingAsk) {
      if (this.props.onPendingAsk) {
        if (this.state.pendingAsk) {
          this.props.onPendingAsk({
            ask: this.state.pendingAsk,
            handlers: { submit: this.handleAskQuestionSubmit, cancel: this.handleAskCancel },
          });
        } else {
          this.props.onPendingAsk(null);
        }
      }
      // ask transition 时显式通知 main 清聚合状态。覆盖两种迁移：
      //  (a) prev 有 → 当前 null（resolve / unmount / WS 断连 兜底）
      //  (b) prev 有 → 当前也有但 id 变了（head swap，promote 队列下一个 ask 上头时旧 id 必须先释放）
      // 正常 resolve 路径 server 已 process.send 过 (a)，(b) 是新增的多并发场景下 Electron pendingByTab
      // Map<id> 同步必需，否则 main 进程 dock badge / flashFrame 仍认为旧 ask 在挂着。
      try {
        if (typeof window !== 'undefined' && window.tabBridge?.notifyAskResolved
            && prevState.pendingAsk
            && (this.state.pendingAsk == null
                || this.state.pendingAsk.id !== prevState.pendingAsk.id)) {
          window.tabBridge.notifyAskResolved({
            id: prevState.pendingAsk.id,
            tabId: this.props.ownTabId ?? null,
          });
        }
      } catch {}
    }
    // PTY plan transitions — bubble up so the global modal can render, AND notify the Electron main
    // process via tabBridge so it can flashFrame / setBadgeCount / fire OS Notification (parallel to
    // the server.js -> tab-worker process.send route used for ask).
    if (prevState.pendingPtyPlan !== this.state.pendingPtyPlan) {
      if (this.props.onPendingPtyPlan) {
        if (this.state.pendingPtyPlan) {
          this.props.onPendingPtyPlan({
            ptyPlan: this.state.pendingPtyPlan,
            handlers: {
              approve: this.handlePromptOptionClick,
              feedbackSubmit: this.handlePlanFeedbackSubmit,
            },
          });
        } else {
          this.props.onPendingPtyPlan(null);
        }
      }
      try {
        if (typeof window !== 'undefined' && window.tabBridge) {
          if (this.state.pendingPtyPlan) {
            window.tabBridge.notifyPtyPlanPending?.({
              id: this.state.pendingPtyPlan.id,
              payload: { projectName: this.props.projectName || '' },
              tabId: this.props.ownTabId ?? null,
            });
          } else if (prevState.pendingPtyPlan) {
            window.tabBridge.notifyPtyPlanResolved?.({
              id: prevState.pendingPtyPlan.id,
              tabId: this.props.ownTabId ?? null,
            });
          }
        }
      } catch {}
    }
    // 「Plan 自动审批」倒计时生命周期：新 plan 出现（id 变化）→ 启动倒计时；plan 消失/开关关闭 → 清理。
    // 守卫 planChanged||enableChanged 保证每次 CDU 只在相关变化时才介入，开销可忽略。
    {
      const curPlanId = this.state.pendingPtyPlan?.id ?? null;
      const prevPlanId = prevState.pendingPtyPlan?.id ?? null;
      const planChanged = prevPlanId !== curPlanId;
      const enableChanged = prevProps.planAutoApproveSeconds !== this.props.planAutoApproveSeconds;
      // plan 切换时清掉旧 id 的取消记录，避免 _planAutoCancelled 无界增长（同 _resolvedPlanIds 的清理思路）。
      if (planChanged && prevPlanId) this._planAutoCancelled.delete(prevPlanId);
      if (planChanged || enableChanged) {
        if (!curPlanId || !this.props.planAutoApproveSeconds) {
          this._clearPlanAutoApprove();
        } else if (planChanged) {
          this._clearPlanAutoApprove();
          this._startPlanAutoApprove(curPlanId);
        } else if (enableChanged && !this._planAutoTimer) {
          // 用户在 plan 已 pending 时把开关打开 → 补启动倒计时。
          this._startPlanAutoApprove(curPlanId);
        }
      }
    }
    // Last Response 出现/消失时，Footer 高度变化会导致 Virtuoso atBottom 误判，需要重新吸底
    if (useVirtuoso && prevState.lastResponseItems !== this.state.lastResponseItems && this.state.stickyBottom) {
      this._stickyController.startSmoothFollow(this._virtuosoScrollerEl);
    }
    // 同样：Live streaming overlay 变化时也要重新吸底（丝滑缓动，避免每个 chunk 画面硬跳）。
    // pin 锁在更早会话时（sessionUpperBoundTs != null），streaming 来自未展示的更新会话，不应抢滚动。
    if (prevProps.streamingLatest !== this.props.streamingLatest && this.state.stickyBottom && this.props.sessionUpperBoundTs == null) {
      const el = useVirtuoso ? this._virtuosoScrollerEl : this.containerRef.current;
      if (el) this._stickyController.startSmoothFollow(el);
    }
    // Streaming border fade-out: when isStreaming goes from true to false, trigger fade
    if (prevProps.isStreaming && !this.props.isStreaming) {
      this.setState({ streamingFading: true });
      clearTimeout(this._streamingFadeTimer);
      this._streamingFadeTimer = setTimeout(() => {
        this.setState({ streamingFading: false });
      }, 500);
      // 真实停止落地：清除乐观标志与兜底定时器（正常路径，先于 4s 兜底）
      if (this.state.stopOptimistic) this._clearStopOptimistic();
    }
    // 如果 streaming 在 fade-out 期间恢复，立即取消 fade 避免 spinner 以 opacity:0 显示
    if (!prevProps.isStreaming && this.props.isStreaming && this.state.streamingFading) {
      clearTimeout(this._streamingFadeTimer);
      this.setState({ streamingFading: false });
    }
    // 新一轮在「本端 handleInputSend 之外」发起（中断后队列消息自动续发 / 其他 client / 直接 PTY 键入）：
    // isStreaming 升起的上升沿即视为陈旧乐观标志失效，立即清除——否则 uiStreaming 会被旧 stopOptimistic
    // 压住，最长到 4s 兜底才恢复，期间无 spinner、无停止按钮。
    if (!prevProps.isStreaming && this.props.isStreaming && this.state.stopOptimistic) {
      this._clearStopOptimistic();
    }
    // Handle files dropped onto the app — add to pendingImages, send at submit time
    if (this.props.pendingUploadPaths && this.props.pendingUploadPaths.length > 0
      && this.props.pendingUploadPaths !== prevProps.pendingUploadPaths) {
      for (const p of this.props.pendingUploadPaths) {
        const raw = p.replace(/^"|"$/g, '');
        this._addPendingImage(raw, 'drop');
      }
      if (this.props.onUploadPathsConsumed) this.props.onUploadPathsConsumed();
    }
    // 拖拽上传在途占位:AppBase 在 _onDrop 里维护 uploadingDrop([{id,name,url}]),与 pendingUploadPaths
    // 同款 prop-diff 调谐进本端 uploadingItems(按 id 增删,移除时撤销 objectURL)。
    if (this.props.uploadingDrop !== prevProps.uploadingDrop) {
      const cur = this.props.uploadingDrop || [];
      const prevDrop = prevProps.uploadingDrop || [];
      const curIds = new Set(cur.map(d => d.id));
      for (const d of cur) {
        if (!this.state.uploadingItems.some(u => u.id === d.id)) {
          this._applyUploading({ type: 'add', item: { id: d.id, name: d.name, previewUrl: d.url } });
        }
      }
      for (const d of prevDrop) {
        if (!curIds.has(d.id)) this._applyUploading({ type: 'remove', id: d.id });
      }
    }
    // 缓发 drain:在途上传清零(且确为「从有到无」的下降沿)→ 自动重跑 handleInputSend(此时 pendingImages 已含路径)。
    // 超时已先把 _sendDeferred 置 false,故超时后才 resolve 不会触发偷偷重发。
    if (this._sendDeferred
      && this.state.uploadingItems.length === 0
      && prevState.uploadingItems.length > 0) {
      this._sendDeferred = false;
      clearTimeout(this._sendDeferTimer);
      this.setState({ sendDeferred: false }, () => {
        if (this._unmounted) return;
        this.handleInputSend();
      });
    }
    if (prevProps.mainAgentSessions !== this.props.mainAgentSessions) {
      // sessions 引用变化 → 仅在 session 对象真正变化时重置增量状态
      // Plan 1 的 push 模式下，外层数组是浅拷贝（新引用），但 session 对象不变 → 保留增量状态
      if (this.props.mainAgentSessions !== this._prevSessions) {
        const prev = this._prevSessions || [];
        const next = this.props.mainAgentSessions || [];
        const sessionsActuallyChanged = prev.length !== next.length ||
          prev.some((s, i) => s !== next[i]);
        if (sessionsActuallyChanged) {
          this._incToolState = null;
          this._incToolProcessedCount = 0;
          this._incToolSessionIdx = -1;
          this._reqScanCache = { tsToIndex: {}, modelName: null, completedModelName: null, modelNameByReqIdx: [], subAgentEntries: [], processedCount: 0, subAgentProcessedCount: 0, requestCacheTokenMap: new Map(), globalIndexState: createEmptyGlobalIndexState(), globalIndexProcessedCount: 0 };
          this._sessionItemCache = [];
          // 会话/工作区切换：清除乐观停止标志，避免陈旧 true 泄漏到新会话
          if (this.state.stopOptimistic) this._clearStopOptimistic();
        }
        this._prevSessions = this.props.mainAgentSessions;
      }
      // 会话/工作区切换：复位「加载更早」展开量，新会话从最近窗口开始（移动端+桌面端一致）
      this._mobileExtraItems = 0;
      this.startRender();
      if (this.state.pendingInput) {
        this.setState({ pendingInput: null });
      }
      this._clearPendingImages();
      this._updateSuggestion();
      this._toolFileMonitor.check();
    } else if (prevProps.requests !== this.props.requests) {
      // requests（filteredRequests）变化但 mainAgentSessions 未变 → 重建 tsToIndex 避免索引偏移
      this._reqScanCache.tsToIndex = {};
      this._reqScanCache.modelName = null;
      this._reqScanCache.completedModelName = null;
      this._reqScanCache.modelNameByReqIdx = [];
      this._reqScanCache.processedCount = 0;
      this._reqScanCache.subAgentEntries = [];
      this._reqScanCache.subAgentProcessedCount = 0;
      this._reqScanCache.requestCacheTokenMap = new Map();
      this._reqScanCache.globalIndexState = createEmptyGlobalIndexState();
      this._reqScanCache.globalIndexProcessedCount = 0;
      this.startRender();
      // subAgent / teammate 的 tool_result 只走 requests 路径（不进 mainAgentSessions），
      // 必须在这里也调一次刷新检查，否则它们的文件修改完全感知不到
      this._toolFileMonitor.check();
    } else if (prevProps.collapseToolResults !== this.props.collapseToolResults
            || prevProps.expandThinking !== this.props.expandThinking
            || prevProps.showFullToolContent !== this.props.showFullToolContent
            || prevProps.showThinkingSummaries !== this.props.showThinkingSummaries
            || prevProps.onlyCurrentSession !== this.props.onlyCurrentSession
            || prevProps.sessionUpperBoundTs !== this.props.sessionUpperBoundTs) {
      // 这些显示开关只改 buildAllItems 的输出，不改 mainAgentSessions/requests 引用，故上面两条增量
      // 分支不会触发。allItems 缓存在 state（render 读 state.allItems），必须在此显式重建，否则切换开关
      // 后 SCU 虽放行 re-render，画面仍是旧 allItems（[对话] 与派生它的 [用户 Prompt 导航] 都不刷新）。
      const rawItems = this.buildAllItems();
      const allItems = this._applyMobileSlice(rawItems);
      this.setState({ allItems, lastResponseItems: this._lastResponseItems, visibleCount: allItems.length });
    }
    // localAskAnswers 变化时重建 Last Response，使交互表单切换到已回答的静态视图
    if (prevState.localAskAnswers !== this.state.localAskAnswers &&
        prevProps.mainAgentSessions === this.props.mainAgentSessions &&
        prevProps.requests === this.props.requests) {
      this.startRender();
    }
    // scrollToTimestamp 变化时（如从 raw 模式切回 chat），重建 items 并滚动定位
    if (!prevProps.scrollToTimestamp && this.props.scrollToTimestamp) {
      // 跳转目标若落在被裁剪（未渲染）的更早区域，先展开 _mobileExtraItems 把它纳入可见窗口，
      // 否则跳转/搜索定位会失败。移动端与桌面端统一处理（桌面端启用渲染窗口裁剪后同样需要）。
      const rawItems = this.buildAllItems();
      const targetIdx = this._scrollTargetIdx;
      if (targetIdx != null) {
        const limit = ITEM_LIMIT + this._mobileExtraItems;
        const offset = rawItems.length > limit ? rawItems.length - limit : 0;
        if (targetIdx < offset) {
          this._mobileExtraItems = rawItems.length - targetIdx - ITEM_LIMIT;
          if (this._mobileExtraItems < 0) this._mobileExtraItems = 0;
        }
      }
      const allItems = this._applyMobileSlice(rawItems);
      this.setState({ allItems, lastResponseItems: this._lastResponseItems, visibleCount: allItems.length }, () => this.scrollToBottom());
    }
    // mobileChatVisible: scroll to bottom when becoming visible
    if (isMobile && this.props.mobileChatVisible && !prevProps.mobileChatVisible) {
      // 显式动作（面板切显示）：清除用户滚动窗口，贴底不被残留窗口抑制
      this._stickyController.resetUserScrollState();
      requestAnimationFrame(() => {
        if (this.virtuosoRef.current) {
          this.virtuosoRef.current.scrollToIndex({ index: 'LAST' });
        } else {
          const el = this.containerRef.current;
          if (el) this._stickyController.writeUnderLock(el, el.scrollHeight);
        }
      });
    }
    // 不再在此建立 ws — Provider 通过 props.open 派生(cliMode || terminalVisible)集中管理
    if (!useVirtuoso) this._stickyController.bind(this.containerRef.current);
    // logfile 只读模式：非虚拟化平台自动渐进扩窗（替代手工「加载更多」），每步 setState 后
    // 经本钩子接力调度下一步，直到 _mobileSliceOffset 归零。
    this._maybeScheduleLocalLogAutoFill();
  }

  componentWillUnmount() {
    this._unmounted = true;
    this._splitDrag.dispose();
    if (this._planAutoTimer) { clearInterval(this._planAutoTimer); this._planAutoTimer = null; }
    // 缓发超时 timer + 残留上传占位的 objectURL 清扫(卸载中 drain/超时回调已各自 _unmounted 守卫)。
    clearTimeout(this._sendDeferTimer);
    for (const u of (this.state.uploadingItems || [])) { if (u.previewUrl) { try { URL.revokeObjectURL(u.previewUrl); } catch {} } }
    // 清理全局审批/通知 — 切 session/关 tab 时让 modal 同步消失，main 进程 badge 归零
    if (this.props.onPendingPermission) this.props.onPendingPermission(null);
    if (this.props.onPendingPlanApproval) this.props.onPendingPlanApproval(null);
    if (this.props.onPendingAsk) this.props.onPendingAsk(null);
    if (this.props.onPendingPtyPlan) this.props.onPendingPtyPlan(null);
    try {
      if (this.state.pendingPtyPlan && typeof window !== 'undefined' && window.tabBridge?.notifyPtyPlanResolved) {
        window.tabBridge.notifyPtyPlanResolved({
          id: this.state.pendingPtyPlan.id,
          tabId: this.props.ownTabId ?? null,
        });
      }
      if (typeof window !== 'undefined' && window.tabBridge?.notifyAskResolved) {
        const tabId = this.props.ownTabId ?? null;
        if (this.state.pendingAsk) {
          try { window.tabBridge.notifyAskResolved({ id: this.state.pendingAsk.id, tabId }); } catch {}
        }
        // Drain queued asks too — Electron main keeps pendingByTab[tabId].ask as Map<id>,
        // so each must be removed individually or the badge / dock count goes stale.
        // Per-item try-catch：单条 IPC throw 不中断后续清理。
        for (const q of (this.state.askQueue || [])) {
          try { window.tabBridge.notifyAskResolved({ id: q.id, tabId }); } catch {}
        }
      }
    } catch {}
    if (this._queueTimer) clearTimeout(this._queueTimer);
    if (this._autoFillRafId) { cancelAnimationFrame(this._autoFillRafId); this._autoFillRafId = null; }
    this._ptyPrompt.dispose();
    this._toolFileMonitor.dispose();
    if (this._wsReconnectTimer) clearTimeout(this._wsReconnectTimer);
    if (this._planFeedbackTimer) clearTimeout(this._planFeedbackTimer);
    if (this._streamingFadeTimer) clearTimeout(this._streamingFadeTimer);
    if (this._stopOptimisticTimer) clearTimeout(this._stopOptimisticTimer);
    // ask 流计时器 / _pendingHookAnswers / _pendingCancelIds 的清理收口到控制器 dispose()
    this._askFlow.dispose();
    // ask-cancel ack 协议清理：_pendingFlushQueue 留在 ChatView（生产者 handleInputSend），
    // clearTimeout 所有 in-flight 500ms 兜底 timer，否则 unmount 后还会 fire → 被新 session 收到
    if (this._pendingFlushQueue) {
      for (const entry of this._pendingFlushQueue) clearTimeout(entry.tid);
      this._pendingFlushQueue.length = 0;
    }
    this._scrollHighlight.dispose();
    // 流式吸底统一清理：dispose 内会卸 RO + scroll listener + document touch + cancel 全部 rAF
    if (this._stickyController) this._stickyController.dispose();
    if (this._unsubWsHandler) { try { this._unsubWsHandler(); } catch {} this._unsubWsHandler = null; }
    if (this._unsubWsState) { try { this._unsubWsState(); } catch {} this._unsubWsState = null; }
  }

  startRender() {
    if (this._queueTimer) clearTimeout(this._queueTimer);

    const rawItems = this.buildAllItems();
    const lastResponseItems = this._lastResponseItems;
    const allItems = this._applyMobileSlice(rawItems);
    this._prevItemsLen = allItems.length;

    this.setState({ allItems, lastResponseItems, visibleCount: allItems.length, loading: false },
      () => {
        // (a) 跳转语义优先（scrollToTimestamp / _scrollTargetIdx）
        if (this._scrollTargetIdx != null || this.props.scrollToTimestamp) {
          this.scrollToBottom();
          return;
        }
        // (b) sticky 时同步写到底（避免 React 18 batched commit 后一帧"先看顶后瞬移"）
        // 先 refreshFollowTarget 复用一次 forced layout，writeUnderLock 直接用缓存值（修补 1）
        // 用户滚动窗口内不硬贴底（用户意志优先，停手终判会补追）
        if (this.state.stickyBottom && !this._stickyController.isUserScrolling()) {
          const el = useVirtuoso ? this._virtuosoScrollerEl : this.containerRef.current;
          if (el) {
            this._stickyController.refreshFollowTarget(el);
            this._stickyController.writeUnderLock(el, el.scrollHeight);
          }
        }
      });
  }

  queueNext(current, total) {
    if (current >= total) return;
    this._queueTimer = setTimeout(() => {
      this.setState({ visibleCount: current + 1 }, () => {
        this.scrollToBottom();
        this.queueNext(current + 1, total);
      });
    }, randomInterval());
  }

  _isNearBottom() {
    const el = this.containerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= 30;
  }

  // 保留方法名（queueNext L759 仍在调）；常规吸底与跳转分流，常规吸底走 controller.writeUnderLock
  scrollToBottom() {
    // 单点守卫：用户滚动窗口内常规吸底分支全部停摆（含 Virtuoso scrollToIndex 兜底），
    // 跳转分支（scrollToTimestamp）不受影响
    const shouldStick = this.state.stickyBottom && !this._stickyController.isUserScrolling();
    // scrollToTimestamp 的目标不在当前渲染集合内（典型：被「仅展示当前会话」隐藏到更早 session —
    // tsItemMap 不含该 ts → _scrollTargetIdx 为 null、目标 ref 也未绑定）：下面两个平台跳转分支都不会
    // 命中，父层 chatScrollToTs 便永远清不掉，后续对任意 ts 的跳转全部失效。这里兜底清除该请求
    // （不跳转，继续按常规吸底渲染当前会话）。
    if (this.props.scrollToTimestamp && this._scrollTargetIdx == null && !this._scrollTargetRef.current) {
      if (this.props.onScrollTsDone) this.props.onScrollTsDone();
    }
    // 移动端 Virtuoso：跳转分支
    if (useVirtuoso && this.virtuosoRef.current) {
      if (this._scrollTargetIdx != null) {
        this.virtuosoRef.current.scrollToIndex({ index: this._scrollTargetIdx, align: 'center' });
        const targetTs = this.props.scrollToTimestamp;
        this._scrollTargetRef = React.createRef();
        if (targetTs) {
          this.setState({ highlightTs: targetTs, highlightFading: false });
          this._scrollHighlight.bind();
        }
        if (this.props.onScrollTsDone) this.props.onScrollTsDone();
        return;
      }
      if (shouldStick) {
        const scroller = this._virtuosoScrollerEl;
        if (scroller) {
          this._stickyController.writeUnderLock(scroller, scroller.scrollHeight);
        } else {
          this.virtuosoRef.current.scrollToIndex({ index: 'LAST', behavior: 'auto' });
        }
      }
      return;
    }
    // 桌面端/iPad/iPhone：scrollToTimestamp 跳转分支
    if (this._scrollTargetRef.current && this.props.scrollToTimestamp) {
      const targetEl = this._scrollTargetRef.current;
      const container = this.containerRef.current;
      if (container && targetEl.offsetHeight > container.clientHeight) {
        targetEl.scrollIntoView({ block: 'start', behavior: 'instant' });
      } else {
        targetEl.scrollIntoView({ block: 'center', behavior: 'instant' });
      }
      const targetTs = this.props.scrollToTimestamp;
      this._scrollTargetRef = React.createRef();
      if (targetTs) {
        this.setState({ highlightTs: targetTs, highlightFading: false });
        this._scrollHighlight.bind();
      }
      if (this.props.onScrollTsDone) this.props.onScrollTsDone();
      return;
    }
    // 常规吸底：走 controller writeUnderLock（lock 引用计数 + 防 onScroll 翻 sticky）
    if (shouldStick) {
      const el = this.containerRef.current;
      if (el) this._stickyController.writeUnderLock(el, el.scrollHeight);
    }
  }

  // 流式吸底状态机已收敛进 src/utils/stickyBottomController.js（StickyBottomController 实例）：
  //   - bind/unbind/dispose、scroll/RO 监听、引用计数 lock、双 rAF 缓动、用户滚动意图暂停窗口、决策去重
  //   - notifyAtBottom（Virtuoso 接管）、suppressOnce（handleLoadMore 用）、writeUnderLock（唯一写入）
  // 本类仅持 controller 实例（this._stickyController），所有 scrollTop 写入走 controller.writeUnderLock。

  // 稳定引用:传给被 AppHeader.renderTokenStats 缓存的 <ToolsHelp closeParent>,
  // 避免每次渲染新建闭包导致缓存子树持有过期引用(memo key 不含 closeParent)。
  _closeTokenStatsPopover = () => this.setState({ tokenStatsPopoverOpen: false });

  handleStickToBottom = () => {
    // 显式动作清除用户滚动窗口：在 setState 之前同步调，让 userScrolling:false 与
    // stickyBottom:true 同一 React 批次 commit，followOutput 不出现中间帧
    this._stickyController.resetUserScrollState();
    this.setState({ stickyBottom: true }, () => {
      if (useVirtuoso && this.virtuosoRef.current) {
        this.virtuosoRef.current.scrollToIndex({ index: 'LAST', behavior: 'smooth' });
      } else {
        const el = this.containerRef.current;
        if (el) this._stickyController.writeUnderLock(el, el.scrollHeight);
      }
    });
  };

  _addPendingImage = (path, source) => {
    if (!path) return;
    this.setState(prev => {
      if (prev.pendingImages.length >= 20) return null; // cap
      if (prev.pendingImages.some(img => img.path === path)) return null; // dedup
      return { pendingImages: [...prev.pendingImages, { path, source }] };
    });
  };

  _removePendingImage = (index) => {
    this.setState(prev => {
      const img = prev.pendingImages[index];
      if (!img) return null;
      const next = prev.pendingImages.filter((_, i) => i !== index);
      // Notify other clients to remove the same file
      if (img.path && this._inputWs && this._inputWs.readyState === WebSocket.OPEN) {
        this._inputWs.send(JSON.stringify({ type: 'image-remove-notify', path: img.path }));
      }
      return { pendingImages: next };
    });
  };

  _clearPendingImages = () => {
    if (this.state.pendingImages.length > 0) {
      this.setState({ pendingImages: [] });
    }
  };

  // ===== 上传在途占位 + 缓发(defer) =====
  // 上传一开始(ChatInputBar 粘贴/选图、AppBase 拖拽)就登记占位,resolve/reject 时撤销;
  // 撤销 objectURL 的副作用由本方法执行(reduceUploading 只计算需 revoke 的 url 列表)。
  _applyUploading = (action) => {
    this.setState(prev => {
      const { next, revoke } = reduceUploading(prev.uploadingItems, action);
      if (next === prev.uploadingItems) return null;
      for (const url of revoke) { try { URL.revokeObjectURL(url); } catch {} }
      return { uploadingItems: next };
    });
  };

  // ChatInputBar 上传开始/结束回调(选图 + 粘贴)。onUploadEnd 的 path 仅用于配对结束,
  // 真正落 pendingImages 仍走既有 onUploadPath→handleUploadPath(保持广播 image-upload-notify)。
  handleUploadStart = (id, name, previewUrl) => this._applyUploading({ type: 'add', item: { id, name, previewUrl } });
  handleUploadEnd = (id) => this._applyUploading({ type: 'remove', id });

  // 缓发:有上传在途时被调用。幂等(挡双 Enter / IME 合成结束双触发);10s 超时兜底只提示、不发纯文字。
  _deferSend = () => {
    if (this._sendDeferred) return;
    this._sendDeferred = true;
    this.setState({ sendDeferred: true });
    clearTimeout(this._sendDeferTimer);
    this._sendDeferTimer = setTimeout(() => {
      if (this._unmounted || !this._sendDeferred) return;
      this._sendDeferred = false;
      this.setState({ sendDeferred: false });
      message.error(t('ui.chatInput.uploadTimeout'));
    }, UPLOAD_DEFER_TIMEOUT_MS);
  };

  _clearDeferSend = () => {
    if (!this._sendDeferred && !this.state.sendDeferred) return;
    this._sendDeferred = false;
    clearTimeout(this._sendDeferTimer);
    this.setState({ sendDeferred: false });
  };

  // logfile 只读模式（非虚拟化平台：桌面/iOS/iPad）自动渐进扩窗——替代手工点击「加载更多」。
  // 每个 rAF 帧执行一步 handleLoadMore（帧间让出主线程给绘制/输入，避免单次全量挂 DOM 的长任务卡死，
  // 见 DESKTOP_ITEM_LIMIT 注释），沿用其滚动补偿保持视口稳定；componentDidUpdate 接力续步直到全量渲染完成。
  _maybeScheduleLocalLogAutoFill() {
    if (!this.props.isLocalLog || useVirtuoso) return;
    if (this._mobileSliceOffset <= 0 || this._autoFillRafId || this._unmounted) return;
    this._autoFillRafId = requestAnimationFrame(() => {
      this._autoFillRafId = null;
      if (this._unmounted || this._mobileSliceOffset <= 0) return;
      this.handleLoadMore();
    });
  }

  handleLoadMore = () => {
    this._mobileExtraItems += MOBILE_LOAD_MORE_STEP;
    const prevLen = this.state.allItems?.length || 0;
    const rawItems = this.buildAllItems();
    const allItems = this._applyMobileSlice(rawItems);
    const addedCount = allItems.length - prevLen;
    if (useVirtuoso && this.virtuosoRef.current) {
      this.setState({ allItems, lastResponseItems: this._lastResponseItems, visibleCount: allItems.length }, () => {
        if (this.virtuosoRef.current && addedCount > 0) {
          this.virtuosoRef.current.scrollToIndex({ index: addedCount, align: 'start' });
        }
      });
    } else {
      const el = this.containerRef.current;
      const prevScrollHeight = el ? el.scrollHeight : 0;
      const prevScrollTop = el ? el.scrollTop : 0;
      this.setState({ allItems, lastResponseItems: this._lastResponseItems, visibleCount: allItems.length }, () => {
        if (el) {
          // suppressOnce：随后 RO fire（DOM 长高）期间锁短路，防止"维持位置"被吸底覆盖
          this._stickyController.suppressOnce();
          const newScrollHeight = el.scrollHeight;
          el.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight);
        }
      });
    }
  };

  _getScrollContainer() {
    return useVirtuoso ? this._virtuosoScrollerEl : this.containerRef.current;
  }


  // 派生 per-keyPrefix 的 _mergedAskAnswerMap：cached.askAnswerMap 是原地 mutate 的，引用永远不变；
  // 用 _askDirty + localAsk 引用 + 上一轮 cache 引用做三信号失效判断。
  // localAsk（用户乐观更新缓存）每次提交都换新引用，要并入失效信号，否则用户答题后到 server ack 之间 UI 会闪回 pending。
  // 永远 spread 创建新引用，让下游 ChatMessage SCU 检测到 askAnswerMap 变化（修老 bug：local 空时复用 cached 引用导致 SCU 不命中）。
  _getMergedAskAnswerMap(messages, keyPrefix, localAsk) {
    const cached = getToolResultCache(messages);
    const askMap = cached?.askAnswerMap || EMPTY_MAP;
    const askDirty = cached?._askDirty || 0;
    if (!this._mergedAskAnswerMapByKey) this._mergedAskAnswerMapByKey = {};
    if (!this._prevAskCacheByKey) this._prevAskCacheByKey = {};
    if (!this._prevAskDirtyByKey) this._prevAskDirtyByKey = {};
    if (!this._prevAskLocalByKey) this._prevAskLocalByKey = {};
    if (this._prevAskCacheByKey[keyPrefix] !== askMap
        || this._prevAskDirtyByKey[keyPrefix] !== askDirty
        || this._prevAskLocalByKey[keyPrefix] !== localAsk) {
      const hasLocal = localAsk && Object.keys(localAsk).length > 0;
      this._mergedAskAnswerMapByKey[keyPrefix] = hasLocal
        ? { ...askMap, ...localAsk }
        : { ...askMap };
      this._prevAskCacheByKey[keyPrefix] = askMap;
      this._prevAskDirtyByKey[keyPrefix] = askDirty;
      this._prevAskLocalByKey[keyPrefix] = localAsk;
    }
    return this._mergedAskAnswerMapByKey[keyPrefix];
  }

  // 派生 per-session 的 _mergedPlanApprovalMap：cached.planApprovalMap 是原地 mutate 的，引用永远不变；
  // 用 _planDirty + 上一轮 cache 引用做失效判断，每次内容变化时创建一个新引用 {} 覆盖。
  // keyPrefix 区分 main session（s${si}）vs sub-agent（tm${si}），避免互相覆盖。
  // FULL HIT 路径（_sessionItemCache 命中）和内部 renderSessionMessages 都调用此方法，引用保持一致。
  _getMergedPlanApprovalMap(messages, keyPrefix) {
    const cached = getToolResultCache(messages);
    if (!cached) return EMPTY_MAP;
    const planDirty = cached._planDirty || 0;
    if (!this._mergedPlanApprovalMapByKey) this._mergedPlanApprovalMapByKey = {};
    if (!this._prevPlanCacheByKey) this._prevPlanCacheByKey = {};
    if (!this._prevPlanDirtyByKey) this._prevPlanDirtyByKey = {};
    if (this._prevPlanCacheByKey[keyPrefix] !== cached.planApprovalMap
        || this._prevPlanDirtyByKey[keyPrefix] !== planDirty) {
      this._mergedPlanApprovalMapByKey[keyPrefix] = { ...cached.planApprovalMap };
      this._prevPlanCacheByKey[keyPrefix] = cached.planApprovalMap;
      this._prevPlanDirtyByKey[keyPrefix] = planDirty;
    }
    return this._mergedPlanApprovalMapByKey[keyPrefix];
  }

  // 浏览本地历史日志时为 true；CLI / SDK 实时会话为 false。
  // 用作 ChatMessage 的 isHistoryLog prop，控制时间戳 compact 显示。
  _getIsHistoryLog() {
    return !this.props.cliMode && !this.props.sdkMode;
  }

  // teammateIdentity: only set by _buildTeammateFallbackItems (teammate session
  // logs). Assistant rows then carry the TEAMMATE's identity (label + portrait
  // via ChatMessage's teammate branch) instead of the model identity — a model
  // logo + model name on those rows reads as the MainAgent speaking in the
  // teammate's own log. animateAvatar:false keeps a long historic transcript
  // from mass-playing draw-ins (the fallback path returns before the
  // avatar-animation post-pass, and raw body.messages carry no timestamps).
  renderSessionMessages(messages, keyPrefix, resolveModelInfo, tsToIndex, requestCacheTokenMap, startIdx = 0, teammateIdentity = null) {
    const { userProfile, collapseToolResults, expandThinking, showFullToolContent, showThinkingSummaries, onViewRequest } = this.props;
    const isHistoryLog = this._getIsHistoryLog();
    // 增量 / WeakMap 缓存
    let cached = getToolResultCache(messages);
    if (cached && messages.length > this._incToolProcessedCount) {
      // WeakMap 命中但 messages 增长了（push 模式增量追加）→ 只处理新增消息的 tool 映射
      appendToolResultMap(cached, messages, this._incToolProcessedCount);
      this._incToolProcessedCount = messages.length;
    }
    if (!cached) {
      const si = parseInt(keyPrefix.slice(1), 10);
      if (this._incToolSessionIdx === si && messages.length >= this._incToolProcessedCount && this._incToolProcessedCount > 0) {
        appendToolResultMap(this._incToolState, messages, this._incToolProcessedCount);
      } else {
        this._incToolState = createEmptyToolState();
        appendToolResultMap(this._incToolState, messages, 0);
        this._incToolSessionIdx = si;
      }
      this._incToolProcessedCount = messages.length;
      cached = this._incToolState;
      setToolResultCache(messages, cached);
    }
    const { toolUseMap, toolResultMap, readContentMap, editSnapshotMap, askAnswerMap, latestPlanContent } = cached;
    // planApprovalMap 派生统一走 _getMergedPlanApprovalMap（per keyPrefix），保证 FULL HIT 路径与 cache miss 路径
    // 拿到同一引用，prop diff 才能正确触发 ExitPlanMode 卡片重渲。
    const planApprovalMap = this._getMergedPlanApprovalMap(messages, keyPrefix);

    const activePlanPrompt = this.props.cliMode
      ? this.state.ptyPromptHistory.slice().reverse().find(p => isPlanApprovalPrompt(p) && p.status === 'active') || null
      : null;
    const activeDangerousPrompt = this.props.cliMode && !(this.state.pendingPermission?.source === 'pty')
      ? this.state.ptyPromptHistory.slice().reverse().find(p => isDangerousOperationPrompt(p) && p.status === 'active') || null
      : null;

    // 合并 localAskAnswers 到历史 askAnswerMap，使提交后立即显示已回答。
    // 派生统一走 _getMergedAskAnswerMap（per keyPrefix），保证 FULL HIT 路径与 cache miss 路径
    // 拿到同一引用，prop diff 才能正确触发 AskUserQuestion 卡片重渲。
    const _localAsk = this.state.localAskAnswers || {};
    const mergedAskAnswerMap = this._getMergedAskAnswerMap(messages, keyPrefix, _localAsk);
    // Pending ask/plan arbitration is centralized in interactionOwnership.js
    // (last-assistant-only rule + owner-index locking so exactly one bubble
    // gets the pending id). MERGED maps by design — see the module header.
    // (A dead full-history historyAskIds scan that lived here was removed —
    // it was filled but never read; the LR block builds its own sets.)
    const _pending = computeMessagesPending({ messages, planApprovalMap, askAnswerMap: mergedAskAnswerMap });
    let lastPendingAskId = _pending.lastPendingAskId;
    let lastPendingPlanId = _pending.lastPendingPlanId;
    const lastPendingAskOwnerIdx = _pending.askOwnerIdx;
    const lastPendingPlanOwnerIdx = _pending.planOwnerIdx;

    const renderedMessages = [];

    for (let mi = startIdx; mi < messages.length; mi++) {
      const msg = messages[mi];
      const content = msg.content;
      const ts = msg._timestamp || null;  // carrier ts —— timestamp prop / resolveModelInfo / SubAgent 时间排序用
      // lookupTs：assistant 用 _generatedTs（producer 的 request ts），其他 role 用 _timestamp（即 carrier）。
      // 让 "查看请求" 按钮跳到真正产出该 bubble 内容的 mainAgent request，而不是下一次 carrier。
      const lookupTs = resolveBubbleProducerTs(msg);
      const reqIdx = lookupTs ? tsToIndex[lookupTs] : undefined;
      // cacheTotalTokens 仅传给 assistant 渲染处，避免 user 消息也接到该 prop 触发 SCU streaming 期间的虚假重渲。
      const cacheTotalTokens = reqIdx != null
        ? (requestCacheTokenMap?.get(reqIdx) ?? 0)
        : null;
      const hasViewRequest = reqIdx != null && onViewRequest;
      const modelInfo = resolveModelInfo(ts, msg.role);

      if (msg.role === 'user') {
        if (Array.isArray(content)) {
          const suggestionText = content.find(b => b.type === 'text' && /^\[SUGGESTION MODE:/i.test((b.text || '').trim()));
          const toolResults = content.filter(b => b.type === 'tool_result');

          if (suggestionText && toolResults.length > 0) {
            // AskUserQuestion 的用户回复：跳过渲染（答案已在 assistant 侧问卷卡片上显示）
          } else {
            const { commands, textBlocks, skillBlocks, teammateBlocks, taskNotificationBlocks } = classifyUserContent(content);
            // 渲染 slash command 作为独立用户输入
            for (let ci = 0; ci < commands.length; ci++) {
              renderedMessages.push(
                <ChatMessage key={`${keyPrefix}-cmd-${mi}-${ci}`} role="user" text={commands[ci]} lang={this.props.lang} timestamp={ts} userProfile={userProfile} modelInfo={modelInfo} requestIndex={hasViewRequest ? reqIdx : undefined} onViewRequest={hasViewRequest ? onViewRequest : undefined} isHistoryLog={isHistoryLog} />
              );
            }
            // 渲染 skill 加载块
            for (const sb of skillBlocks) {
              const nameMatch = sb.text.match(/^#\s+(.+)$/m);
              const skillName = nameMatch ? nameMatch[1] : 'Skill';
              renderedMessages.push(
                <ChatMessage key={`${keyPrefix}-skill-${mi}`} role="skill-loaded" text={sb.text} skillName={skillName} timestamp={ts} requestIndex={hasViewRequest ? reqIdx : undefined} onViewRequest={hasViewRequest ? onViewRequest : undefined} isHistoryLog={isHistoryLog} />
              );
            }
            // 渲染普通用户文本块
            for (let ti = 0; ti < textBlocks.length; ti++) {
              const isPlan = /Implement the following plan:/i.test(textBlocks[ti].text || '');
              renderedMessages.push(
                <ChatMessage key={`${keyPrefix}-user-${mi}-${ti}`} role={isPlan ? 'plan-prompt' : 'user'} text={textBlocks[ti].text} lang={this.props.lang} timestamp={ts} userProfile={userProfile} modelInfo={modelInfo} requestIndex={hasViewRequest ? reqIdx : undefined} onViewRequest={hasViewRequest ? onViewRequest : undefined} isHistoryLog={isHistoryLog} />
              );
            }
            // 渲染 teammate-message 块
            for (let tmi = 0; tmi < teammateBlocks.length; tmi++) {
              const tm = teammateBlocks[tmi];
              renderedMessages.push(
                <ChatMessage
                  key={`${keyPrefix}-teammate-${mi}-${tmi}`}
                  role={tm.status ? 'teammate-status' : 'teammate-message'}
                  text={tm.content}
                  label={tm.status ? (tm.statusFrom || tm.id) : tm.id}
                  toolName={tm.status || null}
                  timestamp={ts}
                  modelInfo={modelInfo}
                  requestIndex={hasViewRequest ? reqIdx : undefined}
                  onViewRequest={hasViewRequest ? onViewRequest : undefined}
                  isHistoryLog={isHistoryLog}
                />
              );
            }
            // 渲染 task-notification 块
            for (let tni = 0; tni < taskNotificationBlocks.length; tni++) {
              const tn = taskNotificationBlocks[tni];
              renderedMessages.push(
                <ChatMessage
                  key={`${keyPrefix}-tasknotif-${mi}-${tni}`}
                  role="task-notification"
                  taskNotification={tn}
                  timestamp={ts}
                  modelInfo={modelInfo}
                  requestIndex={hasViewRequest ? reqIdx : undefined}
                  onViewRequest={hasViewRequest ? onViewRequest : undefined}
                  isHistoryLog={isHistoryLog}
                />
              );
            }
          }
        } else if (typeof content === 'string') {
          // 复用 classifyUserContent 解析 task-notification（避免重复正则）
          if (/<task-notification>/i.test(content)) {
            const { taskNotificationBlocks: strTnBlocks } = classifyUserContent([{ type: 'text', text: content }]);
            for (let tni = 0; tni < strTnBlocks.length; tni++) {
              renderedMessages.push(
                <ChatMessage
                  key={`${keyPrefix}-tasknotif-str-${mi}-${tni}`}
                  role="task-notification"
                  taskNotification={strTnBlocks[tni]}
                  timestamp={ts}
                  modelInfo={modelInfo}
                  requestIndex={hasViewRequest ? reqIdx : undefined}
                  onViewRequest={hasViewRequest ? onViewRequest : undefined}
                  isHistoryLog={isHistoryLog}
                />
              );
            }
          } else {
            const dispText = extractDisplayText(content);
            if (dispText) {
              const isPlan = /Implement the following plan:/i.test(dispText);
              renderedMessages.push(
                <ChatMessage key={`${keyPrefix}-user-${mi}`} role={isPlan ? 'plan-prompt' : 'user'} text={dispText} lang={this.props.lang} timestamp={ts} userProfile={userProfile} modelInfo={modelInfo} requestIndex={hasViewRequest ? reqIdx : undefined} onViewRequest={hasViewRequest ? onViewRequest : undefined} isHistoryLog={isHistoryLog} />
              );
            }
          }
        }
      } else if (msg.role === 'assistant') {
        // 定向传递 lastPendingAskId/PlanId：只传给"owner message"（即 streaming 中最新一份），
        // 避免同 toolId 出现在多条 message 时让多个 ChatMessage 都进 isInteractive 路径并双重 portal
        const msgLastAskId = (mi === lastPendingAskOwnerIdx) ? lastPendingAskId : null;
        const msgLastPlanId = (mi === lastPendingPlanOwnerIdx) ? lastPendingPlanId : null;
        // Normalize the two content shapes into one block list (null → skip):
        // array content drops system-text blocks (e.g. SUGGESTION MODE); string
        // content renders only if text survives chrome-stripping.
        let asstContent = null;
        if (Array.isArray(content)) {
          const filteredContent = content.filter(block =>
            block.type !== 'text' || !isSystemText(block.text)
          );
          if (filteredContent.length > 0) asstContent = filteredContent;
        } else if (typeof content === 'string') {
          const dispText = extractDisplayText(content);
          if (dispText) asstContent = [{ type: 'text', text: dispText }];
        }
        if (asstContent) {
          renderedMessages.push(
            <ChatMessage key={`${keyPrefix}-asst-${mi}`} role="assistant" isTeammate={teammateIdentity ? true : undefined} label={teammateIdentity?.label} animateAvatar={teammateIdentity ? false : undefined} content={asstContent} toolResultMap={toolResultMap} readContentMap={readContentMap} editSnapshotMap={editSnapshotMap} askAnswerMap={mergedAskAnswerMap} planApprovalMap={planApprovalMap} latestPlanContent={latestPlanContent} planFileContents={this.state.planFileContents} timestamp={ts} displayTs={msg._generatedTs} modelInfo={modelInfo} collapseToolResults={collapseToolResults} expandThinking={expandThinking} showFullToolContent={showFullToolContent} showThinkingSummaries={showThinkingSummaries} ptyPrompt={this.state.ptyPrompt} activePlanPrompt={activePlanPrompt} activePtyPlanId={this.state.pendingPtyPlan?.id ?? null} planAutoApproveCountdown={this.state.planAutoApproveCountdown} onCancelPlanAutoApprove={this.cancelPlanAutoApprove} activeDangerousPrompt={activeDangerousPrompt} lastPendingPlanId={msgLastPlanId} lastPendingAskId={msgLastAskId} onPlanApprovalClick={this.handlePromptOptionClick} onPlanFeedbackSubmit={this.handlePlanFeedbackSubmit} onDangerousApprovalClick={this.handlePromptOptionClick} onAskQuestionSubmit={this.handleAskQuestionSubmit} onAskQuestionCancel={this.handleAskCancel} pendingAsk={this.state.pendingAsk} askMetaMap={this.state.askMetaMap} cliMode={this.props.cliMode} onOpenFile={this.handleOpenToolFilePath} cacheTotalTokens={cacheTotalTokens} requestIndex={hasViewRequest ? reqIdx : undefined} onViewRequest={hasViewRequest ? onViewRequest : undefined} isHistoryLog={isHistoryLog} />
          );
        }
      } else if (msg.role === 'system') {
        // Mid-conversation system messages (mid-conversation-system beta): plain string
        // content (task reminders, "Exited Plan Mode", ...). Rendered verbatim — do NOT
        // route through extractDisplayText/isSystemText, they would swallow the text.
        let sysText = '';
        if (typeof content === 'string') {
          sysText = content;
        } else if (Array.isArray(content)) {
          sysText = content.filter(b => b?.type === 'text' && b.text).map(b => b.text).join('\n\n');
        }
        if (sysText.trim()) {
          renderedMessages.push(
            <ChatMessage key={`${keyPrefix}-sys-${mi}`} role="system" text={sysText} timestamp={ts} requestIndex={hasViewRequest ? reqIdx : undefined} onViewRequest={hasViewRequest ? onViewRequest : undefined} isHistoryLog={isHistoryLog} />
          );
        }
      }
    }

    // ownerInRange：owner-idx 是否落在本轮渲染的范围（>= startIdx）；
    // 增量路径上层据此判断旧 sc.items 里 stale 的 lastPendingAskId/PlanId 是否需要清空。
    const askOwnerInRange = lastPendingAskOwnerIdx >= startIdx;
    const planOwnerInRange = lastPendingPlanOwnerIdx >= startIdx;
    return { items: renderedMessages, lastPendingAskId, lastPendingPlanId, askOwnerInRange, planOwnerInRange };
  }

  /**
   * Fallback: 当 mainAgentSessions 为空时，从 requests 中提取 teammate entries 渲染。
   * 解决 JSONL 截断后只剩 teammate entries 导致界面空白的问题。
   */
  _buildTeammateFallbackItems() {
    const { requests, collapseToolResults, expandThinking, showFullToolContent, onViewRequest } = this.props;
    const isHistoryLog = this._getIsHistoryLog();
    if (!requests || requests.length === 0) return [];

    // Teammate 名称解析
    resolveTeammateNames(requests);
    // 按 teammate 名称分组，保持时间顺序，取最后一条（最完整）的 messages
    const teammateMap = new Map(); // name → { messages, response, timestamp }
    for (const req of requests) {
      if (!isTeammate(req) || !req.body?.messages?.length) continue;
      const name = req.teammate || 'teammate';
      const existing = teammateMap.get(name);
      // 同名 teammate 后到的 entry messages 更完整（增量累积），取最后一条
      if (!existing || req.body.messages.length >= existing.messages.length) {
        teammateMap.set(name, {
          messages: req.body.messages,
          response: req.response,
          timestamp: req.timestamp,
          model: getEffectiveModel(req),
        });
      }
    }

    if (teammateMap.size === 0) return [];

    const allItems = [];
    let si = 0;
    for (const [name, session] of teammateMap) {
      allItems.push(
        <Divider key={`tm-div-${si}`} className={styles.sessionDivider}>
          <Text className={styles.sessionDividerText}>{name}</Text>
        </Divider>
      );
      // Assistant rows carry the TEAMMATE's identity: label (name + model
      // short-name via formatTeammateLabel) and teammate portrait, rendered by
      // ChatMessage's assistant teammate branch. modelInfo is supplied only as
      // the label fallback — rendering the model logo/name directly made these
      // rows read as the MainAgent speaking in the teammate's own log.
      // (Replaces both the v1.6.171 null resolver, which showed "MainAgent"
      // everywhere, and the first fix iteration, which showed model identity.)
      // Raw body.messages carry no _timestamp, so the resolver ignores ts.
      const tmModelInfo = getModelInfo(session.model);
      const tmModelResolver = (ts, role) => (role === 'assistant' ? tmModelInfo : null);
      const tmLabel = formatTeammateLabel(name, session.model);
      const { items: msgs } = this.renderSessionMessages(session.messages, `tm${si}`, tmModelResolver, {}, this._reqScanCache.requestCacheTokenMap, 0, { label: tmLabel });
      allItems.push(...msgs);

      // 渲染 response content（如果有）
      if (si === teammateMap.size - 1 && session.response?.body?.content) {
        const respContent = session.response.body.content;
        if (Array.isArray(respContent)) {
          const lastItems = respContent
            .filter(b => b.type === 'text' && b.text)
            .map((b, bi) => (
              <ChatMessage key={`tm-resp-${si}-${bi}`} role="assistant" isTeammate label={tmLabel} animateAvatar={false} content={[b]} timestamp={session.timestamp} modelInfo={tmModelInfo} collapseToolResults={collapseToolResults} expandThinking={expandThinking} showFullToolContent={showFullToolContent} onViewRequest={onViewRequest} onOpenFile={this.handleOpenToolFilePath} isHistoryLog={isHistoryLog} />
            ));
          if (lastItems.length > 0) {
            this._lastResponseItems = lastItems;
          }
        }
      }
      si++;
    }

    return allItems;
  }

  buildAllItems() {
    const { mainAgentSessions, requests, collapseToolResults, expandThinking, showFullToolContent, onlyCurrentSession, onViewRequest } = this.props;
    const isHistoryLog = this._getIsHistoryLog();
    this._lastResponseItems = null;
    this._lastResponseAskQuestions = null;
    if (!mainAgentSessions || mainAgentSessions.length === 0) {
      // Fallback: 无 MainAgent 时，从 requests 提取 teammate entries 渲染其对话历史，
      // 避免 JSONL 截断只剩 teammate 时界面完全空白。
      this._currentLastPendingPlanId = null;
      return this._buildTeammateFallbackItems();
    }

    // 增量扫描 requests（tsToIndex + modelName 增量，subAgentEntries 可按需全量重扫）
    const cache = this._reqScanCache;
    if (requests) {
      // Identity guard: a mid-array INSERTION (an in-flight producer turn
      // completing enters the filtered array below the cursor) shifts every
      // index after it — the incremental scan would then build stale
      // tsToIndex/modelNameByReqIdx and subAgentEntries with wrong
      // requestIndex values, and the inserted turn's own row would never be
      // built. Detect via object identity of the last-scanned request and
      // force a full rescan. Accepted residual: a mid-array REPLACEMENT with
      // an unchanged element at processedCount-1 does not fire the guard —
      // worst case a stale token badge, not the identity bug.
      const fullRescan = needsFullReqRescan(requests, cache.processedCount, cache.lastScannedReq);
      // tsToIndex / modelName: 只追加不修改，增量扫描
      const startIdx = (!fullRescan && requests.length >= cache.processedCount) ? cache.processedCount : 0;
      if (startIdx === 0) {
        cache.tsToIndex = {};
        cache.modelName = null;
        cache.completedModelName = null;
        cache.modelNameByReqIdx = [];
        cache.requestCacheTokenMap = new Map();
        cache.subAgentEntries = [];
        cache.subAgentProcessedCount = 0;
        cache.globalIndexState = createEmptyGlobalIndexState();
        cache.globalIndexProcessedCount = 0;
      }
      // carry-over 初值：从上轮末态继承，保证流式追加时非 MainAgent 或无 body.model 的 req 也能拿到"最近活跃模型"
      let lastModelName = cache.modelName;
      for (let i = startIdx; i < requests.length; i++) {
        const req = requests[i];
        const ma = isMainAgent(req);
        if (ma && req.timestamp) {
          cache.tsToIndex[req.timestamp] = i;
        }
        const effectiveModel = getEffectiveModel(req);
        if (ma && effectiveModel) {
          lastModelName = effectiveModel;
          cache.modelName = lastModelName;
          // 只在 response 已到达时更新 completedModelName。
          // 流式进行中的 request 尚无 response，不应污染"上一次已完成的模型"。
          if (req.response) cache.completedModelName = lastModelName;
        }
        cache.modelNameByReqIdx[i] = lastModelName;
        // 上下文 token 总量（cache_read + cache_creation），用于在 assistant
        // 消息时间戳旁显示。usage 仅在 response 到达后存在；流式中保持 0。
        const usage = req?.response?.body?.usage;
        if (usage) {
          const total = (usage.cache_read_input_tokens || 0)
                      + (usage.cache_creation_input_tokens || 0);
          cache.requestCacheTokenMap.set(i, total);
        } else {
          // streaming 中或失败的请求：删除可能存在的旧值，确保 0K 显示而非过期数字
          cache.requestCacheTokenMap.delete(i);
        }
      }
      cache.processedCount = requests.length;
      cache.lastScannedReq = requests.length > 0 ? requests[requests.length - 1] : null;

      // Teammate 名称解析：在 classifyRequest 之前注入 req.teammate（prompt 内容匹配）
      resolveTeammateNames(requests);
      // Heal labels baked into surviving entries before the registry resolved
      // (or baked from a raw id) — entries carry the request object reference,
      // which survives filtered-array rebuilds and insertions.
      healUnresolvedTeammateEntries(cache.subAgentEntries);

      // subAgentEntries: response 可能被原地更新，从 subAgentProcessedCount 开始扫描
      // 回退一位重扫尾项：上一轮尾项的 classifyRequest(req, undefined) 可能因缺少 nextReq 而误判
      let subStart = cache.subAgentProcessedCount || 0;
      if (subStart > 0 && subStart < requests.length) {
        subStart--;
        // 移除上一轮尾项可能已推入的错误条目
        while (cache.subAgentEntries.length > 0 && cache.subAgentEntries[cache.subAgentEntries.length - 1].requestIndex >= subStart) {
          cache.subAgentEntries.pop();
        }
      }
      // 全局 tool_result 索引:并行 SubAgent / Teammate 的请求互相穿插,K+1 不可
      // 预测,需 id → result 全局映射。增量追加新请求,避免每次 setState 全量重扫。
      // 与 subStart 同样回退一位:上轮尾项的 response 可能刚到达,需补扫其 response.content。
      // `!(id in index)` 守卫保证幂等。
      let globalIndexStart = cache.globalIndexProcessedCount || 0;
      if (globalIndexStart > 0 && globalIndexStart < requests.length) globalIndexStart--;
      if (globalIndexStart < requests.length) {
        appendToGlobalToolResultIndex(cache.globalIndexState, requests, globalIndexStart);
        cache.globalIndexProcessedCount = requests.length;
      }
      const globalToolResultIndex = cache.globalIndexState.index;
      for (let i = subStart; i < requests.length; i++) {
        const req = requests[i];
        if (!req.timestamp) continue;
        const cls = classifyRequest(req, requests[i + 1]);
        if (cls.type === 'SubAgent' || cls.type === 'Teammate') {
          const respContent = req.response?.body?.content;
          if (Array.isArray(respContent) && respContent.length > 0) {
            const subToolResultMap = buildSubAgentResultMap(req, globalToolResultIndex);
            const isTeammateEntry = cls.type === 'Teammate';
            cache.subAgentEntries.push({
              timestamp: req.timestamp,
              content: respContent,
              toolResultMap: subToolResultMap,
              label: isTeammateEntry
                ? formatTeammateLabel(cls.subType, req.body?.model)
                : formatRequestTag(cls.type, cls.subType),
              isTeammate: isTeammateEntry,
              requestIndex: i,
              // All teammate entries stay healable: a truthy cls.subType can
              // be a raw id upgraded to a real name later. Object reference,
              // not index — indices shift on mid-array insertion.
              unresolved: isTeammateEntry,
              req,
            });
          }
        }
      }
      cache.subAgentProcessedCount = requests.length;
    }
    const tsToIndex = cache.tsToIndex;
    const requestCacheTokenMap = cache.requestCacheTokenMap;
    // globalModelInfo 仅给 line ~1342 的 lastResponse 路径（最新一轮 response 渲染）使用，
    // 1v1 per-message 解析不再回落到此值 —— 避免历史 logo 被最新 entry 模型污染。
    const globalModelInfo = getModelInfo(cache.modelName);
    // Per-message resolver：1v1 严格遵从，未匹配返回 null（ChatMessage 显示中性 'MainAgent'）。
    // assistant message 的 _timestamp 实际指向【下一轮 entry】的 ts（详见
    // src/AppBase.jsx:184-186, src/utils/sessionMerge.js:44/50），所以 producer
    // req idx = idx - 1；user message producer idx = idx。
    const resolveModelInfo = (ts, role) => resolveProducerModelInfo(ts, role, tsToIndex, cache.modelNameByReqIdx);
    const subAgentEntries = cache.subAgentEntries;

    const allItems = [];
    const tsItemMap = {};

    // === session item 缓存：toggle 签名检查 ===
    const { showThinkingSummaries } = this.props;
    const activePromptIds = (this.state.ptyPromptHistory || []).filter(p => p.status === 'active').map(p => p.id).join(',');
    const toggleSig = `${collapseToolResults}|${expandThinking}|${showFullToolContent}|${showThinkingSummaries}|${this.props.cliMode}|${this.state.ptyPrompt?.id || ''}|${activePromptIds}|${this.props.userProfile?.name || ''}|${this.props.lang || ''}|${Object.keys(this.state.localAskAnswers || {}).join(',')}`;
    if (toggleSig !== this._itemCacheToggleSig) {
      this._sessionItemCache = [];
      this._itemCacheToggleSig = toggleSig;
    }
    if (this._sessionItemCache.length > mainAgentSessions.length) {
      this._sessionItemCache.length = mainAgentSessions.length;
    }
    // 清理 _getMergedXxxMap 的 byKey 字典中已不存在的 main session 条目（s${si}），
    // 否则用户切换/删除 session 后旧 keyPrefix 永不释放（每条 entry 占 ~8 引用，重 session 用户累积可见内存）。
    // tm${si} (sub-agent) 的清理由各自 render 周期短，不在此处处理。
    const _validS = mainAgentSessions.length;
    const _byKeyDicts = [
      this._mergedPlanApprovalMapByKey, this._prevPlanCacheByKey, this._prevPlanDirtyByKey,
      this._mergedAskAnswerMapByKey, this._prevAskCacheByKey, this._prevAskDirtyByKey, this._prevAskLocalByKey,
    ];
    for (const dict of _byKeyDicts) {
      if (!dict) continue;
      for (const k of Object.keys(dict)) {
        if (!k.startsWith('s')) continue;
        const idx = parseInt(k.slice(1), 10);
        if (Number.isFinite(idx) && idx >= _validS) delete dict[k];
      }
    }

    // Server-side pagination: "load earlier conversations" button
    // 仅展示当前会话时隐藏跨会话的「加载更早」按钮（更早内容本就不展示）。
    if (!onlyCurrentSession && (this.props.hasMoreHistory || this.props.loadingMore)) {
      allItems.push(
        <div key="load-more-history" className={styles.loadMoreWrap}>
          {this.props.loadingMore ? (
            <div className={`${styles.loadMoreBtn} ${styles.loadMoreBtnLoading}`}>
              <span className={styles.loadMoreSpinner} />
              {t('ui.loadingMoreHistory')}
            </div>
          ) : (
            <button className={styles.loadMoreBtn} onClick={() => this.props.onLoadMoreHistory && this.props.onLoadMoreHistory()}>
              {t('ui.loadEarlierConversations')}
            </button>
          )}
        </div>
      );
    }

    let subIdx = 0;
    // 仅展示当前会话：跳过更早 session 的 SubAgent entries，避免它们 bleed 进当前 session 顶部
    //（下方 forEach 对更早 session 直接 return，不会推进 subIdx，故这里先把游标快进到当前 session 起点）。
    if (onlyCurrentSession && mainAgentSessions.length > 1) {
      const shown = mainAgentSessions[mainAgentSessions.length - 1];
      const shownStart = shown && shown.messages && shown.messages[0] && shown.messages[0]._timestamp;
      if (shownStart) {
        while (subIdx < subAgentEntries.length && subAgentEntries[subIdx].timestamp < shownStart) subIdx++;
      }
    }
    // 跨 session + LR 跟踪当前活跃的 ExitPlanMode tool_use id（最末非 null 即为当前 pending）。
    // 写入 this._currentLastPendingPlanId 供 componentDidUpdate 派生 pendingPtyPlan 用。
    let buildLpid = null;
    // Timestamp of the Last Response block (lives outside allItems) — folded
    // into the avatar-animation latest-timestamp scan below.
    let lastResponseTs = null;

    const startSi = onlyCurrentSession ? mainAgentSessions.length - 1 : 0;
    mainAgentSessions.forEach((session, si) => {
      // 仅展示当前会话：跳过当前(最末)session 之前的全部 session（含其冷占位「加载」按钮，见下方 _cold 分支）。
      if (si < startSi) return;
      if (si > startSi) {
        allItems.push(
          <Divider key={`session-div-${si}`} className={styles.sessionDivider}>
            <Text className={styles.sessionDividerText}>{t('ui.session')}</Text>
          </Divider>
        );
      }

      // 冷 session 占位符
      if (session._cold) {
        const isLoading = this.props.loadingSessionId === session.sessionId;
        allItems.push(
          <div key={`cold-session-${si}`} className={styles.loadMoreWrap}>
            {isLoading ? (
              <div className={`${styles.loadMoreBtn} ${styles.loadMoreBtnLoading}`}>
                <span className={styles.loadMoreSpinner} />
                {t('ui.loadingMoreHistory')}
              </div>
            ) : (
              <button className={styles.loadMoreBtn}
                onClick={() => this.props.onLoadSession && this.props.onLoadSession(session.sessionId)}>
                {t('ui.loadSessionPlaceholder', { count: session.msgCount })}
              </button>
            )}
          </div>
        );
        return; // 跳过 renderSessionMessages
      }

      // === session 级缓存判断 ===
      const sc = this._sessionItemCache[si];
      let msgs, lastPendingAskId, lastPendingPlanId;
      // hoist 当前 session 的 planApprovalMap，供下方增量 cache 合并守卫 + LR 路径 lpid 守卫使用。
      // renderSessionMessages 内 L906 也基于 cached 派生 planApprovalMap，但其作用域只在 renderSessionMessages，
      // 这里的引用必须独立从 toolResultCache 取，与 LR 路径 L1508 的 _cachedLR.planApprovalMap 同源。
      const sessionPlanApprovalMap = (getToolResultCache(session.messages) || {}).planApprovalMap || {};
      // FULL HIT / INCREMENTAL 路径下用本派生 map 做 prop diff，与 renderSessionMessages 内 L955 同源（同一 keyPrefix）。
      const mergedPlanApprovalMap = this._getMergedPlanApprovalMap(session.messages, `s${si}`);
      const _localAskForSession = this.state.localAskAnswers || {};
      const mergedAskAnswerMap = this._getMergedAskAnswerMap(session.messages, `s${si}`, _localAskForSession);

      // === Last-Response ownership arbitration (single source of truth) ===
      // ONE computeLrOwnership call decides both the pre-scan flags (lrWillOwn* →
      // strip the messages side below, preventing the double-portal bug where
      // messages-side ChatMessage and the LR <ChatMessage key="resp-asst"> both
      // went interactive) AND the LR block's pending ids (respLastPending*).
      // Uses this session's MERGED ask map (incl. local optimistic answers) and
      // the RAW sessionPlanApprovalMap — see interactionOwnership.js header.
      const lr = computeLrOwnership({
        isLastSession: si === mainAgentSessions.length - 1,
        respContent: session.response?.body?.content,
        messages: session.messages,
        mergedAskAnswerMap,
        localAskAnswers: this.state.localAskAnswers || {},
        sessionPlanApprovalMap,
        cliMode: this.props.cliMode,
      });
      const lrWillOwnAsk = lr.lrWillOwnAsk;
      const lrWillOwnPlan = lr.lrWillOwnPlan;

      if (sc && sc.session === session && sc.msgsLen === session.messages.length) {
        // 完全命中：session 对象不变且消息数不变 → 直接复用。
        // 但 planApprovalMap / askAnswerMap 引用变化时（ExitPlanMode 审批落盘 / AskUserQuestion 答完），
        // 刷新持有相应 tool_use 的旧 element 的 prop，避免 React 因 element 引用未变跳过 SCU 让卡片永远停在 pending 视图。
        msgs = refreshCachedItemProp(sc.items, sc.planApprovalMap, mergedPlanApprovalMap, 'ExitPlanMode', 'planApprovalMap');
        msgs = refreshCachedItemProp(msgs, sc.askAnswerMap, mergedAskAnswerMap, 'AskUserQuestion', 'askAnswerMap');
        // Heal rows whose modelInfo was baked null before the request scan
        // could resolve the producer (post-refresh race). The resolver closes
        // over caches rebuilt earlier in THIS call; the write-back below
        // persists healed elements, so later FULL HITs are same-ref and free.
        msgs = refreshResolvedModelInfo(msgs, resolveModelInfo);
        lastPendingAskId = sc.lastPendingAskId;
        lastPendingPlanId = sc.lastPendingPlanId;
      } else if (sc && sc.session === session && session.messages.length > sc.msgsLen) {
        // 增量：session 对象不变但消息增长 → 只渲染新消息，拼接到缓存
        const result = this.renderSessionMessages(session.messages, `s${si}`, resolveModelInfo, tsToIndex, requestCacheTokenMap, sc.msgsLen);
        // 旧段同样要刷新 planApprovalMap / askAnswerMap prop（同 FULL HIT 理由）
        msgs = refreshCachedItemProp(sc.items, sc.planApprovalMap, mergedPlanApprovalMap, 'ExitPlanMode', 'planApprovalMap').slice();
        msgs = refreshCachedItemProp(msgs, sc.askAnswerMap, mergedAskAnswerMap, 'AskUserQuestion', 'askAnswerMap');
        // Same modelInfo healing for the reused old segment (see FULL HIT above).
        msgs = refreshResolvedModelInfo(msgs, resolveModelInfo);
        // 增量 result 范围内若无新 pending plan/ask，但 sc 旧值仍未 resolved → 保留 sc 值，
        // 否则会让 modal 在 streaming 间隙短暂关闭再重弹（闪烁）。Heal logic shared
        // via interactionOwnership.healStalePendingIds (plan checks the RAW map,
        // ask checks the MERGED map — deliberate asymmetry).
        ({ lastPendingAskId, lastPendingPlanId } = healStalePendingIds({
          resultAskId: result.lastPendingAskId,
          resultPlanId: result.lastPendingPlanId,
          prevAskId: sc.lastPendingAskId,
          prevPlanId: sc.lastPendingPlanId,
          sessionPlanApprovalMap,
          mergedAskAnswerMap,
        }));
        // 如果 lastPendingAskId 迁移了，修补旧缓存中持有旧 id 的 ChatMessage
        if (sc.lastPendingAskId && sc.lastPendingAskId !== lastPendingAskId) {
          for (let i = 0; i < msgs.length; i++) {
            if (msgs[i].props.lastPendingAskId === sc.lastPendingAskId) {
              msgs[i] = React.cloneElement(msgs[i], { lastPendingAskId: null });
              break;
            }
          }
        }
        if (sc.lastPendingPlanId && sc.lastPendingPlanId !== lastPendingPlanId) {
          for (let i = 0; i < msgs.length; i++) {
            if (msgs[i].props.lastPendingPlanId === sc.lastPendingPlanId) {
              msgs[i] = React.cloneElement(msgs[i], { lastPendingPlanId: null });
              break;
            }
          }
        }
        // streaming 期间同一 toolId 可能在多条 message 里出现（增量 push 而非 mutate）。
        // owner-idx 算法保证 result.items 内只有一条 ChatMessage 拿到 lastPendingAskId。
        // 但 sc.items 里上一轮赋的 owner 可能 stale —— 当本轮 owner 落在 result 范围内时，
        // 必须清掉 sc.items 中所有持同一 id 的 ChatMessage，否则会出现两份 portal 到 modal askSlot。
        if (result.lastPendingAskId && result.askOwnerInRange) {
          for (let i = 0; i < msgs.length; i++) {
            if (msgs[i].props.lastPendingAskId === result.lastPendingAskId) {
              msgs[i] = React.cloneElement(msgs[i], { lastPendingAskId: null });
            }
          }
        }
        if (result.lastPendingPlanId && result.planOwnerInRange) {
          for (let i = 0; i < msgs.length; i++) {
            if (msgs[i].props.lastPendingPlanId === result.lastPendingPlanId) {
              msgs[i] = React.cloneElement(msgs[i], { lastPendingPlanId: null });
            }
          }
        }
        msgs = msgs.concat(result.items);
      } else {
        // 缓存未命中 → 全量渲染
        const result = this.renderSessionMessages(session.messages, `s${si}`, resolveModelInfo, tsToIndex, requestCacheTokenMap);
        msgs = result.items;
        lastPendingAskId = result.lastPendingAskId;
        lastPendingPlanId = result.lastPendingPlanId;
      }

      // 更新缓存（保持 raw msgs / lastPendingAskId / lastPendingPlanId 未做 LR-stripping 的原始版本，
      // 使下一轮 LR 不再持权时 messages-side 能自动恢复为 interactive）
      this._sessionItemCache[si] = {
        session, msgsLen: session.messages.length,
        items: msgs, lastPendingAskId, lastPendingPlanId,
        // 记下本轮 planApprovalMap / askAnswerMap 引用，下轮 FULL HIT / INCREMENTAL 据此判断是否要刷新旧 element 的 prop。
        planApprovalMap: mergedPlanApprovalMap,
        askAnswerMap: mergedAskAnswerMap,
      };
      // LR 持有交互权 → 派生新的 msgs 数组（不污染 cache.items），让 messages-side 同 toolId 卡降级成静态展示，
      // 保证唯一交互点是 LR <ChatMessage key="resp-asst">。
      // 用 map 而非 in-place mutation，cache.items 保持原始；下一轮 LR 不持权时 cache 命中能恢复 interactive。
      if (lrWillOwnAsk && lastPendingAskId) {
        const _stripAskId = lastPendingAskId;
        msgs = msgs.map(m => m.props.lastPendingAskId === _stripAskId
          ? React.cloneElement(m, { lastPendingAskId: null }) : m);
        lastPendingAskId = null;
      }
      if (lrWillOwnPlan && lastPendingPlanId) {
        const _stripPlanId = lastPendingPlanId;
        msgs = msgs.map(m => m.props.lastPendingPlanId === _stripPlanId
          ? React.cloneElement(m, { lastPendingPlanId: null }) : m);
        lastPendingPlanId = null;
      }
      if (lastPendingPlanId) buildLpid = lastPendingPlanId;

      // 将 SubAgent entries 按时间戳插入到 session 消息之间
      for (const m of msgs) {
        // 拆两个 ts 语义：
        //   msgWallTs = m.props.timestamp (carrier) —— SubAgent 按 wall-clock 顺序穿插用
        //   msgLookupTs = m.props.displayTs || m.props.timestamp —— tsItemMap 反向跳转 key
        //     （assistant 已经收 displayTs={msg._generatedTs}，自动走 generation ts；
        //      其他 role displayTs=undefined 自动 fallback 到 carrier）
        const msgWallTs = m.props.timestamp;
        const msgLookupTs = m.props.displayTs || m.props.timestamp;
        // 插入时间戳 <= 当前消息时间戳的 SubAgent entries
        while (subIdx < subAgentEntries.length && msgWallTs && subAgentEntries[subIdx].timestamp <= msgWallTs) {
          const sa = subAgentEntries[subIdx];
          if (sa.timestamp) tsItemMap[sa.timestamp] = allItems.length;
          const subCacheTotal = sa.requestIndex != null
            ? (requestCacheTokenMap?.get(sa.requestIndex) ?? 0)
            : null;
          allItems.push(
            <ChatMessage key={`sub-${sa.requestIndex}-${sa.timestamp}`} role="sub-agent-chat" content={sa.content} toolResultMap={sa.toolResultMap} label={sa.label} isTeammate={sa.isTeammate} timestamp={sa.timestamp} collapseToolResults={collapseToolResults} expandThinking={expandThinking} showFullToolContent={showFullToolContent} requestIndex={sa.requestIndex} cacheTotalTokens={subCacheTotal} onViewRequest={onViewRequest} onOpenFile={this.handleOpenToolFilePath} isHistoryLog={isHistoryLog} />
          );
          subIdx++;
        }
        if (msgLookupTs) tsItemMap[msgLookupTs] = allItems.length;
        allItems.push(m);
      }
      // 插入剩余的 SubAgent entries（时间戳在最后一条消息之后）
      while (subIdx < subAgentEntries.length) {
        const sa = subAgentEntries[subIdx];
        // 只插入属于当前 session 时间范围内的（下一个 session 之前的）
        const nextSessionStart = si < mainAgentSessions.length - 1 && mainAgentSessions[si + 1].messages?.[0]?._timestamp;
        // pin 锁在更早会话时，传入的会话已被切到「以 pin 会话结尾」，nextSessionStart 失效（无 si+1），
        // 改用 sessionUpperBoundTs（= 下一个未展示会话的起点）截断，避免更晚会话的 sub-agent 渗入。
        const bound = nextSessionStart || this.props.sessionUpperBoundTs;
        if (bound && sa.timestamp > bound) break;
        if (sa.timestamp) tsItemMap[sa.timestamp] = allItems.length;
        const subCacheTotal = sa.requestIndex != null
          ? (requestCacheTokenMap?.get(sa.requestIndex) ?? 0)
          : null;
        allItems.push(
          <ChatMessage key={`sub-${sa.requestIndex}-${sa.timestamp}`} role="sub-agent-chat" content={sa.content} toolResultMap={sa.toolResultMap} label={sa.label} isTeammate={sa.isTeammate} timestamp={sa.timestamp} collapseToolResults={collapseToolResults} expandThinking={expandThinking} showFullToolContent={showFullToolContent} requestIndex={sa.requestIndex} cacheTotalTokens={subCacheTotal} onViewRequest={onViewRequest} onOpenFile={this.handleOpenToolFilePath} isHistoryLog={isHistoryLog} />
        );
        subIdx++;
      }

      if (si === mainAgentSessions.length - 1 && session.response?.body?.content) {
        const respContent = session.response.body.content;
        if (Array.isArray(respContent)) {
          // All LR ownership facts (shouldHide, history sets, pending ids) come
          // from the SAME computeLrOwnership result the pre-scan used — the two
          // sides can no longer disagree about who owns the interaction.
          const shouldHide = lr.shouldHide;

          if (!shouldHide) {
            // Last Response 单独存储，不混入主列表
            if (session.entryTimestamp) tsItemMap[session.entryTimestamp] = allItems.length;
            const respLastPendingAskId = lr.respLastPendingAskId;
            const respLastPendingPlanId = lr.respLastPendingPlanId;
            if (respLastPendingPlanId) buildLpid = respLastPendingPlanId;
            // 收集 Last Response 中所有 AskUserQuestion 的问题文本，用于 prompt 去重
            this._lastResponseAskQuestions = collectLrAskQuestions(respContent);
            const _cachedLR = getToolResultCache(session.messages) || {};
            // 复用 forEach 顶部 hoist 的 sessionPlanApprovalMap，避免重复一次 getToolResultCache 调用 + 同源同值
            const planApprovalMap = sessionPlanApprovalMap;
            const latestPlanContent = _cachedLR.latestPlanContent || null;
            const activePlanPrompt = this.props.cliMode
              ? this.state.ptyPromptHistory.slice().reverse().find(p => isPlanApprovalPrompt(p) && p.status === 'active') || null
              : null;
            const activeDangerousPrompt = this.props.cliMode && !this.state.pendingPermission
              ? this.state.ptyPromptHistory.slice().reverse().find(p => isDangerousOperationPrompt(p) && p.status === 'active') || null
              : null;
            // Last Response 过滤：隐藏 tool_use 块，仅保留交互卡片（AskUserQuestion / ExitPlanMode）
            // 去重：如果 AskUserQuestion / ExitPlanMode 已在消息历史中渲染，不再在 Last Response 重复显示
            const lrContent = filterLrContent(respContent, lr.historyAskIds, lr.historyPlanIds);
            // 如果过滤后没有可见内容，不显示 Last Response 区域
            if (!hasVisibleLrContent(lrContent)) return;
            const entryReqIdx = session.entryTimestamp ? tsToIndex[session.entryTimestamp] : undefined;
            const entryCacheTotal = entryReqIdx != null
              ? (requestCacheTokenMap?.get(entryReqIdx) ?? 0)
              : null;
            lastResponseTs = session.entryTimestamp || null;
            this._lastResponseItems = (
              <React.Fragment key="last-response-group">
                <Divider className={styles.lastResponseDivider}>
                  <Text type="secondary" className={styles.lastResponseLabel}>{t('ui.lastResponse')}</Text>
                </Divider>
                <ChatMessage key="resp-asst" role="assistant" content={lrContent} timestamp={session.entryTimestamp} modelInfo={globalModelInfo} collapseToolResults={collapseToolResults} expandThinking={expandThinking} showFullToolContent={showFullToolContent} toolResultMap={EMPTY_MAP} askAnswerMap={Object.keys(_localAskForSession).length > 0 ? _localAskForSession : EMPTY_MAP} planApprovalMap={planApprovalMap} latestPlanContent={latestPlanContent} planFileContents={this.state.planFileContents} lastPendingAskId={respLastPendingAskId} lastPendingPlanId={respLastPendingPlanId} activePlanPrompt={activePlanPrompt} activePtyPlanId={this.state.pendingPtyPlan?.id ?? null} planAutoApproveCountdown={this.state.planAutoApproveCountdown} onCancelPlanAutoApprove={this.cancelPlanAutoApprove} activeDangerousPrompt={activeDangerousPrompt} ptyPrompt={this.state.ptyPrompt} cacheTotalTokens={entryCacheTotal} onPlanApprovalClick={this.handlePromptOptionClick} onPlanFeedbackSubmit={this.handlePlanFeedbackSubmit} onDangerousApprovalClick={this.handlePromptOptionClick} cliMode={this.props.cliMode} onAskQuestionSubmit={this.handleAskQuestionSubmit} onAskQuestionCancel={this.handleAskCancel} pendingAsk={this.state.pendingAsk} askMetaMap={this.state.askMetaMap} onOpenFile={this.handleOpenToolFilePath} isHistoryLog={isHistoryLog} />
              </React.Fragment>
            );
          }
        }
      }
    });

    // 记录滚动目标 item index
    const { scrollToTimestamp } = this.props;
    this._scrollTargetIdx = scrollToTimestamp && tsItemMap[scrollToTimestamp] != null
      ? tsItemMap[scrollToTimestamp] : null;
    this._tsItemMap = tsItemMap;
    // 镜像本轮最末活跃 lpid 给 componentDidUpdate 派生 pendingPtyPlan 用
    this._currentLastPendingPlanId = buildLpid;

    // Avatar animation loading strategy: stale teammate rows are cloned to
    // static so a refresh of a long session does not start hundreds of SMIL
    // timelines at once (see avatarAnimationPostPass.js for the policy).
    applyAvatarAnimationTargets(allItems, lastResponseTs);

    return allItems;
  }

  // 渲染窗口裁剪：只保留最近 ITEM_LIMIT(+已展开) 条 item。移动端与桌面端统一处理
  // （桌面端启用裁剪以避免长任务全量渲染卡死，见 DESKTOP_ITEM_LIMIT 注释）。
  _applyMobileSlice(allItems) {
    this._totalItemCount = allItems.length;
    // logfile 只读模式：虚拟化平台（Android，渲染 O(1)）直接一次性全量渲染；
    // 桌面/iOS/iPad 不走虚拟化，单次全量挂 DOM 会重现 DESKTOP_ITEM_LIMIT 注释里点名的长任务卡死，
    // 故保留 ITEM_LIMIT 窗口裁剪，由 _maybeScheduleLocalLogAutoFill 逐帧自动扩窗至全量（无需手工点击）。
    if (this.props.isLocalLog && useVirtuoso) {
      this._mobileSliceOffset = 0;
      return allItems;
    }
    const limit = ITEM_LIMIT + this._mobileExtraItems;
    if (allItems.length <= limit) {
      this._mobileSliceOffset = 0;
      return allItems;
    }
    const offset = allItems.length - limit;
    this._mobileSliceOffset = offset;
    // Adjust scroll target index
    if (this._scrollTargetIdx != null) {
      this._scrollTargetIdx -= offset;
      if (this._scrollTargetIdx < 0) this._scrollTargetIdx = null;
    }
    // Adjust tsItemMap
    if (this._tsItemMap) {
      const newMap = {};
      for (const [ts, idx] of Object.entries(this._tsItemMap)) {
        const adjusted = idx - offset;
        if (adjusted >= 0) newMap[ts] = adjusted;
      }
      this._tsItemMap = newMap;
    }
    return allItems.slice(offset);
  }

  _extractSuggestion() {
    const { mainAgentSessions } = this.props;
    if (!mainAgentSessions?.length) return null;
    const lastSession = mainAgentSessions[mainAgentSessions.length - 1];
    const msgs = lastSession?.messages;
    if (!Array.isArray(msgs) || msgs.length === 0) return null;
    // 只有 SUGGESTION MODE 请求的响应才是有效建议
    const lastUserMsg = msgs[msgs.length - 1];
    if (lastUserMsg?.role !== 'user') return null;
    const userContent = lastUserMsg.content;
    const hasSuggestionMode = Array.isArray(userContent)
      ? userContent.some(b => b.type === 'text' && /^\[SUGGESTION MODE:/i.test((b.text || '').trim()))
      : typeof userContent === 'string' && /^\[SUGGESTION MODE:/im.test(userContent.trim());
    if (!hasSuggestionMode) return null;
    const resp = lastSession?.response;
    if (!resp) return null;
    const body = resp.body;
    if (!body) return null;
    const stop = body.stop_reason;
    if (stop !== 'end_turn' && stop !== 'max_tokens') return null;
    const content = body.content;
    if (!Array.isArray(content)) return null;
    for (let i = content.length - 1; i >= 0; i--) {
      if (content[i].type === 'text' && content[i].text?.trim()) {
        return content[i].text.trim();
      }
    }
    return null;
  }

  _updateSuggestion() {
    const text = this._extractSuggestion();
    this.setState({ inputSuggestion: text || null });
  }

  _loadPresets() {
    // 数据从 props 派生 (SettingsContext 集中 fetch);未 ready 时静默返回,
    // componentDidUpdate 监听 props.preferences / props.claudeSettings 后重试。
    const agentTeamEnabled = this.props.claudeSettings?.env?.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === '1';
    if (!agentTeamEnabled) return;
    const data = this.props.preferences;
    if (!data) return;
    const dismissed = Array.isArray(data.dismissedBuiltinPresets) ? new Set(data.dismissedBuiltinPresets) : new Set();
    let items = [];
    if (Array.isArray(data.presetShortcuts)) {
      items = data.presetShortcuts.map((item, i) => {
        if (typeof item === 'string') return { id: Date.now() + i, teamName: '', description: item };
        return { id: Date.now() + i, teamName: item.teamName || '', description: item.description || '',
          ...(item.builtinId ? { builtinId: item.builtinId } : {}), ...(item.modified ? { modified: true } : {}) };
      });
    }
    const existingBuiltinIds = new Set(items.filter(i => i.builtinId).map(i => i.builtinId));
    for (const bp of BUILTIN_PRESETS) {
      if (dismissed.has(bp.builtinId) || existingBuiltinIds.has(bp.builtinId)) continue;
      items.unshift({ id: Date.now() + Math.random(), builtinId: bp.builtinId, teamName: bp.teamName, description: bp.description });
    }
    const customExperts = Array.isArray(data.customUltraplanExperts) ? data.customUltraplanExperts : [];
    const expertOrder = Array.isArray(data.ultraplanExpertOrder) ? data.ultraplanExpertOrder : [];
    const expertHidden = Array.isArray(data.ultraplanExpertHidden) ? data.ultraplanExpertHidden : [];
    const next = {
      presetItems: items,
      customUltraplanExperts: customExperts,
      ultraplanExpertOrder: expertOrder,
      ultraplanExpertHidden: expertHidden,
    };
    // 若当前选中的变体已不可见（被另一端删除 / 隐藏），回退到首个可见专家（无可见则 codeExpert）。
    // 与 TerminalPanel._loadPresetShortcuts 同款语义。
    const current = this.state.ultraplanVariant;
    const visible = visibleExpertKeys(customExperts, expertOrder, expertHidden);
    if (typeof current === 'string' && !visible.includes(current)) {
      next.ultraplanVariant = visible[0] || 'codeExpert';
    }
    this.setState(next);
  }

  // 清空上下文的直接执行体（无确认弹层）：移动端菜单项经 Modal.confirm 包装调用；
  // 桌面输入栏独立按钮由 ChatInputBar 的 Popconfirm（与终端工具栏同款气泡）确认后调用。
  _doClearContext = () => {
    const textarea = this._inputRef.current;
    if (!textarea) return;
    textarea.value = '/clear';
    // /clear 不应被「上传缓发」卡住:先撤销缓发 + 清空上传占位(并 revoke url),
    // setState 提交后再发 → handleInputSend 守卫看到 uploadingItems 为空,不会 defer。
    this._clearDeferSend();
    for (const u of this.state.uploadingItems) { if (u.previewUrl) { try { URL.revokeObjectURL(u.previewUrl); } catch {} } }
    this.setState({ inputEmpty: false, pendingImages: [], uploadingItems: [] }, () => this.handleInputSend());
    this.props.onClearContextOptimistic?.();
  };

  handlePresetSend = (description) => {
    if (!description) return;
    const textarea = this._inputRef.current;
    if (textarea) {
      textarea.value = description;
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, (isMobile && !isPad) ? 160 : 120) + 'px';
      this.setState({ inputEmpty: false });
      textarea.focus();
    } else if (this._inputWs && this._inputWs.readyState === WebSocket.OPEN) {
      // 终端模式下没有 textarea，直接通过 PTY 发送。
      // 用 bracket-paste 包裹避免 description 含 `/` `!` `\t` 等被 Ink TUI 当特殊键解析。
      this._inputWs.send(JSON.stringify({
        type: 'input-sequential',
        chunks: buildBracketPasteSubmitChunks(description),
        settleMs: BRACKET_PASTE_SUBMIT_SETTLE_MS,
      }));
    }
  };

  // ─── UltraPlan handlers ─────────────────────────────────
  _handleUltraplanSend = () => {
    const trimmed = this.state.ultraplanPrompt.trim();
    if (!trimmed && this.state.ultraplanFiles.length === 0) return;
    const filePaths = this.state.ultraplanFiles.map(f => `"${f.path}"`).join(' ');
    const userInput = filePaths ? (trimmed ? `${filePaths} ${trimmed}` : filePaths) : trimmed;
    const variant = this.state.ultraplanVariant;
    let assembled;
    if (typeof variant === 'string' && variant.startsWith('custom:')) {
      const id = variant.slice('custom:'.length);
      const item = this.state.customUltraplanExperts.find(e => e.id === id);
      if (!item) return;
      assembled = buildLocalUltraplan(userInput, 'custom', undefined, item.content);
    } else {
      assembled = buildLocalUltraplan(userInput, variant);
    }
    if (!assembled) return;

    // WS 断开时不直接丢消息：把 assembled 写回 textarea 作草稿，让用户能手动重试。
    // 不设 pendingInput（没真发出去，不该显示 optimistic bubble）。
    const wsOpen = this._inputWs && this._inputWs.readyState === WebSocket.OPEN;
    if (!wsOpen) {
      const ta = this._inputRef.current;
      if (ta) {
        ta.value = assembled;
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
      }
      this.setState({
        ultraplanModalOpen: false,
        ultraplanPopoverOpen: false,
        ultraplanPrompt: '',
        ultraplanVariant: 'codeExpert',
        ultraplanFiles: [],
        inputEmpty: ta ? !assembled : true,
      }, () => {
        if (ta) ta.focus();
      });
      return;
    }

    this.setState({
      ultraplanModalOpen: false,
      ultraplanPopoverOpen: false,
      ultraplanPrompt: '',
      ultraplanVariant: 'codeExpert',
      ultraplanFiles: [],
      pendingInput: userInput,
      inputSuggestion: null,
    }, () => {
      if (this.props.sdkMode) {
        this._inputWs.send(JSON.stringify({ type: 'sdk-user-message', text: assembled }));
      } else {
        this._inputWs.send(JSON.stringify({
          type: 'input-sequential',
          chunks: buildBracketPasteSubmitChunks(assembled),
          settleMs: BRACKET_PASTE_SUBMIT_SETTLE_MS,
        }));
      }
      this.scrollToBottom();
    });
  };

  // UltraPlan 文件 / 专家逻辑委托给共享控制器（见 ../utils/ultraplanController）。方法名保持不变，render 零改动。
  _handleUltraplanUpload = (...a) => this._ultraplan.handleUpload(...a);

  _handleUltraplanPaste = (...a) => this._ultraplan.handlePaste(...a);

  _handleUltraplanRemoveFile = (...a) => this._ultraplan.handleRemoveFile(...a);

  // UltraPlanModal pointerup 时回调 —— 一次性 setState + 写双 localStorage key。
  // 拖拽期 UltraPlanModal 已直接改 DOM style,这里只负责落盘 + 下次打开恢复。
  _handleUltraplanModalSizeChange = (size) => {
    if (!size) return;
    this.setState({ ultraplanModalSize: size });
    _writeUltraplanModalSize(size);
  };

  _openCustomUltraplanEditor = (item) => {
    if (isMobile) {
      // 移动端：打开专家编辑器时关闭父 UltraPlan 弹窗，避免两层 modal 叠加遮挡。
      // 用快照记录原本的打开状态，close 时按实际状态恢复——防御未来非 UltraPlan 路径调用。
      this.setState(prev => ({
        customUltraplanEditOpen: true,
        customUltraplanEditing: item || null,
        _ultraplanWasOpenBeforeEdit: prev.ultraplanModalOpen,
        ultraplanModalOpen: false,
      }));
      return;
    }
    // 桌面 popover 路径与终端逐字一致：编辑器打开不收面板，
    // 靠 _ultraplanPopoverOnOpenChange 守卫拦编辑器 mask 的外部点击
    this.setState({ customUltraplanEditOpen: true, customUltraplanEditing: item || null });
  };

  _closeCustomUltraplanEditor = () => {
    if (isMobile) {
      this.setState(prev => ({
        customUltraplanEditOpen: false,
        customUltraplanEditing: null,
        ultraplanModalOpen: !!prev._ultraplanWasOpenBeforeEdit,
        _ultraplanWasOpenBeforeEdit: false,
      }));
      return;
    }
    this.setState({ customUltraplanEditOpen: false, customUltraplanEditing: null });
  };

  // 桌面输入栏 UltraPlan 弹层的关闭守卫（与 TerminalPanel 的 onOpenChange 同机制）：
  // 编辑器/管理弹窗是 portal Modal，其 mask 对本 Popover 而言是「外部点击」——rc-trigger
  // 的 capture-phase mousedown 早于 rc-dialog 的 bubble click，守卫读到的状态仍为 true，
  // 直接拦掉本次关闭；lightbox / ConfirmRemoveButton 气泡同理。
  _ultraplanPopoverOnOpenChange = (v) => {
    if (!v && (this.state.ultraplanLightbox || this.state.ultraplanConfirming
      || this.state.customUltraplanEditOpen || this.state.ultraplanManagerOpen)) return;
    if (!v) this.setState({ ultraplanPopoverOpen: false });
  };

  _saveCustomUltraplanExpert = (...a) => this._ultraplan.saveExpert(...a);

  _deleteCustomUltraplanExpert = (...a) => this._ultraplan.deleteExpert(...a);

  // 通过 TerminalWsContext 共享单条 ws,本方法接收消息派发。
  // 注:`data` 分支不能省 — _ptyPrompt.appendData → detectPrompt 解析出的 ptyPrompt state 被多处引用
  // (renderDangerApproval / SubAgent 兜底权限面板路由 / handlePlanFeedbackSubmit isDanger 检查 /
  //  _submitViaSequentialQueue 非 danger 类型自检 等)。合并 ws 后 ChatView 仍需要这条解析路径,
  // CPU 开销保留,但网络层 1 条 ws 是仍有收益(改前 2 条同时收同一份 PTY 流)。
  _onTerminalWsMessage = (msg) => {
    try {
      // ask / sdk-ask 类消息交给 AskFlowController；返回 true 表示已处理 → 短路。
      if (this._askFlow.handleWsMessage(msg)) return;
      if (msg.type === 'data' || msg.type === 'data-resync') {
        // data-resync(反压恢复快照)同样喂给 prompt 检测:洪泛窗口内出现的交互
        // prompt 仍在快照末尾,控制器内部 buffer 自身 4KB 滚动封顶,无内存风险
        this._ptyPrompt.appendData(msg.data);
      } else if (msg.type === 'exit') {
          this._ptyPrompt.clearPrompt();
        } else if (msg.type === 'sdk-plan-pending') {
          // SDK mode: ExitPlanMode — show plan approval UI
          this.setState({ pendingPlanApproval: { id: msg.id, input: msg.input } });
        } else if (msg.type === 'perm-hook-pending') {
          // 免审批：在请求到达处直接放行，不设 pendingPermission、不入队，从源头绕过
          // ToolApprovalPanel（否则面板会先挂载再于下一 tick 自动批准，残留一帧 + 200ms
          // 退场动画的闪烁）。ws 未连通时 autoAllow 返回 false → 回落到正常面板/队列路径，
          // 保持请求可见可恢复（重连服务端会重放），不静默丢成 timeout-deny。
          const instantAllowed = this.props.autoApproveSeconds === AUTO_APPROVE_INSTANT
            && this._permission.autoAllow({ id: msg.id });
          if (!instantAllowed) {
            // Queue support: if a permission panel is already showing, queue the new one
            this.setState(state => {
              if (state.pendingPermission) {
                return { permissionQueue: [...state.permissionQueue, { id: msg.id, toolName: msg.toolName, input: msg.input }] };
              }
              return { pendingPermission: { id: msg.id, toolName: msg.toolName, input: msg.input } };
            });
          }
        } else if (msg.type === 'perm-hook-timeout') {
          // Timeout carries id — only clear if it matches the active request, or remove from queue
          this.setState(state => {
            if (msg.id && state.pendingPermission?.id === msg.id) {
              const next = state.permissionQueue[0] || null;
              return { pendingPermission: next, permissionQueue: state.permissionQueue.slice(1) };
            }
            if (msg.id) {
              return { permissionQueue: state.permissionQueue.filter(p => p.id !== msg.id) };
            }
            // Legacy timeout without id — clear all
            return { pendingPermission: null, permissionQueue: [] };
          });
        } else if (msg.type === 'perm-hook-resolved') {
          // 另一端已审批，清除本端面板 or remove from queue
          this.setState(state => {
            if (state.pendingPermission?.id === msg.id) {
              const next = state.permissionQueue[0] || null;
              return { pendingPermission: next, permissionQueue: state.permissionQueue.slice(1) };
            }
            return { permissionQueue: state.permissionQueue.filter(p => p.id !== msg.id) };
          });
        } else if (msg.type === 'sdk-plan-resolved') {
          if (this.state.pendingPlanApproval?.id === msg.id) {
            this.setState({ pendingPlanApproval: null });
          }
        } else if (msg.type === 'image-upload-notify') {
          // 另一个视图/设备上传了图片，同步到本端 pendingImages
          this._addPendingImage(msg.path, msg.source);
        } else if (msg.type === 'image-remove-notify') {
          // 另一端删除了预览中的文件，同步移除
          if (msg.path) {
            this.setState(prev => {
              const next = prev.pendingImages.filter(img => img.path !== msg.path);
              if (next.length === prev.pendingImages.length) return null;
              return { pendingImages: next };
            });
          }
        }
    } catch (e) { reportSwallowed('ws.terminal-msg', e, { msgType: msg?.type }); }
  };

  // ws 状态变更监听:close 时清残留审批面板(原 _inputWs.onclose 行为);Provider 内部已自动 2s 重连。
  // 'open' 的 ask 相关恢复逻辑（重发 _pendingCancelIds + 拉 /api/pending-asks）已搬到 AskFlowController.onWsOpen。
  _onTerminalWsState = (state) => {
    if (state === 'open') {
      this._askFlow.onWsOpen();
      return;
    }
    if (state !== 'close') return;
    if (this.state.pendingPtyPlan?.id) {
      this._resolvedPlanIds.add(this.state.pendingPtyPlan.id);
    }
    // Drain Electron pendingByTab[tabId].ask Map：清 askQueue 时每条都得逐条 notifyAskResolved，
    // 否则 dock badge / flashFrame 状态不归零。镜像 componentWillUnmount drain 模式 +
    // per-item try-catch 防单条 IPC throw 中断后续。
    try {
      if (typeof window !== 'undefined' && window.tabBridge?.notifyAskResolved) {
        const tabId = this.props.ownTabId ?? null;
        if (this.state.pendingAsk) {
          try { window.tabBridge.notifyAskResolved({ id: this.state.pendingAsk.id, tabId }); } catch {}
        }
        for (const q of (this.state.askQueue || [])) {
          try { window.tabBridge.notifyAskResolved({ id: q.id, tabId }); } catch {}
        }
      }
    } catch {}
    if (this.state.pendingPermission || this.state.pendingPlanApproval || this.state.pendingAsk
        || this.state.pendingPtyPlan || this.state.askQueue?.length) {
      this.setState({ pendingPermission: null, permissionQueue: [], pendingPlanApproval: null, pendingAsk: null, askQueue: [], askMetaMap: {}, pendingPtyPlan: null });
    }
    // ask 实例 flag 由控制器 reset（state 键已在上面那条合并 setState 里清）
    this._askFlow.resetAskFlagsOnClose();
  };

  // ── 「Plan 自动审批」：plan 提交后短倒计时，到点自动选中批准项；期间可取消 ──────────────
  // 倒计时跑在 ChatView（稳定单例，持有 ws / _promptSubmitting / _resolvedPlanIds 守卫与批准入口），
  // 仅把剩余秒数与取消回调下发给 inline 卡片显示。仅 cliMode(PTY) 路径，SDK 模式不接入。
  _startPlanAutoApprove = (planId) => {
    if (this._planAutoTimer) return;                                   // 已在倒计时
    const seconds = this.props.planAutoApproveSeconds;                 // 0=关 / N=N 秒倒计时 / -1=立即
    if (!this.props.cliMode || !seconds) return;                       // 0/undefined → 关闭
    if (!planId || this._planAutoCancelled.has(planId)) return;        // 已被用户取消的 plan 不再重启
    const ws = this._inputWs;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;               // ws 未就绪 → 不启动（避免空发）
    if (seconds === AUTO_APPROVE_INSTANT) { this._firePlanAutoApprove(planId); return; } // 立即批准，无倒计时
    let remaining = seconds;
    this.setState({ planAutoApproveCountdown: remaining });
    this._planAutoTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        this._clearPlanAutoApprove();
        this._firePlanAutoApprove(planId);
      } else {
        this.setState({ planAutoApproveCountdown: remaining });
      }
    }, 1000);
  };

  _clearPlanAutoApprove = () => {
    if (this._planAutoTimer) { clearInterval(this._planAutoTimer); this._planAutoTimer = null; }
    if (!this._unmounted && this.state.planAutoApproveCountdown != null) {
      this.setState({ planAutoApproveCountdown: null });
    }
  };

  _firePlanAutoApprove = (planId) => {
    // 到点再校验一次：仍是同一个 pending plan、未被取消、ws 仍开。
    if (this.state.pendingPtyPlan?.id !== planId) return;
    if (this._planAutoCancelled.has(planId)) return;
    const ws = this._inputWs;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // 选批准项：优先用检测到的 plan prompt 选项做文本匹配，否则回退 option 1（与卡片按钮判定一致）。
    const planPrompt = this.state.ptyPromptHistory.slice().reverse().find(p => isPlanApprovalPrompt(p) && p.status === 'active');
    const approveNum = pickPlanApproveOptionNumber(planPrompt?.options || []);
    this.handlePromptOptionClick(approveNum);  // 复用同一入口：自带 _promptSubmitting / ws / _resolvedPlanIds 守卫
  };

  // 用户在倒计时期间点「取消」：记下该 plan id 不再重启，并停掉倒计时（保持待手动审批）。
  cancelPlanAutoApprove = () => {
    const id = this.state.pendingPtyPlan?.id;
    if (id) this._planAutoCancelled.add(id);
    this._clearPlanAutoApprove();
  };

  handlePromptOptionClick = (number) => {
    if (this._promptSubmitting) return;
    const ws = this._inputWs;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // ptyPrompt 可能为 null（ExitPlanMode 渲染后 PTY prompt 尚未检测到），
    // 回退到 ptyPromptHistory 中最近的 active prompt，或构造默认 prompt（光标在第1项）
    let prompt = this.state.ptyPrompt;
    if (!prompt) {
      prompt = this.state.ptyPromptHistory.slice().reverse().find(p => p.status === 'active')
        || { options: Array.from({ length: Math.max(number, 3) }, (_, i) => ({ number: i + 1, selected: i === 0 })) };
    }
    this._promptSubmitting = true;

    // Claude Code TUI 使用 Ink SelectInput，需要用箭头键移动光标再回车
    const options = prompt.options;
    const targetIdx = options.findIndex(o => o.number === number);
    let currentIdx = options.findIndex(o => o.selected);
    if (currentIdx < 0) currentIdx = 0;

    const diff = targetIdx - currentIdx;
    const arrowKey = diff > 0 ? '\x1b[B' : '\x1b[A';
    const steps = Math.abs(diff);

    const sendStep = (i) => {
      if (i < steps) {
        ws.send(JSON.stringify({ type: 'input', data: arrowKey }));
        setTimeout(() => sendStep(i + 1), 30);
      } else {
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'input', data: '\r' }));
          }
        }, 50);
      }
    };
    sendStep(0);

    // 标记历史中最后一个 active 为 answered
    this._ptyPrompt.setCurrent(null);
    // 用户已提交本轮 plan：把当前 pendingPtyPlan.id 加入 _resolvedPlanIds，
    // 防 PTY 答案到 JSONL 之间的窗口期 CDU 把 modal 重弹（lpid 仍指向同一 id 直到 tool_result 写入 planApprovalMap）。
    if (this.state.pendingPtyPlan?.id) {
      this._resolvedPlanIds.add(this.state.pendingPtyPlan.id);
    }
    this.setState(state => {
      const history = state.ptyPromptHistory.slice();
      const last = history[history.length - 1];
      if (last && last.status === 'active') {
        history[history.length - 1] = { ...last, status: 'answered', selectedNumber: number };
      }
      // Atomic clear of pendingPtyPlan so the global modal closes in lockstep with the inline state.
      return { ptyPrompt: null, ptyPromptHistory: history, pendingPtyPlan: null };
    });
    this._ptyPrompt.resetBufferAfterSubmit();
    setTimeout(() => { this._promptSubmitting = false; }, 500);
  };

  // Shift the next queued permission request into active position
  // 权限审批委托给 PermissionController（见 ./controllers/permissionController）。方法名不变，render/cDU 引用不动。
  handlePermissionAllow = (id) => this._permission.allow(id);
  handlePermissionAllowSession = (id) => this._permission.allowSession(id);
  handlePermissionDeny = (id) => this._permission.deny(id);

  handlePlanApprove = (id) => {
    const ws = this._inputWs;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'sdk-plan-answer', id, approve: true }));
    }
    this.setState({ pendingPlanApproval: null });
  };

  handlePlanReject = (id, feedback) => {
    const ws = this._inputWs;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'sdk-plan-answer', id, approve: false, feedback: feedback || '' }));
    }
    this.setState({ pendingPlanApproval: null });
  };

  handlePlanFeedbackSubmit = (number, text) => {
    const ws = this._inputWs;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    let prompt = this.state.ptyPrompt;
    if (!prompt) {
      prompt = this.state.ptyPromptHistory.slice().reverse().find(p => p.status === 'active')
        || { options: Array.from({ length: Math.max(number, 3) }, (_, i) => ({ number: i + 1, selected: i === 0 })) };
    }

    const options = prompt.options;
    const targetIdx = options.findIndex(o => o.number === number);
    let currentIdx = options.findIndex(o => o.selected);
    if (currentIdx < 0) currentIdx = 0;
    const diff = targetIdx - currentIdx;
    const arrowKey = diff > 0 ? '\x1b[B' : '\x1b[A';
    const steps = Math.abs(diff);

    const sendStep = (i) => {
      if (i < steps) {
        ws.send(JSON.stringify({ type: 'input', data: arrowKey }));
        setTimeout(() => sendStep(i + 1), 30);
      } else {
        // 回车选中选项
        setTimeout(() => {
          ws.send(JSON.stringify({ type: 'input', data: '\r' }));
          // 轮询等待 CLI 进入文本输入模式（buffer 变化说明已响应）
          const startBuf = this._ptyPrompt.getBuffer();
          let attempts = 0;
          const poll = () => {
            attempts++;
            if (attempts > 20 || this._ptyPrompt.getBuffer() !== startBuf) {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'input', data: text }));
                setTimeout(() => {
                  ws.send(JSON.stringify({ type: 'input', data: '\r' }));
                }, 50);
              }
              return;
            }
            setTimeout(poll, 100);
          };
          setTimeout(poll, 100);
        }, 50);
      }
    };
    sendStep(0);

    this._ptyPrompt.setCurrent(null);
    // 用户已提交 plan + feedback：守 modal 不被 CDU 重弹（同 handlePromptOptionClick 注释）
    if (this.state.pendingPtyPlan?.id) {
      this._resolvedPlanIds.add(this.state.pendingPtyPlan.id);
    }
    this.setState(state => {
      const history = state.ptyPromptHistory.slice();
      const last = history[history.length - 1];
      if (last && last.status === 'active') {
        history[history.length - 1] = { ...last, status: 'answered', selectedNumber: number };
      }
      // Atomic clear of pendingPtyPlan — modal closes together with inline state.
      return { ptyPrompt: null, ptyPromptHistory: history, pendingPtyPlan: null };
    });
    this._ptyPrompt.resetBufferAfterSubmit();
  };

  // 委托 → AskFlowController（handleAskCancel 是 public 入口：bubble handlers + ChatMessage props 引用）
  handleAskCancel = (askId, reason) => this._askFlow.handleAskCancel(askId, reason);

  /**
   * Send queued user message after ack received (or 500ms timeout best effort).
   * Extracted from handleInputSend so handleInputSend can short-circuit with ack-wait
   * when there's a pending ask to cancel first.
   *
   * skipUiState=true 用于 typed-interrupt 路径 — handleInputSend 已经先 setState pendingInput
   * 给用户即时反馈，flush 时不再重复 setState 浪费一次 commit + scrollToBottom 双触发。
   */
  _sendUserMessageImmediate = (text, textareaToReset, skipUiState) => {
    if (!text) return;
    const ws = this._inputWs;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // /clear 自身不解锁血条 lock（lock 是清空确认后由 AppBase.handleClearContextOptimistic 设置）；
    // 其他正常用户消息（包括 slash 命令）都视为「新请求」并解锁血条。
    if (!/^\s*\/clear(\s|$)/.test(text)) this.props.onUserMessageSent?.();
    if (this.props.sdkMode) {
      ws.send(JSON.stringify({ type: 'sdk-user-message', text }));
    } else {
      ws.send(JSON.stringify({ type: 'input', data: text }));
      setTimeout(() => {
        if (this._inputWs && this._inputWs.readyState === WebSocket.OPEN) {
          this._inputWs.send(JSON.stringify({ type: 'input', data: '\r' }));
        }
      }, 50);
    }
    if (textareaToReset) {
      textareaToReset.value = '';
      textareaToReset.style.height = 'auto';
    }
    if (!skipUiState) {
      this._clearPendingImages();
      this.setState({ inputEmpty: true, pendingInput: text, inputSuggestion: null }, () => this.scrollToBottom());
    }
  };

  // 委托 → AskFlowController
  handleAskQuestionSubmit = (answers, askId, questions) => this._askFlow.handleAskQuestionSubmit(answers, askId, questions);

  // 清除乐观停止标志 + 兜底定时器。收口 4 处重复（流式下降沿/上升沿、会话切换、发起新一轮）；
  // 各调用点自带触发条件，这里只统一做 timer + state 清理。
  _clearStopOptimistic = () => {
    clearTimeout(this._stopOptimisticTimer);
    this.setState({ stopOptimistic: false });
  };

  handleInputStop = () => {
    // Stop 取消「等上传完成的缓发」必须在 ws 早返之前——否则 ws 不 OPEN 时点停止,缓发不会被撤销。
    // 上传本身(HTTP)继续 resolve 进 pendingImages,无害,用户可稍后再发。
    this._clearDeferSend();
    if (!this._inputWs || this._inputWs.readyState !== WebSocket.OPEN) return;
    // Stop 应 halt 所有待发：清掉 typed-interrupt 武装的 pending-flush 队列（含 500ms 兜底 timer）。
    // 否则随后到达的 ask-hook-cancelled ack（本端 handleAskCancel 或服务端 interruptTurn 广播）会
    // takePendingFlush 把它发出去 —— 等于点了"停止"又自动发消息。与服务端 interruptTurn 清空
    // _messageQueue 同源（停止即丢弃在途待发）。
    if (this._pendingFlushQueue && this._pendingFlushQueue.length) {
      for (const entry of this._pendingFlushQueue) clearTimeout(entry.tid);
      this._pendingFlushQueue.length = 0;
    }
    // 按模式分流中断（与 _sendUserMessageImmediate 的 sdkMode 分流同源）：
    // SDK 模式模型不在 PTY 里，ESC 无效 → 发 sdk-interrupt 让服务端 close 当前 query（保留会话）；
    // CLI/PTY 模式 → ESC 打断 Claude TUI 当前生成。
    if (this.props.sdkMode) {
      this._inputWs.send(JSON.stringify({ type: 'sdk-interrupt' }));
    } else {
      // CLI/PTY 模式：ESC 打断 Claude TUI 当前生成。
      // 关键修复：点击 HTML 停止按钮会让隐藏的 xterm 失焦，向 claude 上报 focus-out (\x1b[O)，
      // 之后 claude(Ink) 会忽略 ESC（仅在「聚焦」时把 ESC 当中断）。所以先补一个 focus-in (\x1b[I)
      // 让 claude 认为终端已聚焦，再发 ESC —— 等价于在聚焦的终端里按 Esc（终端里按 Esc 本就有效）。
      this._inputWs.send(JSON.stringify({ type: 'input', data: '\x1b[I' }));
      setTimeout(() => {
        if (this._inputWs && this._inputWs.readyState === WebSocket.OPEN) {
          this._inputWs.send(JSON.stringify({ type: 'input', data: '\x1b' }));
        }
      }, STOP_FOCUS_IN_ESC_DELAY_MS);
    }
    // 乐观即时切非运行态：中断已即时发出，按钮无需等 AppBase 的 SSE+2s 才翻 false。
    this.setState({ stopOptimistic: true });
    clearTimeout(this._stopOptimisticTimer);
    // 兜底清除（见 STOP_OPTIMISTIC_FALLBACK_MS 注释）。正常路径由 isStreaming 下降沿/上升沿先清除。
    this._stopOptimisticTimer = setTimeout(() => this.setState({ stopOptimistic: false }), STOP_OPTIMISTIC_FALLBACK_MS);
  };

  handleInputSend = () => {
    const textarea = this._inputRef.current;
    if (!textarea) return;
    // 图片上传仍在途 → 不丢图:进入缓发态,等 uploadingItems 清零后由 componentDidUpdate 自动重跑本方法。
    // _deferSend 自身幂等(已 deferred 不重复武装),故第二次 Enter 也走这里 return,不会落到立即发送丢图。
    if (shouldDeferSend({ uploadingCount: this.state.uploadingItems.length })) {
      this._deferSend();
      return;
    }
    const userText = textarea.value.trim();
    // 拼接 pendingImages 路径到消息前面（发送时才注入，支持用户删除后不发）
    const imagePaths = this.state.pendingImages.map(img => `"${img.path.replace(/"/g, '')}"`).join(' ');
    const text = imagePaths ? (userText ? `${imagePaths} ${userText}` : imagePaths) : userText;
    if (!text) return;

    // 发起新一轮：清除可能仍挂着的乐观停止标志，确保新 run 的按钮正确显示为停止态。
    if (this.state.stopOptimistic) this._clearStopOptimistic();

    // 打字打断（typed-interrupt）：检测到当前有 pending AskUserQuestion 时，先发 ask-cancel
    // + 等 server ack（ask-hook-cancelled，SDK + Hook 双路统一）后再发 user message。
    // 等价 terminal Claude Code 的 screens/REPL.tsx:2137-2141 + handlePromptSubmit 的 abort+enqueue。
    // ack 协议防 race：cancel 必须在 user message 之前到 server，否则模型可能把 user message
    // 当 follow-up answer 处理。500ms 超时兜底（best effort，不卡死用户）。
    if (this.state.pendingAsk?.id && this._inputWs && this._inputWs.readyState === WebSocket.OPEN) {
      const askId = this.state.pendingAsk.id;
      // 先把 textarea 清空 + 收 pending images（与正常路径一致的视觉反馈）
      textarea.value = '';
      textarea.style.height = 'auto';
      this._clearPendingImages();
      this.setState({ inputEmpty: true, pendingInput: userText || imagePaths, inputSuggestion: null }, () => this.scrollToBottom());
      this.handleAskCancel(askId, 'Interrupted by user');
      // 数组队列代替 Map[askId] 索引：连续两次 typed-interrupt < 500ms 时（handleAskCancel 内
      // setState 还没 commit，第二次 handleInputSend 仍读到旧 askId），避免 Map.set(askId, ...)
      // 把第一条 prompt 静默覆盖。每个 entry 自带 tid 用于精确 clear / 配对 ack。
      if (!this._pendingFlushQueue) this._pendingFlushQueue = [];
      const tid = setTimeout(() => {
        if (this._unmounted) return;
        // 500ms 兜底：按 tid 找到自己 entry，flush 后移除（不用 askId 因可能已重复）
        const idx = this._pendingFlushQueue.findIndex(e => e.tid === tid);
        if (idx >= 0) {
          const entry = this._pendingFlushQueue.splice(idx, 1)[0];
          this._sendUserMessageImmediate(entry.text, null, true);
        }
      }, 500);
      this._pendingFlushQueue.push({ askId, text, tid });
      return;
    }

    this._sendUserMessageImmediate(text, textarea);
  };

  handleInputKeyDown = (e) => {
    if (e.key === 'Tab' && this.state.inputSuggestion) {
      e.preventDefault();
      const textarea = this._inputRef.current;
      if (textarea) {
        textarea.value = this.state.inputSuggestion;
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
      }
      this.setState({ inputSuggestion: null, inputEmpty: false });
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      this.handleInputSend();
    }
  };

  handleInputChange = (e) => {
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    const empty = !textarea.value.trim();
    this.setState({ inputEmpty: empty });
    if (this.state.inputSuggestion && !empty) {
      this.setState({ inputSuggestion: null });
    }
  };

  handleSuggestionToTerminal = () => {
    const text = this.state.inputSuggestion;
    if (!text || !this._inputWs || this._inputWs.readyState !== WebSocket.OPEN) return;
    this._inputWs.send(JSON.stringify({ type: 'input', data: text }));
    setTimeout(() => {
      if (this._inputWs && this._inputWs.readyState === WebSocket.OPEN) {
        this._inputWs.send(JSON.stringify({ type: 'input', data: '\r' }));
      }
    }, 50);
    this.setState({ inputSuggestion: null, pendingInput: text }, () => this.scrollToBottom());
  };

  handleUploadPath = (path) => {
    // 不插入 textarea，不立即注入 PTY — 仅添加到预览条，发送时再拼接路径
    this._addPendingImage(path, 'chat');
    if (this._inputWs && this._inputWs.readyState === WebSocket.OPEN) {
      this._inputWs.send(JSON.stringify({ type: 'image-upload-notify', path, source: 'chat' }));
    }
  };

  handleSplitMouseDown = (e) => this._splitDrag.onTerminalHandleDown(e);

  handleSidebarMouseDown = (e) => this._splitDrag.onSidebarHandleDown(e);

  // 文件详情 scroll 快照：FileContentView 内部 onScroll throttle 后调用；写 instance ref 不触发 re-render。
  // path 守卫：throttle 100ms 内用户切文件 / unmount cleanup flush 时旧实例可能发来旧 path 的 snap，
  // 这里单点拦下，独立于 React 生命周期时序（cdU vs effect cleanup 顺序），消除"跨文件污染"整类风险。
  handleUpdateFileScroll = (snap) => {
    if (snap && snap.path !== this.state.currentFile) return;
    this._fileScrollSnapshot = snap || null;
  };

  // FileContentView 消费一次后清空，避免下次 mount 又恢复。
  handleConsumeFileScroll = () => {
    this._fileScrollSnapshot = null;
  };

  // 给 FileContentView 拿快照的稳定闭包，避免每次 render 创建新引用。
  getFileScrollSnapshot = () => this._fileScrollSnapshot;

  // Track whether the open file has unsaved edits, so the Search/replace panel can skip it.
  // Path-guarded like handleUpdateFileScroll: a stale unmount of an old file must not clobber a
  // newer file's flag. Stored on an instance ref (no re-render).
  handleFileDirtyChange = (isDirty, path) => {
    if (isDirty) this._openFileDirty = normalizeProjectPath(path);
    else if (this._openFileDirty === normalizeProjectPath(path)) this._openFileDirty = null;
  };
  getOpenFileDirtyPath = () => this._openFileDirty || null;

  handleToggleExpandPath = (path) => {
    // capture projectName 到闭包：用户毫秒内切 workspace 时，callback 触发的写盘
    // 应该落到"toggle 发生时"那个项目的 key，不要被切换后的 props 牵走。
    const projectName = this.props.projectName;
    this.setState(state => {
      const newSet = new Set(state.fileExplorerExpandedPaths);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return { fileExplorerExpandedPaths: newSet };
    }, () => {
      saveExpandedPaths(projectName, this.state.fileExplorerExpandedPaths);
    });
  };

  // 点击工具调用中的文件路径，打开文件查看器
  // 绝对路径需要转为项目相对路径，以便与 FileExplorer 的 TreeNode 匹配
  handleMdImageClick = (e) => {
    const img = e.target.closest('.chat-md img');
    if (img && img.src) {
      e.preventDefault();
      this.setState({ mdLightboxSrc: img.src });
    }
  };

  handleOpenToolFilePath = async (filePath) => {
    if (!filePath) return;
    if (tryOpenWithSystem(filePath, 'chat-message')) return;
    let resolved = filePath;
    if (filePath.startsWith('/')) {
      // 懒加载项目目录（只请求一次，后续用缓存）
      if (!this._projectDirCache) {
        try {
          const r = await fetch(apiUrl('/api/project-dir'));
          if (r.ok) {
            const data = await r.json();
            if (data && data.dir) this._projectDirCache = data.dir;
          }
        } catch { /* ignore */ }
      }
      if (this._projectDirCache && filePath.startsWith(this._projectDirCache + '/')) {
        resolved = filePath.slice(this._projectDirCache.length + 1);
      }
    }
    // 计算所有祖先目录路径，加入 expandedPaths 以展开目录树
    const parts = resolved.split('/');
    const ancestors = [];
    for (let i = 1; i < parts.length; i++) {
      ancestors.push(parts.slice(0, i).join('/'));
    }
    // 移动端：通过回调打开 MobileFileExplorer
    if (this.props.onMobileOpenFile) {
      this.props.onMobileOpenFile(resolved, ancestors);
      return;
    }
    this._setFileExplorerOpen(true);
    this.setState(prev => {
      const newSet = new Set(prev.fileExplorerExpandedPaths);
      ancestors.forEach(p => newSet.add(p));
      return {
        currentFile: resolved,
        currentGitDiff: null,
        scrollToLine: null,
        gitChangesOpen: false,
        fileExplorerExpandedPaths: newSet,
      };
    });
  };

  _handleInsertPathToChat = (filePath) => {
    const quoted = `"${filePath}"`;
    // 终端开启时写入终端，否则写入对话输入框
    if (this.props.terminalVisible && this._inputWs && this._inputWs.readyState === WebSocket.OPEN) {
      this._inputWs.send(JSON.stringify({ type: 'input', data: quoted }));
      return;
    }
    const textarea = this._inputRef.current;
    if (!textarea) return;
    const cur = textarea.value;
    textarea.value = cur ? `${cur} ${quoted}` : quoted;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    this.setState({ inputEmpty: false });
    textarea.focus();
  };

  // Guarded width persistence shared by the drag-controller host and _snapToInitialPosition.
  _persistWidth(key, px) {
    try { localStorage.setItem(key, String(px)); } catch {}
  }

  _snapToInitialPosition() {
    // 初始化时吸附到 60cols
    const targetCols = 60;
    const terminalPx = targetCols * TERMINAL_CHAR_WIDTH; // 468px

    this.setState({ terminalWidth: terminalPx, needsInitialSnap: false });
    this._persistWidth(TERMINAL_WIDTH_STORAGE_KEY, terminalPx);
  }

  _renderNavSidebar(showFileExplorerAndGit) {
    return (
      <div className={styles.navSidebar}>
        <button
          className={this.state.roleFilterOpen ? styles.navBtnActive : styles.navBtn}
          onClick={() => this.setState(prev => prev.roleFilterOpen ? { roleFilterOpen: false, roleFilterSelected: new Set() } : { roleFilterOpen: true })}
          title={t('ui.roleFilter')}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
          </svg>
        </button>
        {showFileExplorerAndGit && (
          <button
            className={this.state.fileExplorerOpen ? styles.navBtnActive : styles.navBtn}
            onClick={() => { this._setFileExplorerOpen(!this.state.fileExplorerOpen); this.setState({ gitChangesOpen: false, searchOpen: false }); }}
            title={t('ui.fileExplorer')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2z"/>
            </svg>
          </button>
        )}
        {showFileExplorerAndGit && this.state.hasGit && (
          <button
            className={this.state.gitChangesOpen ? styles.navBtnActive : styles.navBtn}
            onClick={() => this.setState(prev => {
              this._setFileExplorerOpen(false);
              const opening = !prev.gitChangesOpen;
              const next = { gitChangesOpen: opening, searchOpen: false };
              // 关闭期间累积的修改信号在打开瞬间消费一次（与 fileExplorer 对称）
              if (opening && this._pendingGitRefresh) {
                this._pendingGitRefresh = false;
                next.gitChangesRefresh = (prev.gitChangesRefresh || 0) + 1;
              }
              return next;
            })}
            title={t('ui.gitChanges')}
          >
            <svg width="24" height="24" viewBox="0 0 1024 1024" fill="currentColor">
              <path d="M759.53332137 326.35000897c0-48.26899766-39.4506231-87.33284994-87.87432908-86.6366625-46.95397689 0.69618746-85.08957923 39.14120645-85.39899588 86.09518335-0.23206249 40.68828971 27.53808201 74.87882971 65.13220519 84.47074592 10.82958281 2.78474987 18.41029078 12.37666607 18.64235327 23.51566553 0.38677082 21.11768647-3.40358317 44.40128953-17.24997834 63.81718442-22.20064476 31.17372767-62.42480948 42.46743545-97.93037026 52.44612248-22.43270724 6.26568719-38.75443563 7.89012462-53.14230994 9.28249954-20.42149901 2.01120825-39.76003975 3.94506233-63.89453858 17.79145747-5.10537475 2.93945818-10.13339535 6.18833303-14.85199928 9.74662453-4.09977063 3.09416652-9.90133285 0.15470833-9.90133286-4.95066641V302.60228095c0-9.43720788 5.26008307-18.17822829 13.69168683-22.3553531 28.69839444-14.23316598 48.42370599-43.93716454 48.19164353-78.20505872-0.38677082-48.57841433-41.15241468-87.71962076-89.730829-86.01782918C338.80402918 117.57112321 301.59667683 155.70672553 301.59667683 202.58334827c0 34.03583169 19.64795738 63.50776777 48.1916435 77.66357958 8.43160375 4.17712479 13.69168685 12.76343689 13.69168684 22.12329062v419.02750058c0 9.43720788-5.26008307 18.17822829-13.69168684 22.3553531-28.69839444 14.23316598-48.42370599 43.93716454-48.1916435 78.20505872 0.30941665 48.57841433 41.07506052 87.6422666 89.65347484 86.01782918C437.74000359 906.42887679 474.87000179 868.2159203 474.87000179 821.41665173c0-34.03583169-19.64795738-63.50776777-48.1916435-77.66357958-8.43160375-4.17712479-13.69168685-12.76343689-13.69168684-22.12329062v-14.85199926c0-32.48874844 15.39347842-63.27570528 42.00331048-81.91805854 2.39797906-1.70179159 4.95066642-3.32622901 7.50335379-4.79595812 14.92935344-8.58631209 25.91364457-9.66927037 44.09187287-11.4484161 15.62554091-1.54708326 35.04143581-3.48093734 61.65126786-10.90693699 39.06385228-10.98429114 92.51557887-25.91364457 124.84961898-71.39789238 18.56499911-26.06835292 27.38337367-58.01562219 26.37776956-95.14562041-0.15470833-5.33743724-0.54147915-10.67487447-1.08295828-16.16702004-0.85089578-8.27689543 2.70739569-16.24437421 9.12779121-21.50445729 19.57060322-15.78024923 32.02462345-39.99210223 32.02462345-67.14341343zM351.1033411 202.58334827c0-20.49885317 16.63114503-37.12999821 37.1299982-37.1299982s37.12999821 16.63114503 37.12999821 37.1299982-16.63114503 37.12999821-37.12999821 37.1299982-37.12999821-16.63114503-37.1299982-37.1299982z m74.25999641 618.83330346c0 20.49885317-16.63114503 37.12999821-37.12999821 37.1299982s-37.12999821-16.63114503-37.1299982-37.1299982 16.63114503-37.12999821 37.1299982-37.1299982 37.12999821 16.63114503 37.12999821 37.1299982z m247.53332139-457.93664456c-20.49885317 0-37.12999821-16.63114503-37.1299982-37.1299982s16.63114503-37.12999821 37.1299982-37.12999821 37.12999821 16.63114503 37.1299982 37.12999821-16.63114503 37.12999821-37.1299982 37.1299982z"/>
            </svg>
          </button>
        )}
        {showFileExplorerAndGit && (
          <button
            className={this.state.searchOpen ? styles.navBtnActive : styles.navBtn}
            onClick={() => this.setState(prev => {
              if (prev.searchOpen) return { searchOpen: false };
              this._setFileExplorerOpen(false);
              return { searchOpen: true, gitChangesOpen: false };
            })}
            title={t('ui.search')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/>
              <path d="m21 21-4.3-4.3"/>
            </svg>
          </button>
        )}
        <div className={styles.navDivider} aria-hidden="true" />
        <Popover
          content={() => (
            // 上下各留 24px：顶部贴标题栏，底部留出工具栏 / chat input 视觉余量，
            // 避免窄屏 + 长内容时 popup 紧贴底部 footer 区域
            <div style={{ maxHeight: 'calc(100vh - 48px)', overflowY: 'auto', overflowX: 'hidden' }}>
              {this.props.getTokenStatsContent?.(this._closeTokenStatsPopover)}
            </div>
          )}
          trigger="hover"
          open={this.state.tokenStatsPopoverOpen}
          onOpenChange={(o) => this.setState({ tokenStatsPopoverOpen: o })}
          placement="right"
          arrow={{ pointAtCenter: true }}
          autoAdjustOverflow={false}
          align={{ overflow: { adjustX: true, shiftY: true } }}
          overlayInnerStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-hover)', borderRadius: 8, padding: '8px 8px' }}
        >
          <button className={styles.navBtn} title={t('ui.tokenStats')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 14l4-4"/>
              <path d="M3.34 19a10 10 0 1 1 17.32 0"/>
            </svg>
          </button>
        </Popover>
        <TeamButton requests={this.props.requests} onOpenSession={(session) => this.setState({ teamModalSession: session })} navBtnClass={styles.navBtn} />
        <WorkflowButton requests={this.props.requests} onOpenRun={(run) => this.setState({ workflowModalRun: run })} navBtnClass={styles.navBtn} />
        <Popover
          content={this._buildUserPromptNav()}
          trigger="hover"
          placement="right"
          arrow={{ pointAtCenter: true }}
          autoAdjustOverflow={false}
          align={{ overflow: { adjustX: true, shiftY: true } }}
          overlayStyle={{ maxWidth: 400 }}
          overlayInnerStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-light)', padding: 0 }}
        >
          <button className={styles.navBtn} title={t('ui.userPromptNav')}>
            <img
              src={this.props.userProfile?.avatar || defaultAvatarUrl}
              className={styles.navAvatarImg}
              alt="User"
              onError={(e) => { e.target.onerror = null; e.target.src = defaultAvatarUrl; }}
            />
          </button>
        </Popover>
      </div>
    );
  }

  /**
   * 构建用户 Prompt 导航列表（侧边栏 hover popover 内容）
   * 基于 _currentVisible（当前可见 items），保证每一项都能精确定位和高亮
   */
  _buildUserPromptNav() {
    const visible = this._currentVisible;
    if (!visible || visible.length === 0) return null;

    // 缓存：visible 引用未变化时复用上次结果
    if (this._navCacheVisible === visible && this._navCacheResult) return this._navCacheResult;

    // 纯逻辑（会话边界标记 / 去重 / 图片清理 / 无 ts 容错）抽到 utils/promptNav，便于单测；此处只管缓存与渲染。
    const prompts = buildPromptNavItems(visible, this.props.mainAgentSessions);
    if (prompts.length === 0) { this._navCacheVisible = visible; this._navCacheResult = null; return null; }

    const result = (
      <div className={styles.userPromptNavWrap}>
        <div className={styles.userPromptNavTitle}>{t('ui.userPromptNav')} ({prompts.length})</div>
        <div className={styles.userPromptNavList}>
          {prompts.map((p) => {
            const timeStr = formatPromptNavTime(p.timestamp);
            return (
              <React.Fragment key={p.visibleIdx}>
                {p.newSession && (
                  <div className={styles.userPromptNavSessionSep}><span>{t('ui.session')}</span></div>
                )}
                <div className={styles.userPromptNavItem}
                  onClick={() => this._scrollToUserPrompt(p.visibleIdx, p.timestamp)}>
                  {timeStr && <span className={styles.userPromptNavTime}>{timeStr}</span>}
                  <span className={styles.userPromptNavText}>{p.display}</span>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    );
    this._navCacheVisible = visible;
    this._navCacheResult = result;
    return result;
  }

  /**
   * 滚动到指定用户消息，并触发蓝色虚线高亮动画。
   * @param {number} visibleIdx — visible 数组中的索引（与 containerRef.children 一一对应）
   * @param {string|null} timestamp — 消息时间戳（用于高亮，遗留消息可能为 null）
   */
  _scrollToUserPrompt(visibleIdx, timestamp) {
    if (visibleIdx == null || visibleIdx < 0) return;
    // 触发高亮（有 timestamp 时显示蓝色虚线动画）
    if (timestamp) {
      this.setState({ highlightTs: timestamp, highlightFading: false, highlightVisibleIdx: visibleIdx }, () => {
        this._doScrollToVisibleIdx(visibleIdx);
        this._scrollHighlight.bind();
      });
    } else {
      // 无 timestamp 的遗留消息：仅滚动，不触发高亮
      this._doScrollToVisibleIdx(visibleIdx);
    }
  }

  _doScrollToVisibleIdx(idx) {
    if (useVirtuoso && this.virtuosoRef.current) {
      this.virtuosoRef.current.scrollToIndex({ index: idx, align: 'center', behavior: 'smooth' });
    } else {
      const el = this.containerRef.current;
      if (el && el.children[idx]) {
        el.children[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  render() {
    const { mainAgentSessions, cliMode, terminalVisible, onToggleTerminal } = this.props;
    const { allItems, visibleCount, loading, terminalWidth, sidebarWidth, lastResponseItems } = this.state;
    const streamSpinnerUrl = this._streamSpinnerUrl || shimmerUrl;

    // 计算 SnapLineOverlay 的 currentLeft（侧栏拖拽时用侧栏宽度，终端拖拽时用终端位置）
    let snapCurrentLeft = 0;
    if (this.state.isDragging) {
      if (this._splitDrag.dragTarget() === 'sidebar') {
        snapCurrentLeft = sidebarWidth;
      } else if (this._splitDrag.dragTarget() === 'terminal') {
        const c = this.innerSplitRef.current;
        if (c) snapCurrentLeft = c.getBoundingClientRect().width - terminalWidth - RESIZER_WIDTH_PX;
      }
    }

    const noMainAgent = !mainAgentSessions || mainAgentSessions.length === 0;
    // 仅展示当前会话开启、且当前 session 暂无可渲染项（如 /clear 后新 session 首条消息尚未到达）时，
    // 复用既有空/加载占位，避免空白面板（下方 fileLoading 守卫已在初始加载期抑制 Empty→内容 闪烁）。
    const noData = (!allItems || allItems.length === 0) && (noMainAgent || this.props.onlyCurrentSession);

    if (noData && !cliMode) {
      // 初始 SSE 加载期间不显示"暂无对话"，避免 Empty→内容 的两阶段闪烁
      if (this.props.fileLoading) {
        return null;
      }
      return (
        <div className={styles.centerEmpty}>
          <Empty description={t('ui.noChat')} />
        </div>
      );
    }

    if (loading && !cliMode) {
      return (
        <div className={styles.centerEmpty}>
          <Spin size="large" />
        </div>
      );
    }

    // --- 角色收集 + 筛选 ---
    const collectedRolesMap = new Map();
    const userProfile = this.props.userProfile;
    const modelInfo = this._reqScanCache ? getModelInfo(this._reqScanCache.modelName) : null;
    for (const item of allItems) {
      if (!item || !item.props) continue;
      const role = item.props.role;
      if (role === 'user' || role === 'plan-prompt') {
        if (!collectedRolesMap.has('user')) {
          collectedRolesMap.set('user', { key: 'user', name: userProfile?.name || 'User', avatarType: 'user', color: 'rgba(255,255,255,0.1)', avatarImg: userProfile?.avatar || null });
        }
      } else if (role === 'assistant') {
        if (!collectedRolesMap.has('assistant')) {
          collectedRolesMap.set('assistant', { key: 'assistant', name: modelInfo?.short || modelInfo?.name || 'Claude', avatarType: 'agent', color: modelInfo?.color || 'rgba(255,255,255,0.1)', avatarSvg: modelInfo?.svg || null });
        }
      } else if (role === 'system') {
        if (!collectedRolesMap.has('system')) {
          collectedRolesMap.set('system', { key: 'system', name: t('ui.systemMessage'), avatarType: 'system', color: 'rgba(255,255,255,0.1)' });
        }
      } else if (role === 'sub-agent-chat') {
        const label = item.props.label || 'SubAgent';
        const key = `sub:${label}`;
        if (!collectedRolesMap.has(key)) {
          const isTeammate = item.props.isTeammate;
          let avatarType = 'sub';
          if (isTeammate) {
            avatarType = 'teammate';
          } else {
            const match = label.match(/SubAgent:\s*(\w+)/i);
            const st = match ? match[1].toLowerCase() : '';
            if (st === 'explore' || st === 'search') avatarType = 'sub-search';
            else if (st === 'plan') avatarType = 'sub-plan';
          }
          const tmA = isTeammate ? getTeammateAvatar(label, { animated: false }) : null;
          collectedRolesMap.set(key, { key, name: label.length > 12 ? label.slice(0, 12) + '…' : label, avatarType, avatarSvg: tmA ? tmA.svg : undefined, color: tmA ? tmA.color : 'rgba(255,255,255,0.1)' });
        }
      }
    }
    const collectedRoles = Array.from(collectedRolesMap.values());

    let filteredItems = allItems;
    const _selSize = this.state.roleFilterSelected.size;
    if (_selSize > 0 && _selSize < collectedRoles.length) {
      filteredItems = allItems.filter(item => {
        if (!item || !item.props) return true;
        const role = item.props.role;
        if (role === 'user' || role === 'plan-prompt') return this.state.roleFilterSelected.has('user');
        if (role === 'assistant') return this.state.roleFilterSelected.has('assistant');
        if (role === 'system') return this.state.roleFilterSelected.has('system');
        if (role === 'sub-agent-chat') {
          const key = `sub:${item.props.label || 'SubAgent'}`;
          return this.state.roleFilterSelected.has(key);
        }
        return false;
      });
    }

    const _isFiltering = _selSize > 0 && _selSize < collectedRoles.length;
    let filteredLastResponseItems = lastResponseItems && _isFiltering && !this.state.roleFilterSelected.has('assistant') ? null : lastResponseItems;

    // Live streaming overlay: 实时打字机效果，独立于 mainAgentSessions / dedup 路径
    // 仅显示 text + thinking blocks（tool_use 由最终 entry 通过 Last Response 渲染）。
    // roleFilter 反选 assistant 时跳过 overlay 以遵从过滤语义（否则一边过滤一边仍实时输出自相矛盾）。
    let streamingLiveItem = null;
    const _assistantFilteredOut = _isFiltering && !this.state.roleFilterSelected.has('assistant');
    // 乐观停止：点「停止」后即时停掉实时打字机浮层，避免按钮/页内指示器已切非运行态、
    // 而中断落地前的残余 SSE chunk 仍在 overlay 里继续吐字（自相矛盾）。
    // pin 锁在更早会话时（sessionUpperBoundTs != null），streaming 来自未展示的更新会话，
    // 不应把它的实时浮层叠在 pin 会话底部（会显示用户根本没看的会话内容）。
    if (this.props.streamingLatest && !_assistantFilteredOut && !this.state.stopOptimistic && this.props.sessionUpperBoundTs == null) {
      const sl = this.props.streamingLatest;
      const liveBlocks = (sl.content || []).filter(b =>
        b.type === 'text' || b.type === 'thinking'
      );
      const hasVisibleContent = liveBlocks.some(b => {
        if (b.type === 'text') return typeof b.text === 'string' && b.text.trim().length > 0;
        if (b.type === 'thinking') return typeof b.thinking === 'string' && b.thinking.trim().length > 0;
        return false;
      });
      if (hasVisibleContent) {
        // SSE streaming 消息的 modelInfo：继承"上一次已完成的 MainAgent model"，
        // 而非当前正在进行中的 request.body.model（后者可能还没被扫到或不稳定）。
        // completedModelName 仅在 req.response 存在时更新，流式期间永远指向上一次已完成模型。
        // fallback 到 modelName 只是为了冷启动（从未有已完成请求时的边界情况）。
        const cache = this._reqScanCache;
        const streamingModelInfo = cache ? getModelInfo(cache.completedModelName || cache.modelName) : null;
        streamingLiveItem = (
          <ChatMessage
            key="streaming-live-msg"
            role="assistant"
            content={liveBlocks}
            timestamp={sl.timestamp}
            modelInfo={streamingModelInfo}
            collapseToolResults={this.props.collapseToolResults}
            expandThinking={this.props.expandThinking}
            showFullToolContent={this.props.showFullToolContent}
            showTrailingCursor={true}
            toolResultMap={EMPTY_MAP}
            isHistoryLog={this._getIsHistoryLog()}
          />
        );
        // 方案 D：保留 Last Response（上一轮）显示让用户能对比参考，仅通过 CSS 隐藏
        // "---Last Response---" Divider 标识避免与 overlay 的"正在生成"语义重复。
        // 两处渲染点（Virtuoso Footer 与非 Virtuoso 容器）把 filteredLastResponseItems
        // 外包一层条件 div (styles.hideLastResponseDivider)，子 CSS display:none 掉 Divider。
      }
    }

    // 仅在 streaming 或淡出期间挂 <img>，避免 ChatView 冷加载就 fetch 76KB 的 shimmer + orbiting。
    // streamingFading 由 isStreaming true→false 时拉起 500ms（line ~551），覆盖淡出动画窗口。
    // 乐观停止：点「停止」后立即按非运行态渲染（按钮 + 页内指示器），无需等 AppBase 的 SSE+2s。
    const uiStreaming = this.props.isStreaming && !this.state.stopOptimistic;
    const showSpinner = uiStreaming || this.state.streamingFading;
    const spinnerNode = showSpinner ? (
      <div className={`${styles.streamingSpinnerWrap}${(!uiStreaming || streamingLiveItem) ? ' ' + styles.streamingSpinnerHidden : ''}`}>
        <object type="image/svg+xml" data={streamSpinnerUrl} width="20" height="20" aria-hidden="true" tabIndex={-1} />
      </div>
    ) : null;

    const targetIdx = this._scrollTargetIdx;
    const { highlightTs, highlightFading, highlightVisibleIdx } = this.state;
    const visible = filteredItems.slice(0, _isFiltering ? filteredItems.length : visibleCount);
    // 缓存 visible，供 _buildUserPromptNav / _scrollToUserPrompt 使用
    this._currentVisible = visible;
    // 优先使用精确的 visibleIdx（同一请求的多条消息共享 timestamp，findIndex 会匹配到第一条）
    // findIndex 用 displayTs ?? timestamp 作 key —— assistant bubble 的 props.timestamp 是 carrier
    // (= 下一次 entry 的 ts)，而 highlightTs 来自 scrollToTimestamp (= request 自身 ts)；只看 timestamp
    // 会让 assistant bubble 永远匹配不上，蓝色虚线选框落到错位的 bubble。displayTs 恰好就是 _generatedTs
    // (producer request 的 ts)，跟 highlightTs 同源。其他 role 没 displayTs 自动 fallback 到 timestamp。
    const highlightIdx = highlightVisibleIdx >= 0 && highlightVisibleIdx < visible.length
      ? highlightVisibleIdx
      : (highlightTs != null ? visible.findIndex(item => (item.props?.displayTs || item.props?.timestamp) === highlightTs) : -1);

    const { pendingInput, stickyBottom, ptyPromptHistory } = this.state;

    const pendingBubble = cliMode && pendingInput ? (
      <ChatMessage key="pending-input" role="user" text={pendingInput} lang={this.props.lang} timestamp={new Date().toISOString()} userProfile={this.props.userProfile} isHistoryLog={false} />
    ) : null;

    const stickyBtn = !stickyBottom ? (
      <button className={styles.stickyBottomBtn} onClick={this.handleStickToBottom}>
        {uiStreaming && <img src={loadingPetUrl} className={styles.loadingPet} alt="" />}
        <span>{t('ui.stickyBottom')}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
    ) : null;

    const loadMoreBtn = this._mobileSliceOffset > 0 ? (
      <div className={styles.loadMoreWrap}>
        {this.props.isLocalLog ? (
          // logfile 只读模式自动渐进扩窗中：展示加载态而非可点按钮（_maybeScheduleLocalLogAutoFill 驱动）
          <div className={`${styles.loadMoreBtn} ${styles.loadMoreBtnLoading}`}>
            <span className={styles.loadMoreSpinner} />
            {t('ui.loadingMoreHistory')}
          </div>
        ) : (
          <button className={styles.loadMoreBtn} onClick={this.handleLoadMore}>
            {t('ui.loadMoreHistory', { count: this._mobileSliceOffset })}
          </button>
        )}
      </div>
    ) : null;

    const roleFilterBar = this.state.roleFilterOpen && collectedRoles.length > 0 ? (
      <RoleFilterBar roles={collectedRoles} selectedRoles={this.state.roleFilterSelected} onToggle={(key) => this.setState(prev => {
        const next = new Set(prev.roleFilterSelected);
        next.has(key) ? next.delete(key) : next.add(key);
        return { roleFilterSelected: next };
      })} />
    ) : null;

    const messageList = (noData || loading) ? (
      <div className={styles.messageListWrap}>
        <div ref={this.containerRef} className={styles.container}>
          {(!cliMode || loading) ? (
            <div className={styles.centerEmpty}>
              {loading ? <Spin size="large" /> : <Empty description={t('ui.noChat')} />}
            </div>
          ) : null}
          {pendingBubble}
        </div>
        {stickyBtn}
      </div>
    ) : (
      <div className={styles.messageListWrap} onClick={this.handleMdImageClick}>
        {roleFilterBar}
        {this.state.mdLightboxSrc && (
          <ImageLightbox src={this.state.mdLightboxSrc} alt="" onClose={() => this.setState({ mdLightboxSrc: null })} />
        )}
        {useVirtuoso ? (
          this._virtuosoHeader = loadMoreBtn,
          this._virtuosoFooter = <>
            {spinnerNode}
          {filteredLastResponseItems && (
            <div className={streamingLiveItem ? styles.hideLastResponseDivider : undefined}>
              {filteredLastResponseItems}
            </div>
          )}{pendingBubble}{streamingLiveItem && (
            !filteredLastResponseItems && targetIdx != null && targetIdx >= visible.length
              ? <div key="stream-resp-anchor" ref={this._scrollTargetRef}>{streamingLiveItem}</div>
              : streamingLiveItem
          )}</>,
          <Virtuoso
            ref={this.virtuosoRef}
            className={styles.mobileVirtuoso}
            data={visible}
            initialTopMostItemIndex={Math.max(0, visible.length - 1)}
            followOutput={this.state.stickyBottom && !this.state.userScrolling ? 'auto' : false}
            atBottomStateChange={(atBottom) => this._stickyController.notifyAtBottom(atBottom)}
            atBottomThreshold={60}
            increaseViewportBy={{ top: 200, bottom: 200 }}
            computeItemKey={(index) => visible[index]?.key || `v-${index}`}
            itemContent={(index) => {
              const item = visible[index];
              const isScrollTarget = index === targetIdx;
              const needsHighlight = index === highlightIdx;
              let el = item;
              if (needsHighlight) el = React.cloneElement(el, { highlight: highlightFading ? 'fading' : 'active' });
              return isScrollTarget ? <div ref={this._scrollTargetRef}>{el}</div> : el;
            }}
            scrollerRef={(ref) => { this._virtuosoScrollerEl = ref; this._stickyController.bind(ref); }}
            context={{ header: this._virtuosoHeader, footer: this._virtuosoFooter }}
            components={this._virtuosoComponents || (this._virtuosoComponents = {
              Scroller: VirtuosoScroller,
              Header: ({ context }) => context.header,
              Footer: ({ context }) => context.footer,
            })}
          />
        ) : (
          <div
            ref={this.containerRef}
            className={styles.container}
          >
            {loadMoreBtn}
            {visible.map((item, i) => {
              const isScrollTarget = i === targetIdx;
              const needsHighlight = i === highlightIdx;
              let el = item;
              if (needsHighlight) {
                el = React.cloneElement(el, { highlight: highlightFading ? 'fading' : 'active' });
              }
              return isScrollTarget
                ? <div key={item.key + '-anchor'} ref={this._scrollTargetRef}>{el}</div>
                : el;
            })}
            {spinnerNode}
            {filteredLastResponseItems && (
              <div className={streamingLiveItem ? styles.hideLastResponseDivider : undefined}>
                {targetIdx != null && targetIdx >= visible.length
                  ? <div key="last-resp-anchor" ref={this._scrollTargetRef}>{filteredLastResponseItems}</div>
                  : filteredLastResponseItems}
              </div>
            )}
            {pendingBubble}
            {streamingLiveItem && (
              !filteredLastResponseItems && targetIdx != null && targetIdx >= visible.length
                ? <div key="stream-resp-anchor" ref={this._scrollTargetRef}>{streamingLiveItem}</div>
                : streamingLiveItem
            )}
          </div>
        )}
        {stickyBtn}
      </div>
    );

    if (!cliMode) {
      return (<>
        <div className={styles.splitContainer}>
          {this._renderNavSidebar(false)}
          <div className={styles.navSidebarContent}>
            {messageList}
          </div>
        </div>
        <TeamModal session={this.state.teamModalSession} requests={this.props.requests} mainAgentSessions={this.props.mainAgentSessions} collapseToolResults={this.props.collapseToolResults} expandThinking={this.props.expandThinking} showFullToolContent={this.props.showFullToolContent} userProfile={this.props.userProfile} onViewRequest={this.props.onViewRequest} isHistoryLog={this._getIsHistoryLog()} lang={this.props.lang} onClose={() => this.setState({ teamModalSession: null })} />
        <WorkflowRunsModal run={this.state.workflowModalRun} onClose={() => this.setState({ workflowModalRun: null })} />
      </>);
    }

    return (<>
      <div ref={this.splitContainerRef} className={styles.splitContainer}>
        {this._renderNavSidebar(true)}
        <div className={styles.innerSplitArea} ref={this.innerSplitRef}>
          <SnapLineOverlay isDragging={this.state.isDragging} activeSnapLine={this.state.activeSnapLine} snapLines={this.state.snapLines} currentLeft={snapCurrentLeft} />
          {this.state.fileExplorerOpen && (
            <FileExplorer
              style={{ width: this.state.sidebarWidth }}
              refreshTrigger={this.state.fileExplorerRefresh}
              onManualRefresh={() => this.setState(prev => ({ fileExplorerRefresh: prev.fileExplorerRefresh + 1 }))}
              onClose={() => this._setFileExplorerOpen(false)}
              onFileClick={(path) => {
                if (tryOpenWithSystem(path, 'file-explorer')) return;
                this.setState({ currentFile: path, currentGitDiff: null, scrollToLine: null, scrollToMatch: null });
              }}
              expandedPaths={this.state.fileExplorerExpandedPaths}
              onToggleExpand={this.handleToggleExpandPath}
              currentFile={this.state.currentFile}
              onAttachToChat={(filePath) => this._addPendingImage(filePath, 'explorer')}
              onInsertPathToChat={this._handleInsertPathToChat}
              onFileRenamed={(oldPath, newPath) => {
                this.setState(prev => ({
                  currentFile: prev.currentFile === oldPath ? newPath : prev.currentFile,
                  fileExplorerRefresh: prev.fileExplorerRefresh + 1,
                }));
              }}
            />
          )}
          {this.state.gitChangesOpen && (
            <GitChanges
              style={{ width: this.state.sidebarWidth }}
              refreshTrigger={this.state.gitChangesRefresh}
              onManualRefresh={() => this.setState(prev => ({ gitChangesRefresh: prev.gitChangesRefresh + 1 }))}
              projectName={this.props.projectName}
              onClose={() => this.setState({ gitChangesOpen: false })}
              onFileClick={(repoPath, filePath, commitHash) => {
                const resolvedPath = repoPath && repoPath !== '.' ? `${repoPath}/${filePath}` : filePath;
                if (tryOpenWithSystem(resolvedPath, 'git-changes')) return;
                this.setState({ currentGitDiff: { repo: repoPath, file: filePath, commit: commitHash || null }, currentFile: null });
              }}
              onOpenFile={(repoPath, filePath) => {
                const resolvedPath = repoPath && repoPath !== '.' ? `${repoPath}/${filePath}` : filePath;
                if (tryOpenWithSystem(resolvedPath, 'git-changes')) return;
                const parts = resolvedPath.split('/');
                const ancestors = [];
                for (let i = 1; i < parts.length; i++) ancestors.push(parts.slice(0, i).join('/'));
                this._setFileExplorerOpen(true);
                const projectName = this.props.projectName;
                this.setState(prev => {
                  const newSet = new Set(prev.fileExplorerExpandedPaths);
                  ancestors.forEach(p => newSet.add(p));
                  return { currentGitDiff: null, currentFile: resolvedPath, scrollToLine: null, scrollToMatch: null, gitChangesOpen: false, fileExplorerExpandedPaths: newSet };
                }, () => {
                  saveExpandedPaths(projectName, this.state.fileExplorerExpandedPaths);
                });
              }}
            />
          )}
          {this.state.searchOpen && (
            <SearchPanel
              style={{ width: this.state.sidebarWidth }}
              projectName={this.props.projectName}
              onClose={() => this.setState({ searchOpen: false })}
              getDirtyPath={this.getOpenFileDirtyPath}
              onReplaceApplied={(files) => {
                this.setState(prev => ({ fileExplorerRefresh: prev.fileExplorerRefresh + 1 }));
                const cur = normalizeProjectPath(this.state.currentFile);
                if (cur && files.some(f => normalizeProjectPath(f) === cur)) {
                  // Reload the open (non-dirty — dirty is skipped) viewer to show replaced content.
                  this.setState(prev => ({ fileVersion: (prev.fileVersion || 0) + 1 }));
                }
              }}
              onOpenResult={(path, line, range) => {
                if (tryOpenWithSystem(path, 'search')) return;
                // Opening a result finishes any active $EDITOR session (mirrors the viewer's
                // onClose) so the blocked terminal editor is released, not orphaned.
                if (this.state.editorSessionId) {
                  fetch(apiUrl('/api/editor-done'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId: this.state.editorSessionId }),
                  }).catch(() => {});
                }
                this.setState({
                  currentFile: path,
                  scrollToLine: line || 1,
                  scrollToMatch: range || null,
                  currentGitDiff: null,
                  editorSessionId: null,
                  editorFilePath: null,
                  fileVersion: 0,
                });
              }}
            />
          )}
          {(this.state.fileExplorerOpen || this.state.gitChangesOpen || this.state.searchOpen) && (
            <div className={styles.vResizer} onMouseDown={this.handleSidebarMouseDown} />
          )}
          <div className={styles.chatSection}>
            <div className={styles.chatSectionFlex}>
            {this.state.currentGitDiff && (
              <div className={styles.overlayPanel}>
                <GitDiffView
                  filePath={this.state.currentGitDiff.file}
                  repoPath={this.state.currentGitDiff.repo}
                  commitHash={this.state.currentGitDiff.commit || null}
                  onClose={() => this.setState({ currentGitDiff: null })}
                  onOpenFile={(path, line) => {
                    const repo = this.state.currentGitDiff?.repo;
                    const resolvedPath = repo && repo !== '.' ? `${repo}/${path}` : path;
                    if (tryOpenWithSystem(resolvedPath, 'git-diff')) return;
                    const parts = resolvedPath.split('/');
                    const ancestors = [];
                    for (let i = 1; i < parts.length; i++) {
                      ancestors.push(parts.slice(0, i).join('/'));
                    }
                    this._setFileExplorerOpen(true);
                    const projectName = this.props.projectName;
                    this.setState(prev => {
                      const newSet = new Set(prev.fileExplorerExpandedPaths);
                      ancestors.forEach(p => newSet.add(p));
                      return {
                        currentGitDiff: null,
                        currentFile: resolvedPath,
                        scrollToLine: line || 1,
                        scrollToMatch: null,
                        gitChangesOpen: false,
                        fileExplorerExpandedPaths: newSet,
                      };
                    }, () => {
                      saveExpandedPaths(projectName, this.state.fileExplorerExpandedPaths);
                    });
                  }}
                />
              </div>
            )}
            {this.state.currentFile && (
              <div className={styles.overlayPanel}>
                {isImageFile(this.state.currentFile) ? (
                  <ImageViewer
                    key={this.state.fileVersion}
                    filePath={this.state.currentFile}
                    editorSession={!!this.state.editorSessionId}
                    onClose={() => {
                      if (this.state.editorSessionId) {
                        fetch(apiUrl('/api/editor-done'), {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ sessionId: this.state.editorSessionId }),
                        }).catch(() => {});
                      }
                      this.setState({ currentFile: null, fileVersion: 0, editorSessionId: null, editorFilePath: null });
                    }}
                  />
                ) : (
                  <FileContentView
                    key={this.state.fileVersion}
                    filePath={this.state.currentFile}
                    scrollToLine={this.state.scrollToLine}
                    scrollToMatch={this.state.scrollToMatch}
                    editorSession={!!this.state.editorSessionId}
                    onUpdateScroll={this.handleUpdateFileScroll}
                    getRestoreScrollSnapshot={this.getFileScrollSnapshot}
                    onConsumeScrollSnapshot={this.handleConsumeFileScroll}
                    onDirtyChange={this.handleFileDirtyChange}
                    onClose={() => {
                      if (this.state.editorSessionId) {
                        fetch(apiUrl('/api/editor-done'), {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ sessionId: this.state.editorSessionId }),
                        }).catch(() => {});
                      }
                      this.setState({ currentFile: null, fileVersion: 0, editorSessionId: null, editorFilePath: null });
                    }}
                  />
                )}
              </div>
            )}
            {messageList}
            {/* inputStack 把审批面板 + 输入栏包成同一个定位容器，
                面板用 position:absolute; bottom:100% 自动贴在输入栏顶部之上，不遮挡 */}
            <div className={styles.inputStack}>
            {/* 如果父组件处理全局渲染（移动端通过 suppressInlineApprovalPanels），跳过本地渲染 */}
            {!this.props.suppressInlineApprovalPanels && (
              <ToolApprovalPanel
                toolName={this.state.pendingPermission?.toolName}
                toolInput={this.state.pendingPermission?.input}
                requestId={this.state.pendingPermission?.id}
                onAllow={this.handlePermissionAllow}
                onAllowSession={
                  (this.props.sdkMode || (this.state.pendingPermission?.source === 'pty' && this.state.pendingPermission?.ptyPrompt?.options?.length >= 3))
                    ? this.handlePermissionAllowSession
                    : null
                }
                onDeny={this.handlePermissionDeny}
                visible={!!this.state.pendingPermission}
                autoApproveSeconds={this.props.autoApproveSeconds}
                onAutoApproveChange={this.props.onAutoApproveChange}
                source={this.state.pendingPermission?.source}
                queueDepth={this.state.permissionQueue.length}
              />
            )}
            {!this.props.suppressInlineApprovalPanels && this.state.pendingPlanApproval && (
              <ToolApprovalPanel
                toolName="ExitPlanMode"
                toolInput={this.state.pendingPlanApproval.input}
                requestId={this.state.pendingPlanApproval.id}
                onAllow={this.handlePlanApprove}
                onDeny={(id) => this.handlePlanReject(id, '')}
                visible={true}
              />
            )}
            <WorkflowLiveHud />
            <ChatInputBar
              inputRef={this._inputRef}
              inputEmpty={this.state.inputEmpty}
              inputSuggestion={this.state.inputSuggestion}
              terminalVisible={terminalVisible}
              onKeyDown={this.handleInputKeyDown}
              onChange={this.handleInputChange}
              onSend={this.handleInputSend}
              onStop={this.handleInputStop}
              onSuggestionClick={this.handleSuggestionToTerminal}
              onUploadPath={this.handleUploadPath}
              presetItems={this.state.presetItems}
              onPresetSend={this.handlePresetSend}
              onOpenPresetModal={() => this.setState({ mobilePresetModalVisible: true })}
              onOpenUltraPlan={this.state.agentTeamEnabled && this.props.cliMode
                ? (isMobile ? () => this.setState({ ultraplanModalOpen: true }) : () => this.setState({ ultraplanPopoverOpen: true }))
                : null}
              ultraplanPopover={(!isMobile && this.state.agentTeamEnabled && this.props.cliMode) ? {
                open: this.state.ultraplanPopoverOpen,
                onOpenChange: this._ultraplanPopoverOnOpenChange,
                overlayInnerStyle: ultraplanOverlayInnerStyle(this.state.ultraplanPopoverSize),
                content: (
                  <UltraplanPanel
                    variant={this.state.ultraplanVariant}
                    prompt={this.state.ultraplanPrompt}
                    files={this.state.ultraplanFiles}
                    customExperts={this.state.customUltraplanExperts}
                    expertOrder={this.state.ultraplanExpertOrder}
                    expertHidden={this.state.ultraplanExpertHidden}
                    onVariantChange={(v) => this.setState({ ultraplanVariant: v })}
                    onPromptChange={(p) => this.setState({ ultraplanPrompt: p })}
                    onSend={this._handleUltraplanSend}
                    onUpload={this._handleUltraplanUpload}
                    onPaste={this._handleUltraplanPaste}
                    onRemoveFile={this._handleUltraplanRemoveFile}
                    onClose={() => this.setState({ ultraplanPopoverOpen: false })}
                    onOpenManager={() => this.setState({ ultraplanManagerOpen: true })}
                    onOpenCustomEditor={this._openCustomUltraplanEditor}
                    onPreviewImage={(lb) => this.setState({ ultraplanLightbox: lb })}
                    onConfirmingChange={(open) => this.setState({ ultraplanConfirming: open })}
                    onSizeChange={(size) => this.setState({ ultraplanPopoverSize: size })}
                  />
                ),
              } : null}
              onClearContext={this.props.cliMode ? () => {
                Modal.confirm({
                  title: t('ui.chatInput.clearContextConfirm'),
                  okType: 'danger',
                  okText: t('ui.chatInput.clearContext'),
                  onOk: this._doClearContext,
                });
              } : null}
              onClearContextNow={this.props.cliMode ? this._doClearContext : null}
              isStreaming={uiStreaming}
              pendingImages={this.state.pendingImages}
              onRemovePendingImage={this._removePendingImage}
              uploadingItems={this.state.uploadingItems}
              sendDeferred={this.state.sendDeferred}
              onUploadStart={this.handleUploadStart}
              onUploadEnd={this.handleUploadEnd}
              setContextBarSlot={this.props.setContextBarSlot}
              autoApproveSeconds={this.props.autoApproveSeconds}
              onAutoApproveChange={this.props.onAutoApproveChange}
              planAutoApproveSeconds={this.props.planAutoApproveSeconds}
              onPlanAutoApproveChange={this.props.onPlanAutoApproveChange}
              agentTeamEnabled={this.state.agentTeamEnabled}
            />
            </div>
            <UltraPlanModal
              open={this.state.ultraplanModalOpen}
              variant={this.state.ultraplanVariant}
              prompt={this.state.ultraplanPrompt}
              files={this.state.ultraplanFiles}
              customExperts={this.state.customUltraplanExperts}
              expertOrder={this.state.ultraplanExpertOrder}
              expertHidden={this.state.ultraplanExpertHidden}
              onClose={() => this.setState({ ultraplanModalOpen: false })}
              onVariantChange={(v) => this.setState({ ultraplanVariant: v })}
              onPromptChange={(t) => this.setState({ ultraplanPrompt: t })}
              onSend={this._handleUltraplanSend}
              onUpload={this._handleUltraplanUpload}
              onPaste={this._handleUltraplanPaste}
              onRemoveFile={this._handleUltraplanRemoveFile}
              onOpenCustomEditor={this._openCustomUltraplanEditor}
              onOpenManager={() => this.setState({ ultraplanManagerOpen: true })}
              modalSize={this.state.ultraplanModalSize}
              onModalSizeChange={this._handleUltraplanModalSizeChange}
            />
            <CustomUltraplanEditModal
              open={this.state.customUltraplanEditOpen}
              initial={this.state.customUltraplanEditing}
              onSave={this._saveCustomUltraplanExpert}
              onDelete={this._deleteCustomUltraplanExpert}
              onClose={this._closeCustomUltraplanEditor}
            />
            <UltraplanExpertManagerModal
              open={this.state.ultraplanManagerOpen}
              customExperts={this.state.customUltraplanExperts}
              order={this.state.ultraplanExpertOrder}
              hidden={this.state.ultraplanExpertHidden}
              onPersist={({ order, hidden }) => this._ultraplan.persistExpertLayout({ order, hidden })}
              onClose={() => this.setState({ ultraplanManagerOpen: false })}
            />
            {this.state.ultraplanLightbox && (
              <ImageLightbox
                src={this.state.ultraplanLightbox.src}
                alt={this.state.ultraplanLightbox.alt}
                zIndex={1200}
                onClose={() => this.setState({ ultraplanLightbox: null })}
              />
            )}
            </div>
          </div>
          {cliMode && !this.props.sdkMode && onToggleTerminal && (
            <div
              className={styles.terminalToggle}
              onClick={onToggleTerminal}
              title={terminalVisible ? t('ui.collapseTerminal') : t('ui.expandTerminal')}
            >
              <svg viewBox="0 0 8 24" width="8" height="24">
                {terminalVisible
                  ? <path d="M4 8 L7 12 L4 16" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                  : <path d="M4 8 L1 12 L4 16" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                }
              </svg>
            </div>
          )}
          {terminalVisible && (
            <>
              <div className={styles.vResizer} onMouseDown={this.handleSplitMouseDown} />
              <div className={styles.terminalPanelWrap} style={{ width: terminalWidth }}>
                <TerminalPanel claudeSettings={this.props.claudeSettings} preferences={this.props.preferences} onUpdatePreferences={this.props.onUpdatePreferences} onUpdateClaudeSettings={this.props.onUpdateClaudeSettings} onEditorOpen={(sessionId, filePath) => {
                  this.setState({
                    editorSessionId: sessionId,
                    editorFilePath: filePath,
                    currentFile: filePath,
                    currentGitDiff: null,
                    scrollToLine: null,
                    fileVersion: (this.state.fileVersion || 0) + 1,
                  });
                }} onFilePath={(path) => {
                  // 加入 pendingImages，在终端 Enter 时统一注入 PTY
                  this._addPendingImage(path, 'terminal');
                }}
                pendingImages={this.state.pendingImages}
                onRemovePendingImage={this._removePendingImage}
                onClearPendingImages={this._clearPendingImages}
                modelName={this._reqScanCache?.modelName}
                getChatScroller={() => this._getScrollContainer()}
                onClearContextOptimistic={this.props.onClearContextOptimistic}
                setContextBarSlot={this.props.setContextBarSlot}
                autoApproveSeconds={this.props.autoApproveSeconds}
                onAutoApproveChange={this.props.onAutoApproveChange}
                planAutoApproveSeconds={this.props.planAutoApproveSeconds}
                onPlanAutoApproveChange={this.props.onPlanAutoApproveChange}
                />
              </div>
            </>
          )}
        </div>
      </div>
      <TeamModal session={this.state.teamModalSession} requests={this.props.requests} mainAgentSessions={this.props.mainAgentSessions} collapseToolResults={this.props.collapseToolResults} expandThinking={this.props.expandThinking} showFullToolContent={this.props.showFullToolContent} userProfile={this.props.userProfile} onViewRequest={this.props.onViewRequest} isHistoryLog={this._getIsHistoryLog()} lang={this.props.lang} onClose={() => this.setState({ teamModalSession: null })} />
      <WorkflowRunsModal run={this.state.workflowModalRun} onClose={() => this.setState({ workflowModalRun: null })} />
      <PresetModal open={this.state.mobilePresetModalVisible} onClose={() => this.setState({ mobilePresetModalVisible: false })} items={this.state.presetItems} onItemsChange={(items) => this.setState({ presetItems: items })} onSavePresets={(payload) => { if (this.props.onUpdatePreferences) this.props.onUpdatePreferences(payload); }} />
    </>);
  }
}

export default ChatView;
