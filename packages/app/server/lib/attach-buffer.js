// Attach buffer (2026-10): closes the cold-load → clients.push broadcast-loss
// window on /events.
//
// Background: serveEventStream deliberately does NOT register the client into
// deps.clients until the whole cold history + load_end has been written (see
// the "do not clients.push here" note in routes/events.js — a live entry
// arriving mid-load would be overwritten by load_end's setState, causing a
// show→disappear→reappear flicker). The cost is a real gap: any live v2 delta
// that lands between the
// frozen cold snapshot and the registration is neither in that snapshot nor
// broadcast to this not-yet-registered client, and the server has no retained
// replay. The FIRST turn of a fresh `ccv --sdk` is the turn most likely to fall
// into this gap (lazy resident-query construction + first-time session-dir
// creation slow the cold load while the first turn is already producing
// entries), so the conversation stalls until a manual refresh re-cold-loads.
//
// The fix is a per-connection buffer proxy: while the cold load runs, a
// stand-in client — stamped with the SAME _ccvViewProject/_ccvViewInstance as
// the eventual registrable so the existing feed routing delivers exactly the
// frames this connection is owed — sits in deps.clients and queues every SSE
// frame instead of writing a socket. After load_end (and kv/context), the
// queued frames are replayed through the real sink in emission order, then the
// proxy is swapped for the real registrable in one synchronous block (no
// broadcast can interleave between the replay and the swap on the single
// thread). The anti-flicker invariant is preserved because the proxy never
// writes the socket before load_end.
//
// Dedup: rows (v2_requests_delta) and responses lines (v3_resp) upsert
// client-side by (sessionId, seq) and are therefore idempotent — replay them
// verbatim. v3_conv is NOT idempotent on the client (createV3Assembler
// appends conv events and consumes them with a monotonic pointer, so a
// replayed line that the cold bundle already carried would be applied twice
// and duplicate messages). The server therefore filters replayed v3_conv
// frames against the cold bundle's conv coverage (`native.convSeqs` from
// readV2NativeCold): a frame is skipped when its seq was already sent.

import { reportSwallowed } from './error-report.js';

/** Per-connection cap on buffered bytes. Counted in real UTF-8 bytes (Buffer.byteLength),
 *  matching the mux QUEUE_MAX_BYTES units so a full proxy can never overflow the socket
 *  queue it replays into. For CJK content (JSON does not escape it) this bounds the proxy
 *  to roughly 1/3 the *character* count an ASCII session gets — the honest memory measure. */
export const ATTACH_BUFFER_MAX_BYTES = 32 * 1024 * 1024;

const CONV_FRAME_PREFIX = 'event: v3_conv\ndata: ';

/**
 * Create a buffer client that stands in for one /events connection during its
 * cold load. Compatible with _safeSseWrite (log-watcher.js): it exposes
 * destroyed/writable/write, _wireEnc stays undefined so sseWrite routes the raw
 * (uncompressed) SSE text straight to write(), and write() ALWAYS returns true
 * so the backpressure-kill branch never fires for a proxy.
 *
 * @param {{project?: string, instance?: string, maxBytes?: number,
 *          onOverflow?: (bytes: number) => void}} opts
 */
export function createAttachBufferClient({ project, instance, maxBytes, onOverflow } = {}) {
  const limit = Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : ATTACH_BUFFER_MAX_BYTES;
  const client = {
    destroyed: false,
    writable: true,
    _wireEnc: undefined,
    _ccvAttachBuffer: true,
    frames: [],
    bytes: 0,
    overflowed: false,
    write(text) {
      if (client.destroyed || client.overflowed) return true;
      const len = text ? Buffer.byteLength(text, 'utf8') : 0;
      if (client.bytes + len > limit) {
        // Overflow: degrade to today's pre-fix behavior (drop the window's
        // increments) rather than risk an unbounded queue. Never replay a
        // partial window — a truncated conv/row sequence would corrupt order.
        const at = client.bytes + len;
        client.overflowed = true;
        client._clear();
        try { if (onOverflow) onOverflow(at); }
        catch (err) { reportSwallowed('sse.attach-buffer.overflow-cb', err); }
        return true;
      }
      client.frames.push(text);
      client.bytes += len;
      return true;
    },
    end() { client._clear(); client.destroyed = true; client.writable = false; },
    // No-op listener surface: nothing should hang off a proxy, but a stray
    // .once('drain') from a future code path must not throw.
    on() {}, once() {}, off() {}, removeListener() {},
    _clear() { client.frames.length = 0; client.bytes = 0; },
  };
  // Stamp the SAME view scope the real registrable will carry, so
  // filterClientsByViewProject / filterClientsByInstance route this proxy
  // exactly the frames the eventual client should receive.
  if (project) client._ccvViewProject = project;
  if (instance) client._ccvViewInstance = instance;
  return client;
}

/**
 * Extract the seq of a v3_conv frame's line, or null when the frame is not a
 * conv frame / cannot be parsed. Parses the {sessionId, channel, line}
 * envelope the live feed forwards (live-feed.js _forwardNative).
 * @returns {{key: string, seq: number|null} | null}
 */
