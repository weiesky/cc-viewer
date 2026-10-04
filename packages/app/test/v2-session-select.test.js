/**
 * Task B — cold-load fallback session picker (server/lib/v2/session-select.js).
 *
 * latestMainSessionDir(projectDir) returns the newest readable NON-teammate
 * session dir of a project (by meta.startTs), or '' — so a fresh `ccv` cold
 * load isn't blank. These pin the selection gates: journal-exists,
 * wireFormat support, teammate exclusion, newest-by-startTs, empty cases.
 *
 * Data-safety: fixtures are hand-built under mkdtemp; nothing touches the real
 * CCV_LOG_DIR.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { latestMainSessionDir, sessionHasMainTurn, isDiscardableSession } from '../server/lib/v2/session-select.js';

let projectDir;
beforeEach(() => { projectDir = mkdtempSync(join(tmpdir(), 'ccv-sel-')); });
afterEach(() => { try { rmSync(projectDir, { recursive: true, force: true }); } catch {} });

/** Build a session dir under projectDir/sessions/<sid> with a meta.json and
 *  (optionally) a journal.jsonl. `mainTurn` (default true) writes a kind:'main'
 *  req so the session counts as "activated"; false leaves it empty/sub-only. */
function seed(sid, { startTs, wireFormat = 2, leader = null, journal = true, mainTurn = true, instance = null } = {}) {
  const dir = join(projectDir, 'sessions', sid);
  mkdirSync(dir, { recursive: true });
  const meta = { wireFormat, sessionId: sid, project: 'proj', startTs };
  if (leader) meta.leader = leader;
  if (instance) meta.instance = instance; // multi-instance: stamp the owning PTY instanceKey
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta));
  if (journal) {
    const lines = [JSON.stringify({ ph: 'meta', wireFormat, sessionId: sid })];
    if (mainTurn) {
      lines.push(JSON.stringify({ ph: 'req', seq: 1, rid: 'r1', kind: 'main', ts: startTs, url: 'u' }));
      lines.push(JSON.stringify({ ph: 'done', seq: 1, rid: 'r1', ts: startTs, status: 'ok' }));
    } else {
      // sub-only / not-yet-activated: a non-main req sets a sid but no main turn.
      lines.push(JSON.stringify({ ph: 'req', seq: 1, rid: 'r1', kind: 'sub', ts: startTs, url: 'u' }));
    }
    writeFileSync(join(dir, 'journal.jsonl'), lines.join('\n') + '\n');
  }
  return dir;
}

const iso = (n) => new Date(Date.UTC(2026, 6, 14, 5, 0, n)).toISOString();

