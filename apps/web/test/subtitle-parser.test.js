import './_shims/register.mjs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { parseSubtitle, MAX_CUES } = await import('../src/utils/subtitleParser.js');
const { decodeTextBytes } = await import('../src/vendor/archive/util.js');

describe('SRT parsing', () => {
  it('parses basic cues into millisecond times', () => {
    const text = '1\n00:00:01,000 --> 00:00:04,000\nHello world\n\n2\n00:00:05,000 --> 00:00:07,500\nSecond line\n';
    const { format, cues, truncated } = parseSubtitle(text, 'srt');
    assert.equal(format, 'srt');
    assert.equal(truncated, false);
    assert.equal(cues.length, 2);
    assert.deepEqual(cues[0], { index: 1, start: 1000, end: 4000, text: 'Hello world' });
    assert.deepEqual(cues[1], { index: 2, start: 5000, end: 7500, text: 'Second line' });
  });

  it('normalizes CRLF and accepts dot millis separator', () => {
    const text = '1\r\n00:00:01.000 --> 00:00:02.000\r\nHi\r\n';
    const { cues } = parseSubtitle(text, 'srt');
    assert.equal(cues.length, 1);
    assert.equal(cues[0].start, 1000);
    assert.equal(cues[0].end, 2000);
  });

  it('finds the timing line despite a missing index and leading blank lines', () => {
    const text = '\n\n00:00:01,000 --> 00:00:02,000\nNo index cue\n';
    const { cues } = parseSubtitle(text, 'srt');
    assert.equal(cues.length, 1);
    assert.equal(cues[0].text, 'No index cue');
    assert.equal(cues[0].index, 1);
  });

  it('reassigns indices sequentially, ignoring file numbering', () => {
    const text = '7\n00:00:01,000 --> 00:00:02,000\nA\n\n99\n00:00:03,000 --> 00:00:04,000\nB\n';
    const { cues } = parseSubtitle(text, 'srt');
    assert.equal(cues[0].index, 1);
    assert.equal(cues[1].index, 2);
  });

  it('tolerates a missing trailing newline and joins multi-line text', () => {
    const text = '1\n00:00:01,000 --> 00:00:02,000\nline one\nline two';
    const { cues } = parseSubtitle(text, 'srt');
    assert.equal(cues.length, 1);
    assert.equal(cues[0].text, 'line one\nline two');
  });

  it('allows an empty-text cue', () => {
    const text = '1\n00:00:01,000 --> 00:00:02,000\n\n2\n00:00:03,000 --> 00:00:04,000\nNext\n';
    const { cues } = parseSubtitle(text, 'srt');
    assert.equal(cues.length, 2);
    assert.equal(cues[0].text, '');
  });

  it('skips blocks without a timing line and never throws', () => {
    const text = 'not a number\njust text\n\n1\n00:00:01,000 --> 00:00:02,000\nReal\n';
    const { cues } = parseSubtitle(text, 'srt');
    assert.equal(cues.length, 1);
    assert.equal(cues[0].text, 'Real');
  });
});

