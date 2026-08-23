/**
 * 18-locale i18n coverage test for the newly added UI keys (the non-"expert settings" part).
 *
 * expert-i18n.test.js only guards the expert-settings batch of keys; this working tree has
 * additional new/reused keys already translated into all 18 languages but lacking automated
 * guards — a missing locale silently falls back to en / the key itself via t().
 * Same pattern as test/expert-i18n.test.js / test/quick-settings-i18n.test.js.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const LOCALES = ['zh', 'en', 'zh-TW', 'ko', 'ja', 'de', 'es', 'fr', 'it', 'da', 'pl', 'ru', 'ar', 'no', 'pt-BR', 'th', 'tr', 'uk'];
const I18N_SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n.js'), 'utf-8');

// Use '\n  }' rather than the first '}' to end the block, so a translation value containing
// '}' does not truncate early and skip checking the following locales (same as
// expert-i18n.test.js).
function localeBlockOf(key) {
  const start = I18N_SRC.indexOf(`"${key}": {`);
  assert.ok(start >= 0, `key ${key} not found in src/i18n.js`);
  const end = I18N_SRC.indexOf('\n  }', start);
  assert.ok(end > start, `unterminated block for ${key}`);
  return I18N_SRC.slice(start, end);
}

const KEYS = [
  'ui.memoryOpenDir',   // persistent memory "open directory" button (server/routes/files-fs.js openMemoryDir)
  'ui.proxy.editProxy', // proxy settings "edit" standalone Modal title (ProxyModal.jsx)
  'ui.proxy.effort',        // proxy hot-switch effort dropdown label (ProxyModal.jsx)
  'ui.proxy.effortDefault', // proxy hot-switch effort "not enforced by default" option (ProxyModal.jsx)
  'ui.proxy.modelMapHint',  // proxy hot-switch extended-model field description (ProxyModal.jsx)
  'ui.systemMessage',       // mid-conversation role:"system" meta row label (ChatMessage/ChatView role filter)
  'ui.proxyStats.tabConfig', // proxy retry-config & stats panel "config" tab
  'ui.proxyStats.tabStats',  // proxy retry-config & stats panel "stats" tab
  'ui.retryConfig.groupStrategy',  // proxy retry-config "strategy config" group heading
  'ui.retryConfig.groupExecution', // proxy retry-config "execution params" group heading
  // retry-burden 5-bucket distribution labels (retryStatsHelpers.js burdenBucketLabel):
  'ui.proxyStats.retryBurdenBuckets.0',
  'ui.proxyStats.retryBurdenBuckets.1_5',
  'ui.proxyStats.retryBurdenBuckets.6_20',
  'ui.proxyStats.retryBurdenBuckets.21_50',
  'ui.proxyStats.retryBurdenBuckets.over50',
  // retry-mode Segmented labels (RetryConfigModal.jsx mode options):
  'ui.retryConfig.modeLabel.off',
  'ui.retryConfig.modeLabel.serial',
  'ui.retryConfig.modeLabel.race',
  'ui.retryConfig.modeLabel.stagger',
  // Split by role (ProxyModal assignment area + AppHeader chip):
  'ui.proxy.assignmentTitle',
  'ui.proxy.roleMain',
  'ui.proxy.roleSubagent',
  'ui.proxy.roleTeammate',
  'ui.proxy.followMainResolved',
  'ui.proxy.badgeMain',
  'ui.proxy.badgeSubagent',
  'ui.proxy.badgeTeammate',
  'ui.proxy.roleSummary',
  // SDK-mode path fix (wsOpen restored + error channel + P1 UI):
  'ui.sdkError',     // SDK query-level failure toast (ChatView sdk-error branch)
  'ui.sdkCompacted', // SDK compact_boundary notice bar (ChatView sdk-compact branch)
  'ui.sdkSlashHint', // SDK slash-command hint (above the composer, when typing `/`)
];

describe('new UI key i18n coverage', () => {
  for (const key of KEYS) {
    it(`${key} 覆盖全部 18 个 locale`, () => {
      const block = localeBlockOf(key);
      for (const loc of LOCALES) {
        assert.ok(block.includes(`"${loc}":`), `${key} 缺少 locale ${loc}`);
      }
    });
  }
});
