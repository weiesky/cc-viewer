// CLIENT-SAFE: no node deps. Imported by src/ — do not add fs/process/node: imports.
/**
 * V2 Transcript Normalizer — Claude Code 2.x JSONL → legacy-compatible entry
 *
 * Claude Code 2.x writes session transcripts in a new line format: each JSONL
 * line carries `{ type, message: { role, content }, parentUuid, sessionId,
 * timestamp, ... }` and has NO `body` / `mainAgent` / `_deltaFormat` / `url`.
 * The legacy cc-viewer pipeline (isMainAgent + delta-reconstructor +
 * applyBatchEntryTimestamps + mergeMainAgentSessions) only understands
 * `{ mainAgent: true, body: { messages } }` requests, so v2 lines currently
 * never reach the Chat view — they surface in the raw request list as
 * text-only rows.
 *
 * Key insight: v2 `message.content` blocks are byte-identical to the API wire
 * format (tool_use / tool_result / text / thinking / image). Reassembling them
 * into a legacy-shaped entry therefore unlocks the entire existing render
 * chain (toolResultMap pairing → extractToolResultImages → ToolResultView)
 * with zero changes there.
 *
 * Design decisions (validated against real 2.x transcripts):
 * - One synthetic entry per (sessionId, /clear segment). Segments preserve the
 *   v1 /clear session-boundary semantics; entry.timestamp = messages[0]._timestamp
 *   so the `entry.timestamp === messages[0]._timestamp` invariant held by
 *   sessionManager (stable session id / pin) is satisfied.
 * - Synthetic entries are APPENDED to the end of the entries array (never
 *   interleaved with legacy rows) so a synthetic baseline cannot poison
 *   subsequent legacy delta reconstruction.
 * - Assistant rows sharing a `message.id` (a single assistant message split
 *   across thinking/text/tool_use lines) are merged into one message, mirroring
 *   the legacy message shape.
 * - Line-level dedup key is `uuid` — message.id is shared across a message's
 *   split rows, promptId is shared across a turn, and timestamps collide
 *   (8 same-ms groups observed in real data).
 * - The redundant top-level `toolUseResult` (a second, binary encoding of the
 *   same image) is ignored — message.content already carries the standard
 *   base64 data; honoring both would double memory.
 * - Metadata rows (mode / ai-title / last-prompt / file-history-snapshot /
 *   queue-operation) carry no message and are dropped — isRelevantRequest
 *   would otherwise surface them as garbage request rows.
 */

const V2_LINE_TYPES = new Set(['user', 'assistant']);
const V2_LINE_ROLES = new Set(['user', 'assistant']);

// /clear marker in a string user content — a segment boundary. Matches ONLY
// the explicit command tag (v1 /clear rows carry `<command-name>/clear</command-name>`);
// a bare "clear" user message must never split the session. /compact is
// deliberately NOT a boundary: legacy semantics treat it as a same-session
// continuation (session-boundary.js), so v2 rows must match that.
const CLEAR_CMD_RE = /<command-name>\/?(?:clear)<\/command-name>/i;

const DEDUP_MAX = 1024;

/**
 * True when `entry` is a v2 transcript line worth rendering: a user/assistant
 * message row on the main agent stream (isSidechain marks teammate rows, which
 * must never enter the main-agent session — same rationale as the
 * delta-reconstructor teammate exclusion).
 */
export function isV2TranscriptLine(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (!V2_LINE_TYPES.has(entry.type)) return false;
  if (entry.isSidechain === true) return false;
  const msg = entry.message;
  if (!msg || typeof msg !== 'object') return false;
  return V2_LINE_ROLES.has(msg.role);
}

/**
 * True for a legacy (or already-normalized) renderable request row.
 * Anything that is neither a v2 line nor a legacy request is a metadata row
 * (mode / ai-title / ...) and gets dropped by normalizeV2Entries.
 */
