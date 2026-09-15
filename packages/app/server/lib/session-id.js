// Shared leaf: parse session_id out of body.metadata.user_id.
//
// Lifted from v2/identity.js so lib-root and lib/proxy modules can use it without
// an R3 cross-subsystem edge into v2/ (house pattern: isNonEmptyFile → file-api.js
// re-export shell). v2/identity.js re-exports from here; do not duplicate the logic.
//
// Encodings (WIRE_FORMAT_V2 spec §8):
//  - 'json':      '{"device_id":…,"account_uuid":…,"session_id":"<uuid>"}'
//  - 'delimited': 'user_<hash>_account_<acct?>_session_<uuid>'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parse a raw metadata.user_id string into { sessionId, encoding } or null.
 * @param {unknown} userIdRaw
 * @returns {{ sessionId: string, encoding: 'json'|'delimited' } | null}
 */
export function parseUserId(userIdRaw) {
  if (typeof userIdRaw !== 'string' || userIdRaw === '') return null;
  try {
    const obj = JSON.parse(userIdRaw);
    if (obj && typeof obj.session_id === 'string' && obj.session_id !== '') {
      return { sessionId: obj.session_id, encoding: 'json' };
    }
    return null; // valid JSON but no session_id — treat as unparseable
  } catch { /* not JSON → try the delimited form */ }
  const idx = userIdRaw.lastIndexOf('_session_');
  if (idx >= 0) {
    const tail = userIdRaw.slice(idx + '_session_'.length);
    if (UUID_RE.test(tail)) return { sessionId: tail, encoding: 'delimited' };
  }
  return null;
}
