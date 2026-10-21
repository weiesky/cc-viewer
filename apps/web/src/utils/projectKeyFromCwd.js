/**
 * projectKeyFromCwd — client mirror of the server's projectKeyForCwd
 * (packages/app/server/lib/system-prompt-snapshots.js). Both must stay in lockstep:
 * the server stamps view/route keys with it, and the client compares incoming frames
 * (which carry a raw cwd) against the sanitized viewed-project key.
 *
 * basename + sanitize: every char outside [a-zA-Z0-9_.-] → '_'; an empty or all-dots
 * result degenerates to '_' so it can never become a path-traversal segment.
 */
export function projectKeyFromCwd(cwd) {
  if (!cwd || typeof cwd !== 'string') return '';
  const base = String(cwd).replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';
  const key = base.replace(/[^a-zA-Z0-9_\-.]/g, '_');
  return (!key || /^\.+$/.test(key)) ? '_' : key;
}
