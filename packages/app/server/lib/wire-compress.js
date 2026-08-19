/**
 * Wire compression for client-facing SSE / streaming JSON responses.
 *
 * Negotiation is br|identity only: every real browser sends `br` in
 * Accept-Encoding over plain http, while non-browser clients (curl, tests)
 * that omit it keep today's plaintext bytes untouched. gzip is deliberately
 * not offered — its 32KB window cannot back-reference the repeated multi-KB
 * tools/system blocks or the growing conversation history, so it measured
 * 1.8-3x against brotli's 20-80x on real sessions.
 *
 * CONVENTION: on a response that went through sseHead(), every subsequent
 * byte MUST be written via sseWrite()/wireEnd() — a bare res.write() would
 * interleave plaintext into the brotli stream and corrupt it for the client.
 * All SSE broadcast paths (log-watcher send*ToClients, workspaces reload,
 * server.js update badge) route through sseWrite for this reason.
 *
 * Escape hatches: CCV_WIRE_COMPRESSION=off disables negotiation entirely;
 * CCV_BROTLI_QUALITY overrides the encoder quality (default 9 — measured
 * knee on large sessions; q5 collapses to ~2.5x there).
 */
import zlib from 'node:zlib';
import { reportSwallowed } from './error-report.js';
import { awaitDrainOrClose } from './sse-backpressure.js';

const C = zlib.constants;
const DEFAULT_QUALITY = 9;
const LGWIN = 24; // 16MB window: must cover the repeat distance of multi-MB live frames

/** Wire v3 flag parsing (default ON; '0' or 'off' is the escape hatch).
 *  Pure so the env contract is unit-testable — the const in server.js is
 *  evaluated once at import and can't be toggled in-process. */
export function isWireV3Enabled(v) {
  return v !== '0' && v !== 'off';
}

function negotiatedEncoding(req) {
  if (process.env.CCV_WIRE_COMPRESSION === 'off') return null;
  const accept = req.headers && req.headers['accept-encoding'];
  if (typeof accept !== 'string') return null;
  // RFC 9110: a qvalue of 0 means "not acceptable" — `br;q=0` is a refusal.
  for (const token of accept.split(',')) {
    const [name, ...params] = token.trim().split(';');
    if (name.trim() !== 'br') continue;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    if (q && !(parseFloat(q.slice(2)) > 0)) return null;
    return 'br';
  }
  return null;
}

function makeEncoder() {
  let quality = Number(process.env.CCV_BROTLI_QUALITY);
  if (!Number.isInteger(quality) || quality < 1 || quality > 11) quality = DEFAULT_QUALITY;
  return zlib.createBrotliCompress({
    params: {
      [C.BROTLI_PARAM_QUALITY]: quality,
      [C.BROTLI_PARAM_LGWIN]: LGWIN,
    },
  });
}

/**
 * Negotiate Content-Encoding and send the response head. On a `br` hit the
 * encoder is piped into `res` and attached as `res._wireEnc`; otherwise this
 * is exactly `res.writeHead(status, headers)` (plaintext path unchanged).
 * The encoder is destroyed on response close, freeing its 16MB window.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {Record<string, string>} headers
 * @param {{flush?: boolean}} [opts] - flush:false = whole-stream response (no
 *   per-macrotask flush; wireEnd's FINISH trailer is the only boundary —
 *   better ratio for bulk JSON like /api/requests that has no liveness need)
 */
export function sseHead(req, res, status, headers, opts) {
  const enc = negotiatedEncoding(req);
  if (!enc) {
    // Vary on BOTH branches: the resource is negotiated either way, and a
    // caching intermediary must key on Accept-Encoding for it.
    res.writeHead(status, { ...headers, 'Vary': 'Accept-Encoding' });
    return;
  }
  const encoder = makeEncoder();
  if (opts && opts.flush === false) encoder._wireNoFlush = true;
  encoder.on('error', (err) => {
    // A compressor error mid-stream is unrecoverable for this client —
    // surface it (silent loss here means a wedged UI) and drop the socket.
    reportSwallowed('sse.compress', err);
    try { res.destroy(); } catch { /* already gone */ }
  });
  encoder.pipe(res);
  res._wireEnc = encoder;
  res.on('close', () => {
    res._wireEnc = null;
    try { encoder.destroy(); } catch { /* already destroyed */ }
  });
  res.writeHead(status, { ...headers, 'Content-Encoding': 'br', 'Vary': 'Accept-Encoding' });
}

function scheduleFlush(encoder) {
  if (encoder._wireNoFlush || encoder._wireFlushScheduled) return;
  encoder._wireFlushScheduled = true;
  setImmediate(() => {
    encoder._wireFlushScheduled = false;
    if (encoder.destroyed || encoder.writableEnded) return;
    // SYNC flush per macrotask: bytes of every event written this tick leave
    // immediately (SSE liveness) while the window is retained (compression
    // context takeover across events — the source of the measured 20-80x).
    encoder.flush(C.BROTLI_OPERATION_FLUSH);
  });
}

/**
 * Write one SSE chunk through the response's negotiated encoding.
 * Returns the write() boolean of the stream actually written to; combine
 * with needsDrain(res) for socket-level backpressure on compressed paths.
 */
export function sseWrite(res, str) {
  const encoder = res._wireEnc;
  if (!encoder) return res.write(str);
  if (encoder.destroyed || encoder.writableEnded) return false;
  const ok = encoder.write(str);
  scheduleFlush(encoder);
  return ok;
}

/** Socket-level backpressure signal (true on both plain and compressed paths). */
export function needsDrain(res) {
  return res.writableNeedDrain === true;
}

/**
 * Wait until the response's write target can accept more data (or the
 * connection dies, or timeoutMs elapses). On the plain path this is exactly
 * awaitDrainOrClose(res). On the compressed path the pressured stream is the
 * ENCODER (its 'drain' fires when compression consumes the input backlog) —
 * waiting on res 'drain' there can stall the full timeout, because compressed
 * output is 20-80x smaller and may never backpressure the socket at all.
 */
export function awaitWireDrain(res, timeoutMs) {
  const encoder = res._wireEnc;
  if (!encoder) return awaitDrainOrClose(res, timeoutMs);
  return new Promise((resolve) => {
    let t;
    const done = () => {
      clearTimeout(t);
      encoder.off('drain', done);
      encoder.off('close', done);
      res.off('close', done);
      res.off('error', done);
      resolve();
    };
    t = setTimeout(done, timeoutMs);
    encoder.once('drain', done);
    encoder.once('close', done); // encoder is destroyed on res close
    res.once('close', done);
    res.once('error', done);
  });
}

/** End the response, flushing the encoder trailer first on compressed paths. */
export function wireEnd(res) {
  const encoder = res._wireEnc;
  if (!encoder) { res.end(); return; }
  if (!encoder.destroyed && !encoder.writableEnded) encoder.end(); // pipe ends res
}
