/**
 * Incremental tool result state builder.
 * Processes assistant tool_use and user tool_result blocks into lookup maps.
 *
 * NOTE: server_tool_use（如 Anthropic 的 web_search）和 web_search_tool_result 不入此 map，
 * 它们由 ChatMessage.renderAssistantContent 直接从 assistant content 数组渲染。
 * 详见 src/utils/webSearchGrouping.js 与 src/components/viewers/WebSearchResultsView.jsx。
 */

import { t } from '../i18n';
import { buildSingleToolResultCore } from './toolResultCore.js';

// --- WeakMap cache for tool result state ---

const _toolResultCache = new WeakMap();

// 稳定引用,避免 `req.body?.messages || []` 每次构造新 `[]` 字面量打穿 WeakMap 缓存
// (subAgentEntries 扫描在每次 requests-change 时跑,缓存命中是热路径性能假设)。
const EMPTY_MESSAGES = Object.freeze([]);

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
    latestPlanFilePath: null,
    _fileState: {},
    _editOrder: [],
  };
}

/**
 * i18n 包装:在 toolResultCore 的 buildSingleToolResultCore 基础上附加本地化 label。
 * 生产路径调用此函数;test 直接调 core 以避开 i18n 依赖。
 */
export function buildSingleToolResult(block, matchedTool) {
  const core = buildSingleToolResultCore(block, matchedTool);
  let label = t('ui.toolReturn');
  if (matchedTool) {
    if (matchedTool.name === 'Task' && matchedTool.input) {
      const st = matchedTool.input.subagent_type || '';
      const desc = matchedTool.input.description || '';
      label = `SubAgent: ${st}${desc ? ' — ' + desc : ''}`;
    } else {
      label = t('ui.toolReturnNamed', { name: matchedTool.name });
    }
  }
  return { label, ...core };
}

/**
 * 全局聚合所有 requests 的 tool_result 块,按 tool_use_id 索引。
 *
 * 设计动机:并行 SubAgent / Teammate 的请求在日志中互相穿插,K+1 不一定是同一 agent
 * 的下一个 turn。两遍扫描建立"id → result"全局索引,渲染时 O(1) 查询,免去运行时配对。
 *
 * Pass 1: 全量构建 toolUseMap(供 label / toolName / toolInput 解析)
 *   - body.messages 里 role=assistant 的 tool_use 块
 *   - response.body.content 里的 tool_use 块(末轮)
 * Pass 2: 提取所有 tool_result 块写入索引(role=user 消息的 content[])
 *
 * id 冲突风险:Anthropic API 用 nanoid 24+ char,2^-128 量级,可忽略。
 */
export function buildGlobalToolResultIndex(requests) {
  const state = createEmptyGlobalIndexState();
  appendToGlobalToolResultIndex(state, requests, 0);
  return state.index;
}

// 同一 session 内并发持有的 base64 image 上限:更早入索引的 entry 一旦超过此数,
// 其 images 字段被改成 oversized 占位,释放 base64 字节(单图 2MB × N = 几十 MB
// 常驻内存的隐患)。32 张覆盖大多数实际会话;若超过,旧图回退为占位,新图保留。
const MAX_LIVE_IMAGE_ENTRIES = 32;

/**
 * 增量索引 state:供 ChatView / TeamModal 在 requests 增量到达时复用,避免每次全量扫描。
 *   index           : { [tool_use_id]: entry } (出参,共享给调用方)
 *   _useMap         : 已扫到的 tool_use 块 (Pass 1 累积,Pass 2 查 label)
 *   _imageEntryIds  : FIFO 队列,跟踪持有 base64 image 的 entry id,超 MAX 时驱逐最早
 */
export function createEmptyGlobalIndexState() {
  return { index: {}, _useMap: {}, _imageEntryIds: [] };
}

// 把超出 LRU 上限的最早 image entry 降级为 oversized 占位,释放 base64 字符串。
function _enforceImageBudget(state) {
  const { index, _imageEntryIds } = state;
  while (_imageEntryIds.length > MAX_LIVE_IMAGE_ENTRIES) {
    const evictId = _imageEntryIds.shift();
    const entry = index[evictId];
    if (!entry || !Array.isArray(entry.images)) continue;
    entry.images = entry.images.map(img => (
      img && img.src && !img.oversized
        ? { oversized: true, mediaType: img.mediaType, sizeBytes: img.src.length }
        : img
    ));
  }
}

/**
 * 增量追加:扫描 requests[startIndex..] 并把新发现的 tool_use / tool_result 累积到 state。
 * 仅写入新出现的 id(`!(id in index)`),原条目幂等,可重复调用同一切片不会引入副作用。
 */
export function appendToGlobalToolResultIndex(state, requests, startIndex) {
  if (!Array.isArray(requests)) return;
  const { index, _useMap, _imageEntryIds } = state;
  for (let i = startIndex; i < requests.length; i++) {
    const r = requests[i];
    if (!r) continue;
    const msgs = r.body?.messages;
    if (Array.isArray(msgs)) {
      for (const m of msgs) {
        if (m?.role === 'assistant' && Array.isArray(m.content)) {
          for (const b of m.content) {
            if (b?.type === 'tool_use' && b.id) _useMap[b.id] = b;
          }
        }
      }
    }
    const respContent = r.response?.body?.content;
    if (Array.isArray(respContent)) {
      for (const b of respContent) {
        if (b?.type === 'tool_use' && b.id) _useMap[b.id] = b;
      }
    }
  }
  for (let i = startIndex; i < requests.length; i++) {
    const r = requests[i];
    const msgs = r?.body?.messages;
    if (!Array.isArray(msgs)) continue;
    for (const m of msgs) {
      if (m?.role !== 'user' || !Array.isArray(m.content)) continue;
      for (const b of m.content) {
        if (b?.type === 'tool_result' && b.tool_use_id && !(b.tool_use_id in index)) {
          const entry = buildSingleToolResult(b, _useMap[b.tool_use_id]);
          index[b.tool_use_id] = entry;
          if (Array.isArray(entry.images) && entry.images.some(img => img && img.src)) {
            _imageEntryIds.push(b.tool_use_id);
          }
        }
      }
    }
  }
  _enforceImageBudget(state);
}

