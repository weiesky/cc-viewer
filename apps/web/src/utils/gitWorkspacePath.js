// repoPath is '.' for the workspace-root repo, otherwise a top-level directory name
// (see server/routes/git.js). Drag payloads and context-menu copy paths must be
// workspace-root-relative, matching FileExplorer's contract.
export function toWorkspacePath(repoPath, relPath) {
  return repoPath && repoPath !== '.' ? `${repoPath}/${relPath}` : relPath;
}
