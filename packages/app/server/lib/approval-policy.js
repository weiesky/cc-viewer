/**
 * approval-policy.js — Shared approval-policy predicates for the two approval paths.
 *
 * Single source of truth for:
 *   - APPROVAL_TOOLS: the six mutating/external tools that require explicit user
 *     approval (previously duplicated literally at ask/perm-bridge.js and
 *     sdk-manager.js).
 *   - isPublishCommand: the npm-publish hard gate. `npm publish` is the one
 *     irreversible outward-facing command (commits can be rewritten, pushes
 *     force-pushed back) — it must NEVER be auto-allowed, even under
 *     --dangerously-skip-permissions. Both consumers force it through the Web UI
 *     approval modal: perm-bridge.js exempts it from the CCV_BYPASS_PERMISSIONS
 *     auto-allow; sdk-manager.js routes it into the perm approval branch even in
 *     bypassPermissions mode.
 *
 * Pure leaf module (L1-lib): no imports, no I/O — importable from both L1-lib
 * (sdk-manager.js) and L1-sub (ask/perm-bridge.js) without boundary-gate edges.
 */

export const APPROVAL_TOOLS = new Set(['Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch']);

/**
 * @param {string} toolName
 * @param {object} [input] — tool input ({ command } for Bash)
 * @returns {boolean} true when the call is an `npm publish` invocation
 */
export function isPublishCommand(toolName, input) {
  return toolName === 'Bash' && typeof input?.command === 'string' && /npm\s+publish/i.test(input.command);
}