describe('latestMainSessionDir', () => {
  it('returns "" when the project has no sessions', () => {
    assert.equal(latestMainSessionDir(projectDir), '');
  });

  it('instanceKey filter picks only that instance\'s latest session (multi-instance)', () => {
    // Two same-cwd instances write DIFFERENT session dirs (distinct wire UUIDs), each stamped
    // with its own meta.instance. An instance-scoped cold load must resolve to THAT instance's
    // newest session, not the global newest.
    const a1 = seed('aaaa-older', { startTs: iso(1), instance: 'ccv-aaa' });
    const a2 = seed('aaaa-newer', { startTs: iso(5), instance: 'ccv-aaa' }); // A's newest
    seed('bbbb-newest', { startTs: iso(9), instance: 'ccv-bbb' });            // B's (globally newest)
    // Unscoped: global newest (B).
    assert.equal(latestMainSessionDir(projectDir), join(projectDir, 'sessions', 'bbbb-newest'));
    // Instance-scoped to A: A's newest, even though B's is globally newer.
    assert.equal(latestMainSessionDir(projectDir, { instanceKey: 'ccv-aaa' }), join(projectDir, 'sessions', 'aaaa-newer'));
    // Instance-scoped to B.
    assert.equal(latestMainSessionDir(projectDir, { instanceKey: 'ccv-bbb' }), join(projectDir, 'sessions', 'bbbb-newest'));
  });

  it('instance scope: own session when it has content; else fall back to the project\'s content-bearing history', () => {
    // User-pinned semantics (2026-10-06): "show the instance's session when it has content, else
    // fall back to the project's latest session WITH content" — never a blank instance shell.
    seed('legacy-no-inst', { startTs: iso(5) });              // no meta.instance, HAS a main turn
    seed('aaaa-quiet', { startTs: iso(6), instance: 'ccv-aaa', mainTurn: false }); // instance, but NO content
    seed('bbbb-active', { startTs: iso(3), instance: 'ccv-bbb' });                 // instance WITH content
    // Instance WITH content → its own session.
    assert.equal(latestMainSessionDir(projectDir, { instanceKey: 'ccv-bbb' }), join(projectDir, 'sessions', 'bbbb-active'));
    // Instance that EXISTS but has NO content → fall back to the project's newest content-bearing
    // session (here the legacy main-turn dir), NOT the instance's empty shell and NOT "".
    assert.equal(latestMainSessionDir(projectDir, { instanceKey: 'ccv-aaa' }), join(projectDir, 'sessions', 'legacy-no-inst'));
    // An instance with NO dir at all likewise falls back to project history (the frontend never
    // sends a key for a non-live instance, so this is a safe degrade, not a cross-instance leak).
    assert.equal(latestMainSessionDir(projectDir, { instanceKey: 'ccv-zzz' }), join(projectDir, 'sessions', 'legacy-no-inst'));
    // Unscoped: the project's newest content-bearing session.
    assert.equal(latestMainSessionDir(projectDir), join(projectDir, 'sessions', 'legacy-no-inst'));
  });

  it('instance with NO main-turn AND no project history falls back to its OWN newest dir', () => {
    // When neither the instance nor ANY project session has a main turn (a truly fresh project),
    // degrade to the instance's own newest dir (still strictly its own, never another's) — the
    // cold load shows its (quiet) session rather than erroring.
    seed('aaaa-quiet', { startTs: iso(5), instance: 'ccv-aaa', mainTurn: false });
    assert.equal(latestMainSessionDir(projectDir, { instanceKey: 'ccv-aaa' }), join(projectDir, 'sessions', 'aaaa-quiet'));
  });

  it('returns "" for a falsy projectDir', () => {
    assert.equal(latestMainSessionDir(''), '');
    assert.equal(latestMainSessionDir(null), '');
  });

  it('selects the single main session', () => {
    const dir = seed('s1', { startTs: iso(1) });
    assert.equal(latestMainSessionDir(projectDir), dir);
  });

  it('selects the newest by meta.startTs among N sessions', () => {
    seed('s1', { startTs: iso(1) });
    const newest = seed('s2', { startTs: iso(3) });
    seed('s3', { startTs: iso(2) });
    assert.equal(latestMainSessionDir(projectDir), newest);
  });

  it('excludes teammate sessions (meta.leader present) even when newest', () => {
    const leaderDir = seed('leader', { startTs: iso(1) });
    seed('tm', { startTs: iso(5), leader: { agentName: 'worker-1', teamName: 'team-x' } });
    // The teammate is newest by startTs but must be skipped → the leader wins.
    assert.equal(latestMainSessionDir(projectDir), leaderDir);
  });

  it('returns "" when the only session is a teammate', () => {
    seed('tm', { startTs: iso(5), leader: { agentName: 'w' } });
    assert.equal(latestMainSessionDir(projectDir), '');
  });

  it('skips a torn session (meta but no journal), picking the next readable one', () => {
    seed('torn', { startTs: iso(5), journal: false });
    const good = seed('good', { startTs: iso(2) });
    assert.equal(latestMainSessionDir(projectDir), good);
  });

  it('skips an unsupported wireFormat session (future v3)', () => {
    seed('v3', { startTs: iso(5), wireFormat: 3 });
    const good = seed('good', { startTs: iso(2) });
    assert.equal(latestMainSessionDir(projectDir), good);
  });

  it('tolerates a missing/corrupt meta.json without crashing', () => {
    const dir = join(projectDir, 'sessions', 'bad');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'journal.jsonl'), 'x\n');
    writeFileSync(join(dir, 'meta.json'), '{ not json');
    const good = seed('good', { startTs: iso(2) });
    assert.equal(latestMainSessionDir(projectDir), good);
  });

  it('skips a newest session that has NO main turn (the refresh-bug case), picking the newest activated one', () => {
    const activated = seed('act', { startTs: iso(2) });          // has a main turn
    seed('empty', { startTs: iso(9), mainTurn: false });          // newest but sub-only → skip
    assert.equal(latestMainSessionDir(projectDir), activated);
  });

  it('returns "" when NO session has a main turn', () => {
    seed('e1', { startTs: iso(2), mainTurn: false });
    seed('e2', { startTs: iso(5), mainTurn: false });
    assert.equal(latestMainSessionDir(projectDir), '');
  });
});

