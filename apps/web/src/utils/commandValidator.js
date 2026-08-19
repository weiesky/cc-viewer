/**
 * File and command validation utilities.
 */

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'bmp', 'ico', 'icns', 'webp', 'avif']);

export function isImageFile(path) {
  const ext = (path || '').split('.').pop().toLowerCase();
  return IMAGE_EXTS.has(ext);
}

/**
 * Regex matching Bash commands that may mutate filesystem or git state.
 * 命中任一即触发文件浏览器与 git 面板自动刷新（ToolFileChangeController 的 Bash 路径依赖）。
 *
 * 覆盖类别：
 * - delete：rm（含 rm -rf）、rmdir（删空目录）、unlink（POSIX 单文件删除）、find ... -delete
 * - create/move：mkdir、mv、cp、touch、ln
 * - metadata：chmod、chown
 * - package/archive：npm/yarn/pnpm install/uninstall、pip install、tar、unzip、curl -o、wget
 * - redirect write：> 与 >>（排除 2>、>= 等由 [^>]>(?!>)/>> 处理）
 * - git mutating：checkout/reset/stash/merge/rebase/cherry-pick/restore/clean/rm
 *
 * 设计取舍（trade-off）：
 *   \b 单词边界不能区分"作为命令"还是"作为参数/字面量"，因此 `echo unlink` 之类
 *   会被命中。文件浏览器额外刷新成本极低（一次 GET），宁可多刷不漏刷。
 *
 * find -delete 子表达式 `\bfind\b[^|;&\n]*-delete\b` 限定单条命令内，
 * 避免 `grep find . | echo "-delete"` 之类的跨管道/分号误匹配。
 *
 * @example
 *   isMutatingCommand('rm -rf node_modules')           // true
 *   isMutatingCommand('find . -name "*.log" -delete')  // true
 *   isMutatingCommand('git status')                    // false
 *   isMutatingCommand('echo hello')                    // false
 */
const MUTATING_CMD_RE = /\b(rm|rmdir|unlink|mkdir|mv|cp|touch|chmod|chown|ln|git\s+(checkout|reset|stash|merge|rebase|cherry-pick|restore|clean|rm)|npm\s+(install|uninstall|ci)|yarn\s+(add|remove)|pnpm\s+(add|remove|install)|pip\s+install|tar|unzip|curl\s+-[^\s]*o|wget)\b|\bfind\b[^|;&\n]*-delete\b|[^>]>(?!>)|>>/;

/**
 * @param {string} cmd  Bash 命令字符串
 * @returns {boolean}   true 表示命令可能修改文件树或 git 状态
 */
export function isMutatingCommand(cmd) {
  return MUTATING_CMD_RE.test(cmd);
}
