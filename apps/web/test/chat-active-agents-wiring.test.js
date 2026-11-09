/**
 * chat-active-agents-wiring.test.js — source contract for ChatView's wiring of
 * the SDK active-agents strip.
 *
 * readFileSync source contract (no JSX transform/jsdom), same policy as
 * task-progress-hud.test.js. Pins the integration points the reviewers flagged
 * as P0/P1 — each was chosen so a specific regression turns it red:
 *   1. drop the `_agentFocus` branch from the filter block (focus never filters)
 *   2. drop `activeAgent` from `_isFiltering` (main-agent Last Response / streaming
 *      overlay leak into a focused view)
 *   3. remove the zero-hit fallback (a click can blank the conversation)
 *   4. drop the cDU focus backstop (focus leaks across session/workspace switches)
 *   5. render the bar in only ONE branch (auto-reset effect dies on empty state)
 *   6. gate the bar on roleFilterOpen the wrong way (two top bars stack)
 *   7. forget the withActiveAgents padding class / use it alongside withRoleFilter
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSX = readFileSync(join(__dirname, '..', 'src', 'components', 'chat', 'ChatView.jsx'), 'utf-8');
const CSS = readFileSync(join(__dirname, '..', 'src', 'components', 'chat', 'ChatView.module.css'), 'utf-8');

describe('ChatView active-agents wiring contract', () => {
  it('imports the bar and the pure helpers, and reads the task snapshot', () => {
    assert.ok(JSX.includes("import ActiveAgentsBar from './ActiveAgentsBar'"), 'bar import');
    assert.ok(/from '\.\.\/\.\.\/utils\/activeAgents'/.test(JSX), 'activeAgents import');
    assert.ok(JSX.includes('getSnapshot as getTaskSnapshot'), 'taskStore snapshot import');
  });

  it('adds activeAgent + activeAgentsBarVisible state', () => {
    assert.ok(JSX.includes('activeAgent: null'), 'activeAgent state');
    assert.ok(JSX.includes('activeAgentsBarVisible: false'), 'activeAgentsBarVisible state');
  });

  it('agent focus filters rows via labelMatchesAgent (+ promptMatchesAgent for subagents)', () => {
    assert.ok(JSX.includes('labelMatchesAgent(p.label, _agentFocus)'), 'label match against focus');
    assert.ok(JSX.includes('promptMatchesAgent(rowText, _agentFocus)'), 'instance-level prompt match');
    assert.ok(JSX.includes('firstUserText(req)'), 'row first-user-text extraction');
  });

  it('zero-hit guard: a click can never blank the conversation', () => {
    assert.ok(JSX.includes('if (filteredItems.length === 0) { filteredItems = allItems; _zeroHit = true; }'),
      'empty filter result falls back to the full list and marks the zero-hit');
  });

  it('focus is folded into _isFiltering and the streaming-overlay gate via the effective focus', () => {
    assert.ok(JSX.includes('const _effectiveFocus = _zeroHit ? null : _agentFocus;'),
      'a zero-hit focus is treated as unfocused');
    assert.ok(/const _isFiltering = !!_effectiveFocus \|\|/.test(JSX), 'focus counts as filtering');
    assert.ok(/_assistantFilteredOut = _isFiltering && \(_effectiveFocus \|\|/.test(JSX),
      'streaming overlay suppressed while focused');
  });

  it('focus is mutually exclusive with the RoleFilterBar (both directions)', () => {
    // funnel open clears the focus
    assert.ok(JSX.includes('{ roleFilterOpen: true, activeAgent: null }'), 'opening role filter clears focus');
    // chip toggle clears the focus
    assert.ok(/roleFilterSelected: next, activeAgent: null/.test(JSX), 'chip toggle clears focus');
    // focusing closes the role filter and clears its chips
    assert.ok(/roleFilterOpen: false,\s*\n\s*roleFilterSelected: new Set\(\)/.test(JSX),
      'focus clears role filter state');
  });

  it('cDU clears the focus on view/instance switch', () => {
    assert.ok(/activeAgent: null, activeAgentsBarVisible: false,/.test(JSX),
      'view/instance switch resets focus + visibility');
  });

  it('cDU clears the focus on same-workspace session switch (attachedSid) and pin', () => {
    assert.ok(/attachedSid[\s\S]{0,200}if \(this\.state\.activeAgent\) this\.setState\(\{ activeAgent: null \}\)/.test(JSX),
      'attachedSid change clears focus');
    assert.ok(/sessionUpperBoundTs != null && this\.state\.activeAgent/.test(JSX),
      'pinning to history clears focus');
  });

  it('cDU focus backstop: clears focus when the focused taskId leaves the active set', () => {
    assert.ok(/deriveActiveAgents\(getTaskSnapshot\(\)\.tasks\)\.some\(a => a\.taskId === focusTaskId\)/.test(JSX),
      'backstop derives active set and matches by taskId');
    assert.ok(/if \(!stillActive\) this\.setState\(\{ activeAgent: null \}\)/.test(JSX),
      'backstop clears a dead focus');
  });

  it('focus descriptor carries taskId so the backstop can match it', () => {
    assert.ok(JSX.includes('taskId: agent.taskId'), 'focus stores taskId');
  });

  it('bar renders in BOTH the empty and the loaded branch', () => {
    const occurrences = JSX.split('{activeAgentsBar}').length - 1;
    assert.ok(occurrences >= 2, `activeAgentsBar mounted in both branches (found ${occurrences})`);
  });

  it('bar is gated on sdkMode, hidden while role filter is open or pinned to history', () => {
    assert.ok(/showActiveAgentsBar = this\.props\.sdkMode && !this\.state\.roleFilterOpen && this\.props\.sessionUpperBoundTs == null/.test(JSX),
      'single gate: sdk only, not role-filter-open, not pinned');
  });

  it('bar is a controlled child: receives requests, selectedKey, and the three handlers', () => {
    assert.ok(JSX.includes('requests={this.props.requests}'), 'requests passed for the join');
    assert.ok(JSX.includes('selectedKey={this.state.activeAgent ? this.state.activeAgent.key : null}'), 'selectedKey');
    assert.ok(JSX.includes('onSelect={this._handleAgentSelect}'), 'onSelect handler');
    assert.ok(JSX.includes('onShowAll={this._handleAgentShowAll}'), 'onShowAll handler');
    assert.ok(JSX.includes('onVisibleChange={this._handleActiveAgentsVisibility}'), 'onVisibleChange handler');
  });

  it('handlers are stable class arrow fields (not inline arrows in render)', () => {
    assert.ok(JSX.includes('_handleAgentSelect = (agent) => {'), 'class field: _handleAgentSelect');
    assert.ok(JSX.includes('_handleAgentShowAll = () =>'), 'class field: _handleAgentShowAll');
    assert.ok(JSX.includes('_handleActiveAgentsVisibility = (visible) => {'), 'class field: _handleActiveAgentsVisibility');
  });

  it('withActiveAgents padding class exists and is mutually exclusive with withRoleFilter', () => {
    assert.ok(/\.messageListWrap\.withActiveAgents > \.container/.test(CSS), 'container padding rule');
    assert.ok(/\.messageListWrap\.withActiveAgents > \.mobileVirtuoso/.test(CSS), 'virtuoso padding rule');
    assert.ok(/padding-top:\s*36px/.test(CSS), '36px footprint (4+28+4)');
    // JSX picks one or the other, never both
    assert.ok(/roleFilterBar \? `\$\{styles\.messageListWrap\} \$\{styles\.withRoleFilter\}` : \(activeAgentsBar/.test(JSX),
      'padding class chosen by a single ternary (role filter wins, else agents bar)');
  });

  it('chatSection has a min-width floor so a fixed-width terminal cannot crush it to 0', () => {
    // The narrow-window regression: terminalPanelWrap is flex-shrink:0 with a
    // fixed inline width, and chatSection was flex:1 min-width:0 — squeezing the
    // conversation to 0px. The floor + horizontal scroll keep it visible instead.
    const chat = CSS.match(/\.chatSection\s*\{([^}]*)\}/);
    assert.ok(chat, '.chatSection rule exists');
    assert.match(chat[1], /min-width:\s*280px/, 'chatSection has a 280px floor');
    assert.ok(!/min-width:\s*0(?!\w)/.test(chat[1]), 'chatSection no longer min-width:0');
  });

  it('splitContainer scrolls horizontally on overflow instead of crushing the chat', () => {
    const split = CSS.match(/\.splitContainer\s*\{([^}]*)\}/);
    assert.ok(split, '.splitContainer rule exists');
    assert.match(split[1], /overflow-x:\s*auto/, 'horizontal scroll on overflow');
    assert.match(split[1], /overflow-y:\s*hidden/, 'vertical overflow still hidden');
  });
});
