import './_shims/register.mjs';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const appRequire = createRequire(join(WEB_ROOT, 'package.json'));
const esbuild = await import(pathToFileURL(createRequire(appRequire.resolve('vite')).resolve('esbuild')).href);
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
globalThis.window = { location: { search: '' } };
globalThis.document = { querySelector: () => null };

let htmlPreviewUrl;
before(async () => {
  const result = await esbuild.build({
    entryPoints: [join(WEB_ROOT, 'src/components/common/HtmlPreviewModal.jsx')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    jsx: 'automatic',
    external: ['react', 'react/jsx-runtime', 'antd'],
    logLevel: 'silent',
  });
  const bundleDir = mkdtempSync(join(WEB_ROOT, 'test/.html-preview-test-'));
  const bundlePath = join(bundleDir, 'preview.mjs');
  writeFileSync(bundlePath, result.outputFiles[0].contents);
  ({ htmlPreviewUrl } = await import(pathToFileURL(bundlePath).href));
  after(() => rmSync(bundleDir, { recursive: true, force: true }));
});

after(() => {
  if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
  if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
});

describe('scoped HTML preview URLs', () => {
  it('preserves project and instance in relative script, style, and nested-page URLs', () => {
    const src = htmlPreviewUrl('coverage/index.html', { project: 'other project', instance: 'ccv-a1b2' });
    assert.equal(src, '/api/file-raw/view/other%20project/ccv-a1b2/coverage/index.html');
    for (const relative of ['sorter.js', 'style.css', '../shared/icon.svg']) {
      const child = new URL(relative, `http://localhost${src}`);
      assert.equal(child.searchParams.get('project'), null, 'scope belongs in the path, not an inherited query');
      assert.ok(child.pathname.startsWith('/api/file-raw/view/other%20project/ccv-a1b2/'), child.href);
    }
    const nested = new URL('coverage/index.html', `http://localhost${src}`);
    assert.equal(nested.pathname, '/api/file-raw/view/other%20project/ccv-a1b2/coverage/coverage/index.html');
  });

  it('keeps the legacy URL shape when no project is supplied', () => {
    assert.equal(htmlPreviewUrl('dir/index.html'), '/api/file-raw/dir/index.html');
  });
});

describe('scoped HTML preview server reads', { concurrency: false }, () => {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'ccv-html-preview-test-')));
  const bound = join(tmp, 'bound');
  const viewed = join(tmp, 'viewed');
  mkdirSync(join(bound, 'coverage'), { recursive: true });
  mkdirSync(join(viewed, 'coverage'), { recursive: true });
  const oldEnv = { ...process.env };
  let fileRaw;
  let saveWorkspaces;
  let registerSdkSessionLister;

  before(async () => {
    process.env.CCV_PROJECT_DIR = bound;
    process.env.CLAUDE_CONFIG_DIR = join(tmp, 'claude');
    process.env.CCV_LOG_DIR = join(tmp, 'logs');
    process.env.CCV_WORKSPACE_MODE = '1';
    process.env.CCV_CLI_MODE = '0';
    ({ saveWorkspaces } = await import('../../../packages/app/server/workspace-registry.js'));
    saveWorkspaces([{ path: viewed, projectName: 'other-project' }]);
    ({ registerSdkSessionLister } = await import('../../../packages/app/server/lib/sdk-session-index.js'));
    registerSdkSessionLister(() => [{ cwd: viewed, instanceKey: 'ccv-b123', projectName: 'other-project' }]);
    const policy = await import('../../../packages/app/server/lib/file-access-policy.js');
    policy.bumpWorkspacesVersion();
    const routes = (await import('../../../packages/app/server/routes/files-content.js')).filesContentRoutes;
    fileRaw = routes.find((r) => r.predicate && r.predicate('/api/file-raw', 'GET')).handler;
  });

  after(() => {
    registerSdkSessionLister?.(null);
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    for (const key of Object.keys(process.env)) {
      if (!(key in oldEnv)) delete process.env[key];
    }
    rmSync(tmp, { recursive: true, force: true });
  });

  function getRaw(url) {
    let status = 0;
    let body = '';
    const res = {
      writeHead(code) { status = code; },
      end(data) { body = data == null ? '' : String(data); },
    };
    fileRaw({ method: 'GET' }, res, new URL(url, 'http://localhost'));
    return { status, body };
  }

  it('serves a relative asset from the viewed project rather than the bound project', () => {
    const src = htmlPreviewUrl('coverage/index.html', { project: 'other-project', instance: 'ccv-b123' });
    const relativeUrl = new URL('sorter.js', `http://localhost${src}`).pathname;
    assert.equal(relativeUrl, '/api/file-raw/view/other-project/ccv-b123/coverage/sorter.js');
    writeFileSync(join(bound, 'coverage', 'sorter.js'), 'bound-asset');
    writeFileSync(join(viewed, 'coverage', 'sorter.js'), 'viewed-asset');
    const result = getRaw(relativeUrl);
    assert.equal(result.status, 200, result.body);
    assert.equal(result.body, 'viewed-asset');
  });

  it('rejects an instance that belongs to a different project', () => {
    const result = getRaw('/api/file-raw/view/other-project/ccv-deadbeef/coverage/sorter.js');
    assert.equal(result.status, 400);
  });

  it('rejects malformed scope encoding instead of throwing', () => {
    const result = getRaw('/api/file-raw/view/%E0%A4%A/ccv-b123/coverage/sorter.js');
    assert.equal(result.status, 400);
  });
});
