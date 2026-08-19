// Waiter-liveness reaper for short-poll AskUserQuestion entries.
//
// Problem: when the user declines an AskUserQuestion at the Claude Code CLI, the
// ask-bridge hook subprocess is SIGTERMed. Its short-poll GET loop simply stops;
// the GET close handler in ask-perm.js only unregisters the poll listener (a socket
// close is indistinguishable from the normal ~25s re-poll cycle), so nothing ever
// resolves the entry. It then stays `pending` in memory (24h timer) and on disk,
// and the WS reconnect replay keeps popping a dead "Question" modal.
//
// Fix: track when the waiter last proved it was alive (POST create / GET poll /
// hanging listener / open POST socket) and cancel entries whose waiter has gone
// silent for ASK_WAITER_LIVENESS_MS. This is NOT an ask timeout — the
// "GUI effectively no-timeout" contract holds; a connected bridge keeps its ask
// alive indefinitely. A falsely-reaped bridge degrades gracefully: its next GET
// hits consumeIfFinal and receives a definitive `{cancelled}` (never a 404 loop).
//
// Cross-instance safety: the ask-store file is SHARED by every cc-viewer instance
// (global ~/.claude/cc-viewer/). reapDeadAskWaiters therefore touches ONLY entries
// this instance owns in its pendingAskHooks Map (memory = ownership). Disk-only
// orphans are handled by sweepOrphanedDiskAsks, a one-shot boot sweep that runs
// only when no other cc-viewer instance is listening on the CCV port range.
import { ASK_WAITER_LIVENESS_MS, ASK_WAITER_REAP_INTERVAL_MS } from './ask-constants.js';

/**
 * Broadcast a cancel to browsers + short-poll listeners + parent process.
 * Shared by the periodic reaper and the boot sweep.
 */
async function cancelAndBroadcast(deps, id, reason) {
  const wrote = await deps.markCancelled(id, reason);
  if (!wrote) return false; // an answer/cancel landed first — never clobber, never broadcast
  try { deps.notifyShortPollCancel?.(id, reason); } catch {}
  try { deps.broadcastCancelled?.(id, reason); } catch {}
  try { deps.notifyParentPending?.({ type: 'ask-hook-cancelled', id }); } catch {}
  return true;
}

/**
 * Periodic sweep over MEMORY-OWNED short-poll entries whose waiter went silent.
 *
 * deps: {
 *   pendingAskHooks: Map<id, {questions,res,timer,createdAt,shortPoll}>,
 *   shortPollListeners: Map<id, Set<{finished}>>,
 *   askWaiterLastPoll: Map<id, ms>,          // written by POST create + GET poll
 *   markCancelled(id, reason) -> Promise<boolean>,
 *   loadAskStore() -> {id: entry},
 *   notifyShortPollCancel?(id, reason), broadcastCancelled?(id, reason),
 *   notifyParentPending?(msg),
 *   livenessMs?, reapIntervalMs?,
 * }
 * state: caller-held mutable { lastSweepAt } so the wake guard survives across calls.
 */
