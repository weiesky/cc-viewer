/**
 * SDK-mode same-cwd SIBLING sessions ("New Workspace (Session)" on the current root), 2026-11.
 *
 * The SDK registry is keyed by instanceKey, so one cwd may host SEVERAL concurrent Sessions.
 * createSdkSession APPENDS a fresh random-keyed
 * generation and marks it freshLaunch — leaving every same-cwd sibling ALIVE (its resident
 * query, sessionId, and instanceKey untouched). The new conversation starts EMPTY (events.js
 * suppresses the same-cwd fallback for a fresh instance); the old sibling's dirs (meta.instance
 * = old key) remain resolvable by their own instanceKey.
 *
 * Fake query via __setQueryForTests (no real SDK child is spawned). Isolated CCV_LOG_DIR.
 * The fake mints its session_id from the query's OWN x-ccv-instance header so each session's
 * conversation is provably attributed to the instance that produced it.
 */
import { describe, it, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { resolve as pathResolve } from 'node:path';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-sdk-forcenew-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;

const sdk = await import('../server/lib/sdk-manager.js');

after(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });
afterEach(() => { sdk.stopSession(); sdk.__setQueryForTests(undefined); });

// The deterministic boot key for a cwd (must mirror _createSession's derivation).
function bootKey(cwd) {
  return `ccv-${createHash('sha256').update(pathResolve(cwd)).digest('hex').slice(0, 32)}`;
}

// Pull the instance out of the launch env's ANTHROPIC_CUSTOM_HEADERS (x-ccv-instance).
function instanceFromEnv(env) {
  const headers = (env && env.ANTHROPIC_CUSTOM_HEADERS) || '';
  const line = headers.split('\n').map((l) => l.trim()).find((l) => /^x-ccv-instance\s*:/i.test(l));
  return line ? line.split(':').slice(1).join(':').trim() : 'noinst';
}

/** Minimal resident fake query: emits an init, then one result per pushed user message.
 * The session_id is derived from the query's own instanceKey so a test can tell WHICH
 * session a query belongs to (no reliance on construction order). */
function makeQuery(record) {
  return ({ prompt, options }) => {
    const inst = instanceFromEnv(options.env);
    record.push({ cwd: options.cwd, env: options.env, model: options.model, permissionMode: options.permissionMode, instanceKey: inst, query: null });
    const sid = `s-${inst}`;
    const q = (async function* () {
      yield { type: 'system', subtype: 'init', session_id: sid, model: options.model || 'm', slash_commands: ['x'] };
      for await (const item of prompt) {
        if (item && item.type === 'user') yield { type: 'result', subtype: 'success', session_id: sid, is_error: false, result: 'ok' };
      }
    })();
    q.close = () => { q._closed = true; };
    q.interrupt = () => Promise.resolve();
    record[record.length - 1].query = q;
    return q;
  };
}
const deps = { broadcastWs() {}, onTurnEnd() {} };
const tick = (n = 8) => new Promise((r) => setTimeout(r, n));
// Poll until `fn()` is truthy (fake query construction/sessionId bind are async).
async function until(fn, tries = 50) {
  for (let i = 0; i < tries; i++) { const v = fn(); if (v) return v; await tick(5); }
  return fn();
}

