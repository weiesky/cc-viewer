/**
 * marked renderer for chat markdown inline code spans — registered alongside
 * renderMdLink in src/utils/markdown.js (module-scope marked.use) and mirrored
 * by test/markdown-render.test.js. Zero DOM/DOMPurify deps so plain
 * node --test can import it.
 *
 * Behavior: when the code text looks like a local file path
 * (resolveMdCodePath), emit `<code data-md-path-candidate="...">` carrying the
 * NORMALIZED path. The attribute is inert by itself: no href, no <a>, no title,
 * no styling — a plain <code> in every surface that consumes renderMarkdown.
 * ChatView's post-mount probe (mdCodePathVerify.js) verifies existence against
 * POST /api/files-exists and upgrades confirmed paths with a runtime
 * `data-md-file-verified` attribute, which is what the click handler and CSS
 * key on. Non-candidates return false → marked's default `<code>` output,
 * byte-identical to before this hook existed.
 */
import { resolveMdCodePath } from './markdownCodePathClassify.js';
import { escapeAttr } from './markdownHrefClassify.js';

/**
 * Replica of marked's escape(text, true) for codespan content:
 * & first, then < > " and ' (&#39;). helpers.js' escapeHtml does NOT escape '
 * and is not node-test importable, so we keep the replica local — byte-parity
 * with marked's default codespan output is pinned by the contract test.
 */
const ESCAPE_RE = /[&<>"']/;
const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeCodespanText(s) {
  if (!ESCAPE_RE.test(s)) return s;
  return s.replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
}

export function renderMdCodespan({ text }) {
  try {
    const candidate = resolveMdCodePath(text);
    if (candidate === null) return false;
    // 行号后缀(`path:3012` / `path:3012-3015`)随候选一起带出去,点击时定位
    const lineAttr = candidate.line ? ' data-md-file-line="' + candidate.line + '"' : '';
    return '<code data-md-path-candidate="' + escapeAttr(candidate.path) + '"' + lineAttr + '>'
      + escapeCodespanText(text) + '</code>';
  } catch {
    return false; // never let a decoration failure downgrade the whole message
  }
}
