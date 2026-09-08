/**
 * marked renderer for chat markdown links — the single implementation shared by
 * src/utils/markdown.js (module-scope marked.use) and
 * test/markdown-render.test.js (contract mirror). Zero DOM/DOMPurify deps so
 * plain node --test can import it.
 *
 *  - external links (http/https/protocol-relative/mailto) open in a new tab so
 *    clicking one never navigates away from the conversation;
 *  - local file links (absolute/relative paths, file:// URIs) get a
 *    data-md-file attribute carrying the normalized path; ChatView's delegated
 *    click handler opens them in the embedded file viewer. The href itself is
 *    intentionally left untouched — MemoryDetailModal/CachePopoverContent link
 *    handlers parse the raw href and must keep working.
 *  - anchors and unrecognized/unsafe schemes return false → marked's default
 *    renderer output (unsafe hrefs are stripped by DOMPurify as before).
 * Note: raw-HTML <a target="_blank"> written by the model bypasses this
 * renderer and gets no rel="noopener noreferrer"; modern browsers imply
 * noopener for cross-origin target=_blank, so we accept that residual risk
 * rather than adding a DOMPurify hook to the shared singleton.
 */
import { classifyMdHref, escapeAttr } from './markdownHrefClassify.js';

export function renderMdLink({ href, title, tokens }) {
  let text;
  // parseInline is invoked outside the try/catch: if it throws, falling back
  // via `return false` would re-invoke it in marked's default renderer and
  // throw again anyway — so let it propagate once, not twice.
  try {
    text = this.parser.parseInline(tokens);
  } catch {
    return false;
  }
  try {
    const info = classifyMdHref(href);
    if (info.kind !== 'external' && info.kind !== 'local-file') return false;
    // Mirror marked's default cleanUrl (encodeURI + keep existing %xx);
    // when encoding fails the default renderer outputs only the text.
    let enc;
    try {
      enc = encodeURI(href).replace(/%25/g, '%');
    } catch {
      return text;
    }
    let out;
    if (info.kind === 'external') {
      out = '<a href="' + escapeAttr(enc) + '"';
    } else if (/^file:/i.test(href.trim())) {
      // file:// links: emit no href at all. DOMPurify strips the file: scheme
      // anyway, and keeping it would let ctrl/middle-clicks attempt a file:
      // navigation (blocked by Chromium today — don't rely on that implicit
      // browser assumption). The <a> keeps its link semantics (focusable,
      // clickable, styled); the real path travels in data-md-file.
      out = '<a';
    } else {
      out = '<a href="' + escapeAttr(enc) + '"';
    }
    if (title) out += ' title="' + escapeAttr(title) + '"';
    if (info.kind === 'external') {
      out += ' target="_blank" rel="noopener noreferrer"';
    } else {
      out += ' data-md-file="' + escapeAttr(info.path) + '"';
    }
    return out + '>' + text + '</a>';
  } catch {
    return false; // never let a decoration failure downgrade the whole message
  }
}
