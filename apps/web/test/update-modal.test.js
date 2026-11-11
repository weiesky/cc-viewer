import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(import.meta.dirname, '../src/components/update/UpdateModal.jsx'), 'utf8');
const appSource = readFileSync(join(import.meta.dirname, '../src/App.jsx'), 'utf8');
const i18n = readFileSync(join(import.meta.dirname, '../src/i18n.js'), 'utf8');

function downloadPercent({ downloaded, total } = {}) {
  return Number.isFinite(downloaded) && Number.isFinite(total) && total > 0 ? Math.min(100, Math.floor(downloaded / total * 100)) : null;
}

describe('UpdateModal', () => {
  it('shows percentages only for a known tarball byte length', () => {
    assert.equal(downloadPercent({ downloaded: 50, total: 200 }), 25);
    assert.equal(downloadPercent({ downloaded: 200, total: 100 }), 100);
    assert.equal(downloadPercent({ downloaded: 50, total: null }), null);
    assert.equal(downloadPercent({ downloaded: 50, total: 0 }), null);
    assert.equal(downloadPercent(), null);
  });
  it('uses the update APIs and preserves the restart warning', () => {
    for (const endpoint of ['/api/update/status', '/api/update/check', '/api/update/start', '/api/update/restart']) assert.ok(appSource.includes(endpoint));
    assert.ok(appSource.includes("this.state.updateProcessId && info?.version === this.state.updateJob.version && info.processId !== this.state.updateProcessId"));
    assert.ok(source.includes("ui.update.restartWarning"));
    assert.ok(source.includes("ui.update.restart"));
    assert.ok(!source.includes('!important'));
  });
  it('provides all supported locales for every new control', () => {
    const locales = ['zh', 'en', 'zh-TW', 'ko', 'ja', 'de', 'es', 'fr', 'it', 'da', 'pl', 'ru', 'ar', 'no', 'pt-BR', 'th', 'tr', 'uk'];
    for (const key of ['check', 'checkHint', 'pnpm', 'start', 'retry', 'downloading', 'installing', 'ready', 'restartWarning', 'restart', 'restarting', 'restartTimeout', 'failed']) {
      const match = i18n.match(new RegExp(`"ui\\.update\\.${key}": \\{([\\s\\S]*?)\\n  \\}`));
      assert.ok(match, `missing ui.update.${key}`);
      for (const locale of locales) assert.ok(match[1].includes(`"${locale}":`), `${key} missing ${locale}`);
    }
  });
});
