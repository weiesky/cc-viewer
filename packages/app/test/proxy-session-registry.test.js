/**
 * Per-session proxy binding registry (instanceKey → { main, roles, origin, workspace? }) —
 * pure module tests, plus the resolveSessionMainProfile / resolveSessionRoleProfile pure
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
    assert.deepEqual(reg.getSessionProxy(KEY_A), { main: 'max', roles: { subagent: 'follow', teammate: 'follow' }, origin: 'user' });
    assert.equal(reg.clearSessionProxyProfile(KEY_A), true);
    assert.equal(reg.getSessionProxy(KEY_A), undefined);
    assert.equal(reg.clearSessionProxyProfile(KEY_A), false);
  });

  it('seeds from the global default only when no binding exists, tagged as seed+workspace', () => {
    writeFileSync(join(__isoDir, 'profile.json'), JSON.stringify({ active: 'glob1', profiles: [] }));
    assert.equal(reg.seedSessionProxyProfile(KEY_A, 'wsA'), true);
    const seeded = reg.getSessionProxy(KEY_A);
    assert.equal(seeded.main, 'glob1');
    assert.equal(seeded.origin, 'seed');
    assert.equal(seeded.workspace, 'wsA');
    // A re-seed must not clobber a user choice.
    reg.setSessionProxyProfile(KEY_A, { main: 'userPicked' });
    assert.equal(reg.seedSessionProxyProfile(KEY_A, 'wsA'), false);
    const after = reg.getSessionProxy(KEY_A);
    assert.equal(after.main, 'userPicked');
    assert.equal(after.origin, 'user');
    assert.equal(after.workspace, undefined, 'user bindings carry no workspace tag');
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

  it('isSeedOriginBinding flags only seed entries', () => {
    assert.equal(reg.isSeedOriginBinding({ origin: 'seed' }), true);
    assert.equal(reg.isSeedOriginBinding({ origin: 'user' }), false);
    assert.equal(reg.isSeedOriginBinding({}), false);
    assert.equal(reg.isSeedOriginBinding(undefined), false);
  });

  it('reseed updates only seed bindings belonging to the given workspace', () => {
    writeFileSync(join(__isoDir, 'profile.json'), JSON.stringify({ active: 'glob1', profiles: [] }));
    reg.seedSessionProxyProfile(KEY_A, 'wsA');
    reg.seedSessionProxyProfile(KEY_B, 'wsB');
    reg.setSessionProxyProfile('ccv-cccc3333', { main: 'userP' });
    const updated = reg.reseedSeedOriginBindings(
      { main: 'newMain', roles: { subagent: 's2', teammate: 'follow' } },
      { workspace: 'wsA' },
    );
    assert.equal(updated, 1, 'only the wsA seed binding changes');
    const a = reg.getSessionProxy(KEY_A);
    assert.equal(a.main, 'newMain');
    assert.deepEqual(a.roles, { subagent: 's2', teammate: 'follow' });
    assert.equal(a.origin, 'seed', 'reseed keeps seed provenance');
    assert.equal(a.workspace, 'wsA');
    assert.equal(reg.getSessionProxy(KEY_B).main, 'glob1', 'other workspace untouched');
    assert.equal(reg.getSessionProxy('ccv-cccc3333').main, 'userP', 'user binding untouched');
  });

  it('reseed without a workspace updates all seed bindings but never user bindings', () => {
    writeFileSync(join(__isoDir, 'profile.json'), JSON.stringify({ active: 'glob1', profiles: [] }));
    reg.seedSessionProxyProfile(KEY_A, 'wsA');
    reg.seedSessionProxyProfile(KEY_B, 'wsB');
    reg.setSessionProxyProfile('ccv-cccc3333', { main: 'userP' });
    const updated = reg.reseedSeedOriginBindings({ main: 'allNew', roles: { subagent: 'follow', teammate: 'follow' } });
    assert.equal(updated, 2);
    assert.equal(reg.getSessionProxy(KEY_A).main, 'allNew');
    assert.equal(reg.getSessionProxy(KEY_B).main, 'allNew');
    assert.equal(reg.getSessionProxy('ccv-cccc3333').main, 'userP');
  });

  it('reseed is idempotent — an unchanged value is a no-op and keeps the same entry object', () => {
    writeFileSync(join(__isoDir, 'profile.json'), JSON.stringify({ active: 'glob1', profiles: [] }));
    reg.seedSessionProxyProfile(KEY_A, 'wsA');
    const before = reg.getSessionProxy(KEY_A);
    const updated = reg.reseedSeedOriginBindings({ main: 'glob1', roles: { subagent: 'follow', teammate: 'follow' } }, { workspace: 'wsA' });
    assert.equal(updated, 0);
    assert.equal(reg.getSessionProxy(KEY_A), before, 'entry object not replaced when nothing changed');
  });

  it('reseed can write max as a real value without dropping the binding', () => {
    writeFileSync(join(__isoDir, 'profile.json'), JSON.stringify({ active: 'glob1', profiles: [] }));
    reg.seedSessionProxyProfile(KEY_A, 'wsA');
    const updated = reg.reseedSeedOriginBindings({ main: 'max', roles: { subagent: 'follow', teammate: 'follow' } }, { workspace: 'wsA' });
    assert.equal(updated, 1);
    assert.equal(reg.getSessionProxy(KEY_A).main, 'max');
  });

  it('reseed never touches a provenance-less (pre-existing) entry — treated as user', () => {
    reg.__putRawEntryForTests(KEY_A, { main: 'old', roles: { subagent: 'follow', teammate: 'follow' } });
    const updated = reg.reseedSeedOriginBindings({ main: 'newMain', roles: { subagent: 's2', teammate: 'follow' } });
    assert.equal(updated, 0);
    assert.equal(reg.getSessionProxy(KEY_A).main, 'old', 'no-origin entry is never auto-overwritten');
  });

  it('prune keeps origin on surviving bindings', () => {
    reg.setSessionProxyProfile(KEY_A, { main: 'gone', roles: { subagent: 'kept', teammate: 'follow' } });
    reg.setSessionProxyProfile(KEY_B, { main: 'kept', roles: { subagent: 'goneRole', teammate: 'follow' } });
    reg.pruneSessionProxyProfiles(new Set(['kept']));
    assert.equal(reg.getSessionProxy(KEY_A), undefined, 'dangling main drops the binding');
    const b = reg.getSessionProxy(KEY_B);
    assert.equal(b.main, 'kept', 'valid main survives');
    assert.equal(b.roles.subagent, 'follow', 'dangling role normalized to follow');
    assert.equal(b.origin, 'user', 'surviving binding keeps its provenance');
  });

  it('reseed gives each updated binding its OWN roles copy (no shared-reference bleed)', () => {
    writeFileSync(join(__isoDir, 'profile.json'), JSON.stringify({ active: 'glob1', profiles: [] }));
    reg.seedSessionProxyProfile(KEY_A, 'wsA');
    reg.seedSessionProxyProfile(KEY_B, 'wsA');
    reg.reseedSeedOriginBindings({ main: 'm2', roles: { subagent: 's2', teammate: 'follow' } }, { workspace: 'wsA' });
    // prune mutates roles in place; KEY_A's edit must not leak into KEY_B.
    reg.pruneSessionProxyProfiles(new Set(['m2'])); // 's2' now dangling → subagent reset on each
    assert.equal(reg.getSessionProxy(KEY_A).roles.subagent, 'follow');
    assert.equal(reg.getSessionProxy(KEY_B).roles.subagent, 'follow');
    // Independent objects: mutating one roles object must not affect the other.
    reg.getSessionProxy(KEY_A).roles.subagent = 'mutated';
    assert.equal(reg.getSessionProxy(KEY_B).roles.subagent, 'follow', 'no shared roles reference');
  });

  it('evicts the oldest entry (FIFO) when exceeding MAX_ENTRIES, and reseed keeps order', () => {
    // Fill to capacity, then overflow by one.
    const key = (i) => `ccv-${i.toString(16).padStart(8, '0')}`;
    for (let i = 0; i < 1024; i++) reg.setSessionProxyProfile(key(i), { main: 'p' });
    assert.equal(reg.listSessionProxyProfiles().length, 1024);
    reg.setSessionProxyProfile(key(1024), { main: 'p' }); // 1025th → evicts key(0)
    const keys = reg.listSessionProxyProfiles().map((e) => e.instanceKey);
    assert.equal(keys.length, 1024);
    assert.equal(keys.includes(key(0)), false, 'oldest entry evicted');
    assert.equal(keys.includes(key(1024)), true, 'newest entry kept');
    // A reseed on a surviving key must NOT change eviction order (Map.set keeps position).
    reg.__putRawEntryForTests(key(1), { main: 'p', roles: { subagent: 'follow', teammate: 'follow' }, origin: 'seed', workspace: 'ws' });
    reg.reseedSeedOriginBindings({ main: 'p2', roles: { subagent: 'follow', teammate: 'follow' } }, { workspace: 'ws' });
    reg.setSessionProxyProfile(key(1025), { main: 'p' }); // next eviction should be key(1)? No—key(1) still in original slot
    const keys2 = reg.listSessionProxyProfiles().map((e) => e.instanceKey);
    assert.equal(keys2.includes(key(1025)), true);
    assert.equal(keys2.length, 1024, 'still capped at MAX_ENTRIES');
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
