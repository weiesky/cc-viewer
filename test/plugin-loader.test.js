import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getPluginsDir,
  loadPlugins,
  runWaterfallHook,
  runParallelHook,
  getPluginsInfo,
} from '../lib/plugin-loader.js';
import { LOG_DIR } from '../findcc.js';

const PLUGINS_DIR = getPluginsDir();
const PREFS_FILE = join(LOG_DIR, 'preferences.json');

// Track files we create so we can clean up
let createdFiles = [];
let savedPrefs = null;

function writePlugin(filename, content) {
  const filePath = join(PLUGINS_DIR, filename);
  writeFileSync(filePath, content);
  createdFiles.push(filePath);
}

function writePrefs(obj) {
  if (existsSync(PREFS_FILE)) {
    savedPrefs = readFileSync(PREFS_FILE, 'utf-8');
  }
  writeFileSync(PREFS_FILE, JSON.stringify(obj));
}

function cleanup() {
  for (const f of createdFiles) {
    try { rmSync(f, { force: true }); } catch { }
  }
  createdFiles = [];
  if (savedPrefs !== null) {
    writeFileSync(PREFS_FILE, savedPrefs);
    savedPrefs = null;
  } else if (existsSync(PREFS_FILE) && savedPrefs === null) {
    // We wrote prefs but there was none before — only remove if we created it
    // Actually we track this via savedPrefs being set in writePrefs
  }
}

// ─── loadPlugins ───

describe('loadPlugins', () => {
  beforeEach(() => {
    mkdirSync(PLUGINS_DIR, { recursive: true });
  });
  afterEach(async () => {
    cleanup();
    // Reset internal state
    await loadPlugins();
  });

  it('loads a valid plugin with hooks', async () => {
    writePlugin('test-alpha.js', `
      export default {
        name: 'alpha',
        hooks: {
          localUrl(val) { return val; }
        }
      };
    `);
    await loadPlugins();
    const info = getPluginsInfo();
    const alpha = info.find(p => p.name === 'alpha');
    assert.ok(alpha, 'plugin alpha should be loaded');
    assert.deepStrictEqual(alpha.hooks, ['localUrl']);
    assert.equal(alpha.enabled, true);
  });

  it('skips disabled plugins (hooks not executed)', async () => {
    writePlugin('test-beta.js', `
      export default {
        name: 'beta',
        hooks: { localUrl(v) { return { url: v.url + '/beta' }; } }
      };
    `);
    writePrefs({ disabledPlugins: ['beta'] });
    await loadPlugins();

    // Disabled plugin's hook should NOT execute
    const result = await runWaterfallHook('localUrl', { url: 'http://x' });
    assert.equal(result.url, 'http://x', 'disabled plugin hook should not execute');
  });

  it('getPluginsInfo marks disabled plugin correctly when name matches filename', async () => {
    // When plugin name matches the filename, getPluginsInfo can resolve enabled=false
    // even for unloaded plugins (since fallback name === filename)
    writePlugin('test-gamma.js', `
      export default {
        name: 'test-gamma.js',
        hooks: { localUrl(v) { return v; } }
      };
    `);
    writePrefs({ disabledPlugins: ['test-gamma.js'] });
    await loadPlugins();
    const info = getPluginsInfo();
    const gamma = info.find(p => p.file === 'test-gamma.js');
    assert.ok(gamma);
    assert.equal(gamma.enabled, false);
  });

  it('skips files without hooks object', async () => {
    writePlugin('test-nohook.js', `
      export default { name: 'nohook' };
    `);
    await loadPlugins();
    const info = getPluginsInfo();
    const nh = info.find(p => p.file === 'test-nohook.js');
    assert.ok(nh);
    assert.deepStrictEqual(nh.hooks, []);
  });

  it('handles empty plugins directory', async () => {
    await loadPlugins();
    const info = getPluginsInfo();
    // Should not throw, may have other plugins from user's real dir
    assert.ok(Array.isArray(info));
  });

  it('uses filename as name when plugin.name is missing', async () => {
    writePlugin('test-unnamed.js', `
      export default {
        hooks: { serverStarted() {} }
      };
    `);
    await loadPlugins();
    const info = getPluginsInfo();
    const unnamed = info.find(p => p.file === 'test-unnamed.js');
    assert.ok(unnamed);
    assert.equal(unnamed.name, 'test-unnamed.js');
  });

  it('only loads .js and .mjs files', async () => {
    writePlugin('test-valid.mjs', `
      export default { name: 'mjs-plugin', hooks: { localUrl(v) { return v; } } };
    `);
    const txtPath = join(PLUGINS_DIR, 'test-ignore.txt');
    writeFileSync(txtPath, 'not a plugin');
    createdFiles.push(txtPath);

    await loadPlugins();
    const info = getPluginsInfo();
    assert.ok(info.find(p => p.file === 'test-valid.mjs'), '.mjs should be loaded');
    assert.ok(!info.find(p => p.file === 'test-ignore.txt'), '.txt should be ignored');
  });

  it('handles plugin with syntax error gracefully (not loaded)', async () => {
    writePlugin('test-bad.js', `
      export default {
        name: 'bad-plugin',
        hooks: { localUrl(v) { return { url: v.url + '/bad' }; } }
    `);
    await loadPlugins();
    const info = getPluginsInfo();
    const bad = info.find(p => p.file === 'test-bad.js');
    assert.ok(bad);
    assert.equal(bad.name, 'bad-plugin');
    assert.deepStrictEqual(bad.hooks, []);
  });
});

