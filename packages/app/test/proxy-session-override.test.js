/**
 * Per-session proxy override at the interceptor fetch hook: a request carrying
 * `x-ccv-instance` for a bound session must be rewritten to THAT session's profile,
 * while unbound/unknown instances follow the process-global profile.
 *
 * Env must be set BEFORE the dynamic import of interceptor.js (LOG_DIR, hook install).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

process.env.CCV_PROXY_MODE = '1';
process.env.CCV_SYNC_WRITES = '1';
delete process.env.CCV_WORKSPACE_MODE;
delete process.env.ANTHROPIC_BASE_URL;
const __isoDir = mkdtempSync(join(tmpdir(), 'ccv-psess-'));
process.env.CCV_LOG_DIR = __isoDir;
process.env.CLAUDE_CONFIG_DIR = __isoDir;

const KEY_A = 'ccv-aaaa1111';
const KEY_B = 'ccv-bbbb2222';
const USER_ID = JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: 'aaaa2222-3333-4444-5555-666677778888' });

let interceptor;
let registry;
let lastFetch;

function writeProfile(profiles, active) {
  mkdirSync(dirname(interceptor.PROFILE_PATH), { recursive: true });
  writeFileSync(interceptor.PROFILE_PATH, JSON.stringify({ active, profiles }));
  interceptor._loadProxyProfile();
}
// seed the per-workspace active-profile.json (workspace = basename of cwd)
function writeWorkspaceActive(activeId, roles = { subagent: 'follow', teammate: 'follow' }) {
  const projDir = join(__isoDir, basename(process.cwd()).replace(/[^a-zA-Z0-9_\-\.]/g, '_'));
  mkdirSync(projDir, { recursive: true });
  writeFileSync(join(projDir, 'active-profile.json'), JSON.stringify({ activeId, roles }));
  interceptor._loadProxyProfile();
}

async function sendMain(instanceKey) {
  const headers = { 'x-api-key': 'k' };
  if (instanceKey) headers['x-ccv-instance'] = instanceKey;
  await globalThis.fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'hi' }], metadata: { user_id: USER_ID } }),
  });
  return lastFetch;
}

before(async () => {
  globalThis.fetch = async (url, opts) => { lastFetch = { url: String(url), opts }; return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); };
  interceptor = await import(join(REPO_ROOT, 'packages', 'app', 'server', 'interceptor.js'));
  registry = await import(join(REPO_ROOT, 'packages', 'app', 'server', 'lib', 'proxy-session-registry.js'));
  interceptor.setupInterceptor();
  // bootstrap a stable v2 session so metadata-less requests resolve somewhere
  await globalThis.fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': 'boot' }, body: JSON.stringify({ model: 'm', messages: [], metadata: { user_id: USER_ID } }) });
});

after(() => {
  interceptor.setLivePort(null);
  registry.__resetSessionProxyProfilesForTests();
  try { rmSync(__isoDir, { recursive: true, force: true }); } catch {}
  setTimeout(() => process.exit(0), 30).unref();
});

const PROFILES = [
  { id: 'max', name: 'Default' },
  { id: 'gA', name: 'GlobalA', baseURL: 'https://global-a.example.com', apiKey: 'sk-ga' },
  { id: 'sB', name: 'SessB', baseURL: 'https://sess-b.example.com', apiKey: 'sk-sb' },
];

describe('interceptor fetch hook per-session proxy override', () => {
  it('an unbound request follows the global workspace profile', async () => {
    writeProfile(PROFILES, 'gA');
    writeWorkspaceActive('gA');
    await sendMain(undefined);
    assert.equal(lastFetch.url, 'https://global-a.example.com/v1/messages');
  });

  it('a bound session overrides the global profile for its own request', async () => {
    writeProfile(PROFILES, 'gA');
    writeWorkspaceActive('gA');
    registry.setSessionProxyProfile(KEY_A, { main: 'sB' });
    await sendMain(KEY_A);
    assert.equal(lastFetch.url, 'https://sess-b.example.com/v1/messages', 'bound session must use its own profile');
    // an unrelated session / no header still follows the global
    await sendMain(KEY_B);
    assert.equal(lastFetch.url, 'https://global-a.example.com/v1/messages', 'unbound session unaffected');
    await sendMain(undefined);
    assert.equal(lastFetch.url, 'https://global-a.example.com/v1/messages', 'headerless request unaffected');
  });

  it('a session explicitly on max is NOT rewritten even when the global is a third-party profile', async () => {
    writeProfile(PROFILES, 'gA');
    writeWorkspaceActive('gA');
    registry.setSessionProxyProfile(KEY_A, { main: 'max' });
    await sendMain(KEY_A);
    assert.equal(lastFetch.url, 'https://api.anthropic.com/v1/messages', 'explicit Default stays on the default chain');
  });

  it('a dangling session binding falls back to the global profile', async () => {
    writeProfile(PROFILES, 'gA');
    writeWorkspaceActive('gA');
    registry.setSessionProxyProfile(KEY_A, { main: 'ghost' });
    await sendMain(KEY_A);
    assert.equal(lastFetch.url, 'https://global-a.example.com/v1/messages');
  });

  it('changing one session does not leak into another bound session', async () => {
    writeProfile(PROFILES, 'gA');
    writeWorkspaceActive('gA');
    registry.setSessionProxyProfile(KEY_A, { main: 'sB' });
    registry.setSessionProxyProfile(KEY_B, { main: 'gA' });
    await sendMain(KEY_A);
    assert.equal(lastFetch.url, 'https://sess-b.example.com/v1/messages');
    await sendMain(KEY_B);
    assert.equal(lastFetch.url, 'https://global-a.example.com/v1/messages');
    // change A only
    registry.setSessionProxyProfile(KEY_A, { main: 'max' });
    await sendMain(KEY_A);
    assert.equal(lastFetch.url, 'https://api.anthropic.com/v1/messages');
    await sendMain(KEY_B);
    assert.equal(lastFetch.url, 'https://global-a.example.com/v1/messages', 'B must not follow A');
  });
});
