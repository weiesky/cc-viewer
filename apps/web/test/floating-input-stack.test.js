import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = join(__dirname, '..', 'src', 'components', 'chat', 'ChatView.module.css');
const JSX_PATH = join(__dirname, '..', 'src', 'components', 'chat', 'ChatView.jsx');
const INPUT_CSS_PATH = join(__dirname, '..', 'src', 'components', 'chat', 'ChatInputBar.module.css');

const css = readFileSync(CSS_PATH, 'utf-8');
const jsx = readFileSync(JSX_PATH, 'utf-8');
const inputCss = readFileSync(INPUT_CSS_PATH, 'utf-8');

describe('floating inputStack layout regression', () => {
  // Functional: spacer div exists in both desktop and Virtuoso paths
  it('desktop .container has inputStackSpacer div', () => {
    // The spacer must be inside the scrollable container so it contributes scroll height.
    assert.ok(jsx.includes('styles.inputStackSpacer'), 'inputStackSpacer class referenced in JSX');
  });

  it('Virtuoso footer has inputStackSpacer div', () => {
    // Virtuoso Footer renders inside the scroller content flow.
    const footerMatch = jsx.match(/_virtuosoFooter\s*=[\s\S]*?inputStackSpacer/);
    assert.ok(footerMatch, 'inputStackSpacer found in _virtuosoFooter');
  });

  it('inputStack div has ref for ResizeObserver measurement', () => {
    assert.ok(jsx.includes('ref={this.inputStackRef}'), 'inputStack has ref');
  });

  it('ResizeObserver lifecycle: bind in cDM + cDU, disconnect in cWU', () => {
    assert.ok(jsx.includes('_bindInputStackRO'), 'bind method exists');
    assert.ok(jsx.includes('this._inputStackRO.disconnect()'), 'disconnect in unmount');
    assert.ok(jsx.includes("removeProperty('--input-stack-height')"), 'CSS var cleanup in unmount');
  });

  // Style: key CSS assertions
  it('.inputStack is absolute positioned with gradient background', () => {
    assert.ok(css.includes('.inputStack'), '.inputStack rule exists');
    assert.ok(css.includes('position: absolute') || css.includes('position:absolute'), 'absolute positioning');
    assert.ok(css.includes('linear-gradient'), 'gradient background');
    assert.ok(css.includes('to top'), 'gradient direction is to top');
    assert.ok(css.includes('pointer-events: none') || css.includes('pointer-events:none'), 'pointer-events none on container');
  });

  it('.inputStack > * re-enables pointer events', () => {
    assert.ok(css.includes('pointer-events: auto') || css.includes('pointer-events:auto'), 'children re-enable pointer events');
  });

  it('.stickyBottomBtn uses --input-stack-height for bottom', () => {
    assert.ok(css.includes('var(--input-stack-height'), 'stickyBottomBtn bottom uses CSS variable');
  });

  it('.inputStackSpacer has height from CSS variable', () => {
    assert.ok(css.includes('.inputStackSpacer'), '.inputStackSpacer rule exists');
    assert.ok(css.includes('var(--input-stack-height'), 'spacer height uses CSS variable');
  });

  it('.chatInputBar background is transparent', () => {
    assert.ok(inputCss.includes('background: transparent') || inputCss.includes('background:transparent'), 'chatInputBar is transparent');
  });

  it('no !important in any changed CSS rules (excluding comments)', () => {
    // Strip comments before checking for !important
    const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const inputCssNoComments = inputCss.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!cssNoComments.includes('!important'), 'no !important in ChatView.module.css rules');
    assert.ok(!inputCssNoComments.includes('!important'), 'no !important in ChatInputBar.module.css rules');
  });
});
