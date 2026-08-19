import { readFileSync, existsSync, statSync, lstatSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Windows：从无控制台的 worker node.exe 启动 git.exe 会弹可见控制台窗口，
// 包装层统一默认 windowsHide（POSIX no-op），覆盖本文件全部 git 调用。
const _execFileAsyncRaw = promisify(execFile);
const execFileAsync = (cmd, args, opts) => _execFileAsyncRaw(cmd, args, { windowsHide: true, ...opts });

const UNTRACKED_MAX_BYTES = 5 * 1024 * 1024;
const BINARY_PROBE_BYTES = 8192;

// Reject only `..` as a path *segment* (start, between slashes, or end).
// Substring match (`'node..modules'.includes('..')`) was rejecting valid paths.
const PATH_TRAVERSAL = /(?:^|\/)\.\.(?:\/|$)/;

// Whitelist for git ref names returned by `git rev-parse --abbrev-ref @{u}`.
// Defense in depth: git-rev-parse output should never contain shell metacharacters,
// but we validate before passing to `git log <upstream>..HEAD`.
const SAFE_REF = /^[A-Za-z0-9_./\-]+$/;

/**
 * Count inserted lines for an untracked file, matching `git diff --numstat`
 * semantics (line = `\n`-terminated run; an unterminated trailing run still
 * counts as one line; 0 for empty; 0 for binary; 0 for files > 5MB).
 *
 * `git diff --numstat` (and `--cached --numstat`) do not see untracked files,
 * so the aggregate insertions reported by /api/git-status was blind to them.
 * This helper is used to add that missing slice without shelling out per file.
 *
 * Refuses to read through symlinks or files that resolve outside cwd — git's
 * own `--numstat` does not follow symlinks for untracked paths, so matching
 * that behavior keeps /api/git-status from leaking line counts of files like
 * /etc/passwd if a user happens to have one symlinked into the worktree.
 *
 * @param {string} cwd      repo root
 * @param {string} file     path relative to cwd (no `..`, no absolute)
 * @returns {number} inserted line count; 0 on any error, binary, or size cap
 */
export function countUntrackedLines(cwd, file) {
  if (!file || PATH_TRAVERSAL.test(file) || file.startsWith('/')) return 0;
  try {
    const fp = join(cwd, file);
    // Reject when the final component is a symlink (lstat doesn't follow).
    if (lstatSync(fp).isSymbolicLink()) return 0;
    // And when an intermediate symlink moves the real path outside cwd.
    const realCwd = realpathSync(cwd);
    const realFp = realpathSync(fp);
    if (realFp !== realCwd && !realFp.startsWith(realCwd + sep)) return 0;
    const st = statSync(fp);
    if (!st.isFile() || st.size > UNTRACKED_MAX_BYTES) return 0;
    const buf = readFileSync(fp);
    const probe = buf.subarray(0, Math.min(buf.length, BINARY_PROBE_BYTES));
    if (probe.includes(0)) return 0; // binary — numstat also skips
    if (buf.length === 0) return 0;
    let n = 0;
    for (let i = 0; i < buf.length; i++) if (buf[i] === 10) n++;
    if (buf[buf.length - 1] !== 10) n++;
    return n;
  } catch {
    return 0;
  }
}

/**
 * Get commits between upstream and HEAD (i.e. local commits not yet pushed).
 * Returns an empty list when:
 *   - HEAD is detached (rev-parse --abbrev-ref HEAD prints "HEAD")
 *   - Branch has no upstream (@{u} resolution fails)
 *   - Working tree is at upstream (no commits ahead)
 *
 * Each commit includes its changed files via a single `git log --name-status` call,
 * to avoid one git invocation per commit.
 *
 * @param {string} cwd
 * @param {object} [opts]
 * @param {number} [opts.maxCommits=100] hard cap to keep payload bounded
 * @returns {Promise<{ commits: Array, hasUpstream: boolean, branch: string|null, upstream: string|null, truncated?: boolean, totalCount?: number }>}
 */
export async function getUnpushedCommits(cwd, { maxCommits = 100 } = {}) {
  let branch = null;
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf-8', timeout: 3000 });
    branch = stdout.trim();
  } catch {
    return { commits: [], hasUpstream: false, branch: null, upstream: null };
  }
  if (!branch || branch === 'HEAD') {
    return { commits: [], hasUpstream: false, branch, upstream: null };
  }

  let upstream = null;
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { cwd, encoding: 'utf-8', timeout: 3000 });
    upstream = stdout.trim();
  } catch {
    return { commits: [], hasUpstream: false, branch, upstream: null };
  }
  if (!upstream || !SAFE_REF.test(upstream)) {
    return { commits: [], hasUpstream: false, branch, upstream: null };
  }

  // Use NUL separators between fields and a sentinel between commits to avoid
  // getting fooled by tabs/newlines inside commit subjects.
  // Format: <hash>\x1f<author>\x1f<date>\x1f<subject>\n
  // Followed by one `<status>\t<path>` line per file (from --name-status).
  // Commits separated by `\x1e` (record separator).
  const COMMIT_SEP = '\x1e';
  const FIELD_SEP = '\x1f';
  let stdout = '';
  try {
    const r = await execFileAsync(
      'git',
      [
        'log',
        `--max-count=${maxCommits}`,
        `--pretty=format:${COMMIT_SEP}%H${FIELD_SEP}%an${FIELD_SEP}%aI${FIELD_SEP}%s`,
        '--name-status',
        `${upstream}..HEAD`,
      ],
      { cwd, encoding: 'utf-8', timeout: 8000, maxBuffer: 10 * 1024 * 1024 }
    );
    stdout = r.stdout;
  } catch {
    return { commits: [], hasUpstream: true, branch, upstream };
  }

  const commits = [];
  const blocks = stdout.split(COMMIT_SEP).filter(Boolean);
  for (const block of blocks) {
    // git on Windows 在 piped 模式输出 CRLF；split('\n') 会让 fp 末尾带 \r，前端文件名乱码。
    const lines = block.split(/\r?\n/);
    const header = lines[0] || '';
    const parts = header.split(FIELD_SEP);
    if (parts.length < 4) continue;
    const [hash, author, date, subject] = parts;
    const files = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      const tab = line.indexOf('\t');
      if (tab < 0) continue;
      const st = line.substring(0, tab).trim();
      const fp = line.substring(tab + 1);
      if (!fp) continue;
      files.push({ status: st[0] || 'M', file: fp });
    }
    commits.push({
      hash,
      shortHash: hash.substring(0, 7),
      author,
      date,
      subject,
      files,
    });
  }

  // Detect truncation. 默认 truncated = (commits.length === maxCommits)，因为命中 cap 大概率
  // 是被截了；rev-list --count 成功才用真实数据覆盖。这样如果 rev-list 失败/超时（大 repo
  // 可能 >3s），用户至少能看到截断标记，不会被静默隐藏 200 条未推送 commit。
  let totalCount = commits.length;
  let truncated = commits.length === maxCommits;
  if (truncated) {
    try {
      const r = await execFileAsync('git', ['rev-list', '--count', `${upstream}..HEAD`], { cwd, encoding: 'utf-8', timeout: 3000 });
      const parsed = parseInt(r.stdout.trim(), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        totalCount = parsed;
        truncated = totalCount > commits.length;
      }
    } catch {}
  }

  return { commits, hasUpstream: true, branch, upstream, truncated, totalCount };
}

