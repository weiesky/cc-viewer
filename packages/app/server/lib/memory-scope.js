// Pure helper: derive the per-project memory directory used by
// ~/.claude/projects/<encoded-cwd>/memory. Extracted so the read routes
// (files-content.js#projectMemoryWithRoot), the OS-open route
// (files-fs.js#openMemoryDir) and the target-scope resolution
// (target-scope.js#resolveTargetRoot) share one derivation instead of
// drifting apart.
//
// Layering: L1 (lib). No imports from routes/.
import { join } from 'node:path';
import { getClaudeConfigDir } from '../../findcc.js';

// Match Claude Code's encoding: strip trailing path separators, then map
// every non [a-zA-Z0-9-] char to '-'. The trailing-strip is load-bearing:
// bound callers (viewRootOrReply) may hand us a raw CCV_PROJECT_DIR with
// a trailing slash, which would otherwise produce an extra '-' and 404.
export function memoryDirFor(cwd) {
  const clean = String(cwd || '').replace(/[/\\]+$/, '');
  const encoded = clean.replace(/[^a-zA-Z0-9-]/g, '-');
  return join(getClaudeConfigDir(), 'projects', encoded, 'memory');
}