describe('latestMainSessionDir skipForeignLive (multi-window isolation)', () => {
  // owner.lock validity is PID liveness: process.ppid (the live test runner)
  // stands in for "another live ccv window"; a reaped child pid for a crashed
  // one. No mocks — the predicate runs its real kill(pid,0) probe.
  const claim = (dir, pid) => writeFileSync(join(dir, 'owner.lock'), JSON.stringify({ pid, startedAt: iso(0) }));

  it('skips the newest session when it is claimed by another LIVE process', () => {
    const mine = seed('mine', { startTs: iso(2) });
    const other = seed('other', { startTs: iso(9) });
    claim(other, process.ppid);
    assert.equal(latestMainSessionDir(projectDir, { skipForeignLive: true }), mine);
  });

  it('default (no opt) keeps the raw picker semantics — claimed dirs still selectable', () => {
    seed('mine', { startTs: iso(2) });
    const other = seed('other', { startTs: iso(9) });
    claim(other, process.ppid);
    assert.equal(latestMainSessionDir(projectDir), other);
  });

  it('a DEAD owner claim never blocks selection (crash auto-release, no permanent lock)', () => {
    const deadPid = spawnSync(process.execPath, ['-e', '']).pid; // exited → pid is dead
    const crashed = seed('crashed', { startTs: iso(9) });
    claim(crashed, deadPid);
    assert.equal(latestMainSessionDir(projectDir, { skipForeignLive: true }), crashed);
  });

  it('this process\'s own claim is selectable (not foreign)', () => {
    const own = seed('own', { startTs: iso(9) });
    claim(own, process.pid);
    assert.equal(latestMainSessionDir(projectDir, { skipForeignLive: true }), own);
  });

  it('returns "" when the only candidate is foreign-live (intentional empty cold load)', () => {
    const other = seed('other', { startTs: iso(9) });
    claim(other, process.ppid);
    assert.equal(latestMainSessionDir(projectDir, { skipForeignLive: true }), '');
  });
});

describe('sessionHasMainTurn', () => {
  it('true when the journal has a kind:main req', () => {
    const dir = seed('s1', { startTs: iso(1) });
    assert.equal(sessionHasMainTurn(dir), true);
  });
  it('false for a sub-only / not-yet-activated session', () => {
    const dir = seed('s1', { startTs: iso(1), mainTurn: false });
    assert.equal(sessionHasMainTurn(dir), false);
  });
  it('false when the journal is missing', () => {
    const dir = seed('s1', { startTs: iso(1), journal: false });
    assert.equal(sessionHasMainTurn(dir), false);
  });
});

