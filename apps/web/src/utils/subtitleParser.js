/**
 * subtitleParser.js — pure SRT/VTT/ASS/SSA cue parsing for the subtitle preview.
 *
 * No JSX, no fetch, no DOM — safe to unit-test under node:test. The input is
 * already-decoded text (see vendor/archive/util.js decodeTextBytes); the output
 * cues are plain strings rendered by SubtitlePreview as React text nodes, so
 * HTML-like SRT/VTT tags and ASS override blocks never execute.
 *
 * Design contract:
 * - Never throws on malformed/truncated input: it returns the cues parsed so far.
 * - Times are normalized to integer milliseconds.
 * - Cue `index` is assigned sequentially (1-based); the file's own numbering is
 *   not trusted (SRT files often have gaps or duplicates).
 * - Cue count is capped at MAX_CUES; `truncated` flags that more cues remained.
 */

const MAX_CUES = 3000;

// SRT/VTT timestamp: [HH:]MM:SS with , or . millis. VTT allows omitting hours.
const SRT_VTT_TIME = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/;
// ASS/SSA timestamp: H:MM:SS.cc (centiseconds). The hour field is bounded and
// anchored so a long run of digits with no colon cannot backtrack quadratically.
const ASS_TIME = /^(\d{1,6}):(\d{1,2}):(\d{1,2})[.:](\d{1,2})/;

function parseSrtVttTime(match) {
  const h = match[1] ? Number(match[1]) : 0;
  const m = Number(match[2]);
  const s = Number(match[3]);
  // Millis are 1-3 digits, right-padded: "5" = 500ms, "05" = 50ms.
  const ms = Number(match[4].padEnd(3, '0'));
  return ((h * 60 + m) * 60 + s) * 1000 + ms;
}

function parseAssTime(match) {
  const h = Number(match[1]);
  const m = Number(match[2]);
  const s = Number(match[3]);
  // Centiseconds are 1-2 digits, right-padded: ".5" = 50cs, ".05" = 5cs.
  const cs = Number(match[4].padEnd(2, '0'));
  return ((h * 60 + m) * 60 + s) * 1000 + cs * 10;
}

// A line containing an SRT/VTT timing range ("start --> end" + optional settings).
function matchSrtVttTiming(line) {
  const arrow = line.indexOf('-->');
  if (arrow === -1) return null;
  const startM = SRT_VTT_TIME.exec(line.slice(0, arrow));
  const endM = SRT_VTT_TIME.exec(line.slice(arrow + 3));
  if (!startM || !endM) return null;
  return { start: parseSrtVttTime(startM), end: parseSrtVttTime(endM) };
}

function normalizeNewlines(text) {
  return String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function parseSrt(text, cues) {
  // Split into blank-line-separated blocks; find the timing line within each
  // block so missing/stray index numbers and leading blank lines are tolerated.
  const blocks = text.split(/\n[ \t]*\n/);
  for (let bi = 0; bi < blocks.length; bi++) {
    // Cap reached: only flag truncation if a later block actually holds a cue.
    if (cues.length >= MAX_CUES) {
      return blocks.slice(bi).some(b => b.split('\n').some(l => matchSrtVttTiming(l)));
    }
    const lines = blocks[bi].split('\n');
    let timeIdx = -1;
    let timing = null;
    for (let i = 0; i < lines.length; i++) {
      timing = matchSrtVttTiming(lines[i]);
      if (timing) { timeIdx = i; break; }
    }
    if (!timing) continue;
    const cueText = lines.slice(timeIdx + 1).join('\n').trim();
    cues.push({ index: cues.length + 1, start: timing.start, end: timing.end, text: cueText });
  }
  return false;
}

const VTT_BLOCK_KEYWORDS = /^(NOTE|STYLE|REGION)([\s:]|$)/;

function parseVtt(text, cues) {
  const lines = text.split('\n');
  // Skip the WEBVTT header: the magic line plus any metadata up to the first blank
  // line. If no blank line exists, stop at the first cue (a "-->" line) so a header
  // without a trailing blank does not swallow every cue.
  let i = 0;
  if (lines[0] && lines[0].startsWith('WEBVTT')) {
    i = 1;
    while (i < lines.length && lines[i].trim() !== '' && !matchSrtVttTiming(lines[i])) i++;
  }
  // Collect cue blocks separated by blank lines.
  let block = [];
  const flush = () => {
    if (block.length === 0) return;
    const first = block[0];
    // NOTE/STYLE/REGION blocks are metadata, not cues. A "-->" inside a NOTE
    // payload must not become a cue, so the whole block is dropped.
    if (VTT_BLOCK_KEYWORDS.test(first.trim())) { block = []; return; }
    if (cues.length >= MAX_CUES) { block = []; return; }
    // A cue may have an identifier line before the timing line; it is not text.
    let timeIdx = -1;
    let timing = null;
    for (let k = 0; k < block.length; k++) {
      timing = matchSrtVttTiming(block[k]);
      if (timing) { timeIdx = k; break; }
    }
    if (timing) {
      const cueText = block.slice(timeIdx + 1).join('\n').trim();
      cues.push({ index: cues.length + 1, start: timing.start, end: timing.end, text: cueText });
    }
    block = [];
  };
  for (; i < lines.length; i++) {
    // Cap reached: only flag truncation if a real cue actually remains.
    if (cues.length >= MAX_CUES) return hasTimingLine(lines, i);
    const line = lines[i];
    if (line.trim() === '') { flush(); continue; }
    block.push(line);
  }
  flush();
  return false;
}

// Report whether any line from `from` onward holds a timing range (a real cue the
// cap forced us to drop), so the truncation notice is not a false positive on a
// trailing blank line or a trailing NOTE/STYLE block.
function hasTimingLine(lines, from) {
  for (let k = from; k < lines.length; k++) if (matchSrtVttTiming(lines[k])) return true;
  return false;
}

function stripAssOverrides(text) {
  // Strip {...} override blocks with a linear scan: a regex like /\{[^}]*\}/g
  // backtracks quadratically on a run of '{' with no closing '}' (a crafted
  // Dialogue field near the byte cap could freeze the tab for minutes).
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const open = text.indexOf('{', i);
    if (open === -1) { out += text.slice(i); break; }
    out += text.slice(i, open);
    const close = text.indexOf('}', open + 1);
    if (close === -1) break; // Unterminated block: drop the rest.
    i = close + 1;
  }
  return out
    .replace(/\\N/gi, '\n')
    .replace(/\\h/g, ' ');
}

