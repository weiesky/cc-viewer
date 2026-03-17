import React from 'react';
import { Empty, Typography, Divider, Spin } from 'antd';
import ChatMessage from './ChatMessage';
import TerminalPanel, { uploadFileAndGetPath } from './TerminalPanel';
import FileExplorer from './FileExplorer';
import FileContentView from './FileContentView';
import ImageViewer from './ImageViewer';
import GitChanges from './GitChanges';
import GitDiffView from './GitDiffView';
import { extractToolResultText, getModelInfo } from '../utils/helpers';
import { isSystemText, classifyUserContent, isMainAgent } from '../utils/contentFilter';
import { classifyRequest, formatRequestTag } from '../utils/requestType';
import { isMobile } from '../env';
import { t } from '../i18n';
import styles from './ChatView.module.css';

const { Text } = Typography;

const QUEUE_THRESHOLD = 20;

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp']);
function isImageFile(path) {
  const ext = (path || '').split('.').pop().toLowerCase();
  return IMAGE_EXTS.has(ext);
}

const MUTATING_CMD_RE = /\b(rm|mkdir|mv|cp|touch|chmod|chown|ln|git\s+(checkout|reset|stash|merge|rebase|cherry-pick|restore|clean|rm)|npm\s+(install|uninstall|ci)|yarn\s+(add|remove)|pnpm\s+(add|remove|install)|pip\s+install|tar|unzip|curl\s+-[^\s]*o|wget)\b|[^>]>(?!>)|>>/;

function isMutatingCommand(cmd) {
  return MUTATING_CMD_RE.test(cmd);
}
const MOBILE_ITEM_LIMIT = 240;
const MOBILE_LOAD_MORE_STEP = 100;

function randomInterval() {
  return 100 + Math.random() * 50;
}

export function isPlanApprovalPrompt(prompt) {
  if (!prompt) return false;
  const q = prompt.question.toLowerCase();
  return /plan/i.test(q) && (/approv/i.test(q) || /proceed/i.test(q) || /accept/i.test(q));
}

function buildToolResultMap(messages) {
  const toolUseMap = {};
  for (const msg of messages) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool_use') {
          // 流式组装可能导致 input 是字符串，需要解析
          let parsed = block;
          if (typeof block.input === 'string') {
            try {
              const cleaned = block.input.replace(/^\[object Object\]/, '');
              parsed = { ...block, input: JSON.parse(cleaned) };
            } catch {}
          }
          toolUseMap[parsed.id] = parsed;
        }
      }
    }
  }

  const toolResultMap = {};
  const readContentMap = {};
  for (const msg of messages) {
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          const matchedTool = toolUseMap[block.tool_use_id];
          let label = t('ui.toolReturn');
          let toolName = null;
          let toolInput = null;
          if (matchedTool) {
            toolName = matchedTool.name;
            toolInput = matchedTool.input;
            if (matchedTool.name === 'Task' && matchedTool.input) {
              const st = matchedTool.input.subagent_type || '';
              const desc = matchedTool.input.description || '';
              label = `SubAgent: ${st}${desc ? ' — ' + desc : ''}`;
            } else {
              label = t('ui.toolReturnNamed', { name: matchedTool.name });
            }
          }
          const resultText = extractToolResultText(block);
          toolResultMap[block.tool_use_id] = {
            label,
            toolName,
            toolInput,
            resultText,
          };
          // 收集 Read 结果，用于 Edit diff 行号定位
          if (matchedTool && matchedTool.name === 'Read' && matchedTool.input?.file_path) {
            readContentMap[matchedTool.input.file_path] = resultText;
          }
        }
      }
    }
  }
  // 构建 editSnapshotMap：为每个 Edit tool_use 保存应用前的文件快照
  // 这样每个 Edit 的 old_string 都能在对应快照中正确定位
  const editSnapshotMap = {};
  const _fileState = {}; // 内部追踪文件当前状态
  for (const msg of messages) {
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          const matchedTool = toolUseMap[block.tool_use_id];
          if (matchedTool && matchedTool.name === 'Read' && matchedTool.input?.file_path) {
            const resultText = extractToolResultText(block);
            const readLines = resultText.split('\n');
            const plainLines = [];
            const lineNums = [];
            for (const rl of readLines) {
              const m = rl.match(/^\s*(\d+)[\t→](.*)$/);
              if (m) {
                lineNums.push(parseInt(m[1], 10));
                plainLines.push(m[2]);
              }
            }
            if (plainLines.length > 0) {
              const existing = _fileState[matchedTool.input.file_path];
              if (existing) {
                // 合并部分读取：将新读取的行按行号插入/覆盖到已有状态中
                const mergedMap = new Map();
                for (let i = 0; i < existing.lineNums.length; i++) {
                  mergedMap.set(existing.lineNums[i], existing.plainText.split('\n')[i]);
                }
                for (let i = 0; i < lineNums.length; i++) {
                  mergedMap.set(lineNums[i], plainLines[i]);
                }
                const sortedKeys = [...mergedMap.keys()].sort((a, b) => a - b);
                _fileState[matchedTool.input.file_path] = {
                  plainText: sortedKeys.map(k => mergedMap.get(k)).join('\n'),
                  lineNums: sortedKeys,
                };
              } else {
                _fileState[matchedTool.input.file_path] = { plainText: plainLines.join('\n'), lineNums };
              }
            }
          }
        }
      }
    } else if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool_use' && block.name === 'Edit' && block.input) {
          const fp = block.input.file_path;
          const oldStr = block.input.old_string;
          const newStr = block.input.new_string;
          if (fp && oldStr != null && newStr != null && _fileState[fp]) {
            const entry = _fileState[fp];
            // 保存此 Edit 应用前的快照
            editSnapshotMap[block.id] = { plainText: entry.plainText, lineNums: entry.lineNums.slice() };
            // 应用 Edit 更新文件状态
            const idx = entry.plainText.indexOf(oldStr);
            if (idx >= 0) {
              const before = entry.plainText.substring(0, idx);
              const lineOffset = before.split('\n').length - 1;
              const oldLineCount = oldStr.split('\n').length;
              const newLineCount = newStr.split('\n').length;
              const lineDelta = newLineCount - oldLineCount;
              entry.plainText = entry.plainText.substring(0, idx) + newStr + entry.plainText.substring(idx + oldStr.length);
              if (lineDelta !== 0) {
                const startNum = entry.lineNums[lineOffset] || (lineOffset + 1);
                const newNums = [];
                for (let i = 0; i < newLineCount; i++) {
                  newNums.push(startNum + i);
                }
                entry.lineNums = [
                  ...entry.lineNums.slice(0, lineOffset),
                  ...newNums,
                  ...entry.lineNums.slice(lineOffset + oldLineCount).map(n => n + lineDelta),
                ];
              }
            }
          }
        }
      }
    }
  }
  // 构建 askAnswerMap：为每个 AskUserQuestion tool_use 解析用户选择的答案
  const askAnswerMap = {};
  // 构建 planApprovalMap：为每个 ExitPlanMode tool_use 解析审批状态
  const planApprovalMap = {};
  for (const msg of messages) {
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          const matchedTool = toolUseMap[block.tool_use_id];
          if (matchedTool && matchedTool.name === 'AskUserQuestion') {
            const resultText = extractToolResultText(block);
            askAnswerMap[block.tool_use_id] = parseAskAnswerText(resultText);
          }
          if (matchedTool && matchedTool.name === 'ExitPlanMode') {
            const resultText = extractToolResultText(block);
            planApprovalMap[block.tool_use_id] = parsePlanApproval(resultText);
          }
        }
      }
    }
  }
  return { toolUseMap, toolResultMap, readContentMap, editSnapshotMap, askAnswerMap, planApprovalMap };
}

