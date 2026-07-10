/**
 * 新增 UI key 的 i18n 18-locale 覆盖测试（非「专家设置」部分）。
 *
 * expert-i18n.test.js 只守卫专家设置那批 key；本轮工作树里另有两个新增/复用 key
 * 已翻译全 18 语言但缺自动化守卫，漏配某语言时 t() 会静默回落到 en / key 本身。
 * 范式同 test/expert-i18n.test.js / test/quick-settings-i18n.test.js。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const LOCALES = ['zh', 'en', 'zh-TW', 'ko', 'ja', 'de', 'es', 'fr', 'it', 'da', 'pl', 'ru', 'ar', 'no', 'pt-BR', 'th', 'tr', 'uk'];
const I18N_SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n.js'), 'utf-8');

// 块尾用 '\n  }' 而非首个 '}'，避免翻译值含 '}' 时提前截断漏检其后的 locale（同 expert-i18n.test.js）。
function localeBlockOf(key) {
  const start = I18N_SRC.indexOf(`"${key}": {`);
  assert.ok(start >= 0, `key ${key} not found in src/i18n.js`);
  const end = I18N_SRC.indexOf('\n  }', start);
  assert.ok(end > start, `unterminated block for ${key}`);
  return I18N_SRC.slice(start, end);
}

const KEYS = [
  'ui.memoryOpenDir',   // 持久记忆「打开目录」按钮 (server/routes/files-fs.js openMemoryDir)
  'ui.proxy.editProxy', // 代理设置「编辑」独立 Modal 标题 (ProxyModal.jsx)
  'ui.proxy.effort',        // 代理热切换 effort 下拉标签 (ProxyModal.jsx)
  'ui.proxy.effortDefault', // 代理热切换 effort「默认不强制」选项 (ProxyModal.jsx)
  'ui.proxy.modelMapHint',  // 代理热切换 扩展模型字段说明 (ProxyModal.jsx)
  'ui.systemMessage',       // mid-conversation role:"system" meta row label (ChatMessage/ChatView role filter)
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