describe('VTT parsing', () => {
  it('parses cues after the WEBVTT header', () => {
    const text = 'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nHello\n\n00:00:05.000 --> 00:00:06.000\nWorld\n';
    const { format, cues } = parseSubtitle(text, 'vtt');
    assert.equal(format, 'vtt');
    assert.equal(cues.length, 2);
    assert.equal(cues[0].start, 1000);
  });

  it('skips WEBVTT header metadata before the first blank line', () => {
    const text = 'WEBVTT - My Title\nKind: captions\nLanguage: en\n\n00:00:01.000 --> 00:00:02.000\nHi\n';
    const { cues } = parseSubtitle(text, 'vtt');
    assert.equal(cues.length, 1);
    assert.equal(cues[0].text, 'Hi');
  });

  it('accepts MM:SS.mmm timestamps without hours', () => {
    const text = 'WEBVTT\n\n01:30.500 --> 01:32.000\nShort form\n';
    const { cues } = parseSubtitle(text, 'vtt');
    assert.equal(cues.length, 1);
    assert.equal(cues[0].start, 90500);
    assert.equal(cues[0].end, 92000);
  });

  it('treats the cue identifier line as metadata, not text', () => {
    const text = 'WEBVTT\n\ncue-1\n00:00:01.000 --> 00:00:02.000\nActual text\n';
    const { cues } = parseSubtitle(text, 'vtt');
    assert.equal(cues.length, 1);
    assert.equal(cues[0].text, 'Actual text');
    assert.equal(cues[0].index, 1);
  });

  it('ignores cue settings after the timestamps', () => {
    const text = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000 position:50% line:5%\nStyled\n';
    const { cues } = parseSubtitle(text, 'vtt');
    assert.equal(cues.length, 1);
    assert.equal(cues[0].text, 'Styled');
  });

  it('skips NOTE, STYLE and REGION blocks, including --> inside NOTE', () => {
    const text = 'WEBVTT\n\nNOTE this has --> inside\n\nSTYLE\n::cue { color: red }\n\nREGION\nid:foo\n\n00:00:01.000 --> 00:00:02.000\nReal\n';
    const { cues } = parseSubtitle(text, 'vtt');
    assert.equal(cues.length, 1);
    assert.equal(cues[0].text, 'Real');
  });

  it('still parses cues when the WEBVTT header has no trailing blank line', () => {
    const text = 'WEBVTT\n00:00:01.000 --> 00:00:02.000\nHello\n';
    const { cues } = parseSubtitle(text, 'vtt');
    assert.equal(cues.length, 1);
    assert.equal(cues[0].text, 'Hello');
  });
});

describe('ASS/SSA parsing', () => {
  const header = '[Script Info]\nTitle: x\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize\nStyle: Default,Arial,20\n\n[Events]\n';

  it('parses Dialogue lines via the [Events] Format: row', () => {
    const text = header + 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n' +
      'Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,Hello world\n';
    const { format, cues } = parseSubtitle(text, 'ass');
    assert.equal(format, 'ass');
    assert.equal(cues.length, 1);
    assert.equal(cues[0].start, 1000);
    assert.equal(cues[0].end, 4000);
    assert.equal(cues[0].text, 'Hello world');
  });

  it('converts centisecond timestamps to milliseconds', () => {
    const text = header + 'Dialogue: 0,0:00:01.50,0:00:02.05,Default,,0,0,0,,Hi\n';
    const { cues } = parseSubtitle(text, 'ass');
    assert.equal(cues[0].start, 1500);
    assert.equal(cues[0].end, 2050);
  });

  it('does not mistake the [V4+ Styles] Format: row for the events format', () => {
    const text = header + 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n' +
      'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Real cue\n';
    const { cues } = parseSubtitle(text, 'ass');
    assert.equal(cues.length, 1);
    assert.equal(cues[0].text, 'Real cue');
  });

  it('keeps commas inside the Text field', () => {
    const text = header + 'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,one, two, three\n';
    const { cues } = parseSubtitle(text, 'ass');
    assert.equal(cues[0].text, 'one, two, three');
  });

  it('skips Comment and other non-Dialogue event lines', () => {
    const text = header +
      'Comment: 0,0:00:09.00,0:00:10.00,Default,,0,0,0,,ignored\n' +
      'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,kept\n';
    const { cues } = parseSubtitle(text, 'ass');
    assert.equal(cues.length, 1);
    assert.equal(cues[0].text, 'kept');
  });

  it('strips override blocks and converts \\N and \\h', () => {
    const text = header + 'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\an8\\pos(10,10)}Top\\NNext\\hline\n';
    const { cues } = parseSubtitle(text, 'ass');
    assert.equal(cues[0].text, 'Top\nNext line');
  });

  it('falls back to the standard column order when Format: is missing', () => {
    const text = '[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,No format line\n';
    const { cues } = parseSubtitle(text, 'ass');
    assert.equal(cues.length, 1);
    assert.equal(cues[0].text, 'No format line');
  });

  it('parses SSA v4 Marked rows the same way', () => {
    const text = '[Events]\nFormat: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n' +
      'Dialogue: Marked=0,0:00:01.00,0:00:02.00,Default,,0,0,0,,SSA line\n';
    const { format, cues } = parseSubtitle(text, 'ssa');
    assert.equal(format, 'ass');
    assert.equal(cues.length, 1);
    assert.equal(cues[0].text, 'SSA line');
  });

  it('falls back to the standard column layout when Format: moves Text off the end', () => {
    // Nonstandard: Text is not the last column. Mixing indices from this layout
    // with the standard one would mis-assign columns, so the whole line falls back.
    const weird = '[Events]\nFormat: Layer, Text, Start, End, Style\n' +
      'Dialogue: 0,Hello world,0:00:01.00,0:00:02.00,Def\n';
    const { cues } = parseSubtitle(weird, 'ass');
    // The line does not satisfy the standard 10-column layout, so it is skipped
    // rather than parsed into garbage columns.
    assert.equal(cues.length, 0);
  });
});

