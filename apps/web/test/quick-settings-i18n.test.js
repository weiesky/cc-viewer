/**
 * 终端工具栏 [+] 快捷设置菜单的 i18n 覆盖测试
 *
 * menu-model.test.js 的 18-locale 完整性检查只扫 server/i18n.js,前端 src/i18n.js
 * 的新增 key 没有自动覆盖;这里对快捷设置菜单用到的 key(新增 + 复用)逐一断言
 * 18 个 locale 齐全,防止漏配语言时 t() 静默回落 en/key 本身。
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
  'ui.terminal.quickSettings',          // 新增:按钮 tooltip
  'ui.permission.autoApprove.setting',  // 复用:权限自动审批行标签
  'ui.permission.autoApprove.off',      // 复用:关闭档位
  'ui.permission.autoApprove.instant',  // 复用:免审批历史值显示
  'ui.approval.settings.planAutoApprove', // 复用:Plan 自动审批行标签
  'ui.terminal.agentTeam',              // 复用:AgentTeam 行标签(终端菜单 + 聊天输入栏快捷菜单)
  'ui.terminal.customShortcuts',        // 复用:AgentTeam 子菜单「自定义快捷方式」入口
  'ui.terminal.upload',                 // 复用:聊天输入栏快捷菜单「上传文件」行
  'ui.chatInput.clearContext',          // 复用:聊天输入栏快捷菜单「清空上下文」行
  'ui.chatInput.clearContextConfirm',   // 复用:清空上下文 Popconfirm 文案
  'ui.chatInput.more',                  // 复用:聊天输入栏 [+] 按钮 tooltip
  'ui.common.confirmCancel',            // 复用:Popconfirm 取消按钮
  // 项目独立配置（偏好抽屉 + 移动端设置 + 本机管理弹窗）新增 key
  'ui.projectScopedPrefs.group',
  'ui.projectScopedPrefs',
  'ui.projectScopedPrefs.help',
  'ui.projectPrefsManage',
  'ui.projectPrefsManage.open',
  'ui.projectPrefsManage.title',
  'ui.projectPrefsManage.count',
  'ui.projectPrefsManage.delete',
  'ui.projectPrefsManage.deleteConfirm',
  'ui.projectPrefsManage.currentTag',
  'ui.projectPrefsManage.empty',
];

describe('quick settings menu i18n — all 18 locales', () => {
  for (const key of KEYS) {
    it(`${key} translated in every locale`, () => {
      const block = localeBlockOf(key);
      for (const locale of LOCALES) {
        assert.ok(block.includes(`"${locale}":`), `missing ${locale} translation for ${key}`);
      }
    });
  }
});
