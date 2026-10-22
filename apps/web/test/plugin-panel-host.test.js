/**
 * Source-anchor guards for PanelHost / PluginPanelModal / menu wiring.
 * The repo's web test suite has no DOM/jsdom — component behavior is guarded by
 * exact source anchors (same pattern as modal-mask.test.js), while loadable units
 * (panelLoader, pluginPanels utils) get real unit tests.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf-8');

const panelHost = read('src/components/plugins/PanelHost.jsx');
const panelModal = read('src/components/plugins/PluginPanelModal.jsx');
const appHeader = read('src/components/dashboard/AppHeader.jsx');
const mobile = read('src/Mobile.jsx');
const appBase = read('src/AppBase.jsx');
const pluginModal = read('src/components/settings/PluginModal.jsx');

describe('PanelHost anchors', () => {
  it('has an ErrorBoundary with derived state + reportSwallowed', () => {
    assert.ok(panelHost.includes('getDerivedStateFromError'), 'ErrorBoundary 必须有 getDerivedStateFromError');
    assert.ok(panelHost.includes("reportSwallowed('plugin-panel.render'"), 'render 错误必须接 reportSwallowed');
  });

  it('wraps the panel in antd <App component={false}> for App.useApp() context', () => {
    assert.ok(panelHost.includes('AntApp component={false}') || panelHost.includes('<AntApp component={false}>'), 'App.useApp() 上下文兜底');
  });

  it('boundary key includes name, version and attempt (retry re-executes bundle)', () => {
    assert.ok(/key=\{`\$\{panel\.name\}@\$\{panel\.version[^}]*\}#\$\{attempt\}`\}/.test(panelHost), 'boundary key 必须含 name@version#attempt');
  });

  it('passes the panel contract props without token/t', () => {
    for (const prop of ['pluginApiUrl', 'pluginWsUrl', 'assetBaseUrl', 'apiVersion', 'hostVersion', 'onClose']) {
      assert.ok(panelHost.includes(prop), `props 缺 ${prop}`);
    }
    assert.ok(!panelHost.includes('token:'), '不得把 token 当 prop 传');
  });

  it('reloads bundle on attempt change (effect dep includes attempt)', () => {
    assert.ok(/\[panel\.name, panel\.entryUrl, panel\.cssUrl, attempt\]/.test(panelHost), 'effect 依赖必须含 attempt');
  });

  it('aborts the pending load on cleanup (unmount/panel switch)', () => {
    assert.ok(panelHost.includes('pending.abort?.()'), 'cleanup must abort the loader wait');
  });
});

describe('PluginPanelModal anchors', () => {
  it('desktop uses antd Modal with destroyOnHidden + BLUR_MASK_STYLE', () => {
    assert.ok(panelModal.includes('destroyOnHidden'), 'antd 5.29 已弃用 destroyOnClose');
    assert.ok(panelModal.includes('BLUR_MASK_STYLE'), '必须复用统一毛玻璃遮罩');
  });

  it('mobile uses mobileDrawerOverlay + mobilePluginPanelBody (not the zoom inner)', () => {
    assert.ok(panelModal.includes('mobileDrawerOverlay'), '移动容器必须是 mobileDrawerOverlay');
    assert.ok(panelModal.includes('mobilePluginPanelBody'), '移动 body 必须用无 zoom 的 mobilePluginPanelBody');
    assert.ok(!panelModal.includes('mobileDrawerInner'), '不得复用 zoom:0.6 的 mobileDrawerInner');
  });

  it('mounts PanelHost only while open (close = full unmount)', () => {
    assert.ok(panelModal.includes('{open && panel && ('), 'open 时才挂 PanelHost');
  });

  it('shows a non-blocking Alert when serviceStatus is not ready', () => {
    assert.ok(panelModal.includes('serviceNotReady'), 'service 未 ready 需要提示条');
  });

  it('keys focus/Escape effects on [open] only and reads onClose through a ref', () => {
    assert.ok(!panelModal.includes('[open, onClose]'), 'onClose must not be an effect dep (inline identity each render)');
    assert.equal(panelModal.match(/\}, \[open\]\);/g)?.length, 2, 'focus and Escape must be two [open]-only effects');
    assert.ok(panelModal.includes('onCloseRef.current = onClose'), 'latest onClose must be captured in a ref');
    assert.ok(panelModal.includes('onCloseRef.current?.()'), 'Escape must call the ref');
  });

  it('removes the off-screen container from focus order (inert + tabIndex)', () => {
    assert.match(panelModal, /inert=\{open \? undefined : ''\}/, 'closed overlay must be inert (translateX alone is not hidden)');
    assert.ok(panelModal.includes('tabIndex={open ? 0 : -1}'), 'close button must leave the tab order when closed');
  });
});

describe('Mobile plugin panel wiring', () => {
  it('passes a stable close handler instead of an inline arrow', () => {
    assert.ok(mobile.includes('_handlePluginPanelClose = () =>'), 'Mobile needs a stable class-field close handler');
    assert.ok(mobile.includes('onClose={this._handlePluginPanelClose}'), 'PluginPanelModal must receive the stable handler');
  });
});

describe('menu wiring anchors', () => {
  it('AppBase installs the panel runtime before any panel bundle', () => {
    assert.ok(appBase.includes("import './components/plugins/panelRuntime'"), 'AppBase 必须顶层安装 panelRuntime');
  });

  it('AppHeader inserts plugin-panel descriptors after plugin-management', () => {
    const idxMgmt = appHeader.indexOf("key: 'plugin-management'");
    const idxPanel = appHeader.indexOf('...panelDescriptors');
    assert.ok(idxMgmt > 0 && idxPanel > idxMgmt, 'plugin-panel 描述符必须插在 plugin-management 之后');
    assert.ok(appHeader.includes('plugin-panel:'), '动态 key 前缀 plugin-panel:');
  });

  it('AppHeader refreshes panels on mount, menu open and PluginModal close', () => {
    assert.ok(appHeader.includes('this._refreshPluginPanels()'), 'mount/菜单打开刷新');
    assert.ok(appHeader.includes('invalidatePluginPanels()'), 'PluginModal 关闭后 invalidate');
  });

  it('Mobile closes the panel in _closeAllMobileOverlays and hides desktopOnly', () => {
    assert.ok(mobile.includes('activePluginPanel: null,'), '_closeAllMobileOverlays 必须含 activePluginPanel');
    assert.ok(mobile.includes('!p.desktopOnly'), 'desktopOnly 面板在移动端隐藏');
  });

  it('PluginModal offers restart for service plugins and dir deletion', () => {
    assert.ok(pluginModal.includes('/api/plugins/restart?name='), 'restart 按钮');
    assert.ok(pluginModal.includes('dir=${encodeURIComponent(dir)}'), '目录插件删除走 ?dir=');
    assert.ok(pluginModal.includes('ui.plugins.serviceHint'), '服务插件目录安装提示');
  });
});
