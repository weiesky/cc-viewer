import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(import.meta.dirname, '../src/components/update/UpdateModal.jsx'), 'utf8');
const appSource = readFileSync(join(import.meta.dirname, '../src/App.jsx'), 'utf8');
const i18n = readFileSync(join(import.meta.dirname, '../src/i18n.js'), 'utf8');

import { downloadPercent, restartPollDecision } from '../src/utils/updateProgress.js';

describe('UpdateModal', () => {
  it('shows percentages only for a known tarball byte length', () => {
    assert.equal(downloadPercent({ downloaded: 50, total: 200 }), 25);
    assert.equal(downloadPercent({ downloaded: 200, total: 100 }), 100);
    assert.equal(downloadPercent({ downloaded: 50, total: null }), null);
    assert.equal(downloadPercent({ downloaded: 50, total: 0 }), null);
    assert.equal(downloadPercent(), null);
  });
  it('stops polling for a rejected restart or a restored old process', () => {
    const base = { previousProcessId: 'old', targetVersion: '2.0.0' };
    assert.equal(restartPollDecision({ ...base, responseOk: false }), 'error');
    assert.equal(restartPollDecision({ ...base, info: null }), 'wait');
    assert.equal(restartPollDecision({ ...base, info: { processId: 'old', version: '1.0.0' } }), 'wait');
    assert.equal(restartPollDecision({ ...base, info: { processId: 'new', version: '2.0.0' } }), 'reload');
    assert.equal(restartPollDecision({ ...base, info: { processId: 'new', version: '1.0.0' } }), 'restored');
  });
  it('uses the update APIs and preserves the restart warning', () => {
    for (const endpoint of ['/api/update/status', '/api/update/check', '/api/update/start', '/api/update/restart']) assert.ok(appSource.includes(endpoint));
    assert.ok(appSource.includes("restartPollDecision({ info, previousProcessId: this.state.updateProcessId, targetVersion: this.state.updateJob.version })"));
    assert.ok(source.includes("ui.update.restartWarning"));
    assert.ok(source.includes("ui.update.restart"));
    assert.ok(!source.includes('!important'));
  });
  it('shows a warning (not an error) and a danger "continue anyway" button when another instance is live', () => {
    // The otherInstance flow used to hide the start button entirely, which locked the
    // user out of updating from the very instance they were using. Lock in the new
    // contract: warning alert + danger button + Modal.confirm + force:true payload.
    assert.ok(source.includes("t('ui.update.otherInstanceWarning')"));
    assert.ok(source.includes("t('ui.update.otherInstanceContinue')"));
    assert.ok(source.includes("t('ui.update.otherInstanceConfirmTitle')"));
    assert.ok(source.includes("t('ui.update.otherInstanceConfirmContent')"));
    assert.ok(source.includes("t('ui.update.otherInstanceConfirmOk')"));
    assert.ok(source.includes("onStart({ force: true })"));
    assert.ok(!source.includes("t('ui.update.otherInstance')"), 'old key retired');
    assert.ok(!source.includes('!anotherInstance && <Button'), 'the start button must not be hidden');
    assert.ok(appSource.includes("body: JSON.stringify({ force })"));
  });
  it('provides all supported locales for every new control', () => {
    const locales = ['zh', 'en', 'zh-TW', 'ko', 'ja', 'de', 'es', 'fr', 'it', 'da', 'pl', 'ru', 'ar', 'no', 'pt-BR', 'th', 'tr', 'uk'];
    for (const key of ['check', 'checkHint', 'pnpm', 'start', 'retry', 'downloading', 'installing', 'ready', 'restartWarning', 'restart', 'restarting', 'restartTimeout', 'restartFailed', 'manual', 'otherInstanceWarning', 'otherInstanceContinue', 'otherInstanceConfirmTitle', 'otherInstanceConfirmContent', 'otherInstanceConfirmOk', 'remoteRestart', 'manualRestart', 'upToDate', 'later', 'newBadge', 'failed', 'restartOverlayTitle', 'restartOverlayHint', 'restartOverlaySlow']) {
      const match = i18n.match(new RegExp(`"ui\\.update\\.${key}": \\{([\\s\\S]*?)\\n  \\}`));
      assert.ok(match, `missing ui.update.${key}`);
      for (const locale of locales) assert.ok(match[1].includes(`"${locale}":`), `${key} missing ${locale}`);
    }
  });
});
