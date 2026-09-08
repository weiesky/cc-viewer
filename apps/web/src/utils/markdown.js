import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { escapeHtml } from './helpers';
import { setupMermaidAutoRender } from '../hooks/useMermaidRender';
import { measureParse } from './markdownProfiler';
import { renderMdLink } from './markdownLinkRenderer';
import { renderMdCodespan } from './markdownCodeSpanRenderer';

setupMermaidAutoRender();

// Chat markdown link decoration lives in markdownLinkRenderer.js (shared with
// the contract test): external links get target=_blank, local file links get
// data-md-file. Codespan decoration lives in markdownCodeSpanRenderer.js:
// path-looking inline code gets an inert data-md-path-candidate marker that
// ChatView's async existence probe may upgrade to a clickable file opener.
// Returning false falls back to marked's default renderer for that token.
marked.use({
  renderer: { link: renderMdLink, codespan: renderMdCodespan },
});

const _mdCache = new Map();
const _MD_CACHE_MAX = 1024;

export function renderMarkdown(text) {
  if (!text) return '';
  const hit = _mdCache.get(text);
  if (hit !== undefined) return hit;

  let html;
  try {
    // ADD_ATTR ['target']: DOMPurify's default allowlist strips `target`.
    // rel and data-* attributes pass through by default.
    html = measureParse(() => DOMPurify.sanitize(marked.parse(text, { breaks: true }), { ADD_ATTR: ['target'] }));
  } catch (e) {
    html = escapeHtml(text);
  }

  if (_mdCache.size >= _MD_CACHE_MAX) {
    // evict oldest (Map preserves insertion order)
    _mdCache.delete(_mdCache.keys().next().value);
  }
  _mdCache.set(text, html);
  return html;
}
