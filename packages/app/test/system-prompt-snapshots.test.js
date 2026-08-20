// Per-project system-prompt snapshot store (server/lib/system-prompt-snapshots.js):
// record CRUD, pending FIFO semantics (wire content-match vs identity-exact resume
// consume), -c target resolution, and gc hygiene. LOG_DIR is redirected to a private
// tmp root BEFORE any import that touches findcc; the claude projects dir is steered
// per-test via CCV_PROJECTS_DIR (read at call time; findcc's L1x barriers otherwise).
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmp = mkdtempSync(join(tmpdir(), 'ccv-sp-snap-'));
process.env.CCV_LOG_DIR = tmp;

const CWD = '/ws/alpha-project';
const PROJECT_KEY = 'alpha-project';
const UUID_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const UUID_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const UUID_C = 'cccccccc-3333-4333-8333-cccccccccccc';

let mod;
let projectsRoot;
let nowMs;

function storeDir() { return join(tmp, PROJECT_KEY, 'system-prompt-snapshots'); }
function transcriptDir() { return join(projectsRoot, CWD.replace(/[^A-Za-z0-9]/g, '-')); }
function makeTranscript(uuid, mtimeMs, head = '{"type":"summary"}\n{"type":"user","message":{}}\n') {
  mkdirSync(transcriptDir(), { recursive: true });
  const f = join(transcriptDir(), `${uuid}.jsonl`);
  writeFileSync(f, head);
  const d = new Date(mtimeMs);
  utimesSync(f, d, d);
  return f;
}
function entry(flag, basename, content) { return { flag, basename, content }; }
const APPEND_ENTRY = entry('--append-system-prompt-file', 'CC_APPEND_SYSTEM.md', 'PINNED-CONTENT-α');
const OVERRIDE_ENTRY = entry('--system-prompt-file', 'CC_SYSTEM.md', 'OVERRIDE-CONTENT-β');

before(async () => {
  mod = await import('../server/lib/system-prompt-snapshots.js');
});

beforeEach(() => {
  projectsRoot = mkdtempSync(join(tmpdir(), 'ccv-sp-snap-proj-'));
  process.env.CCV_PROJECTS_DIR = projectsRoot;
  nowMs = 1_800_000_000_000;
  mod._setSnapshotDepsForTests({ now: () => nowMs });
  rmSync(join(tmp, PROJECT_KEY), { recursive: true, force: true });
});

afterEach(() => {
  delete process.env.CCV_PROJECTS_DIR;
  rmSync(projectsRoot, { recursive: true, force: true });
});

after(() => {
  mod._setSnapshotDepsForTests({});
  rmSync(tmp, { recursive: true, force: true });
});

describe('projectKeyForCwd / transcriptDirForCwd', () => {
  it('derives the project key like interceptor.js (basename + sanitize)', () => {
    assert.equal(mod.projectKeyForCwd('/ws/alpha-project'), 'alpha-project');
    assert.equal(mod.projectKeyForCwd('/ws/my proj!'), 'my_proj_');
    assert.equal(mod.projectKeyForCwd(''), '');
    assert.equal(mod.projectKeyForCwd(null), '');
  });

  it('maps all-dots degenerate names to _ (no traversal segment)', () => {
    assert.equal(mod.projectKeyForCwd('/x/..'), '_');
    assert.equal(mod.projectKeyForCwd('..'), '_');
  });

  it('maps cwd to the claude transcript dir via CCV_PROJECTS_DIR', () => {
    assert.equal(mod.transcriptDirForCwd('/Users/sky/work'), join(projectsRoot, '-Users-sky-work'));
    assert.equal(mod.transcriptDirForCwd(''), '');
  });
});

describe('systemTextOfBody', () => {
  it('handles array, string, and missing system fields', () => {
    assert.equal(mod.systemTextOfBody({ system: [{ type: 'text', text: 'a' }, { text: 'b' }, null] }), 'ab');
    assert.equal(mod.systemTextOfBody({ system: 'plain string' }), 'plain string');
    assert.equal(mod.systemTextOfBody({}), '');
    assert.equal(mod.systemTextOfBody(null), '');
  });
});

