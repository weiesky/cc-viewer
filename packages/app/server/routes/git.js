// Git routes (moved verbatim from server.js handleRequest).
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { join, basename, resolve, sep } from 'node:path';
import { getGitDiffs, countUntrackedLines, getUnpushedCommits, isValidCommitHash } from '../lib/git-diff.js';

const GIT_RESTORE_LOCK_CLEANUP_MS = 30000;

function gitRepos(req, res) {
  try {
    const projectDir = process.env.CCV_PROJECT_DIR || process.cwd();
    const repos = [];
    if (existsSync(join(projectDir, '.git'))) {
      repos.push({ name: basename(projectDir), path: '.', isRoot: true });
    }
    const entries = readdirSync(projectDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      try {
        if (existsSync(join(projectDir, entry.name, '.git'))) {
          repos.push({ name: entry.name, path: entry.name, isRoot: false });
        }
      } catch {}
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ repos }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message, repos: [] }));
  }
}

function gitRestore(req, res, parsedUrl, isLocal, deps) {
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > deps.MAX_POST_BODY) req.destroy(); });
  req.on('end', async () => {
    let parsed;
    try { parsed = JSON.parse(body); } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request body' }));
      return;
    }
    try {
      const { path: filePath, repo: repoParam } = parsed;
      if (!filePath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing path' }));
        return;
      }
      if (filePath.startsWith('/') || filePath.includes('..')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid path' }));
        return;
      }
      const cwd = deps.resolveRepoCwd(repoParam);
      if (!cwd) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid repo parameter' }));
        return;
      }
      const fullPath = join(cwd, filePath);
      if (existsSync(fullPath)) {
        const realFull = realpathSync(fullPath);
        const realCwd = realpathSync(cwd);
        if (!realFull.startsWith(realCwd + sep)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Path traversal not allowed' }));
          return;
        }
      }
      // Per-file mutex 序列化「git status + checkout/clean」子命令对。多 tab 并发同文件
      // revert 时不再有 race 让两个 checkout 交错执行（最终状态不可预测）。
      // resolve() 规整 `./foo.js` / `foo.js` / `.//foo.js` 为同一 lockKey，防形变绕过。
      const lockKey = resolve(join(cwd, filePath));
      const prev = deps.gitRestoreLocks.get(lockKey) || Promise.resolve();
      const current = prev.then(async () => {
        const { stdout: statusOut } = await deps.execFileAsync('git', ['status', '--porcelain', '--', filePath], { cwd, encoding: 'utf-8', timeout: 5000 });
        const isUntracked = statusOut.trim().startsWith('??');
        if (isUntracked) {
          await deps.execFileAsync('git', ['clean', '-fd', '--', filePath], { cwd, timeout: 10000 });
        } else {
          await deps.execFileAsync('git', ['checkout', '--', filePath], { cwd, timeout: 10000 });
        }
      }).finally(() => {
        if (deps.gitRestoreLocks.get(lockKey) === current) deps.gitRestoreLocks.delete(lockKey);
      });
      deps.gitRestoreLocks.set(lockKey, current);
      // setTimeout 兜底——防 finally 异常吞 entry 累积内存。
      setTimeout(() => {
        if (deps.gitRestoreLocks.get(lockKey) === current) deps.gitRestoreLocks.delete(lockKey);
      }, GIT_RESTORE_LOCK_CLEANUP_MS).unref();
      await current;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

async function gitStatus(req, res, parsedUrl, isLocal, deps) {
  try {
    const repoParam = parsedUrl.searchParams.get('repo');
    const cwd = deps.resolveRepoCwd(repoParam);
    if (!cwd) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid repo parameter', changes: [] }));
      return;
    }
    // `-uall` 让 git 把新增目录展开成具体文件，而不是收敛为 `?? path/`
    // 否则前端树会把整个新目录当一个「空文件名」叶子渲染，且行数统计为 0。
    // maxBuffer 拉到 10MB——默认 1MB 在 node_modules 未 gitignore 之类的极端
    // 场景下会被截断，导致后续 split 解析错位。
    const { stdout: output } = await deps.execFileAsync('git', ['status', '--porcelain', '-uall'], { cwd, encoding: 'utf-8', timeout: 5000, maxBuffer: 10 * 1024 * 1024 });
    // Win 上 git stdout 是 CRLF；现状靠下文 .trim() 兜底，加正则更稳防未来 strict 比较破窗。
    const lines = output.split(/\r?\n/).filter(line => line.trim());
    const changes = lines.map(line => {
      const status = line.substring(0, 2).trim();
      let file = line.substring(3).trim();
      // git status --porcelain quotes paths with non-ASCII chars using octal escapes
      if (file.startsWith('"') && file.endsWith('"')) {
        file = file.slice(1, -1)
          .replace(/\\([0-7]{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
          .replace(/\\t/g, '\t').replace(/\\n/g, '\n')
          .replace(/\\\\/g, '\\').replace(/\\"/g, '"');
        file = Buffer.from(file, 'latin1').toString('utf8');
      }
      return { status, file };
    });

    // Collect per-file insertions/deletions via git diff --numstat (tracked) + --cached --numstat (staged).
    // Neither covers untracked files, so add their line counts separately via countUntrackedLines
    // — matching git's numstat semantics (binary and >5MB files contribute 0).
    let insertions = 0, deletions = 0;
    try {
      const [{ stdout: numstat }, { stdout: cachedNumstat }] = await Promise.all([
        deps.execFileAsync('git', ['diff', '--numstat'], { cwd, encoding: 'utf-8', timeout: 5000 }),
        deps.execFileAsync('git', ['diff', '--cached', '--numstat'], { cwd, encoding: 'utf-8', timeout: 5000 }),
      ]);
      for (const raw of [numstat, cachedNumstat]) {
        for (const l of raw.split('\n')) {
          const m = l.match(/^(\d+)\t(\d+)\t/);
          if (m) { insertions += Number(m[1]); deletions += Number(m[2]); }
        }
      }
    } catch { /* non-critical — stats just stay 0 */ }

    // Cap untracked-file processing to keep the event loop responsive if a
    // repo forgets to gitignore a huge directory (e.g. node_modules).
    // 超限时仍继续计数，但不再调 countUntrackedLines——用 insertions_capped
    // 通知前端"此数据被硬上限截断"，避免静默少算给用户造成误判。
    const MAX_UNTRACKED = 5000;
    let untrackedProcessed = 0;
    let untrackedTotal = 0;
    for (const c of changes) {
      if (c.status !== '??') continue;
      untrackedTotal++;
      if (untrackedProcessed >= MAX_UNTRACKED) continue;
      insertions += countUntrackedLines(cwd, c.file);
      untrackedProcessed++;
    }
    const insertions_capped = untrackedTotal > MAX_UNTRACKED;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ changes, insertions, deletions, insertions_capped }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message, changes: [] }));
  }
}

