/**
 * Unit tests for electron/menu-model.js
 *
 * 覆盖:模型形状(4 个顶级菜单/条目字段约定)、ALL_COMMAND_IDS 与模型一致、
 * serializeMenuModel 的翻译与 accelerator 平台展示、所有 labelKey 在全部 18 个 locale
 * 均有翻译(防止新增菜单条目漏配语言,t() 缺 key 时会回落 key 本身)。
 * 纯数据模块,不依赖 Electron 进程。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { buildMenuModel, serializeMenuModel, ALL_COMMAND_IDS } from '../electron/menu-model.js';
import { tFor } from '../../../packages/app/server/i18n.js';

const LOCALES = ['zh', 'en', 'zh-TW', 'ko', 'ja', 'de', 'es', 'fr', 'it', 'da', 'pl', 'ru', 'ar', 'no', 'pt-BR', 'th', 'tr', 'uk'];
const I18N_SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'app', 'server', 'i18n.js'), 'utf-8');

// tFor() 缺 locale 时静默回落 en,无法据此发现漏配语言;改为直接在 i18n.js 源码里
// 取出 key 的定义块,断言 18 个 locale 字段逐一齐全。
// 块尾用 '\n  }'(两空格缩进的闭合行)而非首个 '}':翻译值若含 '}'(如 {count} 参数)
// 用 indexOf('}') 会提前截断,漏检其后的 locale。
function localeBlockOf(key) {
  const start = I18N_SRC.indexOf(`"${key}": {`);
  assert.ok(start >= 0, `key ${key} not found in server/i18n.js`);
  const end = I18N_SRC.indexOf('\n  }', start);
  assert.ok(end > start, `unterminated block for ${key}`);
  return I18N_SRC.slice(start, end);
}

describe('buildMenuModel — shape', () => {
  it('has the four top-level menus in order', () => {
    assert.deepEqual(buildMenuModel().map((m) => m.id), ['file', 'edit', 'view', 'window']);
  });

  it('every item is a separator or has id + labelKey', () => {
    for (const menu of buildMenuModel()) {
      assert.ok(menu.labelKey, `menu ${menu.id} missing labelKey`);
      for (const it of menu.items) {
        if (it.type === 'separator') continue;
        assert.ok(it.id, `item in ${menu.id} missing id`);
        assert.ok(it.labelKey, `item ${it.id} missing labelKey`);
      }
    }
  });

  it('ALL_COMMAND_IDS matches the model (no separator, no dup)', () => {
    const ids = buildMenuModel().flatMap((m) => m.items).filter((i) => i.id).map((i) => i.id);
    assert.deepEqual(ALL_COMMAND_IDS, ids);
    assert.equal(new Set(ids).size, ids.length, 'duplicate command id');
  });

  it('edit items carry webContents-method roles (id === method name)', () => {
    const edit = buildMenuModel().find((m) => m.id === 'edit');
    for (const it of edit.items) {
      if (it.type === 'separator') continue;
      assert.equal(it.role, it.id, 'edit item id must equal its role/webContents method');
    }
  });
});

describe('i18n coverage — all 18 locales', () => {
  const keys = new Set();
  for (const menu of buildMenuModel()) {
    keys.add(menu.labelKey);
    for (const it of menu.items) if (it.labelKey) keys.add(it.labelKey);
  }
  // 右键菜单 / tab bar tooltip 文案同样由主进程 t() 出,纳入覆盖断言
  for (const k of ['electron.menu.copyLink', 'electron.tabbar.newTab', 'electron.tabbar.toIpad', 'electron.tabbar.toPc', 'electron.tabbar.menu']) keys.add(k);

  for (const key of keys) {
    it(`${key} translated in every locale`, () => {
      const block = localeBlockOf(key);
      for (const locale of LOCALES) {
        assert.ok(block.includes(`"${locale}":`), `missing ${locale} translation for ${key}`);
      }
      // t() 路径 sanity:en 不回落 key 本身
      const v = tFor(key, 'en');
      assert.ok(v && v !== key, `tFor(en) fell back to key for ${key}`);
    });
  }
});

describe('serializeMenuModel', () => {
  const t = (k) => `[${k}]`; // 注入假 t,断言走翻译而非原样输出

  it('resolves labels via t() and strips labelKey/role', () => {
    const out = serializeMenuModel(t, 'win32');
    assert.equal(out[0].label, '[electron.menu.file]');
    const newTab = out[0].items[0];
    assert.equal(newTab.id, 'new-tab');
    assert.equal(newTab.label, '[electron.menu.newTab]');
    assert.ok(!('labelKey' in newTab));
    assert.ok(!('role' in (out[1].items[0])));
  });

  it('keeps separators', () => {
    const edit = serializeMenuModel(t, 'win32').find((m) => m.id === 'edit');
    assert.ok(edit.items.some((i) => i.type === 'separator'));
  });

  it('win32 shows Ctrl+, darwin shows ⌘ symbols', () => {
    const win = serializeMenuModel(t, 'win32');
    assert.equal(win[0].items[0].accel, 'Ctrl+T');
    const mac = serializeMenuModel(t, 'darwin');
    assert.equal(mac[0].items[0].accel, '⌘T');
    const macEdit = mac.find((m) => m.id === 'edit');
    assert.equal(macEdit.items[1].accel, '⇧⌘Z'); // redo: Shift+CmdOrCtrl+Z
  });
});
