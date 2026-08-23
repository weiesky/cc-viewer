/**
 * sdk-manager.js — Agent SDK session lifecycle manager.
 *
 * Wraps @anthropic-ai/claude-agent-sdk query() to provide:
 * - User-message input and multi-turn conversation via session resume
 * - canUseTool callback for AskUserQuestion + permission approval
 * - Turn-end signaling (SDK 'result' message → Stop-hook equivalent)
 *
 * Display/persistence is NOT synthesized here: the SDK child process talks to
 * the Anthropic API through cc-viewer's loopback proxy (ANTHROPIC_BASE_URL is
 * injected via options.env + options.settings), so request/response capture,
 * streaming typewriter chunks, and v2 storage all flow through the exact same
 * wire path as PTY mode (proxy → fetch hook → V2Writer → SSE).
 */

import { ASK_TIMEOUT_MS } from './ask/ask-constants.js';
import { withDefaultThinkingDisplay, resolveLaunchSystemPrompt, launchArgsToExtraArgs } from './launch-config.js';
import { evaluateImDeny } from './im-deny.js';
import { APPROVAL_TOOLS, isPublishCommand } from './approval-policy.js';

let _query;
try {
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  _query = sdk.query;
} catch (err) {
  console.warn('[SDK] Agent SDK not available:', err.message);
}

// Test seam — inject a fake query() (following im-bridge-core.js's __setFetchForTests
// convention). Only lets unit tests inject a fake async-generator; no business logic changes.
export function __setQueryForTests(fn) { _query = fn; }

// Session state
let _sessionId = null;
let _cwd = null;
let _permissionMode = 'default';
let _childEnv = null;      // env handed to the SDK child (proxy injection etc.)
let _settings = null;      // merged Settings object for options.settings
let _launchModel = null;   // --model lifted from user args (options.model)
let _launchResume = null;  // startup continuation intent { continue, resumeId, forkSession } — first query only
let _userArgs = [];        // remaining user args → options.extraArgs passthrough
let _claudeExecutable = null; // pathToClaudeCodeExecutable — resolved with the same priority as PTY mode (configured → codefuse → native → PATH → npm) so SDK sessions don't fall back to a PATH claude that host security policy may kill on headless spawn
let _activeQuery = null;
let _queryBusy = false; // concurrency guard
let _initAnnouncedSid = ''; // sessionId whose slash-command surface was already announced (reset on full reset)
let _lastInitSnapshot = null; // last sdk-init payload for WS reconnect replay

// Callbacks registered by cli.js
let _onTurnEnd = null; // SDK mode has no Stop hook (ensureHooks() skipped) — fire turnEnd directly when the SDK 'result' message arrives
let _onQueryError = null; // query-level failure → (message: string) => void; cli.js forwards to a WS toast
let _broadcastWs = null;
let _runWaterfallHook = null;

// Display/persistence flows through the SAME wire path as PTY mode: the SDK child's API
// traffic reaches ccv's loopback proxy (verified — the injected ANTHROPIC_BASE_URL survives
// in the spawn env), the main-process fetch hook captures it, and `_v2Writer` writes the v2
// transcript that both panels + SSE read. The SDK channel here only carries what the wire
// path can't see: turn-end (no Stop hook in SDK mode), turn-level error toasts, the
// sdk-init/sdk-compact lifecycle metadata, and canUseTool approvals. It deliberately does
// NOT persist conversation content or drive streaming/typewriter — those are wire-owned.

// Pending canUseTool promises: id → { kind, resolve, replay, startedAt, timeoutMs }
// replay is the exact broadcast payload that announced this approval — retained so a
// fresh WS connection can re-announce it (server.js connection replay), otherwise a
// reconnect mid-approval orphans the modal and the wait silently times out to deny.
const _pendingApprovals = new Map();

// Message queue for messages sent while a query is running. Items are { id, text, ts } —
// the id lets web clients act on individual queued bubbles (send-now / remove) and the
// queue-state WS broadcast keeps every client in sync (server is the source of truth).
let _messageQueue = [];
// Stop semantics (product decision): Stop parks the queue instead of dropping it —
// interruptTurn sets this flag so sendUserMessage's drain loop exits without running the
// parked items; cleared when a fresh user message / send-now starts a new turn.
let _suppressDrain = false;

export function isSdkAvailable() {
  return typeof _query === 'function';
}

