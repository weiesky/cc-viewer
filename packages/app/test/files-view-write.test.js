import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync,
  symlinkSync, realpathSync, readdirSync, chmodSync, rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TMP = realpathSync(mkdtempSync(join(tmpdir(), 'ccv-files-view-write-')));
const BOUND = join(TMP, 'one', 'proj');
const VIEWED = join(TMP, 'two', 'proj');
const OTHER = join(TMP, 'three', 'other');
const AMBIGUOUS_A = join(TMP, 'four', 'ambiguous');
const AMBIGUOUS_B = join(TMP, 'five', 'ambiguous');
for (const dir of [BOUND, VIEWED, OTHER, AMBIGUOUS_A, AMBIGUOUS_B]) mkdirSync(dir, { recursive: true });
process.env.CCV_PROJECT_DIR = BOUND;
process.env.CLAUDE_CONFIG_DIR = join(TMP, 'claude');
process.env.CCV_LOG_DIR = join(TMP, 'logs');
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

const workspaces = [
  { path: BOUND, projectName: 'proj' },
  { path: VIEWED, projectName: 'proj' },
  { path: OTHER, projectName: 'other' },
  { path: AMBIGUOUS_A, projectName: 'ambiguous' },
  { path: AMBIGUOUS_B, projectName: 'ambiguous' },
];
const deps = {
  MAX_POST_BODY: 1024 * 1024,
  WINDOWS_RESERVED_NAMES: /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/,
  IGNORED_PATTERNS: new Set(),
  execWithStdin: async () => '',
};
const viewParams = 'project=other&instance=ccv-b123';
const instanceParams = 'project=proj&instance=ccv-b123';
const originalPlatform = process.platform;
const originalPath = process.env.PATH;
let fsRoutes;
let contentRoutes;

function url(path, search = viewParams) {
  const query = path.includes('?') ? path.slice(path.indexOf('?') + 1) : '';
  const searchParams = new URLSearchParams(query);
  for (const [key, value] of new URLSearchParams(search)) searchParams.set(key, value);
  return { pathname: path, searchParams };
}

function call(handler, path, body, search = viewParams) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    req.headers = {};
    req.destroy = () => {};
    const res = {
      status: 0,
      writeHead(code) { this.status = code; },
      end(raw) {
        let data;
        try { data = JSON.parse(raw || '{}'); } catch { data = raw; }
        resolve({ status: this.status, data });
      },
    };
    handler(req, res, url(path, search), true, deps);
    if (body !== undefined) req.emit('data', JSON.stringify(body));
    req.emit('end');
  });
}

function route(routes, path, method = 'POST') {
  const found = routes.find((r) => r.path === path && r.method === method);
  assert.ok(found, `${method} ${path} route missing`);
  return found.handler;
}

