import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import { once } from 'node:events';
import { resolvePanelFile, servePanelFile, buildPanelDescriptor } from '../server/lib/plugin-panels.js';

let tmpRoot;
let pluginDir;

function setup() {
  tmpRoot = mkdtempSync(join(tmpdir(), 'ccv-pp-'));
  pluginDir = join(tmpRoot, 'hello-panel');
  mkdirSync(join(pluginDir, 'panel', 'assets'), { recursive: true });
  writeFileSync(join(pluginDir, 'plugin.json'), '{}');
  writeFileSync(join(pluginDir, 'main.mjs'), '// main source');
  writeFileSync(join(pluginDir, 'service.mjs'), '// service source');
  writeFileSync(join(pluginDir, 'panel', 'index.js'), 'console.log("bundle")');
  writeFileSync(join(pluginDir, 'panel', 'index.css'), 'body{}');
  writeFileSync(join(pluginDir, 'panel', 'assets', 'logo.png'), Buffer.from([1, 2, 3]));
  writeFileSync(join(pluginDir, 'panel', 'secret.html'), '<html>');
  writeFileSync(join(pluginDir, 'panel', 'data.json'), '{}');
}

function teardown() {
  rmSync(tmpRoot, { recursive: true, force: true });
}

function makeEntry(overrides = {}) {
  return {
    name: 'hello-panel',
    shape: 'dir',
    pluginDir,
    manifest: { version: '1.0.0', mainPath: join(pluginDir, 'main.mjs') },
    service: { entryPath: join(pluginDir, 'service.mjs'), prefix: '/plugins/hello-panel' },
    panel: {
      entryRel: 'panel/index.js',
      entryPath: join(pluginDir, 'panel', 'index.js'),
      rootDir: join(pluginDir, 'panel'),
      cssRel: 'panel/index.css',
      cssPath: join(pluginDir, 'panel', 'index.css'),
      title: null,
      titleI18n: { zh: '你好' },
      icon: 'api',
      width: 900,
      desktopOnly: false,
      fingerprint: 'abc123',
    },
    ...overrides,
  };
}

describe('resolvePanelFile', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('resolves allowed files within panel root', () => {
    const r = resolvePanelFile(makeEntry(), 'index.js');
    assert.ok(r.filePath.endsWith('index.js'));
    const r2 = resolvePanelFile(makeEntry(), 'assets/logo.png');
    assert.ok(r2.filePath.endsWith('logo.png'));
  });

  it('rejects traversal, encoded traversal, backslash, dotfiles', () => {
    for (const bad of ['../main.mjs', '%2e%2e/main.mjs', 'assets/../../main.mjs', 'a\\b.js', '.hidden.js', 'sub/./index.js']) {
      const r = resolvePanelFile(makeEntry(), bad);
      assert.ok(r.error, `${bad} should be rejected`);
    }
  });

  it('rejects disallowed extensions incl .html/.json/.map/.mjs', () => {
    for (const bad of ['secret.html', 'data.json', 'index.js.map', 'mod.mjs']) {
      const r = resolvePanelFile(makeEntry(), bad);
      assert.equal(r.status, 404, `${bad} should 404`);
    }
  });

  it('rejects manifest main/service paths even inside panel/', () => {
    // manifest.mainPath points inside panel/ (extreme config) -> must 404.
    // Note the comparison uses realpath: macOS tmpdir is a /var -> /private/var symlink.
    const entry = makeEntry({ manifest: { version: '1', mainPath: realpathSync(join(pluginDir, 'panel', 'index.js')) } });
    const r = resolvePanelFile(entry, 'index.js');
    assert.equal(r.status, 404);
  });

  it('rejects symlink escape from panel root', () => {
    const outside = join(tmpRoot, 'outside.js');
    writeFileSync(outside, 'x');
    symlinkSync(outside, join(pluginDir, 'panel', 'evil.js'));
    const r = resolvePanelFile(makeEntry(), 'evil.js');
    assert.ok(r.error, 'symlink escape must be rejected');
  });
});

