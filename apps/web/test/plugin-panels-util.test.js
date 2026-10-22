import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import './_shims/register.mjs';

// pluginPanels.js needs window (getBasePath/apiUrl) and fetch - node:test injects globalThis.window
// and a controllable fetch stub. i18n's getLang runs detectLanguage() at load and safely returns the default.

let fetchCalls;
let fetchResponder;
const _realFetch = globalThis.fetch; // R2 discipline: save and restore in after()

beforeEach(() => {
  globalThis.window = {
    location: { search: '', protocol: 'http:', host: 'test.local' },
  };
  globalThis.document = {
    querySelector: () => null,
  };
  fetchCalls = [];
  fetchResponder = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ panels: [{ name: 'demo', entryUrl: '/plugin-panels/demo/index.js?v=1', titleI18n: { en: 'Demo', zh: '演示' }, icon: 'api', width: 900, desktopOnly: false, prefix: '/plugins/demo', panelStatus: 'ready', serviceStatus: 'ready' }], basePath: '' }),
  });
  globalThis.fetch = (...args) => {
    fetchCalls.push(args);
    return fetchResponder(...args);
  };
});

after(() => {
  globalThis.fetch = _realFetch;
  delete globalThis.window;
  delete globalThis.document;
});

async function freshModule() {
  // Break the module cache with a query each time to get independent cache state
  const url = new URL('../src/utils/pluginPanels.js', import.meta.url);
  url.search = `?t=${Date.now()}-${Math.random()}`;
  return import(url.href);
}

describe('pluginPanels utils', () => {
  it('fetchPluginPanels caches within TTL and dedups in-flight', async () => {
    const mod = await freshModule();
    const [r1, r2] = await Promise.all([mod.fetchPluginPanels(), mod.fetchPluginPanels()]);
    assert.equal(r1.panels.length, 1);
    assert.equal(fetchCalls.length, 1, 'in-flight 合并');
    const r3 = await mod.fetchPluginPanels();
    assert.equal(fetchCalls.length, 1, 'TTL 内命中缓存');
    await new Promise(r => setTimeout(r, 10));
    const r4 = await mod.fetchPluginPanels({ force: true });
    assert.equal(fetchCalls.length, 2, 'force 绕过缓存');
  });

  it('failed fetch keeps last successful list', async () => {
    const mod = await freshModule();
    await mod.fetchPluginPanels();
    fetchResponder = () => Promise.reject(new Error('network down'));
    const r = await mod.fetchPluginPanels({ force: true });
    assert.equal(r.panels.length, 1, '失败保留上一次成功列表');
    assert.ok(r.error, '错误透传');
  });

  it('invalidatePluginPanels forces next fetch', async () => {
    const mod = await freshModule();
    await mod.fetchPluginPanels();
    mod.invalidatePluginPanels();
    await mod.fetchPluginPanels();
    assert.equal(fetchCalls.length, 2);
  });

  it('panelAssetUrl rejects absolute/protocol-relative/data URLs', async () => {
    const mod = await freshModule();
    assert.equal(mod.panelAssetUrl('https://evil.com/x.js'), null);
    assert.equal(mod.panelAssetUrl('//evil.com/x.js'), null);
    assert.equal(mod.panelAssetUrl('data:text/javascript,alert(1)'), null);
    assert.match(mod.panelAssetUrl('/plugin-panels/demo/index.js?v=1'), /\/plugin-panels\/demo\/index\.js\?v=1$/);
  });

  it('pluginApiUrl/pluginWsUrl build from prefix; ws uses appendToken', async () => {
    // apiUrl/appendToken capture the token from window.location.search at module load.
    // This test verifies URL structure (token presence depends on apiUrl's capture timing; covered separately).
    const mod = await freshModule();
    const panel = { prefix: '/plugins/demo' };
    assert.match(mod.pluginApiUrl(panel, '/hello'), /\/plugins\/demo\/hello/);
    const ws = mod.pluginWsUrl(panel, '/ws');
    assert.match(ws, /^ws:\/\/test\.local\/plugins\/demo\/ws/);
    assert.equal(mod.pluginApiUrl({ prefix: null }, '/x'), null);
  });

  it('appendToken appends the captured token with the correct separator', async () => {
    // apiUrl captures the token at module load from window.location.search, so each case
    // needs a fresh module instance with its own captured value.
    globalThis.window.location.search = '?token=abc';
    const withToken = new URL('../src/utils/apiUrl.js', import.meta.url);
    withToken.search = `?captured=${Date.now()}-${Math.random()}`;
    const { appendToken } = await import(withToken.href);
    assert.equal(
      appendToken('ws://test.local/plugins/demo/ws'),
      'ws://test.local/plugins/demo/ws?token=abc',
      'no existing query -> ?token=',
    );
    assert.equal(
      appendToken('ws://test.local/plugins/demo/ws?x=1'),
      'ws://test.local/plugins/demo/ws?x=1&token=abc',
      'existing query -> &token=',
    );

    globalThis.window.location.search = '';
    const withoutToken = new URL('../src/utils/apiUrl.js', import.meta.url);
    withoutToken.search = `?fresh=${Date.now()}-${Math.random()}`;
    const mod = await import(withoutToken.href);
    assert.equal(mod.appendToken('ws://test.local/x'), 'ws://test.local/x', 'no token -> unchanged');
  });

  it('panelTitle resolves localized title at call time', async () => {
    const mod = await freshModule();
    const title = mod.panelTitle({ name: 'demo', titleI18n: { en: 'Demo EN', zh: '演示' } });
    assert.ok(['Demo EN', '演示'].includes(title));
    assert.equal(mod.panelTitle({ name: 'fallback' }), 'fallback');
  });
});
