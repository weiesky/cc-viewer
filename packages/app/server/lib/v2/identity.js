// Wire Format v2 — identity resolution (docs/refactor/WIRE_FORMAT_V2.md §8/§10).
//
// Two jobs, both pure except for the small per-process state the caller owns:
//  1. parseUserId — extract session_id from body.metadata.user_id, which exists
//     in TWO wire encodings (JSON string in newer CC; underscore-delimited in
//     older CC — both present in real logs, verified during planning).
//  2. ConvResolver — derive a stable conversation key for every request:
//     main / sub-<toolUseId> / sub-fp-<fingerprint> / misc, disambiguating
//     parallel same-prompt subagents via the spawning Agent block's tool_use.id
//     (which v1's prompt-prefix registry loses, plan risk #7).

// Matches v1's extractAgentSpawnPairs keying so both sides observe the same
// prefix (server/lib/interceptor-core.js TEAMMATE_PROMPT_PREFIX_LEN).
export const SPAWN_PROMPT_PREFIX_LEN = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parse a raw metadata.user_id string into { sessionId, encoding } or null.
 * Encodings (spec §8):
 *  - 'json':      '{"device_id":…,"account_uuid":…,"session_id":"<uuid>"}'
 *  - 'delimited': 'user_<hash>_account_<acct?>_session_<uuid>'
 */
export function parseUserId(userIdRaw) {
  if (typeof userIdRaw !== 'string' || userIdRaw === '') return null;
  try {
    const obj = JSON.parse(userIdRaw);
    if (obj && typeof obj.session_id === 'string' && obj.session_id !== '') {
      return { sessionId: obj.session_id, encoding: 'json' };
    }
    return null; // valid JSON but no session_id — treat as unparseable
  } catch { /* not JSON → try the delimited form */ }
  const idx = userIdRaw.lastIndexOf('_session_');
  if (idx >= 0) {
    const tail = userIdRaw.slice(idx + '_session_'.length);
    if (UUID_RE.test(tail)) return { sessionId: tail, encoding: 'delimited' };
  }
  return null;
}

const REMINDER_OPEN = '<system-reminder>';
const REMINDER_CLOSE = '</system-reminder>';

/**
 * Strip harness-injected <system-reminder>…</system-reminder> preambles from
 * the head of a prompt. The harness prepends them to a subagent's first user
 * message on the wire, but Agent/Task tool_use.input.prompt (the spawn-registry
 * key) never contains them — without stripping, the prompt-prefix lookup gets
 * 0 hits and every parallel sub shares one boilerplate fingerprint (real-data
 * finding, plan "关键事实" 2026-07-14). Only leading reminders are removed:
 * callers fingerprint the prompt START.
 */
function stripLeadingReminders(text) {
  let t = text;
  for (;;) {
    const s = t.trimStart();
    if (!s.startsWith(REMINDER_OPEN)) return s;
    const end = s.indexOf(REMINDER_CLOSE);
    if (end < 0) return ''; // unterminated reminder — no usable prompt text
    t = s.slice(end + REMINDER_CLOSE.length);
  }
}

/**
 * First user message's prompt text (string or concatenated text blocks),
 * with leading <system-reminder> preambles stripped and whitespace trimmed
 * at the start.
 */
export function firstUserPromptText(messages) {
  if (!Array.isArray(messages)) return '';
  for (const m of messages) {
    if (!m || m.role !== 'user') continue;
    const c = m.content;
    if (typeof c === 'string') return stripLeadingReminders(c);
    if (Array.isArray(c)) {
      let text = '';
      for (const block of c) {
        if (block && block.type === 'text' && typeof block.text === 'string') text += block.text;
      }
      return stripLeadingReminders(text);
    }
    return '';
  }
  return '';
}

