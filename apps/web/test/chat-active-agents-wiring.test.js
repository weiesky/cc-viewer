/**
 * chat-active-agents-wiring.test.js — source contract for ChatView's wiring of
 * the SDK active-agents card.
 *
 * readFileSync source contract (no JSX transform/jsdom), same policy as
 * task-progress-hud.test.js. After the card refactor the click-to-filter focus
 * machinery is gone; these assertions pin BOTH the simplified wiring that must
 * be present AND the removed focus plumbing that must stay absent — each was
 * chosen so a specific regression turns it red:
 *   1. re-introduce `activeAgent` state / `_handleAgentSelect` / `_handleAgentShowAll`
 *   2. leave a dangling `_agentFocus` (or its `_navCacheKey` segment) — render throws
 *   3. drop the withActiveAgents padding class / use it alongside withRoleFilter
 *   4. render the bar in only ONE branch (visibility effect dies on empty state)
 *   5. gate the bar on roleFilterOpen the wrong way (two top bars stack)
 *   6. pass a handler the card no longer accepts (selectedKey/onSelect/onShowAll)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSX = readFileSync(join(__dirname, '..', 'src', 'components', 'chat', 'ChatView.jsx'), 'utf-8');
const CSS = readFileSync(join(__dirname, '..', 'src', 'components', 'chat', 'ChatView.module.css'), 'utf-8');
const APPBASE = readFileSync(join(__dirname, '..', 'src', 'AppBase.jsx'), 'utf-8');

describe('ChatView active-agents wiring contract', () => {
  it('imports the bar but NOT the removed pure helpers / task snapshot', () => {
    assert.ok(JSX.includes("import ActiveAgentsBar from './ActiveAgentsBar'"), 'bar import');
    assert.ok(!/from '\.\.\/\.\.\/utils\/activeAgents'/.test(JSX),
      'ChatView no longer imports the activeAgents helpers (the card owns the join)');
    assert.ok(!JSX.includes('getSnapshot as getTaskSnapshot'), 'no task snapshot import');
  });

  it('keeps only the visibility state (activeAgent is gone)', () => {
    // activeAgentsBarVisible appears twice: initial state AND the cDU
    // view/instance-switch reset (deleting the reset reintroduces stale padding).
    assert.ok((JSX.match(/activeAgentsBarVisible: false/g) || []).length >= 2,
      'activeAgentsBarVisible: false in initial state AND the view-switch reset');
    // Word-boundary so activeAgentsBarVisible does not match \bactiveAgent\b (the
    // trailing "sBarVisible" is \w, so the boundary lands after "activeAgent").
    assert.ok(!/\bactiveAgent\b/.test(JSX), 'no activeAgent state/prop anywhere');
  });

  it('focus plumbing is absent: no handlers, no filter block, no helpers', () => {
    for (const gone of [
      '_handleAgentSelect', '_handleAgentShowAll', '_getAgentToolUseMap',
      '_clickedFocus', '_agentFocus', '_zeroHit', '_effectiveFocus',
      'transcriptRowMatchesAgent', 'labelMatchesAgent', 'firstUserText',
      'isFocusActive', 'deriveActiveAgents', 'resolveAgentIdentity', 'buildAgentToolUseMap',
    ]) {
      assert.ok(!JSX.includes(gone), `must not reference ${gone}`);
    }
  });

  it('role filter no longer clears a focus (there is none to clear)', () => {
    assert.ok(!/roleFilterOpen: true, activeAgent: null/.test(JSX), 'funnel open does not clear focus');
    assert.ok(!/roleFilterSelected: next, activeAgent: null/.test(JSX), 'chip toggle does not clear focus');
  });

  it('_isFiltering is role-only; the streaming overlay gate matches', () => {
    assert.ok(JSX.includes('const _isFiltering = _selSize > 0 && _selSize < collectedRoles.length;'),
      'filter flag derived from the role selection only');
    assert.ok(/_assistantFilteredOut = _isFiltering && !this\.state\.roleFilterSelected\.has\('assistant'\)/.test(JSX),
      'streaming overlay suppressed only by the role filter');
  });

  it('bar renders in BOTH the empty and the loaded branch', () => {
    const occurrences = JSX.split('{activeAgentsBar}').length - 1;
    assert.ok(occurrences >= 2, `activeAgentsBar mounted in both branches (found ${occurrences})`);
  });

  it('bar is gated on sdkMode, hidden while role filter open / pinned / attached', () => {
    assert.ok(/showActiveAgentsBar = this\.props\.sdkMode && !this\.state\.roleFilterOpen && this\.props\.sessionUpperBoundTs == null && this\.props\.attachedSid == null/.test(JSX),
      'single gate: sdk only, not role-filter-open, not pinned, not attached to a historical session');
  });

  it('bar receives only requests + onVisibleChange (no selection/show-all handlers)', () => {
    assert.ok(JSX.includes('requests={this.props.requests}'), 'requests passed for the join');
    assert.ok(JSX.includes('onVisibleChange={this._handleActiveAgentsVisibility}'), 'onVisibleChange handler');
    assert.ok(!JSX.includes('selectedKey='), 'no selectedKey prop');
    assert.ok(!JSX.includes('onSelect='), 'no onSelect prop');
    assert.ok(!JSX.includes('onShowAll='), 'no onShowAll prop');
  });

  it('the visibility handler is a stable class arrow field (not an inline arrow)', () => {
    assert.ok(JSX.includes('_handleActiveAgentsVisibility = (visible) => {'), 'class field: _handleActiveAgentsVisibility');
  });

  it('withActiveAgents padding class exists and is mutually exclusive with withRoleFilter', () => {
    assert.ok(/\.messageListWrap\.withActiveAgents > \.container/.test(CSS), 'container padding rule');
    assert.ok(/\.messageListWrap\.withActiveAgents > \.mobileVirtuoso/.test(CSS), 'virtuoso padding rule');
    // Anchor the footprint to the actual .withActiveAgents rules (a whole-file
    // scan would pass on an unrelated 40px/48px rule).
    const desktop = CSS.match(/\.messageListWrap\.withActiveAgents > \.container,\s*\n\.messageListWrap\.withActiveAgents > \.mobileVirtuoso\s*\{([^}]*)\}/);
    assert.ok(desktop && /padding-top:\s*40px/.test(desktop[1]), '40px collapsed footprint on the desktop rule');
    const mobile = CSS.match(/@media\s*\(max-width:\s*768px\)\s*\{\s*\.messageListWrap\.withActiveAgents[^{]*\{[^}]*\}/);
    assert.ok(mobile && /padding-top:\s*48px/.test(mobile[0]), '48px mobile footprint inside the media query');
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

  it('boot first-activation preserves the SDK tracker (refresh-restore survives)', () => {
    // Regression pin for the double-refresh bug: the boot activation runs AFTER
    // the terminal-WS replay (restore + authoritative snapshot). If _coldActivate
    // called _syncTaskStoreForChannel without preserveSdkTracker, the deferred
    // boot reset would blank the just-restored panel and the next live frame
    // would delete the persisted checkpoint.
    assert.ok(/_syncTaskStoreForChannel\(ch, \{ preserveSdkTracker:/.test(APPBASE),
      '_coldActivate passes preserveSdkTracker');
    assert.ok(/preserveSdkTracker:\s*reason === 'boot' && !hadRenderedChannel/.test(APPBASE),
      'preserve only on boot first-activation, not on view switches');
    // The sync helper must honour the flag in SDK mode.
    assert.ok(/preserveSdkTracker = false/.test(APPBASE), 'preserveSdkTracker defaults to false');
    assert.ok(/if \(!preserveSdkTracker\) resetSdkTaskTrackerForView\(\)/.test(APPBASE),
      'SDK reset skipped when preserveSdkTracker is set');
  });
});
