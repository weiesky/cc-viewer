import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Sandbox dir: must be created and injected via env BEFORE importing the target
//    module (file-access-policy locks the allowlist at import time) ─────────────
const TMP = realpathSync(mkdtempSync(join(tmpdir(), 'ccv-audio-stream-test-')));
const PROJECT = join(TMP, 'project');
mkdirSync(PROJECT, { recursive: true });

process.env.CCV_PROJECT_DIR = PROJECT;
process.env.CLAUDE_CONFIG_DIR = join(TMP, 'claude');
process.env.CCV_LOG_DIR = join(TMP, 'logs');
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

/** Build a collecting res (a pipe sink that also supports destroy). */
function makeRes() {
  const res = new EventEmitter();
  res.statusCode = 0;
  res.headers = null;
  res.headersSent = false;
  res.chunks = [];
  res.ended = false;
  res.destroyed = false;
  res.writeHead = (code, headers) => { res.statusCode = code; res.headers = headers || {}; res.headersSent = true; return res; };
  res.write = (c) => { if (c != null) res.chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))); return true; };
  res.end = (c) => { if (c != null) res.chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))); res.ended = true; res.emit('finish'); return res; };
  res.destroy = () => { res.destroyed = true; res.emit('close'); return res; };
  res.on('error', () => {});
  return res;
}
function bodyBuf(res) { return Buffer.concat(res.chunks); }
function waitFinish(res) {
  return new Promise((resolve) => {
    if (res.ended || res.destroyed) return resolve(res);
    res.on('finish', () => resolve(res));
    res.on('close', () => resolve(res));
  });
}

/** Build a recognizable audio file: minimal WAV header + filler bytes. */
function wavBytes(total) {
  const head = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, // RIFF....WAVE
  ]);
  return Buffer.concat([head, Buffer.alloc(Math.max(0, total - head.length), 0x01)]);
}

let audioStream;
before(async () => {
  const mod = await import('../server/routes/files-content.js');
  audioStream = mod.filesContentRoutes.find(r => r.predicate && r.predicate('/api/audio-stream', 'GET'))?.handler;
  assert.ok(audioStream, 'audio-stream handler resolved');
});
after(() => { try { rmSync(TMP, { recursive: true, force: true }); } catch {} });

function call(search = '', { method = 'GET', headers = {} } = {}) {
  const res = makeRes();
  const parsedUrl = { pathname: '/api/audio-stream', searchParams: new URLSearchParams(search) };
  const req = { method, headers };
  audioStream(req, res, parsedUrl);
  return res;
}

