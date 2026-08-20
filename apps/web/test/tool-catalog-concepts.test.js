import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { TOOL_CATALOG, ALL_TOOL_NAMES } from '../src/utils/toolCatalog.js';

// 守卫:工具目录 TOOL_CATALOG(ToolsHelp「所有工具」弹层 + ConceptHelp 白名单的单一来源)
// 必须与已发布的 concepts/<lang>/Tool-<name>.md 文档一一对应,且新增 i18n key 18 语言齐全。
// 防止:新增工具漏建某语言文档(运行时 404)、目录出现重复、漏配语言导致 t() 静默回落。

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CONCEPTS_DIR = join(ROOT, 'packages', 'content', 'concepts');
const I18N_SRC = readFileSync(join(ROOT, 'apps', 'web', 'src', 'i18n.js'), 'utf-8');

// 与 server/routes/team.js concept() 同款 doc 名校验。
const DOC_NAME_RE = /^[a-zA-Z0-9-]+$/;

const LOCALES = ['zh', 'en', 'zh-TW', 'ko', 'ja', 'de', 'es', 'fr', 'it', 'da', 'pl', 'ru', 'ar', 'no', 'pt-BR', 'th', 'tr', 'uk'];

// 与 context-i18n.test.js / menu-model.test.js 的 localeBlockOf 同款:块尾用 '\n  }'
// 而非首个 '}',避免值含 '}' 时提前截断漏检其后 locale。
function localeBlockOf(key) {
  const start = I18N_SRC.indexOf(`"${key}": {`);
  assert.ok(start >= 0, `key ${key} not found in src/i18n.js`);
  const end = I18N_SRC.indexOf('\n  }', start);
  assert.ok(end > start, `unterminated block for ${key}`);
  return I18N_SRC.slice(start, end);
}

function langDirs() {
  return readdirSync(CONCEPTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

describe('tool catalog ↔ concept docs', () => {
  it('ALL_TOOL_NAMES has no duplicates', () => {
    const seen = new Set();
    const dups = [];
    for (const n of ALL_TOOL_NAMES) {
      if (seen.has(n)) dups.push(n);
      seen.add(n);
    }
    assert.equal(dups.length, 0, `duplicate tool names: ${dups.join(', ')}`);
  });

  it('every Tool-<name> doc name passes the server doc-name regex', () => {
    for (const name of ALL_TOOL_NAMES) {
      assert.ok(DOC_NAME_RE.test(`Tool-${name}`), `Tool-${name} fails ${DOC_NAME_RE}`);
    }
  });

  // 双向一致:目录与已发布的 Tool-*.md 必须一一对应。
  // 上面只保证「目录工具都有文档」;这里再保证「文档都在目录里」——
  // 否则新增 concepts/<lang>/Tool-Foo.md 而漏加目录项时,该工具静默不出现在「所有工具」弹层。
  it('catalog exactly matches the shipped Tool-*.md set (no orphan docs / no missing entries)', () => {
    const docNames = readdirSync(join(CONCEPTS_DIR, 'en'))
      .filter((f) => /^Tool-.+\.md$/.test(f))
      .map((f) => f.slice('Tool-'.length, -'.md'.length));
    const catalog = new Set(ALL_TOOL_NAMES);
    const docs = new Set(docNames);
    const docsNotInCatalog = docNames.filter((n) => !catalog.has(n));
    const catalogNotInDocs = ALL_TOOL_NAMES.filter((n) => !docs.has(n));
    assert.equal(docsNotInCatalog.length, 0, `concepts/en Tool-*.md missing from TOOL_CATALOG: ${docsNotInCatalog.join(', ')}`);
    assert.equal(catalogNotInDocs.length, 0, `TOOL_CATALOG tools missing a concepts/en doc: ${catalogNotInDocs.join(', ')}`);
  });

  it('covers >=18 language directories', () => {
    const dirs = langDirs();
    assert.ok(dirs.length >= 18, `expected >=18 concept lang dirs, found ${dirs.length}: ${dirs.join(',')}`);
  });

  for (const lang of langDirs()) {
    it(`${lang}: every catalog tool has Tool-<name>.md`, () => {
      const missing = ALL_TOOL_NAMES.filter((name) => !existsSync(join(CONCEPTS_DIR, lang, `Tool-${name}.md`)));
      assert.equal(missing.length, 0, `${lang} missing: ${missing.map((n) => `Tool-${n}.md`).join(', ')}`);
    });
  }
});

describe('tool catalog i18n — all 18 locales', () => {
  const KEYS = [
    'ui.toolCatalog.title',
    'ui.toolCatalog.help',
    ...TOOL_CATALOG.map((c) => `ui.toolCatalog.cat.${c.key}`),
  ];

  for (const key of KEYS) {
    it(`${key} translated in every locale`, () => {
      const block = localeBlockOf(key);
      for (const locale of LOCALES) {
        assert.ok(block.includes(`"${locale}":`), `missing ${locale} translation for ${key}`);
      }
    });
  }
});