/** 从 AskUserQuestion tool_result 文本中提取答案 map */
function parseAskAnswerText(text) {
  const answers = {};
  const re = /"([^"]+)"="([^"]*)"/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    answers[m[1]] = m[2];
  }
  return answers;
}

/** 从 ExitPlanMode tool_result 文本中解析审批状态 */
function parsePlanApproval(text) {
  if (!text) return { status: 'pending' };
  if (/User has approved/i.test(text)) return { status: 'approved' };
  if (/User rejected/i.test(text)) {
    const feedbackMatch = text.match(/feedback:\s*(.+)/i) || text.match(/User rejected[^:]*:\s*(.+)/i);
    return { status: 'rejected', feedback: feedbackMatch ? feedbackMatch[1].trim() : '' };
  }
  return { status: 'pending' };
}

class ChatView extends React.Component {
  constructor(props) {
    super(props);
    this.containerRef = React.createRef();
    this.splitContainerRef = React.createRef();
    this.innerSplitRef = React.createRef();

    // 从 localStorage 读取用户偏好的终端宽度（像素）
    const savedWidth = localStorage.getItem('cc-viewer-terminal-width');
    const initialTerminalWidth = savedWidth ? parseFloat(savedWidth) : null;

    this.state = {
      visibleCount: 0,
      loading: false,
      allItems: [],
      highlightTs: null,
      highlightFading: false,
      terminalWidth: initialTerminalWidth || 468, // 默认 60cols * 7.8px
      needsInitialSnap: initialTerminalWidth === null, // 标记是否需要初始化吸附
      inputEmpty: true,
      pendingInput: null,
      stickyBottom: true,
      ptyPrompt: null,
      ptyPromptHistory: [],
      inputSuggestion: null,
      fileExplorerOpen: localStorage.getItem('ccv_fileExplorerOpen') !== 'false',
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
    };
    this._processedToolIds = new Set();
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
    this._ptyDebounceTimer = null;
    this._currentPtyPrompt = null; // 同步跟踪 ptyPrompt，避免闭包捕获旧 state
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

    let needFileRefresh = false;
    let needGitRefresh = false;

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
  }

