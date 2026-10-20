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
 *   - isOverTrustDir: shared guard against over-broad session directory grants
 *     (used by both the PTY PermissionRequest bridge and the SDK canUseTool path).
 *
 * Pure leaf module (L1-lib): no imports, no I/O — importable from both L1-lib
 * (sdk-manager.js) and L1-sub (ask/perm-bridge.js) without boundary-gate edges.
 */

import { sep } from 'node:path';
import { homedir } from 'node:os';

export const APPROVAL_TOOLS = new Set(['Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch']);

/**
 * @param {string} toolName
 * @param {object} [input] — tool input ({ command } for Bash)
 * @returns {boolean} true when the call is an `npm publish` invocation
 */
export function isPublishCommand(toolName, input) {
  return toolName === 'Bash' && typeof input?.command === 'string' && /npm\s+publish/i.test(input.command);
}

/**
 * Whether granting session-level trust to `dir` would be over-broad.
 * Skips: filesystem root, the user's home directory, top-level directories
 * (e.g. /etc, /Users, C:\), and any path containing a dot-directory segment
 * (e.g. ~/.ssh, ~/Library/Keychains).
 *
 * @param {string} dir — absolute directory path
 * @returns {boolean} true when the directory should NOT be granted session trust
 */
export function isOverTrustDir(dir) {
  if (!dir || typeof dir !== 'string') return true;
  const parts = dir.split(sep).filter(Boolean);
  // Filesystem root or Windows drive root (e.g. 'C:\')
  if (parts.length === 0) return true;
  if (parts.length === 1 && /^[A-Za-z]$/.test(parts[0])) return true;
  // Top-level system directories (e.g. /etc, /Users, /tmp, C:\Windows)
  if (parts.length <= 1) return true;
  // Any dot-directory segment (e.g. ~/.ssh, ~/.aws, ~/Library/Keychains)
  if (parts.some(p => p.startsWith('.'))) return true;
  // User home directory
  if (dir === homedir()) return true;
  return false;
}
