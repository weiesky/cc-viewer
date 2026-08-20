/**
 * System-prompt snapshot binding (server/lib/system-prompt-snapshots.js consumers):
 *
 *   Bind A (wire) — V2Writer.ingestRequest: a fresh session's first MAIN request
 *     carries the launch's rendered injection in body.system; content-matching it
 *     against the project's pending queue keys the snapshot to the wire sid
 *     (== transcript uuid for fresh sessions). count_tokens/heartbeat probes and
 *     teammate/sub requests are gated out; adopted (-c) sessions never wire-bind.
 *
 *   Bind B (hook) — interceptor.markSessionStart (source:'resume'): the pending a
 *     resume launch queued at spawn is bound to the RESUMED conversation's
 *     transcript uuid, with the resolvedUuid anti-poison guard (wrong -c target
 *     resolution or a stolen in-terminal /resume hook must not write).
 *
 * Data-safety: CCV_LOG_DIR is locked to a mkdtemp BEFORE any project import;
 * writer-level tests pass an explicit logDir (mkdtemp) throughout.
 */
import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-sp-bind-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';
delete process.env.CCV_CLAUDE_CONTINUE;
delete process.env.CCV_CLAUDE_FORK_SESSION;
delete process.env.CCV_CLAUDE_RESUME;

let V2Writer;
let snaps;
let interceptor;
let _resetForTest;

const SID = 'a9883ab8-0ab7-459a-bcfd-4c8950a14384';
const SID_PREV = 'b1111111-89ab-4cde-8f01-23456789abcd';
const T_UUID = 'dddd4444-89ab-4cde-8f01-23456789abcd';
const CWD = '/x/proj';
const CONTENT = 'PINNED-RENDER-𝛂 git-status-snapshot';
const ENTRY = { flag: '--append-system-prompt-file', basename: 'CC_APPEND_SYSTEM.md', content: CONTENT };

const userIdOf = (sid) => JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: sid });
const textMsg = (role, text) => ({ role, content: [{ type: 'text', text }] });

function mainEntry(messages, { sid = SID, countTokens = false, heartbeat = false, mainAgent = true, systemText = `You are Claude Code. ${CONTENT}` } = {}) {
  return {
    timestamp: '2026-08-20T09:00:00.000Z',
    project: 'proj', url: 'https://api.anthropic.com/v1/messages', method: 'POST', headers: {},
    body: { model: 'm', system: [{ type: 'text', text: systemText }], tools: [{ name: 'Edit' }], metadata: { user_id: userIdOf(sid) }, messages },
    response: null, duration: 0, isStream: false, isHeartbeat: heartbeat, isCountTokens: countTokens,
    mainAgent, requestId: `rid_${Math.random()}`,
  };
}

const recordPath = (logDir, project, uuid) => join(logDir, project, 'system-prompt-snapshots', `${uuid}.json`);
const pendingPath = (logDir, project) => join(logDir, project, 'system-prompt-snapshots', 'pending.json');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf-8'));

before(async () => {
  ({ V2Writer } = await import('../server/lib/v2/v2-writer.js'));
  snaps = await import('../server/lib/system-prompt-snapshots.js');
  interceptor = await import('../server/interceptor.js');
  ({ _resetForTest } = await import('@ccv/core/error-report'));
});

// ─── Bind A (V2Writer.ingestRequest) ────────────────────────────────────────

