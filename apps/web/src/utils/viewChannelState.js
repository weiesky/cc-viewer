/**
 * Per-channel view state (per-workspace SSE channels, 2026-10).
 *
 * One AppBase renders ONE channel at a time, but up to `maxChannels` channels
 * stay connected in the background. Each channel owns a `vm` holding (i) the
 * committed React slice — the authoritative copy of everything the view would
 * render for that scope — (ii) the channel's live signals/timers, and (iii) a
 * bounded journal of live entries accumulated while the channel was in the
 * background (drained into the pipeline on a warm switch).
 *
 * Pure + dependency-free (no DOM/React) so it is directly node-testable
 * (house precedent: utils/viewStateCache.js).
 */

/** Keys of the per-channel React slice — the fields AppBase swaps in/out of
 *  this.state on a render-scope switch. Kept as an exported list so the switch
 *  code can never drift from the factory shape. */
export const REACT_SLICE_KEYS = [
  'requests', 'thinkingRequests', 'v2Rows', 'v2RowsMeta', 'mainAgentSessions', 'selectedIndex',
  'pinnedSessionTs', 'streamingLatest', 'isStreaming', 'turnActive',
  'contextWindow', 'serverCachedContent',
  'contextBarLocked', 'contextBarOptimistic',
  'fileLoading', 'fileLoadingCount', 'fileLoadingBytes',
];

export function createChannelState() {
  return {
    // Committed React slice (authoritative while this channel is rendered).
    react: {
      requests: [],
      thinkingRequests: [],
      v2Rows: [],
      v2RowsMeta: { totalCount: 0, hasMore: false, oldestTs: '' },
      mainAgentSessions: [],
      selectedIndex: null,
      pinnedSessionTs: null,
      streamingLatest: null,
      isStreaming: false,
      turnActive: false,
      contextWindow: null,
      serverCachedContent: null,
      contextBarLocked: false,
      contextBarOptimistic: false,
      fileLoading: false,
      fileLoadingCount: 0,
      fileLoadingBytes: null,
    },
    // Channel-scoped timers/scratch — must NOT be shared across scopes (a
    // background channel's timer must never write the rendered view's state).
    turnActiveSince: null,
    turnSignalTs: null,
    turnStaleTimer: null,
    streamingOffTimer: null,
    streamingRaf: null,
    pendingStreamingLatest: null,
    clearOptimisticTimer: null,
    currentSessionId: null,
    prevMainAgentTs: null,
    // Cache-loss HUD state (index-keyed against THIS channel's list — moving it
    // with the channel stops badges pointing at the other scope's rows).
    cacheLossMap: null,
    cacheLossProcessedCount: 0,
    cacheLossLastMainAgent: null,
    cacheLossShowAll: false,
    // Live-view loading trackers (wire v3 byte progress).
    v3BytesTotal: 0,
    v3RecvBytes: 0,
    hasViewCache: false,
    cacheKey: null,
    // Per-channel v3 assembler state: each scope keeps its own conv/resp
    // channels so a background switch never wipes a mid-stream pointer (the
    // single-shared-assembler warm-switch corruption). Instances are created
    // lazily by AppBase via its factory to keep this module dependency-free.
    v3AssemblerInst: null,
    v3SeenLive: null,
    v3AdaptSource: null,
    v3Adapted: null,
    // Live-entry journal for instant warm switch: ENTRIES built live by this
    // channel's own assembler (never raw frames), so the warm drain replays
    // finished v1-shape entries through the existing incremental merge.
    journal: [],
    journalDropped: false,
    lastCommittedTs: null,
    lastCommittedCount: 0,
    committed: false, // a load_end has landed on this channel at least once
    // Freshness bookkeeping for the warm gate.
    lastFrameAt: 0,
    reconnectsSinceCommit: 0,
  };
}

/**
 * Append one assembled entry to the channel journal. Past the cap the journal
 * is dropped wholesale (journalDropped) — a partial replay would silently
 * truncate the conversation, and the warm-stale path (?since&cc) is strictly
 * safer than a partial journal.
 * @param {object} vm - channel state
 * @param {object} entry - assembled v1-shape entry
 * @param {number} [cap]
 */
export function appendJournal(vm, entry, cap = 2000) {
  if (!vm || vm.journalDropped) return;
  vm.journal.push(entry);
  if (vm.journal.length > cap) {
    vm.journal = [];
    vm.journalDropped = true;
  }
}

/**
 * The view-cache key for a scope — deliberately the SAME key space as
 * AppBase._snapshotCurrentView (`project` or `project\x00instance`, never the
 * channel-map's `project:` prefix), so an evicted channel's snapshot is found
 * by the existing restore path.
 * @param {{project?: string|null, instance?: string|null}} scope
 * @returns {string|null} cache key, or null when there is nothing to key on
 */
export function cacheKeyForScope(scope) {
  const p = scope && typeof scope.project === 'string' && scope.project ? scope.project : null;
  if (!p) return null;
  const i = scope && typeof scope.instance === 'string' && scope.instance ? scope.instance : null;
  return i ? `${p}\x00${i}` : p;
}

/**
 * Cancel every timer/raf a channel may have armed (eviction/close path). The
 * caller passes its platform cancel fns so this module stays platform-free.
 */
export function clearChannelTimers(vm, { clearTimeout, cancelAnimationFrame } = {}) {
  if (!vm) return;
  const ct = typeof clearTimeout === 'function' ? clearTimeout : () => {};
  const caf = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : () => {};
  if (vm.turnStaleTimer) { ct(vm.turnStaleTimer); vm.turnStaleTimer = null; }
  if (vm.streamingOffTimer) { ct(vm.streamingOffTimer); vm.streamingOffTimer = null; }
  if (vm.clearOptimisticTimer) { ct(vm.clearOptimisticTimer); vm.clearOptimisticTimer = null; }
  if (vm.streamingRaf) { caf(vm.streamingRaf); vm.streamingRaf = null; }
}
