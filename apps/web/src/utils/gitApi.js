import { apiUrl, withViewParams } from './apiUrl';

// Multi-project (2026-10): git surfaces resolve the viewed project — every
// request carries ?project= so the server answers for THAT project's repos
// instead of always the bound one. Multi-instance (2026-10-06): `instance`
// (instanceKey) disambiguates two same-basename projects — without it the
// server's view-root 400s "ambiguous project name" on a same-name pair.
export async function fetchAllRepos(project, instance) {
  let repoList;
  try {
    const repoRes = await fetch(apiUrl(withViewParams('/api/git-repos', { project, instance })));
    if (!repoRes.ok) throw new Error('No git-repos endpoint');
    const data = await repoRes.json();
    repoList = data.repos || [];
  } catch {
    // 回退：旧服务器没有 /api/git-repos，用 /api/git-status 兼容单仓库
    try {
      const statusRes = await fetch(apiUrl(withViewParams('/api/git-status', { project, instance })));
      if (!statusRes.ok) return [];
      const data = await statusRes.json();
      return [{ name: '.', path: '.', isRoot: true, changes: data.changes || [], insertions: data.insertions || 0, deletions: data.deletions || 0, commits: [], hasUpstream: false }];
    } catch {
      return [];
    }
  }
  // GET /api/git-status?repo=<path> → { changes, insertions, deletions, insertions_capped? }
  // GET /api/git-log-unpushed?repo=<path> → { commits, hasUpstream, branch?, upstream?, truncated?, totalCount? }
  //   commit shape: { hash, shortHash, author, date (ISO), subject,
  //     files: [{status, file}], insertions, deletions }
  //   status 为真实 git 状态字母（A/M/D…）；insertions/deletions 为该 commit 的行增删统计
  //   （二进制文件不计行数，纯二进制/纯改名/mode-only commit 两值均为 0）。
  //   无 upstream(或 detached HEAD)时 server 回退到 `git log HEAD --not --remotes`,
  //   即 hasUpstream=false 也可能带 commits——展示与否只看 commits.length。
  //   详见 server/lib/git-diff.js: getUnpushedCommits / server/routes/git.js: /api/git-log-unpushed handler.
  const results = await Promise.all(
    repoList.map(async (repo) => {
      const [statusData, commitsData] = await Promise.all([
        fetch(apiUrl(withViewParams(`/api/git-status?repo=${encodeURIComponent(repo.path)}`, { project, instance })))
          .then(r => r.ok ? r.json() : { changes: [], insertions: 0, deletions: 0 })
          .catch(() => ({ changes: [], insertions: 0, deletions: 0 })),
        fetch(apiUrl(withViewParams(`/api/git-log-unpushed?repo=${encodeURIComponent(repo.path)}`, { project, instance })))
          .then(r => r.ok ? r.json() : { commits: [], hasUpstream: false })
          .catch(() => ({ commits: [], hasUpstream: false })),
      ]);
      return {
        ...repo,
        changes: statusData.changes || [],
        insertions: statusData.insertions || 0,
        deletions: statusData.deletions || 0,
        commits: commitsData.commits || [],
        hasUpstream: !!commitsData.hasUpstream,
        branch: commitsData.branch || null,
        upstream: commitsData.upstream || null,
        truncated: !!commitsData.truncated,
        totalCount: typeof commitsData.totalCount === 'number' ? commitsData.totalCount : (commitsData.commits || []).length,
      };
    })
  );
  return results;
}
