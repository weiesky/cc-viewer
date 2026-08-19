/**
 * sdk-manager.js — Agent SDK session lifecycle manager.
 *
 * Wraps @anthropic-ai/claude-agent-sdk query() to provide:
 * - Structured message processing → JSONL entries for the frontend
 * - canUseTool callback for AskUserQuestion + permission approval
 * - Streaming status tracking
 * - Multi-turn conversation via session resume
 */

import { sdkToJSONLEntry, buildStreamingStatus } from './sdk-adapter.js';
import { ASK_TIMEOUT_MS } from './ask-constants.js';

let _query;
try {
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  _query = sdk.query;
} catch (err) {
  console.warn('[SDK] Agent SDK not available:', err.message);
}

// Test seam — inject a fake query() (仿 im-bridge-core.js 的 __setFetchForTests 惯例).
// 仅供单测注入 fake async-generator，不改任何业务逻辑。
export function __setQueryForTests(fn) { _query = fn; }

// Interactive tool names — filtered from entries, handled via canUseTool → WS
const INTERACTIVE_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);

// Session state
let _sessionId = null;
let _model = null;
let _cwd = null;
let _projectName = null;
let _permissionMode = 'default';
let _accumulatedMessages = [];
let _activeQuery = null;
let _queryBusy = false; // concurrency guard
let _sdkTools = null;    // real tools list from SDKSystemMessage

// Stable timestamp per conversation turn — used as dedup key by frontend
let _turnTimestamp = null;

// Streaming accumulation state
let _streamingContent = [];
let _currentBlockData = null;
let _streamingRequestId = null;
let _streamThrottleTimer = null;

// Callbacks registered by server.js
let _onEntry = null;
let _onStreamingStatus = null;
let _onTurnEnd = null; // SDK mode has no Stop hook (ensureHooks() skipped) — fire turnEnd directly when the SDK 'result' message arrives
let _broadcastWs = null;
let _runWaterfallHook = null;

// Pending canUseTool promises: id → { resolve }
const _pendingApprovals = new Map();

// Message queue for messages sent while a query is running
let _messageQueue = [];

export function isSdkAvailable() {
  return typeof _query === 'function';
}

/**
 * Initialize SDK session.
 * Does NOT start a query — waits for the first user message via sendUserMessage().
 */
export function initSdkSession(cwd, projectName, { onEntry, onStreamingStatus, broadcastWs, permissionMode, runWaterfallHook, onTurnEnd }) {
  _cwd = cwd;
  _projectName = projectName;
  _onEntry = onEntry;
  _onStreamingStatus = onStreamingStatus;
  _onTurnEnd = onTurnEnd;
  _broadcastWs = broadcastWs;
  _permissionMode = permissionMode || 'default';
  _runWaterfallHook = runWaterfallHook || null;
  _resetFullState();
}

/**
 * Send a user message. Starts a new query (or resumes existing session).
 * Queues the message if a query is already running.
 */
export async function sendUserMessage(text) {
  if (!_query) throw new Error('Agent SDK not available');

  // If a query is already running, queue this message and return
  if (_queryBusy) {
    _messageQueue.push(text);
    return;
  }

  _queryBusy = true;

  try {
    await _executeQuery(text);

    // Process any queued messages
    while (_messageQueue.length > 0) {
      const next = _messageQueue.shift();
      await _executeQuery(next);
    }
  } finally {
    _queryBusy = false;
  }
}

/**
 * Execute a single query for one user message.
 */
async function _executeQuery(text) {
  // Generate stable timestamp for this turn — all entries share it for dedup
  _turnTimestamp = new Date().toISOString();
  _streamingRequestId = `sdk_${Date.now()}`;

  // Accumulate user message BEFORE creating entries (this is the request)
  _accumulatedMessages.push({ role: 'user', content: text });

  const options = {
    cwd: _cwd,
    includePartialMessages: true,
    permissionMode: _permissionMode,
    canUseTool: _permissionMode === 'bypassPermissions' ? undefined : _handleCanUseTool,
    ..._permissionMode === 'bypassPermissions' && { allowDangerouslySkipPermissions: true },
  };

  if (_sessionId) {
    options.resume = _sessionId;
  }

  if (_onStreamingStatus) _onStreamingStatus(buildStreamingStatus(true, { model: _model }));

  try {
    _activeQuery = _query({ prompt: text, options });

    for await (const msg of _activeQuery) {
      _processMessage(msg);
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('[SDK] Query error:', err.message);
    }
  } finally {
    _resetStreamingState();
    _activeQuery = null;
    if (_onStreamingStatus) _onStreamingStatus(buildStreamingStatus(false));
  }
}

