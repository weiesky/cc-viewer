/**
 * Per-session proxy hot-switch — frontend source-contract test.
 *
 * Pins the contract that a proxy change defaults to the CURRENT session (scope:'session'
 * + the viewed instanceKey), a "set as global default" path exists, view/instance switches
 * reload that session's proxy view, and the SSE handler never lets another session's frame
 * clobber the one being viewed. apps/web has no renderer, so these are source greps.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const modal = readFileSync(join(__dirname, '..', 'src', 'components', 'settings', 'ProxyModal.jsx'), 'utf8');
const appBase = readFileSync(join(__dirname, '..', 'src', 'AppBase.jsx'), 'utf8');
const i18n = readFileSync(join(__dirname, '..', 'src', 'i18n.js'), 'utf8');

describe('ProxyModal — session-scoped proxy change', () => {
  it('activating a profile defaults to the current session scope', () => {
    assert.ok(modal.includes("onProxyProfileChange({ active: p.id, profiles, scope: 'session' })"), 'list radio / activate → scope:session');
    assert.ok(modal.includes("onProxyProfileChange({ active: id, profiles, scope: 'session' })"), 'main-role Select → scope:session');
  });
  it('role assignment follows the session scope', () => {
    assert.ok(modal.includes("onProxyProfileChange({ scope: 'session', profiles, roles: { [role]: value } })"), 'role change → scope:session');
  });
  it('a "set as global default" path exists (scope:global)', () => {
    assert.ok(modal.includes("scope: 'global', active: activeId"), 'global-default action present');
    assert.ok(modal.includes("t('ui.proxy.setGlobalDefault')"), 'global-default button label');
    assert.ok(modal.includes("t('ui.proxy.globalDefaultHint')"), 'global-default hint');
  });
  it('list save / import refresh do not carry an active id (no accidental scope write)', () => {
    assert.ok(modal.includes('onProxyProfileChange({ profiles: newProfiles })'), 'save → profiles only');
    assert.ok(modal.includes('onProxyProfileChange({ profiles: pd.profiles })'), 'ccswitch refresh → profiles only');
  });
});

describe('AppBase — per-session proxy wiring', () => {
  it('resolves the viewed session instanceKey with a global fallback', () => {
    assert.ok(appBase.includes('_proxyInstanceKey = () =>'), 'instanceKey resolver exists');
    assert.ok(appBase.includes('this.state.viewedInstance'), 'viewedInstance wins');
    // Bound view falls back to the server-resolved bound instance (currentInstanceKey),
    // so a single-session bound view can still be addressed (the P0 fix).
    assert.ok(appBase.includes('this._boundInstanceKey'), 'bound view uses the server-resolved instanceKey');
  });
  it('loads proxy profiles per instance with an out-of-order guard', () => {
    assert.ok(appBase.includes('_loadProxyProfiles = (instanceKey'), 'per-instance loader');
    assert.ok(appBase.includes("`/api/proxy-profiles' + q") || appBase.includes("/api/proxy-profiles' + q") || appBase.includes("?instanceKey="), 'instanceKey query param');
    assert.ok(appBase.includes('seq !== this._proxyLoadSeq'), 'stale-response guard');
  });
  it('handleProxyProfileChange injects instanceKey for session scope and degrades without one', () => {
    assert.ok(appBase.includes("if (body.scope === 'session')"), 'session scope branch');
    assert.ok(appBase.includes("body.instanceKey = key"), 'injects the instanceKey');
    assert.ok(appBase.includes("body.scope = 'global'"), 'degrades to global without a resolvable instance');
  });
  it('reloads the proxy view on session/activation switches', () => {
    // Directly assert each hook calls the loader with the right argument — a generous
    // window avoids coupling to how long each handler happens to be.
    assert.ok(appBase.includes('this._loadProxyProfiles(chipInstance);'), 'handleActivateChip reloads for the chip instance');
    assert.ok(appBase.includes('this._loadProxyProfiles(instance || null);'), '_bootViewedWorkspace reloads the restored instance');
    assert.ok(appBase.includes('this._loadProxyProfiles(null);'), 'handleReturnToWorkspaces reloads the global view');
    // detach + attach reload via the resolver (no explicit arg).
    const detachStart = appBase.indexOf('handleDetachView = ');
    assert.ok(detachStart >= 0 && appBase.slice(detachStart, detachStart + 3000).includes('this._loadProxyProfiles('), 'handleDetachView reloads the bound view');
    const attachStart = appBase.indexOf('_applyViewAttach = ');
    assert.ok(attachStart >= 0 && appBase.slice(attachStart, attachStart + 3000).includes('this._loadProxyProfiles('), '_applyViewAttach reloads the attached view');
  });
  it('the SSE handler ignores a frame addressed to a different session and re-fetches as truth', () => {
    assert.ok(appBase.includes('data.instanceKey && data.instanceKey !== myKey'), 'drops other-session frames');
    assert.ok(appBase.includes('this._loadProxyProfiles(myKey)'), 're-fetches the current session view');
  });
});

describe('per-session proxy i18n — all 18 locales', () => {
  const LOCALES = ['zh', 'en', 'zh-TW', 'ko', 'ja', 'de', 'es', 'fr', 'it', 'da', 'pl', 'ru', 'ar', 'no', 'pt-BR', 'th', 'tr', 'uk'];
  for (const key of ['setGlobalDefault', 'globalDefaultHint', 'globalDefaultSet']) {
    it(`ui.proxy.${key} translated in every locale`, () => {
      const m = i18n.match(new RegExp(`"ui\\.proxy\\.${key}": \\{([\\s\\S]*?)\\n  \\}`));
      assert.ok(m, `missing ui.proxy.${key}`);
      for (const locale of LOCALES) assert.ok(m[1].includes(`"${locale}":`), `${key} missing ${locale}`);
    });
  }
});
