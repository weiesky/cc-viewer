import './_shims/register.mjs';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const appRequire = createRequire(join(WEB_ROOT, 'package.json'));
const esbuildPath = createRequire(appRequire.resolve('vite')).resolve('esbuild');
const esbuild = await import(pathToFileURL(esbuildPath).href);

globalThis.window = { location: { search: '' } };
globalThis.document = { querySelector: () => null };
const originalFetch = globalThis.fetch;
const requests = [];
// Reconfigurable per test: newWorkspace cases issue three different requests.
let fetchImpl = async () => ({ ok: true, json: async () => ({ ok: true, path: 'created', newPath: 'renamed' }) });
globalThis.fetch = async (url, options) => {
  requests.push({ url, options });
  return fetchImpl(url, options);
};

let createFileMenuHandler;
const bundleDir = mkdtempSync(join(WEB_ROOT, 'test/.file-menu-test-'));
before(async () => {
  const result = await esbuild.build({
    entryPoints: [join(WEB_ROOT, 'src/components/files/fileContextMenuActions.jsx')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    jsx: 'automatic',
    external: ['react', 'react/jsx-runtime'],
    plugins: [{
      name: 'file-menu-antd-stub',
      setup(build) {
        build.onResolve({ filter: /^antd$/ }, () => ({ path: 'antd', namespace: 'antd-stub' }));
        build.onLoad({ filter: /.*/, namespace: 'antd-stub' }, () => ({
          loader: 'js',
          contents: `export const message = { error(msg) { globalThis.__fileMenuErrors.push(msg); }, success() {}, warning() {}, info() {}, loading: () => () => {} };
export const Modal = { confirm: (options) => { globalThis.__fileMenuConfirm = options; } };
export const Input = () => null;`,
        }));
      },
    }],
    logLevel: 'silent',
  });
  const bundlePath = join(bundleDir, 'file-menu.mjs');
  writeFileSync(bundlePath, result.outputFiles[0].contents);
  ({ createFileMenuHandler } = await import(pathToFileURL(bundlePath).href));
});
beforeEach(() => {
  requests.length = 0;
  fetchImpl = async () => ({ ok: true, json: async () => ({ ok: true, path: 'created', newPath: 'renamed' }) });
  globalThis.__fileMenuErrors = [];
  delete globalThis.__fileMenuConfirm;
  delete globalThis.window.electronAPI;
  delete globalThis.window.tabBridge;
});
after(() => {
  globalThis.fetch = originalFetch;
  rmSync(bundleDir, { recursive: true, force: true });
});

function menu(path = 'src', isDir = true) {
  return createFileMenuHandler({ path, name: 'entry', isDir, renameMode: 'modal', project: 'other project', instance: 'ccv-a1b2' });
}

const SKILL_TARGET = { kind: 'skill', source: 'user', path: '/home/u/.claude/skills/demo' };
function targetMenu(path = 'demo', isDir = true) {
  return createFileMenuHandler({ path, name: 'entry', isDir, renameMode: 'modal', project: 'other project', instance: 'ccv-a1b2', target: SKILL_TARGET });
}

describe('file context menu project-scoped requests', () => {
  for (const [key, endpoint] of [
    ['reveal', '/api/reveal-file'],
    ['openTerminal', '/api/open-terminal'],
    ['copyPath', '/api/resolve-path'],
  ]) {
    it(`${key} carries project and instance`, async () => {
      menu('src/file.txt', false)({ key });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(requests[0].url, `${endpoint}?project=other%20project&instance=ccv-a1b2`);
    });
  }

  for (const [key, endpoint] of [
    ['newFile', '/api/create-file'],
    ['newDir', '/api/create-dir'],
    ['delete', '/api/delete-file'],
    ['rename', '/api/rename-file'],
  ]) {
    it(`${key} confirmation posts to the selected project`, async () => {
      const handler = menu('src/old.txt', false);
      handler({ key });
      assert.ok(globalThis.__fileMenuConfirm, 'Modal.confirm must be called');
      globalThis.document.getElementById = () => ({ value: key === 'rename' ? 'new.txt' : 'created' });
      await globalThis.__fileMenuConfirm.onOk();
      assert.equal(requests[0].url, `${endpoint}?project=other%20project&instance=ccv-a1b2`);
    });
  }
});

describe('file context menu target-scoped requests (CLAUDE.md / skill browser)', () => {
  // Target mode swaps every endpoint for /api/target-<op> and carries the target
  // identity in the query (kind + source + targetPath) so the server re-derives
  // the navigation root instead of trusting a client-sent path.
  const TARGET_Q = 'kind=skill&source=user&targetPath=%2Fhome%2Fu%2F.claude%2Fskills%2Fdemo';

  for (const [key, endpoint] of [
    ['reveal', '/api/target-reveal-file'],
    ['openTerminal', '/api/target-open-terminal'],
    ['copyPath', '/api/target-resolve-path'],
  ]) {
    it(`${key} hits the target route with the target identity`, async () => {
      targetMenu('demo/file.txt', false)({ key });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(requests[0].url, `${endpoint}?${TARGET_Q}&project=other%20project&instance=ccv-a1b2`);
    });
  }

  for (const [key, endpoint] of [
    ['newFile', '/api/target-create-file'],
    ['newDir', '/api/target-create-dir'],
    ['delete', '/api/target-delete-file'],
    ['rename', '/api/target-rename-file'],
  ]) {
    it(`${key} confirmation posts to the target route`, async () => {
      const handler = targetMenu('demo/old.txt', false);
      handler({ key });
      assert.ok(globalThis.__fileMenuConfirm, 'Modal.confirm must be called');
      globalThis.document.getElementById = () => ({ value: key === 'rename' ? 'new.txt' : 'created' });
      await globalThis.__fileMenuConfirm.onOk();
      assert.equal(requests[0].url, `${endpoint}?${TARGET_Q}&project=other%20project&instance=ccv-a1b2`);
    });
  }
});

describe('file context menu newWorkspace (launch from folder)', () => {
  // The launch chain is: POST resolve-path (view-scoped, like copyPath) + GET
  // /api/workspaces (logCount probe for the -c heuristic, best-effort) → POST
  // /api/workspaces/launch. Requests run in parallel — locate by URL, never by index.
  function launchMenu({ onLaunchWorkspace = () => {}, target } = {}) {
    return createFileMenuHandler({
      path: 'apps/web', name: 'web', isDir: true, renameMode: 'inline',
      project: 'other project', instance: 'ccv-a1b2', onLaunchWorkspace, target,
    });
  }
  function stubLaunchChain({ logCount = 0, launchError = null } = {}) {
    fetchImpl = async (url) => {
      if (url.startsWith('/api/resolve-path')) {
        return { ok: true, json: async () => ({ ok: true, fullPath: '/abs/apps/web' }) };
      }
      if (url.startsWith('/api/workspaces/launch')) {
        return launchError
          ? { ok: false, status: 400, json: async () => ({ error: launchError }) }
          : { ok: true, json: async () => ({ ok: true, projectName: 'web' }) };
      }
      if (url.startsWith('/api/workspaces')) {
        return { ok: true, json: async () => ({ workspaces: logCount > 0 ? [{ path: '/abs/apps/web', logCount }] : [] }) };
      }
      throw new Error(`unexpected url: ${url}`);
    };
  }
  const launchRequest = () => requests.find(r => r.url.startsWith('/api/workspaces/launch'));

  it('resolves the folder, launches it, and notifies the callback', async () => {
    stubLaunchChain();
    const launched = [];
    await launchMenu({ onLaunchWorkspace: (ws) => launched.push(ws) })({ key: 'newWorkspace' });
    // resolve-path is view-scoped (carries project/instance, like copyPath).
    const resolveReq = requests.find(r => r.url.startsWith('/api/resolve-path'));
    assert.equal(resolveReq.url, '/api/resolve-path?project=other%20project&instance=ccv-a1b2');
    assert.equal(JSON.parse(resolveReq.options.body).path, 'apps/web');
    // Launch uses the resolved absolute path; unknown folder → fresh session, no -c.
    assert.deepEqual(JSON.parse(launchRequest().options.body), { path: '/abs/apps/web', extraArgs: [] });
    assert.deepEqual(launched, [{ projectName: 'web', path: '/abs/apps/web' }]);
    assert.equal(globalThis.__fileMenuErrors.length, 0);
  });

  it('passes -c when the folder already has logs (WorkspaceList parity)', async () => {
    stubLaunchChain({ logCount: 3 });
    await launchMenu()({ key: 'newWorkspace' });
    assert.deepEqual(JSON.parse(launchRequest().options.body), { path: '/abs/apps/web', extraArgs: ['-c'] });
  });

  it('launches without -c when the workspaces probe fails (fresh-session fallback)', async () => {
    stubLaunchChain();
    const base = fetchImpl;
    fetchImpl = async (url) => (url.startsWith('/api/workspaces') && !url.startsWith('/api/workspaces/launch'))
      ? Promise.reject(new Error('network down'))
      : base(url);
    await launchMenu()({ key: 'newWorkspace' });
    assert.deepEqual(JSON.parse(launchRequest().options.body), { path: '/abs/apps/web', extraArgs: [] });
  });

  it('Electron workspace view: IPC launch, no POST, no callback (main opens the tab)', async () => {
    stubLaunchChain();
    const ipcCalls = [];
    globalThis.window.electronAPI = { launchWorkspace: (path, args) => ipcCalls.push([path, args]) };
    const launched = [];
    await launchMenu({ onLaunchWorkspace: (ws) => launched.push(ws) })({ key: 'newWorkspace' });
    assert.deepEqual(ipcCalls, [['/abs/apps/web', []]]);
    assert.equal(launchRequest(), undefined);
    assert.equal(launched.length, 0);
  });

  it('Electron tab content (tabBridge.launchWorkspace): IPC to main, no POST, no callback', async () => {
    stubLaunchChain();
    const ipcCalls = [];
    globalThis.window.tabBridge = { launchWorkspace: (path, args) => ipcCalls.push([path, args]) };
    const launched = [];
    await launchMenu({ onLaunchWorkspace: (ws) => launched.push(ws) })({ key: 'newWorkspace' });
    assert.deepEqual(ipcCalls, [['/abs/apps/web', []]]);
    assert.equal(launchRequest(), undefined, 'tab content must never POST the launch');
    assert.equal(launched.length, 0, 'main opens a new tab that owns the workspace');
  });

  it('surfaces a resolve failure as a localized error toast without calling back', async () => {
    fetchImpl = async (url) => {
      if (url.startsWith('/api/resolve-path')) {
        return { ok: false, status: 400, json: async () => ({ error: 'ambiguous project name' }) };
      }
      if (url.startsWith('/api/workspaces')) {
        return { ok: true, json: async () => ({ workspaces: [] }) };
      }
      throw new Error(`unexpected url: ${url}`);
    };
    const launched = [];
    await launchMenu({ onLaunchWorkspace: (ws) => launched.push(ws) })({ key: 'newWorkspace' });
    assert.equal(launchRequest(), undefined);
    assert.equal(launched.length, 0);
    assert.equal(globalThis.__fileMenuErrors.length, 1);
    assert.match(globalThis.__fileMenuErrors[0], /ambiguous project name/);
  });

  it('surfaces a launch failure as a localized error toast without calling back', async () => {
    stubLaunchChain({ launchError: 'Invalid directory path' });
    const launched = [];
    await launchMenu({ onLaunchWorkspace: (ws) => launched.push(ws) })({ key: 'newWorkspace' });
    assert.equal(launched.length, 0);
    assert.equal(globalThis.__fileMenuErrors.length, 1);
    assert.match(globalThis.__fileMenuErrors[0], /Invalid directory path/);
  });

  it('no callback wired → no requests at all (menu item is never built there)', async () => {
    const handler = createFileMenuHandler({
      path: 'apps/web', name: 'web', isDir: true, renameMode: 'inline',
      project: 'other project', instance: 'ccv-a1b2',
    });
    handler({ key: 'newWorkspace' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests.length, 0);
  });

  it('target mode never launches even if a callback is present', async () => {
    const handler = createFileMenuHandler({
      path: 'demo', name: 'demo', isDir: true, renameMode: 'modal',
      project: 'other project', instance: 'ccv-a1b2',
      target: SKILL_TARGET, onLaunchWorkspace: () => {},
    });
    handler({ key: 'newWorkspace' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests.length, 0);
  });
});
