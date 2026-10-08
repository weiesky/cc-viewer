/**
 * i18n coverage for the session-history quick-settings row + true-/resume confirm dialog
 * (2026-10-06 migration).
 *
 * The 18-locale sweep in menu-model.test.js only scans server/i18n.js; new keys in the
 * frontend src/i18n.js have no automatic coverage. This asserts every key the new
 * ResumeSessionsRow + Modal.confirm flow uses exists in all 18 locales, so a missing
 * translation fails loudly instead of t() silently falling back to the key/en.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const LOCALES = ['zh', 'en', 'zh-TW', 'ko', 'ja', 'de', 'es', 'fr', 'it', 'da', 'pl', 'ru', 'ar', 'no', 'pt-BR', 'th', 'tr', 'uk'];
const I18N_SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n.js'), 'utf-8');

// Same block-boundary convention as quick-settings-i18n.test.js: the block ends at the
// '\n  }' line, not the first '}', so a translated value containing '}' (e.g. a {{name}}
// param) does not truncate the block early and skip the locales after it.
function localeBlockOf(key) {
  const start = I18N_SRC.indexOf(`"${key}": {`);
  assert.ok(start >= 0, `key ${key} not found in src/i18n.js`);
  const end = I18N_SRC.indexOf('\n  }', start);
  assert.ok(end > start, `unterminated block for ${key}`);
  return I18N_SRC.slice(start, end);
}

const NEW_KEYS = [
  'ui.resume.history',         // menu row label
  'ui.resume.confirmTitle',    // Modal.confirm title
  'ui.resume.confirmContent',  // Modal.confirm body ({{name}} interpolation)
  'ui.resume.confirmOk',       // Modal.confirm ok button
  'ui.resume.busy',            // TUI-busy toast (true-resume deferred/refused)
  'ui.resume.failed',          // inject-failure toast
];

const REUSED_KEYS = [
  'ui.cancel',                 // Modal.confirm cancel button
  'ui.resume.loading',         // list loading state (reused by ResumeSessionsList)
  'ui.resume.empty',           // list empty state (reused)
];

describe('session-history menu + resume confirm i18n — all 18 locales', () => {
  for (const key of [...NEW_KEYS, ...REUSED_KEYS]) {
    it(`${key} present in all 18 locales`, () => {
      const block = localeBlockOf(key);
      for (const locale of LOCALES) {
        assert.ok(block.includes(`"${locale}"`), `${key} missing locale "${locale}"`);
      }
    });
  }

  it('ui.resume.confirmContent interpolates {{name}}', () => {
    const block = localeBlockOf('ui.resume.confirmContent');
    assert.ok(block.includes('{{name}}'), 'confirmContent must carry the {{name}} placeholder');
  });
});
