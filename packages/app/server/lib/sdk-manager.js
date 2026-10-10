/**
 * sdk-manager.js — Agent SDK session lifecycle manager.
 *
 * Wraps @anthropic-ai/claude-agent-sdk query() to provide:
 * - User-message input over a RESIDENT streaming-input query (one CLI child process
 *   per ccv session; turns are pushed as SDKUserMessages into a never-ending input
 *   queue). Resident mode unlocks the real control surface (interrupt() etc.) —
 *   single-prompt mode cannot interrupt and had to kill the child on every Stop.
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
import { reportSwallowed } from '@ccv/core/error-report';

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
// Resident-query state. `_activeQuery` (the Query handle) and `_queryBusy` (a turn in
// flight) are deliberately decoupled: an idle resident query is alive but not busy.
let _activeQuery = null;
let _inputQueue = null;   // push-queue AsyncIterable handed to query() as the prompt
let _queryBusy = false;   // a turn is in flight (including ensure + interrupt unwind)
let _switching = false;   // teardown window of switchToSession — rejects new turns/switches
let _pendingTurns = [];   // FIFO [{ resolve, interrupted, settled }] — one per pushed message
let _turnInFlight = false; // sticky "a pushed turn has not produced its result" flag —
                           // interruptTurn keys off this, NOT _pendingTurns.length (the
                           // grace/watchdog force-settle paths drain the FIFO while the
                           // CLI-side turn may still be running; without the sticky flag a
                           // second Stop would silently no-op).
let _settleGraceTimer = null; // backstop after interrupt: force-settle if no result arrives
let _lateResultTombstones = 0; // results to discard (already force-settled via grace/watchdog)
let _consecutiveDeaths = 0;   // backstop against respawn storms in a broken environment
let _turnWatchdog = null; // SILENCE watchdog: re-armed on every incoming message; fires only
                          // when the session produces nothing for the whole window
const INTERRUPT_GRACE_MS = 10 * 1000;
// Silence window for the watchdog. Must stay above the approval ceilings the turn can
// legally wait on: perm/plan = 5min, AskUserQuestion = 24h ("GUI effectively has no
// timeout" is a product contract). A pending approval exempts the turn from the
// watchdog entirely; 25min covers long tool runs (big builds) with headroom.
const TURN_WATCHDOG_MS = 25 * 60 * 1000;
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
  // Re-init (tests / hot reload) must not leave a zombie resident generation alive.
  _teardownResident();
  _resetFullState();
}

/**
 * Send a user message. Lazily constructs the resident query on the first message
 * (a startup-continuation launchResume applies to that first construction only).
 * Queues the message if a turn is already in flight (ccv's queue remains the single
 * source of truth — only one message is pushed to the SDK per turn boundary, so the
 * CLI's own command queue stays empty and Stop keeps its "park the bubbles" semantics).
 *
 * Never rejects for turn/session failures (those surface via onQueryError toasts);
 * the only throw is the synchronous "SDK not available" guard cli.js relies on.
 */
