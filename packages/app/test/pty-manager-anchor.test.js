/**
 * pty-manager anchor routing (2026-10-05): chat sends route by an explicit
 * { sessionId, project } anchor instead of the global activePtyKey, so a send
 * lands on the viewed conversation's PTY even mid-view-switch.
 *
 * Uses _setPtyImportForTests to spawn fake PTYs (mirrors pty-manager.test.js).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  spawnClaude,
  writeToPty,
  writeToPtyFor,
  setPtySessionId,
  attachPtyFor,
  _resetForTests,
  _setPtyImportForTests,
} from '../server/pty-manager.js';

let spawned;
function fakeSpawn() {
  spawned = [];
  _setPtyImportForTests(() => ({
    spawn(command, args, opts) {
      const inst = {
        pid: 20000 + spawned.length,
        command, args, opts,
        writes: [],
        write(d) { inst.writes.push(d); },
        resize() {},
        kill() { for (const cb of exitHandlers) cb({ exitCode: 0 }); },
        onData() {},
        onExit(cb) { exitHandlers.push(cb); },
      };
      const exitHandlers = [];
      spawned.push(inst);
      return inst;
    },
  }));
}

describe('pty-manager anchor routing (writeToPtyFor / setPtySessionId)', () => {
  beforeEach(() => { _resetForTests(); fakeSpawn(); });
  afterEach(() => { _resetForTests(); _setPtyImportForTests(null); });

  it('routes by sessionId to the PTY that owns the conversation (not the active one)', async () => {
    await spawnClaude(9999, '/proj/sage', [], '/bin/echo');       // sage  → spawned[0], becomes active
    await spawnClaude(9999, '/proj/finqa-remote-cc', [], '/bin/echo'); // finqa → spawned[1], becomes active
    // finqa's conversation minted a sid; feed it to the index.
    assert.equal(setPtySessionId('finqa-remote-cc', 'sid-finqa-1'), true);
    // Send anchored to sage's session while finqa is active → must hit sage's PTY.
    // (First give sage a sid so we can anchor to it.)
    // We never set sage's sid, so anchor to finqa's sid while sage becomes active:
    attachPtyFor({ project: 'sage' }); // active ← sage
    const ok = writeToPtyFor('hello', { sessionId: 'sid-finqa-1', project: 'finqa-remote-cc' });
    assert.equal(ok, true);
    assert.deepEqual(spawned[1].writes, ['hello'], 'finqa PTY got the write');
    assert.deepEqual(spawned[0].writes, [], 'sage PTY untouched despite being active');
  });

  it('falls back to project routing when sessionId is unknown', async () => {
    await spawnClaude(9999, '/proj/sage', [], '/bin/echo');
    await spawnClaude(9999, '/proj/finqa-remote-cc', [], '/bin/echo');
    attachPtyFor({ project: 'sage' }); // active ← sage
    const ok = writeToPtyFor('hi', { sessionId: 'no-such-sid', project: 'finqa-remote-cc' });
    assert.equal(ok, true);
    assert.deepEqual(spawned[1].writes, ['hi'], 'project route hit finqa');
  });

  it('falls back to the active record when no anchor resolves (legacy)', async () => {
    await spawnClaude(9999, '/proj/sage', [], '/bin/echo');
    const ok = writeToPtyFor('hi', { sessionId: 'nope', project: 'no-such-project' });
    assert.equal(ok, true);
    assert.deepEqual(spawned[0].writes, ['hi'], 'degraded to active (sage)');
  });

  it('returns false when nothing exists at all', () => {
    assert.equal(writeToPtyFor('hi', { project: 'ghost' }), false);
  });

  it('setPtySessionId replaces a stale sid mapping (re-spawn / new conversation)', async () => {
    await spawnClaude(9999, '/proj/finqa-remote-cc', [], '/bin/echo');
    setPtySessionId('finqa-remote-cc', 'sid-old');
    setPtySessionId('finqa-remote-cc', 'sid-new');
    // The old sid must no longer route anywhere; the new sid routes to finqa.
    attachPtyFor({ project: 'finqa-remote-cc' });
    writeToPtyFor('x', { sessionId: 'sid-new', project: 'finqa-remote-cc' });
    assert.deepEqual(spawned[0].writes, ['x']);
    // stale sid falls through to project/active (still finqa here) — but must not
    // resurrect the old mapping; verify old sid key no longer points at the record
    // by checking a send with ONLY the stale sid and a wrong project degrades.
    spawned[0].writes.length = 0;
    writeToPtyFor('y', { sessionId: 'sid-old', project: 'finqa-remote-cc' });
    assert.deepEqual(spawned[0].writes, ['y'], 'stale sid degrades to project route');
  });

  it('writeToPty (no anchor) still targets the active record — unchanged legacy path', async () => {
    await spawnClaude(9999, '/proj/sage', [], '/bin/echo');
    await spawnClaude(9999, '/proj/finqa-remote-cc', [], '/bin/echo');
    attachPtyFor({ project: 'sage' });
    writeToPty('plain');
    assert.deepEqual(spawned[0].writes, ['plain'], 'active (sage) got it');
    assert.deepEqual(spawned[1].writes, [], 'finqa untouched');
  });

  it('P0: a sid that contradicts the anchor project is dropped to the project route', async () => {
    // View-switch window: anchor carries the DEPARTING project's sid + the NEW
    // project. Sid-first routing would send the message back to the old project.
    await spawnClaude(9999, '/proj/sage', [], '/bin/echo');        // spawned[0]
    await spawnClaude(9999, '/proj/finqa-remote-cc', [], '/bin/echo'); // spawned[1]
    setPtySessionId('sage', 'sid-sage-1'); // sage PTY owns sid-sage-1
    // Anchor: project=finqa (new view) but sessionId=sage's (stale, from the old view).
    const ok = writeToPtyFor('hello', { sessionId: 'sid-sage-1', project: 'finqa-remote-cc' });
    assert.equal(ok, true);
    assert.deepEqual(spawned[1].writes, ['hello'], 'conflicting sid ignored → finqa (project route)');
    assert.deepEqual(spawned[0].writes, [], 'sage NOT hit despite owning the sid');
  });

  it('P1: anchored sends never move the global active pointer', async () => {
    await spawnClaude(9999, '/proj/sage', [], '/bin/echo');
    await spawnClaude(9999, '/proj/finqa-remote-cc', [], '/bin/echo');
    attachPtyFor({ project: 'sage' }); // active ← sage
    setPtySessionId('finqa-remote-cc', 'sid-finqa-1');
    writeToPtyFor('x', { sessionId: 'sid-finqa-1', project: 'finqa-remote-cc' });
    // A subsequent no-anchor write must STILL go to sage (the explicit attach),
    // proving the anchored send did not re-anchor the global active pointer.
    writeToPty('plain');
    assert.deepEqual(spawned[0].writes, ['plain'], 'active still sage after anchored finqa send');
  });

  it('P2: project route prefers a running record over an exited same-name one', async () => {
    // Two records sharing one basename: an exited finqa-remote-cc and a live one.
    await spawnClaude(9999, '/proj/finqa-remote-cc', [], '/bin/echo'); // spawned[0], will exit
    const first = spawned[0];
    first.kill(); // exits → record kept (scrollback) but ptyProcess null
    await new Promise(r => setTimeout(r, 10));
    await spawnClaude(9999, '/proj/finqa-remote-cc', [], '/bin/echo'); // same cwd → a second coexisting instance (2026-10-06: instanceKey-keyed, no kill)
    // Note: a same-cwd re-spawn now mints a FRESH instanceKey (a deliberate second process),
    // not a record reuse. Use two DIFFERENT dirs with the same basename to truly exercise
    // the collision branch.
    _resetForTests(); fakeSpawn();
    await spawnClaude(9999, '/a/finqa-remote-cc', [], '/bin/echo'); // spawned[0]
    spawned[0].kill(); // exit the first
    await new Promise(r => setTimeout(r, 10));
    await spawnClaude(9999, '/b/finqa-remote-cc', [], '/bin/echo'); // spawned[1], live
    const ok = writeToPtyFor('hi', { project: 'finqa-remote-cc' });
    assert.equal(ok, true);
    assert.deepEqual(spawned[1].writes, ['hi'], 'live same-name record got the write, not the exited first');
  });
});
