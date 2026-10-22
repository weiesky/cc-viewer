import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import {
  parsePluginManifest,
  resolveInsidePluginDir,
  validatePluginName,
  validateServicePrefix,
  computeMainFingerprint,
  computePanelFingerprint,
  listPluginDirs,
} from '../server/lib/plugin-manifest.js';
import {
  loadPlugins,
  getPluginEntries,
  getServiceEntries,
  getPluginsGeneration,
  getPluginsInfo,
  runWaterfallHook,
  _resetModuleCacheForTest,
} from '../server/lib/plugin-loader.js';
import { setLogDir } from '../findcc.js';

let tmpRoot;
let pluginsDir;

function setup() {
  // setLogDir's safety gate only allows paths under home or /tmp (macOS os.tmpdir() is
  // /var/folders/..., which is rejected), so the temp LOG_DIR lives under home.
  tmpRoot = mkdtempSync(join(homedir(), '.ccv-plsvc-test-'));
  pluginsDir = join(tmpRoot, 'plugins');
  mkdirSync(pluginsDir, { recursive: true });
  setLogDir(tmpRoot);
}

function teardown() {
  rmSync(tmpRoot, { recursive: true, force: true });
  setLogDir('tmp');
}

function writeDirPlugin(dirName, files) {
  const dir = join(pluginsDir, dirName);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

function writePrefs(obj) {
  writeFileSync(join(tmpRoot, 'preferences.json'), JSON.stringify(obj));
}

// ─── plugin-manifest ───

describe('plugin-manifest', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('validates plugin names and service prefixes', () => {
    assert.ok(validatePluginName('hello-service'));
    assert.ok(validatePluginName('a.b_c-1'));
    assert.ok(!validatePluginName('-bad'));
    assert.ok(!validatePluginName('has space'));
    assert.ok(!validatePluginName(''));
    assert.ok(validateServicePrefix('/plugins/hello'));
    assert.ok(!validateServicePrefix('/api/x'));
    assert.ok(!validateServicePrefix('/plugins/a/b'));
  });

  it('parses a full service+panel manifest', () => {
    const dir = writeDirPlugin('hello-service', {
      'plugin.json': JSON.stringify({
        name: 'hello-service',
        version: '1.2.3',
        main: 'main.mjs',
        service: { entry: 'service.mjs', env: { MODE: 'demo' } },
        panel: { entry: 'panel/index.js', css: 'panel/index.css', title: { zh: '你好' }, icon: 'api', width: 900, desktopOnly: true },
        config: { defaults: { greeting: 'hi' } },
      }),
      'main.mjs': 'export default {};',
      'service.mjs': '// service',
      'panel/index.js': '// bundle',
      'panel/index.css': '/* css */',
    });
    const { manifest, error } = parsePluginManifest(dir);
    assert.equal(error, undefined);
    assert.equal(manifest.name, 'hello-service');
    assert.equal(manifest.version, '1.2.3');
    assert.equal(manifest.mainRel, 'main.mjs');
    assert.equal(manifest.service.prefix, '/plugins/hello-service');
    assert.deepEqual(manifest.service.env, { MODE: 'demo' });
    assert.equal(manifest.panel.width, 900);
    assert.equal(manifest.panel.desktopOnly, true);
    assert.equal(manifest.panel.icon, 'api');
    assert.deepEqual(manifest.configDefaults, { greeting: 'hi' });
  });

  it('rejects invalid manifests with specific errors', () => {
    const dir = writeDirPlugin('bad-json', { 'plugin.json': '{nope' });
    assert.match(parsePluginManifest(dir).error, /not valid JSON/);

    const dir2 = writeDirPlugin('bad-name', { 'plugin.json': JSON.stringify({ name: 'has space' }) });
    assert.match(parsePluginManifest(dir2).error, /invalid plugin name/);

    const dir3 = writeDirPlugin('bad-prefix', {
      'plugin.json': JSON.stringify({ name: 'bad-prefix', service: { entry: 's.mjs', prefix: '/api/x' } }),
      's.mjs': '',
    });
    assert.match(parsePluginManifest(dir3).error, /invalid service\.prefix/);

    const dir4 = writeDirPlugin('html-panel', {
      'plugin.json': JSON.stringify({ name: 'html-panel', panel: { entry: 'panel/index.html' } }),
    });
    assert.match(parsePluginManifest(dir4).error, /iframe-style|\.js bundle/);

    const dir5 = writeDirPlugin('root-panel', {
      'plugin.json': JSON.stringify({ name: 'root-panel', panel: { entry: 'bundle.js' } }),
      'bundle.js': '',
    });
    assert.match(parsePluginManifest(dir5).error, /subdirectory/);

    const dir6 = writeDirPlugin('env-override', {
      'plugin.json': JSON.stringify({ name: 'env-override', service: { entry: 's.mjs', env: { CCV_LOG_DIR: '/tmp' } } }),
      's.mjs': '',
    });
    assert.match(parsePluginManifest(dir6).error, /reserved variable/);
  });

  it('rejects path escape in entry fields', () => {
    const dir = writeDirPlugin('escape', {
      'plugin.json': JSON.stringify({ name: 'escape', service: { entry: '../outside.mjs' } }),
    });
    writeFileSync(join(pluginsDir, 'outside.mjs'), '');
    assert.match(parsePluginManifest(dir).error, /\.\.|escape|illegal/);
  });

  it('resolveInsidePluginDir blocks symlink escape', () => {
    const outside = mkdtempSync(join(tmpdir(), 'ccv-outside-'));
    writeFileSync(join(outside, 'secret.js'), 'x');
    const dir = join(pluginsDir, 'sym');
    mkdirSync(dir, { recursive: true });
    symlinkSync(join(outside, 'secret.js'), join(dir, 'link.js'));
    const r = resolveInsidePluginDir(dir, 'link.js', 'test');
    assert.ok(r.error || r.real === join(outside, 'secret.js') && false, 'symlink escape must not resolve inside');
    rmSync(outside, { recursive: true, force: true });
  });

  it('computes different fingerprints when helper changes', () => {
    const files = {
      'plugin.json': JSON.stringify({ name: 'fp', main: 'main.mjs' }),
      'main.mjs': 'import "./helper.mjs";\nexport default {};',
      'helper.mjs': 'export const v = 1;',
    };
    const dir = writeDirPlugin('fp', files);
    const { manifest } = parsePluginManifest(dir);
    const fp1 = computeMainFingerprint(manifest.raw, manifest.mainPath, dir);
    writeFileSync(join(dir, 'helper.mjs'), 'export const v = 2;');
    const fp2 = computeMainFingerprint(manifest.raw, manifest.mainPath, dir);
    assert.notEqual(fp1, fp2, 'helper change must bust fingerprint');
  });

  it('computePanelFingerprint changes with mtime/size', async () => {
    const dir = writeDirPlugin('pf', {
      'plugin.json': JSON.stringify({ name: 'pf', panel: { entry: 'panel/index.js' } }),
      'panel/index.js': '// v1',
    });
    const { manifest } = parsePluginManifest(dir);
    const f1 = computePanelFingerprint(manifest.panel);
    await new Promise(r => setTimeout(r, 20));
    writeFileSync(join(dir, 'panel/index.js'), '// v1 longer');
    const f2 = computePanelFingerprint(manifest.panel);
    assert.notEqual(f1, f2);
  });

  it('listPluginDirs returns only directories', () => {
    writeDirPlugin('a-dir', { 'plugin.json': '{}' });
    writeFileSync(join(pluginsDir, 'b-file.js'), '');
    assert.deepEqual(listPluginDirs(pluginsDir), ['a-dir']);
  });
});

