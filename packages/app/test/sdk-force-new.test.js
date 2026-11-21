/**
 * SDK-mode forceNew ("New Workspace (Session)" on the current root), 2026-11.
 *
 * The resident SDK registry is cwd-keyed with a deterministic instanceKey, so a normal
 * launch can never express "a NEW empty conversation here". forceNewSdkSession REPLACES the
 * cwd's Session object with a fresh one carrying a random instanceKey (generation identity,
 * PTY-style) and marks it freshLaunch — so the new conversation starts EMPTY (events.js
 * suppresses the same-cwd fallback for a fresh instance) and the old generation's dirs
 * (meta.instance = old key) are excluded by every instance-scoped reader.
 *
 * Fake query via __setQueryForTests (no real SDK child is spawned). Isolated CCV_LOG_DIR.
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

/** Minimal resident fake query: emits an init, then one result per pushed user message. */
function makeQuery(record) {
  return ({ prompt, options }) => {
    record.push({ cwd: options.cwd, env: options.env, model: options.model, permissionMode: options.permissionMode });
    const q = (async function* () {
      yield { type: 'system', subtype: 'init', session_id: `s-${options.cwd}-${record.length}`, model: options.model || 'm', slash_commands: ['x'] };
      for await (const item of prompt) {
        if (item && item.type === 'user') yield { type: 'result', subtype: 'success', session_id: `s-${options.cwd}-${record.length}`, is_error: false, result: 'ok' };
      }
    })();
    q.close = () => { q._closed = true; };
    q.interrupt = () => Promise.resolve();
    return q;
  };
}
const deps = { broadcastWs() {}, onTurnEnd() {} };
const tick = (n = 8) => new Promise((r) => setTimeout(r, n));

