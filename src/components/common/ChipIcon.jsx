import React from 'react';

/**
 * Chip (CPU) icon for the "Edit System Prompt" menu entry — replaces the generic
 * pencil (EditOutlined) so the entry reads as model/prompt tuning. Artwork follows
 * the owner's reference icon (iconfont-style outlined chip: outer frame with three
 * rounded pins per side + inner frame) on its native 1024×1024 grid; holes rely on
 * opposite-wound subpaths under the default nonzero fill-rule (no fill-rule attr).
 *
 * fill uses currentColor so it follows the active theme (same approach as
 * DialogueIcon); the `.anticon` wrapper inherits 1em sizing/alignment from the
 * surrounding Ant Design menu icons. Keep in sync with
 * MENU_ICON['edit-system-prompt'] in electron/tab-bar.html (same path data and
 * viewBox, passed through its per-icon { vb, path } override).
 */
export default function ChipIcon({ style, className = '' }) {
  return (
    <span role="img" aria-label="chip" className={`anticon ${className}`.trim()} style={style}>
      <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor" aria-hidden="true" focusable="false">
        <path d="M640 341.333333H384a42.666667 42.666667 0 0 0-42.666667 42.666667v256a42.666667 42.666667 0 0 0 42.666667 42.666667h256a42.666667 42.666667 0 0 0 42.666667-42.666667V384a42.666667 42.666667 0 0 0-42.666667-42.666667z m-42.666667 256h-170.666666v-170.666666h170.666666v170.666666zM981.333333 554.666667a42.666667 42.666667 0 1 0 0-85.333334h-85.333333V360.746667h85.333333a42.666667 42.666667 0 1 0 0-85.333334h-85.333333V213.333333c0-47.061333-38.272-85.333333-85.333333-85.333333h-62.08V42.666667a42.666667 42.666667 0 1 0-85.333334 0v85.333333H554.666667V42.666667a42.666667 42.666667 0 0 0-85.333334 0v85.333333H360.746667V42.666667a42.666667 42.666667 0 1 0-85.333334 0v85.333333H213.333333c-47.061333 0-85.333333 38.272-85.333333 85.333333v62.08H42.666667a42.666667 42.666667 0 0 0 0 85.333334h85.333333V469.333333H42.666667a42.666667 42.666667 0 0 0 0 85.333334h85.333333v108.586666H42.666667a42.666667 42.666667 0 1 0 0 85.333334h85.333333V810.666667c0 47.061333 38.272 85.333333 85.333333 85.333333h62.08v85.333333a42.666667 42.666667 0 1 0 85.333334 0v-85.333333H469.333333v85.333333a42.666667 42.666667 0 1 0 85.333334 0v-85.333333h108.586666v85.333333a42.666667 42.666667 0 1 0 85.333334 0v-85.333333H810.666667c47.061333 0 85.333333-38.272 85.333333-85.333333v-62.08h85.333333a42.666667 42.666667 0 1 0 0-85.333334h-85.333333V554.666667h85.333333z m-170.666666 256H213.333333V213.333333h597.333334v597.333334z" />
      </svg>
    </span>
  );
}
