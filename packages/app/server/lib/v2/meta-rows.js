/**
 * Wire v3 (V3.S2) — request-list metadata rows.
 *
 * A row is a journal fold (req + done by seq) plus two body-derived fields
 * (typeTag, cacheLoss) computed in a bounded streaming Pass B over exactly the
 * windowed members: bodies are materialized one at a time, classified, and
 * dropped — the wire carries rows only (~1.3KB each vs full entries).
 *
 * Two DELIBERATE classification divergences from the legacy full-entry list
 * (both more correct; pinned in test/v2-meta-rows.test.js, declared in
 * history.md):
 *  - membership is the journal fold — a SUPERSET of the synthesizer's output
 *    (conv-gapped crash-orphans get a row; their detail fetch answers 404 and
 *    typeTag stays journal-derived);
 *  - mainAgent is `kind==='main' && !meta.leader` — the isMain semantics the
 *    mainAgentRing already pinned, dropping "main-looking" sub/misc bodies.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { readJsonlTolerant } from './replay.js';
import { iterateJsonlLines } from './jsonl-read.js';
import { iterateV2Items, findTeammateSessionDirs } from './adapter.js';
import { SingleFlight } from './singleflight.js';
import { reportSwallowed } from '../error-report.js';
import { classifyRequest, withAgentNameSubType } from '../../../src/utils/requestType.js';

// KEEP IN SYNC: server/lib/v2/adapter.js itemKey — (sessionId, seq) identity.
const itemKey = (sessionId, seq) => `${sessionId}\x00${seq}`;

const CACHE_TTL_MS = 5 * 60 * 1000;

/** KEEP IN SYNC: src/utils/helpers.js stripPrivateKeys. */
function stripPrivateKeys(obj) {
  if (Array.isArray(obj)) return obj.map(stripPrivateKeys);
  if (obj && typeof obj === 'object') {
    const result = {};
    for (const key of Object.keys(obj)) {
      if (key.startsWith('_')) continue;
      result[key] = stripPrivateKeys(obj[key]);
    }
    return result;
  }
  return obj;
}

/**
 * KEEP IN SYNC: src/utils/helpers.js _computeCacheLoss (that module cannot be
 * imported server-side — SVG/i18n dependency chain). One deliberate fix: the
 * client computes the ttl gap as `stringTs - stringTs` (NaN, so its ttl branch
 * never fires); here the timestamps are parsed — pinned in the unit test.
 */
export function computeCacheLoss(prevEntry, currEntry) {
  const gap = Date.parse(currEntry.timestamp) - Date.parse(prevEntry.timestamp);
  if (gap > CACHE_TTL_MS) return { reason: 'ttl', reasons: ['ttl'] };
  const prev = stripPrivateKeys(prevEntry.body);
  const curr = stripPrivateKeys(currEntry.body);
  if (!prev || !curr) return { reason: 'key_change', reasons: ['key_change'] };
  const reasons = [];
  if (prev.model !== curr.model) reasons.push('model_change');
  if (JSON.stringify(prev.system) !== JSON.stringify(curr.system)) reasons.push('system_change');
  if (JSON.stringify(prev.tools) !== JSON.stringify(curr.tools)) reasons.push('tools_change');
  const prevMsgs = prev.messages || [];
  const currMsgs = curr.messages || [];
  if (currMsgs.length < prevMsgs.length) {
    reasons.push('msg_truncated');
  } else {
    const prefixLen = Math.min(prevMsgs.length, currMsgs.length);
    let prefixMatch = true;
    for (let j = 0; j < prefixLen; j++) {
      if (JSON.stringify(prevMsgs[j]) !== JSON.stringify(currMsgs[j])) { prefixMatch = false; break; }
    }
    if (!prefixMatch) reasons.push('msg_modified');
  }
  if (reasons.length === 0) reasons.push('key_change');
  return { reason: reasons[0], reasons };
}