function multipart(filename, content = 'content') {
  return Buffer.concat([
    Buffer.from(`--B\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    Buffer.from(content),
    Buffer.from('\r\n--B--\r\n'),
  ]);
}

function importFile(path, filename, search = viewParams) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    req.headers = { 'content-type': 'multipart/form-data; boundary=B' };
    req.destroy = () => {};
    const res = {
      status: 0,
      writeHead(code) { this.status = code; },
      end(raw) { resolve({ status: this.status, data: JSON.parse(raw || '{}') }); },
    };
    route(fsRoutes, '/api/import-file')(req, res, url(path, search), true, deps);
    req.emit('data', multipart(filename));
    req.emit('end');
  });
}

before(async () => {
  const fakeBin = join(TMP, 'fakebin');
  mkdirSync(fakeBin);
  for (const name of ['open', 'xdg-open', 'explorer']) {
    const script = join(fakeBin, name);
    writeFileSync(script, '#!/bin/sh\nexit 0\n');
    chmodSync(script, 0o755);
  }
  process.env.PATH = `${fakeBin}:${originalPath}`;
  fsRoutes = (await import('../server/routes/files-fs.js')).filesFsRoutes;
  contentRoutes = (await import('../server/routes/files-content.js')).filesContentRoutes;
  const { registerSdkSessionLister } = await import('../server/lib/sdk-session-index.js');
  registerSdkSessionLister(() => [{ cwd: VIEWED, instanceKey: 'ccv-b123' }]);
  const policy = await import('../server/lib/file-access-policy.js');
  // The production registry supplies these entries; inject the same data through
  // the test registry file and invalidate the policy's cached workspace roots.
  const { saveWorkspaces } = await import('../server/workspace-registry.js');
  saveWorkspaces(workspaces);
  policy.bumpWorkspacesVersion();
});

after(async () => {
  process.env.PATH = originalPath;
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  const { registerSdkSessionLister } = await import('../server/lib/sdk-session-index.js');
  registerSdkSessionLister(null);
  rmSync(TMP, { recursive: true, force: true });
});

describe('project-scoped file mutations', { concurrency: false }, () => {
  it('creates files and directories in the viewed project, not the bound project', async () => {
    for (const [path, body] of [
      ['/api/create-dir', { dirPath: '', name: 'created' }],
      ['/api/create-file', { dirPath: '', name: 'created.txt' }],
    ]) {
      const result = await call(route(fsRoutes, path), path, body);
      assert.equal(result.status, 200, JSON.stringify(result));
    }
    assert.ok(existsSync(join(VIEWED, 'created')));
    assert.ok(existsSync(join(VIEWED, 'created.txt')));
    assert.equal(existsSync(join(BOUND, 'created')), false);
    assert.equal(existsSync(join(BOUND, 'created.txt')), false);
  });

  it('renames and moves entries only inside the selected project', async () => {
    writeFileSync(join(VIEWED, 'old.txt'), 'selected');
    writeFileSync(join(BOUND, 'old.txt'), 'bound');
    mkdirSync(join(VIEWED, 'dest'));
    const renamed = await call(route(fsRoutes, '/api/rename-file'), '/api/rename-file', { oldPath: 'old.txt', newName: 'new.txt' });
    assert.equal(renamed.status, 200, JSON.stringify(renamed));
    const moved = await call(route(fsRoutes, '/api/move-file'), '/api/move-file', { fromPath: 'new.txt', toDir: 'dest' });
    assert.equal(moved.status, 200, JSON.stringify(moved));
    assert.equal(moved.data.newPath, 'dest/new.txt');
    assert.equal(readFileSync(join(VIEWED, 'dest', 'new.txt'), 'utf8'), 'selected');
    assert.equal(readFileSync(join(BOUND, 'old.txt'), 'utf8'), 'bound');
  });

  it('uses the normal rename path when the differently-cased destination does not exist', async (t) => {
    if (existsSync(join(VIEWED, 'linux-case.txt'))) {
      t.skip('case-insensitive filesystem');
      return;
    }
    writeFileSync(join(VIEWED, 'linux-case.txt'), 'selected');
    const result = await call(route(fsRoutes, '/api/rename-file'), '/api/rename-file', { oldPath: 'linux-case.txt', newName: 'LINUX-CASE.txt' });
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.deepEqual(readdirSync(VIEWED).filter((name) => name.toLowerCase() === 'linux-case.txt'), ['LINUX-CASE.txt']);
  });

  it('supports case-only renames on case-insensitive filesystems', async (t) => {
    const source = join(VIEWED, 'case.txt');
    writeFileSync(source, 'selected');
    if (!existsSync(join(VIEWED, 'CASE.txt'))) {
      t.skip('case-sensitive filesystem');
      return;
    }
    const result = await call(route(fsRoutes, '/api/rename-file'), '/api/rename-file', { oldPath: 'case.txt', newName: 'CASE.txt' });
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.deepEqual(readdirSync(VIEWED).filter((name) => name.toLowerCase() === 'case.txt'), ['CASE.txt']);
    assert.equal(readFileSync(join(VIEWED, 'CASE.txt'), 'utf8'), 'selected');
  });

  it('deletes the selected project entry without touching its bound twin', async () => {
    writeFileSync(join(VIEWED, 'delete.txt'), 'selected');
    writeFileSync(join(BOUND, 'delete.txt'), 'bound');
    const result = await call(route(fsRoutes, '/api/delete-file'), '/api/delete-file', { path: 'delete.txt' });
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.equal(existsSync(join(VIEWED, 'delete.txt')), false);
    assert.equal(readFileSync(join(BOUND, 'delete.txt'), 'utf8'), 'bound');
  });

  it('imports into the selected project and does not create bound directories', async () => {
    const result = await importFile('/api/import-file?dir=imported', 'x.txt');
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.equal(readFileSync(join(VIEWED, 'imported', 'x.txt'), 'utf8'), 'content');
    assert.equal(existsSync(join(BOUND, 'imported')), false);
  });

  it('saves relative file-content paths into the selected project', async () => {
    writeFileSync(join(VIEWED, 'save.txt'), 'selected');
    writeFileSync(join(BOUND, 'save.txt'), 'bound');
    const result = await call(route(contentRoutes, '/api/file-content'), '/api/file-content', { path: 'save.txt', content: 'updated' });
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.equal(readFileSync(join(VIEWED, 'save.txt'), 'utf8'), 'updated');
    assert.equal(readFileSync(join(BOUND, 'save.txt'), 'utf8'), 'bound');
  });

  it('resolves copy/reveal paths and opens the selected project root', async () => {
    const resolved = await call(route(fsRoutes, '/api/resolve-path'), '/api/resolve-path', { path: 'a.txt' });
    assert.equal(resolved.status, 200);
    assert.equal(resolved.data.fullPath, join(VIEWED, 'a.txt'));
    const opened = await call(route(fsRoutes, '/api/open-project-dir'), '/api/open-project-dir', {});
    assert.equal(opened.status, 200);
    assert.equal(opened.data.dir, realpathSync(VIEWED));
  });

  it('supports an exact live instance when same-name projects are ambiguous', async () => {
    const result = await call(route(fsRoutes, '/api/create-file'), '/api/create-file', { dirPath: '', name: 'instance.txt' }, instanceParams);
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.ok(existsSync(join(VIEWED, 'instance.txt')));
    assert.equal(existsSync(join(BOUND, 'instance.txt')), false);
  });

  it('rejects ambiguous and unknown views without filesystem side effects', async () => {
    for (const search of ['project=ambiguous', 'project=missing']) {
      const result = await importFile('/api/import-file?dir=no-side-effect&' + search, 'x.txt', search);
      assert.ok([400, 404].includes(result.status), JSON.stringify(result));
      assert.equal(existsSync(join(BOUND, 'no-side-effect')), false);
      assert.equal(existsSync(join(VIEWED, 'no-side-effect')), false);
    }
  });

  it('rejects symlink escapes before import creates outside directories', async (t) => {
    const outside = join(TMP, 'outside');
    mkdirSync(outside);
    try { symlinkSync(outside, join(VIEWED, 'escape'), 'dir'); }
    catch { t.skip('symlink not permitted'); return; }
    const result = await importFile('/api/import-file?dir=escape/nested', 'x.txt');
    assert.equal(result.status, 400, JSON.stringify(result));
    assert.equal(existsSync(join(outside, 'nested')), false);
  });

  it('rejects cross-project absolute saves without changing either file', async () => {
    const target = join(BOUND, 'absolute.txt');
    writeFileSync(target, 'bound');
    const result = await call(route(contentRoutes, '/api/file-content'), '/api/file-content', { path: target, content: 'changed' });
    assert.equal(result.status, 403, JSON.stringify(result));
    assert.equal(readFileSync(target, 'utf8'), 'bound');
  });

  it('preserves allowlisted absolute-path writes for explicit editor sessions', async () => {
    const external = join(TMP, 'external-editor.txt');
    writeFileSync(external, 'before');
    const policy = await import('../server/lib/file-access-policy.js');
    const roots = policy.getAllowedRoots();
    roots.push({ raw: TMP, real: TMP });
    try {
      const result = await call(route(contentRoutes, '/api/file-content'), '/api/file-content', { path: external, content: 'after', editorSession: true });
      assert.equal(result.status, 200, JSON.stringify(result));
      assert.equal(readFileSync(external, 'utf8'), 'after');
    } finally { roots.pop(); }
  });

  it('rejects new relative paths whose ancestors escape the selected project', async (t) => {
    const outside = join(TMP, 'save-outside');
    mkdirSync(outside);
    try { symlinkSync(outside, join(VIEWED, 'save-escape'), 'dir'); }
    catch { t.skip('symlink not permitted'); return; }
    const result = await call(route(contentRoutes, '/api/file-content'), '/api/file-content', { path: 'save-escape/new/file.txt', content: 'bad' });
    assert.equal(result.status, 403, JSON.stringify(result));
    assert.equal(existsSync(join(outside, 'new')), false);
  });

  it('keeps no-parameter operations on the bound project for older clients', async () => {
    const result = await call(route(fsRoutes, '/api/create-file'), '/api/create-file', { dirPath: '', name: 'legacy.txt' }, '');
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.ok(existsSync(join(BOUND, 'legacy.txt')));
    assert.equal(existsSync(join(VIEWED, 'legacy.txt')), false);
  });
});