/**
 * Process a single SDK message.
 */
function _processMessage(msg) {
  switch (msg.type) {
    case 'system':
      if (msg.session_id) _sessionId = msg.session_id;
      if (msg.model) _model = msg.model;
      // Capture real tools from init message (tools is string[], convert to {name} format)
      if (msg.subtype === 'init') {
        if (Array.isArray(msg.tools)) _sdkTools = msg.tools.map(name => ({ name }));
      }
      // Handle compact boundary: reset accumulated messages since SDK compacted internally
      if (msg.subtype === 'compact_boundary') {
        _accumulatedMessages = [];
      }
      break;

    case 'assistant':
      // Main agent message (not sub-agent)
      if (!msg.parent_tool_use_id && msg.message) {
        _resetStreamingState();

        // Snapshot messages BEFORE adding assistant (body.messages = request history, unfiltered)
        const requestMessages = [..._accumulatedMessages];

        // Accumulate the assistant response for future turns
        // Merge with previous if both are assistant (same API turn, multiple content blocks)
        const lastMsg = _accumulatedMessages[_accumulatedMessages.length - 1];
        if (lastMsg && lastMsg.role === 'assistant' && Array.isArray(lastMsg.content) && Array.isArray(msg.message.content)) {
          lastMsg.content = [...lastMsg.content, ...msg.message.content];
        } else {
          _accumulatedMessages.push({ role: 'assistant', content: msg.message.content });
        }

        // Only filter interactive tools from the RESPONSE content (Last Response rendering),
        // NOT from body.messages (history) — filtering history creates orphaned tool_results
        const filteredContent = _filterInteractiveContent(msg.message.content);
        const displayMsg = { ...msg, message: { ...msg.message, content: filteredContent } };

        // Convert to JSONL entry with stable turn timestamp and real SDK metadata
        const entry = sdkToJSONLEntry(displayMsg, requestMessages, _model, _projectName, {
          timestamp: _turnTimestamp,
          tools: _sdkTools,
        });
        if (_onEntry) _onEntry(entry);
      }
      if (msg.session_id) _sessionId = msg.session_id;
      break;

    case 'user':
      // Tool results from tool execution — accumulate (skip replays)
      if (msg.message && !msg.isReplay) {
        // Merge with previous if both are user (consecutive tool_results for same turn)
        const lastUserMsg = _accumulatedMessages[_accumulatedMessages.length - 1];
        if (lastUserMsg && lastUserMsg.role === 'user' && Array.isArray(lastUserMsg.content) && Array.isArray(msg.message.content)) {
          lastUserMsg.content = [...lastUserMsg.content, ...msg.message.content];
        } else {
          _accumulatedMessages.push({ role: 'user', content: msg.message.content });
        }
      }
      break;

    case 'stream_event':
      if (_onStreamingStatus) {
        _onStreamingStatus(buildStreamingStatus(true, { model: _model }));
      }
      if (!msg.parent_tool_use_id) {
        _processStreamEvent(msg.event);
      }
      break;

    case 'result':
      if (msg.session_id) _sessionId = msg.session_id;
      if (_onStreamingStatus) _onStreamingStatus(buildStreamingStatus(false));
      // SDK turn-end signal(). Equivalent to Claude Code's Stop hook
      // in CLI mode — fires once per user-prompt response when the whole chain
      // (assistant text + all tool calls + final reply) completes. SDK mode
      // doesn't go through ensureHooks() so this in-process callback is the
      // only way the renderer learns the turn is over.
      if (_onTurnEnd) {
        try { _onTurnEnd({ sessionId: _sessionId, ts: Date.now() }); }
        catch (err) { console.warn('[sdk-manager] onTurnEnd threw:', err?.message); }
      }
      break;

    default:
      break;
  }
}

/**
 * Filter interactive tool_use blocks from an array of content blocks.
 */
function _filterInteractiveContent(content) {
  return Array.isArray(content)
    ? content.filter(b => b.type !== 'tool_use' || !INTERACTIVE_TOOLS.has(b.name))
    : content;
}

/**
 * Process a single streaming event.
 * Accumulates content blocks and pushes throttled in-progress entries.
 */
