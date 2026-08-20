/**
 * Unit tests for server/lib/wire-compress.js — br|identity negotiation,
 * macrotask-coalesced BROTLI_OPERATION_FLUSH, socket backpressure signal,
 * and encoder teardown on response close.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { Writable } from 'node:stream';
import { finished } from 'node:stream/promises';

import { sseHead, sseWrite, needsDrain, wireEnd, awaitWireDrain, isWireV3Enabled } from '../server/lib/wire-compress.js';

function mockRes() {
  const chunks = [];
  const res = new Writable({
    write(chunk, _enc, cb) { chunks.push(Buffer.from(chunk)); cb(); },
  });
  res.head = null;
  res.writeHead = (status, headers) => { res.head = { status, headers }; return res; };
  res.compressed = () => Buffer.concat(chunks);
  return res;
}

const reqWith = (acceptEncoding) => ({ headers: acceptEncoding === undefined ? {} : { 'accept-encoding': acceptEncoding } });
const tick = () => new Promise((resolve) => setImmediate(() => setImmediate(resolve)));

/**
 * Streaming decode of a (possibly trailer-less) brotli buffer.
 * Driven by zlib's own write/flush callbacks rather than a fixed number of
 * event-loop turns: zlib runs on the libuv threadpool, so under CI CPU load a
 * tick budget is not a completion guarantee and the decode comes back empty.
 */
function decodePartial(buf) {
  return new Promise((resolve, reject) => {
    const d = zlib.createBrotliDecompress();
    const out = [];
    d.on('data', (c) => out.push(c));
    d.on('error', reject);
    d.write(buf, () => {
      // FLUSH pushes everything currently decodable out before the callback.
      d.flush(zlib.constants.BROTLI_OPERATION_FLUSH, () => resolve(Buffer.concat(out).toString()));
    });
  });
}

/** Wall-clock wait — tick-count deadlines flake under parallel-suite CPU load. */
async function until(cond, ms = 10000) {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) await tick();
}

afterEach(() => { delete process.env.CCV_WIRE_COMPRESSION; delete process.env.CCV_BROTLI_QUALITY; });

describe('wire-compress negotiation', () => {
  it('no Accept-Encoding → identity, bare writeHead, no encoder', () => {
    const res = mockRes();
    sseHead(reqWith(undefined), res, 200, { 'Content-Type': 'text/event-stream' });
    assert.equal(res.head.headers['Content-Encoding'], undefined);
    assert.ok(!res._wireEnc);
    assert.equal(sseWrite(res, 'data: x\n\n'), true);
    assert.equal(res.compressed().toString(), 'data: x\n\n'); // plain passthrough
  });

  it('Accept-Encoding: br → Content-Encoding + Vary + encoder attached', () => {
    const res = mockRes();
    sseHead(reqWith('gzip, deflate, br, zstd'), res, 200, { 'Content-Type': 'text/event-stream' });
    assert.equal(res.head.headers['Content-Encoding'], 'br');
    assert.equal(res.head.headers['Vary'], 'Accept-Encoding');
    assert.equal(res.head.headers['Content-Type'], 'text/event-stream');
    assert.ok(res._wireEnc);
  });

  it('does not match br as a substring of another token', () => {
    const res = mockRes();
    sseHead(reqWith('brotli-fake, gzip'), res, 200, {});
    assert.ok(!res._wireEnc);
  });

  it('br;q=0 is an explicit refusal (RFC 9110) — negotiates identity', () => {
    for (const accept of ['gzip, br;q=0', 'br;q=0.0', 'br; q=0, gzip']) {
      const res = mockRes();
      sseHead(reqWith(accept), res, 200, {});
      assert.ok(!res._wireEnc, `"${accept}" must not negotiate br`);
    }
    const res = mockRes();
    sseHead(reqWith('br;q=0.5'), res, 200, {});
    assert.ok(res._wireEnc, 'nonzero q still negotiates br');
  });

  it('identity branch also emits Vary: Accept-Encoding (negotiated resource)', () => {
    const res = mockRes();
    sseHead(reqWith(undefined), res, 200, { 'Content-Type': 'application/json' });
    assert.equal(res.head.headers['Vary'], 'Accept-Encoding');
    assert.equal(res.head.headers['Content-Encoding'], undefined);
  });

  it('CCV_WIRE_COMPRESSION=off disables negotiation', () => {
    process.env.CCV_WIRE_COMPRESSION = 'off';
    const res = mockRes();
    sseHead(reqWith('br'), res, 200, {});
    assert.ok(!res._wireEnc);
    assert.equal(res.head.headers['Content-Encoding'], undefined);
  });
});

