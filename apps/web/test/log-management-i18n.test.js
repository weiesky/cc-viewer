/**
 * 日志管理新增控件的 i18n 覆盖测试
 *
 * menu-model.test.js 的 18-locale 完整性检查只扫 server/i18n.js，前端 src/i18n.js
 * 的新增 key 没有自动覆盖；这里对「显示全部实例」开关与「实例」列头两个 key
 * 逐一断言 18 个 locale 齐全，防止漏配语言时 t() 静默回落 en/key 本身。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const LOCALES = ['zh', 'en', 'zh-TW', 'ko', 'ja', 'de', 'es', 'fr', 'it', 'da', 'pl', 'ru', 'ar', 'no', 'pt-BR', 'th', 'tr', 'uk'];
const I18N_SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n.js'), 'utf-8');

// 与 context-i18n.test.js 的 localeBlockOf 同款:块尾用 '\n  }' 而非首个 '}'。
function localeBlockOf(key) {
  const start = I18N_SRC.indexOf(`"${key}": {`);
  assert.ok(start >= 0, `key ${key} not found in src/i18n.js`);
  const end = I18N_SRC.indexOf('\n  }', start);
  assert.ok(end > start, `unterminated block for ${key}`);
  return I18N_SRC.slice(start, end);
}

const KEYS = [
  'ui.unmigratedV1Hint', // v1 视图未迁移提示行
  'ui.viewV1Logs',       // v2 视图顶部的 v1 入口链接
  'ui.backToV2Logs',     // v1 视图顶部的返回链接
];

describe('log management i18n — all 18 locales', () => {
  for (const key of KEYS) {
    it(`${key} translated in every locale`, () => {
      const block = localeBlockOf(key);
      for (const locale of LOCALES) {
        assert.ok(block.includes(`"${locale}":`), `missing ${locale} translation for ${key}`);
      }
    });
  }
});
