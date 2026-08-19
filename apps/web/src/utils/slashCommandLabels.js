import { t } from '../i18n.js';

// 命令清单与 Claude Code CLI upstream 公开 slash 命令对齐;upstream 增删命令时
// 需手动同步本表 + src/i18n.js 的 "ui.slashCommand.*" 翻译块。未在表中的命令
// (含用户自定义 ~/.claude/commands/*.md)→ 返回 null → 调用方回落到原文渲染。
// 命令大小写敏感(与 CLI 保持一致),exact-match 不做大小写规约。
// 翻译歧义点见 src/i18n.js "ui.slashCommand.*" 块顶部注释(单一信息源)。
const COMMAND_KEYS = Object.freeze({
  '/clear': 'ui.slashCommand.clear',
  '/compact': 'ui.slashCommand.compact',
  '/theme': 'ui.slashCommand.theme',
  '/cost': 'ui.slashCommand.cost',
  '/usage': 'ui.slashCommand.usage',
  '/context': 'ui.slashCommand.context',
  '/model': 'ui.slashCommand.model',
  '/effort': 'ui.slashCommand.effort',
  '/login': 'ui.slashCommand.login',
  '/logout': 'ui.slashCommand.logout',
  '/status': 'ui.slashCommand.status',
  '/help': 'ui.slashCommand.help',
  '/init': 'ui.slashCommand.init',
  '/agents': 'ui.slashCommand.agents',
  '/config': 'ui.slashCommand.config',
  '/memory': 'ui.slashCommand.memory',
  '/permissions': 'ui.slashCommand.permissions',
  '/hooks': 'ui.slashCommand.hooks',
  '/plugins': 'ui.slashCommand.plugins',
  '/release-notes': 'ui.slashCommand.releaseNotes',
  '/upgrade': 'ui.slashCommand.upgrade',
  '/bug': 'ui.slashCommand.bug',
  '/doctor': 'ui.slashCommand.doctor',
  '/mcp': 'ui.slashCommand.mcp',
  '/vim': 'ui.slashCommand.vim',
  '/export': 'ui.slashCommand.export',
  '/pr-comments': 'ui.slashCommand.prComments',
  '/review': 'ui.slashCommand.review',
  '/security-review': 'ui.slashCommand.securityReview',
  '/ide': 'ui.slashCommand.ide',
  '/resume': 'ui.slashCommand.resume',
  '/terminal-setup': 'ui.slashCommand.terminalSetup',
  '/migrate-installer': 'ui.slashCommand.migrateInstaller',
});

// 裸命令名(如 "/model")+ 可选参数(如 "/model opus")。
// 参数前只允许 ASCII 空格/制表符 — 避免 U+2028/U+2029 等异常空白被
// 当成参数分隔符绕过多行守卫。
const COMMAND_PATTERN = /^(\/[a-z][a-z0-9-]*)([ \t]+.*)?$/;
// 拒任意 Unicode 换行(LF / CR / U+2028 LINE SEP / U+2029 PARAGRAPH SEP)。
const ANY_LINEBREAK = new RegExp('[\\n\\r\\u2028\\u2029]');
// bidi-control(U+202A LRE / U+202B RLE / U+202C PDF / U+202D LRO / U+202E RLO /
// U+2066 LRI / U+2067 RLI / U+2068 FSI / U+2069 PDI):进入气泡文本会翻转剩余
// 字符视觉方向,撕裂气泡/相邻消息布局。在拼接 rest 前 strip 掉。
const BIDI_CONTROL = new RegExp('[\\u202A-\\u202E\\u2066-\\u2069]', 'g');

// 内部 matcher:返回 { cmd, rest } 或 null。两个 export 共享同一套校验逻辑,
// 不引入第二份 regex 路径。
function matchCommand(text) {
  if (typeof text !== 'string') return null;
  if (ANY_LINEBREAK.test(text)) return null;
  const trimmed = text.trim();
  const match = COMMAND_PATTERN.exec(trimmed);
  if (!match) return null;
  const cmd = match[1];
  if (!COMMAND_KEYS[cmd]) return null;
  return { cmd, rest: (match[2] || '').replace(BIDI_CONTROL, '') };
}

export function getSlashCommandLabel(text) {
  const m = matchCommand(text);
  if (!m) return null;
  const label = t(COMMAND_KEYS[m.cmd]);
  return m.rest ? `${label}${m.rest}` : label;
}

// 返回裸命令(如 "/model"),用于 Tooltip 等次要展示位,避免参数(可能含
// /login <token> 等敏感数据)在 hover/title 处被泄漏。
export function getSlashCommandTooltip(text) {
  const m = matchCommand(text);
  return m ? m.cmd : null;
}