export async function sendUserMessage(text) {
  if (!_query) throw new Error('Agent SDK not available');

  // If a turn is already running, queue this message and return
  if (_queryBusy) {
    _messageQueue.push(_makeQueueItem(text));
    _broadcastQueueState();
    return;
  }

  // A fresh user-initiated turn re-arms automatic draining of parked (Stop-kept) items.
  _suppressDrain = false;
  _consecutiveDeaths = 0; // explicit user action re-arms the death-drain backstop
  await _startTurn(text);
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
 * Never-ending push queue used as the resident query's streaming input.
 * HARD INVARIANT: with canUseTool mounted, the SDK ends the child's stdin (killing
 * the session) when this iterable completes — close() is reserved for teardown, and
 * push() after close must silently drop (never throw: a throw would propagate into
 * the SDK's streamInput catch and abort the whole query).
 */
function _makePushQueue() {
  const items = [];
  let waiter = null;
  let closed = false;
  const q = {
    push(item) {
      if (closed) return; // teardown race — drop, never throw (see header comment)
      if (waiter) { const w = waiter; waiter = null; w({ value: item, done: false }); }
      else items.push(item);
    },
    close() {
      if (closed) return;
      closed = true;
      items.length = 0; // a dying generation must not leak its items into the next one
      if (waiter) { const w = waiter; waiter = null; w({ value: undefined, done: true }); }
    },
    isClosed() { return closed; },
    next() {
      if (items.length) return Promise.resolve({ value: items.shift(), done: false });
      // A closed queue keeps resolving done on EVERY call — the SDK's consumer stops
      // iterating after the first done, and a stale waiter must never capture a
      // future generation's message.
      if (closed) return Promise.resolve({ value: undefined, done: true });
      return new Promise((resolve) => { waiter = resolve; });
    },
    async return() { q.close(); return { value: undefined, done: true }; },
    [Symbol.asyncIterator]() { return this; },
  };
  return q;
}

function _userMessage(text) {
  return {
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] },
    parent_tool_use_id: null,
  };
}

// ── Turn records (FIFO pairing of pushed messages ↔ result messages) ──
// Every pushed user message eventually yields exactly one result from the CLI
// (an interrupted turn still synthesizes an error_during_execution result). All
// settle paths (result / grace force-settle / teardown settleAll) go through
// _settleTurn, which is idempotent via rec.settled.
function _beginTurn() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  const rec = { resolve, interrupted: false, settled: false };
  _pendingTurns.push(rec);
  return { rec, promise };
}

function _settleTurn(rec) {
  if (!rec || rec.settled) return;
  rec.settled = true;
  _clearGraceTimer();
  rec.resolve();
}

function _settleAllTurns() {
  for (const rec of _pendingTurns) _settleTurn(rec);
  _pendingTurns = [];
  _queryBusy = false;
  _turnInFlight = false;
  _clearTurnWatchdog();
}

function _clearGraceTimer() {
  if (_settleGraceTimer) { clearTimeout(_settleGraceTimer); _settleGraceTimer = null; }
}

/** Soft SILENCE watchdog: re-armed on every incoming SDK message, so it only fires
 * when the session has produced nothing for the full window — a genuinely stuck/dead
 * turn. Pending approvals prove the session is alive (the child is parked waiting for
 * our control response), so the watchdog merely re-arms in that case. Force-settle is
 * symmetric with the interrupt grace path: settle the head turn FIRST (its promise
 * must resolve), then tombstone the result that may still arrive. */
function _armTurnWatchdog() {
  _clearTurnWatchdog();
  if (_pendingTurns.length === 0) return;
  _turnWatchdog = setTimeout(() => {
    _turnWatchdog = null;
    if (_pendingTurns.length === 0) return;
    if (_pendingApprovals.size > 0) {
      _armTurnWatchdog(); // approval pending = alive; wait out the approval timeout instead
      return;
    }
    console.warn('[sdk-manager] turn silent beyond watchdog window — force-settling (possible silent session death)');
    _lateResultTombstones++;
    _settleAllTurns();
    _maybeDrain();
  }, TURN_WATCHDOG_MS);
  if (_turnWatchdog.unref) _turnWatchdog.unref();
}

function _clearTurnWatchdog() {
  if (_turnWatchdog) { clearTimeout(_turnWatchdog); _turnWatchdog = null; }
}

/**
 * Start one turn: park a turn record, ensure the resident query exists, push the
 * message. Resolves when the turn's result arrives (or on teardown/death settle).
 */