function readMeta(dir) {
  try { return JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf-8')); } catch { return null; }
}

/** Fold one session dir's journal into row skeletons (no bodies touched). */
function foldDir(dir) {
  const meta = readMeta(dir);
  const isTeammateDir = !!(meta && meta.leader);
  const sessionId = (meta && meta.sessionId) || basename(dir);
  const reqs = new Map();
  const dones = new Map();
  for (const line of readJsonlTolerant(join(dir, 'journal.jsonl'))) {
    if (line.ph === 'req' && !reqs.has(line.seq)) reqs.set(line.seq, line);
    else if (line.ph === 'done' && !dones.has(line.seq)) dones.set(line.seq, line);
  }
  const rows = [];
  for (const [seq, r] of reqs) {
    const d = dones.get(seq);
    const usage = d && d.usage ? {
      input_tokens: d.usage.in || 0,
      output_tokens: d.usage.out || 0,
      cache_read_input_tokens: d.usage.cr || 0,
      cache_creation_input_tokens: d.usage.cw || 0,
    } : null;
    rows.push({
      seq,
      sessionId,
      timestamp: r.ts || '',
      url: r.url || '',
      method: r.method || 'POST',
      // V3.S5 assembler inputs: which conv channel this request's messages
      // live in, and whether its event was a snapshot (checkpoint marker).
      conv: r.conv,
      evt: r.evt,
      kind: r.kind || 'misc',
      mainAgent: r.kind === 'main' && !isTeammateDir,
      // v1 entry contract (adapter.js:427): teammate = agentName string | true
      teammate: isTeammateDir ? ((meta.leader && meta.leader.agentName) || true) : undefined,
      // Wire agent identity (x-claude-code-agent-id) persisted on the journal
      // req line — the display name for native teammates (see agent-id.js).
      agent: r.agent,
      model: r.model,
      proxyUrl: r.proxy && r.proxy.url ? r.proxy.url : undefined,
      // proxyRole: which role (main/subagent/teammate) the rewrite applied to; only present
      // on rewritten requests (spread-gated, same as proxyUrl). Row-level consumers TBD.
      proxyRole: r.proxy && r.proxy.role ? r.proxy.role : undefined,
      status: d && typeof d.http === 'number' ? d.http : undefined,
      duration: d && typeof d.dur === 'number' ? d.dur : undefined,
      usage,
      inProgress: !d,
      typeTag: null,   // Pass B
      cacheLoss: null, // Pass B
    });
  }
  return rows;
}

/**
 * Read the request-list metadata rows for a session (leader + folded
 * teammates), windowed like the entry list: dedup timestamp|url last-wins →
 * `before` filter → tail-`limit`. Pass B streams the window members' bodies
 * once to attach typeTag/cacheLoss.
 *
 * @param {string} sessionDir
 * @param {{limit?: number, before?: string|null, since?: string|null, passB?: boolean}} [opts] -
 *   passB:false skips body classification (live increments send rows first
 *   and re-send corrections once Pass B / the next request lands);
 *   `since` (review P1-2) scopes an incremental reconnect to the delta window
 *   — without it every mobile reconnect re-transmits the full session
 * @returns {Promise<{rows: object[], totalCount: number, hasMore: boolean, oldestTimestamp: string}>}
 */
export async function readV2RequestsMeta(sessionDir, opts = {}) {
  const limit = opts.limit || 0;
  const before = opts.before || null;
  const since = opts.since || null;
  const meta = readMeta(sessionDir);
  const leaderUuid = (meta && meta.sessionId) || basename(sessionDir);
  const dirs = [sessionDir];
  try { dirs.push(...findTeammateSessionDirs(sessionDir, leaderUuid).map((t) => t.dir)); } catch { /* leaderless */ } // items are {dir, leader}

  // k-way ordering parity: same (ts, sessionId, seq) comparator as iterateV2Items
  const all = dirs.flatMap(foldDir);
  all.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : a.seq - b.seq));

  // dedup timestamp|url last-wins (nokey rows key on seq — stable, unlike array index)
  const dedup = new Map();
  for (const row of all) {
    const key = row.timestamp && row.url ? `${row.timestamp}|${row.url}` : `__nokey_${row.sessionId}_${row.seq}`;
    dedup.set(key, row);
  }
  let rows = [...dedup.values()];
  if (before) rows = rows.filter((r) => r.timestamp && r.timestamp < before);
  const totalCount = rows.length;
  let hasMore = false;
  if (limit > 0 && rows.length > limit) {
    hasMore = true;
    rows = rows.slice(rows.length - limit);
  }
  const oldestTimestamp = rows.length > 0 ? rows[0].timestamp : '';
  // Emission-time since filter (mirrors selectV2Window: applied after the
  // window selection; nokey rows always resend — the legacy contract).
  if (since) rows = rows.filter((r) => !r.timestamp || r.timestamp >= since);

  if (opts.passB !== false && rows.length > 0) {
    await attachBodyFields(sessionDir, rows);
  }
  return { rows, totalCount, hasMore, oldestTimestamp };
}