describe('Bind A: wire content-match on the session\'s first main request', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ccv-sp-bindA-')); _resetForTest(); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  const newWriter = () => new V2Writer({ logDir: dir, project: 'proj', enabled: true, minFreeBytes: 0 });
  const fire = (w, entry) => w.ingestRequest(entry, entry.body.messages);

  it('binds a content-matching pending to the wire sid and consumes it', async () => {
    snaps.appendPending(CWD, { entries: [ENTRY], model: 'k3' }, dir);
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'hi')]));
    await w.flush(); await w.close();
    const rec = readJson(recordPath(dir, 'proj', SID));
    assert.deepEqual(rec.entries, [ENTRY]);
    assert.equal(rec.model, 'k3');
    assert.equal(rec.boundVia, 'wire');
    assert.equal(readJson(pendingPath(dir, 'proj')).pendings.length, 0, 'pending consumed');
  });

  it('count_tokens/heartbeat probes neither bind nor consume the first-main flag', async () => {
    snaps.appendPending(CWD, { entries: [ENTRY] }, dir);
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'probe')], { countTokens: true }));
    fire(w, mainEntry([textMsg('user', 'probe2')], { heartbeat: true }));
    assert.equal(existsSync(recordPath(dir, 'proj', SID)), false, 'probes must not bind');
    fire(w, mainEntry([textMsg('user', 'real turn')]));
    await w.flush(); await w.close();
    assert.ok(existsSync(recordPath(dir, 'proj', SID)), 'the first REAL main request still binds');
  });

  it('teammate / non-main requests never bind', async () => {
    snaps.appendPending(CWD, { entries: [ENTRY] }, dir);
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'team turn')], { mainAgent: false }));
    await w.flush(); await w.close();
    assert.equal(existsSync(recordPath(dir, 'proj', SID)), false);
    assert.equal(readJson(pendingPath(dir, 'proj')).pendings.length, 1, 'pending untouched');
  });

  it('no content match → no bind; resumeExpected pendings are invisible to the wire', async () => {
    snaps.appendPending(CWD, { entries: [ENTRY] }, dir);
    snaps.appendPending(CWD, { entries: [ENTRY], resumeExpected: true, resolvedUuid: T_UUID }, dir);
    const w = newWriter();
    fire(w, mainEntry([textMsg('user', 'hi')], { systemText: 'You are Claude Code. default only' }));
    await w.flush(); await w.close();
    assert.equal(existsSync(recordPath(dir, 'proj', SID)), false);
    assert.equal(readJson(pendingPath(dir, 'proj')).pendings.length, 2, 'both pendings stay queued');
  });

  it('adopted (-c) sessions skip the wire bind even on a content match', async () => {
    // Seed a previous main session dir for adoption to target.
    const seed = newWriter();
    fire(seed, mainEntry([textMsg('user', 'old turn')], { sid: SID_PREV, systemText: 'default' }));
    await seed.flush(); await seed.close();

    snaps.appendPending(CWD, { entries: [ENTRY] }, dir);
    const w = newWriter();
    w.setContinuationMode({ continued: true, fork: false, resume: false });
    // Fresh wire sid + replayed assistant history → adoption fires.
    const msgs = [textMsg('user', 'old turn'), textMsg('assistant', 'old answer'), textMsg('user', 'continued')];
    fire(w, mainEntry(msgs, { sid: SID }));
    await w.flush(); await w.close();
    assert.equal(existsSync(recordPath(dir, 'proj', SID)), false, 'adopted sessions never wire-bind');
    assert.equal(readJson(pendingPath(dir, 'proj')).pendings.length, 1, 'pending survives for its rightful owner');
  });
});

// ─── Bind B (interceptor.markSessionStart) ──────────────────────────────────

