import React from 'react';
import { Empty, Typography, Divider, Spin, Popover } from 'antd';
import ChatMessage from './ChatMessage';
import TerminalPanel from './TerminalPanel';
import FileExplorer from './FileExplorer';
import FileContentView from './FileContentView';
import ImageViewer from './ImageViewer';
import ImageLightbox from './ImageLightbox';
import GitChanges from './GitChanges';
import GitDiffView from './GitDiffView';
import { getModelInfo } from '../utils/helpers';
import { getTeammateAvatar } from '../utils/teammateAvatars';
import { isSystemText, classifyUserContent, isMainAgent, isTeammate, resolveTeammateNames } from '../utils/contentFilter';
import { classifyRequest, formatRequestTag, formatTeammateLabel } from '../utils/requestType';
import { buildChunksForAnswer } from '../utils/ptyChunkBuilder';
import { isPlanApprovalPrompt, isDangerousOperationPrompt } from '../utils/promptClassifier';
import { isImageFile, isMutatingCommand } from '../utils/commandValidator';
import { createEmptyToolState, appendToolResultMap, cachedBuildToolResultMap, getToolResultCache, setToolResultCache } from '../utils/toolResultBuilder';
import { TeamButton, TeamModal } from './TeamSessionPanel';
import SnapLineOverlay from './SnapLineOverlay';
import RoleFilterBar from './RoleFilterBar';
import ChatInputBar from './ChatInputBar';
import { Virtuoso } from 'react-virtuoso';
import { isMobile } from '../env';
import { t } from '../i18n';
import { apiUrl } from '../utils/apiUrl';
import { BUILTIN_PRESETS } from '../utils/builtinPresets';
import defaultAvatarUrl from '../img/default-avatar.svg';
import styles from './ChatView.module.css';

const { Text } = Typography;

const QUEUE_THRESHOLD = 20;

const MOBILE_ITEM_LIMIT = 240;
const MOBILE_LOAD_MORE_STEP = 100;

// 稳定空对象引用，避免每次 render 创建新 {} 导致子组件重渲染
const EMPTY_OBJ = {};
const EMPTY_MAP = {};

// Virtuoso custom Scroller — 定义在类外部，避免每次 render 创建新组件引用
const VirtuosoScroller = React.forwardRef((props, ref) => (
  <div ref={ref} {...props} className={styles.container} />
));

function randomInterval() {
  return 100 + Math.random() * 50;
}

class ChatView extends React.Component {
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

    // requests 扫描缓存（tsToIndex / modelName / subAgentEntries）
    this._reqScanCache = { tsToIndex: {}, modelName: null, subAgentEntries: [], processedCount: 0 };


    // 从 localStorage 读取用户偏好的终端宽度（像素）
    const savedWidth = localStorage.getItem('cc-viewer-terminal-width');
    const initialTerminalWidth = savedWidth ? parseFloat(savedWidth) : null;

