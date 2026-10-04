/**
 * pty-manager multi-instance (2026-10-06): the PTY Map is keyed by a per-spawn
 * `instanceKey` (NOT cwd), so the same cwd may host multiple concurrent records.
 * Covers: instanceKey minting/uniqueness, the x-ccv-instance self-report header,
 * self-heal respawn reusing the SAME record (not a fresh key), exact-cwd resolution
 * tiebreaks, setPtySessionIdForInstance pinning, and the launch-route dedup gate
 * (ensurePtyForCwd).
 *
 * Uses _setPtyImportForTests to spawn fake PTYs (mirrors pty-manager-anchor.test.js).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  spawnClaude,
  attachPtyFor,
  killPtyFor,
  listLivePtys,
  setPtySessionIdForInstance,
  writeToPtyFor,
  ensurePtyForCwd,
  _resetForTests,
  _setPtyImportForTests,
} from '../server/pty-manager.js';

let spawned;
function fakeSpawn() {
  spawned = [];
  _setPtyImportForTests(() => ({
    spawn(command, args, opts) {
      const exitHandlers = [];
      const dataHandlers = [];
      const inst = {
        pid: 30000 + spawned.length,
        command, args, opts,
        writes: [],
        _killed: false,
        write(d) { inst.writes.push(d); for (const cb of dataHandlers) cb(`out:${d}`); },
        resize() {},
        kill() { inst._exit(0); },
        // Test-only: force an exit with a specific code (to drive non-zero self-heal paths).
        _exit(code) {
          if (inst._killed) return;
          inst._killed = true;
          for (const cb of exitHandlers) cb({ exitCode: code });
        },
        onData(cb) { dataHandlers.push(cb); },
        onExit(cb) { exitHandlers.push(cb); },
      };
      spawned.push(inst);
      return inst;
    },
  }));
}

describe('pty-manager multi-instance (instanceKey-keyed Map)', () => {
  beforeEach(() => { _resetForTests(); fakeSpawn(); });
  afterEach(() => { _resetForTests(); _setPtyImportForTests(null); });

  it('mints a distinct instanceKey per spawn, even on the same cwd', async () => {
    await spawnClaude(9999, '/proj/solo', [], '/bin/echo');
    await spawnClaude(9999, '/proj/solo', [], '/bin/echo');
    const live = listLivePtys();
    assert.equal(live.length, 2, 'two same-cwd records coexist');
    const keys = live.map(p => p.instanceKey);
    assert.equal(new Set(keys).size, 2, 'distinct instanceKeys');
    for (const k of keys) assert.match(k, /^ccv-[0-9a-f]+$/, 'instanceKey has the minted ccv-<hex> shape');
    // cwd stays the REAL directory on both (never the opaque key).
    assert.deepEqual(live.map(p => p.cwd), ['/proj/solo', '/proj/solo']);
  });

  it('injects x-ccv-instance alongside x-ccv-project-dir in ANTHROPIC_CUSTOM_HEADERS', async () => {
    await spawnClaude(9999, '/proj/solo', [], '/bin/echo');
    const env = spawned[0].opts.env;
    const headers = env.ANTHROPIC_CUSTOM_HEADERS || '';
    assert.match(headers, /x-ccv-project-dir: \/proj\/solo/, 'project header present');
    assert.match(headers, /x-ccv-instance: ccv-[0-9a-f]+/, 'instance header present');
    // The injected instance header value equals the record's instanceKey.
    const live = listLivePtys();
    const minted = live[0].instanceKey;
    assert.ok(headers.includes(`x-ccv-instance: ${minted}`), 'header carries the record instanceKey');
  });

  it('exact-cwd resolution prefers the live/active record among same-cwd instances', async () => {
    await spawnClaude(9999, '/proj/solo', [], '/bin/echo'); // spawned[0]
    await spawnClaude(9999, '/proj/solo', [], '/bin/echo'); // spawned[1], becomes active
    // Exact-cwd attach resolves to a live record for that cwd (the active one here).
    const r = attachPtyFor({ cwd: '/proj/solo' });
    assert.equal(r.ok, true, 'cwd branch resolves despite opaque instanceKey keys');
    assert.equal(r.running, true);
    // The resolved record is the ACTIVE same-cwd instance (the "active+live: best" tier), not
    // merely any live one.
    const activeKey = listLivePtys().find(p => p.isActive).instanceKey;
    assert.equal(r.key, activeKey, 'exact-cwd tiebreak resolves to the active instance');
  });

  it('exact-cwd resolution skips an exited same-cwd record in favour of the live one', async () => {
    await spawnClaude(9999, '/proj/solo', [], '/bin/echo'); // spawned[0], will exit
    spawned[0].kill(); // exits → record kept (scrollback) but ptyProcess null
    await new Promise(r => setTimeout(r, 10));
    await spawnClaude(9999, '/proj/solo', [], '/bin/echo'); // spawned[1], live
    const r = attachPtyFor({ cwd: '/proj/solo' });
    assert.equal(r.ok, true);
    assert.equal(r.running, true, 'resolves to the LIVE record, not the exited one');
    const liveKey = listLivePtys()[0].instanceKey; // only spawned[1] is live
    assert.equal(r.key, liveKey, 'exited same-cwd record is not resolved');
  });

  it('an exited record keeps its persistent cwd (basename/cwd lookups still resolve it)', async () => {
    // Regression guard for the listLivePtys cwd contract: an exited-but-unreaped record clears
    // currentWorkspacePath on exit, so its real cwd must come from the persistent record.cwd —
    // never an empty string (which would make basename lookups silently miss it).
    await spawnClaude(9999, '/proj/solo', [], '/bin/echo');
    const key = listLivePtys()[0].instanceKey;
    spawned[0].kill();
    await new Promise(r => setTimeout(r, 10));
    // Exited → dropped from listLivePtys (live-only), but basename resolution still finds it.
    assert.equal(listLivePtys().length, 0, 'exited record dropped from live list');
    const r = attachPtyFor({ cwd: '/proj/solo' });
    assert.equal(r.ok, true, 'exited record still resolvable by cwd (record.cwd persisted)');
    assert.equal(r.key, key, 'resolves to the exited record');
    assert.equal(r.running, false, 'and reports not-running');
  });

  it('setPtySessionIdForInstance pins a sid to the exact same-cwd instance', async () => {
    await spawnClaude(9999, '/proj/solo', [], '/bin/echo'); // spawned[0]
    await spawnClaude(9999, '/proj/solo', [], '/bin/echo'); // spawned[1]
    const [k0, k1] = listLivePtys().map(p => p.instanceKey);
    assert.equal(setPtySessionIdForInstance(k0, 'sid-inst-0'), true);
    assert.equal(setPtySessionIdForInstance(k1, 'sid-inst-1'), true);
    // A send anchored by sid lands on THAT instance even though both share the cwd/basename.
    writeToPtyFor('a', { sessionId: 'sid-inst-0' });
    writeToPtyFor('b', { sessionId: 'sid-inst-1' });
    assert.deepEqual(spawned[0].writes, ['a'], 'sid-inst-0 → first instance');
    assert.deepEqual(spawned[1].writes, ['b'], 'sid-inst-1 → second instance');
  });

  it('setPtySessionIdForInstance rejects a malformed instanceKey and replaces a stale sid', async () => {
    await spawnClaude(9999, '/proj/solo', [], '/bin/echo');
    const key = listLivePtys()[0].instanceKey;
    assert.equal(setPtySessionIdForInstance('not-a-key', 'sid-x'), false, 'rejects non-ccv-hex key');
    assert.equal(setPtySessionIdForInstance(key, ''), false, 'rejects empty sid');
    assert.equal(setPtySessionIdForInstance(key, 'sid-old'), true);
    assert.equal(setPtySessionIdForInstance(key, 'sid-new'), true);
    // Spawn a SECOND instance so the "active" record is unambiguous (it becomes active), then
    // verify the stale sid no longer resolves to its old record. Anchor with ONLY the sid (no
    // project) so there is no project-route fallback: if sidToKey still held sid-old it would
    // route to spawned[0]; cleared, it degrades to the active record (spawned[1]).
    await spawnClaude(9999, '/proj/other', [], '/bin/echo'); // becomes active
    spawned[0].writes.length = 0;
    spawned[1].writes.length = 0;
    writeToPtyFor('y', { sessionId: 'sid-old' }); // sid-only, no project
    assert.deepEqual(spawned[0].writes, [], 'stale sid no longer routes to its old record');
    assert.deepEqual(spawned[1].writes, ['y'], 'cleared sid degrades to the active record');
    writeToPtyFor('z', { sessionId: 'sid-new' });
    assert.deepEqual(spawned[0].writes, ['z'], 'new sid still routes to the instance');
  });

  it('self-heal respawn reuses the SAME record/instanceKey (no orphan, no dangling sid)', async () => {
    // Drive the real `-c` self-heal: a spawn with `-c` whose first turn reports "No
    // conversation found" and exits non-zero triggers `_respawnInto` with the SAME key.
    // Guard against the P0-3 regression: a fresh key would orphan the old record and leave
    // its sid mapping dangling (chat/queue would route to a dead key).
    await spawnClaude(9999, '/proj/solo', ['-c'], '/bin/echo');
    const keyBefore = listLivePtys()[0].instanceKey;
    setPtySessionIdForInstance(keyBefore, 'sid-keep');
    const first = spawned[0];
    first.write('No conversation found'); // lands in outputBuffer via the onData handler
    first._exit(1);                        // non-zero exit with -c + marker → respawn retry
    await new Promise(r => setTimeout(r, 30)); // let the fire-and-forget respawn complete
    // The retry respawned into the SAME record: still exactly one live record for the cwd,
    // with the SAME instanceKey (not a fresh one), and a new process underneath. A respawn
    // starts a fresh conversation, so the old sid is intentionally cleared from the record
    // (sidToKey no longer routes it) — the key point is the record/key was REUSED, and the
    // stale sid no longer resolves anywhere (no orphan key keeps it alive).
    const liveAfter = listLivePtys().filter(p => p.cwd === '/proj/solo');
    assert.equal(liveAfter.length, 1, 'still exactly one record for the cwd (reused, not orphaned)');
    assert.equal(liveAfter[0].instanceKey, keyBefore, 'respawn reused the same instanceKey');
    assert.equal(spawned.length, 2, 'a second process was spawned underneath the same record');
    // The respawn started a fresh conversation, clearing the old sid from the record. Verify
    // via a sid-only anchor (no project fallback): with a second live instance active, a
    // cleared sid degrades to the ACTIVE record, not back to the respawned one.
    await spawnClaude(9999, '/proj/other', [], '/bin/echo'); // becomes active
    spawned[1].writes.length = 0;
    writeToPtyFor('after-heal', { sessionId: 'sid-keep' }); // sid-only
    assert.deepEqual(spawned[1].writes, [], 'stale sid cleared on respawn (no dangling route)');
  });

  it('ensurePtyForCwd re-attaches to a live same-cwd claude instead of spawning a duplicate', async () => {
    await spawnClaude(9999, '/proj/solo', [], '/bin/echo'); // live claude
    const before = listLivePtys().length;
    const r = await ensurePtyForCwd({ cwd: '/proj/solo', proxyPort: 9999, claudePath: '/bin/echo' });
    assert.equal(r.attached, true, 're-attached to the live record');
    assert.equal(r.spawned, false, 'did NOT spawn a duplicate');
    assert.equal(spawned.length, 1, 'no new PTY process');
    assert.equal(listLivePtys().length, before, 'record count unchanged');
  });

  it('ensurePtyForCwd spawns when no live claude exists for the cwd', async () => {
    const r = await ensurePtyForCwd({ cwd: '/proj/fresh', proxyPort: 9999, claudePath: '/bin/echo' });
    assert.equal(r.spawned, true, 'spawned a fresh instance');
    assert.equal(r.attached, false);
    assert.equal(spawned.length, 1);
    assert.equal(listLivePtys()[0].cwd, '/proj/fresh');
  });

  it('ensurePtyForCwd ignores a same-cwd SHELL record (shell is not a claude to reuse)', async () => {
    // A same-cwd shell record must not satisfy the "already-live claude" check.
    await spawnClaude(9999, '/proj/solo', [], '/bin/echo');
    spawned[0].kill(); // claude exits; a shell would respawn into the record in real flow
    await new Promise(r => setTimeout(r, 10));
    const r = await ensurePtyForCwd({ cwd: '/proj/solo', proxyPort: 9999, claudePath: '/bin/echo' });
    // No LIVE claude → spawns fresh (the exited record does not count).
    assert.equal(r.spawned, true);
  });

  it('concurrent ensurePtyForCwd calls on the same cwd do NOT double-spawn (launch TOCTOU guard)', async () => {
    // Two simultaneous launches of one cwd must not both mint a fresh instanceKey: the second
    // waits for the first, then re-scans and attaches to the now-live record.
    const [a, b] = await Promise.all([
      ensurePtyForCwd({ cwd: '/proj/solo', proxyPort: 9999, claudePath: '/bin/echo' }),
      ensurePtyForCwd({ cwd: '/proj/solo', proxyPort: 9999, claudePath: '/bin/echo' }),
    ]);
    assert.equal(spawned.length, 1, 'only ONE process spawned despite two concurrent launches');
    const results = [a, b].map(r => (r.spawned ? 'spawned' : 'attached')).sort();
    assert.deepEqual(results, ['attached', 'spawned'], 'one spawned, the other attached to it');
    assert.equal(listLivePtys().filter(p => p.cwd === '/proj/solo').length, 1, 'one live record for the cwd');
  });

  it('attachPtyFor / killPtyFor resolve by exact instanceKey among same-cwd instances', async () => {
    await spawnClaude(9999, '/proj/solo', [], '/bin/echo'); // spawned[0]
    await spawnClaude(9999, '/proj/solo', [], '/bin/echo'); // spawned[1]
    const [k0, k1] = listLivePtys().map(p => p.instanceKey);
    // instanceKey pins the exact process (basename would be ambiguous across the two).
    const r = attachPtyFor({ instanceKey: k0 });
    assert.equal(r.ok, true);
    assert.equal(r.key, k0, 'attach by instanceKey hits the first instance');
    assert.equal(listLivePtys().find(p => p.isActive).instanceKey, k0, 'active moved to k0');
    // killPtyFor by instanceKey kills only that one.
    const kill = killPtyFor({ instanceKey: k1 });
    assert.equal(kill.ok, true);
    assert.equal(spawned[1]._killed, true, 'second instance killed');
    assert.equal(spawned[0]._killed, false, 'first instance survives');
  });

  it('writeToPtyFor routes by instanceKey anchor (strongest), bypassing basename ambiguity', async () => {
    await spawnClaude(9999, '/proj/solo', [], '/bin/echo'); // spawned[0]
    await spawnClaude(9999, '/proj/solo', [], '/bin/echo'); // spawned[1]
    const k1 = listLivePtys().map(p => p.instanceKey)[1];
    writeToPtyFor('to-k1', { project: 'solo', instanceKey: k1 });
    assert.deepEqual(spawned[1].writes, ['to-k1'], 'instanceKey anchor hit the second instance');
    assert.deepEqual(spawned[0].writes, [], 'first instance untouched');
  });

  it('project-only attach/kill on TWO live same-basename instances → ambiguous (forced disambiguation)', async () => {
    // The pinned decision: a basename-only attach/close that matches two concurrent same-cwd
    // instances must REFUSE (not silently act on "the first live one"), surfacing candidates so
    // the caller re-issues with an instanceKey.
    await spawnClaude(9999, '/proj/solo', [], '/bin/echo');
    await spawnClaude(9999, '/proj/solo', [], '/bin/echo');
    const keys = listLivePtys().map(p => p.instanceKey);
    const att = attachPtyFor({ project: 'solo' });
    assert.equal(att.ok, false, 'ambiguous attach refused');
    assert.equal(att.reason, 'ambiguous');
    assert.equal((att.candidates || []).length, 2, 'both live instances surfaced for disambiguation');
    const kill = killPtyFor({ project: 'solo' });
    assert.equal(kill.ok, false, 'ambiguous close refused');
    assert.equal(kill.reason, 'ambiguous');
    assert.equal(spawned[0]._killed && spawned[1]._killed, false, 'nothing was killed');
    // An instance-keyed call resolves precisely (no ambiguity).
    const precise = attachPtyFor({ project: 'solo', instanceKey: keys[1] });
    assert.equal(precise.ok, true, 'instanceKey disambiguates');
    assert.equal(precise.key, keys[1]);
  });

  it('project-only attach on a SINGLE live instance resolves normally (no false ambiguity)', async () => {
    await spawnClaude(9999, '/proj/solo', [], '/bin/echo');
    const r = attachPtyFor({ project: 'solo' });
    assert.equal(r.ok, true, 'single live instance attaches without needing an instanceKey');
  });

  it('_resetForTests clears instanceKey state so no stale record/key leaks across cases', async () => {
    await spawnClaude(9999, '/proj/solo', [], '/bin/echo');
    const keyBefore = listLivePtys()[0].instanceKey;
    _resetForTests();
    assert.equal(listLivePtys().length, 0, 'Map cleared');
    // A fresh spawn mints a NEW key (the old one is gone, not resurrected).
    await spawnClaude(9999, '/proj/solo', [], '/bin/echo');
    const keyAfter = listLivePtys()[0].instanceKey;
    assert.notEqual(keyAfter, keyBefore, 'no stale instanceKey reuse after reset');
  });
});
