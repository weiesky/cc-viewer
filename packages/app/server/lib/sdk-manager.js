/**
 * sdk-manager.js — Agent SDK session lifecycle manager (per-cwd multi-session).
 *
 * Wraps @anthropic-ai/claude-agent-sdk query() to provide:
 * - User-message input over a RESIDENT streaming-input query (one CLI child process
 *   per ccv session; turns are pushed as SDKUserMessages into a never-ending input
 *   queue). Resident mode unlocks the real control surface (interrupt() etc.) —
 *   single-prompt mode cannot interrupt and had to kill the child on every Stop.
 * - canUseTool callback for AskUserQuestion + permission approval
 * - Turn-end signaling (SDK 'result' message → Stop-hook equivalent)
 *
 * Registry (2026-10-12, PTY parity): one Session per cwd, kept alive across
 * workspace switches. `_activeKey` selects the session the composer/WS handlers
 * act on (the SDK analogue of pty-manager's activePtyKey). Each Session is a
 * factory closure — NO classes (avoids this-binding traps; the module's entire
 * history is arrow functions). GLOBAL, deliberately kept module-level: `_query`
 * (test injection must be settable before any init — 161+ test cases depend on
 * set-then-init), `_onTurnEnd`/`_onQueryError`/`_broadcastWs`/`_runWaterfallHook`
 * (cli.js registers ONE wiring for the whole process; every session reuses it),
 * constants, and the pure helpers (_makePushQueue/_userMessage/_normalizeSdkTask).
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
import { resolve as _pathResolve } from 'node:path';
import { createHash } from 'node:crypto';
import { registerSdkSessionLister } from './sdk-session-index.js';

let _query;
try {
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  _query = sdk.query;
} catch (err) {
  console.warn('[SDK] Agent SDK not available:', err.message);
}

// Test seam — inject a fake query() (following im-bridge-core.js's __setFetchForTests
// convention). Only lets unit tests inject a fake async-generator; no business logic changes.
// MUST stay module-level (outside any Session closure): tests set it BEFORE initSdkSession.
export function __setQueryForTests(fn) { _query = fn; }

// ── Session registry ─────────────────────────────────────────────────────────
// Keyed by path.resolve(cwd) — normalize only, NO realpath (house exact-string
// convention, routes/resume.js, so `/tmp` vs `/private/tmp` stay distinct). The
// per-session state machine lives in each _createSession closure; `_activeKey`
// selects which session the SDK composer and WS handlers act on.
const _sessions = new Map();
let _activeKey = null;

function _normalizeCwd(cwd) {
  if (typeof cwd !== 'string' || !cwd) return '';
  try { return _pathResolve(cwd); } catch { return String(cwd); }
}

// Get-or-create the per-cwd Session. The record holds the launch config so a
// kept-alive background session can reconstruct with ITS OWN config.
function _getOrCreateSession(cwd) {
  const key = _normalizeCwd(cwd);
  let s = _sessions.get(key);
  if (!s) { s = _createSession(key, cwd); _sessions.set(key, s); }
  return s;
}

// The ACTIVE session (the one the composer talks to). May be null before any init.
function _active() { return _activeKey != null ? _sessions.get(_activeKey) : null; }

function _matchesProject(sess, project) {
  const rawBase = String(sess.cwd || '').replace(/\\/g, '/').split('/').filter(Boolean).pop();
  const sanitized = rawBase ? rawBase.replace(/[^a-zA-Z0-9_\-.]/g, '_') : null;
  return sanitized === project || rawBase === project;
}

// Resolve an anchor { instanceKey|cwd|project } to a Session WITHOUT switching active (read ops).
// `cwd` is an absolute path (exact key match); `project` is the SANITIZED project name the
// web client sends (ChatView stamps `viewProject || projectName`, where projectName =
// projectKeyForCwd(cwd) — non [a-zA-Z0-9_-] chars become `_`, so a dir with spaces/CJK sends
// the sanitized name, NOT the raw basename). Match each session by projectKeyForCwd(s.cwd)
// (with a raw-basename fallback for exact-dir callers). Same-name collision → null (never
// guess). Returns null when the anchor resolves to no registered session.
function _sessionForAnchor(anchor) {
  if (!anchor || typeof anchor !== 'object') return null;
  const instanceKey = (typeof anchor.instanceKey === 'string' && anchor.instanceKey) || null;
  const cwd = (typeof anchor.cwd === 'string' && anchor.cwd) || null;
  const project = (typeof anchor.project === 'string' && anchor.project) || null;
  if (instanceKey) {
    for (const s of _sessions.values()) {
      if (s.instanceKey === instanceKey) return s;
    }
    // An exact instance that no longer exists must never fall back to a
    // same-basename sibling — that would execute the user's action in the
    // wrong workspace. The caller's unknown-anchor path drops + reports it.
    return null;
  }
  if (cwd) return _sessions.get(_normalizeCwd(cwd)) || null;
  if (!project) return null;
  // exact-path form of a project (an absolute path was passed as `project`) — try key first.
  const byKey = _sessions.get(_normalizeCwd(project));
  if (byKey) return byKey;
  let found = null;
  for (const s of _sessions.values()) {
    if (_matchesProject(s, project)) { if (found) return null; found = s; } // ambiguous → null
  }
  return found;
}

// Test seams (house `__…ForTests` convention) — assert registry behavior without a real SDK query.
export function __listSessionsForTests() { return [..._sessions.keys()]; }
export function __getSessionKeyForTests(cwd) { return _normalizeCwd(cwd); }

/** Enumerate the per-cwd SDK session registry for live workspace routing. Each entry:
 * { key, cwd, active, instanceKey }. Read-only. NOTE: `key` is the registry's
 * normalized-cwd key; attach/close responses instead alias `key` to the instanceKey
 * for killPtyFor-shape parity (resume.js consumes `r.key === reattachedTo`). Callers
 * must not mix the two namespaces. */
export function listSdkSessions() {
  return [..._sessions.values()].map((s) => ({ key: s.key, cwd: s.cwd, active: s.key === _activeKey, instanceKey: s.instanceKey }));
}

registerSdkSessionLister(listSdkSessions);

// Silence window for the watchdog. Must stay above the approval ceilings the turn can
// legally wait on: perm/plan = 5min, AskUserQuestion = 24h ("GUI effectively has no
// timeout" is a product contract). A pending approval exempts the turn from the
// watchdog entirely; 25min covers long tool runs (big builds) with headroom.
const TURN_WATCHDOG_MS = 25 * 60 * 1000;
const INTERRUPT_GRACE_MS = 10 * 1000;
// getContextUsage control requests have no SDK-side timeout — bound the wait so a live-but-
// unresponsive child can't wedge the in-flight gate forever.
const CTX_USAGE_TIMEOUT_MS = 10 * 1000;

