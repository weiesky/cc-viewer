import React from 'react';
import { Empty, Typography, Divider, Spin, Popover, Modal, Tooltip } from 'antd';
import ChatMessage from './ChatMessage';
import TerminalPanel, { uploadFileAndGetPath } from './TerminalPanel';
import FileExplorer from './FileExplorer';
import FileContentView from './FileContentView';
import ImageViewer from './ImageViewer';
import GitChanges from './GitChanges';
import GitDiffView from './GitDiffView';
import { extractToolResultText, getModelInfo, getSvgAvatar } from '../utils/helpers';
import { getTeammateAvatar } from '../utils/teammateAvatars';
import { renderMarkdown } from '../utils/markdown';
import defaultModelAvatarUrl from '../img/default-model-avatar.svg';
import { isSystemText, classifyUserContent, isMainAgent, isTeammate } from '../utils/contentFilter';
import { classifyRequest, formatRequestTag, formatTeammateLabel } from '../utils/requestType';
import { buildChunksForAnswer } from '../utils/ptyChunkBuilder';
import { isMobile } from '../env';
import { t } from '../i18n';
import { apiUrl } from '../utils/apiUrl';
import styles from './ChatView.module.css';

const { Text } = Typography;

const QUEUE_THRESHOLD = 20;



const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp']);
function isImageFile(path) {
  const ext = (path || '').split('.').pop().toLowerCase();
  return IMAGE_EXTS.has(ext);
}