describe('robustness and limits', () => {
  it('returns empty cues for empty or unknown input without throwing', () => {
    assert.deepEqual(parseSubtitle('', 'srt'), { format: 'srt', cues: [], truncated: false });
    assert.deepEqual(parseSubtitle(null, 'srt').cues, []);
    assert.equal(parseSubtitle('garbage', 'txt').format, null);
    assert.equal(parseSubtitle('1\nnot a time\n', 'srt').cues.length, 0);
  });

  it('uppercases extensions and tolerates a leading dot', () => {
    const text = '1\n00:00:01,000 --> 00:00:02,000\nHi\n';
    assert.equal(parseSubtitle(text, '.SRT').cues.length, 1);
    assert.equal(parseSubtitle(text, 'SRT').cues.length, 1);
  });

  it('never throws on a megabyte of random ASCII', () => {
    let s = '';
    for (let i = 0; i < 1024 * 1024; i++) s += String.fromCharCode(32 + (i % 95));
    assert.doesNotThrow(() => parseSubtitle(s, 'srt'));
  });

  it('caps cues at MAX_CUES and flags truncation', () => {
    const parts = [];
    for (let i = 0; i < MAX_CUES + 50; i++) {
      parts.push(`${i + 1}\n00:00:01,000 --> 00:00:02,000\ncue ${i}\n`);
    }
    const { cues, truncated } = parseSubtitle(parts.join('\n'), 'srt');
    assert.equal(cues.length, MAX_CUES);
    assert.equal(truncated, true);
  });

  it('does not false-positive truncation at exactly MAX_CUES with a trailing blank line', () => {
    const parts = [];
    for (let i = 0; i < MAX_CUES; i++) {
      parts.push(`${i + 1}\n00:00:01,000 --> 00:00:02,000\ncue ${i}\n`);
    }
    const { cues, truncated } = parseSubtitle(parts.join('\n'), 'srt');
    assert.equal(cues.length, MAX_CUES);
    assert.equal(truncated, false);
  });

  it('decodes GBK subtitle bytes via decodeTextBytes before parsing', () => {
    // "你好" in GBK is 0xc4 0xe3 0xba 0xc3.
    const gbk = Uint8Array.from([
      ...[0x31], // '1'
      0x0a,
      ...[...'00:00:01,000 --> 00:00:02,000'].map(c => c.charCodeAt(0)),
      0x0a,
      0xc4, 0xe3, 0xba, 0xc3,
      0x0a,
    ]);
    const { text, encoding } = decodeTextBytes(gbk);
    assert.equal(encoding, 'gbk');
    const { cues } = parseSubtitle(text, 'srt');
    assert.equal(cues.length, 1);
    assert.equal(cues[0].text, '你好');
  });

  it('decodes UTF-16 LE BOM subtitle bytes before parsing', () => {
    const s = '1\n00:00:01,000 --> 00:00:02,000\nHello\n';
    const buf = new Uint8Array(2 + s.length * 2);
    buf[0] = 0xff; buf[1] = 0xfe;
    for (let i = 0; i < s.length; i++) { buf[2 + i * 2] = s.charCodeAt(i); buf[3 + i * 2] = 0; }
    const { text, encoding } = decodeTextBytes(buf);
    assert.equal(encoding, 'utf-16le');
    const { cues } = parseSubtitle(text, 'srt');
    assert.equal(cues.length, 1);
    assert.equal(cues[0].text, 'Hello');
  });
});
