// HTML → Markdown conversion for the chat message copy handler.
//
// When the user selects text inside a rendered assistant message (.chat-md) and copies,
// ChatView's handleMessageListCopy intercepts the copy event, clones the selected DOM
// fragment, and runs it through this Turndown service to recover the markdown source.
// The result is written to clipboardData as text/plain (markdown) alongside text/html
// (the original rendered HTML, for pasting into rich-text targets).
//
// Turndown is DOM-native: it consumes the already-DOMPurify-sanitized fragment directly,
// no hast/DOM round-trip needed (unlike rehype-remark which would require parsing to hast
// and back). The fragment context loss (e.g. a <td> without its parent <table>) is inherent
// to Range.cloneContents() and accepted — the whole-message copy path (useMarkdownExport)
// remains the lossless alternative.
//
// The TurndownService instance is created lazily on first use. Some test harnesses
// (response-thinking-chat.test.js) bundle ChatView with esbuild and stub out every
// bare-specifier import (including 'turndown'); eager instantiation would crash the
// bundle even though no test ever calls htmlToMarkdown.
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

let _service = null;

// Strip control characters (U+0000–U+001F, U+007F) and angle brackets from an
// attacker-influenceable string before placing it inside a markdown <...> destination
// or "..." title. Control chars could inject line breaks / escape sequences into the
// copied markdown; angle brackets would break out of the destination wrapper.
function sanitizeMdAttr(value) {
  return String(value).replace(/[\x00-\x1f<>\x7f-\x9f]/g, '');
}

function getService() {
  if (_service) return _service;
  const service = new TurndownService({
    headingStyle: 'atx',       // '# heading' (not setext)
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
    // Note on <br>: marked is configured with breaks:true (utils/markdown.js), so a
    // single \n in the source renders as <br>. Turndown's default br:'  ' produces
    // '  \n' (a hard break), which round-trips cleanly under both GFM and breaks:true.
    // Do NOT set br:'\n' — Turndown's lineBreak rule appends '\n' itself, so '\n'
    // would yield a blank line (paragraph break), not a soft break.
  });

  service.use(gfm);  // tables, strikethrough, task list items

  // Local file links are rendered by markdownLinkRenderer.js as <a data-md-file="...">
  // (file:// links carry no href at all; DOMPurify strips file: anyway). Restore them
  // to plain markdown links so the copied text is valid markdown. The data-md-file
  // value is attacker-influenceable (the source markdown came from the model), so
  // sanitize control characters and wrap the destination in angle brackets — CommonMark
  // allows <...> destinations, which safely contain spaces, parens, and quotes.
  service.addRule('ccvMdFileLink', {
    filter: (node) => node.nodeName === 'A' && !!node.getAttribute('data-md-file'),
    replacement: (content, node) => {
      const rawPath = node.getAttribute('data-md-file');
      if (!rawPath) return content;
      const path = sanitizeMdAttr(rawPath);
      if (!path) return content;
      const rawTitle = node.getAttribute('title');
      // Escape backslashes BEFORE quotes so a trailing \ doesn't escape the closing ".
      const title = rawTitle
        ? sanitizeMdAttr(rawTitle).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
        : null;
      return `[${content}](<${path}>${title ? ` "${title}"` : ''})`;
    },
  });

  _service = service;
  return service;
}

export function htmlToMarkdown(html) {
  if (!html) return '';
  return getService().turndown(html);
}
