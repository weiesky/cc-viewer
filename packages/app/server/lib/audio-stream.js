/**
 * Audio Stream — dedicated streaming response module for audio preview.
 *
 * Backs /api/audio-stream with single-range HTTP Range support. Unlike fileRaw
 * (full buffer, 10MB cap), this streams via createReadStream and supports
 * 206/416/304/If-Range, satisfying Safari/WebKit's byte-range requirement (it
 * probes with `Range: bytes=0-1`).
 *
 * Design boundaries:
 * - The sniffer only ever overrides to an audio/* MIME, never video/* (the ftyp
 *   brand cannot reliably tell audio m4a from video mp4); the extension MIME is
 *   the fallback.
 * - parseByteRange supports suffix ranges and clamping, per RFC 9110 §14.
 * - serveAudioStream wraps everything in a top-level try/catch with a
 *   res.headersSent guard so no sync fs error becomes an unhandled rejection
 *   that kills the process (see server.js:985).
 */

import { openSync, readSync, closeSync, createReadStream } from 'node:fs';
import { reportSwallowed } from './error-report.js';

/**
 * Extension → audio/* MIME. `.opus` is an Ogg container (RFC 7845 §9); `.m4a`
 * uses audio/mp4 (RFC 4337); `.flac` uses audio/flac (RFC 9639).
 */
const AUDIO_MIME = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
};

/** Supported audio extensions (lowercase, leading dot). */
const AUDIO_EXTENSIONS = new Set(Object.keys(AUDIO_MIME));

/** How many head bytes readHead reads; large enough to span a typical ID3v2 tag. */
const SNIFF_BYTES = 4096;

/**
 * Derive the lowercased extension from a real file path, cross-platform
 * (basename via split(/[\\/]/), last dot).
 * @param {string} filePath
 * @returns {string} lowercase extension with leading dot, or ''
 */
function audioExtOf(filePath) {
  const base = String(filePath || '').split(/[\\/]/).pop() || '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

/**
 * Read the first SNIFF_BYTES for container sniffing. Uses
 * openSync/readSync/finally closeSync and never readFileSync (a multi-GB audio
 * file would blow up memory). Short reads / failures are non-fatal.
 * @param {string} filePath
 * @param {number} [size] file size (avoids over-reading a small file)
 * @returns {Buffer|null} first N bytes, or null on failure
 */
function readHead(filePath, size) {
  let fd;
  try {
    fd = openSync(filePath, 'r');
    const len = Math.min(SNIFF_BYTES, typeof size === 'number' && size >= 0 ? size : SNIFF_BYTES);
    if (len <= 0) return null;
    const buf = Buffer.alloc(len);
    const n = readSync(fd, buf, 0, len, 0);
    return n > 0 ? buf.subarray(0, n) : null;
  } catch (err) {
    reportSwallowed('audioStream.readHead', err);
    return null;
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch (err) { reportSwallowed('audioStream.closeHead', err); }
    }
  }
}

/**
 * Sniff the real audio MIME from magic bytes; only ever returns audio/*, never
 * video/*. Order: ADTS before the generic MP3 frame sync (both use a 0xFF sync,
 * and ID3 can also prefix ADTS).
 * @param {Buffer|null} buf head bytes
 * @param {string} ext lowercase extension with leading dot (fallback)
 * @returns {string} an audio/* MIME
 */
function sniffAudioMime(buf, ext) {
  const fallback = AUDIO_MIME[ext] || 'application/octet-stream';
  if (!buf || buf.length < 2) return fallback;

  // Ogg container: OggS; the first packet (~offset 28) distinguishes
  // Opus/Vorbis/FLAC, but all already map to audio/ogg.
  if (buf.length >= 4 && buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) {
    return 'audio/ogg';
  }
  // Native FLAC: fLaC.
  if (buf.length >= 4 && buf[0] === 0x66 && buf[1] === 0x4c && buf[2] === 0x61 && buf[3] === 0x43) {
    return 'audio/flac';
  }
  // WAV: RIFF....WAVE.
  if (buf.length >= 12 &&
      buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x41 && buf[10] === 0x56 && buf[11] === 0x45) {
    return 'audio/wav';
  }
  // MP4/M4A: ftyp at offset 4; the brand cannot reliably split audio from video,
  // so this audio-only route always serves audio/mp4.
  if (buf.length >= 8 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    return 'audio/mp4';
  }
  // ID3v2 tag: may prefix MP3 or ADTS AAC, so look past the tag for the frame sync.
  if (buf.length >= 3 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    // ID3v2 size is syncsafe at offset 6-9; skip the tag to find the frame.
    if (buf.length >= 10) {
      const tagSize = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
      const frameAt = 10 + tagSize;
      if (frameAt + 1 < buf.length) {
        const b0 = buf[frameAt]; const b1 = buf[frameAt + 1];
        if (b0 === 0xff && (b1 & 0xf6) === 0xf0) return 'audio/aac'; // ADTS (MPEG-2/4)
        if (b0 === 0xff && (b1 & 0xe0) === 0xe0 && (b1 & 0x06) !== 0) return 'audio/mpeg'; // MP3, layer bits≠00
        return 'audio/mpeg'; // ID3 with a non-ADTS frame defaults to MP3
      }
    }
    // Tag larger than the sniff window: trust the extension rather than guess.
    return fallback;
  }
  // ADTS AAC: FF F1/F9 (MPEG-4) or FF F0/F8 (MPEG-2), 12-bit sync, layer bits 00.
  if (buf[0] === 0xff && (buf[1] & 0xf6) === 0xf0) {
    return 'audio/aac';
  }
  // Bare MP3 frame: FF Ex/Fx with layer bits≠00.
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0 && (buf[1] & 0x06) !== 0) {
    return 'audio/mpeg';
  }
  return fallback;
}