describe('writeSnapshot / readSnapshot', () => {
  it('round-trips a record with entries and model', () => {
    const r = mod.writeSnapshot(CWD, UUID_A, { entries: [APPEND_ENTRY], model: 'glm-5', boundVia: 'wire' });
    assert.equal(r.written, true);
    const rec = mod.readSnapshot(CWD, UUID_A);
    assert.deepEqual(rec.entries, [APPEND_ENTRY]);
    assert.equal(rec.model, 'glm-5');
    assert.equal(rec.boundVia, 'wire');
    assert.equal(rec.createdAt, nowMs);
  });

  it('refuses empty-entries records (no-record ≡ no-injection; no mislabeling surface)', () => {
    assert.deepEqual(mod.writeSnapshot(CWD, UUID_A, { entries: [] }), { written: false, reason: 'empty' });
    assert.equal(mod.readSnapshot(CWD, UUID_A), null);
  });

  it('skipIfPresent: identical rewrite refreshes createdAt; different content keeps the first bind', () => {
    mod.writeSnapshot(CWD, UUID_A, { entries: [APPEND_ENTRY] });
    nowMs += 1000;
    const again = mod.writeSnapshot(CWD, UUID_A, { entries: [APPEND_ENTRY] });
    assert.deepEqual(again, { written: false, reason: 'identical' });
    assert.equal(mod.readSnapshot(CWD, UUID_A).createdAt, nowMs, 'clock refreshed so active conversations survive gc');
    const conflicting = mod.writeSnapshot(CWD, UUID_A, { entries: [OVERRIDE_ENTRY] });
    assert.deepEqual(conflicting, { written: false, reason: 'exists' });
    assert.deepEqual(mod.readSnapshot(CWD, UUID_A).entries, [APPEND_ENTRY], 'first bind wins');
  });

  it('skipIfPresent:false overwrites', () => {
    mod.writeSnapshot(CWD, UUID_A, { entries: [APPEND_ENTRY] });
    const r = mod.writeSnapshot(CWD, UUID_A, { entries: [OVERRIDE_ENTRY] }, { skipIfPresent: false });
    assert.equal(r.written, true);
    assert.deepEqual(mod.readSnapshot(CWD, UUID_A).entries, [OVERRIDE_ENTRY]);
  });

  it('rejects invalid uuids and sanitizes hostile/junk entries', () => {
    assert.deepEqual(mod.writeSnapshot(CWD, 'not-a-uuid', { entries: [APPEND_ENTRY] }), { written: false, reason: 'invalid' });
    assert.equal(mod.readSnapshot(CWD, 'not-a-uuid'), null);
    mod.writeSnapshot(CWD, UUID_A, {
      entries: [
        { flag: 1 }, null,
        entry('--dangerously-skip-permissions', 'x.md', 'evil flag'),      // flag not whitelisted
        entry('--append-system-prompt-file', '../../escape.md', 'traversal basename'),
        entry('--append-system-prompt-file', '.hidden', 'dotfile basename'),
        entry('--append-system-prompt-file', 'big.md', 'x'.repeat(300 * 1024)), // over 256KB cap
        APPEND_ENTRY,
        { flag: '--system-prompt-file', basename: 'y.md' },                // no content
      ],
    });
    assert.deepEqual(mod.readSnapshot(CWD, UUID_A).entries, [APPEND_ENTRY]);
  });

  it('returns null for corrupt files', () => {
    mkdirSync(storeDir(), { recursive: true });
    writeFileSync(join(storeDir(), `${UUID_A}.json`), '{not json');
    assert.equal(mod.readSnapshot(CWD, UUID_A), null);
  });
});

