/**
 * sdk-model-wiring.test.js — source-contract test for the SDK launch-model chip lift chain.
 *
 * Render-level tests can't run under node:test, so (following minimal-chat-wiring.test.js)
 * we assert the JSX wiring directly. This pins the otherwise-untested seams of the
 * sdkModel fallback feature — deleting any one of them (the SCU whitelist row, the
 * onSdkModel passthrough, the lift call, or the fallback render branch) would silently
 * break the chip while every pure-function test stays green. The guard's truth-table is
 * unit-tested separately in sdk-model-chip.test.js; this file pins the WIRING.
 *
 * Migration (2026-10-22): the chip moved out of AppHeader into the chat input bar —
 * ChatView builds the <ProxyChip> node and threads it into ChatInputBar's `proxyChip`
 * slot. App.jsx / Mobile.jsx now feed the proxy props to ChatView instead of AppHeader.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(__dirname, '..', 'src', ...p), 'utf-8');

const chatView = src('components', 'chat', 'ChatView.jsx');
const chatInputBar = src('components', 'chat', 'ChatInputBar.jsx');
const appJsx = src('App.jsx');
const mobileJsx = src('Mobile.jsx');
const proxyModal = src('components', 'settings', 'ProxyModal.jsx');
const appBase = src('AppBase.jsx');
const appHeader = src('components', 'dashboard', 'AppHeader.jsx');

describe('sdkModel chip — lift wiring (ChatView input-bar host)', () => {
  it('ChatView lifts the model via onSdkModel from the sdk-init handler', () => {
    assert.ok(/const model = msg\.model \|\| null;/.test(chatView), 'sdk-init extracts model');
    assert.ok(chatView.includes("if (typeof this.props.onSdkModel === 'function') this.props.onSdkModel(model);"),
      'sdk-init handler raises onSdkModel(model)');
  });

  it('ChatView no longer keeps a local state.sdkModel (AppBase is the single source)', () => {
    assert.ok(!/sdkModel:/.test(chatView), 'ChatView state must not duplicate sdkModel');
  });

  it('AppBase owns sdkModel state + handleSdkModel + clears it on workspace switch and resume-attach', () => {
    assert.ok(/sdkModel: null,/.test(appBase), 'AppBase state init');
    assert.ok(/handleSdkModel = \(model\) => \{ this\.setState\(\{ sdkModel/.test(appBase), 'handleSdkModel setter');
    // Cleared in the workspace_started reset and in _applyViewAttach (resume-switch window).
    const clears = appBase.match(/sdkModel: null/g) || [];
    assert.ok(clears.length >= 3, `sdkModel cleared at init + workspace_started + _applyViewAttach (found ${clears.length})`);
  });

  it('App.jsx passes sdkModel + proxy props to ChatView, and onSdkModel too', () => {
    assert.ok(appJsx.includes('sdkModel={this.state.sdkModel}'), 'ChatView receives sdkModel');
    assert.ok(appJsx.includes('onSdkModel={this.handleSdkModel}'), 'ChatView receives onSdkModel');
    assert.ok(appJsx.includes('proxyProfiles={this.state.proxyProfiles}'), 'ChatView receives proxyProfiles');
    assert.ok(appJsx.includes('onProxyProfileChange={this.handleProxyProfileChange}'), 'ChatView receives onProxyProfileChange');
  });

  it('Mobile.jsx passes sdkModel + proxy props to ChatView (iPad shows the chip)', () => {
    assert.ok(mobileJsx.includes('sdkModel={this.state.sdkModel}'), 'Mobile ChatView receives sdkModel');
    assert.ok(mobileJsx.includes('proxyProfiles={this.state.proxyProfiles}'), 'Mobile ChatView receives proxyProfiles');
    assert.ok(mobileJsx.includes('onProxyProfileChange={this.handleProxyProfileChange}'), 'Mobile ChatView receives onProxyProfileChange');
  });

  it('Mobile.jsx lifts the launch model too (else iPad SDK fallback never renders)', () => {
    // sdkModel's only writer is ChatView's sdk-init → onSdkModel → AppBase.handleSdkModel.
    // Without this prop on the Mobile tree, sdkModel stays null and the fallback chip is
    // permanently hidden on iPad — the migration's headline platform.
    assert.ok(mobileJsx.includes('onSdkModel={this.handleSdkModel}'),
      'Mobile ChatView must receive onSdkModel so sdkModel is populated');
  });

  it('ChatView owns the ProxyModal opened by the chip (presentational chip delegates the click)', () => {
    assert.ok(chatView.includes('proxyModalVisible'), 'ChatView holds proxyModalVisible state');
    assert.ok(/onOpenProxyModal=\{[^}]*proxyModalVisible: true/.test(chatView) || chatView.includes("onOpenProxyModal={() => this.setState({ proxyModalVisible: true })}"),
      'chip click opens the modal');
    assert.ok(/import ProxyModal from '\.\.\/settings\/ProxyModal';/.test(chatView), 'ChatView imports ProxyModal');
    assert.ok(chatView.includes('<ProxyModal'), 'ChatView mounts ProxyModal');
    assert.ok(/<ProxyModal[\s\S]*?onProxyProfileChange=\{this\.props\.onProxyProfileChange\}/.test(chatView),
      'ProxyModal receives onProxyProfileChange so edits actually persist');
  });

  it('ChatView does not mount a duplicate ProxyModal on pure-mobile (chip is hidden there)', () => {
    // The pure-phone shell keeps its own full-screen ProxyModal (Mobile.jsx hamburger menu);
    // the chip's modal must not be a second always-mounted drawer in the tab order.
    assert.ok(/!\(isMobile && !isPad\) && \([\s\S]*?<ProxyModal/.test(chatView),
      'ProxyModal mount is gated to non-pure-mobile (PC/iPad)');
  });

  it('ChatView whitelists the proxy/model props in shouldComponentUpdate (else the chip never re-renders)', () => {
    for (const prop of ['sdkMode', 'sdkModel', 'proxyProfiles', 'activeProxyId', 'proxyRoles', 'proxyOfficialDefault']) {
      assert.ok(chatView.includes(`nextProps.${prop} !== this.props.${prop} ||`),
        `SCU must list ${prop} or the chip stays frozen`);
    }
  });

  it('ChatView builds the ProxyChip and threads it into ChatInputBar via the proxyChip prop', () => {
    assert.ok(/import ProxyChip from '\.\/ProxyChip';/.test(chatView), 'ChatView imports ProxyChip');
    assert.ok(chatView.includes('<ProxyChip'), 'ChatView renders a ProxyChip node');
    assert.ok(/proxyChip=\{proxyChipNode\}/.test(chatView),
      'ChatView threads the chip into ChatInputBar');
  });

  it('input-bar chip shows in SDK mode / PTY-terminal-closed; hidden on pure-mobile and Electron tab', () => {
    // Gate is (sdkMode || !terminalVisible) && !(isMobile && !isPad) && !isElectronTab: the input-bar
    // chip hides while the PTY terminal is open (input bar unmounted — the Header fallback covers it).
    assert.ok(/sdkMode \|\| !terminalVisible/.test(chatView), 'covers --sdk and PTY-terminal-closed');
    assert.ok(/!\(isMobile && !isPad\)/.test(chatView), 'pure mobile (isMobile && !isPad) is excluded');
    assert.ok(/!isElectronTab/.test(chatView), 'Electron native-tab mode is excluded (tab bar has a proxy button)');
  });

  it('AppHeader re-renders the chip as a fallback ONLY while the PTY terminal is open', () => {
    // PTY terminal open unmounts the input bar, so the chip would vanish without a header fallback.
    assert.ok(appHeader.includes('_renderProxyChip'), 'AppHeader keeps _renderProxyChip as fallback');
    assert.ok(appHeader.includes('shouldRenderSdkModelChip'), 'AppHeader keeps the SDK-chip guard');
    assert.ok(/terminalVisible && !this\.props\.sdkMode && this\._renderProxyChip\(\)/.test(appHeader),
      'header chip gated to PTY-terminal-open (not sdkMode)');
    assert.ok(/nextProps\.sdkModel !== this\.props\.sdkModel/.test(appHeader), 'AppHeader SCU whitelists sdkModel');
    assert.ok(appJsx.includes('sdkModel={this.state.sdkModel}'), 'App.jsx feeds sdkModel to AppHeader');
  });

  it('ChatInputBar renders the proxyChip slot between the Enter hint and the send button', () => {
    assert.ok(chatInputBar.includes('proxyChip'), 'ChatInputBar accepts the proxyChip prop');
    const hintIdx = chatInputBar.indexOf('styles.chatInputHint');
    const slotIdx = chatInputBar.indexOf('styles.proxyChipSlot');
    const sendIdx = chatInputBar.indexOf('styles.sendBtnWrap');
    assert.ok(hintIdx > -1 && slotIdx > -1 && sendIdx > -1, 'hint, slot and send button all present');
    assert.ok(hintIdx < slotIdx && slotIdx < sendIdx, 'slot sits between hint and send button');
  });

  it('ProxyModal mobile drawer portals to body only on iPad (phones stay in-tree for the keyboard lock)', () => {
    // iPad: portal to body so the drawer clears the chat column's containing block and covers the
    // top Mobile nav. Phones (isMobile && !isPad) must NOT portal — Mobile pins the root to
    // position:fixed at the visualViewport offset to fight the soft keyboard, and a body-portaled
    // drawer would escape that lock. Also: closed drawer must leave the tab order / a11y tree.
    assert.ok(/isPad \? ReactDOM\.createPortal\(drawer, document\.body\) : drawer/.test(proxyModal),
      'portal is gated to isPad; phones render in-tree');
    assert.ok(/inert=\{!open/.test(proxyModal) && /aria-hidden=\{!open\}/.test(proxyModal),
      'closed drawer is inert + aria-hidden (out of tab order / a11y tree)');
  });
});