describe('servePanelFile', () => {
  beforeEach(setup);
  afterEach(teardown);

  async function serve(path, headers = {}) {
    const server = http.createServer((req, res) => {
      const rest = req.url.slice('/plugin-panels/hello-panel/'.length);
      servePanelFile(req, res, makeEntry(), rest);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = server.address().port;
    const result = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path, headers, method: headers['X-Method'] || 'GET' }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject);
      req.end();
    });
    server.closeAllConnections?.();
    server.close();
    return result;
  }

  it('serves js with correct MIME, ETag, nosniff, no-cache', async () => {
    const r = await serve('/plugin-panels/hello-panel/index.js');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /text\/javascript/);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['cache-control'], 'no-cache');
    assert.ok(r.headers.etag);
    assert.equal(r.body.toString(), 'console.log("bundle")');
  });

  it('304 on matching If-None-Match', async () => {
    const r1 = await serve('/plugin-panels/hello-panel/index.js');
    const r2 = await serve('/plugin-panels/hello-panel/index.js', { 'if-none-match': r1.headers.etag });
    assert.equal(r2.status, 304);
  });

  it('serves css and png', async () => {
    const r1 = await serve('/plugin-panels/hello-panel/index.css');
    assert.match(r1.headers['content-type'], /text\/css/);
    const r2 = await serve('/plugin-panels/hello-panel/assets/logo.png');
    assert.equal(r2.headers['content-type'], 'image/png');
  });

  it('404 for unknown/traversal/html, never SPA fallback', async () => {
    for (const p of ['/plugin-panels/hello-panel/missing.js', '/plugin-panels/hello-panel/../main.mjs', '/plugin-panels/hello-panel/secret.html']) {
      const r = await serve(p);
      assert.equal(r.status >= 400, true, `${p} → ${r.status}`);
      assert.ok(!String(r.body).includes('<html'), 'never serve index.html as fallback');
    }
  });

  it('HEAD returns headers without body', async () => {
    const r = await serve('/plugin-panels/hello-panel/index.js', { 'X-Method': 'HEAD' });
    assert.equal(r.status, 200);
    assert.equal(r.body.length, 0);
  });
});

describe('buildPanelDescriptor', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('builds descriptor with fingerprinted URLs and statuses', () => {
    const d = buildPanelDescriptor(makeEntry(), { serviceStatus: { state: 'ready', lastError: null } });
    assert.equal(d.name, 'hello-panel');
    assert.equal(d.title, 'hello-panel');
    assert.deepEqual(d.titleI18n, { zh: '你好' });
    assert.equal(d.version, '1.0.0');
    assert.match(d.entryUrl, /^\/plugin-panels\/hello-panel\/index\.js\?v=abc123$/);
    assert.match(d.cssUrl, /\?v=abc123$/);
    assert.equal(d.prefix, '/plugins/hello-panel');
    assert.equal(d.panelStatus, 'ready');
    assert.equal(d.serviceStatus, 'ready');
  });

  it('panelStatus missing when bundle absent', () => {
    rmSync(join(pluginDir, 'panel', 'index.js'));
    const d = buildPanelDescriptor(makeEntry(), {});
    assert.equal(d.panelStatus, 'missing');
    assert.equal(d.entryUrl, null);
  });

  it('serviceStatus is null (unknown) when the runtime has no record, never a fake ready', () => {
    const d = buildPanelDescriptor(makeEntry(), {});
    assert.equal(d.serviceStatus, null, 'runtime not started must not report ready');
  });

  it('panel-only plugins never carry a serviceStatus', () => {
    const entry = makeEntry({ service: null });
    const d = buildPanelDescriptor(entry, { serviceStatus: { state: 'ready', lastError: null } });
    assert.equal(d.serviceStatus, null);
    assert.equal(d.prefix, null);
  });
});