describe('pending queue', () => {
  it('appendPending stamps normalized cwd/createdAt/pid; corrupt queue reads as empty', () => {
    assert.equal(mod.appendPending(CWD, { entries: [APPEND_ENTRY], model: 'm1' }), true);
    const raw = JSON.parse(readFileSync(join(storeDir(), 'pending.json'), 'utf-8'));
    assert.equal(raw.pendings.length, 1);
    assert.equal(raw.pendings[0].cwd, CWD);
    assert.equal(raw.pendings[0].createdAt, nowMs);
    assert.equal(raw.pendings[0].pid, process.pid);
    assert.equal(raw.pendings[0].resumeExpected, false);
    writeFileSync(join(storeDir(), 'pending.json'), '{broken');
    assert.equal(mod.consumePendingForWireByKey(PROJECT_KEY, 'whatever'), null, 'never throws');
  });

  it('normalizes cwd across symlinks (spawn path vs hook payload path)', () => {
    // macOS: tmpdir() is /var/folders/... but realpath is /private/var/folders/... —
    // the hook payload's cwd may differ bytewise from the spawn's.
    const raw = mkdtempSync(join(tmpdir(), 'ccv-sp-norm-'));
    const real = realpathSync(raw);
    if (real === raw) return; // nothing to normalize on this platform
    mod.appendPending(raw, { entries: [], resumeExpected: true, resolvedUuid: UUID_A });
    const res = mod.consumePendingForResume(real, UUID_A, 'resume');
    assert.ok(res && res.hit, 'symlink-divergent cwd still matches');
    assert.equal(res.hit.resolvedUuid, UUID_A);
    rmSync(raw, { recursive: true, force: true });
  });

  it('wire consume: non-empty requires full content match (content is the capability)', () => {
    mod.appendPending(CWD, { entries: [APPEND_ENTRY] });
    assert.equal(mod.consumePendingForWireByKey(PROJECT_KEY, 'a system text without the marker'), null);
    const hit = mod.consumePendingForWireByKey(PROJECT_KEY, `default prompt ... ${APPEND_ENTRY.content}`);
    assert.equal(hit.entries[0].content, APPEND_ENTRY.content);
    assert.equal(mod.consumePendingForWireByKey(PROJECT_KEY, APPEND_ENTRY.content), null, 'consumed once');
  });

  it('wire consume: multi-entry pendings require EVERY entry (partial match never consumes)', () => {
    mod.appendPending(CWD, { entries: [APPEND_ENTRY, OVERRIDE_ENTRY] });
    assert.equal(mod.consumePendingForWireByKey(PROJECT_KEY, `only ${APPEND_ENTRY.content} present`), null);
    const hit = mod.consumePendingForWireByKey(PROJECT_KEY, `${APPEND_ENTRY.content} ... ${OVERRIDE_ENTRY.content}`);
    assert.equal(hit.entries.length, 2);
  });

  it('wire consume: the LONGEST full match wins (a superset launch is never claimed by a subset pending)', () => {
    mod.appendPending(CWD, { entries: [APPEND_ENTRY] });
    mod.appendPending(CWD, { entries: [APPEND_ENTRY, OVERRIDE_ENTRY] });
    const hit = mod.consumePendingForWireByKey(PROJECT_KEY, `${APPEND_ENTRY.content} ${OVERRIDE_ENTRY.content}`);
    assert.equal(hit.entries.length, 2, 'superset pending matched, not the older subset one');
    const leftover = mod.consumePendingForWireByKey(PROJECT_KEY, APPEND_ENTRY.content);
    assert.equal(leftover.entries.length, 1);
  });

  it('wire consume: content match beats an older empty pending; empty consumed oldest-first otherwise', () => {
    mod.appendPending(CWD, { entries: [] });
    mod.appendPending(CWD, { entries: [APPEND_ENTRY] });
    const hit = mod.consumePendingForWireByKey(PROJECT_KEY, `x ${APPEND_ENTRY.content} y`);
    assert.deepEqual(hit.entries, [APPEND_ENTRY]);
    const empty = mod.consumePendingForWireByKey(PROJECT_KEY, 'default-only system text');
    assert.deepEqual(empty.entries, [], 'oldest empty pending falls out last');
    assert.equal(mod.consumePendingForWireByKey(PROJECT_KEY, 'anything'), null);
  });

  it('wire consume skips resumeExpected pendings (reserved for Bind B)', () => {
    mod.appendPending(CWD, { entries: [APPEND_ENTRY], resumeExpected: true, resolvedUuid: UUID_A });
    assert.equal(mod.consumePendingForWireByKey(PROJECT_KEY, APPEND_ENTRY.content), null);
  });

  it('resume consume (source=resume): exact resolvedUuid match only — a foreign hook consumes nothing', () => {
    mod.appendPending(CWD, { entries: [APPEND_ENTRY], resumeExpected: true, resolvedUuid: UUID_A });
    const miss = mod.consumePendingForResume(CWD, UUID_B, 'resume');
    assert.ok(miss && miss.mismatch === UUID_A, 'mismatch surfaced for diagnostics');
    assert.ok(!miss.hit, 'nothing consumed on mismatch (no cascade, no destroy)');
    const raw = JSON.parse(readFileSync(join(storeDir(), 'pending.json'), 'utf-8'));
    assert.equal(raw.pendings.length, 1, 'queue intact after the refused hook');
    const hit = mod.consumePendingForResume(CWD, UUID_A, 'resume');
    assert.equal(hit.hit.resolvedUuid, UUID_A);
  });

  it('resume consume (source=fork): only fork pendings match, regardless of the new uuid', () => {
    mod.appendPending(CWD, { entries: [APPEND_ENTRY], resumeExpected: true, resolvedUuid: UUID_A });
    mod.appendPending(CWD, { entries: [OVERRIDE_ENTRY], resumeExpected: true, resolvedUuid: UUID_A, fork: true });
    const miss = mod.consumePendingForResume(CWD, UUID_C, 'fork');
    assert.equal(miss.hit.entries[0].content, OVERRIDE_ENTRY.content, 'fork hook takes the fork pending');
    const raw = JSON.parse(readFileSync(join(storeDir(), 'pending.json'), 'utf-8'));
    assert.equal(raw.pendings.length, 1, 'the plain resume pending was not touched');
    assert.equal(raw.pendings[0].fork, false);
  });

  it('resume consume honors the cwd gate and purges stale (>15min) resume pendings', () => {
    mod.appendPending(CWD, { entries: [APPEND_ENTRY], resumeExpected: true, resolvedUuid: UUID_A });
    mod.appendPending('/ws/other-project', { entries: [OVERRIDE_ENTRY], resumeExpected: true, resolvedUuid: UUID_B });
    assert.equal(mod.consumePendingForResume('/ws/other-project', UUID_B, 'resume').hit.resolvedUuid, UUID_B);
    assert.equal(mod.consumePendingForResume(CWD, UUID_B, 'resume').mismatch, UUID_A, 'cross-cwd pending invisible');
    nowMs += 16 * 60 * 1000;
    const res = mod.consumePendingForResume(CWD, UUID_A, 'resume');
    assert.equal(res, null, 'stale pending purged instead of consumed');
    assert.equal(JSON.parse(readFileSync(join(storeDir(), 'pending.json'), 'utf-8')).pendings.length, 0);
  });

  it('queue is capped at 16 FIFO', () => {
    for (let i = 0; i < 20; i++) mod.appendPending(CWD, { entries: [entry('--system-prompt-file', `b${i}.md`, `c${i}`)] });
    const raw = JSON.parse(readFileSync(join(storeDir(), 'pending.json'), 'utf-8'));
    assert.equal(raw.pendings.length, 16);
    assert.equal(raw.pendings[0].entries[0].basename, 'b4.md', 'oldest four dropped');
  });
});

