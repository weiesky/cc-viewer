/**
 * lib/view-root.js — resolveViewRoot (multi-project, 2026-10).
 * Pure/DI seams: loadWorkspaces / listLivePtys injected; fs touched only via
 * real dirs created in a tmp dir.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-view-root-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;

const { resolveViewRoot } = await import('../server/lib/view-root.js');
const { projectKeyForCwd } = await import('../server/lib/system-prompt-snapshots.js');

const projADir = join(tmpDir, 'projA');
const projBDir = join(tmpDir, 'projB');
mkdirSync(projADir, { recursive: true });
mkdirSync(projBDir, { recursive: true });
const nameA = projectKeyForCwd(projADir);
const nameB = projectKeyForCwd(projBDir);
const boundDir = join(tmpDir, 'bound');
mkdirSync(boundDir, { recursive: true });

after(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

const noRegistry = () => [];
const noLive = () => [];

describe('resolveViewRoot', () => {
  it('no override → bound (byte-identical to pre-multi-project)', () => {
    const r = resolveViewRoot({ boundCwd: boundDir, loadWorkspaces: noRegistry, listLivePtys: noLive });
    assert.deepEqual(r, { ok: true, root: boundDir, via: 'bound' });
  });

  it('bound project by name → bound root', () => {
    const r = resolveViewRoot({ projectParam: projectKeyForCwd(boundDir), boundCwd: boundDir, loadWorkspaces: noRegistry, listLivePtys: noLive });
    assert.equal(r.ok, true);
    assert.equal(r.root, realpathSync(boundDir)); // single-candidate path is realpath'd (macOS /var→/private/var)
    assert.equal(r.via, 'bound');
  });

  it('bound name + a DIFFERENT live same-name PTY → live wins over bound (no silent bound pick)', () => {
    // bound /…/projA bound; a parallel project also named projA is live at
    // another dir. The parallel tab's ?project=projA must resolve to the
    // RUNNING parallel dir, not silently to bound.
    const otherA = join(tmpDir, 'other', 'projA');
    mkdirSync(otherA, { recursive: true });
    const r = resolveViewRoot({
      projectParam: nameA, boundCwd: boundDir,
      loadWorkspaces: noRegistry,
      listLivePtys: () => [{ cwd: otherA }],
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.via, 'live');
  });

  it('bound name + bound itself live → still the bound dir (via live)', () => {
    const r = resolveViewRoot({
      projectParam: projectKeyForCwd(boundDir), boundCwd: boundDir,
      loadWorkspaces: noRegistry,
      listLivePtys: () => [{ cwd: boundDir }],
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.root, realpathSync(boundDir)); // macOS /var→/private/var realpath
  });

  it('bound name + a real same-name registry residue (no live PTY) → 400, never silently bound', () => {
    const otherA = join(tmpDir, 'other', 'projA');
    mkdirSync(otherA, { recursive: true });
    // bound dir is itself named projA here: use a bound dir under the same name
    const boundA = join(tmpDir, 'boundA', 'projA');
    mkdirSync(boundA, { recursive: true });
    const r = resolveViewRoot({
      projectParam: nameA, boundCwd: boundA,
      loadWorkspaces: () => [{ path: otherA, projectName: nameA }],
      listLivePtys: noLive,
    });
    assert.deepEqual(r, { ok: false, status: 400, error: 'ambiguous project name' });
  });

  it('registry hit (project with no live PTY)', () => {
    const r = resolveViewRoot({
      projectParam: nameA, boundCwd: boundDir,
      loadWorkspaces: () => [{ path: projADir, projectName: nameA }],
      listLivePtys: noLive,
    });
    assert.equal(r.ok, true);
    assert.equal(r.via, 'registry');
    assert.equal(typeof r.root, 'string');
  });

  it('live PTY hit when registry is empty', () => {
    const r = resolveViewRoot({
      projectParam: nameB, boundCwd: boundDir,
      loadWorkspaces: noRegistry,
      listLivePtys: () => [{ cwd: projBDir }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.via, 'live');
  });

  it('live + registry same path dedupes to one candidate', () => {
    const r = resolveViewRoot({
      projectParam: nameA, boundCwd: boundDir,
      loadWorkspaces: () => [{ path: projADir, projectName: nameA }],
      listLivePtys: () => [{ cwd: projADir }],
    });
    assert.equal(r.ok, true, `same project from both sources must not be ambiguous: ${JSON.stringify(r)}`);
  });

  it('unknown project → 404', () => {
    const r = resolveViewRoot({ projectParam: 'ghost-proj', boundCwd: boundDir, loadWorkspaces: noRegistry, listLivePtys: noLive });
    assert.deepEqual(r, { ok: false, status: 404, error: 'unknown project' });
  });

  it('ambiguous name, no live PTY, both dirs real → 400, never silently wrong', () => {
    const otherA = join(tmpDir, 'other', 'projA'); // same basename 'projA'
    mkdirSync(otherA, { recursive: true });
    const r = resolveViewRoot({
      projectParam: nameA, boundCwd: boundDir,
      loadWorkspaces: () => [{ path: projADir, projectName: nameA }, { path: otherA, projectName: nameA }],
      listLivePtys: noLive,
    });
    assert.deepEqual(r, { ok: false, status: 400, error: 'ambiguous project name' });
  });

  it('ambiguous name but exactly one live PTY → live wins (attach = the running project)', () => {
    const otherA = join(tmpDir, 'other', 'projA');
    mkdirSync(otherA, { recursive: true });
    const r = resolveViewRoot({
      projectParam: nameA, boundCwd: boundDir,
      loadWorkspaces: () => [{ path: projADir, projectName: nameA }, { path: otherA, projectName: nameA }],
      listLivePtys: () => [{ cwd: projADir }],
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.via, 'live');
    assert.equal(typeof r.root, 'string');
  });

  it('ambiguous name with a dead registry path → survivor wins without a live PTY', () => {
    const goneA = join(tmpDir, 'gone', 'projA'); // never created on disk
    const r = resolveViewRoot({
      projectParam: nameA, boundCwd: boundDir,
      loadWorkspaces: () => [{ path: projADir, projectName: nameA }, { path: goneA, projectName: nameA }],
      listLivePtys: noLive,
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.via, 'registry');
  });

  it('ambiguous name with two live PTYs in different dirs → 400 (no authoritative tiebreak)', () => {
    const otherA = join(tmpDir, 'other', 'projA');
    mkdirSync(otherA, { recursive: true });
    const r = resolveViewRoot({
      projectParam: nameA, boundCwd: boundDir,
      loadWorkspaces: noRegistry,
      listLivePtys: () => [{ cwd: projADir }, { cwd: otherA }],
    });
    assert.deepEqual(r, { ok: false, status: 400, error: 'ambiguous project name' });
  });

  it('single live PTY whose dir is unreadable → 404, never falls back to a same-name registry dir', () => {
    // The live record is authoritative: when its dir is gone we must NOT fall
    // back to a different same-name registry dir — that is exactly the silent
    // wrong-project pick this resolver exists to prevent.
    const goneLive = join(tmpDir, 'gone-live', 'projA'); // never created
    const otherA = join(tmpDir, 'other', 'projA');
    mkdirSync(otherA, { recursive: true });
    const r = resolveViewRoot({
      projectParam: nameA, boundCwd: boundDir,
      loadWorkspaces: () => [{ path: otherA, projectName: nameA }],
      listLivePtys: () => [{ cwd: goneLive }],
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 404);
  });

  it('all registry candidates dead, no live PTY → 404 unknown project', () => {
    const gone1 = join(tmpDir, 'gone-1', 'projA');
    const gone2 = join(tmpDir, 'gone-2', 'projA'); // neither created
    const r = resolveViewRoot({
      projectParam: nameA, boundCwd: boundDir,
      loadWorkspaces: () => [{ path: gone1, projectName: nameA }, { path: gone2, projectName: nameA }],
      listLivePtys: noLive,
    });
    assert.deepEqual(r, { ok: false, status: 404, error: 'unknown project' });
  });

  it('path-traversal / separator names → 400 (never a lookup)', () => {
    for (const bad of ['../etc', 'a/b', 'a\\b', 'a..b/c', 'x\0y']) {
      const r = resolveViewRoot({ projectParam: bad, boundCwd: boundDir, loadWorkspaces: noRegistry, listLivePtys: noLive });
      assert.equal(r.ok, false, bad);
      assert.equal(r.status, 400, bad);
    }
  });

  it('interior-dot names (foo..bar, v2.3) are legal — only all-dot degenerates collapse', () => {
    // The sanitizer preserves interior dots; such a name must round-trip, not 400.
    const dotDir = join(tmpDir, 'foo..bar');
    mkdirSync(dotDir, { recursive: true });
    const r = resolveViewRoot({
      projectParam: 'foo..bar', boundCwd: boundDir,
      loadWorkspaces: () => [{ path: dotDir, projectName: 'foo..bar' }],
      listLivePtys: noLive,
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.via, 'registry');
  });

  it('registry/live seams throwing → treated as empty, unknown → 404', () => {
    const r = resolveViewRoot({
      projectParam: nameA, boundCwd: boundDir,
      loadWorkspaces: () => { throw new Error('boom'); },
      listLivePtys: () => { throw new Error('boom'); },
    });
    assert.deepEqual(r, { ok: false, status: 404, error: 'unknown project' });
  });

  it('resolved-but-missing dir → 404', () => {
    const ghostDir = join(tmpDir, 'gone');
    const r = resolveViewRoot({
      projectParam: projectKeyForCwd(ghostDir), boundCwd: boundDir,
      loadWorkspaces: () => [{ path: ghostDir, projectName: projectKeyForCwd(ghostDir) }],
      listLivePtys: noLive,
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 404);
  });

  it('instanceParam resolves the exact dir among two same-basename live PTYs (bypasses name 400)', () => {
    // The whole point: two dirs both named projA are live; the name path alone 400s,
    // but a valid instanceKey pins the exact process/cwd.
    const otherA = join(tmpDir, 'inst', 'projA');
    mkdirSync(otherA, { recursive: true });
    const r = resolveViewRoot({
      projectParam: nameA, instanceParam: 'ccv-bbb222', boundCwd: boundDir,
      loadWorkspaces: noRegistry,
      listLivePtys: () => [
        { cwd: projADir, instanceKey: 'ccv-aaa111' },
        { cwd: otherA, instanceKey: 'ccv-bbb222' },
      ],
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.root, realpathSync(otherA));
    assert.equal(r.via, 'live-instance');
  });

  it('instanceParam alone (no projectParam) still resolves via live-instance', () => {
    const otherA = join(tmpDir, 'inst', 'projA');
    const r = resolveViewRoot({
      instanceParam: 'ccv-bbb222', boundCwd: boundDir,
      loadWorkspaces: noRegistry,
      listLivePtys: () => [{ cwd: otherA, instanceKey: 'ccv-bbb222' }],
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.root, realpathSync(otherA));
    assert.equal(r.via, 'live-instance');
  });

  it('unknown instanceParam falls back to the name path (single live → wins, NOT 400)', () => {
    // Stale/closed instance: degrade to name arbitration, which a single surviving
    // same-name live PTY wins.
    const r = resolveViewRoot({
      projectParam: nameA, instanceParam: 'ccv-dead99', boundCwd: boundDir,
      loadWorkspaces: noRegistry,
      listLivePtys: () => [{ cwd: projADir, instanceKey: 'ccv-aaa111' }],
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.root, realpathSync(projADir));
    assert.equal(r.via, 'live');
  });

  it('unknown instanceParam + ambiguous name still 400s (degrades to name behavior)', () => {
    const otherA = join(tmpDir, 'inst', 'projA');
    const r = resolveViewRoot({
      projectParam: nameA, instanceParam: 'ccv-dead99', boundCwd: boundDir,
      loadWorkspaces: noRegistry,
      listLivePtys: () => [{ cwd: projADir, instanceKey: 'ccv-aaa111' }, { cwd: otherA, instanceKey: 'ccv-bbb222' }],
    });
    assert.deepEqual(r, { ok: false, status: 400, error: 'ambiguous project name' });
  });

  it('invalid instanceParam (not ccv-hex) is ignored → name path', () => {
    for (const bad of ['not-a-key', 'ccv-UPPER', 'ccv-12 34', '../ccv-aaa111']) {
      const r = resolveViewRoot({
        projectParam: nameA, instanceParam: bad, boundCwd: boundDir,
        loadWorkspaces: noRegistry,
        listLivePtys: () => [{ cwd: projADir, instanceKey: 'ccv-aaa111' }],
      });
      assert.equal(r.ok, true, bad);
      assert.equal(r.via, 'live', bad); // fell through to the name path, not live-instance
    }
  });

  it('instanceParam hit whose dir vanished falls through without crashing, name path arbitrates', () => {
    // The vanished instance's live record is STILL in the map (listLivePtys only skips
    // records with no process, not gone dirs), so the name path sees both lives → the
    // pre-existing 400. The point: the instance branch itself must not throw/400 — it
    // degrades to whatever the name path does.
    const goneInst = join(tmpDir, 'gone-inst', 'projA'); // never created
    const r = resolveViewRoot({
      projectParam: nameA, instanceParam: 'ccv-gone11', boundCwd: boundDir,
      loadWorkspaces: noRegistry,
      listLivePtys: () => [{ cwd: goneInst, instanceKey: 'ccv-gone11' }, { cwd: projADir, instanceKey: 'ccv-aaa111' }],
    });
    assert.deepEqual(r, { ok: false, status: 400, error: 'ambiguous project name' });
  });

  it('instanceParam whose record is gone entirely (closed) falls back, single remaining live wins', () => {
    // The stale instanceKey is not in the map at all → name path runs; the ONE surviving
    // same-name live PTY wins arbitration (no 400).
    const r = resolveViewRoot({
      projectParam: nameA, instanceParam: 'ccv-dead77', boundCwd: boundDir,
      loadWorkspaces: noRegistry,
      listLivePtys: () => [{ cwd: projADir, instanceKey: 'ccv-aaa111' }],
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.root, realpathSync(projADir));
    assert.equal(r.via, 'live');
  });
});