function _processStreamEvent(event) {
  if (!event) return;
  const type = event.type;

  if (type === 'message_start') {
    _streamingContent = [];
    _currentBlockData = null;
  } else if (type === 'content_block_start') {
    const block = event.content_block;
    if (!block) return;
    if (block.type === 'text') {
      _currentBlockData = { type: 'text', text: block.text || '' };
    } else if (block.type === 'thinking') {
      _currentBlockData = { type: 'thinking', thinking: block.thinking || '' };
    } else if (block.type === 'tool_use') {
      if (INTERACTIVE_TOOLS.has(block.name)) {
        _currentBlockData = null;
      } else {
        _currentBlockData = { type: 'tool_use', id: block.id, name: block.name, input: {} };
      }
    } else {
      _currentBlockData = null;
    }
  } else if (type === 'content_block_delta') {
    const delta = event.delta;
    if (!delta || !_currentBlockData) return;
    if (delta.type === 'text_delta' && _currentBlockData.type === 'text') {
      _currentBlockData.text += delta.text || '';
      _pushStreamingEntry();
    } else if (delta.type === 'thinking_delta' && _currentBlockData.type === 'thinking') {
      _currentBlockData.thinking += delta.thinking || '';
    } else if (delta.type === 'input_json_delta' && _currentBlockData.type === 'tool_use') {
      if (!_currentBlockData._rawInput) _currentBlockData._rawInput = '';
      _currentBlockData._rawInput += delta.partial_json || '';
    }
  } else if (type === 'content_block_stop') {
    if (_currentBlockData) {
      if (_currentBlockData.type === 'tool_use' && _currentBlockData._rawInput) {
        try { _currentBlockData.input = JSON.parse(_currentBlockData._rawInput); } catch {}
        delete _currentBlockData._rawInput;
      }
      _streamingContent.push(_currentBlockData);
      _currentBlockData = null;
      _pushStreamingEntry();
    }
  } else if (type === 'message_stop') {
    _resetStreamingState();
  }
}

/**
 * Push a throttled in-progress entry with accumulated streaming content.
 */
function _pushStreamingEntry() {
  if (_streamThrottleTimer) return;
  _streamThrottleTimer = setTimeout(() => {
    _streamThrottleTimer = null;
    _flushStreamingEntry();
  }, 100);
}

