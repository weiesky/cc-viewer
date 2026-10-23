// Scheduled-task executor — the L1 glue that turns a claimed task into an actual
// execution. server.js injects the SDK/PTY/chatQueue accessors (L1 must NOT import
// the L2 managers directly — see verify-boundaries R5), so this module stays pure
// and unit-testable with fakes.
//
// Three execution paths:
//   inject (SDK mode)  → sdk.sendUserMessage, with a queue-full precheck (P1-4)
//   inject (PTY mode)  → chatQueue.enqueue, with a STRICT instanceKey-only precheck (P0-2)
//   spawn              → sdk.spawnEphemeralSession (SDK mode only)
//
// Result contract:
//   inject → { status:'dispatched' } | { status:'failed', reason }
//   spawn  → { status:'completed', sessionId, durationMs } | { status:'error', reason, error? }

/**
 * @param {object} task   the claimed task (has .mode/.prompt/.cwd/.project/.schedule)
 * @param {object} claim  the claim record
 * @param {object} io     injected accessors:
 *   {
 *     isSdkMode: boolean,
 *     sdk: { isSdkAvailable, listSdkSessions, getQueueSnapshot, sendUserMessage, spawnEphemeralSession },
 *     pty: { listLivePtys, getPtyKindFor },
 *     chatQueue: { enqueue },
 *     samePath(a, b): boolean,
 *   }
 */
export async function executeScheduledTask(task, claim, io) {
  if (task.mode === 'spawn') return _spawn(task, claim, io);
  return io.isSdkMode ? _injectSdk(task, io) : _injectPty(task, io);
}

async function _injectSdk(task, io) {
  const sdk = io.sdk;
  if (!sdk || !sdk.isSdkAvailable()) return { status: 'failed', reason: 'sdk_unavailable' };
  // The resident session is a per-cwd singleton — find the one for the task's cwd.
  const target = sdk.listSdkSessions().find(s => io.samePath(s.cwd, task.cwd));
  if (!target) return { status: 'failed', reason: 'no_live_session' };

  // Queue-full precheck (P1-4): _sendUserMessage resolves normally even when the queue
  // rejects the message (broadcasts queue-rejected and returns), so a dispatched verdict
  // would be a lie. Check the queue depth first. NOTE the contract: getQueueSnapshot()
  // returns an ARRAY (sdk-manager _getQueueSnapshot → _messageQueue.map(...)), not an
  // {items} object — normalize both shapes defensively.
  try {
    const snap = sdk.getQueueSnapshot ? sdk.getQueueSnapshot({ instanceKey: target.instanceKey }) : null;
    const depth = Array.isArray(snap) ? snap.length : (Array.isArray(snap?.items) ? snap.items.length : 0);
    if (depth >= 50) return { status: 'failed', reason: 'queue_rejected' };
  } catch { /* precheck is best-effort; fall through to send */ }

  try {
    // Fire-and-forget: acceptance = dispatched. The turn's own outcome is presented by
    // the conversation itself (resident result carries no success/failure to us).
    await sdk.sendUserMessage(task.prompt, { cwd: task.cwd, project: task.project, instanceKey: target.instanceKey });
    return { status: 'dispatched' };
  } catch (err) {
    return { status: 'failed', reason: 'internal', error: String(err?.message || err) };
  }
}

async function _injectPty(task, io) {
  const pty = io.pty;
  if (!pty) return { status: 'failed', reason: 'no_live_session' };
  // Candidate Claude PTYs for the task's cwd.
  const live = pty.listLivePtys().filter(p => p.ptyKind === 'claude' && io.samePath(p.cwd, task.cwd));
  if (!live.length) return { status: 'failed', reason: 'no_live_session' };
  const target = live.find(p => p.isActive) || live[0];

  // STRICT precheck (P0-2): getPtyKindFor with ONLY instanceKey — _resolveKey does NOT
  // fall back to project/active when no cwd/project is given, so a dead instance yields
  // null instead of silently resolving to a same-project sibling or the wrong project's
  // active session.
  const kind = pty.getPtyKindFor({ instanceKey: target.instanceKey });
  if (kind !== 'claude') return { status: 'failed', reason: 'no_live_session' };

  // enqueue sanitizes, queues while busy, and injects via the IM bridge's bracketed-paste
  // path. strictAnchor tells the drain path to stay strict (see chat-queue _injectHead).
  const item = io.chatQueue.enqueue(task.prompt, { project: task.project, instanceKey: target.instanceKey, strictAnchor: true });
  if (!item) return { status: 'failed', reason: 'queue_rejected' };
  return { status: 'dispatched' };
}

async function _spawn(task, claim, io) {
  if (!io.isSdkMode) return { status: 'failed', reason: 'spawn_unavailable' };
  const sdk = io.sdk;
  if (!sdk || typeof sdk.spawnEphemeralSession !== 'function') return { status: 'failed', reason: 'spawn_unavailable' };
  const startedAt = Date.now();
  try {
    // Permission mode (security P1-3): 'default' (the stored default) forces approval
    // prompts; 'inherit' passes undefined so the child uses the host session's mode.
    const permissionMode = task.permissionMode === 'inherit' ? undefined : 'default';
    const r = await sdk.spawnEphemeralSession(task.prompt, { cwd: task.cwd, project: task.project, signal: claim?.signal, permissionMode });
    if (r.ok) return { status: 'completed', sessionId: r.sessionId, durationMs: Date.now() - startedAt };
    return { status: 'error', reason: r.reason || 'internal', error: r.error || null, sessionId: r.sessionId || null, durationMs: Date.now() - startedAt };
  } catch (err) {
    return { status: 'error', reason: 'internal', error: String(err?.message || err), durationMs: Date.now() - startedAt };
  }
}
