/**
 * Per-session proxy binding registry (instanceKey → { main, roles }) — pure module
 * tests, plus the resolveSessionMainProfile / resolveSessionRoleProfile pure
 * functions from interceptor-core.js.
 *
 * Env must be set BEFORE the dynamic imports (LOG_DIR is read at module load).
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REGISTRY = join(REPO_ROOT, 'packages', 'app', 'server', 'lib', 'proxy-session-registry.js');
const CORE = join(REPO_ROOT, 'packages', 'app', 'server', 'lib', 'interceptor-core.js');

const __isoDir = mkdtempSync(join(tmpdir(), 'ccv-preg-'));
process.env.CCV_LOG_DIR = __isoDir;
process.env.CLAUDE_CONFIG_DIR = __isoDir;

const KEY_A = 'ccv-aaaa1111';
const KEY_B = 'ccv-bbbb2222';

let reg;
let core;

before(async () => {
  reg = await import(REGISTRY);
  core = await import(CORE);
});
after(() => { rmSync(__isoDir, { recursive: true, force: true }); });
beforeEach(() => { reg.__resetSessionProxyProfilesForTests(); });

describe('proxy-session-registry', () => {
  it('validates instance keys', () => {
    assert.equal(reg.isValidInstanceKey('ccv-abc123'), true);
    assert.equal(reg.isValidInstanceKey('ccv-ABC'), false);
    assert.equal(reg.isValidInstanceKey('nope'), false);
    assert.equal(reg.isValidInstanceKey(''), false);
    assert.equal(reg.isValidInstanceKey(null), false);
    assert.equal(reg.isValidInstanceKey(undefined), false);
  });

  it('returns undefined for an unbound session and rejects invalid keys on write', () => {
    assert.equal(reg.getSessionProxy(KEY_A), undefined);
    assert.equal(reg.setSessionProxyProfile('bad-key', { main: 'p1' }), false);
    assert.equal(reg.getSessionProxy('bad-key'), undefined);
  });

  it('set/get/clear round-trips a binding, treating max as a real stored value', () => {
    assert.equal(reg.setSessionProxyProfile(KEY_A, { main: 'max' }), true);
    assert.deepEqual(reg.getSessionProxy(KEY_A), { main: 'max', roles: { subagent: 'follow', teammate: 'follow' } });
    assert.equal(reg.clearSessionProxyProfile(KEY_A), true);
    assert.equal(reg.getSessionProxy(KEY_A), undefined);
    assert.equal(reg.clearSessionProxyProfile(KEY_A), false);
  });

  it('seeds from the global default only when no binding exists', () => {
    writeFileSync(join(__isoDir, 'profile.json'), JSON.stringify({ active: 'glob1', profiles: [] }));
    assert.equal(reg.seedSessionProxyProfile(KEY_A), true);
    assert.equal(reg.getSessionProxy(KEY_A).main, 'glob1');
    // A re-seed must not clobber a user choice.
    reg.setSessionProxyProfile(KEY_A, { main: 'userPicked' });
    assert.equal(reg.seedSessionProxyProfile(KEY_A), false);
    assert.equal(reg.getSessionProxy(KEY_A).main, 'userPicked');
  });

  it('a registered global-default provider wins over the disk fallback', () => {
    writeFileSync(join(__isoDir, 'profile.json'), JSON.stringify({ active: 'fromDisk', profiles: [] }));
    reg.registerGlobalDefaultProvider(() => 'fromProvider');
    assert.equal(reg.getGlobalDefaultProfileId(), 'fromProvider');
    reg.registerGlobalDefaultProvider(null);
    assert.equal(reg.getGlobalDefaultProfileId(), 'fromDisk');
  });

  it('falls back to max when neither provider nor profile.json yield a value', () => {
    try { rmSync(join(__isoDir, 'profile.json'), { force: true }); } catch { /* absent */ }
    assert.equal(reg.getGlobalDefaultProfileId(), 'max');
  });

  it('prunes bindings whose main/role profile was deleted, keeping max/follow', () => {
    reg.setSessionProxyProfile(KEY_A, { main: 'gone', roles: { subagent: 'kept', teammate: 'goneRole' } });
    reg.setSessionProxyProfile(KEY_B, { main: 'max' });
    reg.pruneSessionProxyProfiles(new Set(['kept']));
    assert.equal(reg.getSessionProxy(KEY_A), undefined, 'dangling main drops the binding');
    assert.equal(reg.getSessionProxy(KEY_B).main, 'max', 'max survives pruning');
  });

  it('clearSessionProxyProfiles empties the whole map', () => {
    reg.setSessionProxyProfile(KEY_A, { main: 'p1' });
    reg.setSessionProxyProfile(KEY_B, { main: 'p2' });
    reg.clearSessionProxyProfiles();
    assert.deepEqual(reg.listSessionProxyProfiles(), []);
  });
});

