/**
 * Wire v3 (V3.S5) — client-side entry assembler.
 *
 * Rebuilds v1-shape entries from the native wire (metadata rows + raw conv
 * events + raw responses lines) and feeds them to the EXISTING ingest
 * pipeline, so every downstream consumer (sessionMerge guards, ChatView,
 * team modal, tool-result maps) keeps its exact semantics. Entries are built
 * in the shape today's live wire delivers AFTER server-side reconstruction:
 * full accumulated messages (shared references — cheap), no tools/system
 * (rows carry classification; the detail view fetches full bodies on demand).
 *
 * Conv replay mirrors server/lib/v2/conversation-store.js line shapes:
 *   {t:'snapshot', msgs} | {t:'append', msgs} | {t:'ctl', op:'replace-tail', msg}
 *   | {t:'ctl', op:'compact'} (state no-op; the paired snapshot carries state)
 */

/** Per-channel replayed state, keyed `${sessionId}\x00${channel}`. */
export function createV3Assembler() {
  const channels = new Map(); // key → { state: [], applied: [], ptr }
  const resps = new Map();    // `${sessionId}\x00${seq}` → responses line

  const chan = (sessionId, channel) => {
    const k = `${sessionId}\x00${channel}`;
    let c = channels.get(k);
    if (!c) { c = { state: [], events: [], ptr: 0 }; channels.set(k, c); }
    return c;
  };

  const applyEvent = (c, ev) => {
    if (!ev || !ev.t) return;
    if (ev.t === 'snapshot') {
      c.state = Array.isArray(ev.msgs) ? ev.msgs.slice() : [];
    } else if (ev.t === 'append') {
      if (Array.isArray(ev.msgs)) c.state.push(...ev.msgs);
      else if (ev.msg) c.state.push(ev.msg);
    } else if (ev.t === 'ctl' && ev.op === 'replace-tail') {
      if (c.state.length > 0 && ev.msg) c.state[c.state.length - 1] = ev.msg;
    } // ctl compact: state no-op (its snapshot line carries the state)
  };

  return {
    /** Buffer conv events (cold frames carry arrays; live frames one line). */
    addConvLines(sessionId, channel, lines) {
      const c = chan(sessionId, channel);
      for (const ev of Array.isArray(lines) ? lines : [lines]) c.events.push(ev);
    },
    addRespLines(sessionId, lines) {
      for (const line of Array.isArray(lines) ? lines : [lines]) {
        if (line && Number.isInteger(line.seq)) resps.set(`${sessionId}\x00${line.seq}`, line);
      }
    },

    /**
     * Build the v1-shape entry for one row. Applies the row's channel events
     * up to and including row.seq (events are seq-ordered per channel), then
     * copies the state by reference. Rows MUST be fed in per-session seq
     * order (the wire already delivers them so).
     */
    buildEntry(row) {
      let messages = [];
      let isSnapshot = false;
      if (row.conv) {
        const c = chan(row.sessionId, row.conv);
        while (c.ptr < c.events.length && c.events[c.ptr].seq <= row.seq) {
          applyEvent(c, c.events[c.ptr++]);
        }
        messages = c.state.slice(); // refs shared with the channel state
        isSnapshot = row.evt === 'snapshot';
      }
      const entry = {
        timestamp: row.timestamp,
        url: row.url,
        method: row.method || 'POST',
        body: { model: row.model, messages },
        mainAgent: row.mainAgent === true,
        isHeartbeat: row.kind === 'heartbeat',
        isCountTokens: row.kind === 'countTokens',
        duration: row.duration,
        _seq: row.seq,
        _seqEpoch: `v2:${row.sessionId}`,
        _totalMessageCount: messages.length,
        _v3Assembled: true,
        // The SOURCE row — lets chat classification read the server-side
        // typeTag directly (same source the request list uses), instead of
        // re-deriving from a body stripped of system/tools. Known limitation:
        // AppBase._applyV3Delta dedups by (sessionId, seq, inProgress), so a
        // classification-correction re-send (Preflight/Plan lookahead) does NOT
        // rebuild this entry — the row ref stays the FIRST one until a cold
        // reload. Only lookahead-dependent rows are affected (Teammate/SubAgent
        // tags are lookahead-free); tracked as backlog.
        _v3Row: row,
      };
      if (row.teammate) entry.teammate = row.teammate;
      // Wire agent identity (x-claude-code-agent-id) — display name for native
      // teammates, persisted server-side (see agent-id.js).
      if (row.agent) entry.agent = row.agent;
      if (row.proxyUrl) entry.proxyUrl = row.proxyUrl;
      if (isSnapshot) entry._isCheckpoint = true;
      if (row.inProgress) {
        entry.inProgress = true;
        entry.requestId = `${row.sessionId}-${row.seq}`;
      } else {
        const resp = resps.get(`${row.sessionId}\x00${row.seq}`);
        entry.response = {
          ...(row.status != null && { status: row.status }),
          ...(resp && resp.headers && { headers: resp.headers }),
          body: resp ? resp.body : null,
        };
      }
      return entry;
    },

    /** Cold path: build the whole window (rows in wire order). */
    buildColdEntries(rows) {
      const out = [];
      for (const row of rows) {
        try { out.push(this.buildEntry(row)); } catch { /* torn row: skip, next since-read heals */ }
      }
      return out;
    },

    reset() { channels.clear(); resps.clear(); },
  };
}