// In-flight coalescing for the v3 cold reads (review P2-b): a reconnect storm
// is N tabs hitting the same sessionDir at once — without this each ran its
// own full journal fold + Pass B + conv-file reads. cached:false — /events is
// a live-attach caller (S10b F5b: a stale TTL window would widen the
// cold-load→attach broadcast-loss gap), so callers only JOIN in-flight runs.
const _coldBundleFlight = new SingleFlight({ ttlMs: 500 });

/**
 * The complete v3 cold read for one /events connection: windowed rows +
 * native conv/responses payloads, single-flighted per (dir, window).
 */
export function readV2ColdBundle(sessionDir, { limit = 0, since = null } = {}) {
  const key = `bundle:${sessionDir}|${limit}|${since || ''}`;
  return _coldBundleFlight.run(key, async () => {
    const meta = await readV2RequestsMeta(sessionDir, { limit, since });
    const native = await readV2NativeCold(sessionDir, meta.rows);
    return { meta, native };
  }, { cached: false });
}

/**
 * Wire v3 (V3.S4) cold native lines for the flagged client's assembler:
 * per conv channel, raw lines from the LAST snapshot at-or-before the
 * window's oldest seq (per session) through the end; responses lines for
 * exactly the window member seqs. Lines are forwarded verbatim (string
 * concat, no parse/stringify round trip beyond seq/t sniffing).
 *
 * ASYNC with event-loop yields (review P1-4): a large session's conv files
 * total tens of MB — reading and snapshot-scanning them in one synchronous
 * stretch blocks every connected client for the duration of the cold load.
 *
 * @param {string} sessionDir - leader dir (teammate dirs folded like the rows)
 * @param {object[]} rows - the window rows (readV2RequestsMeta output)
 * @returns {Promise<{convPayloads: string[], respPayloads: string[]}>}
 *   pre-serialized JSON payloads for `v3_conv` / `v3_resp` SSE frames
 */
export async function readV2NativeCold(sessionDir, rows) {
  const yieldLoop = () => new Promise((resolve) => setImmediate(resolve));
  const minSeqBySession = new Map();
  const memberSeqsBySession = new Map();
  for (const r of rows) {
    const cur = minSeqBySession.get(r.sessionId);
    if (cur === undefined || r.seq < cur) minSeqBySession.set(r.sessionId, r.seq);
    let set = memberSeqsBySession.get(r.sessionId);
    if (!set) { set = new Set(); memberSeqsBySession.set(r.sessionId, set); }
    set.add(r.seq);
  }
  const meta = readMeta(sessionDir);
  const leaderUuid = (meta && meta.sessionId) || basename(sessionDir);
  const dirs = [sessionDir];
  try { dirs.push(...findTeammateSessionDirs(sessionDir, leaderUuid).map((t) => t.dir)); } catch { /* leaderless */ } // items are {dir, leader}

  const convPayloads = [];
  const respPayloads = [];
  for (const dir of dirs) {
    const dirMeta = readMeta(dir);
    const sessionId = (dirMeta && dirMeta.sessionId) || basename(dir);
    const minSeq = minSeqBySession.get(sessionId);
    const memberSeqs = memberSeqsBySession.get(sessionId);
    if (minSeq === undefined) continue; // no window rows from this session
    // conv channels: raw lines from the channel's last snapshot ≤ minSeq
    const convRoot = join(dir, 'conversations');
    let keys = [];
    try { keys = readdirSync(convRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { /* no conv dir */ }
    for (const key of keys) {
      let files = [];
      try { files = readdirSync(join(convRoot, key)).filter((f) => /^e\d+\.jsonl$/.test(f)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0])); } catch { continue; }
      const raws = [];
      for (const f of files) {
        // streamed line-by-line (issue #129): a conv epoch past Node's string
        // cap must degrade to skipped lines, not lose the whole file silently
        try { for (const trimmed of iterateJsonlLines(join(convRoot, key, f))) raws.push(trimmed); }
        catch (err) { reportSwallowed('v2-native.conv-read-failed', err); }
        await yieldLoop(); // one yield per conv file read (error path included)
      }
      // last snapshot at-or-before the window start for this session
      let start = 0;
      for (let i = 0; i < raws.length; i++) {
        try {
          const ev = JSON.parse(raws[i]);
          if (ev.t === 'snapshot' && ev.seq <= minSeq) start = i;
          if (ev.seq > minSeq) break;
        } catch { /* tolerate torn line */ }
        if (i % 2000 === 1999) await yieldLoop();
      }
      const windowRaws = raws.slice(start);
      // Cap each frame at ~512KB of lines: a multi-MB single SSE event forces
      // one giant synchronous JSON.parse on the client's main thread (no
      // paint, no rAF — the loading UI freezes). Small frames are macrotask
      // boundaries: the browser paints and the byte meter ticks between them.
      pushChunked(convPayloads, windowRaws, (linesJson) => `{"sessionId":${JSON.stringify(sessionId)},"channel":${JSON.stringify(key)},"lines":[${linesJson}]}`);
    }
    // responses: exactly the window member seqs — streamed (issue #129)
    const respRaws = [];
    try {
      for (const trimmed of iterateJsonlLines(join(dir, 'responses.jsonl'))) {
        const m = /"seq":\s*(\d+)/.exec(trimmed);
        if (m && memberSeqs && memberSeqs.has(Number(m[1]))) respRaws.push(trimmed);
      }
    } catch (err) { reportSwallowed('v2-native.responses-read-failed', err); }
    await yieldLoop();
    pushChunked(respPayloads, respRaws, (linesJson) => `{"sessionId":${JSON.stringify(sessionId)},"lines":[${linesJson}]}`);
  }
  return { convPayloads, respPayloads };
}

