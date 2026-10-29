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
import { realpathSync, lstatSync } from 'node:fs';
import { resolve, basename, dirname, sep, join } from 'node:path';
import { homedir, platform, tmpdir } from 'node:os';
import { getClaudeConfigDir, onLogDirChange, LOG_DIR } from '../../findcc.js';
import { loadWorkspaces } from '../workspace-registry.js';
import { getBackupRoot } from './config-backup.js';

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
  // cc-viewer 凭证 vault(credentials.json 密文)与主密钥(master.key):即使 ~/.claude 在 allowlist,
  // 也绝不跨网读(master.key 同时被下方 .key 文件名规则覆盖,这里双保险)。
  'credentials.json',
  'master.key',
  // cc-viewer preferences.json 现在承载定时任务定义(含 prompt,可能带 secret)——默认路径下与
  // credentials 同级拒绝;LOG_DIR 被 --log-dir 移走时由下方 _logDirSensitiveFiles 按 realpath 拦。
  'preferences.json',
]);

/**
 * LOG_DIR 下的敏感数据文件名(定时任务运行历史 / 旧版任务存储 / preferences 本身)。
 * 默认 LOG_DIR = ~/.claude/cc-viewer 在 allowlist 内,这些文件若只按文件名拦会误伤项目内同名
 * fixture,所以按 realpath 精确等值 + LOG_DIR 前缀拦截;LOG_DIR 被 setLogDir 移走时缓存随
 * onLogDirChange 失效(沿用既有 roots 缓存失效钩子)。
 */
const LOGDIR_SENSITIVE_NAMES = new Set([
  'preferences.json',
  'scheduled-task-runs.json',
  'scheduled-tasks.json',
]);
let _logDirSensitiveCache = null;
function _logDirSensitiveFiles() {
  if (_logDirSensitiveCache) return _logDirSensitiveCache;
  let rootReal;
  try { rootReal = realpathSync(LOG_DIR); } catch { rootReal = LOG_DIR; }
  const files = new Set();
  for (const name of LOGDIR_SENSITIVE_NAMES) {
    files.add(norm(join(LOG_DIR, name)));
    files.add(norm(join(rootReal, name)));
  }
  // `root`/`rootReal` keep a trailing separator for startsWith() prefix matching;
  // `rootBare`/`rootRealBare` (no trailing sep) let isWriteAllowed also deny the
  // LOG_DIR directory ITSELF (delete/rename), which the prefix match would miss.
  _logDirSensitiveCache = {
    root: norm(withSep(LOG_DIR)), rootReal: norm(withSep(rootReal)),
    rootBare: norm(LOG_DIR), rootRealBare: norm(rootReal),
    files,
  };
  return _logDirSensitiveCache;
}
onLogDirChange(() => { _logDirSensitiveCache = null; });

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

// LOG_DIR changes relocate the workspace registry file — the allowlist cache
// (including registered workspaces) must be invalidated. Registered at module
// load so findcc (a leaf) never imports this module.
onLogDirChange(() => bumpWorkspacesVersion());

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

  return evaluateResolvedPath(real);
}