describe('GET /api/audio-stream', { concurrency: false }, () => {
  it('400 on missing path', async () => {
    const res = call('');
    await waitFinish(res);
    assert.equal(res.statusCode, 400);
  });

  it('400 on a relative path containing ..', async () => {
    const res = call(`path=${encodeURIComponent('../outside.mp3')}`);
    await waitFinish(res);
    assert.equal(res.statusCode, 400);
  });

  it('400 on non-audio extension', async () => {
    const f = join(PROJECT, 'note.txt');
    writeFileSync(f, 'hello');
    const res = call(`path=${encodeURIComponent(f)}`);
    await waitFinish(res);
    assert.equal(res.statusCode, 400);
    assert.match(bodyBuf(res).toString(), /Unsupported audio path/);
  });

  it('400 on a directory', async () => {
    const dir = join(PROJECT, 'adir.mp3'); // audio-looking name but a directory
    mkdirSync(dir, { recursive: true });
    const res = call(`path=${encodeURIComponent(dir)}`);
    await waitFinish(res);
    assert.equal(res.statusCode, 400);
  });

  it('403 on a real file outside the allowlist', async () => {
    // TMP itself is not an allowed root, so a real file here exercises the 403 branch.
    const outside = join(TMP, 'outside-audio.mp3');
    writeFileSync(outside, wavBytes(64));
    const res = call(`path=${encodeURIComponent(outside)}`);
    await waitFinish(res);
    assert.equal(res.statusCode, 403);
  });

  it('200 full body with Accept-Ranges, audio MIME, nosniff, no Content-Range', async () => {
    const f = join(PROJECT, 'song.mp3');
    const data = wavBytes(5000); // WAV content with a .mp3 extension → sniff overrides to audio/wav
    writeFileSync(f, data);
    const res = call(`path=${encodeURIComponent(f)}`);
    await waitFinish(res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Accept-Ranges'], 'bytes');
    assert.equal(res.headers['Content-Type'], 'audio/wav'); // sniff overrides the extension
    assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
    assert.ok(!('Content-Range' in res.headers), '200 must not carry Content-Range');
    assert.equal(Number(res.headers['Content-Length']), 5000);
    assert.ok(res.headers.ETag);
    assert.deepEqual(bodyBuf(res), data);
  });

  it('206 bytes=N-M returns the exact slice bytes with Content-Range', async () => {
    const f = join(PROJECT, 'slice.mp3');
    const data = wavBytes(5000);
    writeFileSync(f, data);
    const res = call(`path=${encodeURIComponent(f)}`, { headers: { range: 'bytes=10-99' } });
    await waitFinish(res);
    assert.equal(res.statusCode, 206);
    assert.equal(res.headers['Content-Range'], 'bytes 10-99/5000');
    assert.equal(Number(res.headers['Content-Length']), 90);
    assert.deepEqual(bodyBuf(res), data.subarray(10, 100));
  });

  it('206 clamps end beyond EOF', async () => {
    const f = join(PROJECT, 'clamp.mp3');
    writeFileSync(f, wavBytes(5000));
    const res = call(`path=${encodeURIComponent(f)}`, { headers: { range: 'bytes=0-999999999' } });
    await waitFinish(res);
    assert.equal(res.statusCode, 206);
    assert.equal(res.headers['Content-Range'], 'bytes 0-4999/5000');
    assert.equal(Number(res.headers['Content-Length']), 5000);
  });

  it('206 suffix range and suffix N>=size returns the whole file', async () => {
    const f = join(PROJECT, 'suffix.mp3');
    writeFileSync(f, wavBytes(5000));
    const r1 = call(`path=${encodeURIComponent(f)}`, { headers: { range: 'bytes=-100' } });
    await waitFinish(r1);
    assert.equal(r1.statusCode, 206);
    assert.equal(r1.headers['Content-Range'], 'bytes 4900-4999/5000');
    const r2 = call(`path=${encodeURIComponent(f)}`, { headers: { range: 'bytes=-5000' } });
    await waitFinish(r2);
    assert.equal(r2.statusCode, 206);
    assert.equal(r2.headers['Content-Range'], 'bytes 0-4999/5000');
  });

  it('416 on start>=size with Content-Range */size and Content-Length 0', async () => {
    const f = join(PROJECT, 'oob.mp3');
    writeFileSync(f, wavBytes(5000));
    const res = call(`path=${encodeURIComponent(f)}`, { headers: { range: 'bytes=5000-' } });
    await waitFinish(res);
    assert.equal(res.statusCode, 416);
    assert.equal(res.headers['Content-Range'], 'bytes */5000');
    assert.equal(Number(res.headers['Content-Length']), 0);
  });

  it('200 with Content-Length 0 for an empty file (no socket reset)', async () => {
    const f = join(PROJECT, 'empty.mp3');
    writeFileSync(f, Buffer.alloc(0));
    const res = call(`path=${encodeURIComponent(f)}`);
    await waitFinish(res);
    assert.equal(res.statusCode, 200);
    assert.equal(Number(res.headers['Content-Length']), 0);
    assert.equal(res.destroyed, false);
    assert.equal(bodyBuf(res).length, 0);
  });

  it('HEAD returns 200 headers with no body and ignores Range', async () => {
    const f = join(PROJECT, 'head.mp3');
    writeFileSync(f, wavBytes(5000));
    const res = call(`path=${encodeURIComponent(f)}`, { method: 'HEAD', headers: { range: 'bytes=0-10' } });
    await waitFinish(res);
    assert.equal(res.statusCode, 200);
    assert.equal(Number(res.headers['Content-Length']), 5000);
    assert.equal(res.headers['Content-Type'], 'audio/wav'); // HEAD also sniffs
    assert.equal(bodyBuf(res).length, 0);
  });

  it('304 on If-None-Match, ETag only', async () => {
    const f = join(PROJECT, 'cache.mp3');
    writeFileSync(f, wavBytes(5000));
    const first = call(`path=${encodeURIComponent(f)}`);
    await waitFinish(first);
    const etag = first.headers.ETag;
    const res = call(`path=${encodeURIComponent(f)}`, { headers: { 'if-none-match': etag } });
    await waitFinish(res);
    assert.equal(res.statusCode, 304);
    assert.equal(res.headers.ETag, etag);
    assert.equal(bodyBuf(res).length, 0);
  });

  it('If-Range hit serves 206, mismatch ignores Range → 200', async () => {
    const f = join(PROJECT, 'ifrange.mp3');
    writeFileSync(f, wavBytes(5000));
    const first = call(`path=${encodeURIComponent(f)}`);
    await waitFinish(first);
    const etag = first.headers.ETag;
    const hit = call(`path=${encodeURIComponent(f)}`, { headers: { range: 'bytes=0-9', 'if-range': etag } });
    await waitFinish(hit);
    assert.equal(hit.statusCode, 206);
    const miss = call(`path=${encodeURIComponent(f)}`, { headers: { range: 'bytes=0-9', 'if-range': '"stale"' } });
    await waitFinish(miss);
    assert.equal(miss.statusCode, 200);
    assert.equal(Number(miss.headers['Content-Length']), 5000);
  });

  it('.m4a keeps audio/mp4 and is not mislabeled video by the sniffer', async () => {
    const f = join(PROJECT, 'track.m4a');
    const m4a = Buffer.concat([Buffer.from([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]), Buffer.alloc(200, 1)]);
    writeFileSync(f, m4a);
    const res = call(`path=${encodeURIComponent(f)}`);
    await waitFinish(res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Content-Type'], 'audio/mp4');
    assert.ok(!res.headers['Content-Type'].startsWith('video/'));
  });

  it('client abort (res close) stops the stream without further writes', async () => {
    const f = join(PROJECT, 'abort.mp3');
    writeFileSync(f, wavBytes(200000));
    const res = makeRes();
    // Track writes after close; a destroyed stream must produce none.
    let wroteAfterClose = false;
    const origWrite = res.write;
    res.write = (c) => { if (res.closedFired) wroteAfterClose = true; return origWrite(c); };
    const parsedUrl = { pathname: '/api/audio-stream', searchParams: new URLSearchParams(`path=${encodeURIComponent(f)}`) };
    audioStream({ method: 'GET', headers: {} }, res, parsedUrl);
    res.closedFired = true;
    res.emit('close'); // fires res.on('close') → stream.destroy()
    await new Promise((r) => setImmediate(r));
    assert.equal(wroteAfterClose, false, 'no bytes written after close');
  });
});
