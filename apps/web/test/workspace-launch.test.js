// Unit tests for the shared workspace launcher (utils/workspaceLaunch.js) — the
// single launch path used by the workspace picker and the file explorer's
// "New Workspace (Session)" context-menu item.
import './_shims/register.mjs';
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { location: { search: '' } };

const originalFetch = globalThis.fetch;
const requests = [];
let fetchImpl = async () => ({ ok: true, json: async () => ({ ok: true, projectName: 'web' }) });
globalThis.fetch = async (url, options) => {
  requests.push({ url, options });
  return fetchImpl(url, options);
};

// apiUrl reads window.location at module load — window shim must precede import.
const { launchWorkspace, isTransportError } = await import('../src/utils/workspaceLaunch.js');

beforeEach(() => {
  requests.length = 0;
  fetchImpl = async () => ({ ok: true, json: async () => ({ ok: true, projectName: 'web' }) });
  delete globalThis.window.electronAPI;
  delete globalThis.window.tabBridge;
});

after(() => {
  globalThis.fetch = originalFetch;
});

describe('launchWorkspace', () => {
  it('POSTs the launch with a fresh session (no -c) for an unknown folder', async () => {
    const result = await launchWorkspace('/abs/apps/web', { logCount: 0 });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/workspaces/launch');
    assert.deepEqual(JSON.parse(requests[0].options.body), { path: '/abs/apps/web', extraArgs: [] });
    assert.deepEqual(result, { openedElsewhere: false, projectName: 'web' });
  });

  it('injects -c when the folder already has logs', async () => {
    await launchWorkspace('/abs/apps/web', { logCount: 5 });
    assert.deepEqual(JSON.parse(requests[0].options.body), { path: '/abs/apps/web', extraArgs: ['-c'] });
  });

  it('Electron workspace view: IPC launch, no POST, openedElsewhere', async () => {
    const ipcCalls = [];
    globalThis.window.electronAPI = { launchWorkspace: (path, args) => ipcCalls.push([path, args]) };
    const result = await launchWorkspace('/abs/apps/web', { logCount: 2 });
    assert.deepEqual(ipcCalls, [['/abs/apps/web', ['-c']]]);
    assert.equal(requests.length, 0);
    assert.equal(result.openedElsewhere, true);
  });

  it('Electron tab content (tabBridge.launchWorkspace): IPC to main createTab, no POST', async () => {
    const ipcCalls = [];
    globalThis.window.tabBridge = { launchWorkspace: (path, args) => ipcCalls.push([path, args]) };
    const result = await launchWorkspace('/abs/apps/web', { logCount: 1 });
    assert.deepEqual(ipcCalls, [['/abs/apps/web', ['-c']]]);
    assert.equal(requests.length, 0, 'tab content must never POST (the worker is not multitab; it would re-root this tab)');
    assert.equal(result.openedElsewhere, true);
  });

  it('throws the server error message on a rejected launch', async () => {
    fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ error: 'Invalid directory path' }) });
    await assert.rejects(launchWorkspace('/abs/gone'), /Invalid directory path/);
  });

  it('throws an HTTP status when the failure body is not JSON', async () => {
    fetchImpl = async () => ({ ok: false, status: 500, json: async () => { throw new Error('not json'); } });
    await assert.rejects(launchWorkspace('/abs/gone'), /HTTP 500/);
  });

  it('throws on a 200 with a non-JSON body (never a blank-project success)', async () => {
    fetchImpl = async () => ({ ok: true, status: 200, json: async () => { throw new Error('not json'); } });
    await assert.rejects(launchWorkspace('/abs/apps/web'), /HTTP 200/);
  });

  it('a transport rejection (offline) surfaces as a TypeError for the caller classifier', async () => {
    fetchImpl = async () => { throw new TypeError('Load failed'); }; // Safari spelling
    await assert.rejects(launchWorkspace('/abs/apps/web'), (err) => isTransportError(err));
  });

  it('isTransportError classifies server errors as non-transport (shown verbatim)', async () => {
    assert.equal(isTransportError(new Error('Invalid directory path')), false);
    assert.equal(isTransportError(new Error('HTTP 500')), true);
    assert.equal(isTransportError(new TypeError('Failed to fetch')), true);
  });
});