/**
 * Initialize SDK session.
 * Does NOT start a query — waits for the first user message via sendUserMessage().
 *
 * @param {string} cwd
 * @param {string} projectName
 * @param {object} deps
 * @param {function} deps.onTurnEnd — ({sessionId, ts}) => void, fired on SDK 'result'
 * @param {function} [deps.onQueryError] — (message: string) => void, fired when the
 *   query itself fails (spawn/protocol/iterator errors) — until this existed the only
 *   surfacing was console.error, invisible in the Web UI
 * @param {function} deps.broadcastWs — (msg) => void, terminal-WS broadcast for approvals
 * @param {string} [deps.permissionMode]
 * @param {function} [deps.runWaterfallHook] — plugin waterfall (onPlanRequest/onAskRequest/onPermRequest)
 * @param {object} [deps.env] — child env (must already contain ANTHROPIC_BASE_URL → ccv proxy)
 * @param {object} [deps.settings] — merged Settings object (env.ANTHROPIC_BASE_URL double-injection)
 * @param {string} [deps.model] — --model lifted from user args (options.model)
 * @param {object} [deps.launchResume] — startup continuation { continue, resumeId, forkSession }
 * @param {string[]} [deps.userArgs] — remaining user args (extraArgs passthrough)
 * @param {string} [deps.claudeExecutable] — resolved claude binary (options.pathToClaudeCodeExecutable);
 *   must come from the same selection as PTY mode, else the SDK spawns a PATH claude that
 *   host security tooling (e.g. agent-security headless guards) may SIGKILL on spawn
 */
export function initSdkSession(cwd, projectName, { onTurnEnd, onQueryError, broadcastWs, permissionMode, runWaterfallHook, env, settings, model, launchResume, userArgs, claudeExecutable }) {
  _cwd = cwd;
  void projectName; // reserved (display name comes from the wire path)
  _onTurnEnd = onTurnEnd;
  _onQueryError = onQueryError || null;
  _broadcastWs = broadcastWs;
  _permissionMode = permissionMode || 'default';
  _runWaterfallHook = runWaterfallHook || null;
  _childEnv = env || null;
  _settings = settings || null;
  _launchModel = model || null;
  _launchResume = launchResume || null;
  _userArgs = Array.isArray(userArgs) ? userArgs : [];
  _claudeExecutable = claudeExecutable || null;
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
    _messageQueue.push(_makeQueueItem(text));
    _broadcastQueueState();
    return;
  }

  _queryBusy = true;
  // A fresh user-initiated turn re-arms automatic draining of parked (Stop-kept) items.
  _suppressDrain = false;

  try {
    await _executeQuery(text);

    // Process any queued messages
    while (_messageQueue.length > 0 && !_suppressDrain) {
      const next = _messageQueue.shift();
      _broadcastQueueState();
      await _executeQuery(next.text);
    }
  } finally {
    _queryBusy = false;
  }
}

function _makeQueueItem(text) {
  return {
    id: 'q_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
    text,
    ts: Date.now(),
  };
}

/** Broadcast the queue snapshot to all terminal-WS clients (drives the floating bubbles). */
function _broadcastQueueState() {
  if (!_broadcastWs) return;
  try {
    _broadcastWs({ type: 'queue-state', items: _messageQueue.map(({ id, text, ts }) => ({ id, text, ts })) });
  } catch (err) { console.warn('[sdk-manager] queue-state broadcast threw:', err?.message); }
}

/**
 * Execute a single query for one user message.
 */