export async function reapDeadAskWaiters(deps, state, { now = Date.now() } = {}) {
  const livenessMs = deps.livenessMs ?? ASK_WAITER_LIVENESS_MS;
  const intervalMs = deps.reapIntervalMs ?? ASK_WAITER_REAP_INTERVAL_MS;
  const lastPoll = deps.askWaiterLastPoll;

  const candidates = [];
  for (const [id, entry] of deps.pendingAskHooks) {
    if (entry && entry.shortPoll === true) candidates.push([id, entry]);
  }

  // Wake guard: after a laptop sleep / long event-loop stall the (same-machine)
  // bridge slept too and hasn't had a chance to re-poll. Re-baseline instead of
  // reaping on the first sweep after resume.
  const prevSweepAt = state.lastSweepAt ?? now;
  state.lastSweepAt = now;
  if (now - prevSweepAt > 3 * intervalMs) {
    for (const [id] of candidates) lastPoll.set(id, now);
    return { reaped: [], rebaselined: true };
  }

  const reaped = [];
  for (const [id, entry] of candidates) {
    // Open POST socket = waiter provably alive (covers the plugin onAskRequest
    // window, where the short-poll ack has not been written yet and no GETs flow).
    if (entry.res && !entry.res.writableEnded && !entry.res.destroyed) {
      lastPoll.set(id, now);
      continue;
    }
    // A hanging unfinished GET listener = waiter connected right now
    // (covers legitimate wait=60000 pollers beyond the liveness window).
    const listeners = deps.shortPollListeners.get(id);
    let hasLive = false;
    if (listeners) {
      for (const l of listeners) { if (l && !l.finished) { hasLive = true; break; } }
    }
    if (hasLive) {
      lastPoll.set(id, now);
      continue;
    }
    const last = lastPoll.get(id) ?? entry.createdAt ?? now;
    if (now - last < livenessMs) continue;

    // Waiter is gone. Clean memory unconditionally; write/broadcast the cancel
    // only when the shared disk row still exists as ours to resolve (an absent
    // row means another instance's answer consumed it — do not fabricate a
    // cancelled placeholder or grey out a real answer).
    if (entry.timer) clearTimeout(entry.timer);
    deps.pendingAskHooks.delete(id);
    lastPoll.delete(id);
    const diskRow = deps.loadAskStore()[id];
    if (diskRow) {
      await cancelAndBroadcast(deps, id, 'hook waiter lost');
    }
    reaped.push(id);
  }

  // GC liveness records for ids no longer pending in this instance.
  for (const id of lastPoll.keys()) {
    if (!deps.pendingAskHooks.has(id)) lastPoll.delete(id);
  }
  return { reaped, rebaselined: false };
}

/**
 * Parse `lsof -Fp` output into pids, excluding our own. Strict `^p\d+$` lines only
 * (mirrors isAnyCcvBusy in updater.js).
 */
function otherCcvPids(lsofOut, ownPid) {
  return String(lsofOut).replace(/\r/g, '').split('\n')
    .filter((l) => /^p\d+$/.test(l))
    .map((l) => Number(l.slice(1)))
    .filter((n) => Number.isFinite(n) && n > 0 && n !== ownPid);
}

/**
 * One-shot boot sweep: cancel disk-only pending entries orphaned by a previous
 * server process. Runs ONLY when this is provably the sole cc-viewer instance
 * (lsof scan of the CCV port range); on any doubt (another pid listening, lsof
 * missing/failing, win32) it skips entirely — another instance may own those
 * entries, and its own reaper / the fallback UI handles them.
 *
 * deps: reapDeadAskWaiters deps plus {
 *   bootTime: ms, ownPid: number, portRange: [start, end],
 *   lsofImpl?(cmd) -> string,   // injectable for tests; default caller-provided
 *   platform?: string,          // default process.platform
 * }
 */
export async function sweepOrphanedDiskAsks(deps, { now = Date.now() } = {}) {
  const plat = deps.platform ?? process.platform;
  if (plat === 'win32' || typeof deps.lsofImpl !== 'function') return { swept: [], skipped: true };
  const [start, end] = deps.portRange;
  let out;
  try {
    // lsofImpl may be sync or async (production uses async exec to keep the
    // event loop free); await handles both.
    out = await deps.lsofImpl(`lsof -iTCP:${start}-${end} -sTCP:LISTEN -P -n -Fp`);
  } catch {
    return { swept: [], skipped: true }; // conservative: cannot prove we are alone
  }
  if (otherCcvPids(out, deps.ownPid).length > 0) return { swept: [], skipped: true };

  const swept = [];
  const all = deps.loadAskStore();
  for (const e of Object.values(all)) {
    if (!e || e.status !== 'pending') continue;
    if (!Array.isArray(e.questions) || e.questions.length === 0) continue;
    if (typeof e.createdAt === 'number' && e.createdAt >= deps.bootTime) continue; // ours / fresh
    if (deps.pendingAskHooks.has(e.id)) continue; // owned by this instance
    const wrote = await cancelAndBroadcast(deps, e.id, 'orphaned pending ask (owner instance gone)');
    if (wrote) swept.push(e.id);
  }
  return { swept, skipped: false };
}