async function _startTurn(text) {
  const { rec, promise } = _beginTurn();
  _queryBusy = true;
  try {
    await _ensureResidentQuery();
  } catch (err) {
    // Construction itself failed (e.g. options assembly) — settle immediately.
    _pendingTurns = _pendingTurns.filter((r) => r !== rec);
    _settleTurn(rec);
    _queryBusy = false;
    _notifyQueryError(err);
    return promise;
  }
  // Teardown/stop raced with construction — the settle already happened; don't push.
  if (rec.settled) return promise;
  if (!_activeQuery || !_inputQueue) {
    _pendingTurns = _pendingTurns.filter((r) => r !== rec);
    _settleTurn(rec);
    _queryBusy = false;
    return promise;
  }
  _inputQueue.push(_userMessage(text));
  _turnInFlight = true;
  _armTurnWatchdog();
  return promise;
}

/**
 * Construct the resident query exactly once (no-op while one is alive). The first
 * construction consumes the startup continuation intent (_launchResume); later
 * reconstructions (after a session-level death) resume the captured _sessionId.
 */
async function _ensureResidentQuery() {
  if (_activeQuery) return;
  if (!_query) throw new Error('Agent SDK not available');

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

  // Resume semantics: a captured session id (mid-session reconstruction) resumes it;
  // the FIRST construction of a startup-continuation launch (-c/-r/--fork-session)
  // uses the launch intent. options.resume only takes effect at construction time —
  // switching sessions therefore means teardown + reconstruct (see switchToSession).
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

  const inputQueue = _makePushQueue();
  const query = _query({ prompt: inputQueue, options });
  _inputQueue = inputQueue;
  _activeQuery = query;
  // Background iteration — messages flow in for the life of the session. Its end
  // (clean or thrown) means the child process is gone: session-level death.
  _drainResidentIterator(query, inputQueue);
}

async function _drainResidentIterator(query, inputQueue) {
  try {
    for await (const msg of query) {
      // A message-processing failure (e.g. a broadcast callback throwing) must NOT be
      // mistaken for session death — the child is still alive; only the iterator's
      // end/throw is a death signal.
      try {
        _processMessage(msg);
      } catch (msgErr) {
        reportSwallowed('sdk-manager.process-message', msgErr);
      }
      _armTurnWatchdog(); // silence watchdog: any message proves the session is alive
    }
    _onResidentDeath(query, inputQueue, null);
  } catch (err) {
    _onResidentDeath(query, inputQueue, err);
  }
}

/**
 * Session-level death (iterator ended or threw). Stale generations (a query already
 * replaced by teardown/switch) are ignored. The message queue PARKS instead of
 * draining — the next explicit user message / send-now lazily reconstructs the
 * resident query (resuming _sessionId when one was captured).
 */
function _onResidentDeath(query, inputQueue, err) {
  if (_activeQuery !== query) return; // stale generation — teardown already moved on
  _activeQuery = null;
  _inputQueue = null;
  _clearGraceTimer();
  _clearTurnWatchdog();
  _lateResultTombstones = 0;
  if (err && err.name !== 'AbortError') {
    console.error('[SDK] Resident query error:', err.message);
    _notifyQueryError(err);
  }
  _settleAllTurns();
  // Flush pending approvals with a dismiss broadcast, else their modals hang forever.
  const pending = Array.from(_pendingApprovals, ([id, p]) => ({ id, kind: p.kind || null }));
  for (const { id, kind } of pending) {
    _pendingApprovals.get(id)?.resolve(null);
    _broadcastApprovalDismiss(kind, id, 'session-ended');
  }
  _pendingApprovals.clear();
  // Best-effort child cleanup: if the iterator died without the process exiting (rare
  // but possible on transport errors), don't orphan the resident CLI.
  try { if (typeof query.close === 'function') query.close(); }
  catch (closeErr) { reportSwallowed('sdk-manager.death-close', closeErr); }
  // Release the SDK's streamInput consumer parked on the old queue's next() waiter.
  if (inputQueue && !inputQueue.isClosed()) inputQueue.close();
  // Keep the pipeline moving: the queue is not suppressed here (only interruptTurn/Stop
  // parks it), so a queued message drains into a lazily-reconstructed session. A broken
  // environment stops that loop after two consecutive deaths (drain pauses parked;
  // the next explicit user message re-arms it) instead of burning one spawn + error
  // toast per queued message.
  _consecutiveDeaths++;
  if (_consecutiveDeaths <= 2) _maybeDrain();
}

