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
globalThis.fetch = async (url, options) => {
  requests.push({ url, options });
  return { ok: true, json: async () => ({ ok: true, path: 'created', newPath: 'renamed' }) };
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
          contents: `export const message = { error() {}, success() {}, warning() {}, info() {}, loading: () => () => {} };
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
  delete globalThis.__fileMenuConfirm;
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
