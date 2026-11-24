// IM worker 的 permissions.deny 防御层（PTY 与 SDK 两条启动路径共用）。
//
// IM worker 恒以 skip-permissions / bypassPermissions 运行，权限安全由三层组成：
//   1. 发送人白名单（im-bridge-core access control）；
//   2. CCV_IM_DENY=1 的 IM 硬拦截（可靠的执行层）：PTY 走 perm-bridge.js 的 settings PreToolUse
//      hook；SDK worker 因子进程剥离 CCV_IM_DENY/CCVIEWER_PORT 使该 settings bridge 休眠，且
//      bypass 下 CLI 不调 canUseTool（CLAUDE_SDK_CAN_USE_TOOL_SHADOWED），故权威层是 sdk-manager
//      挂载的 in-process PreToolUse hook —— 两条路径共用同一个 evaluateImDeny 纯函数判定；
//   3. 本文件注入的 permissions.deny —— CLI 侧的 best-effort 纵深防御。
// 注意：deny 只收紧不放松（优先级最高），不会破坏用户既有 permissions。真正可靠的执行层是第 2 层。
// 该数组曾是 pty-manager.js 的内联块；SDK worker（runImSdkMode）需要同一份规则，故抽成共享 helper。
import { homedir } from 'node:os';

/**
 * 返回要合并进 per-spawn settings 的对象。仅当 CCV_IM_DENY === '1' 时返回
 * { permissions: { deny: [...] } }，否则返回 {}（调用方直接展开即可）。
 */
export function buildImDenySettings() {
  if (process.env.CCV_IM_DENY !== '1') return {};
  const home = homedir();
  return {
    permissions: {
      deny: [
        'Bash(sudo:*)', 'Bash(rm -rf:*)', 'Bash(rm -fr:*)',
        'Bash(git push:*)', 'Bash(npm publish:*)', 'Bash(ssh:*)', 'Bash(scp:*)',
        `Read(${home}/.ssh/**)`, `Edit(${home}/.ssh/**)`, `Write(${home}/.ssh/**)`,
        `Read(${home}/.aws/**)`, `Edit(${home}/.aws/**)`, `Write(${home}/.aws/**)`,
        // File-precise: protect the deny mechanism itself (settings/hooks), the IM
        // credential store (preferences.json), and the credential vault (credentials.json +
        // master.key), but do not block all of ~/.claude — the worker's working directory
        // sits under ~/.claude/cc-viewer/IM_<id>/ and must stay writable.
        `Edit(${home}/.claude/settings.json)`, `Write(${home}/.claude/settings.json)`,
        `Edit(${home}/.claude/settings.local.json)`, `Write(${home}/.claude/settings.local.json)`,
        `Edit(${home}/.claude/cc-viewer/preferences.json)`, `Write(${home}/.claude/cc-viewer/preferences.json)`,
        // preferences.json 现承载定时任务定义(含 prompt);运行历史/旧版任务文件同理拒读拒写。
        `Read(${home}/.claude/cc-viewer/preferences.json)`,
        `Read(${home}/.claude/cc-viewer/scheduled-task-runs.json)`, `Edit(${home}/.claude/cc-viewer/scheduled-task-runs.json)`, `Write(${home}/.claude/cc-viewer/scheduled-task-runs.json)`,
        `Read(${home}/.claude/cc-viewer/scheduled-tasks.json)`, `Edit(${home}/.claude/cc-viewer/scheduled-tasks.json)`, `Write(${home}/.claude/cc-viewer/scheduled-tasks.json)`,
        `Read(${home}/.claude/cc-viewer/credentials.json)`, `Edit(${home}/.claude/cc-viewer/credentials.json)`, `Write(${home}/.claude/cc-viewer/credentials.json)`,
        `Read(${home}/.claude/cc-viewer/master.key)`, `Edit(${home}/.claude/cc-viewer/master.key)`, `Write(${home}/.claude/cc-viewer/master.key)`,
        // Backup copies of the vault (cc-viewer-config-backups/<ts>/) hold the same decryption
        // kit (credentials.json + master.key) — deny the whole subtree or an IM worker could read
        // a rolled backup and decrypt every secret.
        `Read(${home}/.claude/cc-viewer-config-backups/**)`, `Edit(${home}/.claude/cc-viewer-config-backups/**)`, `Write(${home}/.claude/cc-viewer-config-backups/**)`,
      ],
    },
  };
}
