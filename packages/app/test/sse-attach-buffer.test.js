// Pure-function coverage for server/lib/attach-buffer.js — the per-connection
// buffer that closes the /events cold-load→clients.push broadcast-loss window.
//
// Exercised here without serveEventStream: the proxy's write/overflow/end
// contract (the surface _safeSseWrite relies on), and flushAttachBuffer's
// ordering / conv-coverage skip / dead-sink stop / fail-open behavior.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAttachBufferClient,
  flushAttachBuffer,
  ATTACH_BUFFER_MAX_BYTES,
} from '../server/lib/attach-buffer.js';

function convFrame(sessionId, channel, seq) {
  return `event: v3_conv\ndata: ${JSON.stringify({ sessionId, channel, line: { t: 'append', seq, msgs: [{ role: 'assistant', content: `m${seq}` }] } })}\n\n`;
}
function rowFrame(sessionId, seq) {
  return `event: v2_requests_delta\ndata: ${JSON.stringify({ sessionId, seq, timestamp: '2026-06-06T01:00:00.000Z', url: 'u' })}\n\n`;
}
function respFrame(sessionId, seq) {
  return `event: v3_resp\ndata: ${JSON.stringify({ sessionId, line: { seq, body: {} } })}\n\n`;
}

function makeSink() {
  const written = [];
  return {
    written,
    alive: () => true,
    write: (s) => { written.push(s); return true; },
  };
}

describe('attach-buffer: proxy write/end contract', () => {
  it('queues frames and always returns true (no backpressure kill)', () => {
    const c = createAttachBufferClient({});
    assert.equal(c.write('a'), true);
    assert.equal(c.write('bb'), true);
    assert.deepEqual(c.frames, ['a', 'bb']);
    assert.equal(c.bytes, 3);
    assert.equal(c.destroyed, false);
    assert.equal(c.writable, true);
    assert.equal(c._wireEnc, undefined, 'no encoder → sseWrite routes raw text to write()');
  });

  it('stamps project/instance view scope only when provided', () => {
    const scoped = createAttachBufferClient({ project: 'proj', instance: 'ccv-abc' });
    assert.equal(scoped._ccvViewProject, 'proj');
    assert.equal(scoped._ccvViewInstance, 'ccv-abc');
    const bare = createAttachBufferClient({});
    assert.equal(bare._ccvViewProject, undefined);
    assert.equal(bare._ccvViewInstance, undefined);
  });

  it('overflows past the byte cap: clears, flags, reports, still returns true', () => {
    let overflowAt = -1;
    const c = createAttachBufferClient({ maxBytes: 10, onOverflow: (b) => { overflowAt = b; } });
    c.write('12345');           // bytes=5
    assert.equal(c.overflowed, false);
    c.write('678901');          // 5+6=11 > 10 → overflow
    assert.equal(c.overflowed, true);
    assert.equal(overflowAt, 11, 'onOverflow receives the byte count that tripped the cap');
    assert.deepEqual(c.frames, [], 'queue cleared on overflow');
    assert.equal(c.write('more'), true, 'post-overflow writes are dropped, still true');
    assert.deepEqual(c.frames, []);
  });

  it('default cap is ATTACH_BUFFER_MAX_BYTES (32MB)', () => {
    const c = createAttachBufferClient({});
    c.write('x'.repeat(1000));
    assert.equal(c.overflowed, false);
    assert.ok(ATTACH_BUFFER_MAX_BYTES > 1000);
  });

  it('end() releases the queue and marks the proxy unusable', () => {
    const c = createAttachBufferClient({});
    c.write('a');
    c.end();
    assert.equal(c.destroyed, true);
    assert.equal(c.writable, false);
    assert.deepEqual(c.frames, []);
    assert.equal(c.write('late'), true, 'write after end is a safe no-op');
    assert.deepEqual(c.frames, []);
  });

  it('exposes a no-op listener surface (stray .once/.on must not throw)', () => {
    const c = createAttachBufferClient({});
    assert.doesNotThrow(() => { c.on('drain', () => {}); c.once('drain', () => {}); c.off('drain', () => {}); c.removeListener('drain', () => {}); });
  });
});

