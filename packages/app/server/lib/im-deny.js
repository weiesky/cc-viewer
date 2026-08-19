// IM worker 硬拦截规则（纯函数，便于单测）。
//
// 由 perm-bridge.js 在 CCV_BYPASS_PERMISSIONS auto-allow 之前调用（仅当 CCV_IM_DENY=1，即 IM worker）。
// 这是 skip-permissions 下「真正会 deny」的一层（见 plan §安全 2）：CLAUDE.md 只是建议、可被注入指令绕过，
// 而 PreToolUse deny 由我们完全控制、对 bypass 仍生效（perm-bridge.js 的 npm publish 硬拦截即活证据）。
//
// 范围：聚焦「不可逆 / 外泄 / 提权 / 凭证」这类灾难性操作，而非试图完整沙箱化（正则无法穷尽）。
// 注意：worker 的工作目录在 ~/.claude/cc-viewer/IM_<id>/ 下，因此**不能**整体封禁 ~/.claude，
// 只精确保护其中的全局 settings/hooks 与 preferences.json（IM 密钥），其余留给 worker 正常读写。
import os from 'node:os';
import { resolve } from 'node:path';

// 凭证目录：读 + 写都拒（含密钥/令牌）。
const CRED_DIRS = ['.ssh', '.aws', '.gnupg', '.kube', '.docker', '.config/gcloud'];
// 家目录下的 shell 启动文件：写拒（被改写可植入持久化）。
const WRITE_HOME_FILES = ['.bashrc', '.zshrc', '.bash_profile', '.zprofile', '.zshenv', '.profile', '.npmrc', '.netrc'];
// 精确文件：写拒（保护 deny 机制本身与 IM 密钥）。相对家目录。
const WRITE_REL_PATHS = ['.claude/settings.json', '.claude/settings.local.json', '.claude/cc-viewer/preferences.json'];
// 精确文件：读拒（含令牌/密钥）。相对家目录。
const READ_REL_PATHS = ['.npmrc', '.netrc', '.claude/cc-viewer/preferences.json'];

// Bash 命令硬拦截规则。每条 { re, reason }。
const BASH_DENY_RULES = [
  // 不可逆删除：递归 rm / find -delete / shred
  { re: /\brm\b[^\n|;&]*\s-{1,2}[a-z]*r/i, reason: 'recursive rm (irreversible delete)' },
  { re: /\bfind\b[^\n]*\s-delete\b/i, reason: 'find -delete (recursive irreversible delete)' },
  { re: /\bshred\b/i, reason: 'shred (unrecoverable delete)' },
  // 对外发布 / 提权。git push 允许 git 与 push 之间只夹 flag（如 git -C path push），
  // 但不会误伤 commit message 里含 "push" 的提交（commit 不是 flag，匹配在此前终止）。
  { re: /\bgit\s+(-{1,2}\S+\s+(\S+\s+)?)*push\b/i, reason: 'git push (outbound publish)' },
  { re: /\b(npm|yarn|pnpm)\s+publish\b/i, reason: 'package publish (irreversible release)' },
  { re: /\bsudo\b/i, reason: 'privilege escalation (sudo)' },
  { re: /(^|[\s;&|])su\s/i, reason: 'privilege escalation (su)' },
  { re: /\b(ssh|scp|sftp|telnet|rsync)\b/i, reason: 'remote shell / copy' },
  // 反弹 shell / 任意网络外泄通道
  { re: /\b(nc|ncat|netcat)\b/i, reason: 'netcat (reverse shell / exfil)' },
  { re: /\/dev\/(tcp|udp)\//i, reason: 'bash /dev/tcp|udp network redirect (reverse shell / exfil)' },
  { re: /\b(shutdown|reboot|halt|poweroff)\b/i, reason: 'system power command' },
  { re: /\bmkfs\b/i, reason: 'filesystem format' },
  { re: /\bdd\b[^\n]*\bof=\/dev\//i, reason: 'raw disk write' },
  { re: /:\s*\(\s*\)\s*\{[^}]*\|[^}]*&\s*\}\s*;/, reason: 'fork bomb' },
  // 外泄：curl/wget 携带本地数据上传
  { re: /\b(curl|wget)\b[^\n]*\s-{1,2}(d|data|data-binary|data-raw|post-file|F|form|T|upload-file)\b/i, reason: 'outbound data upload (exfil risk)' },
  { re: /\b(curl|wget)\b[^\n]*@\//i, reason: 'outbound file upload (exfil risk)' },
  // 凭证 / 密钥文件访问（Bash 层；与下面 Read/Write 路径层互为补充——cat 等会绕过路径层）。
  // 覆盖 SSH/AWS/GnuPG/k8s/docker/gcloud/gh/npm/netrc + cc-viewer 自身的 IM 密钥库 preferences.json + 全局 settings。
  { re: /(id_rsa|id_ed25519|id_ecdsa|authorized_keys|\.ssh\/|\.aws\/|\.gnupg\/|\.kube\/|\.docker\/|\.config\/(gcloud|gh)\/|\.netrc|\.npmrc|cc-viewer\/preferences\.json|\.claude\/settings(\.local)?\.json)\b/i, reason: 'access to credential / secret files' },
];

function underAny(absPath, roots) {
  return roots.some((r) => absPath === r || absPath.startsWith(r + '/'));
}
function pathOf(toolInput, home) {
  let fp = toolInput.file_path || toolInput.notebook_path || toolInput.path;
  if (typeof fp !== 'string' || !fp) return null;
  // 展开前导 ~ / ~/，避免 `~/.ssh/id_rsa` 绕过路径层（resolve 不展开 ~）。
  if (fp === '~') fp = home;
  else if (fp.startsWith('~/')) fp = home + fp.slice(1);
  try { return resolve(fp); } catch { return null; }
}

/**
 * 评估一次工具调用是否应被硬拒。纯函数。
 * @param {string} toolName
 * @param {object} toolInput
 * @param {{ home?: string }} [opts]
 * @returns {{ deny: boolean, reason?: string }}
 */
export function evaluateImDeny(toolName, toolInput = {}, opts = {}) {
  const home = opts.home || os.homedir();
  const credRoots = CRED_DIRS.map((d) => resolve(home, d));

  if (toolName === 'Bash') {
    const cmd = typeof toolInput.command === 'string' ? toolInput.command : '';
    if (!cmd) return { deny: false };
    for (const rule of BASH_DENY_RULES) {
      if (rule.re.test(cmd)) return { deny: true, reason: rule.reason };
    }
    return { deny: false };
  }

  if (toolName === 'Read') {
    const abs = pathOf(toolInput, home);
    if (!abs) return { deny: false };
    if (underAny(abs, credRoots)) return { deny: true, reason: 'read of a credential directory' };
    if (READ_REL_PATHS.some((rel) => abs === resolve(home, rel))) return { deny: true, reason: 'read of a secret/credential file' };
    return { deny: false };
  }

  if (toolName === 'Edit' || toolName === 'Write' || toolName === 'NotebookEdit') {
    const abs = pathOf(toolInput, home);
    if (!abs) return { deny: false };
    if (underAny(abs, credRoots)) return { deny: true, reason: 'write to a credential directory' };
    if (WRITE_HOME_FILES.some((f) => abs === resolve(home, f))) return { deny: true, reason: 'write to a shell startup / credential file' };
    if (WRITE_REL_PATHS.some((rel) => abs === resolve(home, rel))) return { deny: true, reason: 'write to protected global config (settings/hooks or IM secrets)' };
    return { deny: false };
  }

  return { deny: false };
}
