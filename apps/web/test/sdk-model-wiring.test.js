/**
 * sdk-model-wiring.test.js — source-contract test for the SDK launch-model chip lift chain.
 *
 * Render-level tests can't run under node:test, so (following minimal-chat-wiring.test.js)
 * we assert the JSX wiring directly. This pins the otherwise-untested seams of the
 * sdkModel fallback feature — deleting any one of them (the SCU whitelist row, the
 * onSdkModel passthrough, the lift call, or the fallback render branch) would silently
 * break the chip while every pure-function test stays green. The guard's truth-table is
 * unit-tested separately in sdk-model-chip.test.js; this file pins the WIRING.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(__dirname, '..', 'src', ...p), 'utf-8');

const chatView = src('components', 'chat', 'ChatView.jsx');
const appJsx = src('App.jsx');
const appBase = src('AppBase.jsx');
const appHeader = src('components', 'dashboard', 'AppHeader.jsx');

describe('sdkModel chip — lift wiring', () => {
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

  it('App.jsx passes sdkModel to AppHeader and onSdkModel to ChatView', () => {
    assert.ok(appJsx.includes('sdkModel={this.state.sdkModel}'), 'AppHeader receives sdkModel');
    assert.ok(appJsx.includes('onSdkModel={this.handleSdkModel}'), 'ChatView receives onSdkModel');
  });

  it('AppHeader whitelists sdkModel in shouldComponentUpdate (else the chip never re-renders)', () => {
    assert.ok(appHeader.includes('nextProps.sdkModel !== this.props.sdkModel ||'),
      'SCU must list sdkModel or the chip stays frozen');
  });

  it('AppHeader renders the SDK chip only as a fallback, non-clickable, in its own class', () => {
    assert.ok(appHeader.includes('shouldRenderSdkModelChip'), 'uses the pure guard');
    assert.ok(/className=\{styles\.sdkModelTag\}/.test(appHeader), 'SDK chip uses sdkModelTag (not proxyProfileTag)');
    // The SDK chip Tag must NOT open the proxy modal (read-only hint).
    const sdkChip = appHeader.match(/<Tag className=\{styles\.sdkModelTag\}[\s\S]*?<\/Tag>/);
    assert.ok(sdkChip, 'sdkModelTag Tag present');
    assert.ok(!/onClick/.test(sdkChip[0]), 'SDK chip is non-clickable (no onClick)');
  });
});
