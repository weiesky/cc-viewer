/**
 * active-agents-bar.test.js — source contract for the SDK active-agents strip.
 *
 * The repo has no JSX transform/jsdom, so — like task-progress-hud.test.js —
 * these are readFileSync source contracts. Each assertion pins a deliberate
 * design decision (and was chosen so a specific mutation turns it red):
 *   1. drop the `if (!visible) return null` auto-hide
 *   2. subscribe to something other than taskStore
 *   3. render teammate avatars with animated:true (or drop animated:false)
 *   4. drop the (ALL) fallback button or its onShowAll handler
 *   5. make a non-matchable avatar clickable (dead blank filter)
 *   6. change the container off 28px / avatars off 24px / offsets off 4px/8px
 *   7. drop the frosted-glass recipe or a backdrop-filter line
 *   8. add a !important anywhere (repo-wide prohibition)
 *   9. drop `color: var(--model-logo-mono)` (currentColor glyphs go dark-on-dark)
 *  10. move the `return null` above the hooks (React hooks-order crash)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSX_PATH = join(__dirname, '..', 'src', 'components', 'chat', 'ActiveAgentsBar.jsx');
const CSS_PATH = join(__dirname, '..', 'src', 'components', 'chat', 'ActiveAgentsBar.module.css');

const jsx = readFileSync(JSX_PATH, 'utf-8');
const css = readFileSync(CSS_PATH, 'utf-8');

// A CSS-module rule body for an exact selector line, e.g. rule('.bar') → the body
// of the block whose selector is exactly ".bar" (not ".bar::-webkit-scrollbar"
// or ".barFocused .avatarBtn"). Mirrors the `css.match(/\.x\s*\{([^}]*)\}/)`
// idiom in task-progress-hud.test.js but anchored to a line-start selector.
function rule(sel) {
  const m = css.match(new RegExp('^' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'm'));
  return m ? m[1] : null;
}

// Strip <Tooltip ...> opening tags so their own title prop is not counted by the
// native-title guard below. Tag scanning tracks brace depth because attribute
// values can contain '>' inside braces (same approach as task-progress-hud).
function stripOverlayTags(src) {
  let out = '', i = 0;
  while (i < src.length) {
    const m = /^<(Tooltip|Popover)\b/.exec(src.slice(i));
    if (!m) { out += src[i]; i++; continue; }
    let j = i + m[0].length, depth = 0;
    while (j < src.length) {
      const c = src[j];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
      j++;
    }
    i = j + 1; out += ' ';
  }
  return out;
}

describe('ActiveAgentsBar source contract', () => {
  it('auto-hides: returns null when there are no active agents', () => {
    assert.ok(jsx.includes('if (!visible) return null'), 'early null return present');
    assert.ok(jsx.includes('const visible = agents.length > 0'), 'visible derived from agent count');
  });

  it('the early return null stays AFTER all hooks (hooks-order safety)', () => {
    const iSubscribe = jsx.indexOf('useEffect(() => subscribe(setSnapshot)');
    const iMemo = jsx.indexOf('useMemo(');
    const iVisibleFx = jsx.indexOf('onVisibleChange(visible)');
    const iResetFx = jsx.indexOf('if (selectedKey && !focusAlive');
    const iReturn = jsx.indexOf('if (!visible) return null');
    assert.ok(iSubscribe > -1 && iMemo > -1 && iReturn > -1, 'hooks + return all present');
    assert.ok(iVisibleFx > -1 && iResetFx > -1, 'both useEffect hooks present');
    assert.ok(iSubscribe < iReturn && iMemo < iReturn && iVisibleFx < iReturn && iResetFx < iReturn,
      'return null must come AFTER every hook (subscribe, useMemo, both useEffects)');
  });

  it('resets the focus when the selected agent leaves the active set', () => {
    // The bar holds the derived agents list, so it is the right place to detect a
    // dead focus (ChatView does not re-render on a partial task completion). It
    // uses the shared isFocusActive rule (teammate by name, subagent by taskId) so
    // a multi-task teammate is not cleared while a sibling task is still running.
    assert.ok(jsx.includes('isFocusActive('), 'liveness via the shared isFocusActive rule');
    assert.ok(/if \(selectedKey && !focusAlive && typeof onShowAll === 'function'\) onShowAll\(\)/.test(jsx),
      'effect restores "all" when the focus is no longer active');
    assert.ok(jsx.includes('[selectedKey, focusAlive, onShowAll]'), 'effect deps cover the reset');
    assert.ok(/styles\.bar\}\$\{focused \?/.test(jsx),
      'barFocused keyed off the live focused flag (not raw selectedKey)');
  });

  it('subscribes to taskStore (not some other source)', () => {
    assert.ok(jsx.includes("from '../../utils/taskStore'"), 'taskStore import');
    assert.ok(jsx.includes('subscribe(setSnapshot)'), 'taskStore subscribe');
    assert.ok(jsx.includes('getSnapshot'), 'taskStore getSnapshot for initial value');
  });

  it('derives agents from the snapshot via activeAgents helpers + joins identity via transcript', () => {
    assert.ok(jsx.includes('deriveActiveAgents(snapshot.tasks)'), 'derive from taskStore tasks');
    assert.ok(jsx.includes('buildAgentToolUseMap(requests)'), 'build tool_use map from requests');
    assert.ok(jsx.includes('resolveAgentIdentity(agent, toolUseMap)'), 'join identity');
  });

  it('teammate avatars use the static portrait; subagents use sub-* glyphs', () => {
    assert.ok(jsx.includes("getTeammateAvatar(agent.name, { animated: false })"),
      'teammate portrait is animation-stripped');
    assert.ok(jsx.includes('getSvgAvatar(agent.avatarType)'), 'subagent glyph');
  });

  it('click avatar → onSelect(agent); click is disabled for non-matchable agents', () => {
    assert.ok(jsx.includes("onClick={agent.matchable ? () => onSelect(agent) : undefined}"),
      'only matchable agents are clickable');
    assert.ok(jsx.includes('aria-disabled={!agent.matchable}'),
      'non-matchable marked aria-disabled (keeps tooltip, unlike disabled attr)');
  });

  it('trailing (ALL) button restores everything via onShowAll', () => {
    assert.ok(jsx.includes('onClick={onShowAll}'), 'ALL button wired to onShowAll');
    assert.ok(jsx.includes("t('ui.activeAgents.all')"), 'ALL label i18n');
    assert.ok(jsx.includes("t('ui.activeAgents.showAll')"), 'show-all tooltip i18n');
    assert.ok(jsx.includes("t('ui.activeAgents.title')"), 'group label i18n');
  });

  it('selection state: focused bar dims the rest, selected stays solid', () => {
    assert.ok(jsx.includes('styles.barFocused'), 'barFocused modifier applied');
    assert.ok(jsx.includes('styles.avatarBtnActive'), 'active avatar class');
    const dimmed = rule('.barFocused .avatarBtn');
    assert.ok(dimmed && /opacity:\s*0\.45/.test(dimmed), 'non-selected avatars dimmed');
    const solid = rule('.barFocused .avatarBtnActive');
    assert.ok(solid && /opacity:\s*1/.test(solid), 'selected avatar solid');
  });

  it('container is 28px tall, positioned 4px from top / 8px from right, frosted glass', () => {
    const bar = rule('.bar');
    assert.ok(bar, '.bar rule exists');
    assert.match(bar, /height:\s*28px/, '28px tall');
    assert.match(bar, /top:\s*4px/, '4px from top');
    assert.match(bar, /right:\s*calc\(8px \+ var\(--chat-scrollbar-width/, '8px + scrollbar gutter from right');
    assert.match(bar, /position:\s*absolute/, 'absolutely positioned overlay');
    assert.match(bar, /background:\s*var\(--bg-glass\)/, 'frosted glass background');
    assert.match(bar, /backdrop-filter:\s*blur\(20px\) saturate\(180%\)/, 'backdrop blur');
    assert.match(bar, /-webkit-backdrop-filter:\s*blur\(20px\) saturate\(180%\)/, 'webkit backdrop blur');
    assert.match(bar, /max-width:\s*calc\(100% - 16px\)/, 'width capped (calc with spaces)');
  });

  it('avatars are 24px circles; svg fills them; glyphs use the mono foreground', () => {
    const avatar = rule('.avatar');
    assert.ok(avatar, '.avatar rule exists');
    assert.match(avatar, /width:\s*24px/, '24px wide');
    assert.match(avatar, /height:\s*24px/, '24px tall');
    assert.match(avatar, /border-radius:\s*50%/, 'circular');
    assert.match(avatar, /color:\s*var\(--model-logo-mono\)/, 'currentColor glyph foreground');
    assert.ok(css.includes('.avatar > :global(svg)'), 'svg scoped to fill the avatar');
  });

  it('(ALL) chip has a bordered surface background and readable text color', () => {
    const all = rule('.allAvatar');
    assert.ok(all, '.allAvatar rule exists');
    assert.match(all, /border-radius:\s*50%/, 'circular');
    assert.match(all, /background:\s*var\(--bg-surface\)/, 'surface background');
    assert.match(all, /border:\s*1px solid var\(--border-secondary\)/, 'bordered (light-theme contrast)');
    assert.match(all, /color:\s*var\(--text-secondary\)/, 'readable text color');
  });

  it('horizontal scroll on overflow, with the scrollbar hidden both ways', () => {
    const bar = rule('.bar');
    assert.match(bar, /overflow-x:\s*auto/, 'horizontal scroll');
    assert.match(bar, /scrollbar-width:\s*none/, 'Firefox scrollbar hidden');
    assert.ok(/\.bar::-webkit-scrollbar\s*\{\s*display:\s*none/.test(css), 'webkit scrollbar hidden');
  });

  it('mobile enlargement keeps the avatar tappable under the 0.6 zoom', () => {
    const m = css.match(/@media\s*\(max-width:\s*768px\)\s*\{/);
    assert.ok(m, 'mobile media query exists');
    assert.ok(/width:\s*34px/.test(css), 'mobile avatar enlarged');
  });

  it('pad-mode restore rules exist (comment claims them — keep impl in sync)', () => {
    // The module comment promises a pad-mode revert; without the rule a portrait
    // iPad would render the enlarged mobile sizes at full zoom.
    assert.ok(css.includes(':global(html.pad-mode) .bar'), 'pad-mode bar revert rule');
    assert.ok(css.includes(':global(html.pad-mode) .avatar'), 'pad-mode avatar revert rule');
    const m = css.match(/:global\(html\.pad-mode\) \.bar\s*\{([^}]*)\}/);
    assert.ok(m && /height:\s*28px/.test(m[1]), 'pad-mode restores the 28px desktop height');
  });

  it('no !important anywhere in the module (excluding comments)', () => {
    const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!cssNoComments.includes('!important'), 'repo-wide prohibition');
  });

  it('no native title= on triggers (antd Tooltip is used instead)', () => {
    assert.ok(jsx.includes("from 'antd'"), 'antd import present');
    assert.ok((jsx.match(/<Tooltip\b/g) || []).length >= 2, 'Tooltips used');
    assert.equal((stripOverlayTags(jsx).match(/\btitle=/g) || []).length, 0,
      'no native title= left on any trigger');
  });
});
