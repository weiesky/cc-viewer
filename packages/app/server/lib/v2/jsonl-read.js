// Wire Format v2 — streaming JSONL line reader (issue #129).
//
// `readFileSync(path, 'utf-8')` materializes the WHOLE file as one JS string
// and throws ERR_STRING_TOO_LONG past Node's ~512MiB string cap — a single
// oversized session file (giant conv epoch / journal / responses.jsonl, seen
// in the wild after migrating very large v1 logs) crash-looped the server on
// every startup scan. This reader never builds a whole-file string: it reads
// fixed-size chunks and splits lines at the BYTE level (scanning for 0x0A
// before decoding), so multi-byte UTF-8 characters straddling a chunk
// boundary are never torn, and only one line at a time ever becomes a string.
//
// A single line at/above the string cap can never be decoded at all — it is
// skipped (reported once per file via reportSwallowed) instead of throwing,
// mirroring readJsonlTolerant's torn-tail tolerance (spec §14).

import { existsSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { reportSwallowed } from '../error-report.js';

const DEFAULT_CHUNK_BYTES = 8 * 1024 * 1024;
// Node's max string length is 0x1fffffe8 (~512MiB) — a line this long can
// never become a JS string, so it is unreadable by construction.
const DEFAULT_MAX_LINE_BYTES = 0x1fffffe8;

/**
 * Iterate a JSONL file's lines as trimmed strings (blank lines skipped),
 * without ever holding the whole file in one string.
 *
 * @param {string} path
 * @param {{maxLineBytes?: number, chunkBytes?: number}} [opts] - test seams;
 *   production callers use the defaults.
 * @yields {string} one trimmed non-empty line
 */
export function* iterateJsonlLines(path, opts = {}) {
  const maxLineBytes = opts.maxLineBytes || DEFAULT_MAX_LINE_BYTES;
  const chunkBytes = opts.chunkBytes || DEFAULT_CHUNK_BYTES;
  if (!existsSync(path)) return;
  let fd;
  try {
    fd = openSync(path, 'r');
  } catch (err) {
    // ENOENT = vanished mid-scan (benign TOCTOU); anything else (EBUSY/EPERM
    // Windows locks, EMFILE) silently rendering a session empty is
    // diagnostic-worthy — CLAUDE.md swallow rule.
    if (err && err.code !== 'ENOENT') reportSwallowed('v2-read.open-failed', err);
    return;
  }
  try {
    // Cap the chunk to the file's actual size (like the sibling readers):
    // a fixed 8MB zero-filled alloc per call is a ~2600x regression over the
    // old readFileSync for the KB-scale journals startup scans walk.
    let capBytes = chunkBytes;
    try { capBytes = Math.min(chunkBytes, Math.max(statSync(path).size, 1)); }
    catch { /* stat raced a delete — keep the full chunk; the read loop decides */ }
    const chunk = Buffer.alloc(capBytes);
    let carry = [];       // Buffer fragments of the current (incomplete) line
    let carryBytes = 0;
    let skipping = false; // inside an oversized line — drop bytes until \n
    let reported = false; // one report per file, not per oversized line
    let pos = 0;
    const reportOnce = (err) => {
      if (reported) return;
      reported = true;
      reportSwallowed('v2-read.jsonl-line-too-long', err);
    };
    while (true) {
      const n = readSync(fd, chunk, 0, chunk.length, pos);
      if (n === 0) break;
      pos += n;
      const view = chunk.subarray(0, n);
      let from = 0;
      while (from < n) {
        const nl = view.indexOf(10, from);
        if (nl === -1) {
          // no newline in the rest of this chunk — carry (or keep skipping)
          if (!skipping) {
            const restLen = n - from;
            if (carryBytes + restLen > maxLineBytes) {
              skipping = true;
              carry = [];
              carryBytes = 0;
              reportOnce(new Error(`${path}: line exceeds ${maxLineBytes} bytes — skipped`));
            } else {
              // chunk is reused by the next readSync — the carried slice must own its bytes
              carry.push(Buffer.from(view.subarray(from)));
              carryBytes += restLen;
            }
          }
          break;
        }
        if (skipping) {
          skipping = false; // the oversized line ends at this newline
        } else {
          const seg = view.subarray(from, nl);
          let text = null;
          try {
            if (carry.length > 0) {
              carry.push(seg);
              text = Buffer.concat(carry).toString('utf-8');
            } else {
              text = seg.toString('utf-8');
            }
          } catch (err) {
            reportOnce(err); // decode failed (line at the string cap) — skip it
          }
          carry = [];
          carryBytes = 0;
          if (text !== null) {
            const t = text.trim();
            if (t) yield t;
          }
        }
        from = nl + 1;
      }
    }
    // trailing line without a final newline (torn tail is the caller's concern)
    if (!skipping && carry.length > 0) {
      let text = null;
      try { text = Buffer.concat(carry).toString('utf-8'); } catch (err) { reportOnce(err); }
      if (text !== null) {
        const t = text.trim();
        if (t) yield t;
      }
    }
  } finally {
    closeSync(fd);
  }
}
