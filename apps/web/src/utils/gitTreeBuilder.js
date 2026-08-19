// 将扁平的文件变更列表构建为目录树
// 后端 `git status --porcelain -uall` 会把新目录展开到具体文件。若因旧 server
// 未重启或其它原因返回了目录占位（尾斜杠路径），直接跳过——不能把目录名误
// 当作文件渲染，也不能入 tree 造成空节点。用户重启 server 后会拿到真实文件。
export function buildGitTree(changes) {
  const root = { dirs: {}, files: [] };
  for (const change of changes) {
    if (!change.file || change.file.endsWith('/')) continue;
    const parts = change.file.split('/').filter(Boolean);
    if (parts.length === 0) continue;
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node.dirs[parts[i]]) node.dirs[parts[i]] = { dirs: {}, files: [] };
      node = node.dirs[parts[i]];
    }
    node.files.push({ name: parts[parts.length - 1], status: change.status, fullPath: change.file });
  }
  return root;
}
