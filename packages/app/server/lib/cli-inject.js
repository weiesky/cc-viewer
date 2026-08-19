// claude-code cli.js 注入/卸载逻辑 — 抽自 cc-viewer 根 cli.js 以便单元测试。
//
// 注入语义：在 @anthropic-ai/claude-code/cli.js 顶部插一段
//   // >>> Start CC Viewer Web Service >>>
//   <INJECT_IMPORT>
//   // <<< Start CC Viewer Web Service <<<
// 让 claude 启动时先 evaluate cc-viewer 的 interceptor。
//
// 升级路径：INJECT_IMPORT 形态本身允许演进（如 relative path → bare specifier）。
// `LEGACY_INJECT_IMPORTS` 记录历史值；任何旧 marker block 在下次 `ccv -logger`
// 时会被重写为当前 INJECT_BLOCK。
//
// EOL 策略（务必保持，否则 Windows cli.js 注入后 git/编辑器抱怨混合行尾）：
// - 注入：检测**原文件主导 EOL**（CRLF/LF），用同种 EOL `join` lines 写回。
// - INJECT_BLOCK **内部** 行分隔硬编码 `\n` —— 不参数化也不跟随原文件 EOL：
//   * buildInjectBlockRegex 用 `\r?\n` 匹配，可同时识别两种形式的历史 marker；
//   * 改成参数化 EOL 会破坏 LEGACY 形式的回归匹配（老 marker 是 `\n` 写入的）。
// - 因此注入后 CRLF 文件**会含混合 EOL**（块内 LF + 块外 CRLF），这是已知的、
//   被 test/cli-inject.test.js 'CRLF 文件注入后原 CRLF 部分被保留' 用例固化的行为。

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export const INJECT_START = '// >>> Start CC Viewer Web Service >>>';
export const INJECT_END = '// <<< Start CC Viewer Web Service <<<';

export function buildInjectBlock(injectImport) {
  return `${INJECT_START}\n${injectImport}\n${INJECT_END}`;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 匹配 inject block（任意 INJECT_IMPORT 形式 —— 当前的 + 历史的）。
export function buildInjectBlockRegex(injectImport, legacyInjectImports) {
  const allImports = [injectImport, ...legacyInjectImports];
  const alt = allImports.map(escapeRegex).join('|');
  return new RegExp(`${escapeRegex(INJECT_START)}\\r?\\n(?:${alt})\\r?\\n${escapeRegex(INJECT_END)}\\r?\\n?`, 'g');
}

// 注入 / 升级 cli.js。
// 返回值:
//   - 'injected'   首次注入
//   - 'exists'     已注入且与当前 INJECT_BLOCK 完全一致（幂等）
//   - 'updated'    含 INJECT_START 但 marker 不一致 → 重写为新 INJECT_BLOCK（升级路径）
export function injectCliJsAt(cliPath, injectImport, legacyInjectImports) {
  const injectBlock = buildInjectBlock(injectImport);
  const content = readFileSync(cliPath, 'utf-8');
  if (content.includes(INJECT_START)) {
    if (content.includes(injectBlock)) return 'exists';
    const regex = buildInjectBlockRegex(injectImport, legacyInjectImports);
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    const updated = content.replace(regex, injectBlock + eol);
    if (updated !== content) {
      writeFileSync(cliPath, updated);
      return 'updated';
    }
    return 'exists';
  }
  // 保留主导 EOL：若原文件 CRLF，注入完仍 CRLF（否则 split('\n')+join('\n') 会把 Win 文件
  // 一次性转 LF，git/编辑器抱怨混合行尾且对哈希签名敏感的脚本可能失效）。
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  lines.splice(2, 0, injectBlock);
  writeFileSync(cliPath, lines.join(eol));
  return 'injected';
}

// 卸载 cli.js 注入。返回 'removed' | 'clean' | 'not_found' | 'error'.
export function removeCliJsInjectionAt(cliPath, injectImport, legacyInjectImports) {
  try {
    if (!existsSync(cliPath)) return 'not_found';
    const content = readFileSync(cliPath, 'utf-8');
    if (!content.includes(INJECT_START)) return 'clean';
    const regex = buildInjectBlockRegex(injectImport, legacyInjectImports);
    writeFileSync(cliPath, content.replace(regex, ''));
    return 'removed';
  } catch {
    return 'error';
  }
}