async function gitDiff(req, res, parsedUrl, isLocal, deps) {
  try {
    const repoParam = parsedUrl.searchParams.get('repo');
    const cwd = deps.resolveRepoCwd(repoParam);
    if (!cwd) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid repo parameter', diffs: [] }));
      return;
    }
    const filesParam = parsedUrl.searchParams.get('files');

    if (!filesParam) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing files parameter' }));
      return;
    }

    const files = filesParam.split(',').map(f => f.trim()).filter(Boolean);
    const commitParam = parsedUrl.searchParams.get('commit');
    // Reject malformed commit hashes; falsy = working-tree mode
    const commitHash = commitParam && isValidCommitHash(commitParam) ? commitParam : undefined;
    const diffs = await getGitDiffs(cwd, files, commitHash);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ diffs }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message, diffs: [] }));
  }
}

async function gitLogUnpushed(req, res, parsedUrl, isLocal, deps) {
  try {
    const repoParam = parsedUrl.searchParams.get('repo');
    const cwd = deps.resolveRepoCwd(repoParam);
    if (!cwd) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid repo parameter', commits: [], hasUpstream: false }));
      return;
    }
    const result = await getUnpushedCommits(cwd);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message, commits: [], hasUpstream: false }));
  }
}

export const gitRoutes = [
  { method: 'GET', match: 'exact', path: '/api/git-repos', handler: gitRepos },
  { method: 'POST', match: 'exact', path: '/api/git-restore', handler: gitRestore },
  { method: 'GET', match: 'exact', path: '/api/git-status', handler: gitStatus },
  { method: 'GET', match: 'prefix', path: '/api/git-diff', handler: gitDiff },
  { method: 'GET', match: 'prefix', path: '/api/git-log-unpushed', handler: gitLogUnpushed },
];