function _parseConvFrame(frameText) {
  if (typeof frameText !== 'string' || !frameText.startsWith(CONV_FRAME_PREFIX)) return null;
  const jsonStart = CONV_FRAME_PREFIX.length;
  const jsonEnd = frameText.indexOf('\n', jsonStart);
  const json = jsonEnd === -1 ? frameText.slice(jsonStart) : frameText.slice(jsonStart, jsonEnd);
  let env;
  try { env = JSON.parse(json); } catch { return null; }
  if (!env || typeof env.sessionId !== 'string') return null;
  const channel = typeof env.channel === 'string' ? env.channel : 'main';
  const seq = env.line && Number.isInteger(env.line.seq) ? env.line.seq : null;
  return { key: `${env.sessionId}\x00${channel}`, seq };
}

/**
 * Should this replayed conv frame be skipped because the cold bundle already
 * carried it? A frame is covered when its channel's coverage has the seq in
 * its window set, OR the seq predates the window's base (a snapshot before
 * baseSeq was already reflected in the cold assembly — replaying it would be
 * consumed a second time by the monotonic conv pointer).
 */
function _isCoveredConvFrame(frameText, convCoverage) {
  if (!convCoverage) return false;
  const parsed = _parseConvFrame(frameText);
  if (!parsed || parsed.seq === null) return false; // fail-open: replay
  const cov = convCoverage.get(parsed.key);
  if (!cov) return false;
  if (cov.seqs && cov.seqs.has(parsed.seq)) return true;
  if (Number.isInteger(cov.baseSeq) && parsed.seq < cov.baseSeq) return true;
  return false;
}

/**
 * Replay the queued frames through the real sink (in emission order), skipping
 * any v3_conv frame the cold bundle already covered. Safe to call with a null
 * or overflowed client (no-op). Stops at the first dead sink or write error.
 *
 * Credit-based (async): the cold-load window now spans real time (the mux cold load is
 * backpressured), so the replay may be multi-MB and must NOT dump synchronously into a
 * possibly-congested socket. Each frame goes through the same contract as the cold load
 * (write; if pressured, await drain; abort on a dead sink). `client.bytes` is decremented
 * as frames are replayed so the cap tracks the LIVE backlog, not cumulative arrivals.
 *
 * Atomicity: the proxy is NOT cleared here. The caller passes an `onDrained` callback that
 * — synchronously inside the final pass (no yield between the last write and it) — splices
 * the proxy out of deps.clients, pushes the real registrable, and clears the proxy. That
 * single synchronous step is what keeps the anti-flicker invariant: no broadcast can
 * interleave between the final replay and the swap (a frame arriving mid-await is appended
 * to the still-registered proxy and replayed on the next pass).
 *
 * @param {{write: (s:string)=>any, alive?: ()=>boolean,
 *          needsDrain?: ()=>boolean, awaitDrain?: ()=>Promise}} sink
 * @param {object|null} client - the attach buffer client.
 * @param {Map<string,{seqs:Set<number>, baseSeq:number}>|null} convCoverage
 * @param {()=>void} onDrained - called synchronously when the queue is fully replayed (the
 *   caller MUST do the proxy→registrable swap here).
 * @param {()=>void} [onAbort] - called synchronously when the replay aborts early on a dead
 *   sink or a write error; the caller MUST remove the proxy from the broadcast list here
 *   (the registrable is NOT registered on abort). Both callbacks are the ONLY cleanup points
 *   for the proxy — the caller cannot rely on dispose() to splice it after this returns.
 * @returns {Promise<{replayed: number, skipped: number}>}
 */
export async function flushAttachBuffer(sink, client, convCoverage, onDrained, onAbort) {
  const result = { replayed: 0, skipped: 0 };
  if (!client || client.overflowed || client.destroyed) {
    if (client) client._clear();
    if (onDrained) onDrained();
    return result;
  }
  const frames = client.frames;
  const abort = () => { client._clear(); if (onAbort) onAbort(); return result; };
  // The for-loop re-reads frames.length every iteration, so frames appended to the
  // still-registered proxy during an await below are replayed in order (the anti-loss
  // invariant). Replayed entries are nulled in place so the array does not retain the whole
  // replayed volume for the duration of a long backpressured flush (memory bound), and
  // client.bytes is decremented so the cap tracks the live backlog, not cumulative arrivals.
  for (let i = 0; i < frames.length; i++) {
    if (typeof sink.alive === 'function' && !sink.alive()) return abort();
    const frame = frames[i];
    frames[i] = null;                                   // release the reference immediately
    if (_isCoveredConvFrame(frame, convCoverage)) { result.skipped++; client.bytes -= Buffer.byteLength(frame, 'utf8'); continue; }
    let ok;
    try { ok = sink.write(frame); } catch (err) {
      reportSwallowed('sse.attach-buffer.flush', err);
      return abort();
    }
    result.replayed++;
    client.bytes -= Buffer.byteLength(frame, 'utf8');   // free the cap as the backlog drains
    if ((!ok || (typeof sink.needsDrain === 'function' && sink.needsDrain())) &&
        typeof sink.awaitDrain === 'function') {
      await sink.awaitDrain();
    }
  }
  // Swap synchronously at the end of the final pass (no yield after the last write): the
  // caller splices proxy→registrable and clears the proxy here, so nothing can land in a
  // cleared-but-still-registered proxy.
  if (onDrained) onDrained();
  else client._clear();
  return result;
}
