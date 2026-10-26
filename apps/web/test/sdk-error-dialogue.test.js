/**
 * sdk-error-dialogue.test.js — source-contract test for the persistent SDK error rows
 * pinned in the dialogue tail (sdk-error WS frame → toast + `sdkErrors` state → row(s)
 * in all three messageList branches; same error merges into one row with a ×N count).
 *
 * Source-string contract style follows queue-bubbles.test.js: render-level tests cannot
 * run under node:test, so we assert the JSX/CSS wiring directly.
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

describe('sdk-error dialogue rows — state + WS branch', () => {
  it('sdkErrors state is initialized in the ctor block', () => {
    // Bound the window at the ctor state literal's closing `};` so a deleted init
    // cannot false-pass by matching a later clear site.
    const m = jsx.match(/this\.state = \{[\s\S]*?\n    \};/);
    assert.ok(m, 'ctor state literal found');
    assert.ok(m[0].includes('sdkErrors: []'), 'sdkErrors init exists inside the ctor state literal');
  });

  it('sdk-error branch guards with an early return BEFORE the toast and the row update', () => {
    const m = jsx.match(/msg\.type === 'sdk-error'\)\s*\{[\s\S]*?msg\.type === 'sdk-init'/);
    assert.ok(m, 'sdk-error branch found');
    assert.match(m[0], /if \(!this\._sdkFrameMatchesView\(msg\)\) return;/, 'out-of-scope frames return early (no toast, no row)');
    const guardIdx = m[0].indexOf('if (!this._sdkFrameMatchesView(msg)) return;');
    const toastIdx = m[0].indexOf("message.error(t('ui.sdkError'");
    const setStateIdx = m[0].indexOf('this.setState(prev =>');
    assert.ok(toastIdx > -1, 'eager toast is kept');
    assert.ok(guardIdx < toastIdx, 'guard precedes the toast');
    assert.ok(guardIdx < setStateIdx, 'guard precedes the row update');
  });

  it('same error merges into one row with a recurrence count (no duplicate rows)', () => {
    const m = jsx.match(/msg\.type === 'sdk-error'\)\s*\{[\s\S]*?msg\.type === 'sdk-init'/);
    assert.ok(m, 'sdk-error branch found');
    assert.ok(m[0].includes('.filter(e => e.message !== detail)'), 'existing row with the same message is taken out');
    assert.ok(m[0].includes('.find(e => e.message === detail)'), 'previous entry is looked up for its count');
    assert.match(m[0], /count:\s*\(prevEntry\?\.count \|\| 0\) \+ 1/, 'count increments on recurrence');
    assert.ok(m[0].includes('.slice(-3)'), 'stack is capped at 3 distinct messages');
  });

  it('an explicit user send clears the rows at every SDK send site (incl. queue-send-now)', () => {
    assert.ok(jsx.includes('_clearSdkErrors'), 'clear helper exists');
    const marks = jsx.match(/_clearSdkErrors\(\);/g) || [];
    // 3 sdk-user-message sites + the queue-send-now click handler.
    assert.ok(marks.length >= 4, `all explicit-send sites clear the rows (${marks.length} call sites)`);
    const helper = jsx.match(/_clearSdkErrors = \(\) => \{[\s\S]{0,300}?\};/);
    assert.ok(helper, 'helper body found');
    assert.match(helper[0], /setState\(\{ sdkErrors: \[\] \}\)/, 'helper clears sdkErrors');
    assert.ok(!helper[0].includes('_lastUserSendTs'), 'no write-only timestamp field');
    // The clear sits in the same click handler, before the send literal.
    const sendNowIdx = jsx.indexOf("'queue-send-now'");
    assert.ok(sendNowIdx > -1, 'queue-send-now send found');
    const handlerStart = jsx.lastIndexOf('onClick={() => {', sendNowIdx);
    assert.ok(jsx.slice(handlerStart, sendNowIdx).includes('_clearSdkErrors()'), 'queue-send-now clears the rows too');
  });

  it('rows are NOT cleared on sdk-session-state running (auto-drain would wipe them)', () => {
    const m = jsx.match(/msg\.type === 'sdk-session-state'\)\s*\{[\s\S]*?\} else if \(msg\.type ===/);
    assert.ok(m, 'sdk-session-state branch found');
    assert.ok(!m[0].includes('sdkErrors'), 'session-state branch never touches sdkErrors');
  });
});

describe('sdk-error dialogue rows — view/session switch clearing', () => {
  it('workspace switch clears sdkErrors together with sdkCompactNotices', () => {
    assert.ok(
      jsx.includes('sdkCompactNotices: [], sdkErrors: []'),
      'projectName switch block clears both SDK surfaces',
    );
  });

  it('viewSwitched clears sdkErrors', () => {
    const m = jsx.match(/if \(viewSwitched \|\| planLostView\) \{[\s\S]*?\n    \}\n/);
    assert.ok(m, 'viewSwitched block found');
    assert.ok(m[0].includes('this._clearSdkErrors()'), 'viewSwitched clears sdkErrors via the shared helper');
  });

  it('attachedSid change clears sdkErrors (same-workspace session switch); Mobile passes attachedSid', () => {
    const m = jsx.match(/prevProps\.attachedSid !== this\.props\.attachedSid[\s\S]{0,160}?_clearSdkErrors\(\)/);
    assert.ok(m, 'attachedSid diff branch clears sdkErrors via the shared helper');
    const mobile = readFileSync(join(__dirname, '..', 'src', 'Mobile.jsx'), 'utf-8');
    const cv = mobile.match(/<ChatView[\s\S]*?\/>/);
    assert.ok(cv && cv[0].includes('attachedSid={'), 'Mobile ChatView receives attachedSid');
  });
});

describe('sdk-error dialogue rows — rendering', () => {
  it('_renderSdkErrors renders the row stack with per-row count and timestamp', () => {
    const m = jsx.match(/_renderSdkErrors = \(emptyState = false\) => \{[\s\S]*?_closeSlashMenu/);
    assert.ok(m, '_renderSdkErrors helper found');
    // The visible stack is NOT a live region (recurrences must not re-read 3 traces);
    // a separate always-mounted announcer carries a one-line summary.
    assert.ok(!m[0].includes('role="status"'), 'visible stack is not a live region');
    assert.ok(m[0].includes('styles.sdkErrorStack'), 'stack class used');
    assert.ok(m[0].includes('sdkErrorStackEmpty'), 'empty-state modifier applied via the emptyState arg');
    assert.ok(m[0].includes('styles.sdkErrorRow'), 'row class used');
    assert.ok(m[0].includes('key={detail}'), 'rows are keyed by message (merge keeps them unique)');
    assert.ok(m[0].includes('×{count}'), 'recurrence count rendered');
    assert.ok(m[0].includes('styles.sdkErrorCount'), 'count badge class used');
    assert.ok(m[0].includes('formatHms(new Date(ts))'), 'HH:MM:SS timestamp rendered');
    assert.ok(m[0].includes("t('ui.sdkError', { detail }"), 'existing i18n key reused');
  });

  it('_renderSdkErrorAnnouncer is an always-mounted visually-hidden live region (sdkMode only)', () => {
    const m = jsx.match(/_renderSdkErrorAnnouncer = \(\) => \{[\s\S]*?_renderSdkErrors/);
    assert.ok(m, 'announcer helper found');
    assert.ok(m[0].includes('role="status"'), 'announcer is a live region');
    assert.ok(m[0].includes('styles.srOnly'), 'announcer is visually hidden');
    assert.ok(m[0].includes('rows.length ? rows[rows.length - 1] : null'), 'announces only the latest error');
    assert.ok(m[0].includes("t('ui.sdkError', { detail: latest.message })"), 'announces the localized one-liner');
    // Mounted once, near the other SDK surfaces.
    const mount = jsx.match(/<WorkflowLiveHud \/>\s*\{this\._renderSdkErrorAnnouncer\(\)\}/);
    assert.ok(mount, 'announcer is mounted beside WorkflowLiveHud');
    assert.ok(css.includes('.srOnly'), 'srOnly CSS rule exists');
  });

  it('formatHms is imported (a dropped import would throw at render time)', () => {
    assert.match(jsx, /import \{[^}]*formatHms[^}]*\} from '[^']*utils\/formatters'/, 'formatHms import exists');
  });

  it('rendered in all three messageList branches (noData / Virtuoso footer / desktop list)', () => {
    const calls = jsx.match(/this\._renderSdkErrors\(/g) || [];
    assert.ok(calls.length >= 3, `_renderSdkErrors has ${calls.length} call sites (need ≥3)`);
    const noData = jsx.match(/\(noData \|\| loading\) \? \([\s\S]*?\)\s*:\s*\(\s*<div className=\{roleFilterBar/);
    assert.ok(noData && noData[0].includes('_renderSdkErrors(true)'), 'noData/loading branch renders the rows with the empty-state modifier');
    const footer = jsx.match(/_virtuosoFooter = <>[\s\S]{0,900}?inputStackSpacer/);
    assert.ok(footer && footer[0].includes('_renderSdkErrors()'), 'Virtuoso footer renders the rows');
    const desktop = jsx.match(/pendingBubble\}\s*\{this\._renderSdkErrors\(\)\}\s*\{streamingLiveItem && \(/);
    assert.ok(desktop, 'desktop list renders the rows before the streaming overlay');
  });

  it('cdU re-sticks the scroller when rows grow while pinned at the bottom', () => {
    const m = jsx.match(/prevState\.sdkErrors !== this\.state\.sdkErrors[\s\S]{0,300}?startSmoothFollow/);
    assert.ok(m, 'sdkErrors sticky-follow branch exists');
    assert.ok(m[0].includes('stickyBottom'), 'only follows when pinned at the bottom');
  });
});

describe('sdk-error dialogue rows — CSS contract', () => {
  it('.sdkErrorStack and .sdkErrorRow rules exist with theme error vars', () => {
    assert.ok(css.includes('.sdkErrorStack'), 'sdkErrorStack rule exists');
    assert.ok(css.includes('.sdkErrorRow'), 'sdkErrorRow rule exists');
    assert.ok(css.includes('.sdkErrorCount'), 'sdkErrorCount rule exists');
    assert.ok(css.includes('.sdkErrorTs'), 'sdkErrorTs rule exists');
    const row = css.match(/\.sdkErrorRow \{[\s\S]{0,500}?\}/);
    assert.ok(row, 'sdkErrorRow block found');
    assert.ok(row[0].includes('var(--color-error)'), 'error text color var');
    assert.ok(row[0].includes('var(--color-error-bg-light)'), 'error background var');
    assert.ok(row[0].includes('var(--color-error-border)'), 'error border var');
  });

  it('.sdkErrorStackEmpty pins to the tail; the base stack keeps a normal top margin', () => {
    const stack = css.match(/\.sdkErrorStack \{[\s\S]{0,500}?\}/);
    assert.ok(stack, 'sdkErrorStack block found');
    assert.ok(!stack[0].includes('margin-top: auto'), 'base stack has NO auto top margin (would gap short conversations)');
    assert.ok(stack[0].includes('calc(100% - 32px)'), 'width insets without colliding with .container > * margins');
    assert.ok(stack[0].includes('flex-shrink: 0'), 'rows never get squeezed by the flex container');
    const empty = css.match(/\.sdkErrorStackEmpty \{[\s\S]{0,200}?\}/);
    assert.ok(empty, 'sdkErrorStackEmpty block found');
    assert.ok(empty[0].includes('margin-top: auto'), 'empty-state modifier pins to the tail');
  });

  it('no !important anywhere in the new rules', () => {
    for (const cls of ['sdkErrorStack', 'sdkErrorStackEmpty', 'sdkErrorRow', 'sdkErrorCount', 'sdkErrorTs', 'srOnly']) {
      const block = css.match(new RegExp(`\\.${cls} \\{[\\s\\S]{0,500}?\\}`));
      assert.ok(block, `${cls} block found`);
      assert.ok(!block[0].includes('!important'), `${cls} must not use !important`);
    }
  });
});
