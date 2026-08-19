// Claude 配置目录感知的 i18n 包装。由 AppBase 在 /api/preferences 响应里调
// setClaudeConfigDir() 注入；tc(key) 在调用时把 {configDir} 占位符替换成
// home-friendly 展示路径（默认 "~/.claude"，设了 CLAUDE_CONFIG_DIR 时为绝对路径）。

import { t } from '../i18n';

let _configDir = '~/.claude';

export function setClaudeConfigDir(path) {
  if (typeof path === 'string' && path.length > 0) _configDir = path;
}

export function getClaudeConfigDir() {
  return _configDir;
}

// 注入的 configDir 不可被 params 覆盖——UI 必须反映真实的配置目录。
export function tc(key, params) {
  return t(key, { ...params, configDir: _configDir });
}