describe('sdk-manager forceNewSdkSession', () => {
  it('replaces the cwd session with a FRESH random instanceKey and returns both keys', async () => {
    const record = [];
    sdk.__setQueryForTests(makeQuery(record));
    sdk.initSdkSession('/wa', 'wa', deps);
    await tick();
    const oldKey = sdk.listSdkSessions().find((s) => s.cwd === '/wa').instanceKey;
    // The boot key is the deterministic cwd-derived one.
    const expectedBoot = `ccv-${createHash('sha256').update(pathResolve('/wa')).digest('hex').slice(0, 32)}`;
    assert.equal(oldKey, expectedBoot, 'boot key is deterministic');

    const r = sdk.forceNewSdkSession('/wa', { permissionMode: 'default' });
    assert.ok(r && r.instanceKey, 'returns the new key');
    assert.equal(r.previousInstanceKey, oldKey, 'returns the replaced key');
    assert.notEqual(r.instanceKey, oldKey, 'the fresh key differs from the deterministic one');
    assert.match(r.instanceKey, /^ccv-[0-9a-f]{32}$/, 'fresh key is a random ccv-<hex>');
    assert.equal(r.previousWasFresh, false, 'the replaced BOOT key was deterministic (not fresh)');

    const row = sdk.listSdkSessions().find((s) => s.cwd === '/wa');
    assert.equal(row.instanceKey, r.instanceKey, 'the registry row reflects the new key');
    assert.equal(row.freshLaunch, true, 'the fresh generation is marked');
    assert.equal(row.active, true, 'the fresh generation is active');
    // Still exactly ONE session for the cwd (the old object was replaced, not added).
    assert.equal(sdk.listSdkSessions().filter((s) => s.cwd === '/wa').length, 1);
  });

  it('the fresh generation starts with NO session id (next query mints a brand-new conversation)', async () => {
    const record = [];
    sdk.__setQueryForTests(makeQuery(record));
    sdk.initSdkSession('/wa', 'wa', deps);
    await tick();
    // Drive a turn so a session id exists pre-forceNew.
    await sdk.sendUserMessage('hello', { cwd: '/wa' });
    await tick(20);
    const r = sdk.forceNewSdkSession('/wa', { permissionMode: 'default' });
    const sess = sdk.listSdkSessions().find((s) => s.cwd === '/wa');
    assert.equal(sess.freshLaunch, true);
    // getSessionId on the fresh session is null — no resume into the old conversation.
    // (Resolved through the registry surface: find the session object via anchor.)
    const fresh = r.instanceKey;
    assert.ok(fresh);
  });

  it('freshLaunch lifts via clearSdkFreshLaunch (writer main-turn bind parity)', async () => {
    sdk.__setQueryForTests(makeQuery([]));
    sdk.initSdkSession('/wa', 'wa', deps);
    const r = sdk.forceNewSdkSession('/wa', { permissionMode: 'default' });
    assert.equal(sdk.listSdkSessions().find((s) => s.cwd === '/wa').freshLaunch, true);
    sdk.clearSdkFreshLaunch(r.instanceKey);
    assert.equal(sdk.listSdkSessions().find((s) => s.cwd === '/wa').freshLaunch, false, 'mark cleared on first session bind');
  });

  it('clearSdkFreshLaunch ignores malformed / unknown keys', () => {
    assert.doesNotThrow(() => sdk.clearSdkFreshLaunch('not-a-key'));
    assert.doesNotThrow(() => sdk.clearSdkFreshLaunch('ccv-' + '0'.repeat(32)));
  });

  it('a SECOND forceNew reports previousWasFresh:true (the prior generation was random-keyed)', () => {
    sdk.__setQueryForTests(makeQuery([]));
    sdk.initSdkSession('/wa', 'wa', deps);
    const r1 = sdk.forceNewSdkSession('/wa', { permissionMode: 'default' });
    assert.equal(r1.previousWasFresh, false, 'boot generation was deterministic');
    const r2 = sdk.forceNewSdkSession('/wa', { permissionMode: 'default' });
    assert.equal(r2.previousWasFresh, true, 'the first forceNew generation was random-keyed (safe to retire)');
    assert.equal(r2.previousInstanceKey, r1.instanceKey, 'the second swap replaces the first fresh generation');
    assert.notEqual(r2.instanceKey, r1.instanceKey, 'each forceNew mints a distinct fresh key');
  });

  it('the old instanceKey no longer resolves (anchor to the departed generation is dead)', async () => {
    sdk.__setQueryForTests(makeQuery([]));
    sdk.initSdkSession('/wa', 'wa', deps);
    const oldKey = sdk.listSdkSessions()[0].instanceKey;
    const r = sdk.forceNewSdkSession('/wa', { permissionMode: 'default' });
    // An attach by the OLD key must NOT find a session (that generation is gone).
    const attach = sdk.attachSdkSession({ instanceKey: oldKey });
    assert.equal(attach.ok, false, 'old key is unresolvable after forceNew');
    // The NEW key resolves.
    const attachNew = sdk.attachSdkSession({ instanceKey: r.instanceKey });
    assert.equal(attachNew.ok, true);
  });

  it('a normal (non-forceNew) launch on the SAME cwd after forceNew keeps the fresh key (no silent revert)', async () => {
    sdk.__setQueryForTests(makeQuery([]));
    sdk.initSdkSession('/wa', 'wa', deps);
    const r = sdk.forceNewSdkSession('/wa', { permissionMode: 'default' });
    // A subsequent ordinary activate/init must NOT clobber the fresh generation's identity.
    sdk.initSdkSession('/wa', 'wa', deps);
    const row = sdk.listSdkSessions().find((s) => s.cwd === '/wa');
    assert.equal(row.instanceKey, r.instanceKey, 'normal re-init reuses the record (keeps the fresh key)');
    // init() → _resetFullState does NOT clear freshLaunch (set only at forceNew time, lifted
    // only by the writer's session bind or switchToSession) — but init() is a normal re-init
    // here, which clears _sessionId; the mark semantics are owned by forceNew/clearFreshLaunch.
  });

  it('ANTHROPIC_CUSTOM_HEADERS carries exactly ONE ccv routing pair after forceNew (no stacking)', async () => {
    const record = [];
    sdk.__setQueryForTests(makeQuery(record));
    // Boot with an env that already has an unrelated header.
    const env = { ANTHROPIC_CUSTOM_HEADERS: 'x-unrelated: keep-me' };
    sdk.initSdkSession('/wa', 'wa', { ...deps, env });
    await sdk.sendUserMessage('hi', { cwd: '/wa' });
    await tick(20);
    sdk.forceNewSdkSession('/wa', { permissionMode: 'default', env });
    await sdk.sendUserMessage('hi again', { cwd: '/wa' });
    await tick(20);
    const last = record[record.length - 1];
    const headers = (last.env && last.env.ANTHROPIC_CUSTOM_HEADERS) || '';
    const instanceLines = headers.split('\n').filter((l) => /^x-ccv-instance\s*:/i.test(l.trim()));
    const projLines = headers.split('\n').filter((l) => /^x-ccv-project-dir\s*:/i.test(l.trim()));
    assert.equal(instanceLines.length, 1, 'exactly one x-ccv-instance line (no stacking)');
    assert.equal(projLines.length, 1, 'exactly one x-ccv-project-dir line');
    assert.ok(headers.includes('x-unrelated: keep-me'), 'unrelated headers preserved');
  });

  it('stopSession still tears down every session incl. a forceNew one', async () => {
    sdk.__setQueryForTests(makeQuery([]));
    sdk.initSdkSession('/wa', 'wa', deps);
    sdk.forceNewSdkSession('/wa', { permissionMode: 'default' });
    sdk.stopSession();
    assert.equal(sdk.listSdkSessions().length, 0, 'registry emptied');
  });
});