// 从 requests 中提取 Team 会话列表
function extractTeamSessions(requests) {
  const teams = [];
  let currentTeamIdx = -1; // 当前唯一打开的 team 在 teams[] 中的 index

  // 查找 tool_use 对应的 tool_result（在后续 request 的 messages 中）
  // 搜索窗口扩大到 10 以应对空行/非主agent请求插入导致的距离增大
  function findToolResult(toolUseId, fromRequestIdx) {
    for (let j = fromRequestIdx + 1; j < requests.length && j <= fromRequestIdx + 10; j++) {
      const msgs = requests[j]?.body?.messages;
      if (!Array.isArray(msgs)) continue;
      for (const msg of msgs) {
        const blocks = msg.role === 'user' && Array.isArray(msg.content) ? msg.content : [];
        for (const b of blocks) {
          if (b.type === 'tool_result' && b.tool_use_id === toolUseId) {
            return typeof b.content === 'string' ? b.content : JSON.stringify(b.content || '');
          }
        }
      }
    }
    return null;
  }

  function isDeleteSuccessful(resultText) {
    if (!resultText) return false;
    if (resultText.includes('"success":true') || resultText.includes('"success": true')) return true;
    if (resultText.includes('Cleaned up')) return true;
    if (resultText.includes('Cannot cleanup')) return false;
    // 没有明确失败标记的默认视为成功
    return true;
  }

  for (let i = 0; i < requests.length; i++) {
    const req = requests[i];
    const respContent = req.response?.body?.content;
    if (!Array.isArray(respContent)) continue;
    for (const block of respContent) {
      if (block.type !== 'tool_use') continue;
      const name = block.name;
      const input = typeof block.input === 'string' ? (() => { try { return JSON.parse(block.input); } catch { return {}; } })() : (block.input || {});
      if (name === 'TeamCreate') {
        // 检查 TeamCreate 是否成功（tool_result 中不能有错误标记）
        const createResult = findToolResult(block.id, i);
        if (createResult && (createResult.includes('"error":') || createResult.includes('"error" :') || createResult.includes('Already leading team'))) continue;
        const teamName = input.team_name || input.teamName || 'unknown';
        const ts = req.timestamp || req.response?.timestamp;
        // 新 TeamCreate 出现时，自动关闭前一个未关闭的 team（避免孤立）
        if (currentTeamIdx >= 0 && !teams[currentTeamIdx].endTime) {
          teams[currentTeamIdx].endTime = ts;
          teams[currentTeamIdx].endRequestIndex = Math.max(teams[currentTeamIdx].requestIndex, i - 1);
          teams[currentTeamIdx]._inferredEnd = true;
        }
        const team = { name: teamName, startTime: ts, endTime: null, requestIndex: i, endRequestIndex: null, taskCount: 0, teammateCount: 0, _teammates: new Set() };
        teams.push(team);
        currentTeamIdx = teams.length - 1;
      } else if (name === 'TeamDelete') {
        const resultText = findToolResult(block.id, i);
        if (!isDeleteSuccessful(resultText)) continue; // 失败的 TeamDelete 不关闭 team
        const ts = req.timestamp || req.response?.timestamp;
        if (currentTeamIdx < 0) {
          // Cross-file: TeamCreate 在上一个 JSONL 中，从 tool_result 反向推断 team
          let teamName = 'unknown';
          try { const parsed = JSON.parse(resultText); teamName = parsed.team_name || teamName; } catch {}
          // 回溯寻找最早的关联 Agent 调用作为 startTime
          let startIdx = 0;
          let startTs = requests[0]?.timestamp || requests[0]?.response?.timestamp;
          for (let k = 0; k < i; k++) {
            const kResp = requests[k]?.response?.body?.content;
            if (!Array.isArray(kResp)) continue;
            for (const kb of kResp) {
              if (kb.type === 'tool_use' && kb.name === 'Agent') {
                const kInp = typeof kb.input === 'string' ? (() => { try { return JSON.parse(kb.input); } catch { return {}; } })() : (kb.input || {});
                if ((kInp.team_name || kInp.teamName) === teamName) {
                  startIdx = k;
                  startTs = requests[k]?.timestamp || requests[k]?.response?.timestamp;
                  break;
                }
              }
            }
            if (startIdx > 0) break;
          }
          const team = { name: teamName, startTime: startTs, endTime: ts, requestIndex: startIdx, endRequestIndex: i, taskCount: 0, teammateCount: 0, _teammates: new Set(), _inferredStart: true };
          // 回填 teammate 和 task 计数
          for (let k = startIdx; k < i; k++) {
            const kResp = requests[k]?.response?.body?.content;
            if (!Array.isArray(kResp)) continue;
            for (const kb of kResp) {
              if (kb.type !== 'tool_use') continue;
              if (kb.name === 'Agent') {
                const kInp = typeof kb.input === 'string' ? (() => { try { return JSON.parse(kb.input); } catch { return {}; } })() : (kb.input || {});
                const an = kInp.name || '';
                if (!team._teammates.has(an)) { team._teammates.add(an); team.teammateCount++; }
              } else if (kb.name === 'TaskCreate' || kb.name === 'TaskUpdate') {
                team.taskCount++;
              }
            }
          }
          teams.push(team);
          continue;
        }
        teams[currentTeamIdx].endTime = ts;
        teams[currentTeamIdx].endRequestIndex = i;
        currentTeamIdx = -1; // 清理：team 已关闭
      } else if (name === 'SendMessage') {
        // 跟踪 shutdown_request 作为备用结束信号
        if (currentTeamIdx >= 0 && input.message?.type === 'shutdown_request') {
          const shutdownTs = req.timestamp || req.response?.timestamp;
          teams[currentTeamIdx]._lastShutdownTime = shutdownTs;
          teams[currentTeamIdx]._lastShutdownRequestIdx = i;
        }
      } else if (name === 'TaskCreate' || name === 'TaskUpdate') {
        if (currentTeamIdx >= 0) teams[currentTeamIdx].taskCount++;
      } else if (name === 'Agent') {
        const teamName = input.team_name || input.teamName;
        const agentName = input.name || '';
        let targetIdx = -1;
        if (teamName) {
          // 按 team_name 精确匹配（使用反向搜索，优先匹配最近的同名 team）
          for (let ti = teams.length - 1; ti >= 0; ti--) {
            if (teams[ti].name === teamName && !teams[ti].endTime) { targetIdx = ti; break; }
          }
        }
        // fallback：如果没有 team_name 但有唯一打开的 team
        if (targetIdx < 0 && currentTeamIdx >= 0) targetIdx = currentTeamIdx;
        if (targetIdx >= 0) {
          const t = teams[targetIdx];
          if (!t._teammates.has(agentName)) { t._teammates.add(agentName); t.teammateCount++; }
        }
      }
    }
  }
  // 后处理：为未关闭的 team 推断 endTime
  for (const team of teams) {
    if (team.endTime) continue;
    // 优先使用 shutdown_request 时间戳，其次使用最后一条请求的时间戳
    if (team._lastShutdownTime) {
      team.endTime = team._lastShutdownTime;
      team.endRequestIndex = team._lastShutdownRequestIdx;
      team._inferredEnd = true;
    } else {
      const lastReq = requests[requests.length - 1];
      const lastTs = lastReq?.response?.timestamp || lastReq?.timestamp;
      if (lastTs && team.startTime !== lastTs) {
        team.endTime = lastTs;
        team.endRequestIndex = requests.length - 1;
        team._inferredEnd = true;
      }
    }
  }
  return teams;
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

// --- 单 pass 增量 tool result 构建 ---

const _toolResultCache = new WeakMap();

function createEmptyToolState() {
  return {
    toolUseMap: {},
    toolResultMap: {},
    readContentMap: {},
    editSnapshotMap: {},
    askAnswerMap: {},
    planApprovalMap: {},
    _fileState: {},
  };
}

function appendToolResultMap(state, messages, startIndex) {
  const { toolUseMap, toolResultMap, readContentMap, editSnapshotMap, askAnswerMap, planApprovalMap, _fileState } = state;
  for (let i = startIndex; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool_use') {
          let parsed = block;
          if (typeof block.input === 'string') {
            try {
              const cleaned = block.input.replace(/^\[object Object\]/, '');
              parsed = { ...block, input: JSON.parse(cleaned) };
            } catch {}
          }
          toolUseMap[parsed.id] = parsed;
          // Edit → editSnapshotMap + _fileState 更新
          if (parsed.name === 'Edit' && parsed.input) {
            const fp = parsed.input.file_path;
            const oldStr = parsed.input.old_string;
            const newStr = parsed.input.new_string;
            if (fp && oldStr != null && newStr != null && _fileState[fp]) {
              const entry = _fileState[fp];
              editSnapshotMap[parsed.id] = { plainText: entry.plainText, lineNums: entry.lineNums.slice() };
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
                  for (let j = 0; j < newLineCount; j++) {
                    newNums.push(startNum + j);
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
    } else if (msg.role === 'user' && Array.isArray(msg.content)) {
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
          toolResultMap[block.tool_use_id] = { label, toolName, toolInput, resultText };
          if (matchedTool && matchedTool.name === 'Read' && matchedTool.input?.file_path) {
            readContentMap[matchedTool.input.file_path] = resultText;
            // _fileState 更新（行号解析）
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
                const mergedMap = new Map();
                const existingLines = existing.plainText.split('\n');
                for (let j = 0; j < existing.lineNums.length; j++) {
                  mergedMap.set(existing.lineNums[j], existingLines[j]);
                }
                for (let j = 0; j < lineNums.length; j++) {
                  mergedMap.set(lineNums[j], plainLines[j]);
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
          if (matchedTool && matchedTool.name === 'AskUserQuestion') {
            askAnswerMap[block.tool_use_id] = parseAskAnswerText(resultText);
          }
          if (matchedTool && matchedTool.name === 'ExitPlanMode') {
            planApprovalMap[block.tool_use_id] = parsePlanApproval(resultText);
          }
        }
      }
    }
  }
}

function buildToolResultMap(messages) {
  const state = createEmptyToolState();
  appendToolResultMap(state, messages, 0);
  return state;
}

function cachedBuildToolResultMap(messages) {
  let cached = _toolResultCache.get(messages);
  if (!cached) {
    cached = buildToolResultMap(messages);
    _toolResultCache.set(messages, cached);
  }
  return cached;
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

/** 从 ExitPlanMode tool_result 文本中解析审批状态和计划内容 */
function parsePlanApproval(text) {
  if (!text) return { status: 'pending' };
  if (/User has approved/i.test(text)) {
    // 提取 "## Approved Plan:" 之后的计划内容
    const planMatch = text.match(/##\s*Approved Plan:\s*\n([\s\S]*)/i);
    return { status: 'approved', planContent: planMatch ? planMatch[1].trim() : '' };
  }
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
      roleFilterOpen: false,
      roleFilterHidden: new Set(),
      teamModalSession: null,
      teamGanttOpen: true,
      activeAgentCard: null,
    };
    this._processedToolIds = new Set();
    this._teamModalBodyRef = React.createRef();
    this._ganttIndicatorRef = React.createRef();
    this._ganttWrapRef = React.createRef();
    this._teamTotalStart = 0;
    this._teamTotalEnd = 0;
    this._teamScrollRaf = null;
    this._teamModalDataCache = null;
    this._ganttTrackEl = null; // 缓存 querySelector 结果
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
      nextState !== this.state
    );
  }

  componentDidUpdate(prevProps) {
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
    this._unmounted = true;
    if (this._queueTimer) clearTimeout(this._queueTimer);
    if (this._fadeClearTimer) clearTimeout(this._fadeClearTimer);
    if (this._ptyDebounceTimer) clearTimeout(this._ptyDebounceTimer);
    if (this._fileRefreshTimer) clearTimeout(this._fileRefreshTimer);
    if (this._gitRefreshTimer) clearTimeout(this._gitRefreshTimer);
    if (this._wsReconnectTimer) clearTimeout(this._wsReconnectTimer);
    if (this._waitForWsTimer) clearTimeout(this._waitForWsTimer);
    if (this._waitForPtyTimer) clearTimeout(this._waitForPtyTimer);
    if (this._planFeedbackTimer) clearTimeout(this._planFeedbackTimer);
    if (this._teamScrollRaf) cancelAnimationFrame(this._teamScrollRaf);
    this._ganttTrackEl = null;
    this._teamModalDataCache = null;
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
    this.setState({ allItems, lastResponseItems: this._lastResponseItems, visibleCount: allItems.length }, () => {
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
    const { userProfile, collapseToolResults, expandThinking, showThinkingSummaries, onViewRequest } = this.props;
    // 增量 / WeakMap 缓存
    let cached = _toolResultCache.get(messages);
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
      _toolResultCache.set(messages, cached);
    }
    const { toolUseMap, toolResultMap, readContentMap, editSnapshotMap, askAnswerMap, planApprovalMap } = cached;

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
            <ChatMessage key={`${keyPrefix}-asst-${mi}`} role="assistant" content={content} toolResultMap={toolResultMap} readContentMap={readContentMap} editSnapshotMap={editSnapshotMap} askAnswerMap={askAnswerMap} planApprovalMap={planApprovalMap} timestamp={ts} modelInfo={modelInfo} collapseToolResults={collapseToolResults} expandThinking={expandThinking} showThinkingSummaries={showThinkingSummaries} ptyPrompt={this.state.ptyPrompt} activePlanPrompt={activePlanPrompt} lastPendingPlanId={lastPendingPlanId} lastPendingAskId={lastPendingAskId} onPlanApprovalClick={this.handlePromptOptionClick} onPlanFeedbackSubmit={this.handlePlanFeedbackSubmit} onAskQuestionSubmit={this.handleAskQuestionSubmit} cliMode={this.props.cliMode} onOpenFile={this.handleOpenToolFilePath} {...viewReqProps} />
          );
        } else if (typeof content === 'string') {
          renderedMessages.push(
            <ChatMessage key={`${keyPrefix}-asst-${mi}`} role="assistant" content={[{ type: 'text', text: content }]} toolResultMap={toolResultMap} readContentMap={readContentMap} editSnapshotMap={editSnapshotMap} askAnswerMap={askAnswerMap} planApprovalMap={planApprovalMap} timestamp={ts} modelInfo={modelInfo} collapseToolResults={collapseToolResults} expandThinking={expandThinking} showThinkingSummaries={showThinkingSummaries} ptyPrompt={this.state.ptyPrompt} activePlanPrompt={activePlanPrompt} lastPendingPlanId={lastPendingPlanId} lastPendingAskId={lastPendingAskId} onPlanApprovalClick={this.handlePromptOptionClick} onPlanFeedbackSubmit={this.handlePlanFeedbackSubmit} onAskQuestionSubmit={this.handleAskQuestionSubmit} cliMode={this.props.cliMode} onOpenFile={this.handleOpenToolFilePath} {...viewReqProps} />
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
        <Divider key={`tm-div-${si}`} style={{ borderColor: '#333', margin: '16px 0' }}>
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
            <ChatMessage key={`sub-${sa.timestamp}`} role="sub-agent-chat" content={sa.content} toolResultMap={sa.toolResultMap} label={sa.label} isTeammate={sa.isTeammate} timestamp={sa.timestamp} collapseToolResults={collapseToolResults} expandThinking={expandThinking} requestIndex={sa.requestIndex} onViewRequest={onViewRequest} onOpenFile={this.handleOpenToolFilePath} />
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
          <ChatMessage key={`sub-${sa.timestamp}`} role="sub-agent-chat" content={sa.content} toolResultMap={sa.toolResultMap} label={sa.label} isTeammate={sa.isTeammate} timestamp={sa.timestamp} collapseToolResults={collapseToolResults} expandThinking={expandThinking} requestIndex={sa.requestIndex} onViewRequest={onViewRequest} onOpenFile={this.handleOpenToolFilePath} />
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
            for (const block of respContent) {
              if (block.type === 'tool_use' && block.name === 'AskUserQuestion') {
                respLastPendingAskId = block.id;
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
            this._lastResponseItems = (
              <React.Fragment key="last-response-group">
                <Divider style={{ borderColor: '#2a2a2a', margin: '8px 0' }}>
                  <Text type="secondary" className={styles.lastResponseLabel}>{t('ui.lastResponse')}</Text>
                </Divider>
                <ChatMessage key="resp-asst" role="assistant" content={respContent} timestamp={session.entryTimestamp} modelInfo={modelInfo} collapseToolResults={collapseToolResults} expandThinking={expandThinking} toolResultMap={{}} askAnswerMap={{}} lastPendingAskId={respLastPendingAskId} cliMode={this.props.cliMode} onAskQuestionSubmit={this.handleAskQuestionSubmit} onOpenFile={this.handleOpenToolFilePath} />
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
            // Cap history to prevent unbounded growth
            if (history.length > 200) history.splice(0, history.length - 200);
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
  handleAskQuestionSubmit = (answers) => {
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

  // 点击工具调用中的文件路径，打开文件查看器
  // 绝对路径需要转为项目相对路径，以便与 FileExplorer 的 TreeNode 匹配
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

  _getTeamSessions() {
    const requests = this.props.requests;
    if (this._teamSessionsCache && this._teamSessionsCache.requests === requests) {
      return this._teamSessionsCache.result;
    }
    const result = extractTeamSessions(requests);
    this._teamSessionsCache = { requests, result };
    return result;
  }

  renderTeamButton() {
    const teamSessions = this._getTeamSessions();
    if (teamSessions.length === 0) return null;
    const content = (
      <div className={styles.teamPopover}>
        <div className={styles.teamPopoverTitle}>{t('ui.teamSessions')} ({teamSessions.length})</div>
        {teamSessions.map((team, i) => {
          const time = team.startTime ? new Date(team.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
          const status = team.endTime ? (team._inferredEnd ? '⏱' : '✓') : '●';
          const statusColor = team.endTime ? (team._inferredEnd ? '#888' : '#52c41a') : '#faad14';
          return (
            <div key={i} className={styles.teamPopoverItem} onClick={() => this.setState({ teamModalSession: team })}>
              <span className={styles.teamPopoverStatus} style={{ color: statusColor }}>{status}</span>
              <span className={styles.teamPopoverName}>{team.name}</span>
              <span className={styles.teamPopoverMeta}>{team.teammateCount}p · {team.taskCount}t</span>
              <span className={styles.teamPopoverTime}>{time}</span>
            </div>
          );
        })}
      </div>
    );
    const hasActiveTeam = teamSessions.some(s => !s.endTime || s._inferredEnd);
    return (
      <Popover content={content} trigger="hover" placement="rightTop" overlayInnerStyle={{ background: '#1e1e1e', border: '1px solid #333', padding: 0 }}>
        <button className={`${styles.navBtn} ${styles.teamBtnRelative}`} title={t('ui.teamSessions')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          {hasActiveTeam && <span className={styles.teamActiveSpinner} />}
        </button>
      </Popover>
    );
  }

  onTeamModalScroll = () => {
    if (this._teamScrollRaf) return;
    this._teamScrollRaf = requestAnimationFrame(() => {
      this._teamScrollRaf = null;
      const container = this._teamModalBodyRef.current;
      if (!container) return;
      const containerTop = container.getBoundingClientRect().top;
      let closestTs = null;
      for (const child of container.children) {
        const ts = child.getAttribute('data-timestamp');
        if (!ts) continue;
        const rect = child.getBoundingClientRect();
        if (rect.bottom > containerTop) { closestTs = ts; break; }
      }
      if (!closestTs) return;
      const tsMs = new Date(closestTs).getTime();
      const total = this._teamTotalEnd - this._teamTotalStart || 1;
      const pctVal = Math.max(0, Math.min(100, (tsMs - this._teamTotalStart) / total * 100));
      const el = this._ganttIndicatorRef.current;
      if (!el) return;
      // 缓存 track 元素引用，避免每帧 querySelector
      if (!this._ganttTrackEl || !this._ganttTrackEl.isConnected) {
        this._ganttTrackEl = el.parentElement?.querySelector('[class*="teamGanttTrack"]');
      }
      const wrap = el.parentElement;
      const track = this._ganttTrackEl;
      if (track) {
        const wrapRect = wrap.getBoundingClientRect();
        const trackRect = track.getBoundingClientRect();
        const trackLeft = trackRect.left - wrapRect.left;
        const trackWidth = trackRect.width;
        el.style.left = (trackLeft + trackWidth * pctVal / 100) + 'px';
        // indicator 高度跟随滚动内容总高度，而非可视区域高度，
        // 确保 agent 行数多（overflow-y: auto 滚动）时竖线贯穿所有行。
        el.style.height = wrap.scrollHeight + 'px';
      }
    });
  };

  renderTeamGantt(teamAgents, teamTotalStart, teamTotalEnd, leadSegments) {
    if (!teamAgents || teamAgents.length === 0) return null;
    const totalMs = teamTotalEnd - teamTotalStart || 1;
    const pct = (ms) => ((ms - teamTotalStart) / totalMs * 100).toFixed(2);
    const widthPct = (start, end) => (((end - start) / totalMs) * 100).toFixed(2);
    // 时间轴标记（均分 5 个刻度）
    const ticks = [];
    for (let t = 0; t <= 4; t++) {
      const ms = teamTotalStart + (totalMs * t / 4);
      const d = new Date(ms);
      ticks.push({ pct: (t * 25), label: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) });
    }
    return (
      <div>
        <div
          className={styles.teamGanttToggle}
          onClick={() => this.setState(prev => ({ teamGanttOpen: !prev.teamGanttOpen }))}
        >
          {this.state.teamGanttOpen ? '▼' : '▶'} Timeline
          {this.state.teamGanttOpen && (
            <span
              className={styles.ganttExportBtn}
              title={t('ui.exportTimelinePng') || 'Export as PNG'}
              onClick={(e) => {
                e.stopPropagation();
                const wrap = this._ganttWrapRef.current;
                if (!wrap) return;
                // 临时展开到全高，截图后恢复
                const prevMaxH = wrap.style.maxHeight;
                const prevH = wrap.style.height;
                const prevOverflow = wrap.style.overflow;
                wrap.style.maxHeight = 'none';
                wrap.style.height = 'auto';
                wrap.style.overflow = 'visible';
                import('html2canvas').then(({ default: html2canvas }) => {
                  html2canvas(wrap, { backgroundColor: '#0a0a0a', scale: 2, useCORS: true }).then(canvas => {
                    wrap.style.maxHeight = prevMaxH;
                    wrap.style.height = prevH;
                    wrap.style.overflow = prevOverflow;
                    const link = document.createElement('a');
                    link.download = `team-timeline-${Date.now()}.png`;
                    link.href = canvas.toDataURL('image/png');
                    link.click();
                  }).catch(() => {
                    wrap.style.maxHeight = prevMaxH;
                    wrap.style.height = prevH;
                    wrap.style.overflow = prevOverflow;
                  });
                }).catch(() => {
                  wrap.style.maxHeight = prevMaxH;
                  wrap.style.height = prevH;
                  wrap.style.overflow = prevOverflow;
                });
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </span>
          )}
        </div>
        {this.state.teamGanttOpen && (<>
          <div ref={this._ganttWrapRef} className={styles.teamGanttWrap} style={this.state._ganttHeight ? { maxHeight: 'none', height: this.state._ganttHeight } : undefined}>
            {/* team-lead 行：分段显示活动 */}
            <div className={styles.teamGanttRow}>
              <div className={`${styles.teamGanttLabel} ${styles.ganttLabelLead}`}>team-lead</div>
              <div className={styles.teamGanttTrack}>
                {leadSegments && leadSegments.map((seg, i) => {
                  const bgColor = seg.label === 'thinking' ? '#722ed1' : seg.label === 'report-received' ? '#52c41a' : '#196ae1';
                  const op = seg.label === 'idle' ? 0.15 : seg.label === 'text' ? 0.5 : seg.label === 'thinking' ? 0.4 : seg.label === 'report-received' ? 0.6 : 0.7;
                  return <div key={`b${i}`} className={styles.teamGanttBar} title={seg.label} style={{
                    left: pct(seg.start) + '%', width: widthPct(seg.start, seg.end) + '%',
                    background: bgColor, opacity: op,
                  }} />;
                })}
                {leadSegments && leadSegments.filter(s => s.label !== 'idle').map((seg, i) => {
                  const tips = { create: 'Team Created', tasks: 'Tasks Created', spawn: 'Agents Spawned', msg: 'SendMessage', cleanup: 'Team Cleanup', text: 'Status Update', thinking: 'Thinking...', 'report-received': 'Report Received' };
                  const dColor = seg.label === 'thinking' ? '#722ed1' : seg.label === 'report-received' ? '#52c41a' : '#196ae1';
                  return <Tooltip key={`d${i}`} title={tips[seg.label] || seg.label}><span className={styles.teamGanttDiamond} style={{ left: pct(seg.start) + '%', color: dColor }}>◆</span></Tooltip>;
                })}
              </div>
            </div>
            {/* 各 agent 行：按事件节点分段显示 */}
            {teamAgents.map((ag, i) => (
              <div key={i} className={styles.teamGanttRow}>
                <div className={`${styles.teamGanttLabel} ${styles.ganttLabelAgent}`}>{ag.name}</div>
                <div className={styles.teamGanttTrack}>
                  {ag.segments.map((seg, si) => {
                    const isTool = seg.label.startsWith('tool:');
                    const op = seg.label === 'spawn' ? 0.2 : seg.label === 'claim' ? 0.7 : seg.label === 'done' ? 0.4 : seg.label === 'shutdown' ? 0.1 : seg.label === 'report' ? 0.9 : isTool ? 0.5 : 0.5;
                    return <div key={`b${si}`} className={styles.teamGanttBar} title={seg.label} style={{
                      left: pct(seg.start) + '%',
                      width: widthPct(seg.start, seg.end) + '%',
                      background: '#eee', opacity: op,
                    }} />;
                  })}
                  {ag.events.filter(ev => !ev.label.startsWith('tool:')).map((ev, ei) => {
                    const tips = { spawn: 'Agent Spawned', claim: 'Task Claimed', done: 'Task Completed', shutdown: 'Shutdown Request', 'msg-in': 'Message Received', report: 'Report Submitted' };
                    const tip = tips[ev.label] || ev.label;
                    return <Tooltip key={`d${ei}`} title={`${ag.name}: ${tip}`}><span className={`${styles.teamGanttDiamond} ${styles.ganttLabelAgent}`} style={{ left: pct(ev.ts) + '%' }}>◆</span></Tooltip>;
                  })}
                </div>
              </div>
            ))}
            {/* 时间轴 */}
            <div className={`${styles.teamGanttRow} ${styles.ganttTimeAxisRow}`}>
              <div className={styles.teamGanttLabel} />
              <div className={`${styles.teamGanttTrack} ${styles.ganttTimeAxisTrack}`}>
                {ticks.map((tk, i) => (
                  <span key={i} className={styles.ganttTickLabel} style={{ left: tk.pct + '%' }}>{tk.label}</span>
                ))}
              </div>
            </div>
            {/* TaskUpdate 箭头：teammate 完成任务后指向目标（通常是 team-lead） */}
            {(() => {
              // 行高计算：每行 22px height + 3px margin-bottom = 25px，team-lead 是第 0 行
              const rowH = 25;
              const leadY = rowH / 2; // team-lead 行中心 y
              const arrows = [];
              teamAgents.forEach((ag, ai) => {
                const agentY = (ai + 1) * rowH + rowH / 2;
                // 完成箭头：用 doneTime（不依赖 events，因为 TaskUpdate completed 可能无 owner）
                if (ag.doneTime) {
                  const doneMs = new Date(ag.doneTime).getTime();
                  arrows.push({ key: `${ai}-done`, xPct: pct(doneMs), fromY: agentY, toY: leadY, color: '#faad14' });
                }
                // 报告箭头：用 events 中的 report 事件
                ag.events.filter(ev => ev.label === 'report').forEach((ev, ei) => {
                  arrows.push({ key: `${ai}-rpt-${ei}`, xPct: pct(ev.ts), fromY: agentY, toY: leadY, color: '#52c41a' });
                });
              });
              if (arrows.length === 0) return null;
              const totalH = (teamAgents.length + 2) * rowH; // +2 for lead + time axis
              return (
                <svg className={styles.teamGanttArrows} style={{ height: totalH }}>
                  <defs>
                    <marker id="gantt-arrow-yellow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                      <path d="M0,1 L7,4 L0,7 Z" fill="#faad14" />
                    </marker>
                    <marker id="gantt-arrow-green" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                      <path d="M0,1 L7,4 L0,7 Z" fill="#52c41a" />
                    </marker>
                  </defs>
                  {arrows.map(a => (
                    <line key={a.key}
                      x1={a.xPct + '%'} y1={a.fromY}
                      x2={a.xPct + '%'} y2={a.toY + 5}
                      stroke={a.color} strokeWidth="1.5" strokeDasharray="4,3" opacity="0.7"
                      markerEnd={a.color === '#52c41a' ? 'url(#gantt-arrow-green)' : 'url(#gantt-arrow-yellow)'}
                    />
                  ))}
                </svg>
              );
            })()}
            {/* 滚动位置指示线 — 跨越所有 track 行 */}
            <div ref={this._ganttIndicatorRef} className={`${styles.teamGanttIndicator} ${styles.ganttIndicatorInitial}`} />
          </div>
          <div
            className={styles.teamGanttResizer}
            onMouseDown={(e) => {
              e.preventDefault();
              const wrap = this._ganttWrapRef.current;
              if (!wrap) return;
              const startY = e.clientY;
              const startH = wrap.getBoundingClientRect().height;
              const onMove = (ev) => {
                const h = Math.max(60, startH + ev.clientY - startY);
                this.setState({ _ganttHeight: h });
              };
              const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
              };
              document.addEventListener('mousemove', onMove);
              document.addEventListener('mouseup', onUp);
            }}
          />
        </>)}
      </div>
    );
  }

  // Memoized team modal data — only recompute when team or requests change
  _getTeamModalData(team, requests, mainAgentSessions) {
    const cache = this._teamModalDataCache;
    if (cache && cache.team === team && cache.requests === requests && cache.mainAgentSessions === mainAgentSessions) return cache.result;

    const startIdx = team.requestIndex;
    const endIdx = team.endRequestIndex != null ? team.endRequestIndex + 1 : requests.length;
    const teamRequests = requests.slice(startIdx, endIdx);
    const teamStartTime = team.startTime;
    const teamEndTime = team.endTime || (requests[endIdx - 1]?.response?.timestamp || requests[endIdx - 1]?.timestamp);

    // 构建 tsToIndex 和 modelInfo
    const tsToIndex = {};
    let modelName = null;
    for (let i = startIdx; i < endIdx && i < requests.length; i++) {
      const req = requests[i];
      if (req.timestamp) tsToIndex[req.timestamp] = i;
      if (req.body?.model) modelName = req.body.model;
    }
    const modelInfo = getModelInfo(modelName);

    // 用户消息提取：展示触发 team 的用户 prompt，帮助理解 team 要解决什么问题。
    // 用户 prompt 不属于 Agent Team 讨论本身，但对理解上下文至关重要。
    //
    // 数据源优先级：
    // 1. mainAgentSessions（累积会话历史，有 _timestamp）— 覆盖大多数情况
    // 2. TeamCreate 所在 request 的 body.messages（直接提取）— 覆盖 session 未包含的情况
    // 3. 首条 assistant 响应文本 — 兜底：/clear 后 messages=[] 时，assistant 会概述要做什么
    const entries = [];
    let hasUserMsg = false;

    // 策略 1：从 mainAgentSessions 按时间范围提取
    if (mainAgentSessions) {
      let closestBeforeTs = null;
      for (const session of mainAgentSessions) {
        for (const msg of session.messages || []) {
          const ts = msg._timestamp;
          if (!ts || msg.role !== 'user') continue;
          if (ts <= teamStartTime && (!closestBeforeTs || ts > closestBeforeTs)) {
            closestBeforeTs = ts;
          }
        }
      }
      const effectiveStart = closestBeforeTs || teamStartTime;
      for (const session of mainAgentSessions) {
        for (const msg of session.messages || []) {
          const ts = msg._timestamp;
          if (!ts || ts < effectiveStart) continue;
          if (teamEndTime && ts > teamEndTime) continue;
          if (msg.role !== 'user') continue;
          const content = msg.content;
          if (Array.isArray(content)) {
            const { textBlocks } = classifyUserContent(content);
            for (const tb of textBlocks) {
              if (tb.text && tb.text.trim()) {
                entries.push({ type: 'user', text: tb.text, timestamp: ts });
                hasUserMsg = true;
              }
            }
          } else if (typeof content === 'string' && !isSystemText(content)) {
            entries.push({ type: 'user', text: content, timestamp: ts });
            hasUserMsg = true;
          }
        }
      }
    }

    // 策略 2：从 TeamCreate request 的 body.messages 直接提取
    if (!hasUserMsg) {
      const tcReq = requests[team.requestIndex];
      const tcMsgs = tcReq?.body?.messages || [];
      for (let m = tcMsgs.length - 1; m >= 0; m--) {
        if (tcMsgs[m].role !== 'user') continue;
        const c = tcMsgs[m].content;
        if (Array.isArray(c)) {
          const { textBlocks } = classifyUserContent(c);
          for (const tb of textBlocks) {
            if (tb.text && tb.text.trim()) {
              entries.push({ type: 'user', text: tb.text, timestamp: teamStartTime });
              hasUserMsg = true;
            }
          }
        } else if (typeof c === 'string' && !isSystemText(c)) {
          entries.push({ type: 'user', text: c, timestamp: teamStartTime });
          hasUserMsg = true;
        }
        if (hasUserMsg) break;
      }
    }

    // 策略 3 兜底：/clear 后 messages=[] 时，用首条 assistant 文本作为上下文
    if (!hasUserMsg) {
      for (let i = 0; i < teamRequests.length; i++) {
        const resp = teamRequests[i].response?.body?.content;
        if (!Array.isArray(resp)) continue;
        for (const block of resp) {
          if (block.type === 'text' && block.text && block.text.trim()) {
            entries.push({ type: 'context', text: block.text.trim(), timestamp: teamRequests[i].response?.timestamp || teamRequests[i].timestamp });
            hasUserMsg = true;
            break;
          }
        }
        if (hasUserMsg) break;
      }
    }

    // 收集 assistant + sub-agent 条目
    for (let i = 0; i < teamRequests.length; i++) {
      const req = teamRequests[i];
      const respContent = req.response?.body?.content;
      if (!Array.isArray(respContent) || respContent.length === 0) continue;
      const cls = classifyRequest(req, teamRequests[i + 1]);
      const isMA = isMainAgent(req);
      const isSub = cls.type === 'SubAgent' || cls.type === 'Teammate';

      if (isMA) {
        entries.push({ type: 'assistant', content: respContent, timestamp: req.response?.timestamp || req.timestamp, requestIndex: startIdx + i, modelInfo });
      } else if (isSub) {
        const subToolResultMap = {};
        const msgs = req.body?.messages || [];
        for (const msg of msgs) {
          if (msg.role === 'tool_result' || (msg.role === 'user' && Array.isArray(msg.content))) {
            const blocks = Array.isArray(msg.content) ? msg.content : [msg];
            for (const b of blocks) {
              if (b.type === 'tool_result' && b.tool_use_id) {
                subToolResultMap[b.tool_use_id] = { resultText: typeof b.content === 'string' ? b.content : JSON.stringify(b.content) };
              }
            }
          }
        }
        entries.push({
          type: 'sub-agent',
          content: respContent,
          toolResultMap: subToolResultMap,
          label: cls.type === 'Teammate' ? formatTeammateLabel(cls.subType, req.body?.model) : formatRequestTag(cls.type, cls.subType),
          isTeammate: cls.type === 'Teammate',
          timestamp: req.timestamp,
          requestIndex: startIdx + i,
        });
      }
    }

    // 按时间排序
    entries.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));

    // 提取每个 agent 的时间数据（用于状态卡片和甘特图）
    const palette = ['#1668dc', '#52c41a', '#faad14', '#eb2f96', '#722ed1', '#13c2c2', '#fa541c', '#2f54eb'];
    const teamAgents = [];
    const agentMap = new Map(); // name → index in teamAgents
    const teamTotalStart = new Date(teamStartTime).getTime();
    const teamTotalEnd = new Date(teamEndTime || Date.now()).getTime();
    // team-lead 活动段：[{ start, end, label, color }]
    const leadSegments = [];
    let lastLeadTs = teamTotalStart;
    const _taskCreateSubjects = new Map(); // taskId → subject
    const _taskOwnerMap = new Map(); // taskId → owner name (用于 completed 事件反查)
    let _taskCreateCounter = 1;

    for (let i = 0; i < teamRequests.length; i++) {
      const req = teamRequests[i];
      const resp = req.response?.body?.content;
      if (!Array.isArray(resp)) continue;
      const tsStr = req.response?.timestamp || req.timestamp;
      const ts = tsStr;
      const tsMs = new Date(tsStr).getTime();
      // 检测 team-lead 活动（MainAgent 请求中的关键 tool_use）
      const isMA = isMainAgent(req);
      for (const block of resp) {
        if (block.type !== 'tool_use') continue;
        const n = block.name;
        const inp = typeof block.input === 'string' ? (() => { try { return JSON.parse(block.input); } catch { return {}; } })() : (block.input || {});
        if (n === 'Agent' && inp.name) {
          const idx = teamAgents.length;
          teamAgents.push({
            name: inp.name,
            color: palette[idx % palette.length],
            type: inp.subagent_type?.split(':').pop() || '',
            spawnTime: ts,
            claimTime: null,
            doneTime: null,
            shutdownTime: null,
            taskSubject: null,
            // 细粒度事件节点（用于甘特分段）
            events: [{ ts: tsMs, label: 'spawn' }],
          });
          agentMap.set(inp.name, idx);
        } else if (n === 'TaskCreate') {
          // Track task subjects for later association (normalize taskId to string)
          if (inp.subject) {
            const tId = String(inp.taskId || _taskCreateCounter++);
            _taskCreateSubjects.set(tId, inp.subject);
          }
        } else if (n === 'TaskUpdate') {
          const owner = inp.owner;
          const taskId = inp.taskId != null ? String(inp.taskId) : null;
          // 策略：多路径查找 taskId 对应的 agent
          // 1. owner 直接匹配 agentMap
          // 2. _taskOwnerMap 反查（之前记录的 taskId→owner）
          // 3. 按 taskId 顺序匹配 agent（task #1→agent[0], #2→agent[1]...）

          // 先记录 owner（如果有的话）
          if (owner && taskId) _taskOwnerMap.set(taskId, owner);

          let targetAg = null;
          if (owner && agentMap.has(owner)) {
            targetAg = teamAgents[agentMap.get(owner)];
          } else if (taskId) {
            const prevOwner = _taskOwnerMap.get(taskId);
            if (prevOwner && agentMap.has(prevOwner)) {
              targetAg = teamAgents[agentMap.get(prevOwner)];
            } else {
              // 兜底：按 taskId 数字顺序匹配 agent 索引（task #1→agent[0]）
              const taskNum = parseInt(taskId, 10);
              if (taskNum > 0 && taskNum <= teamAgents.length) {
                targetAg = teamAgents[taskNum - 1];
                _taskOwnerMap.set(taskId, targetAg.name);
              }
            }
          }
          if (targetAg) {
            if (inp.status === 'in_progress' && !targetAg.claimTime) {
              targetAg.claimTime = ts;
              targetAg.events.push({ ts: tsMs, label: 'claim' });
            }
            if (inp.status === 'completed' && !targetAg.doneTime) {
              targetAg.doneTime = ts;
              targetAg.events.push({ ts: tsMs, label: 'done' });
            }
            if (taskId && _taskCreateSubjects.has(taskId) && !targetAg.taskSubject) {
              targetAg.taskSubject = _taskCreateSubjects.get(taskId);
            }
          }
        } else if (n === 'SendMessage') {
          if (inp.message?.type === 'shutdown_request' && inp.to && agentMap.has(inp.to)) {
            const ag = teamAgents[agentMap.get(inp.to)];
            ag.shutdownTime = ts;
            ag.events.push({ ts: tsMs, label: 'shutdown' });
          } else if (inp.message?.type === 'shutdown_response' && agentMap.has(inp.to === 'team-lead' ? '' : inp.to)) {
            // skip
          } else if (inp.to && inp.to !== 'team-lead' && agentMap.has(inp.to)) {
            // lead → agent message
            teamAgents[agentMap.get(inp.to)].events.push({ ts: tsMs, label: 'msg-in' });
          } else if (inp.to === 'team-lead') {
            // agent → lead report: push a generic lead segment
            if (typeof inp.message === 'string' || (inp.message && !inp.message.type)) {
              if (tsMs > lastLeadTs) {
                leadSegments.push({ start: lastLeadTs, end: tsMs, label: 'report-received', color: '#52c41a' });
                lastLeadTs = tsMs;
              }
            }
          }
        }
        // team-lead 关键事件段
        if (isMA && (n === 'TeamCreate' || n === 'TaskCreate' || n === 'Agent' || n === 'SendMessage' || n === 'TeamDelete')) {
          const label = n === 'TeamCreate' ? 'create' : n === 'TaskCreate' ? 'tasks' : n === 'Agent' ? 'spawn' : n === 'SendMessage' ? 'msg' : 'cleanup';
          if (tsMs > lastLeadTs) {
            leadSegments.push({ start: lastLeadTs, end: tsMs, label, color: n === 'TeamDelete' ? '#52c41a' : n === 'SendMessage' ? '#ff4d4f' : '#1668dc' });
            lastLeadTs = tsMs;
          }
        }
      }
      // Lead text and thinking events (scan non-tool_use blocks in MainAgent responses)
      if (isMA) {
        for (const block of resp) {
          if (block.type === 'text' && block.text) {
            if (tsMs > lastLeadTs) {
              leadSegments.push({ start: lastLeadTs, end: tsMs, label: 'text', color: '#196ae1' });
              lastLeadTs = tsMs;
            }
          } else if (block.type === 'thinking') {
            if (tsMs > lastLeadTs) {
              leadSegments.push({ start: lastLeadTs, end: tsMs, label: 'thinking', color: '#722ed1' });
              lastLeadTs = tsMs;
            }
          }
        }
      }
    }
    // Second pass: teammate own tool calls (non-MainAgent requests)
    for (let i = 0; i < teamRequests.length; i++) {
      const req = teamRequests[i];
      if (isMainAgent(req)) continue;
      const resp = req.response?.body?.content;
      if (!Array.isArray(resp)) continue;
      const tsStr = req.response?.timestamp || req.timestamp;
      const tsMs = new Date(tsStr).getTime();
      const cls = classifyRequest(req, teamRequests[i + 1]);
      const label = cls.type === 'Teammate' ? cls.subType : null;
      if (label) {
        let agIdx = agentMap.has(label) ? agentMap.get(label) : undefined;
        // Fallback: check if any agent name is contained in the label
        if (agIdx === undefined) {
          for (const [name, idx] of agentMap) {
            if (label.includes(name) || name.includes(label)) { agIdx = idx; break; }
          }
        }
        if (agIdx !== undefined) {
          const ag = teamAgents[agIdx];
          for (const block of resp) {
            if (block.type === 'tool_use' && block.name) {
              ag.events.push({ ts: tsMs, label: 'tool:' + block.name });
            }
          }
        }
      }
    }

    // 提取 <teammate-message> 报告内容（在主 agent 的 body.messages 中）
    const teammateMessageRe = /<teammate-message\s+teammate_id="([^"]+)"[^>]*summary="([^"]*)"[^>]*>([\s\S]*?)<\/teammate-message>/g;
    const seenTmMsg = new Set(); // 去重：同一 teammate-message 会出现在多个请求的累积 messages 中
    teamAgents.forEach(ag => { ag.teammateMessages = []; });
    for (let i = 0; i < teamRequests.length; i++) {
      const req = teamRequests[i];
      const msgs = req.body?.messages || [];
      for (const m of msgs) {
        if (m.role !== 'user' || !Array.isArray(m.content)) continue;
        for (const b of m.content) {
          if (b.type !== 'text' || !b.text) continue;
          let match;
          teammateMessageRe.lastIndex = 0;
          while ((match = teammateMessageRe.exec(b.text)) !== null) {
            const [, tid, summary, content] = match;
            if (tid === 'system' || tid === 'team-lead') continue;
            const dedupKey = tid + '|' + summary + '|' + content.trim().slice(0, 100);
            if (seenTmMsg.has(dedupKey)) continue;
            seenTmMsg.add(dedupKey);
            // 匹配到 agent，同时推入 entries 以在对话流中显示
            for (const ag of teamAgents) {
              if (tid === ag.name || tid.includes(ag.name) || ag.name.includes(tid)) {
                if (summary && content.trim()) {
                  ag.teammateMessages.push({ summary, content: content.trim() });
                  const reqTs = req.timestamp || req.response?.timestamp;
                  entries.push({ type: 'teammate-report', agentName: ag.name, agentColor: getTeammateAvatar(ag.name).color, summary, content: content.trim(), timestamp: reqTs });
                }
                break;
              }
            }
          }
        }
      }
    }

    // 闭合 lead 最后一段
    if (lastLeadTs < teamTotalEnd) {
      leadSegments.push({ start: lastLeadTs, end: teamTotalEnd, label: 'idle', color: '#333' });
    }

    // 从事件节点构建每个 agent 的分段 + 计算持续时间
    const segColors = { spawn: '#555', claim: '#faad14', done: '#52c41a', shutdown: '#ff4d4f', 'msg-in': '#1668dc', report: '#52c41a', 'report-received': '#52c41a', text: '#196ae1', thinking: '#722ed1' };
    teamAgents.forEach(ag => {
      const start = new Date(ag.spawnTime).getTime();
      const end = new Date(ag.doneTime || ag.shutdownTime || teamEndTime || Date.now()).getTime();
      ag.duration = end - start;
      // 按时间排序事件，构建相邻段
      ag.events.sort((a, b) => a.ts - b.ts);
      ag.segments = [];
      for (let e = 0; e < ag.events.length; e++) {
        const ev = ag.events[e];
        const nextTs = ag.events[e + 1]?.ts || (ag.shutdownTime ? new Date(ag.shutdownTime).getTime() : teamTotalEnd);
        ag.segments.push({ start: ev.ts, end: nextTs, label: ev.label, color: segColors[ev.label] || (ev.label.startsWith('tool:') ? '#888' : ag.color) });
      }
    });

    const result = { entries, teamAgents, leadSegments, teamTotalStart, teamTotalEnd, modelInfo, teamRequests };
    this._teamModalDataCache = { team, requests, mainAgentSessions, result };
    return result;
  }

  renderTeamModal() {
    const team = this.state.teamModalSession;
    if (!team) return null;
    const { requests, mainAgentSessions, collapseToolResults, expandThinking } = this.props;
    const { entries, teamAgents, leadSegments, teamTotalStart, teamTotalEnd, modelInfo, teamRequests } = this._getTeamModalData(team, requests, mainAgentSessions);

    // 存储时间范围供 scroll handler 使用
    this._teamTotalStart = teamTotalStart;
    this._teamTotalEnd = teamTotalEnd;

    return (
      <Modal
        open
        onCancel={() => { this._ganttTrackEl = null; this.setState({ teamModalSession: null }); }}
        footer={null}
        closable
        maskClosable
        zIndex={1100}
        width="calc(100vw - 80px)"
        title={<span className={styles.teamModalTitle}>Team: {team.name}</span>}
        styles={{
          header: { background: '#111', borderBottom: '1px solid #2a2a2a', padding: '12px 20px' },
          body: { background: '#0a0a0a', height: 'calc(100vh - 160px)', overflow: 'hidden', padding: 0 },
          mask: { background: 'rgba(0,0,0,0.7)' },
          content: { background: '#111', border: '1px solid #2a2a2a', borderRadius: 8, padding: 0 },
        }}
        centered
      >
        <div className={styles.teamModalLayout}>
          {/* Left: Agent Cards */}
          <div className={styles.teamAgentCards}>
            <div className={`${styles.teamAgentCard} ${styles.teamLeadCard}`}>
              <div className={styles.teamAgentCardHeader}>
                {modelInfo?.svg
                  ? <div className={styles.teamAgentAvatar} style={{ background: modelInfo.color || '#6b21a8' }} dangerouslySetInnerHTML={{ __html: modelInfo.svg }} />
                  : <img src={defaultModelAvatarUrl} className={styles.teamAgentAvatar} alt="lead" />
                }
                <div className={styles.teamAgentName}>team-lead</div>
              </div>
              <div className={styles.teamAgentType}>orchestrator</div>
              <div className={styles.teamAgentStatus} style={{ color: team.endTime ? (team._inferredEnd ? '#888' : '#52c41a') : '#faad14' }}>
                {team.endTime ? (team._inferredEnd ? '⏱ ended' : '✓ done') : '● active'}
              </div>
            </div>
            {teamAgents.map((ag, i) => {
              const isDone = !!ag.doneTime;
              const durSec = Math.round(ag.duration / 1000);
              const durStr = durSec >= 60 ? `${Math.floor(durSec/60)}m${durSec%60}s` : `${durSec}s`;
              // 该 teammate 的消息（从 entries 中过滤）
              const agentMessages = entries.filter(e => e.type === 'sub-agent' && e.label && e.label.includes(ag.name));
              const popContent = (
                <div className={styles.teamAgentPopover}>
                  {ag.teammateMessages && ag.teammateMessages.length > 0 && (
                    <div className={styles.teamAgentPopTeammateMsg}>
                      {ag.teammateMessages.map((tm, ti) => (
                        <div key={ti}>
                          {tm.summary && <div className={styles.teamAgentPopTmSummary}>{tm.summary}</div>}
                          <div className={`${styles.teamAgentPopTmContent} chat-md`} dangerouslySetInnerHTML={{ __html: renderMarkdown(tm.content.length > 3000 ? tm.content.slice(0, 3000) + '\n\n...' : tm.content) }} />
                        </div>
                      ))}
                    </div>
                  )}
                  {ag.taskSubject && <div className={styles.teamAgentPopTask}>{ag.taskSubject}</div>}
                  {agentMessages.length > 0 ? agentMessages.map((msg, mi) => {
                    // 提取 text 内容
                    const texts = (msg.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
                    if (!texts.trim()) return null;
                    return <div key={mi} className={`${styles.teamAgentPopMsg} chat-md`} dangerouslySetInnerHTML={{ __html: renderMarkdown(texts.length > 2000 ? texts.slice(0, 2000) + '\n\n...' : texts) }} />;
                  }) : <div className={styles.agentNoMessages}>No messages</div>}
                </div>
              );
              return (
                <Popover key={i} content={popContent} trigger="click" placement="right" autoAdjustOverflow
                  overlayInnerStyle={{ background: '#1e1e1e', border: '1px solid #333', padding: 0, maxWidth: 800, maxHeight: '70vh', overflowY: 'auto' }}
                  onOpenChange={(open) => this.setState({ activeAgentCard: open ? i : null })}
                >
                  <div className={`${styles.teamAgentCard} ${styles.teamAgentCardClickable} ${this.state.activeAgentCard === i ? styles.teamAgentCardActive : ''}`}>
                    <div className={styles.teamAgentCardHeader}>
                      {(() => { const _a = getTeammateAvatar(ag.name); return <div className={styles.teamAgentAvatar} style={{ background: _a.color }} dangerouslySetInnerHTML={{ __html: _a.svg }} />; })()}
                      <div className={styles.teamAgentName}>{ag.name}</div>
                    </div>
                    <div className={styles.teamAgentType}>{ag.type}</div>
                    <div className={styles.teamAgentStatus} style={{ color: isDone ? '#52c41a' : '#faad14' }}>
                      {isDone ? '✓ done' : '● working'} <span className={styles.agentStatusDurSuffix}>· {durStr}</span>
                    </div>
                  </div>
                </Popover>
              );
            })}
          </div>
          {/* Right: Content */}
          <div className={styles.teamModalContent}>
            {this.renderTeamGantt(teamAgents, teamTotalStart, teamTotalEnd, leadSegments)}
            <div className={styles.teamModalBody} ref={this._teamModalBodyRef} onScroll={this.onTeamModalScroll}>
              {entries.map((entry, i) => (
                <div key={`tw-${i}`} data-timestamp={entry.timestamp}>
                  {entry.type === 'user' && <ChatMessage role="user" text={entry.text} timestamp={entry.timestamp} userProfile={this.props.userProfile} modelInfo={modelInfo} requestIndex={entry.requestIndex} onViewRequest={this.props.onViewRequest} />}
                  {entry.type === 'assistant' && <ChatMessage role="assistant" content={entry.content} timestamp={entry.timestamp} modelInfo={entry.modelInfo} collapseToolResults={collapseToolResults} expandThinking={expandThinking} toolResultMap={{}} askAnswerMap={{}} requestIndex={entry.requestIndex} onViewRequest={this.props.onViewRequest} />}
                  {entry.type === 'sub-agent' && <ChatMessage role="sub-agent-chat" content={entry.content} toolResultMap={entry.toolResultMap} label={entry.label} isTeammate={entry.isTeammate} timestamp={entry.timestamp} collapseToolResults={collapseToolResults} expandThinking={expandThinking} requestIndex={entry.requestIndex} onViewRequest={this.props.onViewRequest} />}
                  {entry.type === 'context' && <ChatMessage role="assistant" content={[{ type: 'text', text: entry.text }]} timestamp={entry.timestamp} modelInfo={modelInfo} collapseToolResults={collapseToolResults} expandThinking={expandThinking} toolResultMap={{}} askAnswerMap={{}} />}
                  {entry.type === 'teammate-report' && (
                    <div className={styles.teammateReportEntry}>
                      <div className={styles.teammateReportHeader}>
                        {(() => { const _a = getTeammateAvatar(entry.agentName); return <div className={styles.teamAgentAvatar} style={{ background: _a.color }} dangerouslySetInnerHTML={{ __html: _a.svg }} />; })()}
                        <span className={styles.teammateReportName}>{entry.agentName}</span>
                        <span className={styles.teammateReportSummary}>{entry.summary}</span>
                      </div>
                      <div className={`${styles.teammateReportBody} chat-md`} dangerouslySetInnerHTML={{ __html: renderMarkdown(entry.content) }} />
                    </div>
                  )}
                </div>
              ))}
              {entries.length === 0 && <Empty description="No entries" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
            </div>
          </div>
        </div>
      </Modal>
    );
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
    if (this.state.roleFilterHidden.size > 0) {
      filteredItems = allItems.filter(item => {
        if (!item || !item.props) return true;
        const role = item.props.role;
        if (role === 'user' || role === 'plan-prompt') return !this.state.roleFilterHidden.has('user');
        if (role === 'assistant') return !this.state.roleFilterHidden.has('assistant');
        if (role === 'sub-agent-chat') {
          const key = `sub:${item.props.label || 'SubAgent'}`;
          return !this.state.roleFilterHidden.has(key);
        }
        return true;
      });
    }

    const filteredLastResponseItems = lastResponseItems && this.state.roleFilterHidden.has('assistant') ? null : lastResponseItems;

    const targetIdx = this._scrollTargetIdx;
    const { highlightTs, highlightFading } = this.state;
    const highlightIdx = highlightTs && this._tsItemMap && this._tsItemMap[highlightTs] != null
      ? this._tsItemMap[highlightTs] : null;
    const visible = filteredItems.slice(0, this.state.roleFilterHidden.size > 0 ? filteredItems.length : visibleCount);

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

    const promptBubbles = cliMode && ptyPromptHistory.length > 0 ? ptyPromptHistory.filter(p => {
      // active plan approval prompt 由 ExitPlanMode 卡片处理，不重复显示
      if (isPlanApprovalPrompt(p) && p.status === 'active') return false;
      // Last Response 中有对应 AskUserQuestion 卡片时，按问题文本精确去重
      if (this._lastResponseAskQuestions && this._lastResponseAskQuestions.size > 0
        && p.status === 'active' && this._lastResponseAskQuestions.has(p.question)) return false;
      return true;
    }).map((p, i) => {
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

    const roleFilterBar = this.state.roleFilterOpen && collectedRoles.length > 0 ? (
      <div className={styles.roleFilterBar}>
        {collectedRoles.map(r => {
          const hidden = this.state.roleFilterHidden.has(r.key);
          return (
            <button key={r.key}
              className={hidden ? styles.roleChip : styles.roleChipActive}
              onClick={() => this.setState(prev => {
                const next = new Set(prev.roleFilterHidden);
                hidden ? next.delete(r.key) : next.add(r.key);
                return { roleFilterHidden: next };
              })}
            >
              {r.avatarImg ? (
                <img src={r.avatarImg} className={styles.roleAvatarImg} alt={r.name}
                  onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; const d = e.target.parentNode.querySelector('[data-role-avatar-fallback]'); if (d) d.style.display = ''; }} />
              ) : null}
              <div className={styles.roleAvatar}
                style={{ background: r.color || 'rgba(255,255,255,0.1)', display: r.avatarImg ? 'none' : '' }}
                data-role-avatar-fallback=""
                dangerouslySetInnerHTML={{ __html: r.avatarSvg || getSvgAvatar(r.avatarType) }}
              />
              <span className={styles.roleName}>{r.name}</span>
              {!hidden && <span className={styles.roleCheck}>✓</span>}
            </button>
          );
        })}
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
        {roleFilterBar}
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
          {filteredLastResponseItems && (
            targetIdx != null && targetIdx >= visible.length
              ? <div key="last-resp-anchor" ref={this._scrollTargetRef}>{filteredLastResponseItems}</div>
              : filteredLastResponseItems
          )}
          {pendingBubble}
          {promptBubbles}
        </div>
        {stickyBtn}
      </div>
    );

    if (!cliMode) {
      return (<>
        <div className={styles.splitContainer}>
          <div className={styles.navSidebar}>
            <button
              className={this.state.roleFilterOpen ? styles.navBtnActive : styles.navBtn}
              onClick={() => this.setState(prev => ({ roleFilterOpen: !prev.roleFilterOpen }))}
              title={t('ui.roleFilter')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
              </svg>
            </button>
          {this.renderTeamButton()}
          </div>
          <div className={styles.navSidebarContent}>
            {messageList}
          </div>
        </div>
        {this.renderTeamModal()}
      </>);
    }

    return (<>
      <div ref={this.splitContainerRef} className={styles.splitContainer}>
        <div className={styles.navSidebar}>
          <button
            className={this.state.roleFilterOpen ? styles.navBtnActive : styles.navBtn}
            onClick={() => this.setState(prev => ({ roleFilterOpen: !prev.roleFilterOpen }))}
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
          {this.renderTeamButton()}
        </div>
        <div className={styles.innerSplitArea} ref={this.innerSplitRef}>
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
      {this.renderTeamModal()}
    </>);
  }
}

export default ChatView;