/**
 * Parse a single-range Range header. Multi-range / malformed returns null (the
 * caller ignores it and serves 200).
 * @param {string|undefined} header Range header value
 * @param {number} size total file bytes
 * @returns {{start:number,end:number}|'unsatisfiable'|null}
 */
function parseByteRange(header, size) {
  if (!header || typeof header !== 'string') return null;
  if (!Number.isSafeInteger(size) || size <= 0) return 'unsatisfiable'; // any range on an empty file is 416
  const m = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null; // malformed / multi-range → ignore (200)

  if (m[1] === '') {
    // Suffix: bytes=-N
    const n = Number(m[2]);
    if (!Number.isSafeInteger(n) || n <= 0) return 'unsatisfiable';
    return { start: Math.max(0, size - n), end: size - 1 };
  }

  const start = Number(m[1]);
  if (!Number.isSafeInteger(start) || start >= size) return 'unsatisfiable';
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (!Number.isSafeInteger(end) || end < start) return null; // invalid → ignore (200)
  return { start, end };
}

/**
 * Stream an audio response. Order: 304 (If-None-Match) → If-Range →
 * Range (206) / 200. HEAD ignores Range and returns 200 headers only (and also
 * sniffs, so its Content-Type matches GET).
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{filePath:string, stat:import('node:fs').Stats, ext:string}} ctx
 */
function serveAudioStream(req, res, ctx) {
  const { filePath, stat, ext } = ctx;
  const size = stat.size;
  const name = String(filePath || '').split(/[\\/]/).pop() || 'audio';
  const etag = `"${size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;

  // 304 takes priority over Range and needs no body or sniffed Content-Type.
  if (req.headers['if-none-match'] && req.headers['if-none-match'] === etag) {
    res.writeHead(304, { 'Cache-Control': 'private', 'ETag': etag });
    res.end();
    return;
  }

  const base = {
    'Content-Type': sniffAudioMime(readHead(filePath, size), ext),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private',
    'ETag': etag,
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
    'X-Content-Type-Options': 'nosniff',
  };

  // HEAD: no stream, 200 headers (Range is GET-only and ignored).
  if (req.method === 'HEAD') {
    res.writeHead(200, { ...base, 'Content-Length': size });
    res.end();
    return;
  }

  // Empty file: serve a clean 200 with Content-Length 0; a 0-length
  // createReadStream range (end=-1) would throw after headers are sent.
  if (size === 0) {
    res.writeHead(200, { ...base, 'Content-Length': 0 });
    res.end();
    return;
  }

  // If-Range: only an exact strong-ETag match continues with Range, else ignore it → 200.
  const ifRange = req.headers['if-range'];
  const rangeOk = !ifRange || ifRange === etag;
  const range = rangeOk ? parseByteRange(req.headers.range, size) : null;

  // 416: valid-but-unsatisfiable.
  if (range === 'unsatisfiable') {
    res.writeHead(416, {
      'Content-Range': `bytes */${size}`,
      'Content-Length': 0,
      'Accept-Ranges': 'bytes',
    });
    res.end();
    return;
  }

  let status; let headers; let start; let end;
  if (range) {
    // 206: must carry Content-Range (Safari seek depends on it).
    ({ start, end } = range);
    status = 206;
    headers = {
      ...base,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': end - start + 1,
    };
  } else {
    // 200: never carries Content-Range; the explicit end bound prevents a file
    // that grows mid-request from exceeding Content-Length.
    start = 0; end = size - 1;
    status = 200;
    headers = { ...base, 'Content-Length': size };
  }

  res.writeHead(status, headers);
  const stream = createReadStream(filePath, { start, end });
  // Headers are already sent by the time a read error can fire, so we can only
  // abort the response mid-stream; report it for diagnosis.
  stream.on('error', (err) => { reportSwallowed('audioStream.stream', err); res.destroy(); });
  // Stop reading from disk if the client aborts (e.g. skips the preview).
  res.on('close', () => { stream.destroy(); });
  // If the socket was already destroyed before these listeners attached, the
  // 'close' event already fired and never will again — destroy the stream now.
  if (res.destroyed) { stream.destroy(); return; }
  stream.pipe(res);
}

export {
  AUDIO_MIME,
  AUDIO_EXTENSIONS,
  audioExtOf,
  sniffAudioMime,
  parseByteRange,
  serveAudioStream,
};