describe('resolveSessionMainProfile', () => {
  const profiles = new Map([['pA', { id: 'pA', baseURL: 'https://a' }], ['pB', { id: 'pB', baseURL: 'https://b' }]]);
  const legacy = { id: 'legacy', baseURL: 'https://legacy' };

  it('unbound session follows the legacy global', () => {
    assert.equal(core.resolveSessionMainProfile(undefined, profiles, legacy), legacy);
    assert.equal(core.resolveSessionMainProfile(null, profiles, legacy), legacy);
  });
  it('explicit max returns null (no rewrite) and does NOT follow the global', () => {
    assert.equal(core.resolveSessionMainProfile({ main: 'max' }, profiles, legacy), null);
  });
  it('a listed id resolves to its profile', () => {
    assert.equal(core.resolveSessionMainProfile({ main: 'pB' }, profiles, legacy), profiles.get('pB'));
  });
  it('a dangling id falls back to the legacy global', () => {
    assert.equal(core.resolveSessionMainProfile({ main: 'gone' }, profiles, legacy), legacy);
  });
});

describe('resolveSessionRoleProfile', () => {
  const profiles = new Map([
    ['main1', { id: 'main1' }],
    ['sub1', { id: 'sub1' }],
    ['wsSub', { id: 'wsSub' }],
  ]);
  const legacy = { id: 'legacyMain' };

  it('main role resolves to the session main', () => {
    const entry = { main: 'main1', roles: { subagent: 'follow', teammate: 'follow' } };
    assert.equal(core.resolveSessionRoleProfile('main', entry, profiles, legacy, {}), profiles.get('main1'));
  });
  it('session role follow → the SESSION main (main and subagent stay together)', () => {
    const entry = { main: 'main1', roles: { subagent: 'follow', teammate: 'follow' } };
    assert.equal(core.resolveSessionRoleProfile('subagent', entry, profiles, legacy, {}), profiles.get('main1'));
  });
  it('session role explicit id → that profile', () => {
    const entry = { main: 'main1', roles: { subagent: 'sub1', teammate: 'follow' } };
    assert.equal(core.resolveSessionRoleProfile('subagent', entry, profiles, legacy, {}), profiles.get('sub1'));
    assert.equal(core.resolveSessionRoleProfile('teammate', entry, profiles, legacy, {}), profiles.get('main1'));
  });
  it('session role max → null (explicit Default for that role)', () => {
    const entry = { main: 'main1', roles: { subagent: 'max', teammate: 'follow' } };
    assert.equal(core.resolveSessionRoleProfile('subagent', entry, profiles, legacy, {}), null);
  });
  it('unbound session defers to the legacy workspace role assignment', () => {
    const wsRoles = { subagent: 'wsSub', teammate: 'follow' };
    assert.equal(core.resolveSessionRoleProfile('subagent', undefined, profiles, legacy, wsRoles), profiles.get('wsSub'));
    assert.equal(core.resolveSessionRoleProfile('teammate', undefined, profiles, legacy, wsRoles), legacy);
  });
});
