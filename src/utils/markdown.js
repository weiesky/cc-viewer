import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { escapeHtml } from './helpers';
import { setupMermaidAutoRender } from '../hooks/useMermaidRender';

setupMermaidAutoRender();

const _mdCache = new Map();
const _MD_CACHE_MAX = 1024;

export function renderMarkdown(text) {
  if (!text) return '';
  const hit = _mdCache.get(text);
  if (hit !== undefined) return hit;

  let html;
  try {
    html = DOMPurify.sanitize(marked.parse(text, { breaks: true }));
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
