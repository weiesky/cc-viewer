// Agent identity parser — teammate/subagent names from the wire header.
//
// Claude Code 2.x sends an `x-claude-code-agent-id` request header on every
// sub-agent (teammate or subagent) request. Two shapes appear in real data:
//   - named teammate:    `frontend-reviewer@session-17e1f37a-...`
//   - anonymous subagent: `a7eea0a140349f80d` (16-hex agent id, no @)
// The header is absent on main-agent requests, so its presence alone marks a
// sub-agent stream. We persist the NAME so display no longer depends on the
// frontend's window-scoped heuristic registry (resolveTeammateNames), which
// loses names when the lead's Agent tool_use falls outside the current window.

const ANON_RE = /^[0-9a-f]{8,64}$/i; // pure hex id, any plausible length
const MAX_NAME_LEN = 64;

/**
 * Parse an `x-claude-code-agent-id` header value.
 *
 * @param {string|null|undefined} header
 * @returns {{agentName: string|null, named: boolean}|null}
 *   - named teammate:  {agentName, named: true}
 *   - anonymous agent: {agentName: null, named: false}
 *   - null when the header is missing/empty or its shape is not an agent id
 *     (never fabricate a name from an unrecognized value).
 */
export function parseAgentId(header) {
  if (typeof header !== 'string') return null;
  const h = header.trim();
  if (h.length === 0) return null;
  const at = h.indexOf('@');
  if (at === -1) {
    // Anonymous: a bare hex agent id. Anything else is not an agent id — do
    // not guess.
    return ANON_RE.test(h) ? { agentName: null, named: false } : null;
  }
  const name = h.slice(0, at).trim();
  // The @-suffix is deliberately NOT validated (real shapes include
  // `session-<uuid>` and possibly plain uuids) — presence of @ + a non-hex
  // prefix is enough to treat it as a named agent. A hex prefix is treated as
  // anonymous (guards against `<uuid>@session-...` being misread as a name).
  if (name.length === 0) return null;
  if (ANON_RE.test(name)) return { agentName: null, named: false };
  return { agentName: name.slice(0, MAX_NAME_LEN), named: true };
}

/** Case-insensitive header lookup (undici folds to lowercase; plain objects
 *  may keep the original casing). */
export function findHeader(headers, key) {
  if (!headers || typeof headers !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(headers, key)) return headers[key];
  const lower = key.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lower) return headers[k];
  }
  return undefined;
}