function isLegacyRequestLine(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.mainAgent === true) return true;
  if (entry.body && Array.isArray(entry.body.messages)) return true;
  return typeof entry.url === 'string' && entry.url.length > 0;
}

/**
 * True for a metadata row (mode / ai-title / last-prompt / file-history-snapshot
 * / queue-operation / system / attachment frames): neither a v2 transcript
 * line nor a legacy request. isRelevantRequest would otherwise surface these
 * as garbage rows, so the live SSE path skips them.
 */
export function isMetadataRow(entry) {
  if (!entry || typeof entry !== 'object') return false;
  return !isV2TranscriptLine(entry) && !isLegacyRequestLine(entry);
}

function parseTs(ts) {
  if (typeof ts !== 'string') return 0;
  const n = Date.parse(ts);
  return Number.isFinite(n) ? n : 0;
}

function isClearRow(entry) {
  const c = entry?.message?.content;
  return typeof c === 'string' && CLEAR_CMD_RE.test(c);
}

/** Sort v2 lines by timestamp; equal timestamps keep input (file) order
 *  (Array.prototype.sort is stable per ES2019). */
function sortLines(lines) {
  return [...lines].sort((a, b) => parseTs(a.timestamp) - parseTs(b.timestamp));
}

/**
 * Merge the lines of one /clear segment into an ordered message array.
 * Assistant rows sharing a message.id are folded into a single message with
 * concatenated content (thinking → text → tool_use order by timestamp).
 *
 * @returns {Array} messages, each pre-stamped with _timestamp / _generatedTs
 *   (assistant) / _entryTs (filled below in buildSyntheticEntry).
 */
function buildSegmentMessages(lines) {
  const messages = [];
  const assistantById = new Map(); // message.id → message object
  for (const line of lines) {
    const msg = line.message;
    if (msg.role === 'user') {
      messages.push({
        role: 'user',
        content: msg.content,
        _timestamp: line.timestamp,
        _generatedTs: undefined,
      });
      continue;
    }
    // assistant
    const mid = msg.id;
    if (mid && assistantById.has(mid)) {
      const existing = assistantById.get(mid);
      if (Array.isArray(msg.content) && Array.isArray(existing.content)) {
        existing.content = existing.content.concat(msg.content);
      } else if (Array.isArray(msg.content) && typeof existing.content === 'string') {
        // legacy string content: replace with the array form
        existing.content = msg.content;
      } else if (typeof msg.content === 'string' && typeof existing.content === 'string') {
        existing.content = existing.content + '\n' + msg.content;
      }
      if (line.timestamp) existing._generatedTs = line.timestamp;
      if (msg.model) existing.model = msg.model;
      if (msg.usage) existing.usage = msg.usage;
      continue;
    }
    const m = {
      role: 'assistant',
      content: msg.content,
      _timestamp: line.timestamp,
      _generatedTs: line.timestamp,
    };
    if (msg.model) m.model = msg.model;
    if (msg.usage) m.usage = msg.usage;
    if (mid) m._mid = mid; // merge-key for the incremental normalizer
    messages.push(m);
    if (mid) assistantById.set(mid, m);
  }
  return messages;
}

/**
 * Build one synthetic legacy entry from the sorted v2 lines of a single
 * sessionId segment. `messages` are pre-stamped with per-line _timestamp /
 * _generatedTs; _entryTs is filled here to satisfy the entry.timestamp ===
 * messages[0]._timestamp invariant.
 */
export function buildSyntheticEntry(lines, sessionId, segIdx) {
  const messages = buildSegmentMessages(lines);
  if (messages.length === 0) return null;
  const entryTs = messages[0]._timestamp;
  for (const m of messages) m._entryTs = entryTs;

  // Last assistant row carries model/usage — expose it as a synthetic
  // response so model display / token stats / KV-cache branches work.
  let lastModel = null;
  let lastUsage = null;
  for (const m of messages) {
    if (m.role === 'assistant') {
      if (m.model) lastModel = m.model;
      if (m.usage) lastUsage = m.usage;
    }
  }

  const entry = {
    mainAgent: true,
    body: { messages },
    timestamp: entryTs,
    url: `claude-code://session/${sessionId}:${segIdx}`,
    sessionId,
    _seqEpoch: `v2:${sessionId}:${segIdx}`,
    _syntheticV2: true,
    _messageCount: messages.length,
  };
  if (lastModel || lastUsage) {
    entry.response = { body: {} };
    if (lastModel) entry.response.body.model = lastModel;
    if (lastUsage) entry.response.body.usage = lastUsage;
  }
  return entry;
}