describe('attach-buffer: flushAttachBuffer', () => {
  it('replays queued frames in order through the sink, then clears', () => {
    const c = createAttachBufferClient({});
    c.write(rowFrame('s1', 1));
    c.write(rowFrame('s1', 2));
    const sink = makeSink();
    const r = flushAttachBuffer(sink, c, null);
    assert.equal(r.replayed, 2);
    assert.deepEqual(sink.written, [rowFrame('s1', 1), rowFrame('s1', 2)]);
    assert.deepEqual(c.frames, [], 'queue drained after flush');
  });

  it('skips a v3_conv frame the cold coverage already carried (idempotency guard)', () => {
    const c = createAttachBufferClient({});
    c.write(convFrame('s1', 'main', 1));  // covered → skip
    c.write(convFrame('s1', 'main', 2));  // new → replay
    c.write(respFrame('s1', 2));          // resp: always replay (client upserts)
    const coverage = new Map([['s1\x00main', { seqs: new Set([1]), baseSeq: 1 }]]);
    const sink = makeSink();
    const r = flushAttachBuffer(sink, c, coverage);
    assert.equal(r.skipped, 1);
    assert.equal(r.replayed, 2);
    assert.deepEqual(sink.written, [convFrame('s1', 'main', 2), respFrame('s1', 2)]);
  });

  it('skips a conv frame whose seq predates the coverage baseSeq', () => {
    const c = createAttachBufferClient({});
    c.write(convFrame('s1', 'main', 3)); // baseSeq=5 → 3 < 5 → covered → skip
    const coverage = new Map([['s1\x00main', { seqs: new Set([5, 6]), baseSeq: 5 }]]);
    const sink = makeSink();
    const r = flushAttachBuffer(sink, c, coverage);
    assert.equal(r.skipped, 1);
    assert.equal(r.replayed, 0);
  });

  it('does NOT skip a conv frame for a different channel or session', () => {
    const c = createAttachBufferClient({});
    c.write(convFrame('s1', 'teammate', 1));  // channel not covered
    c.write(convFrame('s2', 'main', 1));      // session not covered
    const coverage = new Map([['s1\x00main', { seqs: new Set([1]), baseSeq: 1 }]]);
    const sink = makeSink();
    const r = flushAttachBuffer(sink, c, coverage);
    assert.equal(r.skipped, 0);
    assert.equal(r.replayed, 2);
  });

  it('fails open (replays all) when coverage is null or the frame is unparseable', () => {
    const c = createAttachBufferClient({});
    c.write(convFrame('s1', 'main', 1));
    c.write('event: v3_conv\ndata: {not json}\n\n'); // torn → fail-open
    const sink = makeSink();
    const r = flushAttachBuffer(sink, c, null);
    assert.equal(r.skipped, 0);
    assert.equal(r.replayed, 2);
  });

  it('is a no-op for a null, overflowed, or destroyed client', () => {
    const sink = makeSink();
    assert.deepEqual(flushAttachBuffer(sink, null, null), { replayed: 0, skipped: 0 });
    const over = createAttachBufferClient({ maxBytes: 1 });
    over.write('xx');
    assert.deepEqual(flushAttachBuffer(sink, over, null), { replayed: 0, skipped: 0 });
    const dead = createAttachBufferClient({});
    dead.write('a');
    dead.end();
    assert.deepEqual(flushAttachBuffer(sink, dead, null), { replayed: 0, skipped: 0 });
    assert.deepEqual(sink.written, [], 'nothing written for null/overflowed/destroyed');
  });

  it('stops at the first dead sink and reports the write error', () => {
    const c = createAttachBufferClient({});
    c.write(rowFrame('s1', 1));
    c.write(rowFrame('s1', 2));
    const sink = {
      written: 0,
      alive: () => true,
      write: () => { throw new Error('pipe gone'); },
    };
    const r = flushAttachBuffer(sink, c, null);
    assert.equal(r.replayed, 0, 'first write threw → stop, do not replay the rest');
  });

  it('honors sink.alive() going false mid-flush', () => {
    const c = createAttachBufferClient({});
    c.write(rowFrame('s1', 1));
    c.write(rowFrame('s1', 2));
    let calls = 0;
    const sink = {
      written: [],
      alive: () => calls < 1, // alive for the first frame only
      write(s) { calls++; this.written.push(s); return true; },
    };
    const r = flushAttachBuffer(sink, c, null);
    assert.equal(r.replayed, 1, 'second frame skipped once sink died');
    assert.equal(sink.written.length, 1);
  });
});