describe('sdk-manager same-cwd sibling sessions (createSdkSession)', () => {
  it('appends a FRESH random-keyed sibling, keeping the deterministic boot session alive', async () => {
    const record = [];
    sdk.__setQueryForTests(makeQuery(record));
    sdk.initSdkSession('/wa', 'wa', deps);
    await tick();
    const boot = bootKey('/wa');
    assert.equal(sdk.listSdkSessions().find((s) => s.instanceKey === boot)?.cwd, '/wa', 'boot session registered with the deterministic key');

    const r = sdk.createSdkSession('/wa', { permissionMode: 'default' });
    assert.ok(r && r.instanceKey, 'returns the new key');
    assert.notEqual(r.instanceKey, boot, 'the fresh key differs from the deterministic one');
    assert.match(r.instanceKey, /^ccv-[0-9a-f]{32}$/, 'fresh key is a random ccv-<hex>');

    const rows = sdk.listSdkSessions().filter((s) => s.cwd === '/wa');
    assert.equal(rows.length, 2, 'TWO sessions coexist for the cwd (sibling, not a replace)');
    const keys = rows.map((s) => s.instanceKey).sort();
    assert.deepEqual(keys, [boot, r.instanceKey].sort(), 'both the boot and the fresh key are registered');

    const freshRow = rows.find((s) => s.instanceKey === r.instanceKey);
    assert.equal(freshRow.freshLaunch, true, 'the fresh generation is marked');
    assert.equal(freshRow.active, true, 'the fresh generation becomes active');
    const bootRow = rows.find((s) => s.instanceKey === boot);
    assert.equal(bootRow.active, false, 'the boot session is no longer active');
    assert.equal(bootRow.freshLaunch, false, 'the boot session is not a fresh launch');
  });

  it('the old sibling survives a +1: still resolvable, its resident query NOT closed, its sessionId intact', async () => {
    const record = [];
    sdk.__setQueryForTests(makeQuery(record));
    // Pass an env so the boot session's query carries the x-ccv-instance routing header
    // (the fake derives its session_id from it; without env no header is injected).
    sdk.initSdkSession('/wa', 'wa', { ...deps, env: {} });
    await tick();
    const boot = bootKey('/wa');
    // Drive a turn so the boot session owns a sessionId and a live query.
    await sdk.sendUserMessage('hello', { instanceKey: boot });
    // Wait for the fake query to be constructed AND its init frame to bind the sessionId.
    const bootRec = await until(() => record.find((q) => q.instanceKey === boot && q.query));
    const bootSid = await until(() => sdk.getSessionId({ instanceKey: boot }));
    const bootQuery = bootRec && bootRec.query;
    assert.ok(bootQuery, 'boot resident query constructed');
    assert.ok(bootSid, 'boot session has a sessionId before the +1');

    const r = sdk.createSdkSession('/wa', { permissionMode: 'default' });
    await tick();

    // The old key still resolves (NOT dead) — the regression guard against a silent replace.
    const attach = sdk.attachSdkSession({ instanceKey: boot });
    assert.equal(attach.ok, true, 'old boot key remains resolvable after the +1');
    assert.equal(bootQuery._closed, undefined, 'the boot resident query was NOT closed by the +1');
    assert.equal(sdk.getSessionId({ instanceKey: boot }), bootSid, 'the boot session kept its sessionId');

    // The new sibling resolves too, with no sessionId of its own yet.
    const attachNew = sdk.attachSdkSession({ instanceKey: r.instanceKey });
    assert.equal(attachNew.ok, true);
    assert.equal(sdk.getSessionId({ instanceKey: r.instanceKey }), null, 'the fresh sibling has no sessionId (no resume into the old conversation)');
  });

  it('the fresh generation starts with NO session id (next query mints a brand-new conversation)', async () => {
    const record = [];
    sdk.__setQueryForTests(makeQuery(record));
    sdk.initSdkSession('/wa', 'wa', deps);
    await tick();
    await sdk.sendUserMessage('hello', { instanceKey: bootKey('/wa') });
    await tick(20);
    const r = sdk.createSdkSession('/wa', { permissionMode: 'default' });
    assert.equal(sdk.listSdkSessions().find((s) => s.instanceKey === r.instanceKey).freshLaunch, true);
    assert.equal(sdk.getSessionId({ instanceKey: r.instanceKey }), null, 'fresh generation has no session id');
  });

  it('freshLaunch lifts via clearSdkFreshLaunch (writer main-turn bind parity)', () => {
    sdk.__setQueryForTests(makeQuery([]));
    sdk.initSdkSession('/wa', 'wa', deps);
    const r = sdk.createSdkSession('/wa', { permissionMode: 'default' });
    assert.equal(sdk.listSdkSessions().find((s) => s.instanceKey === r.instanceKey).freshLaunch, true);
    sdk.clearSdkFreshLaunch(r.instanceKey);
    assert.equal(sdk.listSdkSessions().find((s) => s.instanceKey === r.instanceKey).freshLaunch, false, 'mark cleared on first session bind');
  });

  it('clearSdkFreshLaunch ignores malformed / unknown keys', () => {
    assert.doesNotThrow(() => sdk.clearSdkFreshLaunch('not-a-key'));
    assert.doesNotThrow(() => sdk.clearSdkFreshLaunch('ccv-' + '0'.repeat(32)));
  });

  it('each +1 mints a distinct fresh key (boot + two +1 = three coexisting sessions)', () => {
    sdk.__setQueryForTests(makeQuery([]));
    sdk.initSdkSession('/wa', 'wa', deps);
    const r1 = sdk.createSdkSession('/wa', { permissionMode: 'default' });
    const r2 = sdk.createSdkSession('/wa', { permissionMode: 'default' });
    assert.notEqual(r1.instanceKey, r2.instanceKey, 'each +1 mints a distinct fresh key');
    const keys = sdk.listSdkSessions().filter((s) => s.cwd === '/wa').map((s) => s.instanceKey);
    assert.equal(keys.length, 3, 'boot + two siblings coexist');
    assert.equal(new Set(keys).size, 3, 'all three keys unique');
    assert.ok(keys.includes(bootKey('/wa')), 'the boot session is still present');
  });

  it('a normal (non-forceNew) launch on the SAME cwd keeps the active sibling (active-first primary, no clobber)', async () => {
    sdk.__setQueryForTests(makeQuery([]));
    sdk.initSdkSession('/wa', 'wa', deps);
    const r = sdk.createSdkSession('/wa', { permissionMode: 'default' }); // becomes active
    // A subsequent ordinary activate/init must resolve to the ACTIVE sibling (the fresh +1),
    // NOT silently revert to the deterministic boot, and must NOT spawn a third session.
    sdk.initSdkSession('/wa', 'wa', deps);
    const rows = sdk.listSdkSessions().filter((s) => s.cwd === '/wa');
    assert.equal(rows.length, 2, 'no third session spawned by a normal relaunch');
    const activeRow = rows.find((s) => s.active);
    assert.equal(activeRow.instanceKey, r.instanceKey, 'normal relaunch keeps the ACTIVE (fresh) sibling active');
    assert.equal(activeRow.freshLaunch, true, 'the active sibling stays the fresh generation');
  });

  it('ANTHROPIC_CUSTOM_HEADERS carries exactly ONE ccv routing pair per session, attributed to its own instance', async () => {
    const record = [];
    sdk.__setQueryForTests(makeQuery(record));
    // Boot with an env that already has an unrelated header.
    const env = { ANTHROPIC_CUSTOM_HEADERS: 'x-unrelated: keep-me' };
    sdk.initSdkSession('/wa', 'wa', { ...deps, env });
    await sdk.sendUserMessage('hi', { instanceKey: bootKey('/wa') });
    await tick(20);
    const r = sdk.createSdkSession('/wa', { permissionMode: 'default', env });
    await sdk.sendUserMessage('hi again', { instanceKey: r.instanceKey });
    await tick(20);
    const last = record[record.length - 1];
    const headers = (last.env && last.env.ANTHROPIC_CUSTOM_HEADERS) || '';
    const instanceLines = headers.split('\n').filter((l) => /^x-ccv-instance\s*:/i.test(l.trim()));
    const projLines = headers.split('\n').filter((l) => /^x-ccv-project-dir\s*:/i.test(l.trim()));
    assert.equal(instanceLines.length, 1, 'exactly one x-ccv-instance line (no stacking)');
    assert.equal(projLines.length, 1, 'exactly one x-ccv-project-dir line');
    assert.ok(headers.includes('x-unrelated: keep-me'), 'unrelated headers preserved');
    // The second query belongs to the NEW sibling — its routing header is the fresh key.
    assert.ok(instanceLines[0].includes(r.instanceKey), 'the +1 query is routed by the fresh instanceKey');
    assert.equal(record.filter((q) => q.instanceKey === r.instanceKey).length, 1, 'the fresh sibling constructed its own query');
  });

  it('a cwd-only anchor is AMBIGUOUS across same-cwd siblings for reads/destructive ops; instanceKey is exact', () => {
    sdk.__setQueryForTests(makeQuery([]));
    sdk.initSdkSession('/wa', 'wa', deps);
    const r = sdk.createSdkSession('/wa', { permissionMode: 'default' });
    // A cwd-only READ stays ambiguous (never guesses).
    assert.equal(sdk.getSessionId({ cwd: '/wa' }), null, 'cwd-only read anchor is ambiguous → null');
    // A cwd-only DESTRUCTIVE op (close) refuses with ambiguity + candidates.
    const closeAttempt = sdk.closeSdkSession({ cwd: '/wa' });
    assert.equal(closeAttempt.ok, false);
    assert.equal(closeAttempt.reason, 'ambiguous', 'cwd-only close across siblings is refused');
    assert.equal(closeAttempt.candidates.length, 2, 'both siblings offered as candidates');
    // instanceKey resolves exactly.
    assert.equal(sdk.attachSdkSession({ instanceKey: bootKey('/wa') }).ok, true, 'instanceKey resolves the boot session');
    assert.equal(sdk.attachSdkSession({ instanceKey: r.instanceKey }).ok, true, 'instanceKey resolves the fresh sibling');
  });

  it('a cwd/project-only ACTION anchor (send) falls back to the cwd primary — Mobile/bound-view parity (never drops the message)', async () => {
    const record = [];
    sdk.__setQueryForTests(makeQuery(record));
    sdk.initSdkSession('/wa', 'wa', { ...deps, env: {} });
    const r = sdk.createSdkSession('/wa', { permissionMode: 'default', env: {} }); // active sibling
    // A send with only the cwd (no instanceKey) must still reach the cwd's PRIMARY (the
    // active sibling here), NOT be dropped — a same-cwd multi-session Mobile/bound client
    // sends without an instanceKey.
    await sdk.sendUserMessage('hello', { cwd: '/wa' });
    const q = await until(() => record.find((x) => x.instanceKey === r.instanceKey && x.query));
    assert.ok(q, 'the message was delivered to the active sibling (not dropped)');
    assert.equal(record.some((x) => x.instanceKey === bootKey('/wa') && x.query), false, 'the boot sibling did not construct a query for it');
  });

  it('closing a fresh sibling returns wasFreshKey:true and leaves the boot session active-targeted', () => {
    sdk.__setQueryForTests(makeQuery([]));
    sdk.initSdkSession('/wa', 'wa', deps);
    const boot = bootKey('/wa');
    const r = sdk.createSdkSession('/wa', { permissionMode: 'default' }); // active
    const res = sdk.closeSdkSession({ instanceKey: r.instanceKey });
    assert.equal(res.ok, true);
    assert.equal(res.wasFreshKey, true, 'the closed fresh sibling was random-keyed');
    assert.equal(res.killedActive, true, 'the closed sibling was active');
    assert.equal(res.reattachedTo, boot, 'the same-cwd boot sibling becomes the survivor');
    const rows = sdk.listSdkSessions().filter((s) => s.cwd === '/wa');
    assert.deepEqual(rows.map((s) => s.instanceKey), [boot], 'only the boot session remains');
    assert.equal(rows[0].active, true, 'the boot session is active again');
  });

  it('closing the deterministic boot session returns wasFreshKey:false (release, never retire)', () => {
    sdk.__setQueryForTests(makeQuery([]));
    sdk.initSdkSession('/wa', 'wa', deps);
    const boot = bootKey('/wa');
    sdk.createSdkSession('/wa', { permissionMode: 'default' }); // active fresh sibling
    const res = sdk.closeSdkSession({ instanceKey: boot });
    assert.equal(res.ok, true);
    assert.equal(res.wasFreshKey, false, 'the deterministic boot key is NOT fresh — it must be released, not retired');
  });

  it('stopSession still tears down every session incl. the +1 siblings', () => {
    sdk.__setQueryForTests(makeQuery([]));
    sdk.initSdkSession('/wa', 'wa', deps);
    sdk.createSdkSession('/wa', { permissionMode: 'default' });
    sdk.stopSession();
    assert.equal(sdk.listSdkSessions().length, 0, 'registry emptied');
  });
});