  componentDidMount() {
    this.startRender();
    if (this.props.cliMode) {
      this.connectInputWs();
    }
    this._bindStickyScroll();
    // 初始化时吸附到 60cols
    if (this.state.needsInitialSnap && this.props.cliMode && this.props.terminalVisible) {
      this._snapToInitialPosition();
    }
  }

  componentDidUpdate(prevProps) {
    if (prevProps.mainAgentSessions !== this.props.mainAgentSessions) {
      if (isMobile) this._mobileExtraItems = 0;
      this.startRender();
      if (this.state.pendingInput) {
        this.setState({ pendingInput: null });
      }
      this._updateSuggestion();
      this._checkToolFileChanges();
    } else if (prevProps.collapseToolResults !== this.props.collapseToolResults || prevProps.expandThinking !== this.props.expandThinking) {
      const rawItems = this.buildAllItems();
      const allItems = this._applyMobileSlice(rawItems);
      this.setState({ allItems, visibleCount: allItems.length });
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
        this.setState({ allItems, visibleCount: allItems.length }, () => this.scrollToBottom());
      } else {
        const rawItems = this.buildAllItems();
        const allItems = this._applyMobileSlice(rawItems);
        this.setState({ allItems, visibleCount: allItems.length }, () => this.scrollToBottom());
      }
    }
    // mobileChatVisible: scroll to bottom when becoming visible
    if (isMobile && this.props.mobileChatVisible && !prevProps.mobileChatVisible) {
      requestAnimationFrame(() => {
        const el = this.containerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
    // cliMode 异步生效后建立 WebSocket 连接
    if (!prevProps.cliMode && this.props.cliMode) {
      this.connectInputWs();
    }
    this._rebindStickyEl();
  }

  componentWillUnmount() {
    if (this._queueTimer) clearTimeout(this._queueTimer);
    if (this._fadeClearTimer) clearTimeout(this._fadeClearTimer);
    if (this._ptyDebounceTimer) clearTimeout(this._ptyDebounceTimer);
    if (this._fileRefreshTimer) clearTimeout(this._fileRefreshTimer);
    if (this._gitRefreshTimer) clearTimeout(this._gitRefreshTimer);
    this._unbindScrollFade();
    this._unbindStickyScroll();
    if (this._inputWs) {
      this._inputWs.close();
      this._inputWs = null;
    }
  }

  startRender() {
    if (this._queueTimer) clearTimeout(this._queueTimer);

    const rawItems = this.buildAllItems();
    const allItems = this._applyMobileSlice(rawItems);
    const prevLen = this._prevItemsLen;
    this._prevItemsLen = allItems.length;

    const newCount = allItems.length - prevLen;

    if (newCount <= 0 || (prevLen > 0 && newCount <= 3)) {
      this.setState({ allItems, visibleCount: allItems.length, loading: false }, () => this.scrollToBottom());
      return;
    }

    if (allItems.length > QUEUE_THRESHOLD) {
      this.setState({ allItems, visibleCount: 0, loading: true });
      this._queueTimer = setTimeout(() => {
        this.setState({ visibleCount: allItems.length, loading: false }, () => this.scrollToBottom());
      }, 300);
    } else {
      const startFrom = Math.max(0, prevLen);
      this.setState({ allItems, visibleCount: startFrom, loading: false });
      this.queueNext(startFrom, allItems.length);
    }
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
        if (this.state.stickyBottom && gap > 30) {
          this.setState({ stickyBottom: false });
        } else if (!this.state.stickyBottom && gap <= 5) {
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
      const el = this.containerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };

  handleLoadMore = () => {
    this._mobileExtraItems += MOBILE_LOAD_MORE_STEP;
    const el = this.containerRef.current;
    const prevScrollHeight = el ? el.scrollHeight : 0;
    const prevScrollTop = el ? el.scrollTop : 0;
    const rawItems = this.buildAllItems();
    const allItems = this._applyMobileSlice(rawItems);
    this.setState({ allItems, visibleCount: allItems.length }, () => {
      if (el) {
        const newScrollHeight = el.scrollHeight;
        el.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight);
      }
    });
  };

  _bindScrollFade() {
    this._unbindScrollFade();
    const container = this.containerRef.current;
    if (!container) return;
    this._scrollFadeIgnoreFirst = true;
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
    if (this._onScrollFade && this.containerRef.current) {
      this.containerRef.current.removeEventListener('scroll', this._onScrollFade);
      this._onScrollFade = null;
    }
  }

  renderSessionMessages(messages, keyPrefix, modelInfo, tsToIndex) {
    const { userProfile, collapseToolResults, expandThinking, onViewRequest } = this.props;
    const { toolUseMap, toolResultMap, readContentMap, editSnapshotMap, askAnswerMap, planApprovalMap } = buildToolResultMap(messages);

    const activePlanPrompt = this.props.cliMode
      ? this.state.ptyPromptHistory.slice().reverse().find(p => isPlanApprovalPrompt(p) && p.status === 'active') || null
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
      const viewReqProps = reqIdx != null && onViewRequest ? { requestIndex: reqIdx, onViewRequest } : {};

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
              const isPlan = /^Implement the following plan:/i.test((textBlocks[ti].text || '').trim());
              renderedMessages.push(
                <ChatMessage key={`${keyPrefix}-user-${mi}-${ti}`} role={isPlan ? 'plan-prompt' : 'user'} text={textBlocks[ti].text} timestamp={ts} userProfile={userProfile} modelInfo={modelInfo} {...viewReqProps} />
              );
            }
          }
        } else if (typeof content === 'string' && !isSystemText(content)) {
          const isPlan = /^Implement the following plan:/i.test(content.trim());
          renderedMessages.push(
            <ChatMessage key={`${keyPrefix}-user-${mi}`} role={isPlan ? 'plan-prompt' : 'user'} text={content} timestamp={ts} userProfile={userProfile} modelInfo={modelInfo} {...viewReqProps} />
          );
        }
      } else if (msg.role === 'assistant') {
        if (Array.isArray(content)) {
          renderedMessages.push(
            <ChatMessage key={`${keyPrefix}-asst-${mi}`} role="assistant" content={content} toolResultMap={toolResultMap} readContentMap={readContentMap} editSnapshotMap={editSnapshotMap} askAnswerMap={askAnswerMap} planApprovalMap={planApprovalMap} timestamp={ts} modelInfo={modelInfo} collapseToolResults={collapseToolResults} expandThinking={expandThinking} ptyPrompt={this.state.ptyPrompt} activePlanPrompt={activePlanPrompt} lastPendingPlanId={lastPendingPlanId} lastPendingAskId={lastPendingAskId} onPlanApprovalClick={this.handlePromptOptionClick} onPlanFeedbackSubmit={this.handlePlanFeedbackSubmit} onAskQuestionSubmit={this.handleAskQuestionSubmit} cliMode={this.props.cliMode} {...viewReqProps} />
          );
        } else if (typeof content === 'string') {
          renderedMessages.push(
            <ChatMessage key={`${keyPrefix}-asst-${mi}`} role="assistant" content={[{ type: 'text', text: content }]} toolResultMap={toolResultMap} readContentMap={readContentMap} editSnapshotMap={editSnapshotMap} askAnswerMap={askAnswerMap} planApprovalMap={planApprovalMap} timestamp={ts} modelInfo={modelInfo} collapseToolResults={collapseToolResults} expandThinking={expandThinking} ptyPrompt={this.state.ptyPrompt} activePlanPrompt={activePlanPrompt} lastPendingPlanId={lastPendingPlanId} lastPendingAskId={lastPendingAskId} onPlanApprovalClick={this.handlePromptOptionClick} onPlanFeedbackSubmit={this.handlePlanFeedbackSubmit} onAskQuestionSubmit={this.handleAskQuestionSubmit} cliMode={this.props.cliMode} {...viewReqProps} />
          );
        }
      }
    }

    return renderedMessages;
  }

  buildAllItems() {
    const { mainAgentSessions, requests, collapseToolResults, expandThinking, onViewRequest } = this.props;
    if (!mainAgentSessions || mainAgentSessions.length === 0) return [];

    // 构建 timestamp → filteredRequests index 映射
    const tsToIndex = {};
    if (requests) {
      for (let i = 0; i < requests.length; i++) {
        if (isMainAgent(requests[i]) && requests[i].timestamp) {
          tsToIndex[requests[i].timestamp] = i;
        }
      }
    }

    // 从最新的 mainAgent 请求中提取模型名
    let modelName = null;
    if (requests) {
      for (let i = requests.length - 1; i >= 0; i--) {
        if (isMainAgent(requests[i]) && requests[i].body?.model) {
          modelName = requests[i].body.model;
          break;
        }
      }
    }
    const modelInfo = getModelInfo(modelName);

    const allItems = [];
    // 记录每个 timestamp 对应的最后一个 item index，用于滚动定位
    const tsItemMap = {};

    // 收集 SubAgent entries（按 timestamp 排序）
    const subAgentEntries = [];
    if (requests) {
      for (let i = 0; i < requests.length; i++) {
        const req = requests[i];
        if (!req.timestamp) continue;
        const cls = classifyRequest(req, requests[i + 1]);
        if (cls.type === 'SubAgent') {
          const respContent = req.response?.body?.content;
          if (Array.isArray(respContent) && respContent.length > 0) {
            const subToolResultMap = buildToolResultMap(req.body?.messages || []).toolResultMap;
            subAgentEntries.push({
              timestamp: req.timestamp,
              content: respContent,
              toolResultMap: subToolResultMap,
              label: formatRequestTag(cls.type, cls.subType),
              requestIndex: i,
            });
          }
        }
      }
    }

    let subIdx = 0;

    mainAgentSessions.forEach((session, si) => {
      if (si > 0) {
        allItems.push(
          <Divider key={`session-div-${si}`} style={{ borderColor: '#333', margin: '16px 0' }}>
            <Text className={styles.sessionDividerText}>Session</Text>
          </Divider>
        );
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
            <ChatMessage key={`sub-chat-${subIdx}`} role="sub-agent-chat" content={sa.content} toolResultMap={sa.toolResultMap} label={sa.label} timestamp={sa.timestamp} collapseToolResults={collapseToolResults} expandThinking={expandThinking} requestIndex={sa.requestIndex} onViewRequest={onViewRequest} />
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
          <ChatMessage key={`sub-chat-${subIdx}`} role="sub-agent-chat" content={sa.content} toolResultMap={sa.toolResultMap} label={sa.label} timestamp={sa.timestamp} collapseToolResults={collapseToolResults} expandThinking={expandThinking} requestIndex={sa.requestIndex} onViewRequest={onViewRequest} />
        );
        subIdx++;
      }

      if (si === mainAgentSessions.length - 1 && session.response?.body?.content) {
        const respContent = session.response.body.content;
        if (Array.isArray(respContent)) {
          allItems.push(
            <React.Fragment key="resp-divider">
              <Divider style={{ borderColor: '#2a2a2a', margin: '8px 0' }}>
                <Text type="secondary" className={styles.lastResponseLabel}>{t('ui.lastResponse')}</Text>
              </Divider>
            </React.Fragment>
          );
          // 将 Last Response 关联到该 session 对应的 entry timestamp，用于原文-对话定位
          if (session.entryTimestamp) tsItemMap[session.entryTimestamp] = allItems.length;
          // 计算 Last Response 中最后一个 pending 的 AskUserQuestion id
          let respLastPendingAskId = null;
          for (const block of respContent) {
            if (block.type === 'tool_use' && block.name === 'AskUserQuestion') {
              respLastPendingAskId = block.id;
            }
          }
          allItems.push(
            <ChatMessage key="resp-asst" role="assistant" content={respContent} timestamp={session.entryTimestamp} modelInfo={modelInfo} collapseToolResults={collapseToolResults} expandThinking={expandThinking} toolResultMap={{}} askAnswerMap={{}} lastPendingAskId={respLastPendingAskId} cliMode={this.props.cliMode} onAskQuestionSubmit={this.handleAskQuestionSubmit} />
          );
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
        }
      } catch {}
    };
    this._inputWs.onclose = () => {
      setTimeout(() => {
        if (this.splitContainerRef.current && this.props.cliMode) {
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
    // Keep buffer at max 4KB
    if (this._ptyBuffer.length > 4096) {
      this._ptyBuffer = this._ptyBuffer.slice(-4096);
    }
    if (this._ptyDebounceTimer) clearTimeout(this._ptyDebounceTimer);
    this._ptyDebounceTimer = setTimeout(() => this._detectPrompt(), 200);
  }

  _detectPrompt() {
    const buf = this._ptyBuffer;
    // Match a question line ending with ? followed by numbered options
    const match = buf.match(/([^\n]*\?)\s*\n((?:\s*[❯>]?\s*\d+\.\s+[^\n]+\n?){2,})$/);
    if (match) {
      const question = match[1].trim();
      const optionsBlock = match[2];
      const optionLines = optionsBlock.match(/\s*([❯>])?\s*(\d+)\.\s+([^\n]+)/g);
      if (optionLines) {
        const options = optionLines.map(line => {
          const m = line.match(/\s*([❯>])?\s*(\d+)\.\s+(.+)/);
          return {
            number: parseInt(m[2], 10),
            text: m[3].trim(),
            selected: !!m[1],
          };
        });
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
            return { ptyPrompt: prompt, ptyPromptHistory: history };
          });
          this.scrollToBottom();
        }
        return;
      }
    }
    // No match — if there was an active prompt, mark it dismissed
    // But keep plan approval prompts and AskUserQuestion prompts active
    if (this.state.ptyPrompt) {
      if (isPlanApprovalPrompt(this.state.ptyPrompt)) {
        // Don't dismiss plan approval prompts — they stay active until explicitly answered
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
    const ws = this._inputWs;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const prompt = this.state.ptyPrompt;
    if (!prompt) return;

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
  };

  handlePlanFeedbackSubmit = (number, text) => {
    const ws = this._inputWs;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const prompt = this.state.ptyPrompt;
    if (!prompt) return;

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
   * AskUserQuestion 交互提交
   * answers: [{ questionIndex, type: 'single'|'multi'|'other', optionIndex, selectedIndices, text }]
   */
  handleAskQuestionSubmit = (answers) => {
    // Lazily connect WebSocket if not connected (e.g. mobile ChatView with cliMode=false)
    if (!this._inputWs || this._inputWs.readyState !== WebSocket.OPEN) {
      this._askAnswerQueue = [...answers];
      this._askSubmitting = true;
      this.connectInputWs();
      this._askWsRetries = 0;
      this._waitForWsAndSubmit();
      return;
    }

    this._askAnswerQueue = [...answers];
    this._askSubmitting = true;

    // ptyPrompt may not be available yet (streaming response renders before CLI prompt appears)
    // Retry with delay until ptyPrompt is detected
    if (!this._currentPtyPrompt) {
      this._askPromptRetries = 0;
      this._waitForPtyPromptAndSubmit();
      return;
    }

    this._processNextAskAnswer();
  };

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
    setTimeout(() => this._waitForWsAndSubmit(), 100);
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
    setTimeout(() => this._waitForPtyPromptAndSubmit(), 100);
  }

  _processNextAskAnswer() {
    if (!this._askAnswerQueue || this._askAnswerQueue.length === 0) {
      this._askSubmitting = false;
      return;
    }
    const answer = this._askAnswerQueue.shift();
    if (answer.type === 'other') {
      this._submitOtherAnswer(answer);
    } else if (answer.type === 'multi') {
      this._submitMultiSelectAnswer(answer);
    } else {
      this._submitSingleSelectAnswer(answer);
    }
  }

  _submitSingleSelectAnswer(answer) {
    const ws = this._inputWs;
    if (!ws || ws.readyState !== WebSocket.OPEN) { this._askSubmitting = false; return; }
    const prompt = this.state.ptyPrompt;

    // optionIndex is 0-based index into the CLI option list; option number = optionIndex + 1
    const targetNumber = answer.optionIndex + 1;
    let targetIdx, currentIdx;

    if (prompt && prompt.options) {
      const options = prompt.options;
      targetIdx = options.findIndex(o => o.number === targetNumber);
      if (targetIdx < 0) targetIdx = answer.optionIndex;
      currentIdx = options.findIndex(o => o.selected);
      if (currentIdx < 0) currentIdx = 0;
    } else {
      // No ptyPrompt available: assume first option is selected (CLI default)
      targetIdx = answer.optionIndex;
      currentIdx = 0;
    }

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
          this._finishCurrentAskAnswer();
        }, 50);
      }
    };
    sendStep(0);
  }

  _submitMultiSelectAnswer(answer) {
    const ws = this._inputWs;
    if (!ws || ws.readyState !== WebSocket.OPEN) { this._askSubmitting = false; return; }
    const prompt = this.state.ptyPrompt;

    // selectedIndices: 0-based indices into CLI option list
    const indices = (answer.selectedIndices || []).slice().sort((a, b) => a - b);
    let currentIdx = 0;
    if (prompt && prompt.options) {
      currentIdx = prompt.options.findIndex(o => o.selected);
      if (currentIdx < 0) currentIdx = 0;
    }

    // Navigate to each selected option and press Space to toggle
    const toggleNext = (si) => {
      if (si >= indices.length) {
        // All selections made, press Enter to confirm
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'input', data: '\r' }));
          }
          this._finishCurrentAskAnswer();
        }, 50);
        return;
      }
      const targetIdx = indices[si];
      const diff = targetIdx - currentIdx;
      const arrowKey = diff > 0 ? '\x1b[B' : '\x1b[A';
      const steps = Math.abs(diff);

      const moveAndToggle = (step) => {
        if (step < steps) {
          ws.send(JSON.stringify({ type: 'input', data: arrowKey }));
          setTimeout(() => moveAndToggle(step + 1), 30);
        } else {
          // Press Space to toggle
          setTimeout(() => {
            ws.send(JSON.stringify({ type: 'input', data: ' ' }));
            currentIdx = targetIdx;
            setTimeout(() => toggleNext(si + 1), 50);
          }, 50);
        }
      };
      moveAndToggle(0);
    };
    toggleNext(0);
  }

  _submitOtherAnswer(answer) {
    const ws = this._inputWs;
    if (!ws || ws.readyState !== WebSocket.OPEN) { this._askSubmitting = false; return; }
    const prompt = this.state.ptyPrompt;

    // "Other" is always the last option in the CLI list
    const targetIdx = answer.optionIndex; // optionIndex = options.length (0-based, "Other" is after all options)
    let currentIdx = 0;
    if (prompt && prompt.options) {
      currentIdx = prompt.options.findIndex(o => o.selected);
      if (currentIdx < 0) currentIdx = 0;
    }

    const diff = targetIdx - currentIdx;
    const arrowKey = diff > 0 ? '\x1b[B' : '\x1b[A';
    const steps = Math.abs(diff);

    const sendStep = (i) => {
      if (i < steps) {
        ws.send(JSON.stringify({ type: 'input', data: arrowKey }));
        setTimeout(() => sendStep(i + 1), 30);
      } else {
        // Press Enter to select "Other"
        setTimeout(() => {
          ws.send(JSON.stringify({ type: 'input', data: '\r' }));
          // Wait for CLI to enter text input mode, then type the text
          const startBuf = this._ptyBuffer;
          let attempts = 0;
          const poll = () => {
            attempts++;
            if (attempts > 20 || this._ptyBuffer !== startBuf) {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'input', data: answer.text }));
                setTimeout(() => {
                  ws.send(JSON.stringify({ type: 'input', data: '\r' }));
                  this._finishCurrentAskAnswer();
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
    this._ptyBuffer = '';
    if (this._ptyDebounceTimer) clearTimeout(this._ptyDebounceTimer);

    // Wait for next prompt to appear (multi-question scenario)
    if (this._askAnswerQueue && this._askAnswerQueue.length > 0) {
      let waitAttempts = 0;
      const waitForNext = () => {
        waitAttempts++;
        if (waitAttempts > 100) { // 10s timeout
          this._askSubmitting = false;
          this._askAnswerQueue = [];
          return;
        }
        if (this._currentPtyPrompt) {
          this._processNextAskAnswer();
          return;
        }
        setTimeout(waitForNext, 100);
      };
      setTimeout(waitForNext, 200);
    } else {
      this._askSubmitting = false;
    }
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
    if (e.key === 'Enter' && !e.shiftKey) {
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

  _snapToInitialPosition() {
    // 初始化时吸附到 60cols
    const charWidth = 7.8;
    const targetCols = 60;
    const terminalPx = targetCols * charWidth; // 468px

    this.setState({ terminalWidth: terminalPx, needsInitialSnap: false });
    localStorage.setItem('cc-viewer-terminal-width', terminalPx.toString());
  }

  render() {
    const { mainAgentSessions, cliMode, terminalVisible } = this.props;
    const { allItems, visibleCount, loading, terminalWidth } = this.state;

    const noData = !mainAgentSessions || mainAgentSessions.length === 0;

    if (noData && !cliMode) {
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

    const targetIdx = this._scrollTargetIdx;
    const { highlightTs, highlightFading } = this.state;
    const highlightIdx = highlightTs && this._tsItemMap && this._tsItemMap[highlightTs] != null
      ? this._tsItemMap[highlightTs] : null;
    const visible = allItems.slice(0, visibleCount);

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

    const promptBubbles = cliMode && ptyPromptHistory.length > 0 ? ptyPromptHistory.filter(p => !(isPlanApprovalPrompt(p) && p.status === 'active')).map((p, i) => {
      const isActive = p.status === 'active';
      const isAnswered = p.status === 'answered';
      return (
        <div key={`pty-prompt-${i}`} className={`${styles.ptyPromptBubble}${isActive ? '' : ' ' + styles.ptyPromptResolved}`}>
          <div className={styles.ptyPromptQuestion}>{p.question}</div>
          <div className={styles.ptyPromptOptions}>
            {p.options.map(opt => {
              const chosen = isAnswered && p.selectedNumber === opt.number;
              let cls = styles.ptyPromptOption;
              if (isActive && opt.selected) cls = styles.ptyPromptOptionPrimary;
              if (chosen) cls = styles.ptyPromptOptionChosen;
              if (!isActive && !chosen) cls = styles.ptyPromptOptionDimmed;
              return (
                <button
                  key={opt.number}
                  className={cls}
                  disabled={!isActive}
                  onClick={isActive ? () => this.handlePromptOptionClick(opt.number) : undefined}
                >
                  {opt.number}. {opt.text}
                </button>
              );
            })}
          </div>
        </div>
      );
    }) : null;

    const loadMoreBtn = isMobile && this._mobileSliceOffset > 0 ? (
      <div className={styles.loadMoreWrap}>
        <button className={styles.loadMoreBtn} onClick={this.handleLoadMore}>
          {t('ui.loadMoreHistory', { count: this._mobileSliceOffset })}
        </button>
      </div>
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
          {promptBubbles}
        </div>
        {stickyBtn}
      </div>
    ) : (
      <div className={styles.messageListWrap}>
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
          {pendingBubble}
          {promptBubbles}
        </div>
        {stickyBtn}
      </div>
    );

    if (!cliMode) {
      return messageList;
    }

    return (
      <div ref={this.splitContainerRef} className={styles.splitContainer}>
        <div className={styles.navSidebar}>
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
        </div>
        <div style={{ flex: 1, display: 'flex', minWidth: 0, position: 'relative' }} ref={this.innerSplitRef}>
          {/* 吸附预览框 */}
          {this.state.isDragging && this.state.activeSnapLine && (() => {
            const container = this.innerSplitRef.current;
            if (!container) return null;
            const containerWidth = container.getBoundingClientRect().width;
            const resizerWidth = 5;
            // 当前终端区域左边缘位置
            const currentLeft = containerWidth - this.state.terminalWidth - resizerWidth;
            // 吸附目标左边缘位置
            const snapLeft = this.state.activeSnapLine.linePosition;
            const left = Math.min(currentLeft, snapLeft);
            const width = Math.abs(snapLeft - currentLeft);
            return (
              <div
                className={styles.snapPreview}
                style={{
                  left: `${left}px`,
                  width: `${width}px`
                }}
              />
            );
          })()}
          {/* 吸附线：只显示距离当前位置最近的一条 */}
          {this.state.isDragging && (() => {
            const container = this.innerSplitRef.current;
            if (!container) return null;
            const containerWidth = container.getBoundingClientRect().width;
            const resizerWidth = 5;
            const currentLinePos = containerWidth - this.state.terminalWidth - resizerWidth;
            // 按距离排序，取最近的一条
            const sorted = [...this.state.snapLines]
              .map(snap => ({ ...snap, dist: Math.abs(snap.linePosition - currentLinePos) }))
              .sort((a, b) => a.dist - b.dist);
            if (sorted.length === 0) return null;
            const snap = sorted[0];
            const isActive = this.state.activeSnapLine && this.state.activeSnapLine.cols === snap.cols;
            return (
              <div
                key={snap.cols}
                className={isActive ? styles.snapLineActive : styles.snapLine}
                style={{ left: `${snap.linePosition}px` }}
              />
            );
          })()}
          {this.state.fileExplorerOpen && (
            <FileExplorer
              refreshTrigger={this.state.fileExplorerRefresh}
              onClose={() => this._setFileExplorerOpen(false)}
              onFileClick={(path) => this.setState({ currentFile: path, currentGitDiff: null, scrollToLine: null })}
              expandedPaths={this.state.fileExplorerExpandedPaths}
              onToggleExpand={this.handleToggleExpandPath}
              currentFile={this.state.currentFile}
            />
          )}
          {this.state.gitChangesOpen && (
            <GitChanges
              refreshTrigger={this.state.gitChangesRefresh}
              onClose={() => this.setState({ gitChangesOpen: false })}
              onFileClick={(path) => this.setState({ currentGitDiff: path, currentFile: null })}
            />
          )}
          <div className={styles.chatSection} style={{ flex: 1, minWidth: 0, display: 'flex' }}>
            <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
            {this.state.currentGitDiff && (
              <div style={{ position: 'absolute', inset: 0, zIndex: 1, display: 'flex', flexDirection: 'column' }}>
                <GitDiffView
                  filePath={this.state.currentGitDiff}
                  onClose={() => this.setState({ currentGitDiff: null })}
                  onOpenFile={(path, line) => { this._setFileExplorerOpen(true); this.setState({
                    currentGitDiff: null,
                    currentFile: path,
                    scrollToLine: line || 1,
                    gitChangesOpen: false,
                  }); }}
                />
              </div>
            )}
            {this.state.currentFile && (
              <div style={{ position: 'absolute', inset: 0, zIndex: 1, display: 'flex', flexDirection: 'column' }}>
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
            {!terminalVisible && (
              <div className={styles.chatInputBar}>
                <div className={styles.chatInputWrapper}>
                  <div className={styles.chatTextareaWrap}>
                    <textarea
                      ref={this._inputRef}
                      className={styles.chatTextarea}
                      placeholder={this.state.inputSuggestion ? '' : t('ui.chatInput.placeholder')}
                      rows={1}
                      onKeyDown={this.handleInputKeyDown}
                      onInput={this.handleInputChange}
                    />
                    {this.state.inputSuggestion && this.state.inputEmpty && (
                      <div className={styles.ghostText}>{this.state.inputSuggestion}</div>
                    )}
                  </div>
                  <div className={styles.chatInputHint}>
                    {this.state.inputSuggestion && this.state.inputEmpty
                      ? t('ui.chatInput.hintTab')
                      : t('ui.chatInput.hintEnter')}
                  </div>
                </div>
                {!isMobile && (
                  <button
                    className={styles.chatSendBtn}
                    onClick={() => {
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.onchange = async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          const path = await uploadFileAndGetPath(file);
                          const quoted = `"${path}"`;
                          const textarea = this._inputRef.current;
                          if (textarea) {
                            textarea.value = (textarea.value ? textarea.value + ' ' : '') + quoted;
                            textarea.dispatchEvent(new Event('input', { bubbles: true }));
                            this.setState({ inputEmpty: false });
                          }
                        } catch (err) {
                          console.error('[CC Viewer] Upload failed:', err);
                        }
                      };
                      input.click();
                    }}
                    title={t('ui.terminal.upload')}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                  </button>
                )}
                <button
                  className={styles.chatSendBtn}
                  onClick={this.handleInputSend}
                  disabled={this.state.inputEmpty}
                  title={t('ui.chatInput.send')}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              </div>
            )}
            {terminalVisible && this.state.inputSuggestion && (
              <div className={styles.suggestionChip} onClick={this.handleSuggestionToTerminal}>
                <span className={styles.suggestionChipText}>{this.state.inputSuggestion}</span>
                <span className={styles.suggestionChipAction}>↵</span>
              </div>
            )}
            </div>
          </div>
          {terminalVisible && (
            <>
              <div className={styles.vResizer} onMouseDown={this.handleSplitMouseDown} />
              <div style={{ width: terminalWidth, flexShrink: 0, minWidth: 200, display: 'flex', flexDirection: 'column' }}>
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
    );
  }
}

export default ChatView;