describe('Bind B: SessionStart resume/fork hook binds the launch pending', () => {
  const store = () => join(tmpDir, 'projHook', 'system-prompt-snapshots');
  const CWD_HOOK = '/Users/x/work/projHook';
  let fakeProjects;

  beforeEach(() => {
    _resetForTest();
    interceptor.initForWorkspace(join(tmpDir, 'ws', 'projHook'));
    rmSync(store(), { recursive: true, force: true });
    // gc (triggered by appendPending) drops aged records whose transcript is gone —
    // the resumed conversation's transcript must exist, under a fake projects dir.
    fakeProjects = mkdtempSync(join(tmpdir(), 'ccv-sp-bindB-proj-'));
    process.env.CCV_PROJECTS_DIR = fakeProjects;
    const tDir = join(fakeProjects, CWD_HOOK.replace(/[^A-Za-z0-9]/g, '-'));
    mkdirSync(tDir, { recursive: true });
    writeFileSync(join(tDir, `${T_UUID}.jsonl`), '{"type":"summary"}\n');
  });

  afterEach(() => {
    delete process.env.CCV_PROJECTS_DIR;
    rmSync(fakeProjects, { recursive: true, force: true });
  });

  const hook = (source, transcriptUuid = T_UUID) => interceptor.markSessionStart({
    source,
    sessionId: 'eeee5555-89ab-4cde-8f01-23456789abcd',
    transcriptPath: `/Users/x/.claude/projects/p/${transcriptUuid}.jsonl`,
    cwd: CWD_HOOK,
  });

  it('resume hook with matching resolvedUuid → snapshot written with boundVia:hook, pending consumed', () => {
    snaps.appendPending(CWD_HOOK, { entries: [ENTRY], model: 'glm', resumeExpected: true, resolvedUuid: T_UUID });
    hook('resume');
    const rec = readJson(join(store(), `${T_UUID}.json`));
    assert.deepEqual(rec.entries, [ENTRY]);
    assert.equal(rec.model, 'glm');
    assert.equal(rec.boundVia, 'hook');
    assert.equal(readJson(join(store(), 'pending.json')).pendings.length, 0);
  });

  it('empty-entries pendings are consumed but NEVER persisted (no mislabeling surface)', () => {
    snaps.appendPending(CWD_HOOK, { entries: [], resumeExpected: true, resolvedUuid: T_UUID });
    hook('resume');
    assert.equal(existsSync(join(store(), `${T_UUID}.json`)), false, 'empty records are refused by writeSnapshot');
    assert.equal(readJson(join(store(), 'pending.json')).pendings.length, 0, 'pending consumed');
  });

  it('resolvedUuid mismatch (wrong -c resolution / stolen hook) → refused, warned, queue INTACT', () => {
    snaps.appendPending(CWD_HOOK, { entries: [ENTRY], resumeExpected: true, resolvedUuid: SID_PREV });
    const origWarn = console.warn; let warned = '';
    console.warn = (...a) => { warned += a.join(' '); };
    try { hook('resume'); } finally { console.warn = origWarn; }
    assert.equal(existsSync(join(store(), `${T_UUID}.json`)), false, 'innocent conversation must not be poisoned');
    assert.match(warned, /target mismatch/);
    const pendings = readJson(join(store(), 'pending.json')).pendings;
    assert.equal(pendings.length, 1, 'the rightful launch\'s pending survives for its own hook');
    assert.equal(pendings[0].resolvedUuid, SID_PREV);
  });

  it('fork hook (source:fork) binds the fork pending to the fork\'s NEW transcript uuid', () => {
    snaps.appendPending(CWD_HOOK, { entries: [ENTRY], resumeExpected: true, resolvedUuid: SID_PREV, fork: true });
    hook('fork', T_UUID);
    const rec = readJson(join(store(), `${T_UUID}.json`));
    assert.deepEqual(rec.entries, [ENTRY]);
    assert.equal(rec.boundVia, 'hook');
  });

  it('a fork hook does NOT consume a plain resume pending (and vice versa)', () => {
    snaps.appendPending(CWD_HOOK, { entries: [ENTRY], resumeExpected: true, resolvedUuid: T_UUID });
    hook('fork', T_UUID); // fork hook, but the pending is a plain resume one
    assert.equal(existsSync(join(store(), `${T_UUID}.json`)), false);
    assert.equal(readJson(join(store(), 'pending.json')).pendings.length, 1);
  });

  it('an existing different record is kept (first bind wins)', () => {
    snaps.writeSnapshot(CWD_HOOK, T_UUID, { entries: [{ ...ENTRY, content: 'ORIGINAL' }], boundVia: 'wire' });
    snaps.appendPending(CWD_HOOK, { entries: [ENTRY], resumeExpected: true, resolvedUuid: T_UUID });
    const origWarn = console.warn;
    console.warn = () => {};
    try { hook('resume'); } finally { console.warn = origWarn; }
    assert.equal(readJson(join(store(), `${T_UUID}.json`)).entries[0].content, 'ORIGINAL', 'skipIfPresent keeps the original');
  });

  it('non-resume/non-fork sources never consume the pending', () => {
    snaps.appendPending(CWD_HOOK, { entries: [ENTRY], resumeExpected: true, resolvedUuid: T_UUID });
    for (const source of ['startup', 'clear', 'compact']) {
      interceptor.markSessionStart({ source, transcriptPath: `/t/${T_UUID}.jsonl`, cwd: CWD_HOOK });
    }
    assert.equal(existsSync(join(store(), `${T_UUID}.json`)), false);
    assert.equal(readJson(join(store(), 'pending.json')).pendings.length, 1);
  });
});
