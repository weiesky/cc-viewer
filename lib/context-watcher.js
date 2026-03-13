import { readFileSync, writeFileSync, existsSync, watchFile, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const CONTEXT_WINDOW_FILE = join(homedir(), '.claude', 'context-window.json');
export const CLAUDE_SETTINGS_FILE = join(homedir(), '.claude', 'settings.json');
const CCV_STATUSLINE_SCRIPT = join(homedir(), '.claude', 'ccv-statusline.sh');

let _lastContextPct = -1;
let _originalStatusLine = undefined; // undefined = not yet installed

/**
 * Watch context-window.json and push context usage to SSE clients.
 * @param {Array} clients - SSE client array (shared reference with server.js)
 */
export function watchContextWindow(clients) {
  if (!existsSync(CONTEXT_WINDOW_FILE)) {
    setTimeout(() => watchContextWindow(clients), 5000);
    return;
  }
  watchFile(CONTEXT_WINDOW_FILE, { interval: 2000 }, () => {
    try {
      const raw = readFileSync(CONTEXT_WINDOW_FILE, 'utf-8');
      const data = JSON.parse(raw);
      const pct = data?.context_window?.used_percentage ?? -1;
      if (pct !== _lastContextPct) {
        _lastContextPct = pct;
        clients.forEach(client => {
          try {
            client.write(`event: context_window\ndata: ${JSON.stringify(data.context_window)}\n\n`);
          } catch { }
        });
      }
    } catch { }
  });
}

// 安装 statusLine wrapper：兼容用户已有配置
export function installStatusLine() {
  try {
    let settings = {};
    if (existsSync(CLAUDE_SETTINGS_FILE)) {
      settings = JSON.parse(readFileSync(CLAUDE_SETTINGS_FILE, 'utf-8'));
    }

    // 如果已经是我们的脚本（上次未正常清理），视为无原始配置
    if (settings.statusLine?.command?.includes('ccv-statusline')) {
      _originalStatusLine = null; // 标记为"无原始配置"
    } else {
      _originalStatusLine = settings.statusLine || null;
    }

    // 生成 wrapper 脚本：保存 context-window.json + 链式调用原有命令
    const originalCmd = _originalStatusLine?.type === 'command' && _originalStatusLine?.command
      ? _originalStatusLine.command : '';
    const scriptLines = [
      '#!/usr/bin/env bash',
      `input=$(cat)`,
      `echo "$input" > ${CONTEXT_WINDOW_FILE}`,
    ];
    if (originalCmd) {
      scriptLines.push(`echo "$input" | ${originalCmd}`);
    } else {
      scriptLines.push(`pct=$(echo "$input" | jq -r '.context_window.used_percentage // 0' 2>/dev/null || echo 0)`);
      scriptLines.push(`echo "ctx \${pct}%"`);
    }
    // 先创建脚本文件，再写入 settings（确保脚本存在后才引用）
    writeFileSync(CCV_STATUSLINE_SCRIPT, scriptLines.join('\n') + '\n', { mode: 0o755 });
    settings.statusLine = { type: 'command', command: CCV_STATUSLINE_SCRIPT };
    writeFileSync(CLAUDE_SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n');
  } catch (err) {
    console.error('[CC Viewer] Failed to install statusLine:', err.message);
  }
}

// 卸载 statusLine wrapper：先还原 settings，再删脚本
export function uninstallStatusLine() {
  if (_originalStatusLine === undefined) return; // 未安装过
  try {
    // 先还原 settings.json
    if (existsSync(CLAUDE_SETTINGS_FILE)) {
      const settings = JSON.parse(readFileSync(CLAUDE_SETTINGS_FILE, 'utf-8'));
      if (settings.statusLine?.command?.includes('ccv-statusline')) {
        if (_originalStatusLine) {
          settings.statusLine = _originalStatusLine;
        } else {
          delete settings.statusLine;
        }
        writeFileSync(CLAUDE_SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n');
      }
    }
    // 再清理脚本文件
    if (existsSync(CCV_STATUSLINE_SCRIPT)) unlinkSync(CCV_STATUSLINE_SCRIPT);
  } catch { }
  _originalStatusLine = undefined;
}
