/**
 * Classify the href of a markdown-rendered link in the chat view.
 *
 * Pure, stateless, zero-dependency — safe to unit test under plain node --test.
 * Must stay stateless: renderMarkdown's output cache is keyed by the raw text,
 * so the classification must never depend on locale, project dir, or env.
 *
 * Kinds:
 *  - 'external'   — http(s)/protocol-relative/mailto: opened in a new tab
 *                   (renderer adds target="_blank" rel="noopener noreferrer")
 *  - 'local-file' — absolute/relative path or file:// URI referencing a local
 *                   file; opened in the embedded file viewer via
 *                   ChatView.handleOpenToolFilePath. `path` is normalized:
 *                   file:// stripped, percent-decoded (guarded), #fragment and
 *                   ?query stripped, leading "./" stripped — the click handler
 *                   expects a plain path and does no normalization itself.
 *  - 'anchor'     — "#..." in-page anchor: left completely untouched (never
 *                   gets target=_blank, keeps native in-page scroll)
 *  - 'other'      — other DOMPurify-allowed schemes (tel:, ftp:, sms:, ...):
 *                   rendered with the default marked output, zero behavior change
 *  - 'unsafe'     — javascript:/data:/vbscript:/unknown schemes: left to
 *                   DOMPurify to strip the href (same as before this change)
 */

// A Windows drive-letter path (C:\x or C:/x) must be detected BEFORE the
// scheme regex below, which would otherwise read "C:" as a scheme.
const WINDOWS_DRIVE_RE = /^[a-zA-Z]:[\\/]/;
const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

// Percent-decode without throwing on malformed sequences (e.g. "/foo/100%.md"
// is a legitimate filename, not an encoding). On failure keep the raw value.
// Exported for markdownCodePathClassify.js (codespan candidates share the
// same normalization contract as link hrefs).
export function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// The click handler (ChatView.handleOpenToolFilePath) forwards the value to
// /api/file-content as-is: a trailing "#L2"/"?t=1" would become part of the
// filename and 404, and a leading "./" would desync the file-tree expansion.
// Exported for markdownCodePathClassify.js (same reason).
export function normalizeLocalPath(p) {
  let out = p.split('#')[0].split('?')[0];
  if (out.startsWith('./')) out = out.slice(2);
  return out;
}

export function classifyMdHref(href) {
  if (typeof href !== 'string') return { kind: 'unsafe' };
  const raw = href.trim();
  if (!raw) return { kind: 'unsafe' };

  // 盘符路径也要过归一化(剥 #fragment/?query、percent-decode),与其他分支一致 —
  // 否则 C:\x.md#L2 会把 fragment 带进查看器路径导致 404
  if (WINDOWS_DRIVE_RE.test(raw)) return { kind: 'local-file', path: normalizeLocalPath(safeDecode(raw)) };
  if (raw.startsWith('#')) return { kind: 'anchor' };
  // Protocol-relative URLs must be checked before the "/"-prefixed local path.
  if (raw.startsWith('//')) return { kind: 'external' };

  const schemeMatch = SCHEME_RE.exec(raw);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme === 'http' || scheme === 'https' || scheme === 'mailto') {
      return { kind: 'external' };
    }
    if (scheme === 'file') {
      // file:///abs/x.md  →  /abs/x.md ; file://localhost/abs → /abs
      let rest = raw.slice(schemeMatch[0].length);
      rest = rest.replace(/^\/\//, '');
      if (/^localhost(\/|$)/i.test(rest)) rest = rest.slice('localhost'.length);
      if (rest.startsWith('/') || WINDOWS_DRIVE_RE.test(rest)) {
        return { kind: 'local-file', path: normalizeLocalPath(safeDecode(rest)) };
      }
      // file://host/share UNC-style: no local interpretation — drop the link.
      return { kind: 'unsafe' };
    }
    if (['tel', 'callto', 'sms', 'ftp', 'cid', 'xmpp', 'matrix'].includes(scheme)) {
      return { kind: 'other' };
    }
    return { kind: 'unsafe' };
  }

  // No scheme: absolute (/...), ./ ../ relative, or bare "docs/a.md" — in the
  // chat SPA there is no in-site navigation, so these always mean local files.
  return { kind: 'local-file', path: normalizeLocalPath(safeDecode(raw)) };
}

/** Escape a value for safe interpolation into a double-quoted HTML attribute. */
export function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}
