/**
 * context-compaction-i18n.test.js — 18-locale coverage check for all "context compaction settings" i18n keys.
 * localeBlockOf mirrors quick-settings-i18n.test.js (the block ends at '\n  }' rather than the first '}'),
 * so a translation value containing '}' (e.g. {{var}} params) does not truncate early and miss the locales after it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const LOCALES = ['zh', 'en', 'zh-TW', 'ko', 'ja', 'de', 'es', 'fr', 'it', 'da', 'pl', 'ru', 'ar', 'no', 'pt-BR', 'th', 'tr', 'uk'];
const I18N_SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n.js'), 'utf-8');

function localeBlockOf(key) {
  const start = I18N_SRC.indexOf(`"${key}": {`);
  assert.ok(start >= 0, `key ${key} not found in src/i18n.js`);
  const end = I18N_SRC.indexOf('\n  }', start);
  assert.ok(end > start, `unterminated block for ${key}`);
  return I18N_SRC.slice(start, end);
}

const KEYS = [
  'ui.contextCompaction.menuItem',
  'ui.contextCompaction.title',
  'ui.contextCompaction.locked',
  'ui.contextCompaction.hint',
  'ui.contextCompaction.empty',
  'ui.contextCompaction.add',
  'ui.contextCompaction.edit',
  'ui.contextCompaction.deleteSelected',
  'ui.contextCompaction.enabled',
  'ui.contextCompaction.titleLabel',
  'ui.contextCompaction.titlePlaceholder',
  'ui.contextCompaction.scriptLabel',
  'ui.contextCompaction.scriptPlaceholder',
  'ui.contextCompaction.thresholdLabel',
  'ui.contextCompaction.modePercent',
  'ui.contextCompaction.modeTokens',
  'ui.contextCompaction.thresholdSummaryPercent',
  'ui.contextCompaction.thresholdSummaryTokens',
  'ui.contextCompaction.defaultTitle',
  'ui.contextCompaction.builtinDefaultTitle',
  'ui.contextCompaction.validation.scriptRequired',
  'ui.contextCompaction.validation.thresholdRange',
  'ui.contextCompaction.autoCompactHint',
  'ui.contextCompaction.autoCompactHintPct',
  'ui.contextCompaction.watermarkTip',
  'ui.contextCompaction.bar.title',
  'ui.contextCompaction.bar.body',
  'ui.contextCompaction.bar.confirm',
  'ui.contextCompaction.bar.injecting',
  'ui.contextCompaction.bar.busy',
  'ui.contextCompaction.bar.sent',
  'ui.contextCompaction.bar.failed',
  'ui.contextCompaction.bar.settings',
  'ui.contextCompaction.bar.ask',
  'ui.contextCompaction.bar.closeTitle',
  'ui.contextCompaction.executionTimingLabel',
  'ui.contextCompaction.timingUser',
  'ui.contextCompaction.timingS30',
  'ui.contextCompaction.timingM3',
  'ui.contextCompaction.timingAuto',
  'ui.contextCompaction.timingHint_user',
  'ui.contextCompaction.timingHint_s30',
  'ui.contextCompaction.timingHint_m3',
  'ui.contextCompaction.timingHint_auto',
  'ui.contextCompaction.timingSummary_user',
  'ui.contextCompaction.timingSummary_s30',
  'ui.contextCompaction.timingSummary_m3',
  'ui.contextCompaction.timingSummary_auto',
  'ui.contextCompaction.circuitOpen',
];

describe('context compaction i18n — all 18 locales', () => {
  for (const key of KEYS) {
    it(`${key} translated in every locale`, () => {
      const block = localeBlockOf(key);
      for (const locale of LOCALES) {
        assert.ok(block.includes(`"${locale}":`), `missing ${locale} translation for ${key}`);
      }
    });
  }
});