/** Cheap non-cryptographic fingerprint for the fp-fallback conv key. */
export function promptFingerprint(text) {
  let h = 0x811c9dc5; // FNV-1a 32-bit
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Conversation-key resolver for one v2 session. Owns:
 *  - spawn registry: prompt prefix → FIFO of unclaimed Agent tool_use.ids
 *    (a queue, not a single slot — parallel same-prompt spawns each hold their
 *    own id and are claimed in order, unlike v1's overwrite-on-collision map);
 *  - active sub-conversation states for continuity: an incoming sub request
 *    belongs to the existing conversation whose message count it extends.
 */
export class ConvResolver {
  constructor() {
    this._spawnIds = new Map();  // promptPrefix → [toolUseId, ...] unclaimed FIFO
    this._subs = new Map();      // convKey → { firstFp, count }
    this._fpOrdinal = new Map(); // firstFp → next ordinal for fp-fallback keys
  }

  /**
   * Register Agent-spawn pairs from a completed response body (assistant
   * content blocks with type 'tool_use' and name 'Agent'/'Task'). Same keying
   * idea as v1 extractAgentSpawnPairs but keeps the block id (spec §10) and
   * covers 'Task' too (v1's extractor only handles 'Agent'; 'Task' is a
   * recognized spawn tool elsewhere in the codebase, e.g. interceptor-core).
   */
  registerSpawns(responseBody) {
    const content = responseBody && Array.isArray(responseBody.content) ? responseBody.content : null;
    if (!content) return;
    for (const block of content) {
      if (!block || block.type !== 'tool_use') continue;
      if (block.name !== 'Agent' && block.name !== 'Task') continue;
      const prompt = block.input && typeof block.input.prompt === 'string' ? block.input.prompt : '';
      if (!prompt || typeof block.id !== 'string' || block.id === '') continue;
      const prefix = prompt.trimStart().slice(0, SPAWN_PROMPT_PREFIX_LEN);
      if (!this._spawnIds.has(prefix)) this._spawnIds.set(prefix, []);
      this._spawnIds.get(prefix).push(block.id);
    }
  }

  /**
   * Resolve the conv key for a non-main request's messages array.
   * Continuity first (an existing sub whose count this request extends or
   * re-sends), then a fresh key: claimed tool_use.id if the spawn registry has
   * one for this prompt prefix, else fp-fallback with an ordinal suffix so
   * parallel identical prompts without a registered id still split apart.
   */
  resolveSub(messages) {
    const prompt = firstUserPromptText(messages);
    const fp = promptFingerprint(prompt.trimStart().slice(0, 200));
    const len = Array.isArray(messages) ? messages.length : 0;

    // Continuity: same first-message fp AND the message count grows (or stays,
    // for retries) relative to that conversation's last seen count. Prefer the
    // candidate with the highest count still <= len (the closest ancestor).
    // Same-length tie-break: while an UNCLAIMED spawn id exists for this prompt
    // prefix, a same-length duplicate is a parallel sibling spawn, not a retry —
    // claim the fresh id instead of stealing the sibling's conversation.
    // Residual mis-attribution edges (accepted; keys stay distinct, only the
    // label can be wrong): (1) a same-length RETRY racing an unclaimed sibling
    // spawn of the identical prompt claims the sibling's id; (2) a fresh
    // sibling whose first request already has MORE messages than an existing
    // sibling's count extends that one instead of opening its own key.
    const prefix = prompt.trimStart().slice(0, SPAWN_PROMPT_PREFIX_LEN);
    const pendingSpawn = this._spawnIds.has(prefix);
    let best = null;
    for (const [key, st] of this._subs) {
      if (st.firstFp !== fp) continue;
      const extend = len > st.count || (len === st.count && !pendingSpawn);
      if (extend && (!best || st.count > best.st.count)) best = { key, st };
    }
    if (best) {
      best.st.count = len;
      return { convKey: best.key, isNew: false };
    }

    // New sub conversation — prefer the spawning Agent block's tool_use.id.
    const queue = this._spawnIds.get(prefix);
    let convKey;
    if (queue && queue.length > 0) {
      convKey = `sub-${queue.shift().slice(-12)}`;
      if (queue.length === 0) this._spawnIds.delete(prefix);
    } else {
      const n = (this._fpOrdinal.get(fp) || 0) + 1;
      this._fpOrdinal.set(fp, n);
      convKey = n === 1 ? `sub-fp-${fp}` : `sub-fp-${fp}-${n}`;
    }
    this._subs.set(convKey, { firstFp: fp, count: len });
    return { convKey, isNew: true };
  }

  reset() {
    this._spawnIds.clear();
    this._subs.clear();
    this._fpOrdinal.clear();
  }
}

/**
 * Classify a request entry into a journal `kind` (spec §4). `entry` is the v1
 * requestEntry shape at initiation time (isHeartbeat/isCountTokens/mainAgent/
 * teammate already stamped by the interceptor).
 */
export function classifyKind(entry) {
  if (entry.isHeartbeat) return 'heartbeat';
  if (entry.isCountTokens) return 'countTokens';
  if (entry.teammate) return 'teammate';
  if (entry.mainAgent) return 'main';
  if (entry.body && Array.isArray(entry.body.messages)) return 'sub';
  return 'misc';
}
