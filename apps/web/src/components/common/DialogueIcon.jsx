import React from 'react';

/**
 * Two-bubble "dialogue" icon (two facing conversation bubbles) for the
 * messaging (IM integration) menu entry. Distinguishes it from the single
 * bubble MessageOutlined used by the "view user prompts" entry.
 *
 * Wrapped in a `.anticon` span so it inherits the same 1em font-size sizing and
 * vertical alignment as the surrounding Ant Design menu icons; stroke uses
 * currentColor so it follows the active theme (same approach as OpenFolderIcon).
 */
export default function DialogueIcon({ style, className = '' }) {
  return (
    <span role="img" aria-label="dialogue" className={`anticon ${className}`.trim()} style={style}>
      <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z" />
        <path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1" />
      </svg>
    </span>
  );
}
