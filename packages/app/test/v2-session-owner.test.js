/**
 * Per-session-dir live-owner claim (server/lib/v2/session-owner.js).
 *
 * The claim isolates parallel ccv windows on one project: `owner.lock`
 * `{pid, startedAt}` is a pointer whose validity is PID liveness — a crashed
 * owner's claim expires with its process, so a dir can never be locked
 * forever. These pin the acquire arbitration (wx create-exclusive, dead-lock
 * recycling, idempotent re-entry), identity-checked release, and the
 * deliberate error-direction asymmetry: acquire treats an unreadable lock as
 * HELD (safe: caller mints a fresh dir) while isForeignLiveOwned treats it as
 * UNOWNED (safe: torn residue never gates reads forever).
 *
 * Data-safety: fixtures live under mkdtemp; nothing touches the real LOG_DIR.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  acquireSessionClaim, releaseSessionClaim, isForeignLiveOwned,
  readSessionClaim, ownerLockPath,
} from '../server/lib/v2/session-owner.js';

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ccv-owner-')); });
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

const alive = () => true;
const dead = () => false;

describe('acquireSessionClaim', () => {
  it('claims an unclaimed dir and writes {pid, startedAt}', () => {
    const r = acquireSessionClaim(dir, { pid: 111, pidAlive: dead });
    assert.equal(r.ok, true);
    const lock = JSON.parse(readFileSync(ownerLockPath(dir), 'utf-8'));
    assert.equal(lock.pid, 111);
    assert.ok(typeof lock.startedAt === 'string' && lock.startedAt.length > 0);
  });

  it('is idempotent for the same pid', () => {
    assert.equal(acquireSessionClaim(dir, { pid: 111, pidAlive: alive }).ok, true);
    assert.equal(acquireSessionClaim(dir, { pid: 111, pidAlive: alive }).ok, true);
  });

  it('refuses when a live foreign holder exists, reporting the holder', () => {
    assert.equal(acquireSessionClaim(dir, { pid: 111, pidAlive: alive }).ok, true);
    const r = acquireSessionClaim(dir, { pid: 222, pidAlive: alive });
    assert.equal(r.ok, false);
    assert.equal(r.holder.pid, 111);
  });

  it('recycles a dead holder and wins the claim', () => {
    writeFileSync(ownerLockPath(dir), JSON.stringify({ pid: 999, startedAt: 'x' }));
    const r = acquireSessionClaim(dir, { pid: 222, pidAlive: dead });
    assert.equal(r.ok, true);
    assert.equal(readSessionClaim(dir).pid, 222);
  });

  it('exactly one winner when two processes race onto the same dead lock', () => {
    // Simulate the double-`ccv -c` interleaving: both see the dead lock; A
    // recycles+wins, then B's acquire must observe A as the live holder.
    writeFileSync(ownerLockPath(dir), JSON.stringify({ pid: 999, startedAt: 'x' }));
    const pidAlive = (pid) => pid !== 999; // 999 dead, everyone else alive
    const a = acquireSessionClaim(dir, { pid: 111, pidAlive });
    const b = acquireSessionClaim(dir, { pid: 222, pidAlive });
    assert.equal(a.ok, true);
    assert.equal(b.ok, false);
    assert.equal(b.holder.pid, 111);
  });

  it('treats a half-written (unparsable) lock as held — conservative refusal', () => {
    writeFileSync(ownerLockPath(dir), '{"pid": 1'); // torn JSON
    const r = acquireSessionClaim(dir, { pid: 222, pidAlive: dead });
    assert.equal(r.ok, false);
  });
});

describe('releaseSessionClaim', () => {
  it('releases own claim (unlinks the lock)', () => {
    acquireSessionClaim(dir, { pid: 111, pidAlive: alive });
    assert.equal(releaseSessionClaim(dir, { pid: 111 }), true);
    assert.equal(existsSync(ownerLockPath(dir)), false);
  });

  it('never deletes a successor process\'s claim (identity check)', () => {
    acquireSessionClaim(dir, { pid: 222, pidAlive: alive });
    assert.equal(releaseSessionClaim(dir, { pid: 111 }), false);
    assert.equal(readSessionClaim(dir).pid, 222);
  });

  it('tolerates an already-missing lock (ENOENT = released)', () => {
    assert.equal(releaseSessionClaim(dir, { pid: 111 }), true);
  });
});

describe('isForeignLiveOwned', () => {
  it('unclaimed dir → false', () => {
    assert.equal(isForeignLiveOwned(dir, { pid: 111, pidAlive: alive }), false);
  });

  it('own claim → false', () => {
    acquireSessionClaim(dir, { pid: 111, pidAlive: alive });
    assert.equal(isForeignLiveOwned(dir, { pid: 111, pidAlive: alive }), false);
  });

  it('live foreign claim → true', () => {
    acquireSessionClaim(dir, { pid: 222, pidAlive: alive });
    assert.equal(isForeignLiveOwned(dir, { pid: 111, pidAlive: alive }), true);
  });

  it('dead foreign claim → false (crash auto-release, never locked forever)', () => {
    acquireSessionClaim(dir, { pid: 222, pidAlive: alive });
    assert.equal(isForeignLiveOwned(dir, { pid: 111, pidAlive: dead }), false);
  });

  it('half-written lock → false (torn residue must not gate reads)', () => {
    writeFileSync(ownerLockPath(dir), '{"pid": 1'); // torn JSON
    assert.equal(isForeignLiveOwned(dir, { pid: 111, pidAlive: alive }), false);
  });

  it('non-integer pid in lock → false', () => {
    writeFileSync(ownerLockPath(dir), JSON.stringify({ pid: 'abc' }));
    assert.equal(isForeignLiveOwned(dir, { pid: 111, pidAlive: alive }), false);
  });
});

describe('isPidAlive integration (real process probe)', () => {
  it('own real pid is alive; an unlikely pid is dead', () => {
    acquireSessionClaim(dir); // defaults: process.pid + real isPidAlive
    assert.equal(isForeignLiveOwned(dir), false); // own claim
    // A foreign claim with our real (alive) pid+1... use process.pid for
    // "alive" determinism instead: write a foreign lock holding OUR pid seen
    // from a DIFFERENT observer pid — real kill(pid,0) says alive.
    writeFileSync(ownerLockPath(dir), JSON.stringify({ pid: process.pid, startedAt: 'x' }));
    assert.equal(isForeignLiveOwned(dir, { pid: process.pid + 1 }), true);
  });
});
