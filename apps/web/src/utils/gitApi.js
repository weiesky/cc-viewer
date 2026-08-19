import { apiUrl } from './apiUrl';

export async function fetchAllRepos() {
  let repoList;
  try {
    const repoRes = await fetch(apiUrl('/api/git-repos'));
    if (!repoRes.ok) throw new Error('No git-repos endpoint');
    const data = await repoRes.json();
    repoList = data.repos || [];
  } catch {
    // 回退：旧服务器没有 /api/git-repos，用 /api/git-status 兼容单仓库
    try {
      const statusRes = await fetch(apiUrl('/api/git-status'));
      if (!statusRes.ok) return [];
      const data = await statusRes.json();
      return [{ name: '.', path: '.', isRoot: true, changes: data.changes || [], insertions: data.insertions || 0, deletions: data.deletions || 0, commits: [], hasUpstream: false }];
    } catch {
      return [];
    }
  }
  // GET /api/git-status?repo=<path> → { changes, insertions, deletions, insertions_capped? }
  // GET /api/git-log-unpushed?repo=<path> → { commits, hasUpstream, branch?, upstream?, truncated?, totalCount? }
  //   commit shape: { hash, shortHash, author, date (ISO), subject, files: [{status, file}] }
  //   详见 server/lib/git-diff.js: getUnpushedCommits / server.js: /api/git-log-unpushed handler.
  const results = await Promise.all(
    repoList.map(async (repo) => {
      const [statusData, commitsData] = await Promise.all([
        fetch(apiUrl(`/api/git-status?repo=${encodeURIComponent(repo.path)}`))
          .then(r => r.ok ? r.json() : { changes: [], insertions: 0, deletions: 0 })
          .catch(() => ({ changes: [], insertions: 0, deletions: 0 })),
        fetch(apiUrl(`/api/git-log-unpushed?repo=${encodeURIComponent(repo.path)}`))
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
