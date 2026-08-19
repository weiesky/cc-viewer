// Process-liveness probe shared by pid-validity claims (session-owner.js).
// Deliberately dependency-free: im-lock.js's identical helper drags findcc.js
// (LOG_DIR env resolution, a top-level node:worker_threads threadId import)
// into every importer's module graph — the stats worker's loader shim has no
// threadId export, and the v2 writer's synchronous ingest path doesn't want
// node:http along for the ride. im-lock.js / async-file-lock.js keep their
// local copies (same semantics); consolidation is backlog.

/** Is `pid` alive? Signal 0 probes without delivering; EPERM means the
 *  process exists but belongs to another user (still alive). */
export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e && e.code === 'EPERM'; }
}