// ─── plugin-loader directory plugins ───

describe('plugin-loader directory plugins', () => {
  beforeEach(() => {
    setup();
    _resetModuleCacheForTest();
  });
  afterEach(teardown);

  it('loads a directory plugin without main (service-only)', async () => {
    writeDirPlugin('svc-only', {
      'plugin.json': JSON.stringify({ name: 'svc-only', service: { entry: 'service.mjs' } }),
      'service.mjs': '// svc',
    });
    const { entries } = await loadPlugins();
    const entry = entries.find(e => e.name === 'svc-only');
    assert.ok(entry, 'entry should exist');
    assert.equal(entry.loadError, null);
    assert.equal(entry.service.prefix, '/plugins/svc-only');
    const services = getServiceEntries();
    assert.equal(services.length, 1);
    assert.equal(services[0].name, 'svc-only');
  });

  it('loads a directory plugin with hooks and lifecycle', async () => {
    writeDirPlugin('full', {
      'plugin.json': JSON.stringify({ name: 'full', main: 'main.mjs', panel: { entry: 'panel/index.js' } }),
      'main.mjs': `export default { hooks: { localUrl(v) { return { url: v.url + '/full' }; } }, async activate() {}, async deactivate() {} };`,
      'panel/index.js': '// bundle',
    });
    await loadPlugins();
    const result = await runWaterfallHook('localUrl', { url: 'http://x' });
    assert.equal(result.url, 'http://x/full');
    const entry = getPluginEntries().find(e => e.name === 'full');
    assert.equal(entry.panel.icon, 'appstore');
    assert.ok(entry.panel.fingerprint);
    assert.equal(entry.type, undefined); // type is only derived in getPluginsInfo
    const info = getPluginsInfo().find(p => p.name === 'full');
    assert.equal(info.type, 'panel');
    assert.equal(info.dir, 'full');
    assert.deepEqual(info.hooks, ['localUrl']);
  });

  it('marks directory plugin disabled via preferences without executing main', async () => {
    writeDirPlugin('disabled-dir', {
      'plugin.json': JSON.stringify({ name: 'disabled-dir', main: 'main.mjs', service: { entry: 's.mjs' } }),
      'main.mjs': 'throw new Error("must not execute");',
      's.mjs': '',
    });
    writePrefs({ disabledPlugins: ['disabled-dir'] });
    const { entries } = await loadPlugins();
    const entry = entries.find(e => e.name === 'disabled-dir');
    assert.equal(entry.enabled, false);
    assert.equal(entry.loadError, null);
    assert.equal(getServiceEntries().length, 0);
    const info = getPluginsInfo().find(p => p.name === 'disabled-dir');
    assert.equal(info.enabled, false);
    assert.equal(info.type, 'service');
  });

  it('records manifest errors as loadError without throwing', async () => {
    writeDirPlugin('broken', { 'plugin.json': '{bad' });
    const { entries } = await loadPlugins();
    const entry = entries.find(e => e.dir === 'broken');
    assert.match(entry.loadError, /not valid JSON/);
  });

  it('ignores directories without plugin.json', async () => {
    mkdirSync(join(pluginsDir, 'random-assets'), { recursive: true });
    const { entries } = await loadPlugins();
    assert.ok(!entries.some(e => e.dir === 'random-assets'));
  });

  it('custom service.prefix is rejected in v1 (mount table routes by name)', async () => {
    writeDirPlugin('pa', {
      'plugin.json': JSON.stringify({ name: 'pa', service: { entry: 's.mjs', prefix: '/plugins/same' } }),
      's.mjs': '',
    });
    const { entries } = await loadPlugins();
    const pa = entries.find(e => e.name === 'pa');
    assert.match(pa.loadError, /service\.prefix must be \/plugins\/pa/);
    assert.equal(getServiceEntries().length, 0);
  });

  it('reload reuses module when fingerprint unchanged, reimports after change', async () => {
    writeDirPlugin('hot', {
      'plugin.json': JSON.stringify({ name: 'hot', main: 'main.mjs' }),
      'main.mjs': 'export default { name: "hot", marker: 1, hooks: {} };',
    });
    await loadPlugins();
    const gen1 = getPluginsGeneration();
    const m1 = getPluginEntries().find(e => e.name === 'hot').plugin;

    await loadPlugins();
    const m2 = getPluginEntries().find(e => e.name === 'hot').plugin;
    assert.equal(m1, m2, 'unchanged fingerprint should reuse module instance');
    assert.ok(getPluginsGeneration() > gen1);

    writeFileSync(join(pluginsDir, 'hot', 'main.mjs'), 'export default { name: "hot", marker: 2, hooks: {} };');
    await loadPlugins();
    const m3 = getPluginEntries().find(e => e.name === 'hot').plugin;
    assert.notEqual(m1, m3, 'changed fingerprint should reimport');
    assert.equal(m3.marker, 2);
  });

  it('single-file plugin behavior unchanged; service field rejected', async () => {
    writeFileSync(join(pluginsDir, 'legacy.js'), 'export default { name: "legacy", hooks: { localUrl(v) { return v; } } };');
    writeFileSync(join(pluginsDir, 'bad-single.js'), 'export default { name: "bad-single", service: {} };');
    const { entries } = await loadPlugins();
    const legacy = entries.find(e => e.name === 'legacy');
    assert.equal(legacy.shape, 'file');
    assert.equal(legacy.loadError, null);
    const bad = entries.find(e => e.name === 'bad-single');
    assert.match(bad.loadError, /single-file plugins cannot declare/);
  });

  it('getPluginsInfo includes dir plugin type and service prefix', async () => {
    writeDirPlugin('svc', {
      'plugin.json': JSON.stringify({ name: 'svc', service: { entry: 's.mjs' }, panel: { entry: 'panel/index.js', title: { en: 'Svc' } } }),
      's.mjs': '',
      'panel/index.js': '',
    });
    await loadPlugins();
    const info = getPluginsInfo().find(p => p.name === 'svc');
    assert.equal(info.type, 'service');
    assert.deepEqual(info.service, { prefix: '/plugins/svc' });
    assert.equal(info.panel.icon, 'appstore');
    assert.deepEqual(info.panel.titleI18n, { en: 'Svc' });
  });
});
