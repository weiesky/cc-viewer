import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ████ Data-safety isolation — do NOT revert to static imports (2026-06-06 incident) ████
// Project modules derive paths from env at load time; ESM static imports hoist above any env
// assignment. Pattern: ① static-import only node builtins, ② set env in the isolation block,
// ③ top-level await import of project modules. json-store is path-injected (no LOG_DIR), but
// we still redirect CCV_LOG_DIR so nothing in the import graph can touch the real ~/.claude.
const __isoDir = mkdtempSync(join(tmpdir(), 'ccv-jsonstore-'));
process.env.CCV_LOG_DIR = __isoDir;
process.env.CLAUDE_CONFIG_DIR = __isoDir;

const {
  readJsonSafe, writeJsonAtomic, mutateJson, mutateJsonSync, applyJsonPatch, lockPathFor,
} = await import('../server/lib/json-store.js');

let workDir;
function freshFile(name = 'store.json') { return join(workDir, name); }
function tmpStrays() {
  try { return readdirSync(workDir).filter(x => x.includes('.tmp-')); } catch { return []; }
}

describe('json-store kernel', () => {
  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'ccv-js-case-'));
  });
  after(() => {
    try { rmSync(__isoDir, { recursive: true, force: true }); } catch {}
  });

  it('lockPathFor derives the lock from the file name (no fixed-basename collision)', () => {
    assert.equal(lockPathFor('/a/b/preferences.json'), '/a/b/preferences.json.lock');
    assert.equal(lockPathFor('/a/b/workspaces.json'), '/a/b/workspaces.json.lock');
    assert.notEqual(lockPathFor('/a/b/preferences.json'), lockPathFor('/a/b/workspaces.json'));
  });

  it('readJsonSafe returns fallback on missing file', () => {
    assert.deepEqual(readJsonSafe(freshFile('nope.json')), {});
    assert.deepEqual(readJsonSafe(freshFile('nope.json'), []), []);
  });

  it('readJsonSafe returns fallback on corrupt JSON', () => {
    const f = freshFile();
    writeFileSync(f, '{not json', 'utf-8');
    assert.deepEqual(readJsonSafe(f), {});
  });

  it('readJsonSafe rejects a scalar/array when fallback is a plain object', () => {
    const f = freshFile();
    writeFileSync(f, '[1,2,3]', 'utf-8');
    assert.deepEqual(readJsonSafe(f, {}), {});
    writeFileSync(f, '42', 'utf-8');
    assert.deepEqual(readJsonSafe(f, {}), {});
  });

  it('writeJsonAtomic writes and defaults to 0600, leaving no tmp strays', () => {
    const f = freshFile();
    writeJsonAtomic(f, { a: 1 });
    assert.deepEqual(JSON.parse(readFileSync(f, 'utf-8')), { a: 1 });
    if (process.platform !== 'win32') {
      assert.equal(statSync(f).mode & 0o777, 0o600);
    }
    assert.deepEqual(tmpStrays(), []);
  });

  it('writeJsonAtomic mode:false skips the permission bit', () => {
    const f = freshFile();
    writeJsonAtomic(f, { a: 1 }, { mode: false });
    assert.deepEqual(JSON.parse(readFileSync(f, 'utf-8')), { a: 1 });
  });

  it('mutateJson reads-modifies-writes and returns the mutated object', async () => {
    const f = freshFile();
    writeJsonAtomic(f, { count: 1 });
    const out = await mutateJson(f, (d) => { d.count += 1; });
    assert.equal(out.count, 2);
    assert.deepEqual(JSON.parse(readFileSync(f, 'utf-8')), { count: 2 });
  });

  it('mutateJson returns the mutator return value when defined', async () => {
    const f = freshFile();
    const r = await mutateJson(f, (d) => { d.x = 1; return 'custom'; });
    assert.equal(r, 'custom');
  });

  it('mutateJson seeds from fallback when the file is absent', async () => {
    const f = freshFile();
    await mutateJson(f, (d) => { d.created = true; }, { fallback: {} });
    assert.deepEqual(JSON.parse(readFileSync(f, 'utf-8')), { created: true });
  });

  it('mutateJsonSync writes synchronously and releases the lock afterwards', () => {
    const f = freshFile();
    const out = mutateJsonSync(f, (d) => { d.v = (d.v || 0) + 1; });
    assert.equal(out.v, 1);
    mutateJsonSync(f, (d) => { d.v += 1; });
    assert.deepEqual(JSON.parse(readFileSync(f, 'utf-8')), { v: 2 });
    assert.equal(existsSync(lockPathFor(f)), false);
  });

  it('mutateJsonSync defaults to 0600', () => {
    const f = freshFile();
    mutateJsonSync(f, (d) => { d.s = 'secret'; });
    if (process.platform !== 'win32') {
      assert.equal(statSync(f).mode & 0o777, 0o600);
    }
  });

  it('mutateJsonSync does NOT steal a lock held by an in-flight async mutateJson', async () => {
    const f = freshFile();
    writeJsonAtomic(f, { n: 0 });
    // Drive an async mutation that holds the disk lock across an await. While it is mid-flight,
    // the async flavor registers a live disk holder; a sync caller must NOT judge that own-pid
    // lock "stale" and steal it (the pre-fix lost-update). We assert the *exclusion* via the
    // exported probe: while the async critical section runs, hasLiveDiskHolder is true.
    const { hasLiveDiskHolder } = await import('../server/lib/async-file-lock.js');
    const lockPath = lockPathFor(f);
    let insideAsync;
    await mutateJson(f, async (d) => {
      insideAsync = hasLiveDiskHolder(lockPath);
      d.n = 1;
    });
    assert.equal(insideAsync, true, 'async holder must register a live disk holder mid-critical-section');
    // after completion the holder is released and a sync write proceeds normally
    mutateJsonSync(f, (d) => { d.n = 2; });
    assert.equal(JSON.parse(readFileSync(f, 'utf-8')).n, 2);
  });

  it('mutateJsonSync degrades to an unlocked write (no crash) when the lock is held by a foreign live process', () => {
    const f = freshFile();
    writeJsonAtomic(f, { n: 0 });
    // Simulate a live FOREIGN process holding the lock: write a lock file with a live pid that is
    // not ours and not stale. A high existing pid (init/launchd, pid 1) is alive on POSIX.
    const lockPath = lockPathFor(f);
    writeFileSync(lockPath, JSON.stringify({ pid: 1, ts: Date.now() }));
    const out = mutateJsonSync(f, (d) => { d.n = 99; }, { deadline: 60 });
    assert.equal(out.n, 99, 'write still lands (degraded) instead of throwing');
    assert.equal(JSON.parse(readFileSync(f, 'utf-8')).n, 99);
    try { rmSync(lockPath, { force: true }); } catch {}
  });

  it('mutateJsonSync with strict:true throws on a foreign-held lock (opt-in)', () => {
    const f = freshFile();
    writeJsonAtomic(f, { n: 0 });
    const lockPath = lockPathFor(f);
    writeFileSync(lockPath, JSON.stringify({ pid: 1, ts: Date.now() }));
    assert.throws(() => mutateJsonSync(f, (d) => { d.n = 1; }, { deadline: 60, strict: true }), /Lock acquisition timeout/);
    try { rmSync(lockPath, { force: true }); } catch {}
  });

  it('concurrent mutateJson calls serialize (no lost update)', async () => {
    const f = freshFile();
    writeJsonAtomic(f, { n: 0 });
    const N = 25;
    await Promise.all(Array.from({ length: N }, () => mutateJson(f, (d) => { d.n += 1; })));
    assert.deepEqual(JSON.parse(readFileSync(f, 'utf-8')), { n: N });
  });

  it('applyJsonPatch shallow-merges and ignores non-object patches', () => {
    const t = { a: 1, b: 2 };
    applyJsonPatch(t, { b: 3, c: 4 });
    assert.deepEqual(t, { a: 1, b: 3, c: 4 });
    const t2 = { a: 1 };
    assert.deepEqual(applyJsonPatch(t2, null), { a: 1 });
    assert.deepEqual(applyJsonPatch(t2, 'x'), { a: 1 });
  });

  it('mutateJsonSync is TOLERANT of a corrupt file by default (self-heals from the fallback, the L66 behavior)', () => {
    const f = freshFile();
    writeFileSync(f, '{ broken existing json', 'utf-8'); // corrupt
    // default (no strictCorrupt): collapse to the fallback and write — a corrupt preferences.json
    // stays self-healing (a re-save recovers it), matching the long-standing route behavior.
    mutateJsonSync(f, (d) => { d.theme = 'amoled'; }, { fallback: {} });
    assert.deepEqual(JSON.parse(readFileSync(f, 'utf-8')), { theme: 'amoled' });
  });

  it('mutateJsonSync with strictCorrupt:true refuses to overwrite a present-but-corrupt file', () => {
    const f = freshFile();
    writeFileSync(f, '{ "profiles": [truncated', 'utf-8'); // corrupt
    assert.throws(() => mutateJsonSync(f, (d) => { d.x = 1; }, { strictCorrupt: true }), /refusing to overwrite corrupt/);
    // the original (corrupt) bytes are preserved, not clobbered with the fallback
    assert.equal(readFileSync(f, 'utf-8'), '{ "profiles": [truncated');
  });

  it('mutateJsonSync still seeds a genuinely-absent file', () => {
    const f = freshFile();
    mutateJsonSync(f, (d) => { d.created = true; }, { fallback: {} });
    assert.deepEqual(JSON.parse(readFileSync(f, 'utf-8')), { created: true });
  });

  it('mutateJson is TOLERANT by default and STRICT with strictCorrupt:true', async () => {
    const f1 = freshFile('a.json');
    writeFileSync(f1, '[1,2,3', 'utf-8');
    await mutateJson(f1, (d) => { d.x = 1; }, { fallback: {} }); // tolerant
    assert.deepEqual(JSON.parse(readFileSync(f1, 'utf-8')), { x: 1 });
    const f2 = freshFile('b.json');
    writeFileSync(f2, '[1,2,3', 'utf-8');
    await assert.rejects(mutateJson(f2, (d) => { d.x = 1; }, { strictCorrupt: true }), /refusing to overwrite corrupt/);
    assert.equal(readFileSync(f2, 'utf-8'), '[1,2,3');
  });
});