const NATIVE_FRAME_BUDGET = 512 * 1024;

/** Split raw lines into ≤~512KB payloads (see comment at the conv call site). */
function pushChunked(out, raws, wrap) {
  let buf = [];
  let bytes = 0;
  const flush = () => {
    if (buf.length > 0) out.push(wrap(buf.join(',')));
    buf = [];
    bytes = 0;
  };
  for (const raw of raws) {
    buf.push(raw);
    bytes += raw.length + 1;
    if (bytes >= NATIVE_FRAME_BUDGET) flush();
  }
  flush();
}

/**
 * Bounded streaming Pass B: materialize exactly the rows' bodies (one at a
 * time), classify typeTag with one-entry lookahead (classifyRequest's
 * Preflight/Plan detection reads nextReq), compute cacheLoss against the
 * retained previous mainAgent body, then drop the body.
 */
async function attachBodyFields(sessionDir, rows) {
  const rowByKey = new Map(rows.map((r) => [itemKey(r.sessionId, r.seq), r]));
  const materialize = (sessionId, seq) => rowByKey.has(itemKey(sessionId, seq));
  let pending = null;      // { row, entry, isMain } awaiting its nextReq for classify
  let prevMainFull = null; // previous mainAgent full-body entry (cacheLoss)
  let n = 0;
  const finish = (slot, nextEntry) => {
    const { row, entry } = slot;
    try {
      row.typeTag = withAgentNameSubType(classifyRequest(entry, nextEntry), entry);
    } catch (err) {
      // Diagnostic-worthy (a throw silently mis-tags the row; the live path
      // reports the same failure) — CLAUDE.md swallow rule.
      reportSwallowed('v2-meta.row-classify', err);
      row.typeTag = null; // journal-derived kind still renders
    }
    // Authoritative synthesis-level markers. mainAgent stays KIND-derived
    // (item.isMain = journal kind==='main' && !leader) like foldDir and the
    // live rows — entry.mainAgent re-derives from the blob-backfilled body
    // and mis-tags a main-shaped countTokens probe as true, which would merge
    // its turn into the chat after a cold reload (2026-07-16 review P1).
    row.mainAgent = slot.isMain === true;
    if (entry.teammate) row.teammate = entry.teammate;
    if (entry.body && entry.body.model) row.model = entry.body.model;
    if (row.mainAgent) {
      const usage = entry.response?.body?.usage;
      const cacheCreate = usage?.cache_creation_input_tokens || 0;
      const cacheRead = usage?.cache_read_input_tokens || 0;
      if (prevMainFull && cacheCreate > 0 && cacheCreate > cacheRead) {
        try { row.cacheLoss = computeCacheLoss(prevMainFull, entry); } catch (err) { reportSwallowed('v2-meta.row-cacheloss', err); }
      }
      prevMainFull = entry;
    }
  };
  for (const item of iterateV2Items(sessionDir, { materialize })) {
    const row = rowByKey.get(itemKey(item.sessionId, item.seq));
    if (!row) continue;
    // main deltas carry only their appended slice — classification and
    // cacheLoss need the full replayed state (stateRef aliases it transiently)
    let entry = item.entry;
    if (row.mainAgent && item.stateRef && entry.body) {
      entry = { ...entry, body: { ...entry.body, messages: item.stateRef } };
    }
    if (pending) finish(pending, entry);
    pending = { row, entry, isMain: item.isMain };
    if (++n % 20 === 0) await new Promise((resolve) => setImmediate(resolve));
  }
  if (pending) finish(pending, null);
}
