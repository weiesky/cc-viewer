/**
 * active-agents-bar.test.js — source contract for the SDK active-agents card.
 *
 * The repo has no JSX transform/jsdom, so — like task-progress-hud.test.js —
 * these are readFileSync source contracts. Each assertion pins a deliberate
 * design decision (and was chosen so a specific mutation turns it red):
 *   1. drop the `if (!visible) return null` auto-hide
 *   2. subscribe to something other than taskStore
 *   3. drop the collapse toggle (or the rows gate)
 *   4. re-introduce the click-to-filter props (onSelect/onShowAll/selectedKey)
 *      or the (ALL) chip — both were deliberately removed in the card refactor
 *   5. drop a row column (status dot / name / doing pill / elapsed)
 *   6. drop the 1s clock tick (or leave it running while collapsed/hidden)
 *   7. change the absolute top-right / frosted-glass positioning
 *   8. add a !important anywhere (repo-wide prohibition)
 *   9. move the `return null` above the hooks (React hooks-order crash)
 *  10. drop the mobile enlargement / pad-mode revert / reduced-motion guard
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
// of the block whose selector is exactly ".bar" (not ".bar .header" or
// ".collapsed .header"). Mirrors the idiom in task-progress-hud.test.js.
function rule(sel) {
  const m = css.match(new RegExp('^' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'm'));
  return m ? m[1] : null;
}

describe('ActiveAgentsBar source contract', () => {
  it('auto-hides: returns null when there are no active agents', () => {
    assert.ok(jsx.includes('if (!visible) return null'), 'early null return present');
    assert.ok(jsx.includes('const visible = rows.length > 0'), 'visible derived from row count');
  });

  it('the early return null stays AFTER all hooks (hooks-order safety)', () => {
    const iSubscribe = jsx.indexOf('useEffect(() => subscribe(setSnapshot)');
    const iMemo = jsx.lastIndexOf('useMemo(', jsx.indexOf('if (!visible) return null')); // rows memo — a conditional hook would crash
    const iVisibleFx = jsx.indexOf('onVisibleChange(visible)');
    const iTickFx = jsx.indexOf('setInterval(() => setTick(');
    const iReturn = jsx.indexOf('if (!visible) return null');
    assert.ok(iSubscribe > -1 && iMemo > -1 && iReturn > -1, 'hooks + return all present');
    assert.ok(iVisibleFx > -1 && iTickFx > -1, 'both useEffect hooks present');
    assert.ok(iSubscribe < iReturn && iMemo < iReturn && iVisibleFx < iReturn && iTickFx < iReturn,
      'return null must come AFTER every hook (subscribe, both useMemos, visibility + tick effects)');
  });

  it('subscribes to taskStore (not some other source)', () => {
    assert.ok(jsx.includes("from '../../utils/taskStore'"), 'taskStore import');
    assert.ok(jsx.includes('subscribe(setSnapshot)'), 'taskStore subscribe');
    assert.ok(jsx.includes('getSnapshot'), 'taskStore getSnapshot for initial value');
  });

  it('derives rows from the snapshot via activeAgents helpers + joins identity via transcript', () => {
    assert.ok(jsx.includes('deriveActiveAgents(snapshot.tasks)'), 'derive from taskStore tasks');
    assert.ok(jsx.includes('buildAgentToolUseMap(requests)'), 'build tool_use map from requests');
    assert.ok(jsx.includes('resolveAgentIdentity(agent, toolUseMap)'), 'join identity');
    // The live per-task fields ride on the deriveActiveAgents entry (single
    // pass) — no second byTaskId re-join against snapshot.tasks.
    assert.ok(jsx.includes('lastToolName: agent.lastToolName'), 'doing pill sourced from the derived agent');
    assert.ok(jsx.includes('createdAt: agent.createdAt'), 'elapsed sourced from the derived agent');
    assert.ok(!jsx.includes('byTaskId'), 'no redundant taskId re-join');
  });

  it('header: live dot + title + count + collapse chevron, whole header is the toggle button', () => {
    assert.ok(jsx.includes("t('ui.activeAgents.title')"), 'title i18n');
    assert.ok(jsx.includes('title={t(\'ui.activeAgents.title\')}'), 'title has a hover reveal (truncation)');
    assert.ok(jsx.includes("t('ui.workflow.agentsShort', { count: rows.length })"), 'count stat i18n');
    assert.ok(jsx.includes('aria-expanded={!collapsed}'), 'collapse a11y state');
    assert.ok(jsx.includes("t('ui.expand')"), 'expand tooltip i18n');
    assert.ok(jsx.includes("t('ui.collapse')"), 'collapse tooltip i18n');
    assert.ok(jsx.includes('onClick={() => setCollapsed((c) => !c)}'), 'header toggles collapse');
    assert.ok(jsx.includes("collapsed ? '▸' : '▾'"), 'chevron reflects collapse');
  });

  it('rows render only when expanded; one row per task keyed by taskId', () => {
    assert.ok(jsx.includes('{!collapsed && ('), 'rows gated on expanded');
    assert.ok(jsx.includes('key={row.taskId}'), 'row keyed by taskId (no teammate name dedupe)');
  });

  it('scrollable rows region is keyboard-focusable (WCAG 2.1.1)', () => {
    assert.ok(jsx.includes('tabIndex={0}'), 'rows div is tabbable');
    assert.ok(/\.rows:focus-visible\s*\{[^}]*outline-offset:\s*-2px/.test(css),
      'inset focus ring on the scrollable rows (not clipped by .bar overflow)');
  });

  it('each row: status dot + name + current-tool pill + elapsed duration', () => {
    assert.ok(jsx.includes('stateGlyph(state)'), 'status glyph');
    assert.ok(jsx.includes("row.status === 'pending'"), 'pending → queued mapping');
    assert.ok(jsx.includes('row.lastToolName'), 'current-tool pill source');
    assert.ok(jsx.includes('styles.doing'), 'doing pill class');
    assert.ok(jsx.includes('fmtDuration(Math.max(0, now - row.createdAt))'), 'elapsed from task createdAt');
    assert.ok(jsx.includes('styles.dur'), 'duration column class');
    assert.ok(jsx.includes("t('ui.workflow.status.running')"), 'running status a11y label');
    assert.ok(jsx.includes("t('ui.tasks.status.pending')"), 'pending status a11y label');
  });

  it('live clock: 1s tick, gated on visible && !collapsed, cleared on cleanup', () => {
    assert.ok(jsx.includes('if (!visible || collapsed) return undefined'), 'tick gated off when hidden/collapsed');
    assert.ok(/setInterval\(\(\) => setTick\(\(n\) => n \+ 1\), 1000\)/.test(jsx), '1s interval');
    assert.ok(jsx.includes('clearInterval(id)'), 'interval cleared');
    assert.ok(jsx.includes('[visible, collapsed]'), 'tick effect deps');
  });

  it('removed features are absent: no onSelect/onShowAll/selectedKey/ALL chip/avatars/antd', () => {
    for (const gone of ['onSelect', 'onShowAll', 'selectedKey', 'matchable',
      'getTeammateAvatar', 'getSvgAvatar', "from 'antd'", '<Tooltip',
      'ui.activeAgents.all', 'ui.activeAgents.showAll', 'isFocusActive']) {
      assert.ok(!jsx.includes(gone), `must not reference ${gone}`);
    }
  });

  it('container floats top-right (absolute, 4px/8px), frosted glass, bounded width', () => {
    const bar = rule('.bar');
    assert.ok(bar, '.bar rule exists');
    assert.match(bar, /position:\s*absolute/, 'absolutely positioned overlay');
    assert.match(bar, /top:\s*4px/, '4px from top');
    assert.match(bar, /right:\s*calc\(8px \+ var\(--chat-scrollbar-width/, '8px + scrollbar gutter from right');
    // Width cap subtracts the scrollbar gutter too, so a narrow pane doesn't
    // push the card's left edge past the split.
    assert.match(bar, /width:\s*min\(340px, calc\(100% - 16px - var\(--chat-scrollbar-width/, 'bounded width');
    assert.match(bar, /background:\s*var\(--bg-glass\)/, 'frosted glass background');
    assert.match(bar, /backdrop-filter:\s*blur\(20px\) saturate\(180%\)/, 'backdrop blur');
    assert.match(bar, /-webkit-backdrop-filter:\s*blur\(20px\) saturate\(180%\)/, 'webkit backdrop blur');
    assert.match(bar, /overflow:\s*hidden/, 'rounded corners clip content');
  });

  it('rows area scrolls vertically with a bounded max-height', () => {
    const rows = rule('.rows');
    assert.ok(rows, '.rows rule exists');
    assert.match(rows, /max-height:\s*min\(40vh, 260px\)/, 'bounded max-height');
    assert.match(rows, /overflow-y:\s*auto/, 'vertical scroll');
  });

  it('row layout mirrors WorkflowLiveHud: flex row, dot 1em, doing pill, dur tabular-nums', () => {
    const row = rule('.row');
    assert.ok(row && /display:\s*flex/.test(row), '.row is a flex row');
    const dot = rule('.dot');
    assert.ok(dot && /width:\s*1em/.test(dot), '.dot fixed 1em');
    const doing = rule('.doing');
    assert.ok(doing && /background:\s*var\(--color-primary\)/.test(doing), 'doing pill uses primary bg');
    const dur = rule('.dur');
    assert.ok(dur && /text-align:\s*right/.test(dur) && /font-variant-numeric:\s*tabular-nums/.test(dur), 'dur right-aligned tabular-nums');
  });

  it('status pulse + reduced-motion guard', () => {
    assert.ok(css.includes('@keyframes ccvHudPulse'), 'pulse keyframes');
    const reduced = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([^}]*)\}/);
    assert.ok(reduced && /animation:\s*none/.test(reduced[1]), 'reduced-motion disables the pulse');
  });

  it('mobile enlargement keeps the card legible under the 0.6 zoom', () => {
    const m = css.match(/@media\s*\(max-width:\s*768px\)\s*\{/);
    assert.ok(m, 'mobile media query exists');
    assert.ok(/font-size:\s*16px/.test(css), 'mobile card font enlarged');
  });

  it('pad-mode restore rules exist (comment claims them — keep impl in sync)', () => {
    assert.ok(css.includes(':global(html.pad-mode) .bar'), 'pad-mode bar revert rule');
    const m = css.match(/:global\(html\.pad-mode\) \.bar\s*\{([^}]*)\}/);
    assert.ok(m && /font-size:\s*12px/.test(m[1]), 'pad-mode restores the desktop font size');
  });

  it('no leftover strip classes (avatar/ALL/focused all removed)', () => {
    for (const gone of ['.avatarBtn', '.allAvatar', '.barFocused', '.avatar']) {
      assert.ok(!css.includes(gone), `CSS must not define ${gone}`);
    }
  });

  it('no !important anywhere in the module (excluding comments)', () => {
    const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!cssNoComments.includes('!important'), 'repo-wide prohibition');
  });
});
