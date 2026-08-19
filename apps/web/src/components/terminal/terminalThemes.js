// 抽离自 TerminalPanel.jsx，供 TerminalPanel + ScratchTerminal 共用，破除循环 import。
import { isWindows, isMac, isIOS } from '../../env';

export const darkTerminalTheme = {
  background: '#0a0a0a', foreground: '#d4d4d4', cursor: '#d4d4d4',
  selectionBackground: '#264f78',
  black: '#000000', red: '#ef4444', green: '#73c991', yellow: '#fbbf24',
  blue: '#3b82f6', magenta: '#d946ef', cyan: '#06b6d4', white: '#e5e5e5',
  brightBlack: '#666666', brightRed: '#ff7b7b', brightGreen: '#9ddc6f', brightYellow: '#ffce5b',
  brightBlue: '#66b3ff', brightMagenta: '#e88ce8', brightCyan: '#7eddd9', brightWhite: '#ffffff',
};

export const lightTerminalTheme = {
  background: '#ffffff', foreground: '#333333', cursor: '#333333',
  selectionBackground: '#cce5ff',
  black: '#000000', red: '#CD3131', green: '#107C10', yellow: '#949800',
  blue: '#0451A5', magenta: '#BC05BC', cyan: '#0598BC', white: '#555555',
  brightBlack: '#666666', brightRed: '#CD3131', brightGreen: '#14CE14', brightYellow: '#B5BA00',
  brightBlue: '#0451A5', brightMagenta: '#BC05BC', brightCyan: '#0598BC', brightWhite: '#A5A5A5',
};

// 终端字体栈（TerminalPanel + ScratchTerminal 共用）。
// Windows：Menlo/Monaco 不存在、Courier New 无 CJK 字形 —— 中文会走浏览器随机回退字体，
// 实际 advance 宽度 ≠ xterm 按 wcwidth 算的 2×cell，逐字符错位累积成 IME 输入"整体偏移"。
// 显式以 Consolas/Cascadia 承接 ASCII、微软雅黑确定性承接 CJK（xterm.js#62/#3342/#4969 同类问题）。
// mac/iOS（DOM 渲染器）同理补 PingFang SC 确定性承接 CJK：追加在 Menlo 之后不影响
// ASCII cell 测量（xterm 用 ASCII 探针测宽，Menlo 必命中），仅让 CJK 字形 advance
// 从浏览器随机回退变为确定。Linux 保持原字体栈，零回归面。
export const terminalFontFamily = isWindows
  ? 'Consolas, "Cascadia Mono", "Courier New", "Microsoft YaHei", "微软雅黑", monospace'
  : (isMac || isIOS)
    ? 'Menlo, Monaco, "Courier New", "PingFang SC", monospace'
    : 'Menlo, Monaco, "Courier New", monospace';