// ─── runWaterfallHook ───

describe('runWaterfallHook', () => {
  beforeEach(() => {
    mkdirSync(PLUGINS_DIR, { recursive: true });
  });
  afterEach(async () => {
    cleanup();
    await loadPlugins();
  });

  it('returns initial value when no plugins loaded', async () => {
    await loadPlugins();
    // Remove test plugins so only empty state
    const result = await runWaterfallHook('localUrl', { url: 'http://localhost:3000' });
    assert.ok(result.url, 'should preserve initial value');
  });

  it('pipes value through multiple plugins in order', async () => {
    writePlugin('test-wf-01.js', `
      export default {
        name: 'wf1',
        hooks: {
          localUrl(val) { return { url: val.url + '/a' }; }
        }
      };
    `);
    writePlugin('test-wf-02.js', `
      export default {
        name: 'wf2',
        hooks: {
          localUrl(val) { return { url: val.url + '/b' }; }
        }
      };
    `);
    await loadPlugins();
    const result = await runWaterfallHook('localUrl', { url: 'http://x' });
    assert.equal(result.url, 'http://x/a/b');
  });

  it('skips plugins that do not define the hook', async () => {
    writePlugin('test-wf-skip.js', `
      export default {
        name: 'wf-skip',
        hooks: {
          serverStarted() {}
        }
      };
    `);
    writePlugin('test-wf-has.js', `
      export default {
        name: 'wf-has',
        hooks: {
          localUrl(val) { return { url: val.url + '/yes' }; }
        }
      };
    `);
    await loadPlugins();
    const result = await runWaterfallHook('localUrl', { url: 'http://x' });
    assert.equal(result.url, 'http://x/yes');
  });

  it('continues on plugin error', async () => {
    writePlugin('test-wf-err.js', `
      export default {
        name: 'wf-err',
        hooks: {
          localUrl() { throw new Error('boom'); }
        }
      };
    `);
    writePlugin('test-wf-ok.js', `
      export default {
        name: 'wf-ok',
        hooks: {
          localUrl(val) { return { url: val.url + '/ok' }; }
        }
      };
    `);
    await loadPlugins();
    const result = await runWaterfallHook('localUrl', { url: 'http://x' });
    assert.equal(result.url, 'http://x/ok');
  });

  it('ignores null/undefined return from a hook', async () => {
    writePlugin('test-wf-null.js', `
      export default {
        name: 'wf-null',
        hooks: {
          localUrl() { return null; }
        }
      };
    `);
    await loadPlugins();
    const result = await runWaterfallHook('localUrl', { url: 'http://x' });
    assert.equal(result.url, 'http://x');
  });
});

// ─── httpsOptions hook ───

