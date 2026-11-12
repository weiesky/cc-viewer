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
  it('provides all supported locales for every new control', () => {
    const locales = ['zh', 'en', 'zh-TW', 'ko', 'ja', 'de', 'es', 'fr', 'it', 'da', 'pl', 'ru', 'ar', 'no', 'pt-BR', 'th', 'tr', 'uk'];
    for (const key of ['check', 'checkHint', 'pnpm', 'start', 'retry', 'downloading', 'installing', 'ready', 'restartWarning', 'restart', 'restarting', 'restartTimeout', 'restartFailed', 'manual', 'otherInstance', 'remoteRestart', 'manualRestart', 'upToDate', 'later', 'newBadge', 'failed']) {
      const match = i18n.match(new RegExp(`"ui\\.update\\.${key}": \\{([\\s\\S]*?)\\n  \\}`));
      assert.ok(match, `missing ui.update.${key}`);
      for (const locale of locales) assert.ok(match[1].includes(`"${locale}":`), `${key} missing ${locale}`);
    }
  });
});
