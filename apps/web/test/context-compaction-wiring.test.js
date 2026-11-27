/**
 * context-compaction-wiring.test.js — source-anchor contract for the web-side compaction wiring.
 *
 * Pure-logic behaviour lives in context-compaction.test.js; this pins the JSX/WS integration seams
 * that a unit test of the utils module cannot see (a dropped prop, a removed menu row, or a missing
 * WS branch would silently disable the feature without failing any logic test).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const chatView = readFileSync(join(SRC, 'components', 'chat', 'ChatView.jsx'), 'utf8');
const chatInputBar = readFileSync(join(SRC, 'components', 'chat', 'ChatInputBar.jsx'), 'utf8');
const terminalPanel = readFileSync(join(SRC, 'components', 'terminal', 'TerminalPanel.jsx'), 'utf8');
const app = readFileSync(join(SRC, 'App.jsx'), 'utf8');
const mobile = readFileSync(join(SRC, 'Mobile.jsx'), 'utf8');

describe('menu entries open the compaction settings modal', () => {
  it('ChatInputBar (desktop cascade + mobile flat) both wire onOpenCompactionSettings', () => {
    assert.match(chatInputBar, /onOpenCompactionSettings/, 'ChatInputBar accepts the prop');
    // desktop cascade row + mobile flat row both render the menu item label
    const rows = chatInputBar.match(/ui\.contextCompaction\.menuItem/g) || [];
    assert.ok(rows.length >= 2, 'menu label rendered in desktop + mobile menu');
    assert.match(chatInputBar, /CompressIcon/, 'CompressIcon used');
  });
  it('TerminalPanel quick-settings menu has a compaction row opening its modal', () => {
    assert.match(terminalPanel, /CompactionSettingsModal/, 'TerminalPanel hosts the modal');
    assert.match(terminalPanel, /compactionModalVisible: true/, 'menu row opens the modal');
    assert.match(terminalPanel, /ui\.contextCompaction\.menuItem/, 'menu label present');
    assert.match(terminalPanel, /normalizeCompactionConfig\(data\.contextCompaction\)/, 'loads contextCompaction prefs');
  });
});

describe('ChatView trigger + confirm + inject wiring', () => {
  it('loads + normalizes contextCompaction prefs and resets the state machine on change', () => {
    assert.match(chatView, /normalizeCompactionConfig\(data\.contextCompaction\)/, 'config normalized');
    assert.match(chatView, /configSignature/, 'config signature tracked for reset');
  });
  it('compaction config loads even when Agent Teams is disabled (not gated by the experiment flag)', () => {
    // regression guard: the compaction read must run BEFORE the `if (!agentTeamEnabled) return;`
    // early-return, otherwise the trigger chain silently no-ops under the default config.
    const loadStart = chatView.indexOf('_loadPresets()');
    const normalizeIdx = chatView.indexOf('normalizeCompactionConfig(data.contextCompaction)', loadStart);
    const gateIdx = chatView.indexOf("if (!agentTeamEnabled)", loadStart);
    assert.ok(normalizeIdx > 0 && gateIdx > 0, 'both the normalize call and the agentTeam gate exist');
    assert.ok(normalizeIdx < gateIdx, 'compaction normalize runs before the agentTeam early-return');
  });
  it('subscribes sdk-context-usage / compact-inject-done / context-compaction-injected frames', () => {
    assert.match(chatView, /msg\.type === 'sdk-context-usage'/, 'sdk usage frame branch');
    assert.match(chatView, /msg\.type === 'compact-inject-done'/, 'ack branch');
    assert.match(chatView, /msg\.type === 'context-compaction-injected'/, 'cross-tab broadcast branch');
    // external compaction (sdk-compact) closes the bar + resets counters
    assert.match(chatView, /_onExternalCompaction\(\)/, 'external compaction handler');
  });
  it('drives checkpoints off the turnActive falling edge and resets on the rising edge', () => {
    assert.match(chatView, /prevProps\.turnActive && !this\.props\.turnActive[\s\S]{0,200}_onCompactionTurnEnd/, 'turn-end checkpoint');
    assert.match(chatView, /markTurnStart\(this\._compaction\)/, 'turn-start advances seq');
  });
  it('sends compact-inject with reqId + frozen anchor + /compact command', () => {
    assert.match(chatView, /type: 'compact-inject'/, 'compact-inject frame');
    assert.match(chatView, /reqId/, 'carries reqId');
    assert.match(chatView, /buildCompactCommand\(item\.script\)/, 'builds /compact command from the item');
  });
  it('renders ContextCompactionBar with busy gating + CompactionSettingsModal', () => {
    assert.match(chatView, /<ContextCompactionBar/, 'confirm bar rendered');
    assert.match(chatView, /busy=\{this\.props\.turnActive \|\| this\.props\.isStreaming\}/, 'confirm disabled while busy');
    assert.match(chatView, /<CompactionSettingsModal/, 'settings modal rendered');
    assert.match(chatView, /onOpenCompactionSettings=\{/, 'feeds ChatInputBar the open handler');
  });
  it('clears compaction timers + pending state on unmount', () => {
    assert.match(chatView, /_clearCompactionCheckpoint\(\)/, 'checkpoint timer cleared');
    assert.match(chatView, /_clearCompactionBarTimer\(\)/, 'bar timer cleared');
    assert.match(chatView, /_clearCompactionAckTimer\(\)/, 'ack timer cleared');
  });
  it('auto execution path passes an anchor (regression: auto must not send without one)', () => {
    // review P0-1: the auto branch once called _dispatchCompaction without anchor → anchor.project
    // threw and was swallowed, so auto never sent. Anchor the call site carries an anchor now.
    assert.match(chatView, /source: 'auto'[\s\S]{0,120}anchor: this\._terminalAnchor\(\)/, 'auto dispatch passes anchor');
    // and the dispatch kernel falls back to the live anchor if any caller omits it.
    assert.match(chatView, /const a = anchor \|\| this\._terminalAnchor\(\)/, 'dispatch falls back to live anchor');
  });

  it('960K force path: streaming watch + force frame, bypasses the streaming gate only for force', () => {
    // The streaming evaluator starts on the turnActive rising edge, stops on the falling edge, and is cleaned up on unmount
    assert.match(chatView, /_startForceCompactWatch\(\)/, 'force watch started on rising edge');
    assert.match(chatView, /_stopForceCompactWatch\(\)/, 'force watch stopped on falling edge/unmount');
    // The reading comes from forceCompactTokens (only context_window/request fallback, not the stale SDK snapshot)
    assert.match(chatView, /forceCompactTokens\(\{ contextWindow, mainAgentUsage: /, 'force uses streaming-fresh reading');
    // Threshold check uses the hard-coded 960K
    assert.match(chatView, /reading\.tokens < FORCE_COMPACT_THRESHOLD_TOKENS/, 'force gated on 960K threshold');
    // The shared mainAgent-usage helper backs both turn-end and force readings (no duplicated reverse scan)
    assert.match(chatView, /_latestMainAgentUsage = \(\) =>/, 'shared mainAgent usage helper');
    // Post-compaction latch gates the trigger (prevents stale-reading re-interrupt)
    assert.match(chatView, /isForceCompactLatched\(this\._forceCompactLatch, reading, FORCE_COMPACT_THRESHOLD_TOKENS\)/, 'latch gates force trigger');
    // Trigger uses the default script + force injection
    assert.match(chatView, /source: 'force'[\s\S]{0,80}force: true/, 'force dispatch carries force:true + default script');
    // Cooldown + single slot to prevent duplicates
    assert.match(chatView, /FORCE_COMPACT_COOLDOWN_MS/, 'force cooldown window');
    // _dispatchCompaction bypasses the streaming rejection only for force
    assert.match(chatView, /!isForce && \(this\.props\.turnActive \|\| this\.props\.isStreaming\)/, 'streaming gate bypassed only for force');
    // The compact-inject frame carries the force flag
    assert.match(chatView, /isForce \? \{ force: true \} : \{\}/, 'compact-inject frame carries force flag');
    // Latch lifecycle (review P0-1): a sub-threshold reading clears the latch BEFORE the threshold
    // early-return, and every failure ack path (busy / not-delivered / error / ack-timeout) clears
    // latch+cooldown so one failed attempt never disables the 960K safety net permanently.
    assert.match(chatView, /reading\.tokens < FORCE_COMPACT_THRESHOLD_TOKENS\) \{ this\._forceCompactLatch = null; return; \}/, 'sub-threshold reading clears latch before early-return');
    const latchClears = chatView.match(/this\._forceCompactLatch = null;/g) || [];
    assert.ok(latchClears.length >= 4, 'latch cleared on sub-threshold + all failure ack paths + view switch');
  });
});

describe('App / Mobile feed ChatView the context usage props', () => {
  it('App.jsx passes contextWindow + contextBarLocked', () => {
    assert.match(app, /contextWindow=\{this\.state\.contextWindow\}/, 'App passes contextWindow');
    assert.match(app, /contextBarLocked=\{this\.state\.contextBarLocked\}/, 'App passes contextBarLocked');
  });
  it('Mobile.jsx passes contextWindow + contextBarLocked', () => {
    assert.match(mobile, /contextWindow=\{this\.state\.contextWindow\}/, 'Mobile passes contextWindow');
    assert.match(mobile, /contextBarLocked=\{this\.state\.contextBarLocked\}/, 'Mobile passes contextBarLocked');
  });
});
