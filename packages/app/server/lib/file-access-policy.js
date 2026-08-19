/**
 * 统一文件读访问策略 — 用于 /api/file-content (GET/POST), /api/file-raw, /api/plan-file
 *
 * 三层防御:
 *   ① Allowlist roots 命中(realpath 后比对)
 *   ② 项目内豁免 sensitive filename(测试 fixtures 等不被误拦)
 *   ③ Allowlist 内但落在 sensitive prefix / 文件名 → 仍拒绝(防 home dir 内 secrets 泄漏)
 *
 * 关键合同:返回 `real`(realpath 解析后),调用方 MUST 用 real 读文件,杜绝 TOCTOU。
 *
 * 不替代写路径的业务校验(见 server/lib/file-api.js writeFileContent),但同样会被 endpoint 用作首道关卡。
 */
import { realpathSync } from 'node:fs';
import { resolve, basename, sep, join } from 'node:path';
import { homedir, platform, tmpdir } from 'node:os';
import { getClaudeConfigDir } from '../../findcc.js';
import { loadWorkspaces } from '../workspace-registry.js';

const osPlatform = platform();
const isWin = osPlatform === 'win32';
const isDarwin = osPlatform === 'darwin';
const norm = (p) => isWin ? p.toLowerCase() : p;
const withSep = (p) => p.endsWith(sep) ? p : p + sep;

// 启动时快照 cwd:启动后 chdir 也保留旧 root,避免后续切目录把校验范围"收缩"。
const STARTUP_CWD = process.cwd();

// home dir 计算的路径前缀(运行时按 homedir() 拼装,避免硬编码)。
function homeJoin(...segs) { return join(homedir(), ...segs); }

/**
 * 敏感路径前缀 denylist —— 即使父目录在 allowlist 内,落在这些前缀下的文件一律拒绝。
 * 必须包含 macOS realpath 后的 /private/* 变体。
 */
export const SENSITIVE_PATH_PREFIXES = [
  // SSH / GPG / 各家云凭据
  homeJoin('.ssh'),
  homeJoin('.aws'),
  homeJoin('.gnupg'),
  homeJoin('.docker'),
  homeJoin('.kube'),
  homeJoin('.netrc'),
  homeJoin('.pgpass'),
  homeJoin('.my.cnf'),
  homeJoin('.azure'),
  homeJoin('.terraform.d'),
  homeJoin('.wrangler'),
  homeJoin('.cargo'),
  homeJoin('.subversion', 'auth'),
  homeJoin('.config', 'gh'),
  homeJoin('.config', 'git'),
  homeJoin('.config', 'google-chrome'),
  homeJoin('.mozilla'),
  // macOS Library
  homeJoin('Library', 'Keychains'),
  homeJoin('Library', 'Cookies'),
  homeJoin('Library', 'Application Support', 'Google', 'Chrome'),
  homeJoin('Library', 'Application Support', 'Firefox'),
  homeJoin('Library', 'Application Support', 'JetBrains'),
  // 系统目录
  '/etc',
  '/proc',
  '/sys',
  '/dev',
  // macOS realpath 变体(只拦 /private/etc:/private/var 是 tmpdir() 的家,不能整个黑)
  '/private/etc',
];

/**
 * 敏感文件名 pattern —— 在 allowlist 内但项目外的路径,文件名匹配则拒绝。
 * 项目内(CCV_PROJECT_DIR 内)豁免,允许 fixtures/test cert 等合法用途。
 */
export const SENSITIVE_FILENAME_PATTERNS = [
  /^id_(rsa|ed25519|ecdsa|dsa)(?!\.pub$)(\.[^.]+)?$/i, // 私钥(放行 .pub)
  /\.(pem|key|p12|pfx|keystore|jks)$/i,                 // 证书 / 私钥
  /^\.env(\.(?!example$|sample$|template$).*)?$/i,      // .env 系列(放行 .example/.sample/.template)
  /^credentials$/i,                                     // 无扩展凭据文件
  /^secrets\..+$/i,
  /^service-account.*\.json$/i,
  /-credentials\.json$/i,
  /\.(tfstate|tfvars)$/i,                               // Terraform 明文 secret
  /^\.(bash|zsh|python)_history$/,
  /^\.lesshst$/,
];

/**
 * `~/.claude/` 内子拦清单 —— 即使父目录在 allowlist,这些文件仍拒绝。
 * 含 OAuth refresh token / API key,用户即使在编辑器里"看一眼"也不应允许跨网读。
 */
const SENSITIVE_CLAUDE_FILES = new Set([
  '.credentials.json',
  'settings.json',
  'settings.local.json',
]);

// ─── allowlist roots 缓存 ──────────────────────────────────────────────────────
let _rootsCache = null;
let _workspacesVersion = 0;

/**
 * 由 workspace-registry 在 register/remove 后调用,失效缓存。
 */
export function bumpWorkspacesVersion() {
  _workspacesVersion++;
  _rootsCache = null;
}

/**
 * 测试 / 多 process 场景显式重置 —— 测试可在更换 HOME env 后调,policy 重新解析。
 */
