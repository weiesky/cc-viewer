/**
 * chat-ghost-clamp.test.js — source anchors for the composer suggestion-ghost fix:
 * long [SUGGESTION MODE] hints are clamped to two lines with an ellipsis, and the
 * composer grows to a two-line floor so the ghost never paints over the toolbar row.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSX_PATH = join(__dirname, '..', 'src', 'components', 'chat', 'ChatInputBar.jsx');
const CSS_PATH = join(__dirname, '..', 'src', 'components', 'chat', 'ChatInputBar.module.css');

const jsx = readFileSync(JSX_PATH, 'utf-8');
const css = readFileSync(CSS_PATH, 'utf-8');

// Extract the body of a top-level rule like `.ghostText { ... }` (non-nested, single-line selector).
const ruleBody = (selector) => {
  const m = css.match(new RegExp(`^${selector}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm'));
  assert.ok(m, `${selector} rule must exist`);
  return m[1];
};

describe('composer ghost suggestion clamp + two-line floor', () => {
  it('.ghostText clamps to two lines and drops the fixed 120px max-height', () => {
    const body = ruleBody('\\.ghostText');
    assert.match(body, /display:\s*-webkit-box;/, 'legacy box clamp container');
    assert.match(body, /-webkit-line-clamp:\s*2;/, 'two-line clamp');
    assert.match(body, /-webkit-box-orient:\s*vertical;/, 'vertical box orient');
    assert.match(body, /overflow:\s*hidden;/, 'overflow hidden');
    assert.doesNotMatch(body, /max-height:\s*120px/, 'old unbounded max-height removed');
    assert.doesNotMatch(body, /white-space:\s*pre-wrap/, 'pre-wrap conflicts with -webkit-box clamp');
  });

  it('.textareaWithGhost clips the overlay so it cannot paint over .chatInputBottom', () => {
    assert.match(ruleBody('\\.textareaWithGhost'), /overflow:\s*hidden;/);
  });

  it('.interimPreview is capped to the composer box instead of a fixed px height', () => {
    // The wrapper clip above would otherwise cut the top line of the live voice
    // transcript whenever the fixed max-height exceeds the resting composer height.
    assert.match(ruleBody('\\.interimPreview'), /max-height:\s*100%;/);
    const mediaStart = css.indexOf('@media (max-width: 768px)');
    const padStart = css.indexOf(':global(html.pad-mode)');
    assert.match(css.slice(mediaStart, padStart), /\.interimPreview\s*\{[^}]*max-height:\s*100%;/, 'phone interim cap');
    assert.match(css, /:global\(html\.pad-mode\)\s+\.interimPreview\s*\{[^}]*max-height:\s*100%;/, 'pad interim cap');
  });

  it('two-line floor uses desktop, phone and pad metrics', () => {
    assert.match(ruleBody('\\.chatTextareaTwoLines'), /min-height:\s*58px/, 'desktop floor 58px');
    const mediaStart = css.indexOf('@media (max-width: 768px)');
    const padStart = css.indexOf(':global(html.pad-mode)');
    assert.ok(mediaStart > 0, 'phone media block exists');
    assert.ok(padStart > mediaStart, 'phone block must precede pad-mode overrides');
    const mobile = css.slice(mediaStart, padStart);
    assert.match(mobile, /\.chatTextareaTwoLines\s*\{\s*min-height:\s*92px;\s*\}/, 'phone floor 92px');
    assert.match(css, /:global\(html\.pad-mode\)\s+\.chatTextareaTwoLines\s*\{\s*min-height:\s*58px;\s*\}/, 'pad floor 58px');
  });

  it('two-line floor rules come after the base textarea rule in each scope', () => {
    // Equal specificity: a floor rule placed before its base .chatTextarea rule would
    // silently lose the cascade (min-height 37/52px wins) while every regex above stays green.
    const desktopFloor = css.indexOf('.chatTextareaTwoLines {');
    const desktopBase = css.indexOf('.chatTextarea {');
    assert.ok(desktopBase > 0 && desktopFloor > desktopBase, 'desktop floor must follow base rule');
    const mediaStart = css.indexOf('@media (max-width: 768px)');
    const padStart = css.indexOf(':global(html.pad-mode)');
    const mobileSlice = css.slice(mediaStart, padStart);
    const mFloor = mobileSlice.indexOf('.chatTextareaTwoLines');
    const mBase = mobileSlice.indexOf('.chatTextarea {');
    assert.ok(mBase > 0 && mFloor > mBase, 'phone floor must follow base rule inside the media block');
    const padFloor = css.indexOf(':global(html.pad-mode) .chatTextareaTwoLines');
    const padBase = css.indexOf(':global(html.pad-mode) .chatTextarea {');
    assert.ok(padBase > 0 && padFloor > padBase, 'pad floor must follow pad base rule');
  });

  it('ChatInputBar measures the clamped ghost and toggles the two-line class', () => {
    assert.match(jsx, /const ghostRef = useRef\(null\);/, 'ghost ref exists');
    assert.match(jsx, /<div ref=\{ghostRef\} className=\{styles\.ghostText\}>/, 'ghost div carries the ref');
    const effect = jsx.match(/useLayoutEffect\(\(\) => \{([\s\S]*?)\}, \[inputSuggestion, inputEmpty, terminalVisible, sdkMode\]\);/);
    assert.ok(effect, 'ghost measurement effect keyed by suggestion/empty/terminal state must exist');
    assert.match(effect[1], /ghostRef\.current/, 'effect reads the ghost element');
    assert.match(effect[1], /clientHeight/, 'effect measures the clamped height');
    assert.match(effect[1], /clientHeight\s*>\s*lineH\s*\+\s*padV/, 'threshold includes the vertical padding term');
    assert.match(effect[1], /ResizeObserver/, 'effect re-measures on width changes');
    assert.match(effect[1], /ro\.observe\(ghost\)/, 'observer attaches to the ghost element');
    assert.match(effect[1], /ro\.disconnect\(\)/, 'observer is disconnected on cleanup');
    assert.match(jsx, /setGhostTwoLines\(false\)/, 'ghost reset when unmounted');
    assert.match(jsx, /\$\{ghostTwoLines \? ` \$\{styles\.chatTextareaTwoLines\}` : ''\}/, 'floor class applied conditionally');
  });

  it('resizeChatTextarea neutralizes any min-height floor while measuring', () => {
    // Handlers resize before the state commit that removes a min-height class, so the
    // floor would pin scrollHeight and leave the inline height stuck at 92/58px.
    assert.match(jsx, /ta\.style\.minHeight = '0px'/, 'floor neutralized before reading scrollHeight');
    assert.match(jsx, /ta\.style\.minHeight = prevMin/, 'previous inline min-height restored');
  });

  it('ghost hooks stay above the terminalVisible early return (rules of hooks)', () => {
    const hookIdx = jsx.indexOf('const ghostRef = useRef(null)');
    const effectIdx = jsx.indexOf('}, [inputSuggestion, inputEmpty, terminalVisible, sdkMode]);');
    const earlyReturnIdx = jsx.indexOf('if (terminalVisible && !sdkMode) {');
    assert.ok(hookIdx > 0, 'ghost hook present');
    assert.ok(effectIdx > 0, 'ghost effect present');
    assert.ok(earlyReturnIdx > hookIdx, 'ghost hooks must not sit below the conditional return');
    assert.ok(earlyReturnIdx > effectIdx, 'ghost effect must not sit below the conditional return');
  });
});
