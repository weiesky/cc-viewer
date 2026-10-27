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
const CHAT_MESSAGE_PATH = join(__dirname, '..', 'src', 'components', 'chat', 'ChatMessage.jsx');

const jsx = readFileSync(JSX_PATH, 'utf-8');
const css = readFileSync(CSS_PATH, 'utf-8');
const chatMessage = readFileSync(CHAT_MESSAGE_PATH, 'utf-8');

describe('queue bubbles — state + WS wiring', () => {
  it('queuedMessages state is initialized', () => {
    assert.ok(jsx.includes('queuedMessages: []'), 'queuedMessages state init exists');
  });

  it('queue-state WS branch replaces queuedMessages from the server snapshot', () => {
    assert.ok(jsx.includes("msg.type === 'queue-state'"), 'queue-state branch exists');
    const branch = jsx.match(/msg\.type === 'queue-state'[\s\S]{0,1200}?queuedMessages: items/);
    assert.ok(branch, 'queue-state branch setStates queuedMessages from msg.items');
    assert.ok(branch[0].includes('msg.project'), 'queue snapshots are also isolated by project');
  });

  it('session/workspace switch clears local state AND notifies the server (queue-clear)', () => {
    const block = jsx.match(/if \(this\.state\.queuedMessages\.length \|\| this\.state\.optimisticQueueMessages\.length\) \{\s*this\.setState\(\{ queuedMessages: \[\], optimisticQueueMessages: \[\] \}\);[\s\S]*?queue-clear[^;]+;/);
    assert.ok(block, 'session-switch block clears queuedMessages and sends queue-clear');
    assert.ok(block[0].includes('prevProps.viewProject || prevProps.projectName'), 'the clear targets the source view, not the destination queue');
    assert.ok(block[0].includes('prevProps.viewInstance'), 'the source instance is preserved');
  });

  it('ws-close cleanup covers queuedMessages', () => {
    const block = jsx.match(/_onTerminalWsState = \(state\)[\s\S]*?queuedMessages: \[\], optimisticQueueMessages: \[\]/);
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
    assert.ok(jsx.includes("type: 'queue-remove', id: item.id"), 'remove button sends queue-remove');
    assert.ok(jsx.includes("type: 'queue-send-now', id: item.id"), 'send-now button sends queue-send-now');
    assert.ok(jsx.includes("t('ui.chatInput.queueSendNow')"), 'send-now label is i18n');
    assert.ok(jsx.includes("t('ui.chatInput.queueRemove')"), 'remove label is i18n');
  });

  it('bubble buttons do not steal composer focus (onMouseDown preventDefault)', () => {
    const block = jsx.slice(bubblesIdx, inputBarIdx);
    const preventers = block.match(/onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/g) || [];
    assert.ok(preventers.length >= 2, 'both bubble buttons preventDefault on mousedown');
  });

  it('send-now creates a scoped pending conversation bubble before the original WS frame', () => {
    assert.ok(jsx.includes('optimisticQueueMessages: []'), 'local placeholder state is separate from server queue');
    assert.ok(jsx.includes('reconcileOptimisticQueueMessages'), 'real messages and queue snapshots share the reconciliation helper');
    const block = jsx.match(/_handleQueueSendNow = \(item\) => \{[\s\S]{0,1300}?queue-send-now/);
    assert.ok(block, 'click creates the placeholder before sending queue-send-now');
    assert.ok(block[0].includes('...scope'), 'placeholder retains project/instance/attached session scope');
    assert.ok(block[0].includes('scrollToBottom'), 'the pending bubble is immediately visible at the conversation tail');
    assert.ok(block[0].includes('sentAt'), 'placeholder is stamped with sentAt for the bounded ack sweep');
    assert.ok(!block[0].includes('pendingInput:'), 'send-now does not reuse the unrelated pendingInput lifecycle');
  });

  it('renders pending send-now messages in every conversation layout with existing i18n', () => {
    assert.ok(jsx.includes('key={`optimistic-queue-${item.id}`}'), 'placeholder keys use the queue id');
    assert.ok(jsx.includes("t('ui.chatInput.queueDispatching')"), 'pending status reuses the existing localized label');
    const count = (jsx.match(/\{pendingBubble\}\{optimisticQueueBubbles\}/g) || []).length;
    assert.equal(count, 3, 'empty, virtualized and regular chat layouts all render pending messages');
    assert.ok(css.includes('.optimisticQueueStatus'), 'pending status has a lightweight style');
    assert.ok(jsx.includes('labelSuffix='), 'the dispatching chip is passed into ChatMessage via labelSuffix');
    assert.ok(!jsx.includes('<div className={styles.optimisticQueueStatus}'), 'no standalone status div below the bubble');
  });

  it('puts the dispatching chip inline right after the timestamp via labelSuffix', () => {
    const matches = chatMessage.match(/\{timeStr && <Text className=\{styles\.timeTextNoMargin\}>\{timeStr\}<\/Text>\}\s*\{labelSuffix\}/g) || [];
    assert.equal(matches.length, 2, 'labelSuffix renders right after the timestamp in both user branches (compact + normal)');
    assert.ok(chatMessage.includes('p.labelSuffix !== n.labelSuffix'), 'labelSuffix participates in shouldComponentUpdate');
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

  it('dispatching chip is inline text for the label row (not a block row)', () => {
    const block = css.match(/\.optimisticQueueStatus\s*\{[\s\S]*?\}/);
    assert.ok(block, '.optimisticQueueStatus rule found');
    assert.ok(block[0].includes('margin-left: 6px'), 'inline offset from the timestamp');
    assert.ok(block[0].includes('font-size: 11px'), 'matches the label row type scale (username is 11px)');
    assert.ok(block[0].includes('white-space: nowrap'), 'single-line chip');
    assert.ok(block[0].includes('flex-shrink: 0'), 'flex item does not shrink');
    assert.ok(!block[0].includes('text-align: right'), 'no longer a right-aligned block row');
  });
});