export function _resetCacheForTests() {
  _rootsCache = null;
}

function computeRoots() {
  const out = [];
  const seen = new Set();
  const add = (raw) => {
    if (!raw || typeof raw !== 'string') return;
    let real;
    try { real = realpathSync(raw); } catch { real = raw; }
    const key = norm(real);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ raw, real });
  };
  add(process.env.CCV_PROJECT_DIR || STARTUP_CWD);
  add(STARTUP_CWD);
  add(getClaudeConfigDir());
  add(join(tmpdir(), 'cc-viewer-uploads'));
  if (isDarwin) add('/private/tmp/cc-viewer-uploads');
  add('/tmp/cc-viewer-uploads');             // Linux/旧上传写入路径(macOS realpath 后 /private/tmp/...)
  add(homeJoin('.claude', 'cc-viewer'));
  try {
    for (const w of loadWorkspaces()) add(w.path);
  } catch {
    // workspace registry 读失败不应影响其它 root
  }
  return out;
}

/** 返回缓存的 allowlist roots(每个 root 含 raw + realpath 后的 real)。 */
export function getAllowedRoots() {
  if (!_rootsCache) _rootsCache = computeRoots();
  return _rootsCache;
}

function isInsideRoot(realPath, root) {
  return norm(realPath) === norm(root) || norm(realPath).startsWith(norm(withSep(root)));
}

function getProjectRoot() {
  const p = process.env.CCV_PROJECT_DIR || STARTUP_CWD;
  try { return realpathSync(p); } catch { return resolve(p); }
}

/**
 * 主入口:判断 absPath 是否允许读。
 *
 * @param {string} absPath - 绝对路径(调用方应已把相对路径在合理 cwd 拼接为绝对)
 * @returns {{ok: true, real: string} | {ok: false, reason: string, allowedRoots?: string[]}}
 *
 * reason 取值:
 *   - 'invalid'                 输入不是字符串 / 空
 *   - 'null-byte'               含 \x00
 *   - 'realpath-failed'         路径不存在或权限失败(调用方建议转 404)
 *   - 'outside-allowlist'       路径不在任何 root 下(返回 allowedRoots 帮助用户诊断)
 *   - 'sensitive-claude-config' ~/.claude/ 内的 OAuth/settings 文件
 *   - 'sensitive-prefix'        落在 SENSITIVE_PATH_PREFIXES 下
 *   - 'sensitive-filename'      文件名匹配 SENSITIVE_FILENAME_PATTERNS(项目外)
 */
export function isReadAllowed(absPath) {
  if (typeof absPath !== 'string' || !absPath) return { ok: false, reason: 'invalid' };
  if (absPath.indexOf('\x00') !== -1) return { ok: false, reason: 'null-byte' };

  let real;
  try { real = realpathSync(absPath); } catch { return { ok: false, reason: 'realpath-failed' }; }

  // 1) Allowlist 命中
  const roots = getAllowedRoots();
  let hitRoot = null;
  for (const r of roots) {
    if (isInsideRoot(real, r.real)) { hitRoot = r; break; }
  }
  if (!hitRoot) {
    return { ok: false, reason: 'outside-allowlist', allowedRoots: roots.map(r => r.raw) };
  }

  // 2) ~/.claude/ 子拦(无项目内豁免:这些文件含 secrets,任何上下文都不放)
  let claudeReal;
  try { claudeReal = realpathSync(getClaudeConfigDir()); } catch { claudeReal = null; }
  if (claudeReal && isInsideRoot(real, claudeReal)) {
    const last = basename(real);
    if (SENSITIVE_CLAUDE_FILES.has(last)) {
      return { ok: false, reason: 'sensitive-claude-config' };
    }
    // 任意子目录下的 settings.json / settings.local.json 也拦
    if (/^settings(\.local)?\.json$/i.test(last)) {
      return { ok: false, reason: 'sensitive-claude-config' };
    }
  }

  // 3) 项目内文件豁免 sensitive 文件名(允许 fixtures/test-cert.pem 等合法 fixture)
  const projectRoot = getProjectRoot();
  const isInProj = isInsideRoot(real, projectRoot);

  if (!isInProj) {
    // Sensitive prefix(realpath 后再扫一遍,防 symlink 绕过)
    for (const prefix of SENSITIVE_PATH_PREFIXES) {
      if (norm(real).startsWith(norm(withSep(prefix)))) {
        return { ok: false, reason: 'sensitive-prefix' };
      }
    }
    // Sensitive filename
    const name = basename(real);
    for (const pat of SENSITIVE_FILENAME_PATTERNS) {
      if (pat.test(name)) {
        return { ok: false, reason: 'sensitive-filename' };
      }
    }
  }

  return { ok: true, real };
}

/**
 * 给 endpoint 用的 reason → HTTP status code 映射。
 * - 路径不存在/realpath 失败 → 404(更友好,不暴露"路径合法但不存在")
 * - 其它一律 403(权限拒绝)
 */
export function reasonToStatus(reason) {
  if (reason === 'realpath-failed') return 404;
  if (reason === 'invalid' || reason === 'null-byte') return 400;
  return 403;
}