    this.state = {
      visibleCount: 0,
      loading: false,
      allItems: [],
      lastResponseItems: null,
      highlightTs: null,
      highlightFading: false,
      terminalWidth: initialTerminalWidth || 624, // 默认 80cols * 7.8px
      needsInitialSnap: initialTerminalWidth === null, // 标记是否需要初始化吸附
      inputEmpty: true,
      pendingInput: null,
      stickyBottom: true,
      ptyPrompt: null,
      ptyPromptHistory: [],
      inputSuggestion: null,
      fileExplorerOpen: !isMobile && localStorage.getItem('ccv_fileExplorerOpen') !== 'false',
      currentFile: null,
      currentGitDiff: null,
      scrollToLine: null,
      fileExplorerExpandedPaths: new Set(),
      gitChangesOpen: false,
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
      mdLightboxSrc: null,
      streamingFading: false,
      presetItems: [],
      localAskAnswers: {}, // 提交后的本地答案映射，用于 Last Response 立即切换到非交互式
    };
    this._processedToolIds = new Set();
    this._projectDirCache = null; // 缓存项目目录绝对路径
    this._fileRefreshTimer = null;
    this._gitRefreshTimer = null;
    this._queueTimer = null;
    this._prevItemsLen = 0;
    this._scrollTargetIdx = null;
    this._scrollTargetRef = React.createRef();
    this._scrollFadeTimer = null;
    this._resizing = false;
    this._inputWs = null;
    this._inputRef = React.createRef();
    this._ptyBuffer = '';
    this._ptyDataSeq = 0; // increments on every PTY output event
    this._ptyDebounceTimer = null;
    this._currentPtyPrompt = null; // 同步跟踪 ptyPrompt，避免闭包捕获旧 state
    this._askHookActive = false;      // PreToolUse hook bridge is pending
    this._askHookQuestions = null;    // questions from hook bridge
    this._pendingHookAnswers = null;  // answers waiting for hook bridge
    this._askHookWaitRetries = 0;     // hook bridge wait retry counter
    this._hookWaitTimer = null;       // hook bridge wait timer
    this._mobileExtraItems = 0;
    this._mobileSliceOffset = 0;
    this._totalItemCount = 0;
  }

  _setFileExplorerOpen(open) {
    localStorage.setItem('ccv_fileExplorerOpen', String(open));
    this.setState({ fileExplorerOpen: open });
  }

  _checkToolFileChanges() {
    const sessions = this.props.mainAgentSessions;
    if (!sessions || sessions.length === 0) return;

    // Cap processed IDs to prevent unbounded Set growth
    if (this._processedToolIds.size > 5000) {
      this._processedToolIds.clear();
    }

    let needFileRefresh = false;
    let needGitRefresh = false;
    let needContentRefresh = false;

    // Scan all sessions for tool_use blocks
    for (const session of sessions) {
      const sources = [];
      // response.body.content (streaming)
      if (session.response?.body?.content) {
        sources.push(session.response.body.content);
      }
      // messages
      if (Array.isArray(session.messages)) {
        for (const msg of session.messages) {
          if (msg.role === 'assistant' && Array.isArray(msg.content)) {
            sources.push(msg.content);
          }
        }
      }

      for (const blocks of sources) {
        for (const block of blocks) {
          if (block.type !== 'tool_use' || !block.id) continue;
          if (this._processedToolIds.has(block.id)) continue;
          this._processedToolIds.add(block.id);

          const toolName = block.name;
          let input = block.input;
          if (typeof input === 'string') {
            try { input = JSON.parse(input.replace(/^\[object Object\]/, '')); } catch { input = {}; }
          }

          if (toolName === 'Write') {
            needFileRefresh = true;
            needGitRefresh = true;
          } else if (toolName === 'Edit' || toolName === 'NotebookEdit') {
            needGitRefresh = true;
          } else if (toolName === 'Bash' && input && input.command && isMutatingCommand(input.command)) {
            needFileRefresh = true;
            needGitRefresh = true;
          }

          // Auto-refresh FileContentView when the currently open file is modified
          if ((toolName === 'Write' || toolName === 'Edit' || toolName === 'NotebookEdit') && this.state.currentFile) {
            const fp = input && input.file_path;
            if (fp) {
              let rel = fp;
              if (rel.startsWith('/') && this._projectDirCache && rel.startsWith(this._projectDirCache + '/')) {
                rel = rel.slice(this._projectDirCache.length + 1);
              }
              if (rel === this.state.currentFile || (rel.startsWith('/') && rel.endsWith('/' + this.state.currentFile))) {
                needContentRefresh = true;
              }
            }
          }
        }
      }
    }

    if (needFileRefresh && this.state.fileExplorerOpen) {
      clearTimeout(this._fileRefreshTimer);
      this._fileRefreshTimer = setTimeout(() => {
        this.setState(prev => ({ fileExplorerRefresh: prev.fileExplorerRefresh + 1 }));
      }, 500);
    }
    if (needGitRefresh && this.state.gitChangesOpen) {
      clearTimeout(this._gitRefreshTimer);
      this._gitRefreshTimer = setTimeout(() => {
        this.setState(prev => ({ gitChangesRefresh: prev.gitChangesRefresh + 1 }));
      }, 500);
    }
    if (needContentRefresh) {
      clearTimeout(this._contentRefreshTimer);
      this._contentRefreshTimer = setTimeout(() => {
        this.setState(prev => ({ fileVersion: prev.fileVersion + 1 }));
      }, 500);
    }
  }

  componentDidMount() {
    this.startRender();
    if (this.props.cliMode) {
      this.connectInputWs();
    }
    if (!isMobile) this._bindStickyScroll();
    // 初始化时吸附到 60cols
    if (this.state.needsInitialSnap && this.props.cliMode && this.props.terminalVisible) {
      this._snapToInitialPosition();
    }
    // 加载 Agent Team 预置项
    this._loadPresets();
  }

  shouldComponentUpdate(nextProps, nextState) {
    return (
      nextProps.requests !== this.props.requests ||
      nextProps.mainAgentSessions !== this.props.mainAgentSessions ||
      nextProps.collapseToolResults !== this.props.collapseToolResults ||
      nextProps.expandThinking !== this.props.expandThinking ||
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
      nextState !== this.state
    );
  }

  componentDidUpdate(prevProps) {
    // Streaming border fade-out: when isStreaming goes from true to false, trigger fade
    if (prevProps.isStreaming && !this.props.isStreaming) {
      this.setState({ streamingFading: true });
      clearTimeout(this._streamingFadeTimer);
      this._streamingFadeTimer = setTimeout(() => {
        this.setState({ streamingFading: false });
      }, 500);
    }
    // Handle files dropped onto the app
    if (this.props.pendingUploadPaths && this.props.pendingUploadPaths.length > 0
      && this.props.pendingUploadPaths !== prevProps.pendingUploadPaths) {
      const paths = this.props.pendingUploadPaths.join(' ');
      const textarea = this._inputRef.current;
      if (textarea) {
        textarea.value = (textarea.value ? textarea.value + ' ' : '') + paths;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        this.setState({ inputEmpty: false });
      } else if (this._inputWs && this._inputWs.readyState === WebSocket.OPEN) {
        this._inputWs.send(JSON.stringify({ type: 'input', data: paths }));
      }
      if (this.props.onUploadPathsConsumed) this.props.onUploadPathsConsumed();
    }
    if (prevProps.mainAgentSessions !== this.props.mainAgentSessions) {
      // sessions 引用变化 → 重置增量状态
      if (this.props.mainAgentSessions !== this._prevSessions) {
        this._incToolState = null;
        this._incToolProcessedCount = 0;
        this._incToolSessionIdx = -1;
        this._prevSessions = this.props.mainAgentSessions;
        this._reqScanCache = { tsToIndex: {}, modelName: null, subAgentEntries: [], processedCount: 0, subAgentProcessedCount: 0 };
      }
      if (isMobile) this._mobileExtraItems = 0;
      this.startRender();
      if (this.state.pendingInput) {
        this.setState({ pendingInput: null });
      }
      this._updateSuggestion();
      this._checkToolFileChanges();
    } else if (prevProps.requests !== this.props.requests) {
      // SubAgent / Teammate 请求到达但 mainAgentSessions 未变
      this._reqScanCache.subAgentEntries = [];
      this._reqScanCache.subAgentProcessedCount = 0;
      this.startRender();
    } else if (prevProps.collapseToolResults !== this.props.collapseToolResults || prevProps.expandThinking !== this.props.expandThinking) {
      const rawItems = this.buildAllItems();
      const allItems = this._applyMobileSlice(rawItems);
      this.setState({ allItems, lastResponseItems: this._lastResponseItems, visibleCount: allItems.length });
    }
    // scrollToTimestamp 变化时（如从 raw 模式切回 chat），重建 items 并滚动定位
    if (!prevProps.scrollToTimestamp && this.props.scrollToTimestamp) {
      // If target is in hidden area, expand to include it
      if (isMobile && this.props.scrollToTimestamp) {
        const rawItems = this.buildAllItems();
        const targetIdx = this._scrollTargetIdx;
        if (targetIdx != null) {
          const limit = MOBILE_ITEM_LIMIT + this._mobileExtraItems;
          const offset = rawItems.length > limit ? rawItems.length - limit : 0;
          if (targetIdx < offset) {
            this._mobileExtraItems = rawItems.length - targetIdx - MOBILE_ITEM_LIMIT;
            if (this._mobileExtraItems < 0) this._mobileExtraItems = 0;
          }
        }
        const allItems = this._applyMobileSlice(rawItems);
        this.setState({ allItems, lastResponseItems: this._lastResponseItems, visibleCount: allItems.length }, () => this.scrollToBottom());
      } else {
        const rawItems = this.buildAllItems();
        const allItems = this._applyMobileSlice(rawItems);
        this.setState({ allItems, lastResponseItems: this._lastResponseItems, visibleCount: allItems.length }, () => this.scrollToBottom());
      }
    }
    // mobileChatVisible: scroll to bottom when becoming visible
    if (isMobile && this.props.mobileChatVisible && !prevProps.mobileChatVisible) {
      requestAnimationFrame(() => {
        if (this.virtuosoRef.current) {
          this.virtuosoRef.current.scrollToIndex({ index: 'LAST' });
        } else {
          const el = this.containerRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        }
      });
    }
    // cliMode 异步生效后建立 WebSocket 连接
    if (!prevProps.cliMode && this.props.cliMode) {
      this.connectInputWs();
    }
    if (!isMobile) this._rebindStickyEl();
  }

  componentWillUnmount() {
    this._unmounted = true;
    if (this._queueTimer) clearTimeout(this._queueTimer);
    if (this._fadeClearTimer) clearTimeout(this._fadeClearTimer);
    if (this._ptyDebounceTimer) clearTimeout(this._ptyDebounceTimer);
    if (this._fileRefreshTimer) clearTimeout(this._fileRefreshTimer);
    if (this._gitRefreshTimer) clearTimeout(this._gitRefreshTimer);
    if (this._contentRefreshTimer) clearTimeout(this._contentRefreshTimer);
    if (this._wsReconnectTimer) clearTimeout(this._wsReconnectTimer);
    if (this._waitForWsTimer) clearTimeout(this._waitForWsTimer);
    if (this._waitForPtyTimer) clearTimeout(this._waitForPtyTimer);
    if (this._planFeedbackTimer) clearTimeout(this._planFeedbackTimer);
    if (this._streamingFadeTimer) clearTimeout(this._streamingFadeTimer);
    if (this._hookWaitTimer) clearTimeout(this._hookWaitTimer);
    this._pendingHookAnswers = null;
    this._unbindScrollFade();
    if (!isMobile) this._unbindStickyScroll();
    if (this._inputWs) {
      this._inputWs.close();
      this._inputWs = null;
    }
  }

  startRender() {
    if (this._queueTimer) clearTimeout(this._queueTimer);

    const rawItems = this.buildAllItems();
    const lastResponseItems = this._lastResponseItems;
    const allItems = this._applyMobileSlice(rawItems);
    this._prevItemsLen = allItems.length;

    this.setState({ allItems, lastResponseItems, visibleCount: allItems.length, loading: false },
      () => this.scrollToBottom());
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

  scrollToBottom() {
    // 移动端：Virtuoso API
    if (isMobile && this.virtuosoRef.current) {
      if (this._scrollTargetIdx != null) {
        this.virtuosoRef.current.scrollToIndex({ index: this._scrollTargetIdx, align: 'center' });
        const targetTs = this.props.scrollToTimestamp;
        this._scrollTargetRef = React.createRef();
        if (targetTs) {
          this.setState({ highlightTs: targetTs, highlightFading: false });
          this._bindScrollFade();
        }
        if (this.props.onScrollTsDone) this.props.onScrollTsDone();
        return;
      }
      if (this.state.stickyBottom) {
        this.virtuosoRef.current.scrollToIndex({ index: 'LAST', behavior: 'auto' });
      }
      return;
    }
    // 桌面端：原有逻辑
    if (this._scrollTargetRef.current) {
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
        this._bindScrollFade();
      }
      if (this.props.onScrollTsDone) this.props.onScrollTsDone();
      return;
    }
    if (this.state.stickyBottom) {
      const el = this.containerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }

  _bindStickyScroll() {
    this._stickyScrollRafId = null;
    this._onStickyScroll = () => {
      if (this._stickyScrollLock) return;
      if (this._stickyScrollRafId) return;
      this._stickyScrollRafId = requestAnimationFrame(() => {
        this._stickyScrollRafId = null;
        const el = this.containerRef.current;
        if (!el) return;
        const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (this.state.stickyBottom && gap > 50) {
          this.setState({ stickyBottom: false });
        } else if (!this.state.stickyBottom && gap <= 10) {
          this.setState({ stickyBottom: true });
        }
      });
    };
    this._rebindStickyEl();
  }

  _rebindStickyEl() {
    const el = this.containerRef.current;
    if (el === this._stickyBoundEl) return;
    if (this._stickyBoundEl) {
      this._stickyBoundEl.removeEventListener('scroll', this._onStickyScroll);
    }
    this._stickyBoundEl = el;
    if (el) el.addEventListener('scroll', this._onStickyScroll, { passive: true });
  }

  _unbindStickyScroll() {
    if (this._stickyBoundEl && this._onStickyScroll) {
      this._stickyBoundEl.removeEventListener('scroll', this._onStickyScroll);
      this._stickyBoundEl = null;
    }
    if (this._stickyScrollRafId) {
      cancelAnimationFrame(this._stickyScrollRafId);
      this._stickyScrollRafId = null;
    }
  }

  handleStickToBottom = () => {
    this.setState({ stickyBottom: true }, () => {
      if (isMobile && this.virtuosoRef.current) {
        this.virtuosoRef.current.scrollToIndex({ index: 'LAST', behavior: 'smooth' });
      } else {
        const el = this.containerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      }
    });
  };

  handleLoadMore = () => {
    this._mobileExtraItems += MOBILE_LOAD_MORE_STEP;
    const prevLen = this.state.allItems?.length || 0;
    const rawItems = this.buildAllItems();
    const allItems = this._applyMobileSlice(rawItems);
    const addedCount = allItems.length - prevLen;
    if (isMobile && this.virtuosoRef.current) {
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
          const newScrollHeight = el.scrollHeight;
          el.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight);
        }
      });
    }
  };

  _getScrollContainer() {
    return isMobile ? this._virtuosoScrollerEl : this.containerRef.current;
  }

  _bindScrollFade() {
    this._unbindScrollFade();
    const container = this._getScrollContainer();
    if (!container) return;
    this._scrollFadeIgnoreFirst = true;
    this._scrollFadeBoundEl = container;
    this._onScrollFade = () => {
      if (this._scrollFadeIgnoreFirst) {
        this._scrollFadeIgnoreFirst = false;
        return;
      }
      this.setState({ highlightFading: true });
      this._fadeClearTimer = setTimeout(() => {
        this.setState({ highlightTs: null, highlightFading: false });
      }, 2000);
      this._unbindScrollFade();
    };
    container.addEventListener('scroll', this._onScrollFade, { passive: true });
  }

  _unbindScrollFade() {
    if (this._onScrollFade && this._scrollFadeBoundEl) {
      this._scrollFadeBoundEl.removeEventListener('scroll', this._onScrollFade);
      this._scrollFadeBoundEl = null;
      this._onScrollFade = null;
    }
  }

  renderSessionMessages(messages, keyPrefix, modelInfo, tsToIndex) {
    const { userProfile, collapseToolResults, expandThinking, showThinkingSummaries, onViewRequest } = this.props;
    // 增量 / WeakMap 缓存
    let cached = getToolResultCache(messages);
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
    const { toolUseMap, toolResultMap, readContentMap, editSnapshotMap, askAnswerMap, planApprovalMap, latestPlanContent } = cached;

    const activePlanPrompt = this.props.cliMode
      ? this.state.ptyPromptHistory.slice().reverse().find(p => isPlanApprovalPrompt(p) && p.status === 'active') || null
      : null;
    const activeDangerousPrompt = this.props.cliMode
      ? this.state.ptyPromptHistory.slice().reverse().find(p => isDangerousOperationPrompt(p) && p.status === 'active') || null
      : null;

    // P1: 只允许最后一个 pending 的 ExitPlanMode 卡片交互
    let lastPendingPlanId = null;
    // P2: 只允许最后一个 pending 的 AskUserQuestion 卡片交互
    let lastPendingAskId = null;
    for (const msg of messages) {
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_use' && block.name === 'ExitPlanMode') {
            const approval = planApprovalMap[block.id];
            if (!approval || approval.status === 'pending') {
              lastPendingPlanId = block.id;
            }
          }
          if (block.type === 'tool_use' && block.name === 'AskUserQuestion') {
            const answers = askAnswerMap[block.id];
            if (!answers || Object.keys(answers).length === 0) {
              lastPendingAskId = block.id;
            }
          }
        }
      }
    }

    const renderedMessages = [];

    for (let mi = 0; mi < messages.length; mi++) {
      const msg = messages[mi];
      const content = msg.content;
      const ts = msg._timestamp || null;
      const reqIdx = ts ? tsToIndex[ts] : undefined;
      const viewReqProps = reqIdx != null && onViewRequest ? { requestIndex: reqIdx, onViewRequest } : EMPTY_OBJ;

      if (msg.role === 'user') {
        if (Array.isArray(content)) {
          const suggestionText = content.find(b => b.type === 'text' && /^\[SUGGESTION MODE:/i.test((b.text || '').trim()));
          const toolResults = content.filter(b => b.type === 'tool_result');

          if (suggestionText && toolResults.length > 0) {
            // AskUserQuestion 的用户回复：跳过渲染（答案已在 assistant 侧问卷卡片上显示）
          } else {
            const { commands, textBlocks, skillBlocks } = classifyUserContent(content);
            // 渲染 slash command 作为独立用户输入
            for (let ci = 0; ci < commands.length; ci++) {
              renderedMessages.push(
                <ChatMessage key={`${keyPrefix}-cmd-${mi}-${ci}`} role="user" text={commands[ci]} timestamp={ts} userProfile={userProfile} modelInfo={modelInfo} {...viewReqProps} />
              );
            }
            // 渲染 skill 加载块
            for (const sb of skillBlocks) {
              const nameMatch = sb.text.match(/^#\s+(.+)$/m);
              const skillName = nameMatch ? nameMatch[1] : 'Skill';
              renderedMessages.push(
                <ChatMessage key={`${keyPrefix}-skill-${mi}`} role="skill-loaded" text={sb.text} skillName={skillName} timestamp={ts} {...viewReqProps} />
              );
            }
            // 渲染普通用户文本块
            for (let ti = 0; ti < textBlocks.length; ti++) {
              const isPlan = /Implement the following plan:/i.test(textBlocks[ti].text || '');
              renderedMessages.push(
                <ChatMessage key={`${keyPrefix}-user-${mi}-${ti}`} role={isPlan ? 'plan-prompt' : 'user'} text={textBlocks[ti].text} timestamp={ts} userProfile={userProfile} modelInfo={modelInfo} {...viewReqProps} />
              );
            }
          }
        } else if (typeof content === 'string' && !isSystemText(content)) {
          const isPlan = /Implement the following plan:/i.test(content);
          renderedMessages.push(
            <ChatMessage key={`${keyPrefix}-user-${mi}`} role={isPlan ? 'plan-prompt' : 'user'} text={content} timestamp={ts} userProfile={userProfile} modelInfo={modelInfo} {...viewReqProps} />
          );
        }
      } else if (msg.role === 'assistant') {
        if (Array.isArray(content)) {
          renderedMessages.push(
            <ChatMessage key={`${keyPrefix}-asst-${mi}`} role="assistant" content={content} toolResultMap={toolResultMap} readContentMap={readContentMap} editSnapshotMap={editSnapshotMap} askAnswerMap={askAnswerMap} planApprovalMap={planApprovalMap} latestPlanContent={latestPlanContent} timestamp={ts} modelInfo={modelInfo} collapseToolResults={collapseToolResults} expandThinking={expandThinking} showThinkingSummaries={showThinkingSummaries} ptyPrompt={this.state.ptyPrompt} activePlanPrompt={activePlanPrompt} activeDangerousPrompt={activeDangerousPrompt} lastPendingPlanId={lastPendingPlanId} lastPendingAskId={lastPendingAskId} onPlanApprovalClick={this.handlePromptOptionClick} onPlanFeedbackSubmit={this.handlePlanFeedbackSubmit} onDangerousApprovalClick={this.handlePromptOptionClick} onAskQuestionSubmit={this.handleAskQuestionSubmit} cliMode={this.props.cliMode} onOpenFile={this.handleOpenToolFilePath} {...viewReqProps} />
          );
        } else if (typeof content === 'string') {
          renderedMessages.push(
            <ChatMessage key={`${keyPrefix}-asst-${mi}`} role="assistant" content={[{ type: 'text', text: content }]} toolResultMap={toolResultMap} readContentMap={readContentMap} editSnapshotMap={editSnapshotMap} askAnswerMap={askAnswerMap} planApprovalMap={planApprovalMap} latestPlanContent={latestPlanContent} timestamp={ts} modelInfo={modelInfo} collapseToolResults={collapseToolResults} expandThinking={expandThinking} showThinkingSummaries={showThinkingSummaries} ptyPrompt={this.state.ptyPrompt} activePlanPrompt={activePlanPrompt} activeDangerousPrompt={activeDangerousPrompt} lastPendingPlanId={lastPendingPlanId} lastPendingAskId={lastPendingAskId} onPlanApprovalClick={this.handlePromptOptionClick} onPlanFeedbackSubmit={this.handlePlanFeedbackSubmit} onDangerousApprovalClick={this.handlePromptOptionClick} onAskQuestionSubmit={this.handleAskQuestionSubmit} cliMode={this.props.cliMode} onOpenFile={this.handleOpenToolFilePath} {...viewReqProps} />
          );
        }
      }
    }

    return renderedMessages;
  }

  /**
   * Fallback: 当 mainAgentSessions 为空时，从 requests 中提取 teammate entries 渲染。
   * 解决 JSONL 截断后只剩 teammate entries 导致界面空白的问题。
   */
  _buildTeammateFallbackItems() {
    const { requests, collapseToolResults, expandThinking, onViewRequest } = this.props;
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
        });
      }
    }

    if (teammateMap.size === 0) return [];

    const modelInfo = null; // teammate 不需要 model 头像
    const allItems = [];
    let si = 0;
    for (const [name, session] of teammateMap) {
      allItems.push(
        <Divider key={`tm-div-${si}`} className={styles.sessionDivider}>
          <Text className={styles.sessionDividerText}>{name}</Text>
        </Divider>
      );
      const msgs = this.renderSessionMessages(session.messages, `tm${si}`, modelInfo, {});
      allItems.push(...msgs);

      // 渲染 response content（如果有）
      if (si === teammateMap.size - 1 && session.response?.body?.content) {
        const respContent = session.response.body.content;
        if (Array.isArray(respContent)) {
          const lastItems = respContent
            .filter(b => b.type === 'text' && b.text)
            .map((b, bi) => (
              <ChatMessage key={`tm-resp-${si}-${bi}`} role="assistant" content={[b]} collapseToolResults={collapseToolResults} expandThinking={expandThinking} onViewRequest={onViewRequest} onOpenFile={this.handleOpenToolFilePath} />
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
    const { mainAgentSessions, requests, collapseToolResults, expandThinking, onViewRequest } = this.props;
    this._lastResponseItems = null;
    this._lastResponseAskQuestions = null;
    if (!mainAgentSessions || mainAgentSessions.length === 0) {
      // Fallback: 无 MainAgent 时，从 requests 提取 teammate entries 渲染其对话历史，
      // 避免 JSONL 截断只剩 teammate 时界面完全空白。
      return this._buildTeammateFallbackItems();
    }

    // 增量扫描 requests（tsToIndex + modelName 增量，subAgentEntries 可按需全量重扫）
    const cache = this._reqScanCache;
    if (requests) {
      // tsToIndex / modelName: 只追加不修改，增量扫描
      const startIdx = (requests.length >= cache.processedCount) ? cache.processedCount : 0;
      if (startIdx === 0) {
        cache.tsToIndex = {};
        cache.modelName = null;
      }
      for (let i = startIdx; i < requests.length; i++) {
        const req = requests[i];
        const ma = isMainAgent(req);
        if (ma && req.timestamp) {
          cache.tsToIndex[req.timestamp] = i;
        }
        if (ma && req.body?.model) {
          cache.modelName = req.body.model;
        }
      }
      cache.processedCount = requests.length;

      // Teammate 名称解析：在 classifyRequest 之前注入 req.teammate（prompt 内容匹配）
      resolveTeammateNames(requests);

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
      for (let i = subStart; i < requests.length; i++) {
        const req = requests[i];
        if (!req.timestamp) continue;
        const cls = classifyRequest(req, requests[i + 1]);
        if (cls.type === 'SubAgent' || cls.type === 'Teammate') {
          const respContent = req.response?.body?.content;
          if (Array.isArray(respContent) && respContent.length > 0) {
            const subToolResultMap = cachedBuildToolResultMap(req.body?.messages || []).toolResultMap;
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
            });
          }
        }
      }
      cache.subAgentProcessedCount = requests.length;
    }
    const tsToIndex = cache.tsToIndex;
    const modelInfo = getModelInfo(cache.modelName);
    const subAgentEntries = cache.subAgentEntries;

    const allItems = [];
    const tsItemMap = {};

    // Server-side pagination: "load earlier conversations" button
    if (this.props.hasMoreHistory || this.props.loadingMore) {
      allItems.push(
        <div key="load-more-history" className={styles.loadMoreWrap}>
          {this.props.loadingMore ? (
            <div className={`${styles.loadMoreBtn} ${styles.loadMoreBtnLoading}`}>
              <Spin size="small" style={{ marginRight: 8 }} />
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

    mainAgentSessions.forEach((session, si) => {
      if (si > 0) {
        allItems.push(
          <Divider key={`session-div-${si}`} className={styles.sessionDivider}>
            <Text className={styles.sessionDividerText}>Session</Text>
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
                <Spin size="small" style={{ marginRight: 8 }} />
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

      const msgs = this.renderSessionMessages(session.messages, `s${si}`, modelInfo, tsToIndex);

      // 将 SubAgent entries 按时间戳插入到 session 消息之间
      for (const m of msgs) {
        const msgTs = m.props.timestamp;
        // 插入时间戳 <= 当前消息时间戳的 SubAgent entries
        while (subIdx < subAgentEntries.length && msgTs && subAgentEntries[subIdx].timestamp <= msgTs) {
          const sa = subAgentEntries[subIdx];
          if (sa.timestamp) tsItemMap[sa.timestamp] = allItems.length;
          allItems.push(
            <ChatMessage key={`sub-${sa.requestIndex}-${sa.timestamp}`} role="sub-agent-chat" content={sa.content} toolResultMap={sa.toolResultMap} label={sa.label} isTeammate={sa.isTeammate} timestamp={sa.timestamp} collapseToolResults={collapseToolResults} expandThinking={expandThinking} requestIndex={sa.requestIndex} onViewRequest={onViewRequest} onOpenFile={this.handleOpenToolFilePath} />
          );
          subIdx++;
        }
        if (msgTs) tsItemMap[msgTs] = allItems.length;
        allItems.push(m);
      }
      // 插入剩余的 SubAgent entries（时间戳在最后一条消息之后）
      while (subIdx < subAgentEntries.length) {
        const sa = subAgentEntries[subIdx];
        // 只插入属于当前 session 时间范围内的（下一个 session 之前的）
        const nextSessionStart = si < mainAgentSessions.length - 1 && mainAgentSessions[si + 1].messages?.[0]?._timestamp;
        if (nextSessionStart && sa.timestamp > nextSessionStart) break;
        if (sa.timestamp) tsItemMap[sa.timestamp] = allItems.length;
        allItems.push(
          <ChatMessage key={`sub-${sa.requestIndex}-${sa.timestamp}`} role="sub-agent-chat" content={sa.content} toolResultMap={sa.toolResultMap} label={sa.label} isTeammate={sa.isTeammate} timestamp={sa.timestamp} collapseToolResults={collapseToolResults} expandThinking={expandThinking} requestIndex={sa.requestIndex} onViewRequest={onViewRequest} onOpenFile={this.handleOpenToolFilePath} />
        );
        subIdx++;
      }

      if (si === mainAgentSessions.length - 1 && session.response?.body?.content) {
        const respContent = session.response.body.content;
        if (Array.isArray(respContent)) {
          // 检查是否需要隐藏 Last Response
          const hasInteractiveBlock = respContent.some(b =>
            b.type === 'tool_use' && (b.name === 'AskUserQuestion' || b.name === 'ExitPlanMode')
          );
          const hasSuggestionMode = respContent.some(b =>
            b.type === 'text' && typeof b.text === 'string' && b.text.includes('[SUGGESTION MODE:')
          );
          const shouldHide = hasSuggestionMode && !hasInteractiveBlock;

          if (!shouldHide) {
            // Last Response 单独存储，不混入主列表
            if (session.entryTimestamp) tsItemMap[session.entryTimestamp] = allItems.length;
            let respLastPendingAskId = null;
            let respLastPendingPlanId = null;
            const _localAsk = this.state.localAskAnswers || {};
            for (const block of respContent) {
              if (block.type === 'tool_use' && block.name === 'AskUserQuestion') {
                // 已在本地提交过的问题不再视为 pending
                const la = _localAsk[block.id];
                if (!la || Object.keys(la).length === 0) {
                  respLastPendingAskId = block.id;
                }
              }
              if (block.type === 'tool_use' && block.name === 'ExitPlanMode') {
                respLastPendingPlanId = block.id;
              }
            }
            // 收集 Last Response 中所有 AskUserQuestion 的问题文本，用于 prompt 去重
            this._lastResponseAskQuestions = new Set();
            for (const block of respContent) {
              if (block.type === 'tool_use' && block.name === 'AskUserQuestion') {
                const questions = block.input?.questions;
                if (Array.isArray(questions)) {
                  for (const q of questions) {
                    if (q.question) this._lastResponseAskQuestions.add(q.question);
                  }
                }
              }
            }
            const _cachedLR = getToolResultCache(session.messages) || {};
            const planApprovalMap = _cachedLR.planApprovalMap || {};
            const latestPlanContent = _cachedLR.latestPlanContent || null;
            const activePlanPrompt = this.props.cliMode
              ? this.state.ptyPromptHistory.slice().reverse().find(p => isPlanApprovalPrompt(p) && p.status === 'active') || null
              : null;
            const activeDangerousPrompt = this.props.cliMode
              ? this.state.ptyPromptHistory.slice().reverse().find(p => isDangerousOperationPrompt(p) && p.status === 'active') || null
              : null;
            // Last Response 过滤：隐藏 tool_use 块，仅保留交互卡片（AskUserQuestion / ExitPlanMode）
            const lrContent = respContent.filter(b =>
              b.type !== 'tool_use' || b.name === 'AskUserQuestion' || b.name === 'ExitPlanMode'
            );
            this._lastResponseItems = (
              <React.Fragment key="last-response-group">
                <Divider className={styles.lastResponseDivider}>
                  <Text type="secondary" className={styles.lastResponseLabel}>{t('ui.lastResponse')}</Text>
                </Divider>
                <ChatMessage key="resp-asst" role="assistant" content={lrContent} timestamp={session.entryTimestamp} modelInfo={modelInfo} collapseToolResults={collapseToolResults} expandThinking={expandThinking} toolResultMap={EMPTY_MAP} askAnswerMap={Object.keys(_localAsk).length > 0 ? _localAsk : EMPTY_MAP} planApprovalMap={planApprovalMap} latestPlanContent={latestPlanContent} lastPendingAskId={respLastPendingAskId} lastPendingPlanId={respLastPendingPlanId} activePlanPrompt={activePlanPrompt} activeDangerousPrompt={activeDangerousPrompt} ptyPrompt={this.state.ptyPrompt} onPlanApprovalClick={this.handlePromptOptionClick} onPlanFeedbackSubmit={this.handlePlanFeedbackSubmit} onDangerousApprovalClick={this.handlePromptOptionClick} cliMode={this.props.cliMode} onAskQuestionSubmit={this.handleAskQuestionSubmit} onOpenFile={this.handleOpenToolFilePath} />
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

    return allItems;
  }

  _applyMobileSlice(allItems) {
    if (!isMobile) {
      this._mobileSliceOffset = 0;
      this._totalItemCount = allItems.length;
      return allItems;
    }
    this._totalItemCount = allItems.length;
    const limit = MOBILE_ITEM_LIMIT + this._mobileExtraItems;
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
    // 判断 Agent Team 是否启用
    let agentTeamEnabled = false;
    fetch(apiUrl('/api/claude-settings')).then(r => r.json()).then(data => {
      agentTeamEnabled = data?.env?.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === '1';
    }).catch(() => {}).then(() => {
      if (!agentTeamEnabled) return;
      // 加载预置快捷方式，合并内置预置
      fetch(apiUrl('/api/preferences')).then(r => r.json()).then(data => {
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
        this.setState({ presetItems: items });
      }).catch(() => {});
    });
  }

  handlePresetSend = (description) => {
    if (!description) return;
    const textarea = this._inputRef.current;
    if (!textarea) return;
    textarea.value = description;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, isMobile ? 160 : 120) + 'px';
    this.setState({ inputEmpty: false });
    textarea.focus();
  };

  connectInputWs() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/terminal`;
    this._inputWs = new WebSocket(wsUrl);
    this._inputWs.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'data') {
          this._appendPtyData(msg.data);
        } else if (msg.type === 'exit') {
          this._clearPtyPrompt();
        } else if (msg.type === 'ask-hook-pending') {
          this._askHookActive = true;
          this._askHookQuestions = msg.questions;
        } else if (msg.type === 'ask-hook-timeout') {
          this._askHookActive = false;
          this._askHookQuestions = null;
        }
      } catch {}
    };
    this._inputWs.onclose = () => {
      this._wsReconnectTimer = setTimeout(() => {
        if (!this._unmounted && this.splitContainerRef.current && this.props.cliMode) {
          this.connectInputWs();
        }
      }, 2000);
    };
  }

  _stripAnsi(str) {
    // Remove CSI sequences (ESC [ ... final byte), OSC sequences (ESC ] ... ST), and other escape sequences
    return str
      .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
      .replace(/\x1b[^[\]](.|$)/g, '')
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  }

  _appendPtyData(raw) {
    const clean = this._stripAnsi(raw);
    this._ptyBuffer += clean;
    this._ptyDataSeq++;
    // Keep buffer at max 4KB
    if (this._ptyBuffer.length > 4096) {
      this._ptyBuffer = this._ptyBuffer.slice(-4096);
    }
    if (this._ptyDebounceTimer) clearTimeout(this._ptyDebounceTimer);
    this._ptyDebounceTimer = setTimeout(() => this._detectPrompt(), 200);
  }

  _detectPrompt() {
    const buf = this._ptyBuffer.trimEnd();

    let question = null;
    let options = null;

    // Pattern 1: Numbered options — "Question?\n  ❯ 1. Option A\n    2. Option B"
    const match1 = buf.match(/([^\n]*\?)\s*\n((?:\s*[❯>]?\s*\d+\.\s+[^\n]+\n?){2,})$/);
    if (match1) {
      question = match1[1].trim();
      const optionLines = match1[2].match(/\s*([❯>])?\s*(\d+)\.\s+([^\n]+)/g);
      if (optionLines) {
        options = optionLines.map(line => {
          const m = line.match(/\s*([❯>])?\s*(\d+)\.\s+(.+)/);
          return {
            number: parseInt(m[2], 10),
            text: m[3].trim(),
            selected: !!m[1],
          };
        });
      }
    }

    // Pattern 2: Non-numbered cursor-based options (Ink Select) —
    // "Some prompt text\n  ❯ Allow once\n    Deny"
    // Question line may or may not end with "?"
    if (!options) {
      const match2 = buf.match(/([^\n]+)\n((?:\s+[❯>]?\s+[^\n]+\n?){2,})$/);
      if (match2) {
        const candidateQ = match2[1].trim();
        const block = match2[2];
        // Parse lines: each line starts with optional ❯/> marker + text
        const lines = block.split('\n').filter(l => l.trim());
        const parsed = [];
        for (const line of lines) {
          const m = line.match(/^\s*([❯>])?\s+(.+)/);
          if (m && m[2].trim()) {
            parsed.push({
              number: parsed.length + 1,
              text: m[2].trim(),
              selected: !!m[1],
            });
          }
        }
        if (parsed.length >= 2 && parsed.some(p => p.selected)) {
          question = candidateQ;
          options = parsed;
        }
      }
    }

    if (question && options) {
      // Skip false positive: question looks like a file/directory path or status-bar output
      if (/^[■\s]*[~\/.:]/.test(question) && /\//.test(question)) return;
      // Skip false positive: question looks like Claude Code timing/status output (e.g. "*Crunchedfor2m18s")
      if (/^[*■✦⏎]/.test(question)) return;

      const prev = this.state.ptyPrompt;
      const prompt = { question, options };
      // 同一问题只更新选项（光标移动），不重复推入历史
      if (prev && prev.question === question) {
        this._currentPtyPrompt = prompt;
        this.setState({ ptyPrompt: prompt });
      } else {
        // 新提示：先将旧的 active 提示标记为 dismissed
        this._currentPtyPrompt = prompt;
        this.setState(state => {
          const history = state.ptyPromptHistory.slice();
          if (state.ptyPrompt) {
            const last = history[history.length - 1];
            if (last && last.status === 'active') {
              history[history.length - 1] = { ...last, status: 'dismissed' };
            }
          }
          history.push({ ...prompt, status: 'active', selectedNumber: null, timestamp: new Date().toISOString() });
          // Cap history to prevent unbounded growth
          if (history.length > 200) history.splice(0, history.length - 200);
          return { ptyPrompt: prompt, ptyPromptHistory: history };
        });
        this.scrollToBottom();
      }
      return;
    }
    // No match — if there was an active prompt, mark it dismissed
    // But keep plan approval prompts and AskUserQuestion prompts active
    if (this.state.ptyPrompt) {
      if (isPlanApprovalPrompt(this.state.ptyPrompt)) {
        // Don't dismiss plan approval prompts — they stay active until explicitly answered
        return;
      }
      if (isDangerousOperationPrompt(this.state.ptyPrompt)) {
        return;
      }
      if (this._askSubmitting) {
        // Don't dismiss prompts during AskUserQuestion submission
        return;
      }
      this._currentPtyPrompt = null;
      this.setState(state => {
        const history = state.ptyPromptHistory.slice();
        const last = history[history.length - 1];
        if (last && last.status === 'active') {
          history[history.length - 1] = { ...last, status: 'dismissed' };
        }
        return { ptyPrompt: null, ptyPromptHistory: history };
      });
    }
  }

  _clearPtyPrompt() {
    this._ptyBuffer = '';
    this._currentPtyPrompt = null;
    if (this._ptyDebounceTimer) clearTimeout(this._ptyDebounceTimer);
    if (this.state.ptyPrompt) {
      this.setState({ ptyPrompt: null });
    }
  }

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
    this._currentPtyPrompt = null;
    this.setState(state => {
      const history = state.ptyPromptHistory.slice();
      const last = history[history.length - 1];
      if (last && last.status === 'active') {
        history[history.length - 1] = { ...last, status: 'answered', selectedNumber: number };
      }
      return { ptyPrompt: null, ptyPromptHistory: history };
    });
    this._ptyBuffer = '';
    if (this._ptyDebounceTimer) clearTimeout(this._ptyDebounceTimer);
    setTimeout(() => { this._promptSubmitting = false; }, 500);
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
          const startBuf = this._ptyBuffer;
          let attempts = 0;
          const poll = () => {
            attempts++;
            if (attempts > 20 || this._ptyBuffer !== startBuf) {
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

    this._currentPtyPrompt = null;
    this.setState(state => {
      const history = state.ptyPromptHistory.slice();
      const last = history[history.length - 1];
      if (last && last.status === 'active') {
        history[history.length - 1] = { ...last, status: 'answered', selectedNumber: number };
      }
      return { ptyPrompt: null, ptyPromptHistory: history };
    });
    this._ptyBuffer = '';
    if (this._ptyDebounceTimer) clearTimeout(this._ptyDebounceTimer);
  };

  /**
   * Plan submission strategy for each answer based on question structure.
   * Annotates each answer with `isLast` flag.
   */
  _planSubmissionSteps(answers) {
    return answers.map((answer, i) => ({
      ...answer,
      isLast: i === answers.length - 1,
    }));
  }

  /**
   * AskUserQuestion 交互提交
   * answers: [{ questionIndex, type: 'single'|'multi'|'other', optionIndex, selectedIndices, text }]
   */
  handleAskQuestionSubmit = (answers, askId, questions) => {
    // 立即更新本地答案映射，解除 Last Response 中"提交中..."卡住状态
    if (askId && questions) {
      const localAnswers = {};
      for (const answer of answers) {
        const q = questions[answer.questionIndex];
        if (!q) continue;
        if (answer.type === 'other') {
          localAnswers[q.question] = answer.text;
        } else if (answer.type === 'multi') {
          const labels = answer.selectedIndices.map(i => (q.options || [])[i]?.label).filter(Boolean);
          localAnswers[q.question] = labels.join(', ');
        } else {
          localAnswers[q.question] = (q.options || [])[answer.optionIndex]?.label || '';
        }
      }
      this.setState(prev => ({
        localAskAnswers: { ...(prev.localAskAnswers || {}), [askId]: localAnswers },
      }));
    }

    // Hook bridge path: submit structured JSON instead of PTY simulation
    // Guard: don't switch to hook path if PTY submission is already in progress
    if (this._askHookActive && !this._askSubmitting) {
      this._submitViaHookBridge(answers);
      return;
    }

    // Hook bridge 可能尚未就绪（streaming response 先于 hook 触发的时序竞争）：
    // WebSocket 已连接但 ask-hook-pending 消息还没到 → 短暂等待再决定路径
    if (!this._askHookActive && !this._askSubmitting
        && this._inputWs && this._inputWs.readyState === WebSocket.OPEN) {
      this._pendingHookAnswers = answers;
      this._askHookWaitRetries = 0;
      this._askSubmitting = true;
      this._waitForHookBridge();
      return;
    }

    this._submitViaPty(answers);
  };

  /**
   * 等待 hook bridge（ask-hook-pending）到达，最多 3s。
   * 解决：对话面板渲染 AskUserQuestion 卡片远早于 PreToolUse hook 触发。
   */
  _waitForHookBridge() {
    if (this._unmounted) return;
    if (this._askHookActive) {
      const answers = this._pendingHookAnswers;
      this._pendingHookAnswers = null;
      this._submitViaHookBridge(answers);
      return;
    }
    this._askHookWaitRetries = (this._askHookWaitRetries || 0) + 1;
    if (this._askHookWaitRetries > 30) { // 3s 超时
      // Hook bridge 未到达，fallback 到 PTY 路径
      const answers = this._pendingHookAnswers;
      this._pendingHookAnswers = null;
      this._submitViaPty(answers);
      return;
    }
    this._hookWaitTimer = setTimeout(() => this._waitForHookBridge(), 100);
  }

  /**
   * PTY 模拟路径（原有逻辑，从 handleAskQuestionSubmit 提取）
   */
  _submitViaPty(answers) {
    const ws = this._inputWs;

    // Lazily connect WebSocket if not connected
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      this._askAnswerQueue = this._planSubmissionSteps(answers);
      this._askSubmitting = true;
      this._isMultiQuestionForm = answers.length > 1;
      this.connectInputWs();
      this._askWsRetries = 0;
      this._waitForWsAndSubmit();
      return;
    }

    this._askAnswerQueue = this._planSubmissionSteps(answers);
    this._askSubmitting = true;
    this._isMultiQuestionForm = answers.length > 1;

    // ptyPrompt may not be available yet (streaming response renders before CLI prompt appears)
    // Retry with delay until ptyPrompt is detected
    if (!this._currentPtyPrompt) {
      this._askPromptRetries = 0;
      this._waitForPtyPromptAndSubmit();
      return;
    }

    this._processNextAskAnswer();
  }

  _waitForWsAndSubmit() {
    this._askWsRetries = (this._askWsRetries || 0) + 1;
    if (this._askWsRetries > 30) {
      // Give up after ~3 seconds
      this._askSubmitting = false;
      this._askAnswerQueue = [];
      return;
    }
    if (this._inputWs && this._inputWs.readyState === WebSocket.OPEN) {
      // WS connected, now wait for ptyPrompt
      if (!this._currentPtyPrompt) {
        this._askPromptRetries = 0;
        this._waitForPtyPromptAndSubmit();
      } else {
        this._processNextAskAnswer();
      }
      return;
    }
    this._waitForWsTimer = setTimeout(() => this._waitForWsAndSubmit(), 100);
  }

  _waitForPtyPromptAndSubmit() {
    this._askPromptRetries = (this._askPromptRetries || 0) + 1;
    if (this._askPromptRetries > 50) {
      // Timeout: proceed without ptyPrompt (assume first option selected, CLI default)
      this._processNextAskAnswer();
      return;
    }
    if (this._currentPtyPrompt) {
      this._processNextAskAnswer();
      return;
    }
    this._waitForPtyTimer = setTimeout(() => this._waitForPtyPromptAndSubmit(), 100);
  }

  _processNextAskAnswer() {
    if (!this._askAnswerQueue || this._askAnswerQueue.length === 0) {
      this._askSubmitting = false;
      return;
    }
    const answer = this._askAnswerQueue.shift();

    // Multi-select Other: handle as single PTY submission.
    // "Type something" is a text input option — type text,
    // ↓ exits text input, → to Submit tab, Enter submits.
    // Uses higher settleMs to ensure text characters are fully processed.
    if (answer.type === 'other' && answer.isMultiSelect) {
      this._submitViaSequentialQueue(answer, { settleMs: 500 });
      return;
    }

    if (answer.type === 'other') {
      this._submitOtherAnswer(answer);
    } else if (answer.type === 'multi') {
      this._submitMultiSelectAnswer(answer);
    } else {
      this._submitSingleSelectAnswer(answer);
    }
  }

  _submitSingleSelectAnswer(answer) {
    this._submitViaSequentialQueue(answer);
  }

  _submitMultiSelectAnswer(answer) {
    this._submitViaSequentialQueue(answer);
  }

  _submitOtherAnswer(answer) {
    this._submitViaSequentialQueue(answer);
  }

  /**
   * Unified PTY submission: build chunks via ptyChunkBuilder, send via server-side sequential queue.
   */
  _submitViaSequentialQueue(answer, opts = {}) {
    const ws = this._inputWs;
    if (!ws || ws.readyState !== WebSocket.OPEN) { this._askSubmitting = false; return; }

    const isMultiQuestion = !!this._isMultiQuestionForm;
    const chunks = buildChunksForAnswer(answer, this.state.ptyPrompt, isMultiQuestion);
    const settleMs = opts.settleMs || 300;

    const onMessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'input-sequential-done') {
          ws.removeEventListener('message', onMessage);
          this._finishCurrentAskAnswer();
        }
      } catch {}
    };
    ws.addEventListener('message', onMessage);

    ws.send(JSON.stringify({ type: 'input-sequential', chunks, settleMs }));

    setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      if (this._askSubmitting) {
        this._finishCurrentAskAnswer();
      }
    }, 15000);
  }

  _finishCurrentAskAnswer() {
    // Mark current prompt as answered and clear buffer
    this._currentPtyPrompt = null;
    this.setState(state => {
      const history = state.ptyPromptHistory.slice();
      const last = history[history.length - 1];
      if (last && last.status === 'active') {
        history[history.length - 1] = { ...last, status: 'answered' };
      }
      return { ptyPrompt: null, ptyPromptHistory: history };
    });
    // Only clear debounce timer when no more answers pending;
    // if queue has more items, we need _detectPrompt() to fire for the next question
    if (!this._askAnswerQueue || this._askAnswerQueue.length === 0) {
      if (this._ptyDebounceTimer) clearTimeout(this._ptyDebounceTimer);
    }

    // Wait for next prompt to appear (multi-question scenario)
    if (this._askAnswerQueue && this._askAnswerQueue.length > 0) {
      // In tabbed forms, → switches tabs without generating a new prompt.
      // Use fixed delay then proceed — cursor defaults to index 0 on new tab.
      setTimeout(() => {
        this._processNextAskAnswer();
      }, 500);
    } else {
      this._askSubmitting = false;
    }
  }

  /**
   * Submit AskUserQuestion answers via hook bridge (structured JSON, no PTY simulation).
   * Converts client answer format to hook answer format and sends via WebSocket.
   */
  _submitViaHookBridge(answers) {
    const ws = this._inputWs;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      // Fallback to PTY path（直接走 PTY，跳过路由判断避免 WS reconnect 竞态白等 3s）
      this._askHookActive = false;
      this._askHookQuestions = null;
      this._submitViaPty(answers);
      return;
    }

    this._askSubmitting = true;

    const questions = this._askHookQuestions || [];
    const hookAnswers = {};

    for (const answer of answers) {
      const q = questions[answer.questionIndex];
      if (!q) continue;
      const questionText = q.question;

      if (answer.type === 'other') {
        hookAnswers[questionText] = answer.text || '';
      } else if (answer.type === 'multi') {
        const labels = (answer.selectedIndices || [])
          .map((i) => q.options?.[i]?.label)
          .filter(Boolean);
        hookAnswers[questionText] = labels.join(', ');
      } else {
        // single
        hookAnswers[questionText] = q.options?.[answer.optionIndex]?.label || '';
      }
    }

    ws.send(JSON.stringify({ type: 'ask-hook-answer', answers: hookAnswers }));

    // 不立即清除 _askHookActive：保留 hook bridge 状态以支持重试
    // hook 状态由 ask-hook-timeout WS 消息或下一轮 streaming response 自然清除
    this._askSubmitting = false;

    // Update UI state — mark prompt as answered
    this._currentPtyPrompt = null;
    this.setState((state) => {
      const history = state.ptyPromptHistory.slice();
      const last = history[history.length - 1];
      if (last && last.status === 'active') {
        history[history.length - 1] = { ...last, status: 'answered' };
      }
      return { ptyPrompt: null, ptyPromptHistory: history };
    });
    if (this._ptyDebounceTimer) clearTimeout(this._ptyDebounceTimer);
  }

  handleInputSend = () => {
    const textarea = this._inputRef.current;
    if (!textarea) return;
    const text = textarea.value.trim();
    if (!text) return;
    if (this._inputWs && this._inputWs.readyState === WebSocket.OPEN) {
      // Claude Code TUI 逐字符处理输入，需要先发文字再单独发回车
      this._inputWs.send(JSON.stringify({ type: 'input', data: text }));
      setTimeout(() => {
        if (this._inputWs && this._inputWs.readyState === WebSocket.OPEN) {
          this._inputWs.send(JSON.stringify({ type: 'input', data: '\r' }));
        }
      }, 50);
      textarea.value = '';
      textarea.style.height = 'auto';
      this.setState({ inputEmpty: true, pendingInput: text, inputSuggestion: null }, () => this.scrollToBottom());
    }
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
    const quoted = `"${path}"`;
    const textarea = this._inputRef.current;
    if (textarea) {
      textarea.value = (textarea.value ? textarea.value + ' ' : '') + quoted;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      this.setState({ inputEmpty: false });
    }
  };

  handleSplitMouseDown = (e) => {
    e.preventDefault();
    this._resizing = true;

    // 只在 PC 模式下启用吸附功能
    const isCliMode = window.location.search.includes('token=');
    const enableSnap = !isCliMode;

    // 计算吸附线位置（基于终端标准列宽）
    let snapLines = [];
    if (enableSnap) {
      const container = this.innerSplitRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        const containerWidth = rect.width;

        // 终端字体：13px Menlo/Monaco，字符宽度约为 7.8px
        const charWidth = 7.8;
        // 常见终端列宽：60, 80, 100, 120
        const terminalWidths = [60, 80, 100, 120];
        const resizerWidth = 5; // 分隔条宽度

        snapLines = terminalWidths.map(cols => {
          const terminalPx = cols * charWidth;
          const totalTerminalWidth = terminalPx + resizerWidth;

          // 只保留合理范围内的吸附线（终端宽度不超过容器的75%，且不小于15%）
          if (totalTerminalWidth > containerWidth * 0.75 || totalTerminalWidth < containerWidth * 0.15) return null;

          // 吸附线位置 = 容器宽度 - 终端像素宽度 - 分隔条宽度
          const linePosition = containerWidth - terminalPx - resizerWidth;

          return {
            cols,
            terminalPx, // 终端像素宽度
            linePosition // 吸附线显示位置
          };
        }).filter(snap => snap !== null);
      }
    }

    this.setState({ isDragging: true, snapLines });

    const onMouseMove = (ev) => {
      if (!this._resizing) return;
      const container = this.innerSplitRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const containerWidth = rect.width;
      // 终端宽度 = 容器右边缘 - 鼠标位置
      let tw = rect.right - ev.clientX;
      tw = Math.max(200, Math.min(containerWidth * 0.75, tw));

      // 吸附逻辑
      let activeSnapLine = null;
      if (enableSnap && snapLines.length > 0) {
        const snapThreshold = 60; // 60px 的吸附阈值
        let minDistance = Infinity;
        let closestSnap = null;

        for (const snap of snapLines) {
          const distance = Math.abs(ev.clientX - rect.left - snap.linePosition);
          if (distance < minDistance) {
            minDistance = distance;
            closestSnap = snap;
          }
        }

        if (closestSnap && minDistance < snapThreshold) {
          activeSnapLine = closestSnap;
        }
      }

      this.setState({ terminalWidth: tw, activeSnapLine });
    };

    const onMouseUp = () => {
      this._resizing = false;

      // 松开鼠标时，吸附到最近的线
      if (enableSnap && this.state.activeSnapLine) {
        const newWidth = this.state.activeSnapLine.terminalPx;
        // 保存用户偏好到 localStorage
        localStorage.setItem('cc-viewer-terminal-width', newWidth.toString());
        this.setState({
          terminalWidth: newWidth,
          isDragging: false,
          activeSnapLine: null,
          snapLines: [],
          needsInitialSnap: false
        });
      } else {
        // 用户手动拖拽到非吸附位置，也保存偏好
        localStorage.setItem('cc-viewer-terminal-width', this.state.terminalWidth.toString());
        this.setState({
          isDragging: false,
          activeSnapLine: null,
          snapLines: [],
          needsInitialSnap: false
        });
      }

      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  handleToggleExpandPath = (path) => {
    this.setState(state => {
      const newSet = new Set(state.fileExplorerExpandedPaths);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return { fileExplorerExpandedPaths: newSet };
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
    this._setFileExplorerOpen(true);
    this.setState(prev => {
      const newSet = new Set(prev.fileExplorerExpandedPaths);
      ancestors.forEach(p => newSet.add(p));
      return {
        currentFile: resolved,
        currentGitDiff: null,
        scrollToLine: null,
        fileExplorerExpandedPaths: newSet,
      };
    });
  };

  _snapToInitialPosition() {
    // 初始化时吸附到 60cols
    const charWidth = 7.8;
    const targetCols = 60;
    const terminalPx = targetCols * charWidth; // 468px

    this.setState({ terminalWidth: terminalPx, needsInitialSnap: false });
    localStorage.setItem('cc-viewer-terminal-width', terminalPx.toString());
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

    const prompts = [];
    const seen = new Set();

    for (let i = 0; i < visible.length; i++) {
      const props = visible[i].props;
      if (!props || props.role !== 'user') continue;
      const raw = props.text || '';
      if (!raw) continue;
      // 清理图片标记，只保留文字部分用于导航列表显示
      const text = raw
        .replace(/\[Image(?:\s*#\d+)?(?::?\s*source)?:\s*[^\]]+\]/gi, '')
        .replace(/"\/tmp\/cc-viewer-uploads\/[^"]+"/g, '')
        .trim();
      if (!text) continue;
      const key = text.substring(0, 100);
      if (seen.has(key)) continue;
      seen.add(key);
      const display = text.length > 80 ? text.substring(0, 80) + '...' : text;
      // 使用 visible 索引作为定位标识（兼容无 timestamp 的遗留消息）
      prompts.push({ display, visibleIdx: i, timestamp: props.timestamp || null });
    }

    if (prompts.length === 0) { this._navCacheVisible = visible; this._navCacheResult = null; return null; }

    const result = (
      <div className={styles.userPromptNavList}>
        {prompts.map((p, i) => (
          <div key={p.visibleIdx} className={styles.userPromptNavItem}
            onClick={() => this._scrollToUserPrompt(p.visibleIdx, p.timestamp)}>
            {p.display}
          </div>
        ))}
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
      this.setState({ highlightTs: timestamp, highlightFading: false }, () => {
        this._doScrollToVisibleIdx(visibleIdx);
        this._bindScrollFade();
      });
    } else {
      // 无 timestamp 的遗留消息：仅滚动，不触发高亮
      this._doScrollToVisibleIdx(visibleIdx);
    }
  }

  _doScrollToVisibleIdx(idx) {
    if (isMobile && this.virtuosoRef.current) {
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
    const { allItems, visibleCount, loading, terminalWidth, lastResponseItems } = this.state;

    const noMainAgent = !mainAgentSessions || mainAgentSessions.length === 0;
    const noData = noMainAgent && (!allItems || allItems.length === 0);

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
          const tmA = isTeammate ? getTeammateAvatar(label) : null;
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
        if (role === 'sub-agent-chat') {
          const key = `sub:${item.props.label || 'SubAgent'}`;
          return this.state.roleFilterSelected.has(key);
        }
        return false;
      });
    }

    const _isFiltering = _selSize > 0 && _selSize < collectedRoles.length;
    const filteredLastResponseItems = lastResponseItems && _isFiltering && !this.state.roleFilterSelected.has('assistant') ? null : lastResponseItems;

    const targetIdx = this._scrollTargetIdx;
    const { highlightTs, highlightFading } = this.state;
    const visible = filteredItems.slice(0, _isFiltering ? filteredItems.length : visibleCount);
    // 缓存 visible，供 _buildUserPromptNav / _scrollToUserPrompt 使用
    this._currentVisible = visible;
    // H2 fix: highlightIdx 基于 visible 索引（而非 allItems 索引），role filter 时不会偏移
    const highlightIdx = highlightTs != null
      ? visible.findIndex(item => item.props?.timestamp === highlightTs)
      : -1;

    const { pendingInput, stickyBottom, ptyPromptHistory } = this.state;

    const pendingBubble = cliMode && pendingInput ? (
      <ChatMessage key="pending-input" role="user" text={pendingInput} timestamp={new Date().toISOString()} userProfile={this.props.userProfile} />
    ) : null;

    const stickyBtn = !stickyBottom ? (
      <button className={styles.stickyBottomBtn} onClick={this.handleStickToBottom}>
        <span>{t('ui.stickyBottom')}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
    ) : null;

    const loadMoreBtn = isMobile && this._mobileSliceOffset > 0 ? (
      <div className={styles.loadMoreWrap}>
        <button className={styles.loadMoreBtn} onClick={this.handleLoadMore}>
          {t('ui.loadMoreHistory', { count: this._mobileSliceOffset })}
        </button>
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
        {isMobile ? (
          this._virtuosoHeader = loadMoreBtn,
          this._virtuosoFooter = <>{(this.props.isStreaming || this.state.streamingFading) && (
            <div className={styles.streamingSpinnerWrap} style={this.state.streamingFading ? { opacity: 0 } : undefined}>
              <svg width="20" height="20" viewBox="0 0 20 20">
                <defs>
                  <linearGradient id="ccv-spinnerGrad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="white" stopOpacity="1" />
                    <stop offset="100%" stopColor="white" stopOpacity="0.1" />
                  </linearGradient>
                </defs>
                <circle cx="10" cy="10" r="7.5" fill="none" strokeWidth="2"
                  stroke="url(#ccv-spinnerGrad)" strokeLinecap="round"
                  pathLength="100" strokeDasharray="75 25">
                  <animateTransform attributeName="transform" type="rotate"
                    from="0 10 10" to="360 10 10" dur="0.8s" repeatCount="indefinite" />
                </circle>
              </svg>
            </div>
          )}{filteredLastResponseItems}{pendingBubble}</>,
          <Virtuoso
            ref={this.virtuosoRef}
            className={styles.mobileVirtuoso}
            data={visible}
            initialTopMostItemIndex={Math.max(0, visible.length - 1)}
            followOutput={this.state.stickyBottom ? 'smooth' : false}
            atBottomStateChange={(atBottom) => {
              if (atBottom !== this.state.stickyBottom) this.setState({ stickyBottom: atBottom });
            }}
            atBottomThreshold={60}
            increaseViewportBy={{ top: 400, bottom: 200 }}
            computeItemKey={(index) => visible[index]?.key || `v-${index}`}
            itemContent={(index) => {
              const item = visible[index];
              const isScrollTarget = index === targetIdx;
              const needsHighlight = index === highlightIdx;
              let el = item;
              if (needsHighlight) el = React.cloneElement(el, { highlight: highlightFading ? 'fading' : 'active' });
              return isScrollTarget ? <div ref={this._scrollTargetRef}>{el}</div> : el;
            }}
            scrollerRef={(ref) => { this._virtuosoScrollerEl = ref; }}
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
            {(this.props.isStreaming || this.state.streamingFading) && (
              <div className={styles.streamingSpinnerWrap} style={this.state.streamingFading ? { opacity: 0 } : undefined}>
                <svg width="20" height="20" viewBox="0 0 20 20">
                  <defs>
                    <linearGradient id="ccv-spinnerGrad-desktop" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="white" stopOpacity="1" />
                      <stop offset="100%" stopColor="white" stopOpacity="0.1" />
                    </linearGradient>
                  </defs>
                  <circle cx="10" cy="10" r="7.5" fill="none" strokeWidth="2"
                    stroke="url(#ccv-spinnerGrad-desktop)" strokeLinecap="round"
                    pathLength="100" strokeDasharray="75 25">
                    <animateTransform attributeName="transform" type="rotate"
                      from="0 10 10" to="360 10 10" dur="0.8s" repeatCount="indefinite" />
                  </circle>
                </svg>
              </div>
            )}
            {filteredLastResponseItems && (
              targetIdx != null && targetIdx >= visible.length
                ? <div key="last-resp-anchor" ref={this._scrollTargetRef}>{filteredLastResponseItems}</div>
                : filteredLastResponseItems
            )}
            {pendingBubble}
          </div>
        )}
        {stickyBtn}
      </div>
    );

    if (!cliMode) {
      return (<>
        <div className={styles.splitContainer}>
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
          <TeamButton requests={this.props.requests} onOpenSession={(session) => this.setState({ teamModalSession: session })} navBtnClass={styles.navBtn} />
          </div>
          <div className={styles.navSidebarContent}>
            {messageList}
          </div>
        </div>
        <TeamModal session={this.state.teamModalSession} requests={this.props.requests} mainAgentSessions={this.props.mainAgentSessions} collapseToolResults={this.props.collapseToolResults} expandThinking={this.props.expandThinking} userProfile={this.props.userProfile} onViewRequest={this.props.onViewRequest} onClose={() => this.setState({ teamModalSession: null })} />
      </>);
    }

    return (<>
      <div ref={this.splitContainerRef} className={styles.splitContainer}>
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
          <button
            className={this.state.fileExplorerOpen ? styles.navBtnActive : styles.navBtn}
            onClick={() => { this._setFileExplorerOpen(!this.state.fileExplorerOpen); this.setState({ gitChangesOpen: false }); }}
            title={t('ui.fileExplorer')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2z"/>
            </svg>
          </button>
          <button
            className={this.state.gitChangesOpen ? styles.navBtnActive : styles.navBtn}
            onClick={() => this.setState(prev => {
              this._setFileExplorerOpen(false);
              return { gitChangesOpen: !prev.gitChangesOpen };
            })}
            title={t('ui.gitChanges')}
          >
            <svg width="24" height="24" viewBox="0 0 1024 1024" fill="currentColor">
              <path d="M759.53332137 326.35000897c0-48.26899766-39.4506231-87.33284994-87.87432908-86.6366625-46.95397689 0.69618746-85.08957923 39.14120645-85.39899588 86.09518335-0.23206249 40.68828971 27.53808201 74.87882971 65.13220519 84.47074592 10.82958281 2.78474987 18.41029078 12.37666607 18.64235327 23.51566553 0.38677082 21.11768647-3.40358317 44.40128953-17.24997834 63.81718442-22.20064476 31.17372767-62.42480948 42.46743545-97.93037026 52.44612248-22.43270724 6.26568719-38.75443563 7.89012462-53.14230994 9.28249954-20.42149901 2.01120825-39.76003975 3.94506233-63.89453858 17.79145747-5.10537475 2.93945818-10.13339535 6.18833303-14.85199928 9.74662453-4.09977063 3.09416652-9.90133285 0.15470833-9.90133286-4.95066641V302.60228095c0-9.43720788 5.26008307-18.17822829 13.69168683-22.3553531 28.69839444-14.23316598 48.42370599-43.93716454 48.19164353-78.20505872-0.38677082-48.57841433-41.15241468-87.71962076-89.730829-86.01782918C338.80402918 117.57112321 301.59667683 155.70672553 301.59667683 202.58334827c0 34.03583169 19.64795738 63.50776777 48.1916435 77.66357958 8.43160375 4.17712479 13.69168685 12.76343689 13.69168684 22.12329062v419.02750058c0 9.43720788-5.26008307 18.17822829-13.69168684 22.3553531-28.69839444 14.23316598-48.42370599 43.93716454-48.1916435 78.20505872 0.30941665 48.57841433 41.07506052 87.6422666 89.65347484 86.01782918C437.74000359 906.42887679 474.87000179 868.2159203 474.87000179 821.41665173c0-34.03583169-19.64795738-63.50776777-48.1916435-77.66357958-8.43160375-4.17712479-13.69168685-12.76343689-13.69168684-22.12329062v-14.85199926c0-32.48874844 15.39347842-63.27570528 42.00331048-81.91805854 2.39797906-1.70179159 4.95066642-3.32622901 7.50335379-4.79595812 14.92935344-8.58631209 25.91364457-9.66927037 44.09187287-11.4484161 15.62554091-1.54708326 35.04143581-3.48093734 61.65126786-10.90693699 39.06385228-10.98429114 92.51557887-25.91364457 124.84961898-71.39789238 18.56499911-26.06835292 27.38337367-58.01562219 26.37776956-95.14562041-0.15470833-5.33743724-0.54147915-10.67487447-1.08295828-16.16702004-0.85089578-8.27689543 2.70739569-16.24437421 9.12779121-21.50445729 19.57060322-15.78024923 32.02462345-39.99210223 32.02462345-67.14341343zM351.1033411 202.58334827c0-20.49885317 16.63114503-37.12999821 37.1299982-37.1299982s37.12999821 16.63114503 37.12999821 37.1299982-16.63114503 37.12999821-37.12999821 37.1299982-37.12999821-16.63114503-37.1299982-37.1299982z m74.25999641 618.83330346c0 20.49885317-16.63114503 37.12999821-37.12999821 37.1299982s-37.12999821-16.63114503-37.1299982-37.1299982 16.63114503-37.12999821 37.1299982-37.1299982 37.12999821 16.63114503 37.12999821 37.1299982z m247.53332139-457.93664456c-20.49885317 0-37.12999821-16.63114503-37.1299982-37.1299982s16.63114503-37.12999821 37.1299982-37.12999821 37.12999821 16.63114503 37.1299982 37.12999821-16.63114503 37.12999821-37.1299982 37.1299982z"/>
            </svg>
          </button>
          <TeamButton requests={this.props.requests} onOpenSession={(session) => this.setState({ teamModalSession: session })} navBtnClass={styles.navBtn} />
          <Popover
            content={this._buildUserPromptNav()}
            trigger="hover"
            placement="rightTop"
            overlayStyle={{ maxWidth: 400 }}
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
        <div className={styles.innerSplitArea} ref={this.innerSplitRef}>
          <SnapLineOverlay isDragging={this.state.isDragging} activeSnapLine={this.state.activeSnapLine} snapLines={this.state.snapLines} terminalWidth={this.state.terminalWidth} containerRef={this.innerSplitRef} />
          {this.state.fileExplorerOpen && (
            <FileExplorer
              refreshTrigger={this.state.fileExplorerRefresh}
              onClose={() => this._setFileExplorerOpen(false)}
              onFileClick={(path) => this.setState({ currentFile: path, currentGitDiff: null, scrollToLine: null })}
              expandedPaths={this.state.fileExplorerExpandedPaths}
              onToggleExpand={this.handleToggleExpandPath}
              currentFile={this.state.currentFile}
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
              refreshTrigger={this.state.gitChangesRefresh}
              onClose={() => this.setState({ gitChangesOpen: false })}
              onFileClick={(path) => this.setState({ currentGitDiff: path, currentFile: null })}
            />
          )}
          <div className={styles.chatSection}>
            <div className={styles.chatSectionFlex}>
            {this.state.currentGitDiff && (
              <div className={styles.overlayPanel}>
                <GitDiffView
                  filePath={this.state.currentGitDiff}
                  onClose={() => this.setState({ currentGitDiff: null })}
                  onOpenFile={(path, line) => {
                    // 计算祖先目录路径并展开，确保文件在文件浏览器中可见并滚动定位
                    const parts = path.split('/');
                    const ancestors = [];
                    for (let i = 1; i < parts.length; i++) {
                      ancestors.push(parts.slice(0, i).join('/'));
                    }
                    this._setFileExplorerOpen(true);
                    this.setState(prev => {
                      const newSet = new Set(prev.fileExplorerExpandedPaths);
                      ancestors.forEach(p => newSet.add(p));
                      return {
                        currentGitDiff: null,
                        currentFile: path,
                        scrollToLine: line || 1,
                        gitChangesOpen: false,
                        fileExplorerExpandedPaths: newSet,
                      };
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
                        fetch('/api/editor-done', {
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
                    editorSession={!!this.state.editorSessionId}
                    onClose={() => {
                      if (this.state.editorSessionId) {
                        fetch('/api/editor-done', {
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
            <ChatInputBar
              inputRef={this._inputRef}
              inputEmpty={this.state.inputEmpty}
              inputSuggestion={this.state.inputSuggestion}
              terminalVisible={terminalVisible}
              onKeyDown={this.handleInputKeyDown}
              onChange={this.handleInputChange}
              onSend={this.handleInputSend}
              onSuggestionClick={this.handleSuggestionToTerminal}
              onUploadPath={this.handleUploadPath}
              presetItems={this.state.presetItems}
              onPresetSend={this.handlePresetSend}
              isStreaming={this.props.isStreaming}
              streamingFading={this.state.streamingFading}
            />
            </div>
          </div>
          {cliMode && onToggleTerminal && (
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
                <TerminalPanel onEditorOpen={(sessionId, filePath) => {
                  this.setState({
                    editorSessionId: sessionId,
                    editorFilePath: filePath,
                    currentFile: filePath,
                    currentGitDiff: null,
                    scrollToLine: null,
                    fileVersion: (this.state.fileVersion || 0) + 1,
                  });
                }} onFilePath={(path) => {
                  const quoted = `"${path}"`;
                  if (this._inputWs && this._inputWs.readyState === WebSocket.OPEN) {
                    this._inputWs.send(JSON.stringify({ type: 'input', data: quoted }));
                  }
                }} />
              </div>
            </>
          )}
        </div>
      </div>
      <TeamModal session={this.state.teamModalSession} requests={this.props.requests} mainAgentSessions={this.props.mainAgentSessions} collapseToolResults={this.props.collapseToolResults} expandThinking={this.props.expandThinking} userProfile={this.props.userProfile} onViewRequest={this.props.onViewRequest} onClose={() => this.setState({ teamModalSession: null })} />
    </>);
  }
}

export default ChatView;
