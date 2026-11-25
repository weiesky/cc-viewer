/**
 * SDK session ↔ per-session proxy binding lifecycle: registering / creating /
 * attaching a session seeds its proxy binding from the global default (only when none
 * exists), and closing / stopping the session drops the binding so it never leaks.
 *
 * Fake query via __setQueryForTests (no real SDK child). Isolated CCV_LOG_DIR.
 */
import { describe, it, after, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-sdk-proxy-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;

let sdk;
let registry;
let projectKeyForCwd;

before(async () => {
  sdk = await import('../server/lib/sdk-manager.js');
  registry = await import('../server/lib/proxy-session-registry.js');
  // projectKeyForCwd mirrors the workspace tag sdk-manager attaches to a seed binding.
  ({ projectKeyForCwd } = await import('../server/lib/system-prompt-snapshots.js'));
});

after(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });
afterEach(() => { sdk.stopSession(); sdk.__setQueryForTests(undefined); registry.__resetSessionProxyProfilesForTests(); });

function makeQuery(record = []) {
  return ({ prompt, options }) => {
    record.push({ cwd: options.cwd });
    const q = (async function* () {
      yield { type: 'system', subtype: 'init', session_id: `s-${options.cwd}`, model: 'm', slash_commands: [] };
      for await (const item of prompt) {
        if (item && item.type === 'user') yield { type: 'result', subtype: 'success', session_id: `s-${options.cwd}`, is_error: false, result: 'ok' };
      }
    })();
    q.close = () => { q._closed = true; };
    q.interrupt = () => Promise.resolve();
    return q;
  };
}
const deps = { broadcastWs() {}, onTurnEnd() {} };

function keyFor(cwd) {
  return sdk.listSdkSessions().find((s) => s.cwd === cwd)?.instanceKey;
}

describe('sdk session → proxy binding lifecycle', () => {
  it('initSdkSession seeds the binding from the global default, tagged seed+workspace', () => {
    writeFileSync(join(tmpDir, 'profile.json'), JSON.stringify({ active: 'globX', profiles: [] }));
    sdk.__setQueryForTests(makeQuery());
    sdk.initSdkSession('/wa', 'wa', deps);
    const key = keyFor('/wa');
    assert.ok(key, 'session registered');
    const binding = registry.getSessionProxy(key);
    assert.equal(binding?.main, 'globX');
    assert.equal(binding?.origin, 'seed');
    assert.equal(binding?.workspace, projectKeyForCwd('/wa'));
  });

  it('a re-init / attach never clobbers an existing user choice', () => {
    sdk.__setQueryForTests(makeQuery());
    sdk.initSdkSession('/wa', 'wa', deps);
    const key = keyFor('/wa');
    registry.setSessionProxyProfile(key, { main: 'userPicked' });
    sdk.initSdkSession('/wa', 'wa', deps); // re-init same cwd
    assert.equal(registry.getSessionProxy(key)?.main, 'userPicked', 're-init must not reseed');
    assert.equal(registry.getSessionProxy(key)?.origin, 'user');
    sdk.attachSdkSession({ instanceKey: key });
    assert.equal(registry.getSessionProxy(key)?.main, 'userPicked', 'attach must not reseed');
    assert.equal(registry.getSessionProxy(key)?.origin, 'user');
  });

  it('attachSdkSession seeds a session that has no binding yet, with its own workspace', () => {
    writeFileSync(join(tmpDir, 'profile.json'), JSON.stringify({ active: 'globY', profiles: [] }));
    sdk.__setQueryForTests(makeQuery());
    sdk.initSdkSession('/wa', 'wa', deps);
    const key = keyFor('/wa');
    registry.clearSessionProxyProfile(key); // simulate a binding that predates the mapping
    assert.equal(registry.getSessionProxy(key), undefined);
    sdk.attachSdkSession({ instanceKey: key });
    const binding = registry.getSessionProxy(key);
    assert.equal(binding?.main, 'globY', 'activation seeds from the current global default');
    assert.equal(binding?.origin, 'seed');
    assert.equal(binding?.workspace, projectKeyForCwd('/wa'));
  });

  it('a same-cwd sibling gets its OWN binding, seeded from the global default', () => {
    writeFileSync(join(tmpDir, 'profile.json'), JSON.stringify({ active: 'globZ', profiles: [] }));
    sdk.__setQueryForTests(makeQuery());
    sdk.initSdkSession('/wa', 'wa', deps);
    const primaryKey = keyFor('/wa');
    registry.setSessionProxyProfile(primaryKey, { main: 'primaryChoice' });
    const created = sdk.createSdkSession('/wa');
    assert.ok(created?.instanceKey && created.instanceKey !== primaryKey, 'sibling has a fresh key');
    const sibling = registry.getSessionProxy(created.instanceKey);
    assert.equal(sibling?.main, 'globZ', 'sibling seeds from global default');
    assert.equal(sibling?.origin, 'seed');
    assert.equal(sibling?.workspace, projectKeyForCwd('/wa'), 'same-cwd sibling shares the workspace tag');
    assert.equal(registry.getSessionProxy(primaryKey)?.main, 'primaryChoice', 'primary binding untouched');
  });

  it('closeSdkSession drops only that session binding; stopSession drops all', () => {
    sdk.__setQueryForTests(makeQuery());
    sdk.initSdkSession('/wa', 'wa', deps);
    sdk.initSdkSession('/wb', 'wb', deps);
    const ka = keyFor('/wa');
    const kb = keyFor('/wb');
    assert.ok(registry.getSessionProxy(ka) && registry.getSessionProxy(kb));
    sdk.closeSdkSession({ instanceKey: ka });
    assert.equal(registry.getSessionProxy(ka), undefined, 'closed session binding dropped');
    assert.ok(registry.getSessionProxy(kb), 'survivor binding kept');
    sdk.stopSession();
    assert.deepEqual(registry.listSessionProxyProfiles(), [], 'stopSession clears every binding');
  });
});
