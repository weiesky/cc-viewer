/**
 * Unit tests for src/i18n/mdxTranslations.js
 *
 * 验证多语言派生、fallback 链路、占位符替换、17 语言 toolbar key 完整覆盖。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// 注入 mock 的 getLang 给 mdxTranslations.js 用——src/i18n.js 里的 getLang 读全局
// currentLang 变量。测试时直接 import setLang/getLang 真实接口，setLang 切完再调 mdxTranslation。
import { setLang } from '../src/i18n.js';
import { mdxTranslation, TRANSLATIONS, getByPath, interpolate } from '../src/i18n/mdxTranslations.js';

describe('mdxTranslation', () => {
  it('zh: 命中 toolbar.image 返回中文「插入图片」', () => {
    setLang('zh');
    assert.equal(mdxTranslation('toolbar.image', 'Insert image'), '插入图片');
  });

  it('en: 无表，走 defaultValue 英文 fallback', () => {
    setLang('en');
    assert.equal(mdxTranslation('toolbar.image', 'Insert image'), 'Insert image');
    assert.equal(mdxTranslation('toolbar.bold', 'Bold'), 'Bold');
  });

  it('ja: 命中 toolbar.bold 返回日文「太字」', () => {
    setLang('ja');
    assert.equal(mdxTranslation('toolbar.bold', 'Bold'), '太字');
    assert.equal(mdxTranslation('toolbar.image', 'Insert image'), '画像を挿入');
  });

  it('pt-BR: 全码命中', () => {
    setLang('pt-BR');
    assert.equal(mdxTranslation('toolbar.bold', 'Bold'), 'Negrito');
  });

  it('zh-TW: 全码命中（独立繁体翻译，不与 zh 共用）', () => {
    setLang('zh-TW');
    assert.equal(mdxTranslation('toolbar.bold', 'Bold'), '粗體');
    assert.equal(mdxTranslation('createLink.text', 'Text'), '連結文字');
  });

  it('未知 lang: fallback 到 defaultValue', () => {
    setLang('xx-YY');
    assert.equal(mdxTranslation('toolbar.bold', 'Bold'), 'Bold');
    setLang('en');  // restore
  });

  it('interpolations: toolbar.blockTypes.heading + {level: 2} → 「标题 2」', () => {
    setLang('zh');
    assert.equal(
      mdxTranslation('toolbar.blockTypes.heading', 'Heading {{level}}', { level: 2 }),
      '标题 2',
    );
    assert.equal(
      mdxTranslation('toolbar.undo', 'Undo {{shortcut}}', { shortcut: '⌘Z' }),
      '撤销 ⌘Z',
    );
  });

  it('未知 key: 返回 defaultValue', () => {
    setLang('zh');
    assert.equal(mdxTranslation('toolbar.unknownKey', 'Default'), 'Default');
    assert.equal(mdxTranslation('completely.fake.path', 'Fallback'), 'Fallback');
  });

  it('既有 zh dialog key 保留（createLink.text 等）', () => {
    setLang('zh');
    assert.equal(mdxTranslation('createLink.text', 'Text'), '链接文字');
    assert.equal(mdxTranslation('uploadImage.dialogTitle', 'Insert image'), '插入图片');
    assert.equal(mdxTranslation('table.deleteTable', 'Delete table'), '删除表格');
  });

  // ─── 17 语言覆盖 sanity check（review 补） ─────────────────────────────────
  // 防 typo / 漏粘贴：每种 non-en 语言必须有这些核心 toolbar key
  const REQUIRED_TOOLBAR_KEYS = [
    'toolbar.bold', 'toolbar.italic', 'toolbar.underline',
    'toolbar.image', 'toolbar.link', 'toolbar.table',
    'toolbar.codeBlock', 'toolbar.thematicBreak',
    'toolbar.bulletedList', 'toolbar.numberedList',
    'toolbar.undo', 'toolbar.redo',
    'toolbar.richText', 'toolbar.source', 'toolbar.diffMode',
    'toolbar.blockTypeSelect.placeholder',
    'toolbar.blockTypes.paragraph',
    'toolbar.blockTypes.heading',
    'toolbar.blockTypes.quote',
  ];

  it('17 语言全部覆盖核心 toolbar key', () => {
    const expectedLangs = ['zh', 'zh-TW', 'ja', 'ko', 'de', 'es', 'fr', 'it', 'da', 'pl', 'ru', 'ar', 'no', 'pt-BR', 'th', 'tr', 'uk'];
    for (const lang of expectedLangs) {
      const table = TRANSLATIONS[lang];
      assert.ok(table, `lang "${lang}" 缺失整个表`);
      for (const key of REQUIRED_TOOLBAR_KEYS) {
        const value = getByPath(table, key);
        assert.ok(typeof value === 'string' && value.length > 0,
          `lang "${lang}" 缺 key "${key}" 或不是非空字符串（实际：${JSON.stringify(value)}）`);
      }
    }
  });

  it('占位符 {{shortcut}} / {{level}} 在 17 语言里都正确保留', () => {
    const expectedLangs = ['zh', 'zh-TW', 'ja', 'ko', 'de', 'es', 'fr', 'it', 'da', 'pl', 'ru', 'ar', 'no', 'pt-BR', 'th', 'tr', 'uk'];
    for (const lang of expectedLangs) {
      const undo = getByPath(TRANSLATIONS[lang], 'toolbar.undo');
      assert.ok(undo.includes('{{shortcut}}'), `lang "${lang}" toolbar.undo 缺 {{shortcut}} 占位符`);
      const heading = getByPath(TRANSLATIONS[lang], 'toolbar.blockTypes.heading');
      assert.ok(heading.includes('{{level}}'), `lang "${lang}" toolbar.blockTypes.heading 缺 {{level}} 占位符`);
    }
    setLang('en');  // restore
  });

  it('interpolate: double-curly 优先，single-curly 兜底', () => {
    assert.equal(interpolate('Hello {{name}}', { name: 'World' }), 'Hello World');
    assert.equal(interpolate('Hello {name}', { name: 'World' }), 'Hello World');
    assert.equal(interpolate('Mix {{a}} and {b}', { a: 'X', b: 'Y' }), 'Mix X and Y');
    assert.equal(interpolate('No {{missing}} key', {}), 'No {{missing}} key');
    assert.equal(interpolate('Static', undefined), 'Static');
  });
});
