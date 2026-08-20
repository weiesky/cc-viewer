import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Isolate LOG_DIR (PROFILE_PATH = join(LOG_DIR, 'profile.json')) before any findcc-loading import.
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-proxy-profiles-test-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

// Replicate the trivial mask helpers from server.js (kept in sync) — they are passed via deps.
const maskApiKey = (k) => (k && typeof k === 'string' && k.length > 4 ? '****' + k.slice(-4) : k ? '****' : '');
const maskProfiles = (data) => {
  if (!data || !Array.isArray(data.profiles)) return data;
  return { ...data, profiles: data.profiles.map((p) => (p.apiKey ? { ...p, apiKey: maskApiKey(p.apiKey) } : p)) };
};

const PROFILE_PATH = join(tmpDir, 'profile.json');
const REAL_KEY = 'sk-realsecret-abcd1234';

function mkRes() {
  let payload = '';
  return { writeHead() {}, end(b) { payload = b || ''; }, get payload() { return payload; } };
}

// GET /api/proxy-profiles: the local (admin / 127.0.0.1) caller gets plaintext apiKeys to
// view/copy in the edit form; an authorized remote caller only ever gets ****+last4.
describe('GET /api/proxy-profiles isLocal gate', { concurrency: false }, () => {
  let route;

  before(async () => {
    writeFileSync(PROFILE_PATH, JSON.stringify({
      profiles: [
        { id: 'max', name: 'Default' },
        { id: 'p1', name: 'deepseek', baseURL: 'https://api.deepseek.com/anthropic', apiKey: REAL_KEY, models: ['m1'], activeModel: 'm1' },
      ],
    }));
    const { preferencesRoutes } = await import('../server/routes/preferences.js');
    route = preferencesRoutes.find((r) => r.path === '/api/proxy-profiles' && r.method === 'GET');
    assert.ok(route, 'GET /api/proxy-profiles route must exist');
  });

  after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  const deps = { maskProfiles, maskApiKey, defaultProxyProfiles: { profiles: [{ id: 'max', name: 'Default' }] } };

  it('returns the plaintext apiKey to a local (admin) caller', () => {
    const res = mkRes();
    route.handler({}, res, { pathname: '/api/proxy-profiles' }, /* isLocal */ true, deps);
    const p1 = JSON.parse(res.payload).profiles.find((p) => p.id === 'p1');
    assert.equal(p1.apiKey, REAL_KEY, 'local admin must get the full apiKey');
  });

  it('masks the apiKey for a remote (non-local) caller', () => {
    const res = mkRes();
    route.handler({}, res, { pathname: '/api/proxy-profiles' }, /* isLocal */ false, deps);
    const p1 = JSON.parse(res.payload).profiles.find((p) => p.id === 'p1');
    assert.equal(p1.apiKey, '****1234', 'remote must get the masked apiKey (****+last4)');
    assert.ok(!res.payload.includes('realsecret'), 'the full secret must not leak to a remote caller');
  });
});
