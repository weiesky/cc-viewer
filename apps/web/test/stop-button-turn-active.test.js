/**
 * stop-button-turn-active.test.js (web, source-anchor). R8 frontend: the Stop button
 * must stay visible through a long tool run — ChatInputBar renders Stop on
 * (isStreaming || turnActive), and ChatView passes turnActive from the server's
 * sdk-session-state truth (suppressed only by the optimistic stop). App/Mobile thread
 * this.state.turnActive down.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const chatInputBar = readFileSync(join(root, 'src', 'components', 'chat', 'ChatInputBar.jsx'), 'utf-8');
const chatView = readFileSync(join(root, 'src', 'components', 'chat', 'ChatView.jsx'), 'utf-8');
const app = readFileSync(join(root, 'src', 'App.jsx'), 'utf-8');
const mobile = readFileSync(join(root, 'src', 'Mobile.jsx'), 'utf-8');

describe('persistent Stop button (R8)', () => {
  it('ChatInputBar renders Stop on (isStreaming || turnActive)', () => {
    assert.match(chatInputBar, /\{\(isStreaming \|\| turnActive\) && onStop \?/, 'Stop gated on isStreaming || turnActive');
    assert.ok(/function ChatInputBar\(\{[^}]*\bturnActive\b/.test(chatInputBar), 'turnActive destructured as a prop');
  });

  it('ChatView passes turnActive (suppressed by optimistic stop) to its single ChatInputBar', () => {
    const bars = chatView.match(/<ChatInputBar/g) || [];
    assert.equal(bars.length, 1, 'exactly one ChatInputBar (the plan assumes a single mount)');
    const m = chatView.match(/<ChatInputBar[\s\S]*?turnActive=\{([^}]*)\}/);
    assert.ok(m, 'ChatInputBar receives turnActive');
    assert.ok(m[1].includes('this.props.turnActive'), 'turnActive sourced from props');
    assert.ok(m[1].includes('!this.state.stopOptimistic'), 'optimistic stop still hides the button instantly');
    // shouldComponentUpdate must observe the new prop or the bar never re-renders.
    assert.ok(/nextProps\.turnActive !== this\.props\.turnActive/.test(chatView), 'sCU observes turnActive');
  });

  it('App and Mobile thread this.state.turnActive into ChatView', () => {
    assert.ok(app.includes('turnActive={this.state.turnActive}'), 'App passes turnActive');
    assert.ok(mobile.includes('turnActive={this.state.turnActive}'), 'Mobile passes turnActive');
  });

  it('AppBase drops sdk-session-state frames from a sibling instance (heartbeat isolation)', () => {
    const appBase = readFileSync(join(root, 'src', 'AppBase.jsx'), 'utf-8');
    const m = appBase.match(/handleSdkSessionState = \(state, meta\) => \{[\s\S]*?_applyTurnActive/);
    assert.ok(m, 'handleSdkSessionState found');
    assert.ok(m[0].includes('meta.instanceKey'), 'compares the frame instanceKey');
    assert.ok(m[0].includes('effectiveInstance'), 'derives the effective viewed instance');
  });

  it('ChatView includes instanceKey in the sdk-session-state meta it lifts', () => {
    const m = chatView.match(/msg\.type === 'sdk-session-state'\)\s*\{[\s\S]*?onSdkSessionState\(msg\.state, \{[^}]*\}\)/);
    assert.ok(m, 'sdk-session-state lift found');
    assert.ok(m[0].includes('instanceKey: msg.instanceKey'), 'meta carries instanceKey');
  });
});
