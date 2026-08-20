/**
 * Context 标签页「原文」switch 的 i18n 覆盖测试
 *
 * menu-model.test.js 的 18-locale 完整性检查只扫 server/i18n.js，前端 src/i18n.js
 * 的新增 key 没有自动覆盖；这里对新增 key 逐一断言 18 个 locale 齐全，
 * 防止漏配语言时 t() 静默回落 en/key 本身。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const LOCALES = ['zh', 'en', 'zh-TW', 'ko', 'ja', 'de', 'es', 'fr', 'it', 'da', 'pl', 'ru', 'ar', 'no', 'pt-BR', 'th', 'tr', 'uk'];
const I18N_SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n.js'), 'utf-8');

// 与 menu-model.test.js 的 localeBlockOf 同款:块尾用 '\n  }' 而非首个 '}',
// 避免翻译值含 '}'(如 {count} 参数)时提前截断漏检其后的 locale。
function localeBlockOf(key) {
  const start = I18N_SRC.indexOf(`"${key}": {`);
  assert.ok(start >= 0, `key ${key} not found in src/i18n.js`);
  const end = I18N_SRC.indexOf('\n  }', start);
  assert.ok(end > start, `unterminated block for ${key}`);
  return I18N_SRC.slice(start, end);
}

const KEYS = [
  'ui.context.viewRaw', // 新增:右侧面板「原文」switch 标签
];

describe('context tab i18n — all 18 locales', () => {
  for (const key of KEYS) {
    it(`${key} translated in every locale`, () => {
      const block = localeBlockOf(key);
      for (const locale of LOCALES) {
        assert.ok(block.includes(`"${locale}":`), `missing ${locale} translation for ${key}`);
      }
    });
  }
});
