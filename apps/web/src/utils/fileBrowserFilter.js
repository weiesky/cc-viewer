/**
 * Filename filter for the file browser modal's current directory.
 *
 * Pure string-contains matching (no RegExp — user input is never escaped,
 * and special characters like `(` or `[` must not throw). Case-insensitive
 * on the Unicode code-point level via toLowerCase, which is sufficient for
 * the mixed Latin/CJK names we see in practice.
 */

/** Returns true when `name` contains `query` (case-insensitive). Empty query matches everything. */
export function matchesFilter(name, query) {
  if (!query) return true;
  const n = String(name || '').toLowerCase();
  const q = String(query || '').toLowerCase();
  if (!q) return true;
  return n.includes(q);
}

/**
 * Split `name` into alternating non-match / match segments around `query`,
 * for highlight rendering. Each segment is { text, hit }. When nothing
 * matches, returns a single segment covering the whole name (hit=false) so
 * callers can render the name verbatim without an empty <mark>.
 *
 * Implementation note: we slide over the ORIGINAL string and lowercase only
 * the candidate window, never indexing the lowercased copy. Some characters
 * change UTF-16 length when lowercased (e.g. 'İ' → 'i̇', two code units), so
 * indexing the lowercased copy would misalign every subsequent segment.
 */
export function splitMatch(name, query) {
  const n = String(name || '');
  const q = String(query || '');
  if (!q) return [{ text: n, hit: false }];
  const qLower = q.toLowerCase();
  const qLen = q.length;
  const out = [];
  let cursor = 0;
  let runStart = 0;
  while (cursor <= n.length - qLen) {
    const window = n.slice(cursor, cursor + qLen);
    if (window.toLowerCase() === qLower) {
      if (cursor > runStart) out.push({ text: n.slice(runStart, cursor), hit: false });
      out.push({ text: window, hit: true });
      cursor += qLen;
      runStart = cursor;
    } else {
      cursor += 1;
    }
  }
  if (runStart < n.length) out.push({ text: n.slice(runStart), hit: false });
  if (out.length === 0) out.push({ text: n, hit: false });
  return out;
}

