/**
 * 偏好「专家设置 / 系统文本修改」i18n 覆盖测试。
 *
 * 通用 18-locale 完整性检查只扫 server/i18n.js，前端 src/i18n.js 的新增 key 不会自动覆盖；
 * 这里对专家设置用到的 key（新增 + 复用）逐一断言 18 个 locale 齐全，
 * 防止漏配语言时 t() 静默回落到 en / key 本身。范式同 test/quick-settings-i18n.test.js。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const LOCALES = ['zh', 'en', 'zh-TW', 'ko', 'ja', 'de', 'es', 'fr', 'it', 'da', 'pl', 'ru', 'ar', 'no', 'pt-BR', 'th', 'tr', 'uk'];
const I18N_SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n.js'), 'utf-8');

// 块尾用 '\n  }' 而非首个 '}'，避免翻译值含 '}'（如 dirHint 的 {dir} 参数）时提前截断漏检其后的 locale。
function localeBlockOf(key) {
  const start = I18N_SRC.indexOf(`"${key}": {`);
  assert.ok(start >= 0, `key ${key} not found in src/i18n.js`);
  const end = I18N_SRC.indexOf('\n  }', start);
  assert.ok(end > start, `unterminated block for ${key}`);
  return I18N_SRC.slice(start, end);
}

const KEYS = [
  'ui.expert.title',
  'ui.expert.help',
  'ui.expert.systemText',
  'ui.expert.systemText.btn',
  'ui.expert.systemText.append',
  'ui.expert.systemText.override',
  'ui.expert.systemText.overrideWarn',
  'ui.expert.systemText.preview',
  'ui.expert.systemText.placeholder',
  'ui.expert.systemText.dirHint',
  'ui.expert.systemText.note',
  'ui.expert.systemText.noWorkspace',
  'ui.expert.systemText.saved',
  'ui.expert.systemText.cleared',
  'ui.expert.systemText.saveError',
  'ui.expert.systemText.loadError',
  // 模型定制页签(Model-specific System Prompts)
  'ui.expert.systemText.tabDefault',
  'ui.expert.systemText.addModel',
  'ui.expert.systemText.addModelName',
  'ui.expert.systemText.addModelConfirm',
  'ui.expert.systemText.scopeGlobal',
  'ui.expert.systemText.scopeWorkspace',
  'ui.expert.systemText.modelHelp',
  'ui.expert.systemText.nameLabel',
  'ui.expert.systemText.scopeLabel',
  'ui.expert.systemText.scopeHelp',
  'ui.expert.systemText.presetHelp',
  'ui.expert.systemText.paramDocTitle',
  'ui.expert.systemText.presetLabel',
  'ui.expert.systemText.presetNone',
  'ui.expert.systemText.presetMatched',
  'ui.expert.systemText.invalidName',
  'ui.expert.systemText.reservedName',
  'ui.expert.systemText.duplicateName',
  'ui.expert.systemText.deleteTab',
  'ui.expert.systemText.deleted',
  'ui.expert.systemText.deleteError',
  'ui.expert.systemText.dirHintGlobal',
  'ui.expert.systemText.discardTitle',
  'ui.save',   // 复用：模态保存按钮
  'ui.cancel', // 复用：模态取消按钮
];

describe('expert settings i18n', () => {
  for (const key of KEYS) {
    it(`${key} 覆盖全部 18 个 locale`, () => {
      const block = localeBlockOf(key);
      for (const loc of LOCALES) {
        assert.ok(block.includes(`"${loc}":`), `${key} 缺少 locale ${loc}`);
      }
    });
  }
});