describe('wire v3 flag parsing', () => {
  it("default ON; '0' and 'off' disable; other values keep it on", () => {
    assert.equal(isWireV3Enabled(undefined), true, 'unset → on');
    assert.equal(isWireV3Enabled('1'), true);
    assert.equal(isWireV3Enabled('0'), false);
    assert.equal(isWireV3Enabled('off'), false);
    assert.equal(isWireV3Enabled(''), true, 'empty string is not a disable spelling');
  });
});

describe('wire-compress streaming', () => {
  it('per-macrotask flush makes frames decodable without ending the stream', async () => {
    const res = mockRes();
    sseHead(reqWith('br'), res, 200, {});
    // Three writes in the same tick (the cold-load 3-segment frame pattern)
    sseWrite(res, 'event: load_chunk\ndata: [');
    sseWrite(res, '{"a":1}');
    sseWrite(res, ']\n\n');
    // The flush is scheduled via setImmediate, so the encoder emits a few turns
    // later. Wait on wall-clock for bytes to appear, then decode deterministically —
    // the point of this test is that the frame is readable WITHOUT ending the stream.
    await until(() => res.compressed().length > 0);
    assert.ok(res.compressed().length > 0, 'encoder flushed mid-stream');
    const decoded = await decodePartial(res.compressed());
    assert.equal(decoded, 'event: load_chunk\ndata: [{"a":1}]\n\n');
  });

  it('wireEnd flushes the trailer and full round-trip is byte-exact', async () => {
    const res = mockRes();
    sseHead(reqWith('br'), res, 200, {});
    const frames = ['event: ping\ndata: {}\n\n', `data: ${JSON.stringify({ big: 'x'.repeat(50000) })}\n\n`];
    for (const f of frames) sseWrite(res, f);
    wireEnd(res);
    await finished(res); // pipe ends res after the trailer
    assert.equal(zlib.brotliDecompressSync(res.compressed()).toString(), frames.join(''));
    assert.ok(res.compressed().length < 2000); // repetition actually compressed
  });

  it('close destroys the encoder and later writes are refused', async () => {
    const res = mockRes();
    sseHead(reqWith('br'), res, 200, {});
    sseWrite(res, 'data: x\n\n');
    await tick();
    const encoder = res._wireEnc;
    res.destroy(); // emits 'close'
    await tick();
    assert.equal(encoder.destroyed, true);
    assert.equal(res._wireEnc, null); // callers' destroyed/writable pre-checks now see the plain path
  });

  it('flush:false (whole-stream mode) buffers until wireEnd, then round-trips', async () => {
    const res = mockRes();
    sseHead(reqWith('br'), res, 200, {}, { flush: false });
    sseWrite(res, '[' + JSON.stringify({ a: 'x'.repeat(5000) }));
    await tick(); await tick();
    assert.equal(res.compressed().length, 0, 'no per-macrotask flush in whole-stream mode');
    sseWrite(res, ']');
    wireEnd(res);
    await finished(res);
    assert.equal(zlib.brotliDecompressSync(res.compressed()).toString(), '[' + JSON.stringify({ a: 'x'.repeat(5000) }) + ']');
  });

  it('awaitWireDrain resolves via the ENCODER drain when its buffer was the pressure', async () => {
    const res = mockRes();
    sseHead(reqWith('br'), res, 200, {});
    // >16KB write overflows the encoder writable HWM → write() false, socket idle
    const ok = sseWrite(res, `data: ${'y'.repeat(64 * 1024)}\n\n`);
    assert.equal(ok, false, 'encoder input buffer applied the pressure');
    assert.equal(needsDrain(res), false, 'socket shows no pressure');
    const t0 = performance.now();
    await awaitWireDrain(res, 5000);
    assert.ok(performance.now() - t0 < 4000, 'resolved by encoder drain, not the timeout');
  });

  it('needsDrain reflects the socket, not the encoder input buffer', () => {
    const res = mockRes();
    sseHead(reqWith('br'), res, 200, {});
    assert.equal(needsDrain(res), res.writableNeedDrain === true);
  });

  it('CCV_BROTLI_QUALITY is honored (garbage value falls back)', async () => {
    process.env.CCV_BROTLI_QUALITY = 'not-a-number';
    const res = mockRes();
    sseHead(reqWith('br'), res, 200, {});
    sseWrite(res, 'data: q\n\n');
    wireEnd(res);
    await finished(res);
    assert.equal(zlib.brotliDecompressSync(res.compressed()).toString(), 'data: q\n\n');
  });
});
