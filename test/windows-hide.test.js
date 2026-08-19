import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Windows 弹窗回归静态守卫：
// node.exe / cmd.exe / npm.cmd / git.exe 等 console-subsystem 子进程，从无控制台的
// GUI/worker 进程创建且未传 windowsHide 时，Windows 会分配可见控制台窗口（启动时
// "多出来的 Node.js 窗口"）。windowsHide 在 macOS CI 上是 no-op，行为测试测不出来，
// 只能静态扫描守住：以下文件中每个裸 child_process 调用点（spawn/fork/exec*）的
// 实参范围内必须出现 windowsHide。
//
// 不在扫描范围（各有豁免理由）：
//   - pty.spawn(...)        —— node-pty，Windows 走 ConPTY，无可见窗口（点前缀已被正则排除）
//   - cli.js                —— CLI 模式运行在用户终端内，子进程继承现有控制台，不新开窗口
//   - server/routes/files-fs.js —— win32 分支均已带 windowsHide，POSIX-only 分支（open/xdg-open
//                              /gnome-terminal 等）平台门控不可达 Windows，无需逐一加注
const SCANNED_FILES = [
  'apps/electron/electron/main.js',
  'packages/app/server/pty-manager.js',
  'packages/app/server/lib/im/im-process-manager.js',
  'packages/app/server/lib/updater.js',
  'packages/app/server/lib/git-diff.js',
  'packages/app/server/lib/plugin-manager.js',
  'packages/app/server/server.js',
  'packages/app/findcc.js',
];

const ROOT = join(import.meta.dirname, '..');

// 匹配裸调用：spawn( / fork( / execSync( / execFileSync( / execFile(
// 负向断言排除 `pty.spawn(`、`spawnImpl(`、`_execFileAsyncRaw(` 等带前缀/后缀的标识符。
const CALL_RE = /(?<![.\w])(execFileSync|execSync|execFile|spawn|fork)\s*\(/g;

// 剥离注释（行注释 + 块注释），注释内容替换为空格、保留换行，行号不漂移；
// 字符串/模板字面量内的 `//`（如 URL）不会被误判。
function stripComments(src) {
  let out = '';
  let quote = null;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      out += ch;
      if (ch === '\\') { out += src[i + 1] ?? ''; i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; out += ch; continue; }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
      out += src[i] === '\n' ? '\n' : '';
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i++; // 消耗 */
      continue;
    }
    out += ch;
  }
  return out;
}

// 从 openParenIdx（指向 '('）起做括号配平，跳过字符串/模板字面量内容，返回实参文本。
function callSpan(src, openParenIdx) {
  let depth = 0;
  let quote = null;
  for (let i = openParenIdx; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return src.slice(openParenIdx, i + 1);
    }
  }
  return src.slice(openParenIdx); // 不配平就整段返回，宁可误报
}

describe('windowsHide static guard (Windows console-window regression)', () => {
  for (const rel of SCANNED_FILES) {
    it(`every bare child_process call in ${rel} passes windowsHide`, () => {
      const src = stripComments(readFileSync(join(ROOT, rel), 'utf-8'));
      const missing = [];
      let m;
      while ((m = CALL_RE.exec(src)) !== null) {
        const openParen = m.index + m[0].length - 1;
        const span = callSpan(src, openParen);
        if (!span.includes('windowsHide')) {
          const line = src.slice(0, m.index).split('\n').length;
          missing.push(`${rel}:${line} ${m[1]}(...)`);
        }
      }
      assert.deepEqual(missing, [], `child_process call sites missing windowsHide:\n${missing.join('\n')}`);
    });
  }
});