async function _executeQuery(text) {
  const options = {
    cwd: _cwd,
    permissionMode: _permissionMode,
    // canUseTool is mounted in EVERY mode (including bypassPermissions) so the
    // npm-publish hard gate survives --d, mirroring perm-bridge.js's bypass
    // exemption. In bypass mode the callback early-allows everything except
    // publish commands and the two interactive tools (see _handleCanUseTool).
    canUseTool: _handleCanUseTool,
    ..._permissionMode === 'bypassPermissions' && { allowDangerouslySkipPermissions: true },
  };
  // env carries the loopback-proxy base URL — the SDK passes it through to the
  // spawned CLI verbatim (verified against sdk.mjs: env defaults to process.env
  // and is only ever added to, never filtered).
  if (_childEnv) options.env = _childEnv;
  if (_settings) options.settings = _settings;
  if (_launchModel) options.model = _launchModel;
  // Same executable priority as PTY mode — without this the SDK resolves claude from
  // PATH, which on guarded hosts picks a binary that gets SIGKILLed on headless spawn.
  if (_claudeExecutable) options.pathToClaudeCodeExecutable = _claudeExecutable;

  // Resume semantics: mid-session turns resume the captured session id; the FIRST
  // query of a startup-continuation launch (-c/-r/--fork-session) uses the launch intent.
  let resumeIntent = null;
  if (_sessionId) {
    options.resume = _sessionId;
    resumeIntent = { resumeValue: _sessionId, picker: false, fork: false };
  } else if (_launchResume) {
    if (_launchResume.resumeId) options.resume = _launchResume.resumeId;
    else if (_launchResume.continue) options.continue = true;
    if (_launchResume.forkSession) options.forkSession = true;
    resumeIntent = { resumeValue: _launchResume.resumeId ?? null, picker: false, fork: !!_launchResume.forkSession };
  }

  // System-prompt injection, byte-identical to the PTY link (shared pipeline in
  // lib/launch-config.js): fresh launch → sentinel/model-matched files (rendered);
  // resume turn → pinned snapshot bytes (never re-rendered). Resume-turn pendings are
  // NOT persisted — their only consumer (SessionStart-hook Bind B) is dormant in SDK mode.
  // Injection failure must never block the query (PTY parity: PR#128 fallback).
  const launchArgs = process.env.CCV_SKIP_THINKING_DISPLAY === '1' ? _userArgs : withDefaultThinkingDisplay(_userArgs);
  try {
    const lc = resolveLaunchSystemPrompt({
      spawnDir: _cwd,
      extraArgs: launchArgs,
      env: _childEnv || process.env,
      launchSettings: _settings,
      resume: resumeIntent,
      persistPending: !resumeIntent,
    });
    options.extraArgs = launchArgsToExtraArgs([...launchArgs, ...lc.sysPrompt.args]);
  } catch (err) {
    console.warn('[SDK] launch system-prompt resolution failed, querying without injected prompt:', err?.message || err);
    options.extraArgs = launchArgsToExtraArgs(launchArgs);
  }

  try {
    _activeQuery = _query({ prompt: text, options });

    for await (const msg of _activeQuery) {
      _processMessage(msg);
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('[SDK] Query error:', err.message);
      // Surface query-level failures to the Web UI — console.error is invisible there
      // (a dead query otherwise looks exactly like a hung one). Callback throw must
      // never mask the original error or break the finally cleanup.
      if (_onQueryError) {
        try { _onQueryError(String(err?.message || err)); }
        catch (cbErr) { console.warn('[sdk-manager] onQueryError threw:', cbErr?.message); }
      }
    }
  } finally {
    _activeQuery = null;
  }
}

/**
 * Process a single SDK message. Display/persistence flows through the wire path
 * (proxy → fetch hook → v2 transcript), same as PTY mode — here we only track session
 * continuity, fire turn-end on 'result', surface turn errors, and broadcast the
 * SDK-only lifecycle metadata (sdk-init / sdk-compact) the wire path never sees.
 */