// Cap the pending backlog so a stuck/busy resident query can't grow it unbounded
// (chat-queue.js MAX_ITEMS / im-bridge-core MAX_QUEUE parity). On overflow the item
// is NOT pushed and a `queue-rejected` frame goes out instead of `queue-state` — the
// frontend's `queueFull` toast (ChatView.jsx) is the user-visible signal.
const MAX_QUEUE_ITEMS = 50;

// Callbacks registered by cli.js (one wiring for the whole process; every session
// reuses the same callbacks — they broadcast to the shared terminal WS).
let _onTurnEnd = null; // SDK mode has no Stop hook (ensureHooks() skipped) — fire turnEnd directly when the SDK 'result' message arrives
let _onQueryError = null; // query-level failure → (message: string) => void; cli.js forwards to a WS toast
let _broadcastWs = null;
let _runWaterfallHook = null;

// Process-level SDK LAUNCH-CONFIG template (2026-10-12). cli.js registers it once at boot
// (the env carries the loopback-proxy URL + the per-cwd header is added per session). The
// workspace-launch route uses it to register a session for a NEW cwd — without it the new
// session would inherit process.env (no ANTHROPIC_BASE_URL → bypass the ccv proxy → no
// transcript, no per-cwd routing, model/permission/executable lost). launchResume is
// excluded (it is a startup-only intent for the boot cwd, not for later workspaces).
let _launchConfigTemplate = null;
export function setSdkLaunchConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return;
  _launchConfigTemplate = {
    permissionMode: cfg.permissionMode || 'default',
    env: cfg.env || null,
    settings: cfg.settings || null,
    model: cfg.model || null,
    userArgs: Array.isArray(cfg.userArgs) ? cfg.userArgs : [],
    claudeExecutable: cfg.claudeExecutable || null,
  };
}
export function getSdkLaunchConfig() { return _launchConfigTemplate; }