/**
 * Split sorted v2 lines of one sessionId into /clear-delimited segments.
 * A /clear row starts a new segment (it carries the command itself), so the
 * caveat/descendant rows land in the new segment — mirroring v1's
 * "new session after /clear" behavior.
 */
function splitSegments(sortedLines) {
  const segments = [];
  let current = [];
  for (const line of sortedLines) {
    if (isClearRow(line)) {
      // /clear closes the current segment and starts a new one; the command
      // row itself is not conversation content, so it is dropped.
      if (current.length > 0) segments.push(current);
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

/**
 * Batch normalizer: convert v2 transcript lines in `rawEntries` into
 * legacy-shaped synthetic entries.
 *
 * - No v2 lines → returns the SAME array reference (zero behavior change).
 * - Metadata rows (neither v2 nor legacy) are dropped.
 * - Legacy rows keep their relative order; synthetic entries are appended at
 *   the end (per sessionId, ts-sorted, /clear-segmented) so a synthetic
 *   baseline can never precede legacy delta rows.
 */
export function normalizeV2Entries(rawEntries) {
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) return rawEntries;

  let v2Count = 0;
  const kept = [];
  for (const e of rawEntries) {
    if (isV2TranscriptLine(e)) {
      v2Count++;
    } else if (isLegacyRequestLine(e)) {
      kept.push(e);
    }
    // metadata rows: dropped
  }
  if (v2Count === 0) return rawEntries;

  const bySession = new Map(); // sessionId → v2 lines
  for (const e of rawEntries) {
    if (!isV2TranscriptLine(e)) continue;
    const sid = e.sessionId || 'unknown';
    let arr = bySession.get(sid);
    if (!arr) bySession.set(sid, (arr = []));
    arr.push(e);
  }

  const synthetics = [];
  for (const [sid, lines] of bySession) {
    const sorted = sortLines(lines);
    const segments = splitSegments(sorted);
    for (let i = 0; i < segments.length; i++) {
      const entry = buildSyntheticEntry(segments[i], sid, i);
      if (entry) synthetics.push(entry);
    }
  }
  return [...kept, ...synthetics];
}

/**
 * Incremental normalizer for live SSE: rebuilds the accumulated message array
 * line by line and returns the current full synthetic entry per line.
 *
 * Ordering: live trusts append order (single-writer append-only file; replay
 * is deduped by uuid). Timestamp reordering only matters for historical files,
 * which the batch path handles.
 *
 * `prime(syntheticEntry)` seeds accumulated from a cold-loaded synthetic entry
 * so the first live flush extends the existing session instead of truncating
 * it (merge's REBUILD branch would replace a 282-message session with a
 * 1-message snapshot on an empty baseline).
 */
export function createV2IncrementalReconstructor() {
  const state = {
    sessionId: null,
    entryTs: null,
    epoch: null,           // _seqEpoch carried by snapshots (must match the
                           // primed cold entry's segment epoch, or the merge
                           // boundary check would split the session)
    accumulated: null,     // array of messages (cold snapshot or live-built)
    shared: false,         // accumulated entries came from prime (copy-on-write)
    assistantById: new Map(),
    // tool_use blocks merged into an already-scanned message by a later split
    // row (thinking/text/tool_use share a message.id). ChatView's incremental
    // toolResultMap scans by message index only, so these would never pair —
    // they are surfaced here for a follow-up scan.
    mergedToolUses: [],
    seenUuids: new Set(),
    uuidOrder: [],
    lastAssistant: null,
  };

  /**
   * Merge one live assistant line into accumulated.
   * A row sharing a cold message's _mid appends to that message — with
   * copy-on-write: primed messages are shallow clones shared with the rendered
   * cold entry, so the target is re-cloned (message + content array) before
   * mutating, keeping the rendered snapshot pristine.
   */
  function pushAssistant(msg) {
    const mid = msg._mid;
    if (mid && state.assistantById.has(mid)) {
      let existing = state.assistantById.get(mid);
      if (state.shared && state.accumulated.includes(existing)) {
        const clone = {
          ...existing,
          content: Array.isArray(existing.content) ? [...existing.content] : existing.content,
        };
        const idx = state.accumulated.indexOf(existing);
        state.accumulated[idx] = clone;
        state.assistantById.set(mid, clone);
        if (state.lastAssistant === existing) state.lastAssistant = clone;
        existing = clone;
      }
      if (Array.isArray(msg.content) && Array.isArray(existing.content)) {
        existing.content = existing.content.concat(msg.content);
      }
      if (msg._generatedTs) existing._generatedTs = msg._generatedTs;
      if (msg.model) existing.model = msg.model;
      if (msg.usage) existing.usage = msg.usage;
      // Surface newly merged tool_use blocks on the message itself AND the
      // entry-level _toolUses — the message may have already been scanned by
      // the incremental toolResultMap, so the blocks must be re-registered.
      const merged = [];
      if (Array.isArray(msg.content)) {
        for (const b of msg.content) {
          if (b && b.type === 'tool_use' && b.id) {
            merged.push(b);
            state.mergedToolUses.push(b);
          }
        }
      }
      if (merged.length > 0) {
        existing._toolUses = [...(existing._toolUses || []), ...merged];
      }
      state.lastAssistant = existing;
      return existing;
    }
    const m = {
      role: 'assistant',
      content: msg.content,
      _timestamp: msg._timestamp,
      _generatedTs: msg._generatedTs,
    };
    if (msg.model) m.model = msg.model;
    if (msg.usage) m.usage = msg.usage;
    if (mid) m._mid = mid;
    state.accumulated.push(m);
    state.assistantById.set(mid, m);
    state.lastAssistant = m;
    return m;
  }

  function snapshotEntry() {
    const messages = [...state.accumulated];
    // entry.timestamp must equal messages[0]._timestamp (the invariant
    // sessionManager's stable session id / pin depends on). After a live
    // /clear the segment starts fresh, so fall back to the first message's ts
    // instead of the stale clear-row ts (same as the batch path).
    const entryTs = messages.length > 0 ? (messages[0]._timestamp || state.entryTs) : state.entryTs;
    const epoch = state.epoch || `v2:${state.sessionId}:0`;
    const entry = {
      mainAgent: true,
      body: { messages },
      timestamp: entryTs,
      url: `claude-code://session/${state.sessionId}:${epoch.slice(epoch.lastIndexOf(':') + 1)}`,
      sessionId: state.sessionId,
      _seqEpoch: epoch,
      _syntheticV2: true,
      _messageCount: messages.length,
    };
    if (state.lastAssistant) {
      const body = {};
      if (state.lastAssistant.model) body.model = state.lastAssistant.model;
      if (state.lastAssistant.usage) body.usage = state.lastAssistant.usage;
      if (body.model || body.usage) entry.response = { body };
    }
    // Surface merged tool_use blocks for the incremental toolResultMap scan
    // (drained per snapshot — each entry carries only the not-yet-paired ones).
    if (state.mergedToolUses.length > 0) {
      entry._toolUses = state.mergedToolUses.splice(0);
    }
    return entry;
  }

  return {
    /** @returns {boolean} true when no baseline exists yet. */
    empty() {
      return state.accumulated === null;
    },

    /**
     * Seed accumulated from a cold-loaded synthetic entry (same sessionId).
     * Messages are shallow-copied so later live appends never mutate the
     * rendered cold snapshot.
     */
    prime(syntheticEntry) {
      if (!syntheticEntry || syntheticEntry._syntheticV2 !== true) return;
      if (state.accumulated !== null) return;
      const messages = (syntheticEntry.body && syntheticEntry.body.messages) || [];
      if (messages.length === 0) return;
      state.sessionId = syntheticEntry.sessionId || 'unknown';
      state.entryTs = syntheticEntry.timestamp;
      state.epoch = syntheticEntry._seqEpoch || null;
      state.accumulated = messages.map((m) => ({
        ...m,
        content: Array.isArray(m.content) ? [...m.content] : m.content,
      }));
      state.shared = true;
      state.assistantById.clear();
      for (const m of state.accumulated) {
        if (m.role === 'assistant') {
          if (m._mid) state.assistantById.set(m._mid, m);
          state.lastAssistant = m;
        }
      }
    },

    /**
     * Process one v2 line, returning the current full synthetic entry, or null
     * for a skip (sidechain row, replay of a seen uuid).
     * Non-v2 lines are passed through unchanged (defensive; callers branch on
     * isV2TranscriptLine first).
     */
    reconstruct(line) {
      if (!isV2TranscriptLine(line)) return null;
      // Session switch (workspace switch / another project's file on the same
      // SSE): the old session is already rendered — drop its baseline and
      // start a fresh one so rows never cross sessions.
      if (state.sessionId !== null && line.sessionId && line.sessionId !== state.sessionId) {
        state.sessionId = line.sessionId;
        state.entryTs = line.timestamp;
        state.epoch = null;
        state.accumulated = [];
        state.shared = false;
        state.assistantById.clear();
        state.lastAssistant = null;
        state.mergedToolUses = [];
      }
      const uuid = line.uuid;
      if (uuid && state.seenUuids.has(uuid)) return null;
      if (uuid) {
        state.seenUuids.add(uuid);
        state.uuidOrder.push(uuid);
        if (state.uuidOrder.length > DEDUP_MAX) {
          state.seenUuids.delete(state.uuidOrder.shift());
        }
      }
      if (state.accumulated === null) {
        // No cold baseline (tail-load / file-mid start): begin fresh.
        state.sessionId = line.sessionId || 'unknown';
        state.entryTs = line.timestamp;
        state.epoch = null;
        state.accumulated = [];
        state.shared = false;
      }
      const msg = line.message;
      if (msg.role === 'user' && isClearRow(line)) {
        // Live /clear: start a new segment (new epoch) so the batch and live
        // paths split sessions identically. The command row itself is dropped.
        // seenUuids is intentionally kept — a replay of a pre-clear row must
        // still dedup; a replay of the clear row itself returns null above.
        // Returns null (skip): an empty snapshot would sink into requests as a
        // ghost MainAgent entry / empty session (regression P2).
        state.epoch = `v2:${state.sessionId}:${(state.epoch?.split(':').pop() ?? 0) + 1}`;
        state.entryTs = null; // first message of the new segment owns the ts
        state.accumulated = [];
        state.shared = false;
        state.assistantById.clear();
        state.lastAssistant = null;
        state.mergedToolUses = [];
        return null;
      }
      if (msg.role === 'user') {
        const m = {
          role: 'user',
          content: msg.content,
          _timestamp: line.timestamp,
        };
        state.accumulated.push(m);
      } else {
        pushAssistant({
          _mid: msg.id,
          content: msg.content,
          _timestamp: line.timestamp,
          _generatedTs: line.timestamp,
          model: msg.model,
          usage: msg.usage,
        });
      }
      return snapshotEntry();
    },

    reset() {
      state.sessionId = null;
      state.entryTs = null;
      state.epoch = null;
      state.accumulated = null;
      state.shared = false;
      state.assistantById.clear();
      state.seenUuids.clear();
      state.uuidOrder = [];
      state.lastAssistant = null;
    },
  };
}