// Shared verdict for a realpath-resolved path — the allowlist + sensitive-file
// + sensitive-prefix checks that isReadAllowed (existing files) and
// isWriteAllowed (existing or to-be-created files) both apply. Keeping this the
// single implementation prevents read/write policy drift: a path the user can
// read but must not overwrite (e.g. ~/.claude/settings.json) is denied here for
// both directions.
function evaluateResolvedPath(real) {
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
    // settings.json / settings.local.json at any depth, plus all backups/variants
    // (settings.json.bk*, settings_*.json, etc.) — rolling backup files carry the
    // same env/api-key content and must not slip past the exact-name match.
    if (/^settings(\.local)?\.json($|\.)|^settings_.*\.json$/i.test(last)) {
      return { ok: false, reason: 'sensitive-claude-config' };
    }
    // Prompt history, project transcripts, shell snapshots, file history, and
    // paste cache contain user prompt content and (in the case of shell snapshots)
    // live env vars. Block the whole subtree EXCEPT projects/<encoded>/memory/**,
    // which is the documented per-project memory dir served by /api/project-memory.
    const rel = norm(real.slice(norm(withSep(claudeReal)).length));
    const firstSeg = rel.split(sep)[0];
    if (firstSeg === 'todos' || firstSeg === 'shell-snapshots'
      || firstSeg === 'file-history' || firstSeg === 'paste-cache' || firstSeg === 'session-env') {
      return { ok: false, reason: 'sensitive-claude-config' };
    }
    if (firstSeg === 'projects') {
      const parts = rel.split(sep);
      const isMemoryDir = parts.length >= 3 && parts[2] === 'memory';
      if (!isMemoryDir) {
        return { ok: false, reason: 'sensitive-claude-config' };
      }
    }
    if (last === 'history.jsonl') {
      return { ok: false, reason: 'sensitive-claude-config' };
    }
  }

  // 2b) Deny the cc-viewer config-backup dir tree — every rolling backup holds credentials.json
  // ciphertext + master.key, which together are the full decryption kit. The dir defaults to
  // ~/.claude/cc-viewer-config-backups/ (a sibling of LOG_DIR), but it must be denied whenever it
  // lands inside an allowlist root, regardless of whether LOG_DIR was moved.
  try {
    const backupReal = realpathSync(getBackupRoot());
    if (isInsideRoot(real, backupReal)) {
      return { ok: false, reason: 'sensitive-config-backup' };
    }
  } catch { /* backup root missing / not realpath-able → no extra deny */ }

  // 2c) Deny LOG_DIR 内的任务/偏好数据文件(preferences.json 含 auth + 定时任务 prompt、
  // scheduled-task-runs.json 含 prompt 摘要、scheduled-tasks.json 为旧版任务存储)与内核写
  // 过程的 tmp/corrupt 残留。这些路径必须绕开所有 HTTP 剥离逻辑之外的裸文件读写。
  {
    const sens = _logDirSensitiveFiles();
    const realNorm = norm(real);
    if (sens.files.has(realNorm)) {
      return { ok: false, reason: 'sensitive-ccv-data' };
    }
    // .tmp-<rand>（writeJsonAtomic 中间态）与 .corrupt-<ts>（tolerant 自愈备份）同属敏感残留。
    if ((realNorm.startsWith(sens.root) || realNorm.startsWith(sens.rootReal)) && /\.(tmp|corrupt)-[^/\\]+$/.test(realNorm)) {
      return { ok: false, reason: 'sensitive-ccv-data' };
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
 * Write-access verdict for the file browser's target mode (the CLAUDE.md / skill
 * folder modal, where the user may browse up to an ancestor of the target). The
 * target file itself may not exist yet (create-file / create-dir / rename
 * destination), so unlike isReadAllowed we cannot realpath it directly. Instead:
 * the parent directory must exist and pass the read policy, and the candidate
 * path (parent's real path + basename) must pass the SAME shared verdict — so a
 * location the user can read but must not overwrite (settings.json, credentials,
 * master.key, backups) is rejected identically in both directions.
 *
 * SECURITY / INTENTIONAL DESIGN (do NOT weaken or remove in review): the write
 * surface intentionally spans the whole navigation root (see
 * lib/target-scope.js resolveTargetWriteScope). This function is the backstop
 * that keeps secrets unwritable inside that wider surface.
 *
 * Two write-only denials layered on top of the read policy:
 *  - The ENTIRE LOG_DIR tree (~/.claude/cc-viewer/**): the read policy only
 *    blocks specific data files in it, but a write/delete could rmdir the whole
 *    dir (wiping the preferences + scheduled-task store), so writes deny the
 *    whole subtree.
 *  - The config-backup root is already denied for reads (2b) and stays denied.
 */
export function isWriteAllowed(absPath) {
  if (typeof absPath !== 'string' || !absPath) return { ok: false, reason: 'invalid' };
  if (absPath.indexOf('\x00') !== -1) return { ok: false, reason: 'null-byte' };

  // Existing file: realpath it and run the shared verdict directly.
  // New file: realpath the nearest existing parent, then re-evaluate the
  // candidate (parentReal + basename) so symlink/denylist checks apply to the
  // resolved location, not the spelled path.
  let real;
  let existed = true;
  try { real = realpathSync(absPath); } catch { existed = false; }
  if (!existed) {
    // Dangling-symlink guard: realpath failed but the leaf may still be a symlink
    // whose target is missing/outside the allowlist. writeFileSync would FOLLOW it
    // and create/overwrite the link's target outside the navigation root — a
    // containment bypass. lstat does not follow the link, so an isSymbolicLink()
    // hit here refuses the write. Do NOT remove (TOCTOU-class escape).
    try { if (lstatSync(absPath).isSymbolicLink()) return { ok: false, reason: 'symlink' }; } catch { /* truly absent leaf */ }
    let cursor = resolve(absPath, '..');
    const descent = [basename(absPath)];
    let parentReal = null;
    for (let depth = 0; depth < 32; depth++) {
      try { parentReal = realpathSync(cursor); break; } catch {
        const parent = resolve(cursor, '..');
        if (parent === cursor) break;
        descent.unshift(basename(cursor));
        cursor = parent;
      }
    }
    if (parentReal === null) return { ok: false, reason: 'realpath-failed' };
    // Every ancestor on the way down must be inside the allowlist / not denied;
    // evaluate the nearest existing ancestor, then rebuild the candidate.
    const ancestorVerdict = evaluateResolvedPath(parentReal);
    if (!ancestorVerdict.ok) return ancestorVerdict;
    real = join(parentReal, ...descent);
  }

  const verdict = evaluateResolvedPath(real);
  if (!verdict.ok) return verdict;

  // Write-only: deny the whole LOG_DIR subtree (read policy only blocks named
  // data files in it). Matches both the raw and realpath'd spellings, both the
  // prefix (children) AND the directory itself (bare), so a delete/rename cannot
  // rmdir the whole task/preferences store.
  const sens = _logDirSensitiveFiles();
  const realNorm = norm(real);
  if (realNorm.startsWith(sens.root) || realNorm.startsWith(sens.rootReal)
    || realNorm === sens.rootBare || realNorm === sens.rootRealBare) {
    return { ok: false, reason: 'sensitive-ccv-data' };
  }

  // Write-only: deny a sensitive-PREFIX directory itself (~/.ssh, ~/.aws, …), not
  // just its contents. The read policy only matches children (startsWith withSep),
  // so renaming the directory to a benign name would expose the whole prefix's
  // contents. Renaming/deleting the dir root is refused here. (Only meaningful
  // outside the project root, matching the prefix rule's own scope.)
  const projectRoot = getProjectRoot();
  if (!isInsideRoot(real, projectRoot)) {
    for (const prefix of SENSITIVE_PATH_PREFIXES) {
      if (realNorm === norm(prefix)) return { ok: false, reason: 'sensitive-prefix' };
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
