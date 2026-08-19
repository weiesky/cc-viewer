// 文件浏览器 + GitChanges 文件夹层级状态的 sessionStorage 持久化。
//
// 设计要点：
// - sessionStorage 跟 tab 生命周期绑定；按 projectName 拆 key，避免不同项目状态串扰。
// - projectName 由后端 /api/project-name 返回，已在 interceptor.js 里 sanitize 成 [a-zA-Z0-9_\-\.]，
//   可直接拼 key 后缀，无需 encodeURIComponent。
// - 空 projectName（启动期 race / 本地日志模式）：跳过读写，避免污染 ":" 这种孤儿 key。
// - Safari Private Mode / 容量满 / sandbox：sessionStorage 访问会抛，外层 try/catch 兜底返回空 Set。
// - 旧值损坏（被扩展改坏、非数组）：JSON.parse 失败回退空 Set。
//
// 两个 bucket 语义反向但独立：
//   FILE_PREFIX        存"展开"集合（FileExplorer 默认全折叠，展开的存）
//   GIT_COLLAPSED_PREFIX 存"折叠"集合（GitChanges 默认全展开，折叠的存）
// 由 wrapper 函数名（loadExpandedPaths vs loadGitChangesCollapsedDirs）明示，
// 防 maintainer 混用。

const FILE_PREFIX = 'ccv_fileExpandedPaths:';
const GIT_COLLAPSED_PREFIX = 'ccv_gitChangesCollapsedDirs:';

function keyFor(prefix, projectName) {
  if (!projectName || typeof projectName !== 'string') return null;
  return prefix + projectName;
}

function loadSet(prefix, projectName) {
  const key = keyFor(prefix, projectName);
  if (!key) return new Set();
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter(p => typeof p === 'string'));
  } catch {
    return new Set();
  }
}

function saveSet(prefix, projectName, set) {
  const key = keyFor(prefix, projectName);
  if (!key) return;
  try {
    // 空集走 removeItem 而非写 '[]'：避免 sessionStorage 留孤儿 entry，并让下次
    // load 的 `!raw` 快路径生效；与 load 的"无值 → 空 Set"语义对齐。
    if (!set || set.size === 0) {
      sessionStorage.removeItem(key);
      return;
    }
    sessionStorage.setItem(key, JSON.stringify(Array.from(set)));
  } catch {
    /* private mode / quota — 忽略 */
  }
}

// FileExplorer：存"展开"集合，默认全折叠
export function loadExpandedPaths(projectName) {
  return loadSet(FILE_PREFIX, projectName);
}
export function saveExpandedPaths(projectName, set) {
  saveSet(FILE_PREFIX, projectName, set);
}

// GitChanges：存"折叠"集合（key 形态 `${repoPath}::${dirPath}`），默认全展开。
// 语义跟 FileExplorer 反向，函数名明示防混用。
export function loadGitChangesCollapsedDirs(projectName) {
  return loadSet(GIT_COLLAPSED_PREFIX, projectName);
}
export function saveGitChangesCollapsedDirs(projectName, set) {
  saveSet(GIT_COLLAPSED_PREFIX, projectName, set);
}
