/**
 * Incremental tool result state builder.
 * Processes assistant tool_use and user tool_result blocks into lookup maps.
 */

import { extractToolResultText } from './helpers';
import { t } from '../i18n';

// --- WeakMap cache for tool result state ---

const _toolResultCache = new WeakMap();

export function getToolResultCache(messages) {
  return _toolResultCache.get(messages) || null;
}

export function setToolResultCache(messages, state) {
  _toolResultCache.set(messages, state);
}

// --- State builder ---

const MAX_EDIT_SNAPSHOTS = 300;

export function createEmptyToolState() {
  return {
    toolUseMap: {},
    toolResultMap: {},
    readContentMap: {},
    editSnapshotMap: {},
    askAnswerMap: {},
    planApprovalMap: {},
    latestPlanContent: null,
    _fileState: {},
    _editOrder: [],
  };
}

export function appendToolResultMap(state, messages, startIndex) {
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
          // Write → .claude/plans/ 文件内容追踪
          if (parsed.name === 'Write' && parsed.input?.file_path
            && /[/\\]\.claude[/\\]plans[/\\]/.test(parsed.input.file_path) && parsed.input.content) {
            state.latestPlanContent = parsed.input.content;
          }
          // Edit → editSnapshotMap + _fileState 更新
          if (parsed.name === 'Edit' && parsed.input) {
            const fp = parsed.input.file_path;
            const oldStr = parsed.input.old_string;
            const newStr = parsed.input.new_string;
            if (fp && oldStr != null && newStr != null && _fileState[fp]) {
              const entry = _fileState[fp];
              // 淘汰时留 null 占位：rebuild 时 key 已存在则跳过，避免重建已淘汰条目
              if (!(parsed.id in editSnapshotMap)) {
                editSnapshotMap[parsed.id] = { plainText: entry.plainText, lineNums: entry.lineNums.slice() };
                state._editOrder.push(parsed.id);
                if (state._editOrder.length > MAX_EDIT_SNAPSHOTS) {
                  const evictId = state._editOrder.shift();
                  editSnapshotMap[evictId] = null;
                }
              }
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
                // Edit plan 文件时同步 latestPlanContent（Write 只追踪全量写入，Edit 追踪增量编辑后的完整内容）
                if (/[/\\]\.claude[/\\]plans[/\\]/.test(fp)) {
                  state.latestPlanContent = entry.plainText;
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
          const isError = !!block.is_error;
          const isPermissionDenied = isError && resultText && /doesn't want to proceed|Permission.*denied|rejected.*tool use|interrupted by user for tool use/i.test(resultText);
          const isUltraplan = isPermissionDenied && resultText && /ultraplan/i.test(resultText);
          toolResultMap[block.tool_use_id] = { label, toolName, toolInput, resultText, isError, isPermissionDenied, isUltraplan };
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
            const parsed = parseAskAnswerText(resultText);
            // 被拒绝的 AskUserQuestion：标记为 rejected，避免渲染成交互式表单
            if (Object.keys(parsed).length === 0 && isPermissionDenied) {
              askAnswerMap[block.tool_use_id] = { __rejected__: true };
            } else {
              askAnswerMap[block.tool_use_id] = parsed;
            }
            state._askDirty = (state._askDirty || 0) + 1;
          }
          if (matchedTool && matchedTool.name === 'ExitPlanMode') {
            if (isPermissionDenied) {
              const userSaid = resultText.match(/the user said:\s*([\s\S]*)/i);
              planApprovalMap[block.tool_use_id] = {
                status: isUltraplan ? 'ultraplan' : 'rejected',
                feedback: userSaid ? userSaid[1].trim() : '',
              };
            } else {
              planApprovalMap[block.tool_use_id] = parsePlanApproval(resultText);
            }
            state._planDirty = (state._planDirty || 0) + 1;
            // Plan 审批完成（approved/rejected）后重置 latestPlanContent，
            // 防止下一个 plan 周期显示旧内容
            state.latestPlanContent = null;
          }
        }
      }
    }
  }
}

export function buildToolResultMap(messages) {
  const state = createEmptyToolState();
  appendToolResultMap(state, messages, 0);
  return state;
}

export function cachedBuildToolResultMap(messages) {
  let cached = _toolResultCache.get(messages);
  if (!cached) {
    cached = buildToolResultMap(messages);
    _toolResultCache.set(messages, cached);
  }
  return cached;
}

/** 从 AskUserQuestion tool_result 文本中提取答案 map */
export function parseAskAnswerText(text) {
  const answers = {};
  const re = /"([^"]+)"="([^"]*)"/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    answers[m[1]] = m[2];
  }
  return answers;
}

/** 从 ExitPlanMode tool_result 文本中解析审批状态和计划内容 */
export function parsePlanApproval(text) {
  if (!text) return { status: 'pending' };
  if (/User has approved/i.test(text)) {
    const planMatch = text.match(/##\s*Approved Plan:\s*\n([\s\S]*)/i);
    return { status: 'approved', planContent: planMatch ? planMatch[1].trim() : '' };
  }
  if (/User rejected/i.test(text)) {
    const feedbackMatch = text.match(/feedback:\s*(.+)/i) || text.match(/User rejected[^:]*:\s*(.+)/i);
    return { status: 'rejected', feedback: feedbackMatch ? feedbackMatch[1].trim() : '' };
  }
  return { status: 'pending' };
}