describe('resolveContinueTargetUuid', () => {
  it('picks the newest-mtime uuid-named transcript', () => {
    makeTranscript(UUID_A, nowMs - 5000);
    makeTranscript(UUID_B, nowMs - 1000);
    makeTranscript(UUID_C, nowMs - 9000);
    writeFileSync(join(transcriptDir(), 'history.jsonl'), '{}\n');
    writeFileSync(join(transcriptDir(), 'agent-ab12cd.jsonl'), '{}\n');
    assert.equal(mod.resolveContinueTargetUuid(CWD), UUID_B);
  });

  it('skips sidechain and teammate transcripts (never claude\'s continue target)', () => {
    makeTranscript(UUID_A, nowMs - 5000);
    makeTranscript(UUID_B, nowMs - 1000, '{"type":"user","isSidechain":true}\n');     // newest but sidechain
    makeTranscript(UUID_C, nowMs - 500, '{"type":"user","teamName":"alpha"}\n');     // newest but teammate
    assert.equal(mod.resolveContinueTargetUuid(CWD), UUID_A);
  });

  it('returns null when the dir is missing or has no uuid transcripts', () => {
    assert.equal(mod.resolveContinueTargetUuid('/ws/never-existed'), null);
    mkdirSync(transcriptDir(), { recursive: true });
    writeFileSync(join(transcriptDir(), 'notes.txt'), 'x');
    assert.equal(mod.resolveContinueTargetUuid(CWD), null);
  });
});

describe('gc', () => {
  it('removes records whose transcript is gone (past the grace window), keeps live ones', () => {
    makeTranscript(UUID_A, nowMs);
    mod.writeSnapshot(CWD, UUID_A, { entries: [APPEND_ENTRY] });
    nowMs += 2 * 60 * 60 * 1000; // past the 1h grace window
    mod.writeSnapshot(CWD, UUID_B, { entries: [APPEND_ENTRY] }); // no transcript for B; createdAt = nowMs (young)
    mod.appendPending(CWD, { entries: [OVERRIDE_ENTRY] });       // gc driver
    assert.notEqual(mod.readSnapshot(CWD, UUID_B), null, 'young record survives the grace window');
    assert.notEqual(mod.readSnapshot(CWD, UUID_A), null);
    nowMs += 2 * 60 * 60 * 1000;
    mod.gc(CWD);
    assert.equal(mod.readSnapshot(CWD, UUID_B), null, 'aged transcript-less record collected');
    assert.notEqual(mod.readSnapshot(CWD, UUID_A), null);
  });

  it('removes records older than 30 days', () => {
    makeTranscript(UUID_A, nowMs);
    mod.writeSnapshot(CWD, UUID_A, { entries: [APPEND_ENTRY] });
    assert.notEqual(mod.readSnapshot(CWD, UUID_A), null);
    nowMs += 31 * 24 * 60 * 60 * 1000;
    mod.gc(CWD);
    assert.equal(mod.readSnapshot(CWD, UUID_A), null);
  });
});
