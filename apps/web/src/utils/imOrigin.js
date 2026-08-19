// IM-origin marker: messages injected by an IM bridge carry a leading sentinel so the
// conversation view can show which IM a message came from and (optionally) which sender.
//   ⟦im:<id>⟧            — platform only (legacy / when sender unknown)
//   ⟦im:<id>:<senderId>⟧ — platform + opaque sender id (used to look up name/avatar)
//
// KEEP IN SYNC with markOrigin() in server/lib/im-bridge-core.js. The senderId group is
// OPTIONAL so old markers (no sender) still parse → senderId:null → callers fall back to the
// global user profile (no regression). The bridge only embeds a senderId matching /^[^\s:⟧]+$/,
// so the `:` separator and the `⟧` terminator are never ambiguous.
// U+27E6 / U+27E7 (⟦ ⟧) are virtually never typed by a human, so false positives are nil.
export const IM_ORIGIN_RE = /^⟦im:([a-z0-9_-]+)(?::([^⟧]+))?⟧[ ]?/;

/**
 * Strip a leading IM-origin marker from a message's text.
 * @param {string} text raw message text
 * @returns {{ text: string, imSource: string|null, senderId: string|null }}
 *   stripped text + the IM id (null if no marker) + the sender id (null if absent)
 */
export function parseImOrigin(text) {
  if (typeof text !== 'string') return { text, imSource: null, senderId: null };
  const m = text.match(IM_ORIGIN_RE);
  if (!m) return { text, imSource: null, senderId: null };
  return { text: text.slice(m[0].length), imSource: m[1], senderId: m[2] || null };
}
