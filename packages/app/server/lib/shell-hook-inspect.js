// Shell-hook 状态只读探针(L1):cli.js 与 server 共用,避免 server 反向 import cli.js
// (cli.js 是 side-effectful 入口,import 即执行 dispatch)。
// Shell-hook read-only inspector, shared by cli.js and the server (which must never
// import the side-effectful cli.js entry).
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

export const SHELL_HOOK_START = '# >>> CC-Viewer Auto-Inject >>>';
export const SHELL_HOOK_END = '# <<< CC-Viewer Auto-Inject <<<';

// 候选 rc 文件全集(removeShellHook 原有清单)。install 只写 getShellConfigPath()
// 选中的那一个,inspect 扫全集 —— 用户可能换过 shell,旧 rc 里的 hook 同样算「已装」。
const RC_CANDIDATES = ['.zshrc', '.zprofile', '.bashrc', '.bash_profile', '.profile'];

/**
 * 检查 shell hook 安装状态(只读,绝不写 rc —— 「用户删掉 = 不想装」必须被尊重)。
 * Inspect shell-hook installation state. Read-only by contract.
 *
 * @param {(isNative: boolean) => string} buildShellHook 期望内容的构造器(cli.js 注入,
 *   使「stale」判定与 install 用同一份模板;server 侧无模板时可传 null 跳过 stale 判定)
 * @returns {{ installed: boolean, stale: boolean, path: string|null, corrupt: string|null }}
 *   - installed: 任一候选 rc 含 START 标记
 *   - stale: 标记块存在但与当前模板不一致(upgrade 后旧版 hook 残留)
 *   - corrupt: 含 START 但块不完整(END 损坏)的文件路径
 */
export function inspectShellHook(buildShellHook = null) {
  const home = homedir();
  let found = null;
  let stale = false;
  let corrupt = null;
  for (const f of RC_CANDIDATES) {
    const p = resolve(home, f);
    try {
      if (!existsSync(p)) continue;
      const content = readFileSync(p, 'utf-8');
      if (!content.includes(SHELL_HOOK_START)) continue;
      const m = content.match(new RegExp(`${SHELL_HOOK_START}[\\s\\S]*?${SHELL_HOOK_END}`));
      if (!m) { corrupt = p; continue; }
      if (!found) found = p;
      if (buildShellHook) {
        // 两种模式(npm/native)任一匹配即不算 stale —— install 按部署形态二选一。
        if (m[0] !== buildShellHook(false) && m[0] !== buildShellHook(true)) stale = true;
      }
    } catch { /* 读失败的 rc 不参与判定 */ }
  }
  return { installed: found !== null, stale, path: found, corrupt };
}