/**
 * Orderly teardown of the resident query (stopSession / session switch). Nulls the
 * handles FIRST so the dying iterator's end is dismissed as stale, then ends the
 * input queue (lets the SDK close stdin gracefully) and closes the query (terminates
 * the child). Settles every in-flight turn promise so no caller hangs.
 */
function _teardownResident() {
  const query = _activeQuery;
  const inputQueue = _inputQueue;
  _activeQuery = null;
  _inputQueue = null;
  _clearGraceTimer();
  _clearTurnWatchdog();
  _lateResultTombstones = 0;
  _settleAllTurns();
  if (inputQueue) inputQueue.close();
  if (query) {
    try { if (typeof query.close === 'function') query.close(); }
    catch (err) { reportSwallowed('sdk-manager.teardown-close', err); }
  }
}

/** Turn-level error toast (callback throw must never break the caller). */
function _notifyQueryError(err) {
  if (!_onQueryError) return;
  try { _onQueryError(String(err?.message || err)); }
  catch (cbErr) { console.warn('[sdk-manager] onQueryError threw:', cbErr?.message); }
}

/** Drain one queued message after a turn boundary (result-driven, not loop-driven). */
function _maybeDrain() {
  if (_suppressDrain || _queryBusy || _switching) return;
  if (_messageQueue.length === 0) return;
  const next = _messageQueue.shift();
  _broadcastQueueState();
  sendUserMessage(next.text).catch((err) => reportSwallowed('sdk-manager.drain', err));
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

    case 'result': {
      if (msg.session_id) _sessionId = msg.session_id;
      // Grace/watchdog tombstone: a result that arrives AFTER its turn was already
      // force-settled belongs to that dead turn — discard it instead of letting it
      // settle (and prematurely end) the NEXT turn. If the tombstone outlived its turn
      // entirely (the owed result never comes) the count would swallow a FUTURE turn's
      // result — the bookkeeping clear below keeps that mistake bounded to the
      // turn-end signal rather than wedging _queryBusy.
      if (_lateResultTombstones > 0) {
        _lateResultTombstones--;
        _clearGraceTimer();
        _queryBusy = false;
        _turnInFlight = false;
        if (_pendingTurns.length === 0) _clearTurnWatchdog();
        _maybeDrain();
        break;
      }
      const rec = _pendingTurns.shift();
      // An interrupted turn's result is expected to be an error (turn aborted) — don't
      // toast it. Turn-end still fires, matching the PTY Stop-hook semantics.
      if (rec && !rec.interrupted) _notifyTurnError(msg);
      // SDK turn-end signal. Equivalent to Claude Code's Stop hook
      // in CLI mode — fires once per user-prompt response when the whole chain
      // (assistant text + all tool calls + final reply) completes. SDK mode
      // doesn't go through ensureHooks() so this in-process callback is the
      // only way the renderer learns the turn is over.
      if (_onTurnEnd) {
        try { _onTurnEnd({ sessionId: _sessionId, ts: Date.now() }); }
        catch (err) { console.warn('[sdk-manager] onTurnEnd threw:', err?.message); }
      }
      if (rec) _settleTurn(rec);
      _clearGraceTimer();
      _queryBusy = false;
      _turnInFlight = false;
      if (_pendingTurns.length === 0) _clearTurnWatchdog();
      _maybeDrain();
      break;
    }

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
    const result = await _waitForApproval(id, 5 * 60 * 1000, 'plan', planPayload, options?.signal);
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
    const answers = await _waitForApproval(id, askTimeoutMs, 'ask', askPayload, options?.signal);
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

  const result = await _waitForApproval(id, 5 * 60 * 1000, 'perm', permPayload, options?.signal);
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

/**
 * Broadcast a modal-dismiss for a pending approval that ended WITHOUT a user answer
 * (timeout / session teardown / CLI-side abort). Maps to the close types the web
 * clients already handle by id:
 *   ask → 'sdk-ask-timeout' (askFlowController), plan → 'sdk-plan-resolved',
 *   perm → 'perm-hook-timeout' (same type the PTY hook path emits).
 * Deliberately NOT routed through sdk-adapter's sdkApprovalCloseType: that maps ask →
 * 'ask-hook-cancelled', whose handler flushes the user message parked behind the ask —
 * wrong for a timeout/dismiss. Frontend handlers match on `id` only; extra fields are inert.
 */
function _broadcastApprovalDismiss(kind, id, reason) {
  if (!_broadcastWs) return;
  const type = kind === 'ask' ? 'sdk-ask-timeout'
    : kind === 'plan' ? 'sdk-plan-resolved'
    : 'perm-hook-timeout';
  try {
    _broadcastWs({ type, id, reason });
  } catch (err) { console.warn('[sdk-manager] approval-dismiss broadcast threw:', err?.message); }
}

function _waitForApproval(id, timeoutMs, kind, replay = null, signal = null) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      _pendingApprovals.delete(id);
      // Close the modal on every client — a silent deny would leave it hanging forever.
      _broadcastApprovalDismiss(kind, id, 'timeout');
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
    // CLI-side abort of the in-flight control request (e.g. interrupt while the modal is
    // open): settle through the same first-wins path as a timeout so the promise resolves
    // to deny and the modal closes everywhere. { once: true } prevents listener leaks.
    if (signal && typeof signal.addEventListener === 'function') {
      if (signal.aborted) {
        const pending = _pendingApprovals.get(id);
        if (pending) { _broadcastApprovalDismiss(kind, id, 'aborted'); pending.resolve(null); }
      } else {
        signal.addEventListener('abort', () => {
          const pending = _pendingApprovals.get(id);
          if (pending) { _broadcastApprovalDismiss(kind, id, 'aborted'); pending.resolve(null); }
        }, { once: true });
      }
    }
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
 * Cancel all in-flight approvals (else their canUseTool promises stay parked and the
 * timeout timers leak, and clients keep a ghost approval modal open).
 *
 * Returns the list of approvals that were pending (`[{ id, kind }]`) so the caller
 * (server.js) can broadcast modal-close messages to every client. Always an array.
 */
function _cancelAllApprovals() {
  const cancelled = Array.from(_pendingApprovals, ([id, pending]) => ({ id, kind: pending.kind || null }));
  for (const { id } of cancelled) {
    _pendingApprovals.get(id)?.resolve(null);
  }
  _pendingApprovals.clear();
  return cancelled;
}

/** Backstop: if no result shows up within the grace window after an interrupt, force-
 * settle the head turn (keeping _queryBusy from wedging forever) and mark a tombstone
 * so the result that eventually arrives is discarded instead of settling the next turn. */
function _armSettleGrace() {
  _clearGraceTimer();
  _settleGraceTimer = setTimeout(() => {
    _settleGraceTimer = null;
    const rec = _pendingTurns[0];
    if (!rec || !rec.interrupted) return;
    console.warn('[sdk-manager] no result within interrupt grace — force-settling the turn');
    _lateResultTombstones++;
    _pendingTurns.shift();
    _settleTurn(rec);
    _queryBusy = false;
    if (_pendingTurns.length === 0) _clearTurnWatchdog();
    _maybeDrain();
  }, INTERRUPT_GRACE_MS);
  if (_settleGraceTimer.unref) _settleGraceTimer.unref();
}

/**
 * Interrupt the current turn (user clicked the Stop button) while KEEPING the
 * session alive: the resident query is a streaming-input session, so interrupt()
 * is a real control request — the CLI aborts the current turn and synthesizes an
 * error result for it, and the conversation (and child process) survives.
 *
 * Contrast with `stopSession()` below, which is the hard process-exit cleanup
 * that also nulls `_sessionId` (loses conversation continuity).
 *
 * Stop KEEPS queued messages (product decision, matching the web UX where queued bubbles
 * stay parked after Stop): `_suppressDrain` stops the result-driven drain from running
 * them right after the interrupt; the park lifts when a fresh user message / send-now
 * starts a new turn. The queue-state broadcast lets clients keep their bubbles.
 *
 * Returns the list of approvals that were pending at interrupt time
 * (`[{ id, kind }]`) so the caller (server.js) can broadcast modal-close
 * messages to every client. Always an array (empty when nothing was pending).
 */
export function interruptTurn() {
  const cancelled = _cancelAllApprovals();
  const q = _activeQuery;
  // Key off the sticky in-flight flag, not the FIFO: the grace/watchdog force-settle
  // paths drain _pendingTurns while the CLI-side turn may still be running — keying on
  // the FIFO length would make a second Stop silently skip the interrupt request.
  if (q && _turnInFlight) {
    _turnInFlight = false; // don't send duplicate interrupts while the abort unwinds
    if (_pendingTurns.length > 0) _pendingTurns[0].interrupted = true;
    if (typeof q.interrupt === 'function') {
      try {
        // A reject here (e.g. the control request can't reach a dying child) is NOT a
        // death signal — only the iterator ending is. Report and move on.
        q.interrupt().catch((err) => reportSwallowed('sdk-manager.interrupt', err));
      } catch (err) { reportSwallowed('sdk-manager.interrupt', err); }
    }
    _armSettleGrace();
  }
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
  const cancelled = interruptTurn();
  _suppressDrain = false; // send-now overrides the Stop-park interruptTurn just set
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
 * Stop the active SDK session (hard cleanup): tear down the resident query and reset
 * all session state, losing conversation continuity.
 */
export function stopSession() {
  _teardownResident();
  _resetFullState();
}

/**
 * Switch the session to a different session id (web "resume session" entry — SDK-mode
 * counterpart of the PTY /resume injection). options.resume only applies at query
 * construction, so the switch tears down the resident query; the next user message
 * lazily reconstructs it with options.resume = sessionId.
 *
 * Returns { ok: true } on success; { ok: false, reason } with 'busy' (a turn or another
 * switch is in flight), 'unavailable' (SDK missing), or 'bad-id' otherwise.
 */
export function switchToSession(sessionId) {
  if (!_query) return { ok: false, reason: 'unavailable' };
  if (typeof sessionId !== 'string' || !sessionId) return { ok: false, reason: 'bad-id' };
  if (_queryBusy || _switching) return { ok: false, reason: 'busy' };
  _switching = true;
  try {
    _teardownResident();
    // Defensive: no approvals can be pending while idle, but never leak one across
    // a session boundary (WS reconnect replay would show a ghost modal).
    for (const { id, kind } of _cancelAllApprovals()) {
      _broadcastApprovalDismiss(kind, id, 'session-switch');
    }
    _sessionId = sessionId;
    _launchResume = null;
    _initAnnouncedSid = '';
    _lastInitSnapshot = null; // don't replay the OLD session's sdk-init to the new one
    clearQueued(); // broadcasts the emptied queue-state
    _suppressDrain = false;
    return { ok: true };
  } finally {
    _switching = false;
  }
}

/**
 * Reset all session state.
 */
function _resetFullState() {
  _sessionId = null;
  _queryBusy = false;
  _switching = false;
  _turnInFlight = false;
  _initAnnouncedSid = '';
  _lastInitSnapshot = null;
  _pendingTurns = [];
  _lateResultTombstones = 0;
  _consecutiveDeaths = 0;
  _clearGraceTimer();
  _clearTurnWatchdog();
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