function _makeQueueItem(text) {
  return {
    id: 'q_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
    text,
    ts: Date.now(),
  };
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

/**
 * Normalize an SDK `task_*` system message into the camelCase relay payload
 * broadcast as `{ type: 'sdk-task', ... }`. Lossless pass-through (snake→camel
 * only) — no status mapping, no server-side merge: `task_updated.patch` stays a
 * delta for the client to apply, and `skip_transcript` is forwarded as
 * `skipTranscript` so the UI stage can decide whether to hide ambient tasks.
 *
 * Two constraints the UI stage MUST respect (server-side, this round is pure relay):
 *  - TWO status vocabularies share the wire: `task_notification.status` is
 *    `completed|failed|stopped`, while `task_updated.patch.status` is
 *    `pending|running|completed|failed|killed` — adjacent but disjoint domains.
 *    A client that naively merges `{...task, ...frame}` then `{...frame.patch}`
 *    will mis-render; discriminate by `subtype` before reading `status`.
 *  - NO server-side task table → NOT reconnect-replayed (unlike sdk-init's
 *    `_lastInitSnapshot`). A frame missed during a WS gap (page refresh / 2s
 *    reconnect) is NOT recoverable; an in-flight task is invisible to a late
 *    client. Accept-as-ephemeral vs add a bounded last-state map is a UI-stage
 *    decision (see sdk-mode-todo-list; if replay is wanted, reuse task-state.js's
 *    reducer semantics rather than growing a second table here).
 *
 * Note: the 4 subtypes relayed here are the PUBLIC contract (sdk.d.ts SDKMessage
 * union). The SDK additionally emits @internal `task_summary` / `post_turn_summary`
 * system subtypes which are deliberately NOT relayed this round — pending real-device
 * observation (smoke item ⑧) of whether they carry signal worth a sniff-relay.
 */
function _normalizeSdkTask(msg) {
  const out = {
    subtype: msg.subtype,
    sessionId: msg.session_id || null,
    taskId: msg.task_id != null ? String(msg.task_id) : null,
  };
  if (msg.tool_use_id != null) out.toolUseId = msg.tool_use_id;
  if (msg.description != null) out.description = msg.description;
  if (msg.summary != null) out.summary = msg.summary;
  if (msg.status != null) out.status = msg.status;
  if (msg.task_type != null) out.taskType = msg.task_type;
  if (msg.workflow_name != null) out.workflowName = msg.workflow_name;
  if (msg.last_tool_name != null) out.lastToolName = msg.last_tool_name;
  if (msg.output_file != null) out.outputFile = msg.output_file;
  if (msg.prompt != null) out.prompt = msg.prompt;
  if (msg.skip_transcript != null) out.skipTranscript = msg.skip_transcript === true;
  if (msg.usage && typeof msg.usage === 'object') {
    out.usage = {
      totalTokens: msg.usage.total_tokens ?? null,
      toolUses: msg.usage.tool_uses ?? null,
      durationMs: msg.usage.duration_ms ?? null,
    };
  }
  // task_updated: patch is a merge delta (wire-safe subset of TaskState). Forward
  // verbatim-in-shape (camelCased) so the client merges into its own task map.
  // An all-empty patch ({}) is a harmless no-op frame — skip it to spare a broadcast.
  if (msg.patch && typeof msg.patch === 'object') {
    const p = msg.patch;
    const patch = {};
    if (p.status != null) patch.status = p.status;
    if (p.description != null) patch.description = p.description;
    if (p.end_time != null) patch.endTime = p.end_time;
    if (p.total_paused_ms != null) patch.totalPausedMs = p.total_paused_ms;
    if (p.error != null) patch.error = p.error;
    if (p.is_backgrounded != null) patch.isBackgrounded = p.is_backgrounded;
    if (Object.keys(patch).length > 0) out.patch = patch;
  }
  return out;
}

// ── Per-session factory ──────────────────────────────────────────────────────
// ONE closure = ONE workspace's resident SDK session. Every variable the current
// (single-session) module held in module-level `let` lives here EXCEPT the ones
// that are process-global by contract (see file header). Arrays stay closure
// `let` (rebinding, not a frozen property) so assignment paths like
// `_messageQueue = []` keep working.
function _createSession(key, cwd) {
  const instanceKey = `ccv-${createHash('sha256').update(key).digest('hex').slice(0, 32)}`;
  // Launch config (per-session identity; adopted on lazy reconstruction)
  let _cwd = cwd;
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
  let _sessionId = null;
  let _initAnnouncedSid = ''; // sessionId whose slash-command surface was already announced (reset on full reset)
  let _lastInitSnapshot = null; // last sdk-init payload for WS reconnect replay
  // Last announced session state ('idle' | 'running' | 'requires_action' | null) — the
  // turn-level busy truth for the conversation spinner. Sources, most authoritative
  // first: CLI-emitted session_state_changed (gated behind CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS,
  // injected by cli.js) > push-running / result-idle fallbacks below. Retained for WS
  // reconnect replay like _lastInitSnapshot; reset alongside it on switch/reset.
  let _lastSessionState = null;
  let _lastContextUsage = null;   // last sdk-context-usage frame for WS reconnect replay
  let _ctxUsageFetching = false;  // one getContextUsage control request in flight
  let _ctxUsageQueued = false;    // a turn-end/compact arrived while in flight → rerun once (coalesce)
  // Generation counter for the in-flight gate: _clearContextUsage bumps it so a stale
  // request's .finally can't clear the flag of a NEWER in-flight request started after a
  // session switch (the flag is only reset by the generation that set it).
  let _ctxUsageSeq = 0;
  // Last sdk-mcp-status frame for WS reconnect replay. mcpServerStatus() is on-demand only
  // (HTTP pull + reconnect replay + clear-on-switch) — unlike context usage it is NOT
  // turn-correlated, so it gets no turn-end/compact trigger and none of the in-flight gate
  // (fetching/queued/seq) machinery above. It reuses the same CTX_USAGE_TIMEOUT_MS bound.
  let _lastMcpStatus = null;
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

    // Wrap the process-global _broadcastWs so EVERY frame this session emits carries
    // its routing identity (cwd + sessionId + instanceKey): with concurrent sessions on
    // one WS, the frontend/server filter frames by workspace+instance — without it every
    // workspace's (or same-basename twin's) clients would see every other workspace's
    // spinner/queue/modal frames.
  function _broadcast(payload) {
    if (!_broadcastWs) return;
    try {
      _broadcastWs({ cwd: _cwd, sessionId: _sessionId || null, instanceKey, ...payload });
    } catch (err) { reportSwallowed('sdk-manager.broadcast', err); }
  }

    /** Adopt launch config (initSdkSession writes it here). */
  function _init({ permissionMode, env, settings, model, launchResume, userArgs, claudeExecutable }) {
    _permissionMode = permissionMode || 'default';
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
   * Send a user message. Lazily constructs the resident query on the first message
   * (a startup-continuation launchResume applies to that first construction only).
   * Queues the message if a turn is already in flight (ccv's queue remains the single
   * source of truth — only one message is pushed to the SDK per turn boundary, so the
   * CLI's own command queue stays empty and Stop keeps its "park the bubbles" semantics).
   *
   * Never rejects for turn/session failures (those surface via onQueryError toasts);
   * the only throw is the synchronous "SDK not available" guard cli.js relies on.
   */
  async function _sendUserMessage(text) {
    if (!_query) throw new Error('Agent SDK not available');

    // If a turn is already running, queue this message and return
    if (_queryBusy) {
      if (_messageQueue.length >= MAX_QUEUE_ITEMS) {
        // Negative ack: the frontend cleared the composer optimistically — never fail
        // silently. Only the reject frame goes out (no queue-state — nothing changed).
        console.warn('[sdk-manager] queue full, rejecting message');
        try { if (_broadcastWs) _broadcastWs({ type: 'queue-rejected', reason: 'full', cwd: _cwd, sessionId: _sessionId || null, instanceKey }); }
        catch (err) { reportSwallowed('sdk-manager.reject-broadcast', err); }
        return;
      }
      _messageQueue.push(_makeQueueItem(text));
      _broadcastQueueState();
      return;
    }

    // A fresh user-initiated turn re-arms automatic draining of parked (Stop-kept) items.
    _suppressDrain = false;
    _consecutiveDeaths = 0; // explicit user action re-arms the death-drain backstop
    await _startTurn(text);
  }

  /** Broadcast the queue snapshot to all terminal-WS clients (drives the floating bubbles). */
  function _broadcastQueueState() {
    if (!_broadcastWs) return;
    try {
      _broadcastWs({ type: 'queue-state', cwd: _cwd, sessionId: _sessionId || null, instanceKey, items: _messageQueue.map(({ id, text, ts }) => ({ id, text, ts })) });
    } catch (err) { console.warn('[sdk-manager] queue-state broadcast threw:', err?.message); }
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
    // Turn-level loading fallback: light the spinner the moment the turn is pushed.
    // The CLI's own session_state_changed(running) arrives later and is idempotent
    // against this — on CLIs that never emit it (no env gate / older build) this is
    // the only "on" signal, paired with the result-idle broadcast in _processMessage.
    _announceSessionState('running');
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
    // Per-cwd transcript routing (multi-session, PTY parity): tag this session's requests with
    // `x-ccv-project-dir` = ITS cwd, exactly like PTY spawn (pty-manager.js:397-405). Without
    // it every session's requests fall back to the server's single bound project and concurrent
    // workspaces would double-write one transcript. Mutates options.env in place (PTY parity:
    // the same object is passed through — a copy would break reference-identity callers).
    if (options.env && _cwd) {
      const headerCwd = String(_cwd).replace(/[\r\n\x00-\x1f\x7f]/g, '');
      if (headerCwd) {
        const projectHeader = `x-ccv-project-dir: ${headerCwd}`;
        // Same-name twin isolation (review P2): also self-report this session's stable
        // instanceKey so the interceptor stamps `_ccvInstance` → v2 meta.instance →
        // scoped instance routing, exactly like a PTY spawn. Without it, two same-basename
        // SDK workspaces share project-scoped frames (close teardown kills the twin's
        // spinner/queue bubbles) and cold-load instance filters never match SDK sessions.
        const instanceHeader = `x-ccv-instance: ${instanceKey}`;
        const injected = `${projectHeader}\n${instanceHeader}`;
        options.env.ANTHROPIC_CUSTOM_HEADERS = options.env.ANTHROPIC_CUSTOM_HEADERS
          ? `${options.env.ANTHROPIC_CUSTOM_HEADERS}\n${injected}` : injected;
      }
    }
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
    // Session died mid-turn: no result will arrive, so without this the spinner would
    // hang until the 25min watchdog. The turn is unambiguously over.
    _announceSessionState('idle');
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
    _sendUserMessage(next.text).catch((err) => reportSwallowed('sdk-manager.drain', err));
  }

  /**
   * Announce a turn-level session state to WS clients (spinner source in SDK mode).
   * State-change guarded + retained for reconnect replay. Broadcast failures are
   * swallowed inside this helper — the message loop must never die on a UI signal.
   */
  function _announceSessionState(state) {
    const valid = state === 'idle' || state === 'running' || state === 'requires_action';
    if (!valid || state === _lastSessionState) return;
    _lastSessionState = state;
    // _broadcast carries the routing envelope (cwd + sessionId + instanceKey) — every
    // frame needs it so concurrent sessions' clients filter correctly.
    _broadcast({ type: 'sdk-session-state', state });
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
        // The CLI's authoritative turn-level state machine (idle / running /
        // requires_action — 'idle' fires only after the whole turn, tools included,
        // settles). Emission is gated behind CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS
        // which cli.js injects into the child env; on CLIs that never emit it the
        // push/result fallbacks keep the spinner correct at result granularity.
        if (msg.subtype === 'session_state_changed') {
          _announceSessionState(msg.state);
        } else if (msg.subtype === 'init' && _broadcastWs
          && Array.isArray(msg.slash_commands) && msg.slash_commands.length > 0
          && msg.session_id !== _initAnnouncedSid) {
          _initAnnouncedSid = msg.session_id;
          _lastInitSnapshot = {
            type: 'sdk-init',
            sessionId: msg.session_id,
            model: msg.model,
            slashCommands: msg.slash_commands,
            tools: msg.tools,
            cwd: _cwd,
            instanceKey,
          };
          _broadcastWs(_lastInitSnapshot);
        } else if (msg.subtype === 'compact_boundary' && _broadcastWs) {
          const meta = msg.compact_metadata;
          _broadcastWs({
            type: 'sdk-compact',
            trigger: meta && meta.trigger,
            preTokens: meta && meta.pre_tokens,
            postTokens: meta && meta.post_tokens,
            cwd: _cwd,
            sessionId: _sessionId || null,
            instanceKey,
          });
          // Compaction is the only non-turn event that materially shrinks context — refresh
          // the usage panel. Coalesced with the turn-end refresh via the in-flight gate.
          _refreshContextUsage('compact');
        } else if (_broadcastWs
          && (msg.subtype === 'task_started' || msg.subtype === 'task_progress'
            || msg.subtype === 'task_notification' || msg.subtype === 'task_updated')) {
          // SDK background-task / subagent progress (SDK 0.2.x system subtypes). The TODO
          // HUD (TaskProgressHud) is hook-fed and never fires in SDK mode; this is a
          // separate, lossless relay so clients can observe task lifecycle (incl.
          // failed/stopped/killed terminal states the TODO HUD vocabulary lacks). The
          // server keeps no task table here — pure forward, merge semantics left to the
          // client (task_updated.patch is a wire-safe delta, not a full snapshot).
          _broadcastWs({ type: 'sdk-task', cwd: _cwd, instanceKey, ..._normalizeSdkTask(msg) });
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
          // The tombstoned turn is over — but a NEWER turn may already be in flight
          // (Stop → grace settle → user re-sent → late result of the old turn arrives).
          // Only announce idle when no turn is pending, else we'd kill turn 2's spinner.
          if (_pendingTurns.length === 0) {
            _announceSessionState('idle');
            _clearTurnWatchdog();
          }
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
          // Per-workspace (2026-10): carry the session's own cwd so the server
          // can route turn_end to THIS workspace's SSE scope (SDK mode has no
          // Stop-hook POST, so this callback is the only turn-end producer).
          try { _onTurnEnd({ sessionId: _sessionId, ts: Date.now(), cwd: _cwd }); }
          catch (err) { console.warn('[sdk-manager] onTurnEnd threw:', err?.message); }
        }
        if (rec) _settleTurn(rec);
        _clearGraceTimer();
        _queryBusy = false;
        _turnInFlight = false;
        // Turn-level spinner clear at result time — immediate, unlike the debounced
        // `turn_end` SSE (voice-pack semantics). Idempotent against a real
        // session_state_changed(idle) arriving before/after.
        _announceSessionState('idle');
        if (_pendingTurns.length === 0) _clearTurnWatchdog();
        _maybeDrain();
        // Refresh the context-usage panel AFTER the turn fully settles (fire-and-forget,
        // never awaited in this message loop). Placement after settle/drain guarantees a
        // synchronous throw here can't truncate turn settlement.
        _refreshContextUsage('turn-end');
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
      try { _broadcastWs({ type: 'sdk-error', message: String(errs), cwd: _cwd, sessionId: _sessionId || null, instanceKey }); } catch (err) { console.warn('[sdk-manager] sdk-error broadcast threw:', err?.message); }
    }
  }

  /**
   * Collect a context-usage snapshot via the Query control surface (`get_context_usage`).
   * Returns { ok:true, snapshot } | { ok:false, reason:'session-inactive'|'control-failed' }.
   * Never throws — the panel is best-effort; failures must not surface as sdk-error toasts.
   *
   * Identity guard (not a null check): teardown nulls `_activeQuery`, but a subsequent user
   * message lazily rebuilds it into a NEW query object. A late-resolving control promise from
   * the dead generation must not broadcast that session's numbers into the new panel.
   */
  async function _collectContextUsage(trigger) {
    const q = _activeQuery;
    if (!q || typeof q.getContextUsage !== 'function') return { ok: false, reason: 'session-inactive' };
    let timeoutId;
    try {
      // SDK request() has no built-in timeout — race a bound so a live-but-unresponsive
      // child can't hold the in-flight gate forever. unref so the timer never delays process
      // exit; cleared once the request settles so the handle doesn't linger.
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('getContextUsage timeout')), CTX_USAGE_TIMEOUT_MS);
        if (timeoutId.unref) timeoutId.unref();
      });
      const usage = await Promise.race([q.getContextUsage(), timeout]);
      if (_activeQuery !== q) return { ok: false, reason: 'session-inactive' }; // stale generation
      // Degenerate resolve (null/undefined/{}) — skip rather than broadcast a usage-less frame.
      if (!usage || typeof usage !== 'object' || Array.isArray(usage) || Object.keys(usage).length === 0) {
        return { ok: false, reason: 'control-failed' };
      }
      _lastContextUsage = { type: 'sdk-context-usage', sessionId: _sessionId, ts: Date.now(), trigger, usage, cwd: _cwd };
      return { ok: true, snapshot: _lastContextUsage };
    } catch (err) {
      reportSwallowed('sdk-manager.context-usage', err);
      return { ok: false, reason: 'control-failed' };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  /**
   * Fire-and-forget refresh for turn-boundary hooks (result / compact_boundary). Never
   * awaited by the message loop. In-flight requests coalesce: a second trigger while one is
   * running queues exactly one rerun. The fetching flag is ALWAYS reset in finally (incl.
   * stale-generation early returns) so the gate can't wedge.
   */
  function _refreshContextUsage(trigger) {
    if (_ctxUsageFetching) { _ctxUsageQueued = true; return; }
    _ctxUsageFetching = true;
    const seq = ++_ctxUsageSeq; // capture this generation; a session switch bumps it
    _collectContextUsage(trigger).then((r) => {
      if (r.ok && _broadcastWs) {
        try { _broadcastWs(r.snapshot); }
        catch (err) { reportSwallowed('sdk-manager.context-usage-broadcast', err); }
      }
    }).finally(() => {
      // Only the generation that set the flag may clear it — a stale request's finally must
      // not clobber a NEWER in-flight request started after a session switch.
      if (seq !== _ctxUsageSeq) return;
      _ctxUsageFetching = false;
      if (_ctxUsageQueued) { _ctxUsageQueued = false; _refreshContextUsage('coalesced'); }
    });
  }

  /**
   * Clear the usage snapshot on a session boundary (switch / full reset). Broadcasts a
   * usage:null clear frame ONLY when a snapshot was present (an empty-to-empty broadcast
   * would just be noise). The death path deliberately does NOT clear (same-session resume
   * keeps the last known value, matching _lastInitSnapshot's death behavior).
   */
  function _clearContextUsage(trigger) {
    const had = _lastContextUsage !== null;
    _lastContextUsage = null;
    _ctxUsageSeq++; // invalidate any in-flight generation so its finally can't clear a newer gate
    _ctxUsageFetching = false;
    _ctxUsageQueued = false;
    if (had && _broadcastWs) {
      try { _broadcastWs({ type: 'sdk-context-usage', sessionId: _sessionId, ts: Date.now(), trigger, usage: null, cwd: _cwd, instanceKey }); }
      catch (err) { reportSwallowed('sdk-manager.context-usage-broadcast', err); }
    }
  }

  /**
   * Collect an MCP-server-status snapshot via the Query control surface (`mcp_status`).
   * Returns { ok:true, snapshot } | { ok:false, reason:'session-inactive'|'control-failed' }.
   * Never throws — the panel is best-effort; failures must not surface as sdk-error toasts.
   *
   * Mirrors _collectContextUsage with ONE inversion: mcpServerStatus() resolves to an ARRAY
   * (McpServerStatus[]), so the degenerate guard accepts any array — an EMPTY array is a
   * legitimate "no MCP servers configured" result that must be broadcast, not a failure —
   * and rejects non-arrays. Same identity guard (stale-generation) and 10s timeout bound.
   */
  async function _collectMcpStatus(trigger) {
    const q = _activeQuery;
    if (!q || typeof q.mcpServerStatus !== 'function') return { ok: false, reason: 'session-inactive' };
    let timeoutId;
    try {
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('mcpServerStatus timeout')), CTX_USAGE_TIMEOUT_MS);
        if (timeoutId.unref) timeoutId.unref();
      });
      const servers = await Promise.race([q.mcpServerStatus(), timeout]);
      if (_activeQuery !== q) return { ok: false, reason: 'session-inactive' }; // stale generation
      // Degenerate resolve (non-array) — skip rather than broadcast a malformed frame.
      if (!Array.isArray(servers)) return { ok: false, reason: 'control-failed' };
      _lastMcpStatus = { type: 'sdk-mcp-status', sessionId: _sessionId, ts: Date.now(), trigger, servers, cwd: _cwd };
      return { ok: true, snapshot: _lastMcpStatus };
    } catch (err) {
      reportSwallowed('sdk-manager.mcp-status', err);
      return { ok: false, reason: 'control-failed' };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  /**
   * Clear the MCP-status snapshot on a session boundary (switch / full reset). Broadcasts a
   * servers:null clear frame ONLY when a snapshot was present. No seq bump — there is no
   * in-flight gate to invalidate; the identity guard already covers the stale case. The
   * death path deliberately does NOT clear (same-session resume keeps the last known value).
   */
  function _clearMcpStatus(trigger) {
    const had = _lastMcpStatus !== null;
    _lastMcpStatus = null;
    if (had && _broadcastWs) {
      try { _broadcastWs({ type: 'sdk-mcp-status', sessionId: _sessionId, ts: Date.now(), trigger, servers: null, cwd: _cwd, instanceKey }); }
      catch (err) { reportSwallowed('sdk-manager.mcp-status-broadcast', err); }
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
        } catch (err) { reportSwallowed('sdk-manager.waterfall.plan', err); }
      }
      const planPayload = { type: 'sdk-plan-pending', id, input, cwd: _cwd, sessionId: _sessionId || null };
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
        } catch (err) { reportSwallowed('sdk-manager.waterfall.ask', err); }
      }
      // 24h — same source as the hook path (server.js ASK_HOOK_TIMEOUT_MS), honoring the
      // "GUI effectively has no timeout" promise. The actual constant lives in
      // server/lib/ask/ask-constants.js.
      const askTimeoutMs = ASK_TIMEOUT_MS;
      const askStartedAt = Date.now();
      const askPayload = { type: 'sdk-ask-pending', id, questions: input.questions, startedAt: askStartedAt, timeoutMs: askTimeoutMs, cwd: _cwd, sessionId: _sessionId || null };
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
      } catch (err) { reportSwallowed('sdk-manager.waterfall.perm', err); }
    }
    const permPayload = { type: 'perm-hook-pending', id, toolName, input, cwd: _cwd, sessionId: _sessionId || null };
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
      _broadcastWs({ type, id, reason, cwd: _cwd, sessionId: _sessionId || null, instanceKey });
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
  function _resolveApproval(id, value) {
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
  function _getPendingApprovals() {
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
  function _cancelApproval(id, reason) {
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
      // The CLI never answered the interrupt — no result is coming, so clear the
      // spinner here rather than waiting on a dead signal.
      _announceSessionState('idle');
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
  function _interruptTurn() {
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
  function _sendQueuedNow(id) {
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
      _sendUserMessage(item.text).catch((err) => console.warn('[sdk-manager] send-now query failed:', err?.message));
      return [];
    }

    _messageQueue.unshift(item);
    const cancelled = _interruptTurn();
    _suppressDrain = false; // send-now overrides the Stop-park interruptTurn just set
    _broadcastQueueState();
    return cancelled;
  }

  /** Remove one queued message (bubble ×). Returns true when found. */
  function _removeQueued(id) {
    const idx = _messageQueue.findIndex((it) => it.id === id);
    if (idx < 0) return false;
    _messageQueue.splice(idx, 1);
    _broadcastQueueState();
    return true;
  }

  /** Drop all queued messages WITHOUT touching the running turn (session switch). */
  function _clearQueued() {
    if (_messageQueue.length === 0) return;
    _messageQueue = [];
    _broadcastQueueState();
  }

  /** Queue snapshot for WS-reconnect replay (same pattern as getSdkInitSnapshot). */
  function _getQueueSnapshot() {
    return _messageQueue.map(({ id, text, ts }) => ({ id, text, ts }));
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
  function _switchToSession(sessionId) {
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
      _lastSessionState = null; // same for the session-state snapshot — new session starts idle
      _clearContextUsage('session-switched');
      _clearMcpStatus('session-switched');
      _clearQueued(); // broadcasts the emptied queue-state
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
    // Tell clients BEFORE nulling the snapshot: a re-init/launch mid-turn would
    // otherwise leave the spinner lit with no frame ever clearing it (the new
    // session starts idle and the state-change guard would swallow the first
    // legit idle). Skip the broadcast when nothing was ever announced.
    if (_lastSessionState && _lastSessionState !== 'idle') _announceSessionState('idle');
    _lastSessionState = null;
    _clearContextUsage('session-switched');
    _clearMcpStatus('session-switched');
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

  // ── Exposed Session surface ──────────────────────────────────────────────
  // `teardown` = _teardownResident + _resetFullState (the old module-level stopSession
  // body, now per-session). `init` = config adoption + that teardown/reset pair.
  return {
    key,
    instanceKey,
    get cwd() { return _cwd; },
    get config() {
      return {
        permissionMode: _permissionMode,
        env: _childEnv,
        settings: _settings,
        model: _launchModel,
        launchResume: _launchResume,
        userArgs: _userArgs,
        claudeExecutable: _claudeExecutable,
      };
    },
    init: _init,
    sendUserMessage: _sendUserMessage,
    interruptTurn: _interruptTurn,
    sendQueuedNow: _sendQueuedNow,
    removeQueued: _removeQueued,
    clearQueued: _clearQueued,
    getQueueSnapshot: _getQueueSnapshot,
    resolveApproval: _resolveApproval,
    cancelApproval: _cancelApproval,
    getPendingApprovals: _getPendingApprovals,
    getSdkInitSnapshot: () => _lastInitSnapshot,
    getSessionStateSnapshot: () => {
      if (!_lastSessionState) return null;
      return { type: 'sdk-session-state', state: _lastSessionState, sessionId: _sessionId || null, cwd: _cwd };
    },
    getContextUsageSnapshot: () => _lastContextUsage,
    getMcpStatusSnapshot: () => _lastMcpStatus,
    fetchContextUsage: async () => {
      // On-demand fetch for the HTTP route: refresh the snapshot, broadcast to all clients,
      // then reply. Unlike _refreshContextUsage this bypasses the in-flight gate (an explicit
      // user refresh should not be swallowed by a queued turn-end) and returns the outcome.
      const r = await _collectContextUsage('request');
      if (r.ok && _broadcastWs) {
        try { _broadcastWs(r.snapshot); }
        catch (err) { reportSwallowed('sdk-manager.context-usage-broadcast', err); }
      }
      return r;
    },
    fetchMcpStatus: async () => {
      // On-demand fetch for the HTTP route: refresh the snapshot, broadcast to all clients,
      // then reply. fetchContextUsage parity — bypasses any gate (explicit user refresh).
      const r = await _collectMcpStatus('request');
      if (r.ok && _broadcastWs) {
        try { _broadcastWs(r.snapshot); }
        catch (err) { reportSwallowed('sdk-manager.mcp-status-broadcast', err); }
      }
      return r;
    },
    switchToSession: _switchToSession,
    getSessionId: () => _sessionId,
    close: () => {
      for (const { id, kind } of _cancelAllApprovals()) {
        _broadcastApprovalDismiss(kind, id, 'session-closed');
      }
      _teardownResident();
      _resetFullState();
    },
    teardown: () => {
      _teardownResident();
      _resetFullState();
    },
  };
}

export function isSdkAvailable() {
  return typeof _query === 'function';
}

/**
 * Initialize (or re-initialize) a workspace's SDK session.
 * Does NOT start a query — waits for the first user message via sendUserMessage().
 * Registering a DIFFERENT cwd does not touch other registered sessions (they stay
 * resident in the registry; concurrent workspaces keep their state).
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
export function initSdkSession(cwd, projectName, { onTurnEnd, onQueryError, broadcastWs, permissionMode, runWaterfallHook, env, settings, model, launchResume, userArgs, claudeExecutable } = {}) {
  void projectName; // reserved (display name comes from the wire path)
  // Process-global callbacks (cli.js registers one wiring; every session reuses it). Only
  // OVERWRITE when a callback is actually passed — a later per-workspace init (the launch
  // route registers a fresh session) may omit them, and blindly assigning undefined would
  // kill every workspace's broadcasts/turn-end/approvals process-wide (2026-10-12 regression).
  if (onTurnEnd !== undefined) _onTurnEnd = onTurnEnd;
  if (onQueryError !== undefined) _onQueryError = onQueryError || null;
  if (broadcastWs !== undefined) _broadcastWs = broadcastWs;
  if (runWaterfallHook !== undefined) _runWaterfallHook = runWaterfallHook || null;
  // Register this workspace's session (per-cwd, re-using the record on re-init) and make
  // it active. init() adopts the launch config and tears down ONLY this session's prior
  // generation (tests / hot reload) — other workspaces' sessions are untouched.
  const sess = _getOrCreateSession(cwd);
  sess.init({ permissionMode, env, settings, model, launchResume, userArgs, claudeExecutable });
  _activeKey = sess.key;
}

/**
 * Send a user message to the ACTIVE session, or to the session an anchor
 * { cwd | project } resolves to (switching active to it first — a send is an ACTION).
 * An anchor that resolves to no registered session is reported and dropped.
 *
 * Never rejects for turn/session failures (those surface via onQueryError toasts);
 * the only throw is the synchronous "SDK not available" guard cli.js relies on.
 */
export async function sendUserMessage(text, anchor) {
  if (!_query) throw new Error('Agent SDK not available');
  if (anchor && (anchor.cwd || anchor.project || anchor.instanceKey)) {
    const target = _sessionForAnchor(anchor);
    if (!target) {
      // A mis-resolved anchor must not silently drop the user's message — log + report,
      // and surface a toast through the same channel query errors use (the composer was
      // already cleared client-side; without this the text vanishes without a trace).
      const targetName = anchor.cwd || anchor.project || anchor.instanceKey;
      console.warn(`[sdk-manager] no SDK session registered for "${targetName}" — message dropped`);
      reportSwallowed('sdk-manager.route', new Error(`no SDK session for ${targetName}`));
      if (_onQueryError) {
        try { _onQueryError(`Workspace "${targetName}" is no longer available — message not sent.`); }
        catch (err) { console.warn('[sdk-manager] onQueryError threw:', err?.message); }
      }
      return;
    }
    if (target.key !== _activeKey) {
      _activeKey = target.key; // an action re-routes the active session (lazy: no teardown)
    }
    return target.sendUserMessage(text);
  }
  const sess = _active();
  if (!sess) {
    // Uninitialized — the old module's state machine only came alive after
    // initSdkSession; a pre-init send just resolves (the SDK-unavailable guard
    // above already covered the only documented throw).
    return;
  }
  return sess.sendUserMessage(text);
}

/**
 * Resolve a pending canUseTool approval by id, scanning EVERY session (ids are
 * globally unique — `sdk_<ts>_<rand>` or the CLI's own toolUseID). Called by
 * server.js when a WS message arrives. Does not switch active.
 */
export function resolveApproval(id, value) {
  for (const sess of _sessions.values()) {
    if (sess.resolveApproval(id, value)) return true;
  }
  return false;
}

/**
 * Cancel a pending canUseTool approval by id, scanning EVERY session (ask-cancel
 * WS handler). Does not switch active.
 */
export function cancelApproval(id, reason) {
  for (const sess of _sessions.values()) {
    if (sess.cancelApproval(id, reason)) return true;
  }
  return false;
}

/**
 * Snapshot of pending approvals for WS-reconnect replay (server.js connection
 * handler). WITHOUT an anchor: aggregated across ALL sessions; WITH an anchor:
 * only that session's pendings.
 */
export function getPendingApprovals(anchor) {
  const target = anchor ? _sessionForAnchor(anchor) : null;
  if (target) return target.getPendingApprovals();
  const out = [];
  for (const sess of _sessions.values()) out.push(...sess.getPendingApprovals());
  return out;
}

/** Interrupt the ACTIVE session's turn (Stop). An anchor targets another session
 * (switching active to it first — an interrupt is an ACTION). Returns the
 * cancelled-approval list (see the Session factory's interruptTurn). */
export function interruptTurn(anchor) {
  if (anchor) {
    const target = _sessionForAnchor(anchor);
    if (target) {
      if (target.key !== _activeKey) _activeKey = target.key;
      return target.interruptTurn();
    }
    // Unknown anchor: nothing to interrupt — same empty array the idle path returns.
    return [];
  }
  const sess = _active();
  return sess ? sess.interruptTurn() : [];
}

/** Send-now on a queued bubble of the ACTIVE session (or an anchor's session —
 * an action, switches active). Returns the cancelled-approval list. */
export function sendQueuedNow(id, anchor) {
  const sess = anchor ? _sessionForAnchor(anchor) : _active();
  if (anchor && sess && sess.key !== _activeKey) _activeKey = sess.key;
  return sess ? sess.sendQueuedNow(id) : [];
}

/** Remove one queued message of the ACTIVE session (or an anchor's session —
 * a targeted action; does not switch active). */
export function removeQueued(id, anchor) {
  const sess = anchor ? _sessionForAnchor(anchor) : _active();
  return sess ? sess.removeQueued(id) : false;
}

/** Drop all queued messages of the ACTIVE session (or an anchor's session).
 * queue-clear is a targeted reset, not a send — it does NOT switch active. */
export function clearQueued(anchor) {
  const sess = anchor ? _sessionForAnchor(anchor) : _active();
  if (sess) sess.clearQueued();
}

/** Queue snapshot for WS-reconnect replay: no anchor → active session; with an
 * anchor → that session. Empty array when there is nothing to replay. */
export function getQueueSnapshot(anchor) {
  const sess = anchor ? _sessionForAnchor(anchor) : _active();
  return sess ? sess.getQueueSnapshot() : [];
}

/**
 * Stop the active SDK session (hard cleanup): tear down the resident query and reset
 * all session state, losing conversation continuity. Tears down EVERY registered
 * session and clears the registry + the active pointer (process-exit cleanup path).
 */
export function stopSession() {
  for (const sess of _sessions.values()) {
    try { sess.teardown(); }
    catch (err) { reportSwallowed('sdk-manager.stop', err); }
  }
  _sessions.clear();
  _activeKey = null;
  // Process-global wiring is cleared on the HARD teardown boundary. initSdkSession only
  // overwrites a callback when one is actually passed (so a per-workspace launch init
  // cannot wipe cli.js's process-wide wiring mid-run); that guard means an init that
  // omits a callback KEEPS the previous one. stopSession is the process-exit / test-reset
  // boundary, so it must drop the wiring entirely — otherwise a prior registrant's
  // runWaterfallHook (e.g. a test's onPermRequest deny) would leak into the next init.
  _onTurnEnd = null;
  _onQueryError = null;
  _broadcastWs = null;
  _runWaterfallHook = null;
}

/**
 * Switch the ACTIVE session to a different workspace (cwd). Concurrent-keep semantics:
 * NO teardown of any session — the outgoing session stays resident in the registry
 * (its transcript is preserved on disk by the wire path), and the target session
 * reconstructs its resident query LAZILY on its next message (resuming its own
 * captured sessionId). Unknown cwd → false (no switch); already-active → true (no-op).
 */
export function setActiveSdkSession(cwd) {
  const key = _normalizeCwd(cwd);
  if (!key || !_sessions.has(key)) return false;
  _activeKey = key; // lazy switch: the target's state machine is intact by construction
  return true;
}

/** Activate a workspace by the same exact instance/cwd/project anchor used by SDK actions. */
export function attachSdkSession(anchor) {
  if (anchor && anchor.project && !anchor.instanceKey && !anchor.cwd) {
    const matches = [..._sessions.values()].filter((s) => _matchesProject(s, anchor.project));
    if (matches.length > 1) {
      return {
        ok: false,
        reason: 'ambiguous',
        candidates: matches.map((s) => ({ key: s.instanceKey /* aliases instanceKey for killPtyFor-shape parity */, instanceKey: s.instanceKey, cwd: s.cwd })),
      };
    }
  }
  const sess = _sessionForAnchor(anchor);
  if (!sess) return { ok: false, reason: 'not-found' };
  const switched = sess.key !== _activeKey;
  _activeKey = sess.key;
  // `key` aliases instanceKey for killPtyFor-shape parity (NOT the registry cwd key).
  return { ok: true, key: sess.instanceKey, instanceKey: sess.instanceKey, cwd: sess.cwd, switched };
}

/**
 * Close exactly one registered SDK workspace. A name-only anchor refuses
 * same-basename ambiguity; an exact instance key never falls back to a name.
 */
export function closeSdkSession(anchor = {}) {
  const instanceKey = typeof anchor.instanceKey === 'string' ? anchor.instanceKey : '';
  let sess = null;
  if (instanceKey) {
    sess = _sessionForAnchor({ instanceKey });
    if (!sess) return { ok: false, reason: 'not-found' };
  } else if (anchor.cwd) {
    sess = _sessionForAnchor({ cwd: anchor.cwd });
  } else if (anchor.project) {
    const matches = [..._sessions.values()].filter((s) => _matchesProject(s, anchor.project));
    if (matches.length > 1) {
      return {
        ok: false,
        reason: 'ambiguous',
        candidates: matches.map((s) => ({ key: s.instanceKey /* aliases instanceKey for killPtyFor-shape parity */, instanceKey: s.instanceKey, cwd: s.cwd })),
      };
    }
    sess = matches[0] || null;
  }
  if (!sess) return { ok: false, reason: 'not-found' };

  const killedActive = sess.key === _activeKey;
  const result = {
    ok: true,
    // `key` aliases instanceKey here (killPtyFor-shape parity: resume.js matches
    // `p.key === killResult.reattachedTo`). It is NOT the registry's cwd key —
    // the registry key is `sess.key`, a different namespace. Do not conflate.
    key: sess.instanceKey,
    instanceKey: sess.instanceKey,
    cwd: sess.cwd,
    killedActive,
    reattachedTo: null,
  };
  // Remove the registry identity BEFORE user-callback-facing teardown frames. A
  // close/relaunch triggered by one of those frames must register a fresh session,
  // never be deleted by the tail of the older close operation.
  _sessions.delete(sess.key);
  if (killedActive) {
    const survivor = _sessions.values().next().value || null;
    _activeKey = survivor ? survivor.key : null;
    result.reattachedTo = survivor ? survivor.instanceKey : null;
  }
  try {
    sess.close();
  } catch (err) {
    reportSwallowed('sdk-manager.close', err);
  }
  return result;
}

/** The active session's cwd (header/switch addressing). '' when none. */
export function getActiveSdkCwd() {
  const sess = _active();
  return sess ? sess.cwd : '';
}

/**
 * Switch the ACTIVE session's session id (web "resume session" entry — SDK-mode
 * counterpart of the PTY /resume injection). An anchor targets another workspace's
 * session (switching active to it first — a resume is an ACTION); no anchor → the
 * active session. See the Session factory's switchToSession for the return contract.
 */
export function switchToSession(sessionId, anchor) {
  if (!_query) return { ok: false, reason: 'unavailable' }; // route maps this to 409 — must fire BEFORE any session lookup
  const sess = anchor ? _sessionForAnchor(anchor) : _active();
  if (!sess) return { ok: false, reason: 'bad-id' };
  if (anchor && sess.key !== _activeKey) _activeKey = sess.key;
  return sess.switchToSession(sessionId);
}

/** The active session's id (for resume); null before any init/turn. */
export function getSessionId(anchor) {
  const sess = anchor ? _sessionForAnchor(anchor) : _active();
  return sess ? sess.getSessionId() : null;
}

/**
 * The last sdk-init snapshot for WS reconnect replay. No anchor → active session;
 * with an anchor → that session. Returns null if no init has been announced yet
 * (e.g. session without slash commands).
 */
export function getSdkInitSnapshot(anchor) {
  const sess = anchor ? _sessionForAnchor(anchor) : _active();
  return sess ? sess.getSdkInitSnapshot() : null;
}

/**
 * Last announced session-state frame for WS reconnect replay (sdk-init snapshot
 * parity). Null until the first state transition — a fresh session is idle, and an
 * absent frame leaves the client at its own idle default. No anchor → active session.
 */
export function getSessionStateSnapshot(anchor) {
  const sess = anchor ? _sessionForAnchor(anchor) : _active();
  return sess ? sess.getSessionStateSnapshot() : null;
}

/** WS reconnect replay getter for the context-usage frame. No anchor → active session. */
export function getContextUsageSnapshot(anchor) {
  const sess = anchor ? _sessionForAnchor(anchor) : _active();
  return sess ? sess.getContextUsageSnapshot() : null;
}

/** WS reconnect replay getter for the MCP-status frame. No anchor → active session. */
export function getMcpStatusSnapshot(anchor) {
  const sess = anchor ? _sessionForAnchor(anchor) : _active();
  return sess ? sess.getMcpStatusSnapshot() : null;
}

/**
 * On-demand context-usage fetch for the HTTP route (see the Session factory's
 * fetchContextUsage). No anchor → the active session. Returns
 * { ok:false, reason:'session-inactive' } when there is no active session at all.
 */
export async function fetchContextUsage(anchor) {
  const sess = anchor ? _sessionForAnchor(anchor) : _active();
  if (!sess) return { ok: false, reason: 'session-inactive' };
  return sess.fetchContextUsage();
}

/**
 * On-demand MCP-status fetch for the HTTP route (see the Session factory's
 * fetchMcpStatus). No anchor → the active session. Returns
 * { ok:false, reason:'session-inactive' } when there is no active session at all.
 */
export async function fetchMcpStatus(anchor) {
  const sess = anchor ? _sessionForAnchor(anchor) : _active();
  if (!sess) return { ok: false, reason: 'session-inactive' };
  return sess.fetchMcpStatus();
}
