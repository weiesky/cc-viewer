/**
 * Reconciling seed-origin session proxy bindings with the owning workspace's live active/roles
 * (interceptor-level trigger chain).
 *
 * Covers "what you see is what you execute" + "the fallback never falls to nothing":
 *   - a workspace hot-switch re-aligns an already-seeded session binding (origin==='seed')
 *   - an explicit user session choice (origin==='user') is never overwritten by workspace changes
 *   - a seed taken before the workspace config existed (fallback 'max') self-corrects once written
 *   - 'max' never falls back to the global profile; multi-workspace isolation; resetWorkspace skips
 *
 * The single reconcile point is `_reconcileSeedBindings` at the end of `_loadProxyProfile()`'s
 * success path, which both the explicit switch route and the watchFile callbacks converge on.
 *
 * Same as interceptor-profile.test.js: env must be set BEFORE the dynamic imports.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

process.env.CCV_PROXY_MODE = '1';
process.env.CCV_SYNC_WRITES = '1';
delete process.env.CCV_WORKSPACE_MODE;
const __isoDir = mkdtempSync(join(tmpdir(), 'ccv-reseed-'));
process.env.CCV_LOG_DIR = __isoDir;
process.env.CLAUDE_CONFIG_DIR = __isoDir;

const KEY = 'ccv-a1b2c3d4';
const KEY2 = 'ccv-e5f60718';
const PROJ_A = join(__isoDir, 'ws-a');
const PROJ_B = join(__isoDir, 'ws-b');

let mod;      // interceptor
let registry; // proxy-session-registry

function writeProfile(json) {
  mkdirSync(dirname(mod.PROFILE_PATH), { recursive: true });
  writeFileSync(mod.PROFILE_PATH, JSON.stringify(json));
}

// Remove the workspace active-profile.json so each case starts from a clean "no override" state.
function clearWorkspaceActive() {
  if (!mod._logDir) return;
  try { rmSync(join(mod._logDir, 'active-profile.json'), { force: true }); } catch {}
}

// Seed KEY against the CURRENT bound workspace, returning the binding.
function seedCurrent(key = KEY) {
  registry.seedSessionProxyProfile(key, mod._projectName);
  return registry.getSessionProxy(key);
}

before(async () => {
  mod = await import('../server/interceptor.js');
  registry = await import('../server/lib/proxy-session-registry.js');
});
after(() => {
  try { rmSync(__isoDir, { recursive: true, force: true }); } catch {}
  // initForWorkspace arms a watchFile timer that would otherwise hold the event loop open.
  setTimeout(() => process.exit(0), 30).unref();
});
beforeEach(() => {
  registry.__resetSessionProxyProfilesForTests();
  writeProfile({ active: 'max', profiles: [] });
  mod.initForWorkspace(PROJ_A, { forceNew: true });
  clearWorkspaceActive();
  mod._loadProxyProfile(); // let the interceptor see the clean no-override baseline
});

describe('seed binding / workspace realignment', () => {
  it('hot-switch: switching the workspace active profile re-aligns the seeded binding', () => {
    writeProfile({
      active: 'max',
      profiles: [{ id: 'p2', name: 'P2', baseURL: 'https://p2', apiKey: 'k2' }],
    });
    mod.initForWorkspace(PROJ_A, { forceNew: true });
    clearWorkspaceActive();
    mod._loadProxyProfile();
    assert.equal(seedCurrent()?.main, 'max', 'seed resolves to the workspace fallback max');

    mod.setActiveProfileForWorkspace('p2', { subagent: 's2', teammate: 'follow' });
    const b = registry.getSessionProxy(KEY);
    assert.equal(b?.main, 'p2', 'seed binding re-aligned to the new active');
    assert.equal(b?.roles.subagent, 's2');
    assert.equal(b?.origin, 'seed', 're-alignment keeps seed provenance');
    assert.equal(mod.getEffectiveMainProfile(KEY)?.id, 'p2', 'request routing also points at p2');
  });

  it('an explicit user choice is never overwritten by a workspace change', () => {
    writeProfile({
      active: 'max',
      profiles: [
        { id: 'userP', name: 'U', baseURL: 'https://u', apiKey: 'ku' },
        { id: 'p2', name: 'P2', baseURL: 'https://p2', apiKey: 'k2' },
      ],
    });
    mod.initForWorkspace(PROJ_A, { forceNew: true });
    clearWorkspaceActive();
    registry.setSessionProxyProfile(KEY, { main: 'userP' });
    mod.setActiveProfileForWorkspace('p2', { subagent: 'follow', teammate: 'follow' });
    const b = registry.getSessionProxy(KEY);
    assert.equal(b?.main, 'userP', 'user binding not re-aligned');
    assert.equal(b?.origin, 'user');
  });

  it('fallback self-corrects: a seed taken before the config existed is fixed once written', () => {
    // Workspace file absent → seed falls back to max (the "empty" fallback).
    writeProfile({ active: 'max', profiles: [{ id: 'p3', name: 'P3', baseURL: 'https://p3', apiKey: 'k3' }] });
    mod.initForWorkspace(PROJ_A, { forceNew: true });
    clearWorkspaceActive();
    mod._loadProxyProfile();
    assert.equal(seedCurrent()?.main, 'max');

    // The config lands later (role reconcile / user switch) → the same reconcile path fixes it.
    mod.setActiveProfileForWorkspace('p3', { subagent: 's3', teammate: 'follow' });
    assert.equal(registry.getSessionProxy(KEY)?.main, 'p3', 'no longer stuck on the empty fallback');
  });

  it("max never falls back: a workspace active of 'max' does not fall back to profile.json.active", () => {
    // Keep the GLOBAL default at p1 but make the WORKSPACE override 'max', writing the workspace
    // file directly so profile.json.active is NOT rewritten (setActiveProfileForWorkspace would
    // dual-write it to 'max' and mask the fallback we are asserting against).
    writeProfile({
      active: 'p1',
      profiles: [{ id: 'p1', name: 'P1', baseURL: 'https://p1', apiKey: 'k1' }],
    });
    mod.initForWorkspace(PROJ_A, { forceNew: true });
    writeFileSync(join(mod._logDir, 'active-profile.json'), JSON.stringify({ activeId: 'max', roles: { subagent: 'follow', teammate: 'follow' } }));
    mod._loadProxyProfile();
    assert.equal(seedCurrent()?.main, 'max');
    assert.equal(mod.getActiveProfileId(), 'max', 'workspace override wins over the global default');
    assert.equal(mod.getEffectiveMainProfile(KEY), null, 'max → no rewrite, no fall-back to p1');
  });

  it('external write to active-profile.json re-aligns via _loadProxyProfile (the watchFile callback)', () => {
    writeProfile({
      active: 'max',
      profiles: [{ id: 'pw', name: 'PW', baseURL: 'https://pw', apiKey: 'kw' }],
    });
    mod.initForWorkspace(PROJ_A, { forceNew: true });
    clearWorkspaceActive();
    mod._loadProxyProfile();
    assert.equal(seedCurrent()?.main, 'max');

    // Simulate another process writing the workspace file, then the watchFile callback reloading.
    writeFileSync(join(mod._logDir, 'active-profile.json'), JSON.stringify({ activeId: 'pw', roles: { subagent: 'sw', teammate: 'follow' } }));
    mod._loadProxyProfile();
    assert.equal(registry.getSessionProxy(KEY)?.main, 'pw', 'the reload path also re-aligns');
    assert.equal(registry.getSessionProxy(KEY)?.roles.subagent, 'sw');
  });

  it('multi-workspace isolation: switching to workspace B never rewrites A-seeded sessions', () => {
    // Workspace A: seed KEY_A belongs to A.
    writeProfile({ active: 'max', profiles: [{ id: 'pA', name: 'PA', baseURL: 'https://pa', apiKey: 'ka' }] });
    mod.initForWorkspace(PROJ_A, { forceNew: true });
    clearWorkspaceActive();
    mod.setActiveProfileForWorkspace('pA', { subagent: 'follow', teammate: 'follow' });
    registry.seedSessionProxyProfile(KEY, mod._projectName);
    const aBefore = registry.getSessionProxy(KEY);
    assert.equal(aBefore?.main, 'pA');

    // Switch to workspace B and change ITS active; A's binding must be untouched.
    writeProfile({ active: 'max', profiles: [{ id: 'pB', name: 'PB', baseURL: 'https://pb', apiKey: 'kb' }] });
    mod.initForWorkspace(PROJ_B, { forceNew: true });
    clearWorkspaceActive();
    registry.seedSessionProxyProfile(KEY2, mod._projectName); // KEY2 belongs to B
    mod.setActiveProfileForWorkspace('pB', { subagent: 'sb', teammate: 'follow' });

    const aAfter = registry.getSessionProxy(KEY);
    assert.equal(aAfter?.main, 'pA', 'workspace-A seed binding not rewritten by the B change');
    assert.equal(aAfter?.origin, 'seed');
    assert.equal(registry.getSessionProxy(KEY2)?.main, 'pB', 'workspace-B seed binding follows B');

    // Switching back to A re-aligns A's bindings (self-heal on re-activation).
    mod.initForWorkspace(PROJ_A, { forceNew: true });
    assert.equal(registry.getSessionProxy(KEY)?.main, 'pA');
  });

  it('resetWorkspace stops reconciling (empty _projectName skips)', () => {
    writeProfile({
      active: 'max',
      profiles: [{ id: 'p2', name: 'P2', baseURL: 'https://p2', apiKey: 'k2' }],
    });
    mod.initForWorkspace(PROJ_A, { forceNew: true });
    clearWorkspaceActive();
    mod._loadProxyProfile();
    seedCurrent();
    mod.resetWorkspace();
    // Change the global default to a real profile; a reconcile (if it ran) would rewrite the
    // binding, but with no workspace bound it must be skipped entirely.
    writeProfile({ active: 'p2', profiles: [{ id: 'p2', name: 'P2', baseURL: 'https://p2', apiKey: 'k2' }] });
    mod._loadProxyProfile();
    assert.equal(registry.getSessionProxy(KEY)?.main, 'max', 'binding left untouched after reset');
  });

  it('a corrupt workspace active-profile.json does NOT downgrade seeded bindings', () => {
    writeProfile({
      active: 'max',
      profiles: [{ id: 'p2', name: 'P2', baseURL: 'https://p2', apiKey: 'k2' }],
    });
    mod.initForWorkspace(PROJ_A, { forceNew: true });
    clearWorkspaceActive();
    mod.setActiveProfileForWorkspace('p2', { subagent: 's2', teammate: 'follow' });
    registry.seedSessionProxyProfile(KEY, mod._projectName);
    assert.equal(registry.getSessionProxy(KEY)?.main, 'p2');

    // Corrupt the workspace file; the reload must skip reconciling rather than flap to 'max'.
    writeFileSync(join(mod._logDir, 'active-profile.json'), '{ not valid json');
    mod._loadProxyProfile();
    assert.equal(registry.getSessionProxy(KEY)?.main, 'p2', 'unreadable workspace file → no downgrade');
  });

  it('role re-alignment: workspace role changes flow to seed bindings, user bindings untouched', () => {
    writeProfile({
      active: 'max',
      profiles: [{ id: 's2', name: 'S2', baseURL: 'https://s2', apiKey: 'ks' }],
    });
    mod.initForWorkspace(PROJ_A, { forceNew: true });
    clearWorkspaceActive();
    mod._loadProxyProfile();
    seedCurrent(KEY);
    registry.setSessionProxyProfile(KEY2, { main: 'max', roles: { subagent: 'follow', teammate: 'follow' } });

    mod.setActiveProfileForWorkspace(undefined, { subagent: 's2', teammate: 'follow' }); // roles only
    assert.equal(registry.getSessionProxy(KEY)?.roles.subagent, 's2', 'seed roles follow');
    assert.equal(registry.getSessionProxy(KEY2)?.roles.subagent, 'follow', 'user roles untouched');
  });
});