/**
 * Validate git commit hash. Accept 7..40 hex chars only.
 * Rejects refs like "HEAD~1", branch names, anything with shell metacharacters.
 * @param {string} hash
 * @returns {boolean}
 */
export function isValidCommitHash(hash) {
  return typeof hash === 'string' && /^[0-9a-f]{7,40}$/i.test(hash);
}

/**
 * Get git diffs for a list of files.
 * When commitHash is provided, diffs come from `git show <hash>` (parent vs hash);
 * otherwise from working tree vs HEAD (default behavior).
 *
 * @param {string} cwd - working directory (git repo root)
 * @param {string[]} files - relative file paths
 * @param {string} [commitHash] - optional commit SHA to diff against its first parent
 * @returns {Promise<Array>} diffs array
 */
export async function getGitDiffs(cwd, files, commitHash) {
  const useCommit = commitHash && isValidCommitHash(commitHash);
  const diffs = [];

  // For commit-context diffs, get the per-file status table once instead of per file.
  let commitStatusMap = null;
  if (useCommit) {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['diff-tree', '-r', '--no-commit-id', '--name-status', '--root', commitHash],
        { cwd, encoding: 'utf-8', timeout: 5000, maxBuffer: 5 * 1024 * 1024 }
      );
      commitStatusMap = new Map();
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        const tab = line.indexOf('\t');
        if (tab < 0) continue;
        const st = line.substring(0, tab).trim();
        const fp = line.substring(tab + 1);
        commitStatusMap.set(fp, st[0] || 'M');
      }
    } catch {
      commitStatusMap = new Map();
    }
  }

  for (const file of files) {
    // 安全检查：防止路径穿越
    if (PATH_TRAVERSAL.test(file) || file.startsWith('/')) continue;

    try {
      let status;
      let is_new;
      let is_deleted;

      if (useCommit) {
        status = commitStatusMap.get(file) || 'M';
        is_new = status === 'A';
        is_deleted = status === 'D';
      } else {
        const { stdout: statusOutput } = await execFileAsync('git', ['status', '--porcelain', '--', file], { cwd, encoding: 'utf-8', timeout: 3000 });
        if (!statusOutput.trim()) continue;
        status = statusOutput.substring(0, 2).trim();
        is_new = status === 'A' || status === '??';
        is_deleted = status === 'D';
      }

      // 检查是否为二进制文件（已删除文件跳过）
      let is_binary = false;
      if (!is_deleted) {
        try {
          const numstatArgs = useCommit
            ? ['diff-tree', '-r', '--no-commit-id', '--numstat', '--root', commitHash, '--', file]
            : ['diff', '--numstat', 'HEAD', '--', file];
          const { stdout: diffCheck } = await execFileAsync('git', numstatArgs, { cwd, encoding: 'utf-8', timeout: 3000 });
          if (diffCheck.includes('-\t-\t')) {
            is_binary = true;
          }
        } catch {}
      }

      let old_content = '';
      let new_content = '';

      if (!is_binary) {
        // 获取旧内容
        if (!is_new) {
          try {
            const oldRef = useCommit ? `${commitHash}^:${file}` : `HEAD:${file}`;
            const { stdout } = await execFileAsync('git', ['show', oldRef], { cwd, encoding: 'utf-8', timeout: 5000, maxBuffer: 5 * 1024 * 1024 });
            old_content = stdout;
          } catch {
            old_content = '';
          }
        }

        // 获取新内容
        if (!is_deleted) {
          if (useCommit) {
            try {
              const { stdout } = await execFileAsync('git', ['show', `${commitHash}:${file}`], { cwd, encoding: 'utf-8', timeout: 5000, maxBuffer: 5 * 1024 * 1024 });
              new_content = stdout;
              if (Buffer.byteLength(new_content, 'utf-8') > 5 * 1024 * 1024) {
                diffs.push({ file, status, is_large: true, size: Buffer.byteLength(new_content, 'utf-8') });
                continue;
              }
            } catch {
              new_content = '';
            }
          } else {
            try {
              const filePath = join(cwd, file);
              if (existsSync(filePath)) {
                const stat = statSync(filePath);
                if (stat.size > 5 * 1024 * 1024) {
                  // 文件过大
                  diffs.push({ file, status, is_large: true, size: stat.size });
                  continue;
                }
                new_content = readFileSync(filePath, 'utf-8');
              }
            } catch {
              new_content = '';
            }
          }
        }

        // 统一换行符，避免 Windows CRLF 与 Git LF 差异导致整文件被标记为变更
        old_content = old_content.replace(/\r\n/g, '\n');
        new_content = new_content.replace(/\r\n/g, '\n');
      }

      diffs.push({
        file,
        status,
        old_content,
        new_content,
        is_binary,
        is_new,
        is_deleted
      });
    } catch (err) {
      // 跳过无法处理的文件
      continue;
    }
  }

  return diffs;
}
