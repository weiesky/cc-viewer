/**
 * logs-modal.test.js — source-contract tests for the three log-management
 * fixes (render-level tests cannot run under node:test, so we assert the
 * JSX/CSS wiring directly, following minimal-chat-wiring.test.js):
 *
 * 1. Project switch no longer lags one round: handleLogsProjectChange must
 *    issue _fetchV2Logs(1) from the setState callback (setState is async —
 *    calling _localLogsUrl right after setState reads the PREVIOUS
 *    logViewProject and requests the old project's list).
 * 2. No pager for a single page: renderLogTable must gate the pagination
 *    object on localLogsTotal > LOG_PAGE_SIZE instead of relying on antd's
 *    unreliable hideOnSinglePage.
 * 3. Pager item spacing: App.module.css gives antd pagination items a 4px
 *    gap, scoped to .logListContainer, without !important.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(__dirname, '..', 'src', ...p), 'utf-8');

const appBase = src('AppBase.jsx');
const appCss = src('App.module.css');

describe('logs modal — project switch has no one-round lag', () => {
  it('fetches page 1 from the setState callback, not right after setState', () => {
    const handlerAt = appBase.indexOf('handleLogsProjectChange = (project) => {');
    assert.ok(handlerAt > 0, 'handler exists');
    const body = appBase.slice(handlerAt, handlerAt + 1200);
    // The fetch must appear inside the setState updater's callback argument.
    assert.ok(/\}\s*,\s*\(\)\s*=>\s*\{[\s\S]*?_fetchV2Logs\(1\)/.test(body),
      '_fetchV2Logs(1) runs inside the setState callback');
    // And must NOT run bare right after the setState call (the old bug shape:
    // setState({...}); then fetch reading the still-stale state).
    assert.ok(!/selectedLogs: new Set\(\),\s*\}\);\s*if \(this\.state\.logView/.test(body),
      'no bare fetch after setState');
  });

  it('handleImportLocalLogs has the same callback shape (migration-done path)', () => {
    const handlerAt = appBase.indexOf('handleImportLocalLogs = () => {');
    assert.ok(handlerAt > 0, 'handler exists');
    const body = appBase.slice(handlerAt, handlerAt + 1400);
    assert.ok(/\}\s*,\s*\(\)\s*=>\s*\{[\s\S]*?_fetchV2Logs\(1\)/.test(body),
      '_fetchV2Logs(1) runs inside the setState callback');
    assert.ok(!/logViewProject: '' \}\);\s*this\._fetchV2Logs/.test(body),
      'no bare fetch after the logViewProject reset');
  });
});

describe('logs modal — pager hidden on a single page', () => {
  it('gates pagination on localLogsTotal > LOG_PAGE_SIZE', () => {
    assert.ok(/pagination = isV2 && total > LOG_PAGE_SIZE\s*\?/.test(appBase),
      'pagination object only when more than one page');
    // The prop must be gone; a comment mention is fine (it explains why).
    assert.ok(!appBase.includes('hideOnSinglePage,'),
      'hideOnSinglePage prop no longer passed');
  });
});

describe('logs modal — pager item spacing', () => {
  it('gives antd pagination items a 4px gap scoped to .logListContainer', () => {
    assert.ok(/\.logListContainer :global\(\.ant-pagination(\.ant-pagination)? \.ant-pagination-item\)/.test(appCss),
      'pagination items targeted under .logListContainer');
    assert.ok(/margin-inline-start: 4px/.test(appCss), '4px gap');
    const pagerBlock = appCss.slice(appCss.indexOf('Logs-modal pager'));
    const end = pagerBlock.indexOf('.logListItem {');
    assert.ok(end > 0, 'pager block ends before .logListItem');
    assert.ok(!/!important/.test(pagerBlock.slice(0, end)),
      'no !important in the pager rules');
  });
});
