/**
 * Per-tool one-line summaries for collapsed tool pills (pill mode).
 *
 * Each formatter receives the tool_use input object and returns a plain-text
 * summary derived from the tool input (never localized; formatters may shorten
 * or compose), or null when nothing sensible can be said. The pill renders
 * `Name: summary`; a null
 * summary falls back to the bare tool name. Unknown tools / MCP tools fall
 * back to input.description when present, otherwise to the bare name.
 * Formatters must return strings (never JSX) so the pill can rely on CSS
 * ellipsis; they must be pure and treat missing fields as null.
 *
 * Extending: add one entry to TOOL_SUMMARY_FORMATTERS. Return null to opt out.
 *
 * Notes on reachability:
 * - TaskCreate is in FULL_DISPLAY_TOOLS (toolDisplayPolicy.js), so it never
 *   renders as a pill today; the entry is future-proofing and activates
 *   automatically if the tool leaves the full-display list.
 * - Server-side web searches arrive as server_tool_use blocks and never reach
 *   the pill loop; the WebSearch entry covers transcripts that record it as a
 *   regular tool_use.
 */

/** Roughly matches ChatMessage._renderTool_Default's 200-char cap (that one exempts some tools). */
export const MAX_SUMMARY_CHARS = 200;

/** Bidi/format control chars must not reach bubble text (superset of slashCommandLabels.js: also strips ALM U+061C). */
const FORMAT_CONTROL_CHARS = /[\u202A-\u202E\u2066-\u2069\u061C\u200E\u200F\uFEFF]/g;

export const TOOL_SUMMARY_FORMATTERS = Object.freeze({
  Bash: (i) => asTrimmedString(i.description) || firstLine(i.command),
  Read: (i) => shortenPath(i.file_path),
  Grep: (i) => {
    const p = asTrimmedString(i.pattern);
    return p ? `/${p}/` : null;
  },
  Glob: (i) => asTrimmedString(i.pattern),
  Task: (i) => asTrimmedString(i.description) || asTrimmedString(i.subagent_type),
  TaskCreate: (i) => asTrimmedString(i.subject),
  TaskUpdate: (i) => asTrimmedString(i.subject) || taskUpdateFallback(i),
  WebFetch: (i) => asTrimmedString(i.url),
  WebSearch: (i) => asTrimmedString(i.query),
});

/**
 * @returns {string|null} one-line summary for the pill, or null for name-only.
 */
export function getToolSummary(name, input) {
  if (typeof name !== 'string') return null;
  const inp = coerceToolInput(input);
  if (!inp) return null;
  if (!Object.hasOwn(TOOL_SUMMARY_FORMATTERS, name)) {
    // Unknown / MCP tools: only the conservative description field, never arbitrary JSON.
    return normalizeSummary(asTrimmedString(inp.description));
  }
  return normalizeSummary(TOOL_SUMMARY_FORMATTERS[name](inp));
}

/**
 * Keep the last `maxSegments` path segments (the basename is the most
 * identifying part), prefixed with …/ when truncated. Short paths pass
 * through. Note the pill's CSS end-ellipsis can still clip a long basename;
 * for typical 3-segment paths the 420px cap fits.
 */
export function shortenPath(path, maxSegments = 3) {
  const p = asTrimmedString(path);
  if (!p) return null;
  const segs = p.split(/[\\/]+/).filter(Boolean);
  if (segs.length === 0) return null;
  if (segs.length <= maxSegments) return p;
  return '…/' + segs.slice(-maxSegments).join('/');
}

function asTrimmedString(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function firstLine(v) {
  const s = asTrimmedString(v);
  if (!s) return null;
  const line = s.split(/\r?\n/, 1)[0].trim();
  return line || null;
}

function taskUpdateFallback(i) {
  const rawId = asTrimmedString(i.taskId) ?? (Number.isFinite(i.taskId) ? String(i.taskId) : null);
  const id = rawId ? `#${rawId}` : null;
  const status = asTrimmedString(i.status);
  if (id && status) return `${id} → ${status}`;
  return id || status;
}

/**
 * Same string-input fallback as renderToolCall in ChatMessage.jsx: the stream
 * assembler can hand us the raw JSON string. A parse failure is the normal
 * partial-JSON state, not a diagnostic condition.
 */
function coerceToolInput(input) {
  if (input && typeof input === 'object') return input;
  if (typeof input !== 'string') return null;
  try {
    const parsed = JSON.parse(input.replace(/^\[object Object\]/, ''));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeSummary(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(FORMAT_CONTROL_CHARS, '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  // Fast path: UTF-16 length >= code-point count, so anything already under
  // the cap is returned without the code-point array allocation.
  if (cleaned.length <= MAX_SUMMARY_CHARS) return cleaned;
  // Truncate by code points so astral chars (emoji, CJK ext-B) are never split
  // into a lone surrogate before the ellipsis.
  const chars = Array.from(cleaned);
  if (chars.length <= MAX_SUMMARY_CHARS) return cleaned;
  return chars.slice(0, MAX_SUMMARY_CHARS - 1).join('').trimEnd() + '…';
}