function parseAss(text, cues) {
  const lines = text.split('\n');
  let inEvents = false;
  let formatCols = null;
  let sawMore = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const section = /^\[(.+)\]$/.exec(line);
    if (section) {
      inEvents = section[1].trim().toLowerCase() === 'events';
      continue;
    }
    if (!inEvents) continue;
    const fmt = /^format:\s*(.+)$/i.exec(line);
    if (fmt) {
      formatCols = fmt[1].split(',').map(c => c.trim().toLowerCase());
      continue;
    }
    const dlg = /^dialogue:\s*(.*)$/i.exec(line);
    if (!dlg) continue; // Comment:, Picture:, etc. are skipped.
    if (cues.length >= MAX_CUES) { sawMore = true; break; }
    // Default column orders when [Events] Format: is absent.
    let cols = formatCols || ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
    // ASS/SSA put Text last so it may contain commas; if a nonstandard Format:
    // moved it elsewhere (or dropped Start/End), fall back to the standard order
    // for ALL columns rather than mixing indices from two layouts.
    if (cols.indexOf('text') !== cols.length - 1 || cols.indexOf('start') === -1 || cols.indexOf('end') === -1) {
      cols = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
    }
    const startIdx = cols.indexOf('start');
    const endIdx = cols.indexOf('end');
    const textIdx = cols.length - 1;
    const parts = dlg[1].split(',');
    if (parts.length < cols.length) continue;
    const startM = ASS_TIME.exec((parts[startIdx] || '').trim());
    const endM = ASS_TIME.exec((parts[endIdx] || '').trim());
    if (!startM || !endM) continue;
    const cueText = stripAssOverrides(parts.slice(textIdx).join(',')).trim();
    cues.push({ index: cues.length + 1, start: parseAssTime(startM), end: parseAssTime(endM), text: cueText });
  }
  return sawMore;
}

/**
 * Parse subtitle text into cues.
 * @param {string} text decoded subtitle text
 * @param {string} ext lowercase extension, with or without the leading dot
 * @returns {{format:'srt'|'vtt'|'ass'|null, cues:Array, truncated:boolean}}
 */
export function parseSubtitle(text, ext) {
  const e = String(ext || '').toLowerCase().replace(/^\./, '');
  const normalized = normalizeNewlines(text);
  const cues = [];
  let format = null;
  let truncated = false;
  if (e === 'srt') {
    format = 'srt';
    truncated = parseSrt(normalized, cues);
  } else if (e === 'vtt') {
    format = 'vtt';
    truncated = parseVtt(normalized, cues);
  } else if (e === 'ass' || e === 'ssa') {
    format = 'ass';
    truncated = parseAss(normalized, cues);
  }
  return { format, cues, truncated };
}

export { MAX_CUES };
