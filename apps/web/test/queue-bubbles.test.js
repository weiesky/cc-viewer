/**
 * queue-bubbles.test.js — source-contract test for the busy-queue floating bubbles
 * (Enter-while-streaming → server-side queue → `queue-state` broadcast → stacked bubbles
 * above the composer with per-item "send now" / remove actions).
 *
 * Source-string contract style follows floating-input-stack.test.js: render-level tests
 * cannot run under node:test, so we assert the JSX/CSS wiring directly.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSX_PATH = join(__dirname, '..', 'src', 'components', 'chat', 'ChatView.jsx');
const CSS_PATH = join(__dirname, '..', 'src', 'components', 'chat', 'ChatView.module.css');

const jsx = readFileSync(JSX_PATH, 'utf-8');
const css = readFileSync(CSS_PATH, 'utf-8');

describe('queue bubbles — state + WS wiring', () => {
  it('queuedMessages state is initialized', () => {
    assert.ok(jsx.includes('queuedMessages: []'), 'queuedMessages state init exists');
  });

  it('queue-state WS branch replaces queuedMessages from the server snapshot', () => {
    assert.ok(jsx.includes("msg.type === 'queue-state'"), 'queue-state branch exists');
    const branch = jsx.match(/msg\.type === 'queue-state'[\s\S]{0,400}?setState\(\{ queuedMessages: Array\.isArray\(msg\.items\)/);
    assert.ok(branch, 'queue-state branch setStates queuedMessages from msg.items');
  });

  it('session/workspace switch clears local state AND notifies the server (queue-clear)', () => {
    const block = jsx.match(/queuedMessages\.length\)\s*\{[\s\S]{0,400}?queue-clear/);
    assert.ok(block, 'session-switch block clears queuedMessages and sends queue-clear');
  });

  it('ws-close cleanup covers queuedMessages', () => {
    const block = jsx.match(/_onTerminalWsState = \(state\)[\s\S]*?askQueue: \[\], askMetaMap: \{\}, pendingPtyPlan: null, queuedMessages: \[\]/);
    assert.ok(block, 'ws-close setState clears queuedMessages too');
  });
});

describe('queue bubbles — send path', () => {
  it('handleInputSend enqueues while busy instead of sending immediately', () => {
    const m = jsx.match(/uiStreamingNow[\s\S]{0,900}?'queue-message'/);
    assert.ok(m, 'busy branch sends queue-message (PTY mode)');
    assert.ok(m[0].includes("'sdk-user-message'"), 'busy branch keeps sdk-user-message for SDK mode');
    assert.ok(m[0].includes('onUserMessageSent'), 'busy branch keeps the context-bar unlock for non-/clear text');
  });

  it('busy branch deliberately skips the optimistic pendingInput bubble', () => {
    const m = jsx.match(/uiStreamingNow[\s\S]{0,900}?'queue-message'/);
    assert.ok(m, 'busy branch found');
    assert.ok(!m[0].includes('pendingInput:'), 'no pendingInput setState inside the busy branch');
  });

  it('Stop (PTY) sends queue-suppress so the parked queue survives the interrupt', () => {
    assert.ok(jsx.includes("'queue-suppress'"), 'handleInputStop PTY branch sends queue-suppress');
  });
});

describe('queue bubbles — render block', () => {
  // The bubbles must float directly above the composer: inside .inputStack, before ChatInputBar.
  const stackIdx = jsx.indexOf('styles.inputStack');
  const bubblesIdx = jsx.indexOf('styles.queueBubbleStack');
  const inputBarIdx = jsx.indexOf('<ChatInputBar');

  it('bubble stack renders inside .inputStack before <ChatInputBar>', () => {
    assert.ok(stackIdx >= 0 && bubblesIdx > stackIdx && inputBarIdx > bubblesIdx,
      'queueBubbleStack sits between inputStack open and ChatInputBar');
  });

  it('maps queuedMessages with per-item remove + send-now buttons', () => {
    assert.ok(jsx.includes('this.state.queuedMessages.map'), 'renders one bubble per queued item');
    assert.ok(jsx.includes("{ type: 'queue-remove', id: item.id }"), 'remove button sends queue-remove');
    assert.ok(jsx.includes("{ type: 'queue-send-now', id: item.id }"), 'send-now button sends queue-send-now');
    assert.ok(jsx.includes("t('ui.chatInput.queueSendNow')"), 'send-now label is i18n');
    assert.ok(jsx.includes("t('ui.chatInput.queueRemove')"), 'remove label is i18n');
  });

  it('bubble buttons do not steal composer focus (onMouseDown preventDefault)', () => {
    const block = jsx.slice(bubblesIdx, inputBarIdx);
    const preventers = block.match(/onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/g) || [];
    assert.ok(preventers.length >= 2, 'both bubble buttons preventDefault on mousedown');
  });
});

describe('queue bubbles — CSS', () => {
  it('all bubble classes exist', () => {
    for (const cls of ['.queueBubbleStack', '.queueBubble', '.queueBubbleText', '.queueBubbleSendNow', '.queueBubbleRemove']) {
      assert.ok(css.includes(cls), `${cls} rule exists`);
    }
  });

  it('stack is height-capped and scrollable (long queue never eats the pane)', () => {
    const block = css.match(/\.queueBubbleStack\s*\{[\s\S]*?\}/);
    assert.ok(block, '.queueBubbleStack rule found');
    assert.ok(block[0].includes('max-height'), 'max-height set');
    assert.ok(block[0].includes('overflow-y: auto'), 'overflow-y auto');
  });

  it('bubbles visually match the composer card (bg / border / shadow / hover)', () => {
    const block = css.match(/\.queueBubble\s*\{[\s\S]*?\}/);
    assert.ok(block, '.queueBubble rule found');
    assert.ok(block[0].includes('var(--bg-composer)'), 'bubble background matches the composer card');
    assert.ok(block[0].includes('var(--shadow-composer)'), 'bubble shadow matches the composer card');
    assert.ok(block[0].includes('var(--border-secondary)'), 'bubble border matches the composer card');
    const hover = css.match(/\.queueBubble:hover\s*\{[\s\S]*?\}/);
    assert.ok(hover && hover[0].includes('border-color: var(--text-disabled)'),
      'bubble hover border-color mirrors the composer focus-within color');
  });

  it('stack width/centering follows the composer formula (max-1000px padded, mobile + pad overrides)', () => {
    const block = css.match(/\.queueBubbleStack\s*\{[\s\S]*?\}/);
    assert.ok(block && block[0].includes('calc((100% - 1000px) / 2)'), 'desktop composer width formula');
    assert.ok(css.includes('padding: 2px 21px 6px'), 'mobile 21px gutters (chatInputBar parity)');
    assert.ok(css.includes(':global(html.pad-mode) .queueBubbleStack'), 'pad-mode restore override exists');
  });

  it('send-now button matches the composer send-button palette and is a full pill', () => {
    const block = css.match(/\.queueBubbleSendNow\s*\{[\s\S]*?\}/);
    assert.ok(block, '.queueBubbleSendNow rule found');
    assert.ok(block[0].includes('var(--text-white)'), 'send-button palette background');
    assert.ok(block[0].includes('var(--bg-base-pure)'), 'send-button palette foreground');
    assert.ok(/border-radius:\s*999px/.test(block[0]), 'fully rounded pill ends');
  });

  it('bubble text clamps to 2 lines', () => {
    const block = css.match(/\.queueBubbleText\s*\{[\s\S]*?\}/);
    assert.ok(block, '.queueBubbleText rule found');
    assert.ok(block[0].includes('-webkit-line-clamp: 2'), 'line clamp 2');
  });
});
