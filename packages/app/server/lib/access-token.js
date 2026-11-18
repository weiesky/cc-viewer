// ACCESS_TOKEN handoff contract shared by server.js (consumer) and lib/restart.js
// (producer). This module is itself dependency-free so the detached restart-helper.js
// process (which loads lib/restart.js) can import it cheaply, with no server graph.
// INTERNAL handoff channel only — NOT a supported user setting. takeInheritedAccessToken
// trusts any well-shaped value in this var, so exporting it in a shell would pin the LAN
// token across manual starts (defeating per-boot rotation). Set only by the restart helper.
export const ACCESS_TOKEN_ENV = 'CCV_ACCESS_TOKEN';
// Exact shape of the token server.js generates: randomBytes(16).toString('hex').
export const ACCESS_TOKEN_RE = /^[a-f0-9]{32}$/;

/** Single source of truth for "is this value a well-formed ACCESS_TOKEN?" — shared by the
 *  producer (lib/restart.js write/spawn sides) and the consumer (takeInheritedAccessToken)
 *  so the shape rule can never drift between the two ends of the handoff. */
export function isValidAccessToken(value) {
  return typeof value === 'string' && ACCESS_TOKEN_RE.test(value);
}

/**
 * Read-and-strip the self-update handoff token from `env` (default process.env).
 * Destructive by design: the value must not survive into children spawned later
 * (the claude PTY/SDK process, shells). Malformed or absent values return null so
 * the caller falls back to a fresh random token.
 */
export function takeInheritedAccessToken(env = process.env) {
  if (!env || typeof env !== 'object') return null;
  const raw = env[ACCESS_TOKEN_ENV];
  try { delete env[ACCESS_TOKEN_ENV]; } catch { /* frozen env object */ }
  return isValidAccessToken(raw) ? raw : null;
}