/**
 * SubAgent / Teammate 渲染入口:组合本地 cachedBuildToolResultMap 与全局索引。
 * globalIndex 由调用方一次性构建(buildGlobalToolResultIndex),所有 entry 共享,
 * 渲染查询 O(1)。
 *
 * 补偿仅覆盖 toolResultMap;readContentMap / editSnapshotMap / latestPlanContent
 * 等辅助 map 不在补偿范围内 —— SubAgent 卡片只渲染 response.content 块,Read snapshot
 * 等高级展开由 mainAgent 路径消费,与 SubAgent 解耦。
 */
export function buildSubAgentResultMap(req, globalIndex) {
  const localState = cachedBuildToolResultMap(req?.body?.messages || EMPTY_MESSAGES);
  const respContent = req?.response?.body?.content;
  if (!Array.isArray(respContent) || !globalIndex) {
    return localState.toolResultMap;
  }
  // filled lazy-alloc 为 null sentinel:无补偿时返回原引用,避免下游 ChatMessage memo 抖动。
  let filled = null;
  for (const b of respContent) {
    if (b?.type === 'tool_use' && b.id && !localState.toolResultMap[b.id] && globalIndex[b.id]) {
      if (!filled) filled = {};
      filled[b.id] = globalIndex[b.id];
    }
  }
  if (!filled) return localState.toolResultMap;
  return { ...localState.toolResultMap, ...filled };
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
          // ExitPlanMode V2: input 直接携带 plan + planFilePath（normalizeToolInput 注入）
          // 不依赖前置 Write/Edit，是 multi-agent-room 等无前置场景的核心数据源
          if (parsed.name === 'ExitPlanMode' && parsed.input && typeof parsed.input === 'object') {
            if (typeof parsed.input.plan === 'string' && parsed.input.plan.trim()) {
              state.latestPlanContent = parsed.input.plan;
              state._planDirty = (state._planDirty || 0) + 1;
            }
            if (typeof parsed.input.planFilePath === 'string' && parsed.input.planFilePath) {
              state.latestPlanFilePath = parsed.input.planFilePath;
            }
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
          const entry = buildSingleToolResult(block, matchedTool);
          const { resultText, isPermissionDenied, isUltraplan } = entry;
          toolResultMap[block.tool_use_id] = entry;
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
            // 被拒绝的 AskUserQuestion：分 cancelled / rejected 两类——
            //   - cancelled：cc-viewer 主动取消（Cancel 按钮 / 输入框打字打断）。
            //     ask-bridge.js / sdk-manager.js 注入 reason 时统一加 [cc-viewer:cancel] 前缀
            //     作为协议级 sentinel，前缀匹配比模糊文案匹配稳定（SDK 升级换文案不影响）。
            //   - rejected：schema 校验失败 / hook deny 等"未触达"语义。
            //   ChatMessage 用这两个 sentinel 区分渲染（cancelled 显式带 __cancelReason__ 灰态）。
            if (Object.keys(parsed).length === 0 && isPermissionDenied) {
              const looksCancelled = /\[cc-viewer:cancel\]/.test(resultText);
              if (looksCancelled) {
                // 截掉 [cc-viewer:cancel] 前缀只显示用户可读 reason，再 slice 200 防超长
                const cleanedReason = resultText.replace(/^\s*\[cc-viewer:cancel\]\s*/, '').slice(0, 200);
                askAnswerMap[block.tool_use_id] = { __cancelled__: true, __cancelReason__: cleanedReason };
              } else {
                askAnswerMap[block.tool_use_id] = { __rejected__: true };
              }
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
            // Plan 审批完成（approved/rejected）后无条件重置 latestPlanContent / latestPlanFilePath，
            // 防止下一个 plan 周期显示旧内容。已审批卡片的 V2 plan 渲染由 ChatMessage 的
            // approval.planContent || inp.plan || planFileContents 兜底链承担，不依赖 latestPlanContent。
            state.latestPlanContent = null;
            state.latestPlanFilePath = null;
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
    // Heading may carry a suffix before the colon, e.g. "## Approved Plan (edited by user):"
    // (Claude Code CLI ≥2.1.201); [^\n]* keeps matching the plain "## Approved Plan:" form.
    const planMatch = text.match(/##\s*Approved Plan[^\n]*:\s*\n([\s\S]*)/i);
    return { status: 'approved', planContent: planMatch ? planMatch[1].trim() : '' };
  }
  if (/User rejected/i.test(text)) {
    const feedbackMatch = text.match(/feedback:\s*(.+)/i) || text.match(/User rejected[^:]*:\s*(.+)/i);
    return { status: 'rejected', feedback: feedbackMatch ? feedbackMatch[1].trim() : '' };
  }
  return { status: 'pending' };
}
