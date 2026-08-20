/**
 * 1.7.0 P2 迁移引导的 i18n 覆盖测试
 *
 * menu-model.test.js 的 18-locale 完整性检查只扫 server/i18n.js，前端 src/i18n.js
 * 的新增 key 没有自动覆盖；这里对迁移弹窗与未迁移提示行的全部 key 逐一断言
 * 18 个 locale 齐全（沿 log-management-i18n.test.js 模式），server 侧 CLI 提示
 * key 同样钉死。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const LOCALES = ['zh', 'en', 'zh-TW', 'ko', 'ja', 'de', 'es', 'fr', 'it', 'da', 'pl', 'ru', 'ar', 'no', 'pt-BR', 'th', 'tr', 'uk'];
const __dirname = dirname(fileURLToPath(import.meta.url));
const I18N_SRC = readFileSync(join(__dirname, '..', 'src', 'i18n.js'), 'utf-8');
const I18N_SRV = readFileSync(join(__dirname, '..', '..', '..', 'packages', 'app', 'server', 'i18n.js'), 'utf-8');

function localeBlockOf(src, key) {
  const start = src.indexOf(`"${key}": {`);
  assert.ok(start >= 0, `key ${key} not found`);
  const end = src.indexOf('\n  }', start);
  assert.ok(end > start, `unterminated block for ${key}`);
  return src.slice(start, end);
}

const UI_KEYS = [
  'ui.migratePrompt.title',
  'ui.migratePrompt.body',
  'ui.migratePrompt.bodyContinued',
  'ui.migratePrompt.now',
  'ui.migratePrompt.later',
  'ui.migratePrompt.dontRemind',
  'ui.migratePrompt.otherProjects',
  'ui.unmigratedV1Hint',
];

describe('migrate prompt i18n — all 18 locales', () => {
  for (const key of UI_KEYS) {
    it(`${key} translated in every locale`, () => {
      const block = localeBlockOf(I18N_SRC, key);
      for (const locale of LOCALES) {
        assert.ok(block.includes(`"${locale}":`), `missing ${locale} translation for ${key}`);
      }
    });
  }

  it('cli.v1LogsFound translated in every locale (server/i18n.js)', () => {
    const block = localeBlockOf(I18N_SRV, 'cli.v1LogsFound');
    for (const locale of LOCALES) {
      assert.ok(block.includes(`"${locale}":`), `missing ${locale} translation for cli.v1LogsFound`);
    }
  });
});