function _flushStreamingEntry() {
  if (!_onEntry) return;
  const content = [..._streamingContent];
  if (_currentBlockData) {
    const clone = { ..._currentBlockData };
    if (clone._rawInput) delete clone._rawInput;
    content.push(clone);
  }
  if (content.length === 0) return;

  const syntheticMsg = {
    message: {
      id: _streamingRequestId,
      type: 'message',
      role: 'assistant',
      model: _model,
      content,
      stop_reason: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  };
  // Use the SAME stable turn timestamp so in-progress entries dedup with the final entry
  const entry = sdkToJSONLEntry(syntheticMsg, [..._accumulatedMessages], _model, _projectName, {
    inProgress: true,
    tools: _sdkTools,
    requestId: _streamingRequestId,
    timestamp: _turnTimestamp,
  });
  _onEntry(entry);
}

function _resetStreamingState() {
  _streamingContent = [];
  _currentBlockData = null;
  if (_streamThrottleTimer) {
    clearTimeout(_streamThrottleTimer);
    _streamThrottleTimer = null;
  }
}

/**
 * canUseTool callback — handles AskUserQuestion + permission approval.
 */
async function _handleCanUseTool(toolName, input, options) {
  const id = options?.toolUseID || `sdk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  if (toolName === 'ExitPlanMode') {
    if (_runWaterfallHook) {
      try {
        const hookResult = await _runWaterfallHook('onPlanRequest', { id, input, mode: 'sdk' });
        if (hookResult.approve !== undefined) {
          if (hookResult.approve === false) {
            return { behavior: 'deny', message: hookResult.feedback || 'Plugin rejected the plan' };
          }
          return { behavior: 'allow', updatedInput: input };
        }
      } catch {}
    }
    if (_broadcastWs) {
      _broadcastWs({ type: 'sdk-plan-pending', id, input });
    }
    const result = await _waitForApproval(id, 5 * 60 * 1000, 'plan');
    if (result === null) {
      return { behavior: 'deny', message: 'Timeout waiting for plan approval' };
    }
    // cancel sentinel guard：cancelApproval 共用 _pendingApprovals Map，
    // 若 ask-cancel 撞到 plan id（kind tag 已防住，但保留 sentinel guard 作为防御性兜底），
    // 不能 fall through 到 allow。
    if (result && typeof result === 'object' && result.__cancelled__ === true) {
      return { behavior: 'deny', message: result.reason || 'User aborted' };
    }
    if (typeof result === 'object' && result.approve === false) {
      return { behavior: 'deny', message: result.feedback || 'User rejected the plan' };
    }
    return { behavior: 'allow', updatedInput: input };
  }

  if (toolName === 'AskUserQuestion') {
    if (_runWaterfallHook) {
      try {
        const hookResult = await _runWaterfallHook('onAskRequest', { id, questions: input.questions, mode: 'sdk' });
        if (hookResult.answers) {
          return { behavior: 'allow', updatedInput: { questions: input.questions, answers: hookResult.answers } };
        }
      } catch {}
    }
    // 24h — 与 hook 路径（server.js ASK_HOOK_TIMEOUT_MS）同源，履行"GUI 实质无超时"承诺。
    // 实际常量定义在 server/lib/ask-constants.js。
    const askTimeoutMs = ASK_TIMEOUT_MS;
    const askStartedAt = Date.now();
    if (_broadcastWs) {
      _broadcastWs({ type: 'sdk-ask-pending', id, questions: input.questions, startedAt: askStartedAt, timeoutMs: askTimeoutMs });
    }
    const answers = await _waitForApproval(id, askTimeoutMs, 'ask');
    if (answers === null) {
      return { behavior: 'deny', message: 'Timeout waiting for user answer' };
    }
    // cancel sentinel：cancelApproval 经 _waitForApproval 注入的 { __cancelled__: true, reason }。
    // 等价 terminal Claude Code 的 onAbort 路径 — SDK 包会把这个 deny 配成 tool_result.is_error=true
    // 后注入 transcript，下一轮请求 transcript 闭合，会话不卡死。
    // 加 [cc-viewer:cancel] 前缀作为协议级 sentinel — toolResultBuilder.js 用前缀匹配区分
    // cancelled vs rejected。
    if (answers && typeof answers === 'object' && answers.__cancelled__ === true) {
      return { behavior: 'deny', message: '[cc-viewer:cancel] ' + (answers.reason || 'User aborted') };
    }
    return { behavior: 'allow', updatedInput: { questions: input.questions, answers } };
  }

  // Tools that need explicit user approval via Web UI (mutating or external access)
  const APPROVAL_TOOLS = new Set(['Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch']);
  if (!APPROVAL_TOOLS.has(toolName)) {
    return { behavior: 'allow', updatedInput: input };
  }

  // Permission approval for mutating tools
  const suggestions = options?.suggestions;
  if (_runWaterfallHook) {
    try {
      const hookResult = await _runWaterfallHook('onPermRequest', { id, toolName, input, mode: 'sdk' });
      if (hookResult.decision === 'allow') {
        const response = { behavior: 'allow', updatedInput: input };
        if (hookResult.allowSession && Array.isArray(suggestions) && suggestions.length > 0) {
          response.updatedPermissions = suggestions;
        }
        return response;
      }
      if (hookResult.decision === 'deny') {
        return { behavior: 'deny', message: 'Plugin denied' };
      }
      // unknown decision → fall through to normal approval flow
    } catch {}
  }
  if (_broadcastWs) {
    _broadcastWs({ type: 'perm-hook-pending', id, toolName, input });
  }

  const result = await _waitForApproval(id, 5 * 60 * 1000, 'perm');
  if (result === null) {
    return { behavior: 'deny', message: 'Timeout waiting for user approval' };
  }
  // cancel sentinel guard：同 plan 分支防 cancelApproval 撞 perm id 误 allow
  if (result && typeof result === 'object' && result.__cancelled__ === true) {
    return { behavior: 'deny', message: result.reason || 'User aborted' };
  }
  const decision = typeof result === 'object' ? result.decision : result;
  const allowSession = typeof result === 'object' && result.allowSession;
  if (decision === 'deny') {
    return { behavior: 'deny', message: 'User denied via cc-viewer' };
  }
  const response = { behavior: 'allow', updatedInput: input };
  if (allowSession && Array.isArray(suggestions) && suggestions.length > 0) {
    response.updatedPermissions = suggestions;
  }
  return response;
}

function _waitForApproval(id, timeoutMs, kind) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      _pendingApprovals.delete(id);
      resolve(null);
    }, timeoutMs);
    _pendingApprovals.set(id, {
      kind,  // 'ask' | 'plan' | 'perm' — 让 cancelApproval 区分类型，避免 ask-cancel 撞 plan/perm id
      resolve: (value) => {
        clearTimeout(timer);
        _pendingApprovals.delete(id);
        resolve(value);
      },
    });
  });
}

/**
 * Resolve a pending canUseTool approval.
 * Called by server.js when a WS message arrives.
 */
export function resolveApproval(id, value) {
  const pending = _pendingApprovals.get(id);
  if (pending) {
    pending.resolve(value);
    return true;
  }
  return false;
}

/**
 * Cancel a pending canUseTool approval — used by ask-cancel WS handler
 * (user clicked Cancel button or typed-interrupt in input bar).
 *
 * 不等价 resolveApproval(id, null)：null 在 _waitForApproval 已被 timeout 占用语义。
 * 这里 resolve 一个 { __cancelled__: true, reason } sentinel，让 canUseTool 走 deny 分支
 * 而非 allow（详见 _handleCanUseTool AskUserQuestion 块）。
 *
 * kind 校验：ask-cancel 协议只对 ask 类型生效。撞到 plan / perm id 时返 false 不处理 —
 * 避免取消 ask 的信号被误用成"用户拒绝 plan"，让模型上下文写错原因。
 *
 * 与 resolveApproval 共享同一 _pendingApprovals Map + 同一 first-wins atomic guard
 * （pending.resolve clearTimeout + delete），cancel 与 answer 并发时后到的会 no-op。
 */
export function cancelApproval(id, reason) {
  const pending = _pendingApprovals.get(id);
  if (!pending) return false;
  if (pending.kind && pending.kind !== 'ask') return false;
  pending.resolve({ __cancelled__: true, reason: typeof reason === 'string' ? reason : 'User aborted' });
  return true;
}

/**
 * Interrupt the current turn (user clicked the Stop button) while KEEPING the
 * session alive so the next message resumes the same conversation.
 *
 * Only closes the active query iterator — `_executeQuery`'s finally block then
 * runs `_resetStreamingState()`, nulls `_activeQuery`, and emits
 * `streaming_status{active:false}`; `sendUserMessage`'s finally clears
 * `_queryBusy`. Crucially we do NOT call `_resetFullState()`, so `_sessionId`
 * is preserved and the next sendUserMessage resumes via `options.resume`.
 *
 * Contrast with `stopSession()` below, which is the hard process-exit cleanup
 * that also nulls `_sessionId` (loses conversation continuity).
 *
 * Also drops any queued-but-not-yet-dispatched messages (`_messageQueue`): a Stop
 * must halt pending work, otherwise `sendUserMessage`'s drain loop would immediately
 * run the next queued message right after the interrupt (e.g. a second client queued
 * a message while turn 1 streamed). Session continuity is unaffected — the queue only
 * holds not-yet-started turns.
 *
 * Returns the list of approvals that were pending at interrupt time
 * (`[{ id, kind }]`) so the caller (server.js) can broadcast modal-close
 * messages to every client. Always an array (empty when nothing was pending).
 */
export function interruptTurn() {
  // Drain any in-flight approval BEFORE closing the query: otherwise its canUseTool
  // promise stays parked and its timeout timer (24h ask / 5min plan-perm) leaks until
  // expiry, and clients keep a ghost approval modal open. Mirrors _resetFullState's
  // approval cleanup (resolve(null) → canUseTool denies; harmless since we're closing).
  const cancelled = Array.from(_pendingApprovals, ([id, pending]) => ({ id, kind: pending.kind || null }));
  for (const { id } of cancelled) {
    _pendingApprovals.get(id)?.resolve(null);
  }
  _pendingApprovals.clear();

  // Drop queued (not-yet-dispatched) messages so Stop actually halts pending work —
  // else sendUserMessage's `while (_messageQueue.length)` drain runs the next one.
  _messageQueue = [];

  if (_activeQuery) {
    // Best-effort streaming-mode control request (no-op / rejects in single-prompt mode → swallow).
    try { _activeQuery.interrupt?.().catch(() => {}); } catch {}
    // Forcefully terminate the underlying CLI subprocess — aborts an in-flight query.
    try { if (typeof _activeQuery.close === 'function') _activeQuery.close(); } catch {}
  }
  return cancelled;
}

/**
 * Stop the active SDK session.
 */
export function stopSession() {
  // Use close() instead of interrupt() — works in all modes
  if (_activeQuery && typeof _activeQuery.close === 'function') {
    _activeQuery.close();
  }
  _resetFullState();
}

/**
 * Reset all session state.
 */
function _resetFullState() {
  _activeQuery = null;
  _sessionId = null;
  _model = null;
  _sdkTools = null;
  _queryBusy = false;
  _accumulatedMessages = [];
  _turnTimestamp = null;
  _messageQueue = [];
  _resetStreamingState();
  _streamingRequestId = null;
  // Reject all pending approvals
  for (const [, pending] of _pendingApprovals) {
    pending.resolve(null);
  }
  _pendingApprovals.clear();
}

/**
 * Get current session ID (for resume).
 */
export function getSessionId() {
  return _sessionId;
}
