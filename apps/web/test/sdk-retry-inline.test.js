/**
 * sdk-retry-inline.test.js (web, source-anchor per the sdk-error-dialogue.test.js
 * precedent — ChatView cannot be constructed under node:test). Batch B frontend: the
 * ChatView handles sdk-retry-state frames, keeps the cleanup keyed by the FAILED turn id
 * (retryOf), renders a retry progress line + manual [retry] button, and sends
 * sdk-retry-turn on click with a 15s fallback.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const jsx = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'components', 'chat', 'ChatView.jsx'), 'utf-8');
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'components', 'chat', 'ChatView.module.css'), 'utf-8');

describe('sdk-retry inline bar (批次 B frontend)', () => {
  it('holds sdkRetry state and handles the sdk-retry-state WS frame with the view guard', () => {
    assert.ok(jsx.includes('sdkRetry: null'), 'sdkRetry state initialized');
    const m = jsx.match(/msg\.type === 'sdk-retry-state'\)\s*\{[\s\S]*?else if \(msg\.type === 'sdk-init'/);
    assert.ok(m, 'sdk-retry-state branch found');
    assert.ok(m[0].includes('_sdkFrameMatchesView(msg)'), 'retry frames are view-guarded like other sdk frames');
    for (const phase of ['retrying', 'recovering', 'recovered', 'rejected']) {
      assert.ok(m[0].includes(`'${phase}'`), `handles phase ${phase}`);
    }
  });

  it('cleans up by retryOf (the FAILED turn id), never the new turn id', () => {
    const m = jsx.match(/msg\.type === 'sdk-retry-state'\)\s*\{[\s\S]*?else if \(msg\.type === 'sdk-init'/);
    // recovering marks the failed row; recovered removes the row matched by retryOf.
    assert.ok(m[0].includes('msg.retryOf'), 'uses retryOf for matching');
    assert.ok(m[0].includes('e.turnId === msg.retryOf'), 'recovered matches the failed row by retryOf');
  });

  it('renders the retry progress line and the manual [retry] button with i18n keys', () => {
    assert.ok(jsx.includes('styles.sdkRetryRow'), 'retry progress row class used');
    assert.ok(jsx.includes('styles.sdkRetryBtn'), 'retry button class used');
    assert.ok(jsx.includes("t('ui.sdkRetry.retrying'"), 'retrying progress i18n');
    assert.ok(jsx.includes("t('ui.sdkRetry.retryingNetwork'"), 'network-error variant');
    assert.ok(jsx.includes("t('ui.sdkRetry.retry')"), 'retry button label');
    assert.ok(jsx.includes('_handleSdkRetry(row)'), 'button wired to the retry handler');
  });

  it('_handleSdkRetry sends sdk-retry-turn with the failed turnId and a 15s fallback', () => {
    const m = jsx.match(/_handleSdkRetry = \(row\) => \{[\s\S]*?_armSdkRetryReset = /);
    assert.ok(m, '_handleSdkRetry found');
    assert.ok(m[0].includes("type: 'sdk-retry-turn'"), 'sends sdk-retry-turn');
    assert.ok(m[0].includes('turnId: row.turnId'), 'carries the failed turn id');
    assert.ok(m[0].includes('ui.sendFailed'), 'WS-closed path warns via ui.sendFailed');
    assert.ok(jsx.includes('15000'), '15s fallback reset present');
    assert.ok(jsx.includes('this._sdkRetryResetTimer'), 'reset timer tracked for unmount cleanup');
  });

  it('provides the CSS classes (a missing CSS-Modules class silently no-ops)', () => {
    assert.ok(css.includes('.sdkRetryRow'), '.sdkRetryRow defined');
    assert.ok(css.includes('.sdkRetryBtn'), '.sdkRetryBtn defined');
    // The NEW retry rules must not use !important (repo rule; other legacy rules are
    // out of scope for this anchor).
    for (const cls of ['sdkRetryRow', 'sdkRetryBtn', 'sdkRetryRecovering']) {
      const rule = css.match(new RegExp('\\.' + cls + '\\b[^}]*\\}'));
      if (rule) assert.ok(!rule[0].includes('!important'), `${cls} must not use !important`);
    }
  });
});
