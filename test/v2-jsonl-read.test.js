/**
 * wire-v2 — streaming JSONL line reader (server/lib/v2/jsonl-read.js, issue #129).
 *
 * Pure unit tier against mkdtemp dirs. Pins: chunked line splitting (lines
 * straddling chunk boundaries), multi-byte UTF-8 characters split ACROSS a
 * chunk boundary (byte-level \n scan — no torn decode), CRLF, blank lines,
 * torn tail (no trailing newline), missing/empty files, oversized-line skip
 * (the ERR_STRING_TOO_LONG class), and readJsonlTolerant equivalence.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { iterateJsonlLines } from '../packages/app/server/lib/v2/jsonl-read.js';
import { readJsonlTolerant } from '../packages/app/server/lib/v2/replay.js';
import { _resetForTest } from '../packages/app/server/lib/error-report.js';

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ccv-jsonl-')); _resetForTest(); });
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

const fileOf = (name, content) => {
  const p = join(dir, name);
  writeFileSync(p, content);
  return p;
};
const linesOf = (p, opts) => [...iterateJsonlLines(p, opts)];

describe('iterateJsonlLines', () => {
  it('yields trimmed lines, skipping blanks; tolerates a torn tail without trailing newline', () => {
    const p = fileOf('a.jsonl', '{"seq":1}\n\n  \n{"seq":2}\r\n{"seq":3,"torn"');
    assert.deepEqual(linesOf(p), ['{"seq":1}', '{"seq":2}', '{"seq":3,"torn"']);
  });

  it('missing and empty files yield nothing', () => {
    assert.deepEqual(linesOf(join(dir, 'nope.jsonl')), []);
    assert.deepEqual(linesOf(fileOf('empty.jsonl', '')), []);
  });

  it('lines straddling chunk boundaries reassemble byte-exact (tiny chunk seam)', () => {
    const rows = Array.from({ length: 50 }, (_, i) => JSON.stringify({ seq: i, pad: 'x'.repeat(i % 13) }));
    const p = fileOf('chunked.jsonl', rows.join('\n') + '\n');
    assert.deepEqual(linesOf(p, { chunkBytes: 7 }), rows);
  });

  it('multi-byte UTF-8 split across a chunk boundary is never torn (byte-level \\n scan)', () => {
    // 3-byte CJK chars with chunkBytes=4 force splits INSIDE characters.
    const rows = [JSON.stringify({ t: '中文测试内容' }), JSON.stringify({ t: '第二行汉字' })];
    const p = fileOf('cjk.jsonl', rows.join('\n') + '\n');
    for (const chunkBytes of [2, 3, 4, 5, 7]) {
      assert.deepEqual(linesOf(p, { chunkBytes }), rows, `chunkBytes=${chunkBytes}`);
    }
  });

  it('a line EXACTLY at maxLineBytes is kept (the skip boundary is strictly greater-than)', () => {
    const exact = 'a'.repeat(64); // 64 bytes, ASCII
    const p = fileOf('exact.jsonl', `${exact}\n{"seq":2}\n`);
    assert.deepEqual(linesOf(p, { maxLineBytes: 64, chunkBytes: 16 }), [exact, '{"seq":2}'],
      'an off-by-one flip to >= would drop a legal max-length line');
  });

  it('an oversized line is skipped (not thrown); neighbors survive', () => {
    const big = JSON.stringify({ seq: 2, blob: 'y'.repeat(300) });
    const p = fileOf('big.jsonl', `{"seq":1}\n${big}\n{"seq":3}\n`);
    assert.deepEqual(linesOf(p, { maxLineBytes: 64, chunkBytes: 16 }),
      ['{"seq":1}', '{"seq":3}'],
      'the ERR_STRING_TOO_LONG class degrades to a skipped line');
    // oversized line at EOF without trailing newline
    const p2 = fileOf('big-tail.jsonl', `{"seq":1}\n${big}`);
    assert.deepEqual(linesOf(p2, { maxLineBytes: 64, chunkBytes: 16 }), ['{"seq":1}']);
  });

  it('readJsonlTolerant rides the streaming reader: parses lines, drops the torn tail', () => {
    const p = fileOf('t.jsonl', '{"seq":1}\n{"seq":2}\n{"seq":3,"to');
    assert.deepEqual(readJsonlTolerant(p), [{ seq: 1 }, { seq: 2 }]);
    assert.deepEqual(readJsonlTolerant(join(dir, 'missing.jsonl')), []);
  });
});
