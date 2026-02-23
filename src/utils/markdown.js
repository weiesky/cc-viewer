import { marked } from 'marked';
import { escapeHtml } from './helpers';

export function renderMarkdown(text) {
  if (!text) return '';
  try {
    return marked.parse(text, { breaks: true });
  } catch (e) {
    return escapeHtml(text);
  }
}