// ─── isDiscardableSession — the read-side discard predicate (2026-07-16) ─────
describe('isDiscardableSession', () => {
  const raw = (sid, { meta = { wireFormat: 2, sessionId: sid, project: 'proj', startTs: iso(1) }, journalLines = null } = {}) => {
    const dir = join(projectDir, 'sessions', sid);
    mkdirSync(dir, { recursive: true });
    if (meta) writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta));
    if (journalLines) writeFileSync(join(dir, 'journal.jsonl'), journalLines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
    return dir;
  };
  const sentinel = (sid) => ({ ph: 'meta', wireFormat: 2, sessionId: sid });
  const req = (seq, kind) => ({ ph: 'req', seq, rid: `r${seq}`, kind, ts: iso(seq), url: 'u' });

  it('a quota-probe orphan (single sub req, no leader) is discardable', () => {
    const dir = raw('probe', { journalLines: [sentinel('probe'), req(1, 'sub'), { ph: 'done', seq: 1, rid: 'r1', ts: iso(2), status: 'ok' }] });
    assert.equal(isDiscardableSession(dir), true);
  });

  it('empty / sentinel-only / missing journals are discardable', () => {
    assert.equal(isDiscardableSession(raw('empty', { journalLines: [''] })), true);
    assert.equal(isDiscardableSession(raw('sentinel', { journalLines: [sentinel('sentinel')] })), true);
    assert.equal(isDiscardableSession(raw('nojournal', {})), true);
    assert.equal(isDiscardableSession(raw('hb', { journalLines: [sentinel('hb'), req(1, 'heartbeat'), req(2, 'countTokens')] })), true, 'noid heartbeat/countTokens-only dir');
  });

  it('a main-bearing session is kept, even with sub/heartbeat lines before main', () => {
    const dir = raw('real', { journalLines: [sentinel('real'), req(1, 'sub'), req(2, 'heartbeat'), req(3, 'main')] });
    assert.equal(isDiscardableSession(dir), false, 'main at seq 3 (real IM shape) must be found');
  });

  it('a teammate session is kept via meta.leader without scanning', () => {
    const dir = raw('tm', {
      meta: { wireFormat: 2, sessionId: 'tm', project: 'proj', startTs: iso(1), leader: { parentSessionId: 'x', agentName: 'tm1' } },
      journalLines: [sentinel('tm'), req(1, 'sub')],
    });
    assert.equal(isDiscardableSession(dir), false);
  });

  it('torn meta.json falls back to the journal scan: teammate kind line keeps the session', () => {
    const dir = raw('torn', { meta: null, journalLines: [sentinel('torn'), req(1, 'teammate')] });
    writeFileSync(join(dir, 'meta.json'), '{truncated');
    assert.equal(isDiscardableSession(dir), false, 'kind:teammate is the torn-meta safety net');
  });

  it('accepts a pre-read meta to skip the meta.json re-read', () => {
    const dir = raw('pre', { journalLines: [sentinel('pre'), req(1, 'sub')] });
    assert.equal(isDiscardableSession(dir, { leader: { agentName: 'x' } }), false, 'caller-supplied leader wins');
    assert.equal(isDiscardableSession(dir, null), true, 'caller-supplied null meta → journal decides');
  });
});

// ─── budget width + I/O error direction pins (2026-07-16 review) ─────────────
describe('isDiscardableSession robustness', () => {
  it('a real session whose first main sits past 256KB of heartbeat noise is KEPT (wide budget)', () => {
    const dir = join(projectDir, 'sessions', 'noisy');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({ wireFormat: 2, sessionId: 'noisy', project: 'proj', startTs: iso(1) }));
    const pad = 'h'.repeat(1024); // ~1KB per line, mirroring real req-line sizes
    const lines = [JSON.stringify({ ph: 'meta', wireFormat: 2, sessionId: 'noisy' })];
    for (let i = 1; i <= 300; i++) {
      lines.push(JSON.stringify({ ph: 'req', seq: i, rid: `r${i}`, kind: 'heartbeat', ts: iso(1), url: 'u', pad }));
    }
    lines.push(JSON.stringify({ ph: 'req', seq: 301, rid: 'rm', kind: 'main', ts: iso(2), url: 'u' }));
    writeFileSync(join(dir, 'journal.jsonl'), lines.join('\n') + '\n');
    // >300KB of heartbeat lines precede the main req — a 256KB budget would
    // give up and wrongly discard this REAL session.
    assert.equal(isDiscardableSession(dir), false);
  });

  it('an I/O error on an EXISTING journal keeps the session (never hide real data on a hiccup)', () => {
    // journal.jsonl as a DIRECTORY: existsSync true, open/read throws — the
    // deterministic stand-in for a transient lock/fd-exhaustion error.
    const dir = join(projectDir, 'sessions', 'locked');
    mkdirSync(join(dir, 'journal.jsonl'), { recursive: true });
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({ wireFormat: 2, sessionId: 'locked', project: 'proj', startTs: iso(1) }));
    assert.equal(isDiscardableSession(dir), false, 'error → keep; only a truly main-less readable journal discards');
  });
});
