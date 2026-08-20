/**
 * 18-locale completeness for the IM tri-state connection status keys in the frontend src/i18n.js
 * (menu-model.test.js only scans server/i18n.js, so frontend keys need their own check).
 *
 * Unlike context-i18n.test.js's localeBlockOf, the slice is bounded at the entry's own
 * end-of-line: ui.im.* entries are SINGLE-LINE objects, so slicing to the next '\n  }' would span
 * dozens of subsequent keys and degrade the check to "key exists".
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const LOCALES = ['zh', 'en', 'zh-TW', 'ko', 'ja', 'de', 'es', 'fr', 'it', 'da', 'pl', 'ru', 'ar', 'no', 'pt-BR', 'th', 'tr', 'uk'];
const I18N_SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n.js'), 'utf-8');

function singleLineEntryOf(key) {
  const start = I18N_SRC.indexOf(`"${key}": {`);
  assert.ok(start >= 0, `key ${key} not found in src/i18n.js`);
  const end = I18N_SRC.indexOf('\n', start);
  assert.ok(end > start, `unterminated entry for ${key}`);
  return I18N_SRC.slice(start, end);
}

const KEYS = [
  'ui.im.statusReconnecting', // new: shown while the IM socket is down and the SDK auto-retries
];

describe('IM status i18n — all 18 locales', () => {
  for (const key of KEYS) {
    it(`${key} translated in every locale`, () => {
      const entry = singleLineEntryOf(key);
      for (const locale of LOCALES) {
        assert.ok(entry.includes(`"${locale}":`), `missing ${locale} translation for ${key}`);
      }
    });
  }
});
