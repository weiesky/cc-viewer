// ============================================================================
// 终端复制/粘贴键位判定 + 剪贴板写入（共用于 TerminalPanel / ScratchTerminal）
// ----------------------------------------------------------------------------
// 背景：xterm 6 的键盘处理把 Ctrl+C / Ctrl+V 当控制字符（\x03 / \x16）发往 PTY，
// 并对该 keydown 调用 preventDefault（CoreBrowserTerminal._keyDown 末尾的 cancel）。
// 后果（仅 Win/Linux，Mac 用 Cmd+C/V 走 metaKey 不受影响）：
//   - Ctrl+V：浏览器原生 paste 默认动作被压掉 → 无法粘贴（只有 Ctrl+Shift+V 能用，
//             因为带 Shift 不进 ctrl-letter 控制字符分支，xterm 不 cancel，原生 paste 照常）。
//   - Ctrl+C：恒发 SIGINT，永远不会复制。
// 这里把 Ctrl+C/Ctrl+V 还原成"智能复制/粘贴"（对齐 Windows Terminal / VS Code 终端）：
// 在 attachCustomKeyEventHandler（最先执行、且返回 false 时 xterm 不会 cancel/preventDefault）
// 里判定动作，由调用方主动读剪贴板并走安全送出路径。
// ============================================================================

/**
 * 判断键盘事件是否应触发终端的复制/粘贴。
 * 仅在 keydown、Ctrl 按下（且非 Shift/Alt/Meta）、非 Mac、物理键为 C/V 时命中。
 * 纯函数，不读取任何全局状态（isMac 由调用方传入），便于单测。
 *
 * @param {KeyboardEvent} e
 * @param {{ isMac?: boolean }} [opts]
 * @returns {'copy'|'paste'|null}
 */
export function clipboardKeyAction(e, opts = {}) {
  // Mac：Ctrl+C/V 维持终端原义（SIGINT / 字面插入），复制粘贴走 Cmd（metaKey），不在此接管。
  if (opts.isMac) return null;
  if (!e || e.type !== 'keydown') return null;
  if (!e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return null;
  // e.code 是物理键位（布局无关）；同时兼容只有 e.key 的场景。
  const key = typeof e.key === 'string' ? e.key.toLowerCase() : '';
  if (e.code === 'KeyC' || key === 'c') return 'copy';
  if (e.code === 'KeyV' || key === 'v') return 'paste';
  // 刻意不接管 Ctrl+X：终端里它是合法控制字符（\x18，如 emacs/nano 前缀键），剪切语义不适用，交回 xterm。
  return null;
}

/**
 * 计算粘贴时应发送给 PTY 的字节串：bracketed-paste 包裹 + 注入消毒决策。
 * 抽出原 _handlePaste / _pasteText（及 scratch 对应）中重复的判定，便于单测覆盖这段最易回归的逻辑。
 *
 * @param {string} text 剪贴板文本
 * @param {{ bracketedPasteMode?: boolean, active?: boolean, sanitize?: (s:string)=>string }} [opts]
 *   - active=false（原生 paste 路径）：bracketedPasteMode 且无注入时返回 null（交 xterm 自动包裹）；
 *     单行且无包裹模式也返回 null（交浏览器原生插入）；其余包裹。
 *   - active=true（主动读剪贴板，无原生 paste 事件）：bracketedPasteMode 时也自行包裹；单行原样返回。
 * @returns {string|null} 要 ws.send 的 data；null 表示此处不发送（交由 xterm / 原生处理）
 */
export function planPasteSend(text, opts = {}) {
  if (typeof text !== 'string' || text.length === 0) return null;
  const { bracketedPasteMode = false, active = false, sanitize = (s) => s } = opts;
  const hasInjection = /\x1b\[20[01]~/.test(text);
  // 原生路径下：shell 已开 bracketed paste 且无注入序列 → xterm 会自动包裹，无需干预
  if (!active && bracketedPasteMode && !hasInjection) return null;
  const isMultiline = text.includes('\n') || text.includes('\r');
  const needWrap = active ? (bracketedPasteMode || hasInjection || isMultiline)
                          : (hasInjection || isMultiline);
  if (needWrap) return `\x1b[200~${sanitize(text)}\x1b[201~`;
  // active：单行无包裹模式 → 原样发送；原生路径：交浏览器默认插入（不发送）
  return active ? text : null;
}

/**
 * 将文本写入剪贴板：安全上下文优先 navigator.clipboard.writeText，
 * 否则退回隐藏 textarea + document.execCommand('copy')（覆盖 LAN HTTP 等非安全上下文），
 * 并在结束后还原原焦点，避免抢走终端焦点。
 *
 * @param {string} text
 * @returns {Promise<boolean>} 是否复制成功
 */
export async function copyTextToClipboard(text) {
  if (typeof text !== 'string' || text.length === 0) return false;
  const clip = typeof navigator !== 'undefined' ? navigator.clipboard : null;
  if (clip && typeof clip.writeText === 'function') {
    try {
      await clip.writeText(text);
      return true;
    } catch {
      // 安全上下文但权限/焦点等原因失败 → 落到 execCommand 兜底
    }
  }
  return execCommandCopy(text);
}

function execCommandCopy(text) {
  if (typeof document === 'undefined' || !document.body) return false;
  const prevActive = document.activeElement;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '-9999px';
  ta.style.left = '-9999px';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  let ok = false;
  try {
    ta.focus();
    ta.select();
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  try {
    document.body.removeChild(ta);
  } catch {
    /* noop */
  }
  // 还原焦点（execCommand 复制需要短暂聚焦临时 textarea，复制后交还原元素）
  if (prevActive && typeof prevActive.focus === 'function') {
    try {
      prevActive.focus();
    } catch {
      /* noop */
    }
  }
  return ok;
}