function _processMessage(msg) {
  switch (msg.type) {
    case 'system':
      if (msg.session_id) _sessionId = msg.session_id;
      // Init carries the session's slash-command surface (no TUI `/` help in a
      // headless session); compact_boundary is an SDK-only event (no wire delta)
      // — broadcast both so clients see the same lifecycle cues PTY users get.
      if (msg.subtype === 'init' && _broadcastWs
        && Array.isArray(msg.slash_commands) && msg.slash_commands.length > 0
        && msg.session_id !== _initAnnouncedSid) {
        _initAnnouncedSid = msg.session_id;
        _lastInitSnapshot = {
          type: 'sdk-init',
          sessionId: msg.session_id,
          model: msg.model,
          slashCommands: msg.slash_commands,
          tools: msg.tools,
        };
        _broadcastWs(_lastInitSnapshot);
      } else if (msg.subtype === 'compact_boundary' && _broadcastWs) {
        const meta = msg.compact_metadata;
        _broadcastWs({
          type: 'sdk-compact',
          trigger: meta && meta.trigger,
          preTokens: meta && meta.pre_tokens,
          postTokens: meta && meta.post_tokens,
        });
      }
      break;

    case 'user':
    case 'assistant':
      // Conversation content is persisted by the wire path (proxy → fetch hook → v2),
      // not here — the SDK child's API traffic reaches ccv's proxy and is captured with
      // full fidelity (real user prompts + tool calls), so accumulating it again would
      // double-write. Here we only track session continuity.
      if (msg.session_id) _sessionId = msg.session_id;
      break;

    case 'result':
      if (msg.session_id) _sessionId = msg.session_id;
      _notifyTurnError(msg);
      // SDK turn-end signal. Equivalent to Claude Code's Stop hook
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
 * Surface a failed turn to the Web UI — the wire path persists the failed entry but
 * never pushes a toast, so a dead/errored turn would otherwise look like a hang.
 */
function _notifyTurnError(resultMsg) {
  const isError = resultMsg.is_error === true || (resultMsg.subtype && resultMsg.subtype !== 'success');
  if (!isError) return;
  const errs = Array.isArray(resultMsg.errors) && resultMsg.errors.length
    ? resultMsg.errors.join('; ')
    : (typeof resultMsg.result === 'string' && resultMsg.result) || resultMsg.subtype || 'unknown error';
  if (_broadcastWs) {
    try { _broadcastWs({ type: 'sdk-error', message: String(errs) }); } catch (err) { console.warn('[sdk-manager] sdk-error broadcast threw:', err?.message); }
  }
}

/**
 * canUseTool callback — handles AskUserQuestion + permission approval.
 *
 * Check order mirrors perm-bridge.js precedence:
 *   1. IM hard deny (CCV_IM_DENY=1 only) — beats everything, including the
 *      publish force-approval below (an IM worker gets a hard deny, not a modal);
 *   2. npm-publish hard gate — forced through the perm approval branch even in
 *      bypassPermissions mode (perm-bridge.js's bypass exemption equivalent);
 *   3. bypass early-allow — bypass auto-approves everything else, but NEVER
 *      short-circuits the ExitPlanMode/AskUserQuestion interactive branches;
 *   4. the three regular branches (plan / ask / perm).
 */
async function _handleCanUseTool(toolName, input, options) {
  const id = options?.toolUseID || `sdk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // 1. IM worker hard deny — must run before any auto-allow (perm-bridge.js parity).
  if (process.env.CCV_IM_DENY === '1') {
    const verdict = evaluateImDeny(toolName, input);
    if (verdict.deny) {
      return { behavior: 'deny', message: `cc-viewer IM guard: ${verdict.reason}` };
    }
  }

  // 2. npm publish is never auto-allowed, even under --d (safety floor).
  const isPublish = isPublishCommand(toolName, input);

  // 3. Bypass mode auto-approves everything except publish and the two
  // interactive tools — those keep their UI channels so a forwarded
  // ExitPlanMode/AskUserQuestion still reaches the user.
  if (_permissionMode === 'bypassPermissions' && !isPublish
    && toolName !== 'ExitPlanMode' && toolName !== 'AskUserQuestion') {
    return { behavior: 'allow', updatedInput: input };
  }

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
    const planPayload = { type: 'sdk-plan-pending', id, input };
    if (_broadcastWs) {
      _broadcastWs(planPayload);
    }
    const result = await _waitForApproval(id, 5 * 60 * 1000, 'plan', planPayload);
    if (result === null) {
      return { behavior: 'deny', message: 'Timeout waiting for plan approval' };
    }
    // cancel sentinel guard: cancelApproval shares the _pendingApprovals Map; if an
    // ask-cancel collides with a plan id (the kind tag already guards this, but the sentinel
    // guard is kept as defensive depth), it must not fall through to allow.
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
    // 24h — same source as the hook path (server.js ASK_HOOK_TIMEOUT_MS), honoring the
    // "GUI effectively has no timeout" promise. The actual constant lives in
    // server/lib/ask/ask-constants.js.
    const askTimeoutMs = ASK_TIMEOUT_MS;
    const askStartedAt = Date.now();
    const askPayload = { type: 'sdk-ask-pending', id, questions: input.questions, startedAt: askStartedAt, timeoutMs: askTimeoutMs };
    if (_broadcastWs) {
      _broadcastWs(askPayload);
    }
    const answers = await _waitForApproval(id, askTimeoutMs, 'ask', askPayload);
    if (answers === null) {
      return { behavior: 'deny', message: 'Timeout waiting for user answer' };
    }
    // cancel sentinel: the { __cancelled__: true, reason } injected by cancelApproval via
    // _waitForApproval. Equivalent to terminal Claude Code's onAbort path — the SDK package
    // turns this deny into tool_result.is_error=true before injecting it into the
    // transcript, so the next request's transcript closes and the session does not wedge.
    // The [cc-viewer:cancel] prefix is a protocol-level sentinel — toolResultBuilder.js uses
    // prefix matching to tell cancelled vs rejected apart.
    if (answers && typeof answers === 'object' && answers.__cancelled__ === true) {
      return { behavior: 'deny', message: '[cc-viewer:cancel] ' + (answers.reason || 'User aborted') };
    }
    return { behavior: 'allow', updatedInput: { questions: input.questions, answers } };
  }

  // Tools that need explicit user approval via Web UI (mutating or external access).
  // The six-tool set is shared with the PTY perm-bridge via approval-policy.js.
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
  const permPayload = { type: 'perm-hook-pending', id, toolName, input };
  if (_broadcastWs) {
    _broadcastWs(permPayload);
  }

  const result = await _waitForApproval(id, 5 * 60 * 1000, 'perm', permPayload);
  if (result === null) {
    return { behavior: 'deny', message: 'Timeout waiting for user approval' };
  }
  // cancel sentinel guard: same as the plan branch — prevents a cancelApproval colliding
  // with a perm id from wrongly allowing
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

function _waitForApproval(id, timeoutMs, kind, replay = null) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      _pendingApprovals.delete(id);
      resolve(null);
    }, timeoutMs);
    _pendingApprovals.set(id, {
      kind,  // 'ask' | 'plan' | 'perm' — lets cancelApproval distinguish types so an
      // ask-cancel does not collide with a plan/perm id
      replay,  // exact broadcast payload announced to clients — replayed to a fresh WS connection
      startedAt: Date.now(),
      timeoutMs,
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
 * Snapshot of pending approvals for WS-reconnect replay (server.js connection
 * handler). Returns [ { id, kind, replay, startedAt, timeoutMs } ] with remaining
 * time computed at call time; entries already past their timeout are excluded.
 * The resolve closures are deliberately not exposed.
 */
export function getPendingApprovals() {
  const now = Date.now();
  const out = [];
  for (const [id, p] of _pendingApprovals) {
    const remaining = (p.timeoutMs ?? 0) - (now - (p.startedAt ?? now));
    if (remaining <= 0) continue;
    out.push({ id, kind: p.kind || null, replay: p.replay || null, remainingMs: remaining });
  }
  return out;
}

/**
 * Cancel a pending canUseTool approval — used by ask-cancel WS handler
 * (user clicked Cancel button or typed-interrupt in input bar).
 *
 * Not equivalent to resolveApproval(id, null): null already occupies the timeout semantics
 * in _waitForApproval. Here we resolve a { __cancelled__: true, reason } sentinel so
 * canUseTool takes the deny branch rather than allow (see the _handleCanUseTool
 * AskUserQuestion block).
 *
 * kind check: the ask-cancel protocol only applies to ask-type approvals. Colliding with a
 * plan / perm id returns false and is not handled — so a cancel-ask signal cannot be
 * mistaken for "the user rejected the plan", which would write a wrong reason into the
 * model context.
 *
 * Shares the same _pendingApprovals Map and the same first-wins atomic guard
 * (pending.resolve clearTimeout + delete) as resolveApproval, so a cancel racing an answer
 * is a no-op for whichever arrives second.
 */
export function cancelApproval(id, reason) {
  const pending = _pendingApprovals.get(id);
  if (!pending) return false;
  if (pending.kind && pending.kind !== 'ask') return false;
  pending.resolve({ __cancelled__: true, reason: typeof reason === 'string' ? reason : 'User aborted' });
  return true;
}

/**
 * Shared interrupt core: cancel in-flight approvals (else their canUseTool promises stay
 * parked and the timeout timers leak, and clients keep a ghost approval modal open) and
 * close the active query iterator. `_executeQuery`'s finally block then nulls
 * `_activeQuery`; `sendUserMessage`'s finally clears `_queryBusy`.
 *
 * Returns the list of approvals that were pending (`[{ id, kind }]`) so the caller
 * (server.js) can broadcast modal-close messages to every client. Always an array.
 */
function _interruptActiveQuery() {
  const cancelled = Array.from(_pendingApprovals, ([id, pending]) => ({ id, kind: pending.kind || null }));
  for (const { id } of cancelled) {
    _pendingApprovals.get(id)?.resolve(null);
  }
  _pendingApprovals.clear();

  if (_activeQuery) {
    // Best-effort streaming-mode control request (no-op / rejects in single-prompt mode → swallow).
    try { _activeQuery.interrupt?.().catch(() => {}); } catch {}
    // Forcefully terminate the underlying CLI subprocess — aborts an in-flight query.
    try { if (typeof _activeQuery.close === 'function') _activeQuery.close(); } catch {}
  }
  return cancelled;
}

/**
 * Interrupt the current turn (user clicked the Stop button) while KEEPING the
 * session alive so the next message resumes the same conversation.
 *
 * Crucially we do NOT call `_resetFullState()`, so `_sessionId` is preserved
 * and the next sendUserMessage resumes via `options.resume`.
 *
 * Contrast with `stopSession()` below, which is the hard process-exit cleanup
 * that also nulls `_sessionId` (loses conversation continuity).
 *
 * Stop KEEPS queued messages (product decision, matching the web UX where queued bubbles
 * stay parked after Stop): `_suppressDrain` stops sendUserMessage's drain loop from running
 * them right after the interrupt; the park lifts when a fresh user message / send-now
 * starts a new turn. The queue-state broadcast lets clients keep their bubbles.
 *
 * Returns the list of approvals that were pending at interrupt time
 * (`[{ id, kind }]`) so the caller (server.js) can broadcast modal-close
 * messages to every client. Always an array (empty when nothing was pending).
 */
export function interruptTurn() {
  const cancelled = _interruptActiveQuery();
  _suppressDrain = true;
  _broadcastQueueState();
  return cancelled;
}

/**
 * Send-now on a queued bubble: interrupt the running turn and make this message the next
 * one executed. Unlike Stop, this does NOT suppress draining — the in-flight
 * sendUserMessage loop picks the prioritized item up as soon as the abort settles
 * (JS single-threading: the splice+unshift below is synchronous, so the drain's next
 * iteration always sees it at the head).
 *
 * When no turn is running (parked queue after Stop), the message is executed immediately
 * as a fresh turn.
 *
 * Known semantic: if the FIRST turn is interrupted before its system/init message was
 * processed, `_sessionId` is still null and the prioritized message starts a fresh session
 * (the aborted first turn is not resumable) — same as Stop-then-send on turn one.
 *
 * Returns the cancelled-approvals list (same shape as interruptTurn) so server.js can
 * close approval modals on all clients.
 */
export function sendQueuedNow(id) {
  const idx = _messageQueue.findIndex((it) => it.id === id);
  if (idx < 0) return []; // unknown / already dispatched — no-op BEFORE any interrupt
  const [item] = _messageQueue.splice(idx, 1);
  // Send-now ALWAYS means "run this now" — lift a Stop-park even when the aborted turn's
  // unwind is still in flight (_queryBusy still true). Without this, the drain loop's
  // `!_suppressDrain` condition would exit with the item already spliced out → silent loss.
  _suppressDrain = false;

  if (!_queryBusy) {
    // Parked queue, idle session: run it now (broadcast happens via the drain path —
    // here we broadcast explicitly since the item left the queue).
    _broadcastQueueState();
    // Fire-and-forget matches sendUserMessage's existing call sites (WS handler does not await).
    sendUserMessage(item.text).catch((err) => console.warn('[sdk-manager] send-now query failed:', err?.message));
    return [];
  }

  _messageQueue.unshift(item);
  const cancelled = _interruptActiveQuery();
  _broadcastQueueState();
  return cancelled;
}

/** Remove one queued message (bubble ×). Returns true when found. */
export function removeQueued(id) {
  const idx = _messageQueue.findIndex((it) => it.id === id);
  if (idx < 0) return false;
  _messageQueue.splice(idx, 1);
  _broadcastQueueState();
  return true;
}

/** Drop all queued messages WITHOUT touching the running turn (session switch). */
export function clearQueued() {
  if (_messageQueue.length === 0) return;
  _messageQueue = [];
  _broadcastQueueState();
}

/** Queue snapshot for WS-reconnect replay (same pattern as getSdkInitSnapshot). */
export function getQueueSnapshot() {
  return _messageQueue.map(({ id, text, ts }) => ({ id, text, ts }));
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
  _queryBusy = false;
  _initAnnouncedSid = '';
  _lastInitSnapshot = null;
  const hadQueued = _messageQueue.length > 0;
  _messageQueue = [];
  _suppressDrain = false;
  // Only broadcast on an actual change — initSdkSession calls this before any client cares,
  // and an empty-to-empty broadcast would just be noise on the wire.
  if (hadQueued) _broadcastQueueState();
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

/**
 * Get the last sdk-init snapshot for WS reconnect replay.
 * Returns null if no init has been announced yet (e.g. session without slash commands).
 */
export function getSdkInitSnapshot() {
  return _lastInitSnapshot;
}