describe('httpsOptions waterfall hook', () => {
  beforeEach(() => {
    mkdirSync(PLUGINS_DIR, { recursive: true });
  });
  afterEach(async () => {
    cleanup();
    await loadPlugins();
  });

  it('returns object when no test plugins provide https options', async () => {
    await loadPlugins();
    const result = await runWaterfallHook('httpsOptions', {});
    assert.ok(typeof result === 'object' && result !== null, 'should return an object');
  });

  it('returns pfx-based https options from plugin', async () => {
    writePlugin('test-https-pfx.js', `
      export default {
        name: 'https-pfx',
        hooks: {
          async httpsOptions() {
            return { pfx: Buffer.from('fake-pfx'), passphrase: 'test' };
          }
        }
      };
    `);
    await loadPlugins();
    const result = await runWaterfallHook('httpsOptions', {});
    assert.ok(result.pfx, 'should have pfx');
    assert.equal(result.passphrase, 'test');
  });

  it('returns cert-based https options from plugin', async () => {
    writePlugin('test-https-cert.js', `
      export default {
        name: 'https-cert',
        hooks: {
          async httpsOptions() {
            return { cert: 'fake-cert', key: 'fake-key' };
          }
        }
      };
    `);
    await loadPlugins();
    const result = await runWaterfallHook('httpsOptions', {});
    assert.equal(result.cert, 'fake-cert');
    assert.equal(result.key, 'fake-key');
  });

  it('continues on plugin error and returns initial value', async () => {
    writePlugin('test-https-err.js', `
      export default {
        name: 'https-err',
        hooks: {
          async httpsOptions() { throw new Error('cert load failed'); }
        }
      };
    `);
    await loadPlugins();
    const result = await runWaterfallHook('httpsOptions', {});
    // 插件抛错时 waterfall 应跳过该插件继续执行，不应抛出异常
    assert.ok(typeof result === 'object', 'should return an object');
  });
});

// ─── runParallelHook ───

describe('runParallelHook', () => {
  beforeEach(() => {
    mkdirSync(PLUGINS_DIR, { recursive: true });
  });
  afterEach(async () => {
    cleanup();
    await loadPlugins();
  });

  it('runs all hooks in parallel without throwing', async () => {
    writePlugin('test-ph-a.js', `
      export default {
        name: 'ph-a',
        hooks: { serverStarted() {} }
      };
    `);
    writePlugin('test-ph-b.js', `
      export default {
        name: 'ph-b',
        hooks: { serverStarted() { throw new Error('fail'); } }
      };
    `);
    await loadPlugins();
    // Should not throw even if one plugin errors
    await assert.doesNotReject(() => runParallelHook('serverStarted', { port: 3000 }));
  });

  it('completes even with no plugins', async () => {
    await loadPlugins();
    await assert.doesNotReject(() => runParallelHook('serverStopping'));
  });
});

// ─── getPluginsInfo ───

describe('getPluginsInfo', () => {
  beforeEach(() => {
    mkdirSync(PLUGINS_DIR, { recursive: true });
  });
  afterEach(async () => {
    cleanup();
    await loadPlugins();
  });

  it('returns array with correct shape', async () => {
    writePlugin('test-info.js', `
      export default {
        name: 'info-plugin',
        hooks: { localUrl(v) { return v; }, serverStarted() {} }
      };
    `);
    await loadPlugins();
    const info = getPluginsInfo();
    const p = info.find(i => i.name === 'info-plugin');
    assert.ok(p);
    assert.equal(typeof p.name, 'string');
    assert.equal(typeof p.file, 'string');
    assert.ok(Array.isArray(p.hooks));
    assert.equal(typeof p.enabled, 'boolean');
    assert.ok(p.hooks.includes('localUrl'));
    assert.ok(p.hooks.includes('serverStarted'));
  });

  it('returns empty array when plugins dir does not exist', async () => {
    // Temporarily remove the dir
    const tmpDir = PLUGINS_DIR + '-bak-' + Date.now();
    try {
      const { renameSync } = await import('node:fs');
      renameSync(PLUGINS_DIR, tmpDir);
      const info = getPluginsInfo();
      assert.deepStrictEqual(info, []);
      renameSync(tmpDir, PLUGINS_DIR);
    } catch {
      // If rename fails (dir doesn't exist), just check empty
      if (!existsSync(PLUGINS_DIR)) {
        const info = getPluginsInfo();
        assert.deepStrictEqual(info, []);
      }
    }
  });
});
