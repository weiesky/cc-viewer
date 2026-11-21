// Shared continuation-arg stripping for "fresh session" launches (forceNew).
// Consumed by the workspace launch route (packages/app/server/routes/workspaces.js)
// and the Electron main process (apps/electron/electron/main.js via async import) —
// keep this the single source of truth so the two argv paths can never drift.
//
// `-r`/`--resume` carry a VALUE in the next argv slot — the orphan would land as
// claude's first positional prompt; `--continue=<x>`/`--resume=<x>` single-token
// forms and `--fork-session` (invalid without a continue flag) must go too.

const VALUE_FLAGS = new Set(['-r', '--resume']);
const LONE_FLAGS = new Set(['-c', '--continue', '-r', '--resume', '--fork-session']);

export function stripContinuationArgs(args) {
  if (!Array.isArray(args)) return [];
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (typeof a !== 'string') continue;
    if (VALUE_FLAGS.has(a)) { i++; continue; } // flag + its value
    if (LONE_FLAGS.has(a)) continue;
    if (a.startsWith('--continue=') || a.startsWith('--resume=')) continue;
    out.push(a);
  }
  return out;
}
