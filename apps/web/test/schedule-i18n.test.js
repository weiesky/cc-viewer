/**
 * i18n coverage for the scheduled-task feature (ui.schedule.*) in apps/web/src/i18n.js.
 * Asserts every ui.schedule.* key has all 18 locales, so t() never falls back to the
 * raw key. Mirrors quick-settings-i18n.test.js's localeBlockOf pattern.
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

// Every ui.schedule.* key present in the source (multi-line block form).
const KEYS = [...I18N_SRC.matchAll(/"(ui\.schedule\.[a-zA-Z0-9_.]+)": \{/g)].map(m => m[1]);

describe('ui.schedule i18n coverage', () => {
  it('found the expected schedule keys', () => {
    assert.ok(KEYS.length >= 90, `expected ≥90 ui.schedule.* keys, found ${KEYS.length}`);
    for (const required of ['ui.schedule.menuItem', 'ui.schedule.title', 'ui.schedule.kind.daily', 'ui.schedule.reason.noLiveSession', 'ui.schedule.error.task_limit', 'ui.schedule.toast.completed']) {
      assert.ok(KEYS.includes(required), `missing ${required}`);
    }
  });

  it('every ui.schedule.* key has all 18 locales', () => {
    for (const key of KEYS) {
      const block = localeBlockOf(key);
      for (const locale of LOCALES) {
        assert.ok(block.includes(`"${locale}":`), `${key} missing locale ${locale}`);
      }
    }
  });

  it('reason/error suffix keys exist for every server code', () => {
    // Server reason codes (snake/kebab) map to camelCase keys via REASON_KEY in
    // scheduleDescription.js — each target key must exist with all locales.
    for (const suffix of ['noLiveSession', 'sdkUnavailable', 'spawnUnavailable', 'notInitialized', 'busy', 'paused', 'stale', 'interrupted', 'timeout', 'aborted', 'queueRejected', 'turnError', 'noResult', 'internal']) {
      const block = localeBlockOf(`ui.schedule.reason.${suffix}`);
      assert.ok(block.includes('"zh":'), `reason.${suffix} missing zh`);
    }
    for (const code of ['invalid_json', 'invalid_prompt', 'invalid_mode', 'invalid_schedule', 'once_in_past', 'spawn_unavailable', 'project_unresolved', 'project_ambiguous', 'task_not_found', 'task_running', 'task_limit', 'store_corrupt', 'scheduler_unavailable', 'forbidden']) {
      const block = localeBlockOf(`ui.schedule.error.${code}`);
      assert.ok(block.includes('"en":'), `error.${code} missing en`);
    }
  });
});
