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

let _query;
try {
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  _query = sdk.query;
} catch (err) {
  console.warn('[SDK] Agent SDK not available:', err.message);
}

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
let _broadcastWs = null;

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
export function initSdkSession(cwd, projectName, { onEntry, onStreamingStatus, broadcastWs, permissionMode }) {
  _cwd = cwd;
  _projectName = projectName;
  _onEntry = onEntry;
  _onStreamingStatus = onStreamingStatus;
  _broadcastWs = broadcastWs;
  _permissionMode = permissionMode || 'default';
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
    if (_broadcastWs) {
      _broadcastWs({ type: 'sdk-plan-pending', id, input });
    }
    const result = await _waitForApproval(id, 5 * 60 * 1000);
    if (result === null) {
      return { behavior: 'deny', message: 'Timeout waiting for plan approval' };
    }
    if (typeof result === 'object' && result.approve === false) {
      return { behavior: 'deny', message: result.feedback || 'User rejected the plan' };
    }
    return { behavior: 'allow', updatedInput: input };
  }

  if (toolName === 'AskUserQuestion') {
    if (_broadcastWs) {
      _broadcastWs({ type: 'sdk-ask-pending', id, questions: input.questions });
    }
    const answers = await _waitForApproval(id, 5 * 60 * 1000);
    if (answers === null) {
      return { behavior: 'deny', message: 'Timeout waiting for user answer' };
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
  if (_broadcastWs) {
    _broadcastWs({ type: 'perm-hook-pending', id, toolName, input });
  }

  const result = await _waitForApproval(id, 5 * 60 * 1000);
  if (result === null) {
    return { behavior: 'deny', message: 'Timeout waiting for user approval' };
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

function _waitForApproval(id, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      _pendingApprovals.delete(id);
      resolve(null);
    }, timeoutMs);
    _pendingApprovals.set(id, {
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
