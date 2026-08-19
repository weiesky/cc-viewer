// Per-session-dir live-owner claim (multi-window log isolation, 2026-07-17).
//
// Problem: every ccv window (one process = V2Writer + viewer server) writes
// into the SHARED `LOG_DIR/<project>/sessions/` root. The "newest session"
// selectors (cold-load fallback, `-c` folder adoption) and the live feed's
// whole-root follow have no notion of "which process owns which dir", so
// parallel windows on one project cross-read (and, via adoption, cross-WRITE)
// each other's sessions.
//
// Mechanism: the writing process claims its session dir with an `owner.lock`
// sidecar `{pid, startedAt}`. The file is only a POINTER — the claim's
// validity is "the owning process is alive" (`process.kill(pid, 0)`, a
// kernel-memory fact), so a crashed owner's claim expires the instant the
// process dies and a dir can never be locked forever. Same liveness model as
// im-lock.js / log-management.js. The sidecar never touches journal /
// conversations / blobs — it is not part of the wire format.
//
// Error-direction asymmetry (deliberate — each path errs toward its safe side):
// - acquire: an unreadable/half-written lock is treated as HELD (refuse) —
//   worst case the caller mints a fresh dir, which is Claude Code's own
//   `-c` fork semantics anyway; never two writers on one journal.
// - isForeignLiveOwned: an unreadable lock is treated as UNOWNED (readable) —
//   a torn crash residue must never permanently gate a dir out of the live
//   feed / cold-load fallback.

import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { isPidAlive } from '../pid-alive.js';
import { reportSwallowed } from '../error-report.js';

export const OWNER_LOCK_NAME = 'owner.lock';

// Contention retries for the wx create-exclusive acquire (im-lock precedent).
const MAX_CLAIM_ATTEMPTS = 3;

export function ownerLockPath(dir) { return join(dir, OWNER_LOCK_NAME); }

/** Read the claim; missing / half-written / non-object → null (tolerated,
 *  never grounds for deletion here — acquire has its own recycle rules). */
export function readSessionClaim(dir) {
  try {
    const o = JSON.parse(readFileSync(ownerLockPath(dir), 'utf-8'));
    return (o && typeof o === 'object') ? o : null;
  } catch { return null; }
}

/**
 * Atomically claim `dir` for `pid` (default: this process). Modeled on
 * im-lock.js acquireImLock: `wx` create-exclusive IS the arbiter, so two
 * processes racing to adopt the same dead-owned dir get exactly one winner.
 * Two DELIBERATE divergences from that model (don't "fix" them back):
 * own-pid holder → idempotent {ok:true} without rewriting (acquire runs twice
 * per dir: adoption, then _session), where im-lock recycles its own residue;
 * and content is written in the same call as creation ('wx' flag) — no
 * empty-file window between sentinel and payload, so no temp+rename step.
 * `startedAt` is diagnostic only — validity is pid-liveness alone (the
 * accepted im-lock-style pid-reuse tradeoff; a socket-bind probe would close
 * it and is backlog).
 *
 * @param {string} dir - absolute session dir
 * @param {{pid?: number, pidAlive?: (pid:number)=>boolean}} [opts] test seams
 * @returns {{ok:true}|{ok:false, holder?:object|null}} ok:false = cannot
 *   claim, for any of: a live foreign holder, an unreadable/half-written lock
 *   (conservatively treated as held), an unexpected write I/O failure
 *   (reported via reportSwallowed), or contention exhausting the retries.
 *   `holder` is set only when a live foreign pid was identified. Either way
 *   the caller must NOT write into this dir (adoption: mint a fresh one).
 */
export function acquireSessionClaim(dir, opts = {}) {
  const pid = opts.pid ?? process.pid;
  const pidAlive = opts.pidAlive || isPidAlive;
  const p = ownerLockPath(dir);
  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
    try {
      writeFileSync(p, JSON.stringify({ pid, startedAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
      return { ok: true };
    } catch (e) {
      if (!e || e.code !== 'EEXIST') {
        // Unexpected I/O failure (EACCES, EROFS, fd exhaustion…): a silently
        // missing claim means the isolation quietly stops working — report.
        reportSwallowed('v2-owner.claim', e);
        return { ok: false, holder: null };
      }
      const holder = readSessionClaim(dir);
      if (holder && holder.pid === pid) return { ok: true }; // idempotent re-entry
      if (holder && pidAlive(holder.pid)) return { ok: false, holder };
      if (!holder) {
        // Unreadable: either a concurrent recycler unlinked it between our
        // EEXIST and the read (→ retry the atomic create) or it is genuinely
        // half-written (→ conservatively held; the writer is mid-claim).
        if (!existsSync(p)) continue;
        return { ok: false, holder: null };
      }
      // Dead holder → recycle the stale lock and retry the atomic create.
      try { unlinkSync(p); } catch { /* concurrent recycler won the unlink — retry */ }
    }
  }
  // Contention exhausted the retries: report the current holder if live.
  const holder = readSessionClaim(dir);
  if (holder && holder.pid !== pid && pidAlive(holder.pid)) return { ok: false, holder };
  return { ok: false, holder: holder || null };
}

/**
 * Release the claim on `dir` — identity-checked: only unlinks when the lock
 * is held by `pid` (default: this process), so a successor process's claim is
 * never deleted by a late-exiting predecessor. Missing file = already
 * released. Synchronous on purpose: it runs at the top of V2Writer.close()
 * ahead of the (bounded, raceable) async queue drain.
 * @returns {boolean} true when the dir is no longer claimed by `pid`
 */
export function releaseSessionClaim(dir, opts = {}) {
  const pid = opts.pid ?? process.pid;
  const holder = readSessionClaim(dir);
  if (holder && holder.pid !== pid) return false; // taken over — don't touch
  try { unlinkSync(ownerLockPath(dir)); } catch { /* ENOENT = already released */ }
  return true;
}

/**
 * Is `dir` exclusively owned by ANOTHER live process? The single skip
 * predicate used by latestMainSession (cold-load fallback + `-c` adoption
 * candidates) and the live feed's attach/re-check gates. History readers
 * never call this — a dead owner's claim makes the dir plain unowned data.
 * @param {string} dir - absolute session dir
 * @param {{pid?: number, pidAlive?: (pid:number)=>boolean}} [opts] test seams
 * @returns {boolean}
 */
export function isForeignLiveOwned(dir, opts = {}) {
  const pid = opts.pid ?? process.pid;
  const pidAlive = opts.pidAlive || isPidAlive;
  const holder = readSessionClaim(dir); // unreadable → null → unowned (self-healing)
  if (!holder || !Number.isInteger(holder.pid)) return false;
  return holder.pid !== pid && pidAlive(holder.pid);
}
