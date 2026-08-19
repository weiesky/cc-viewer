// Project metadata + stats routes (moved verbatim from server.js handleRequest).
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PACKAGE_JSON } from '../_paths.js';
import { LOG_DIR } from '../../findcc.js';
import { _projectName } from '../interceptor.js';
import { detectHomebrewInstall } from '../lib/updater.js';

// 判定当前 cc-viewer 的安装渠道，供前端精准匹配升级命令。
//   - electron：桌面版（in-process server），走 GitHub Releases 重新下载安装包。
//   - brew：Homebrew Cellar 布局命中 → `brew upgrade cc-viewer`（npm install -g 会跟 Cellar 打架）。
//   - npm：默认兜底 → `npm install -g cc-viewer --registry=...`（指定官方源避免镜像滞后拿到旧版本）。
// deps 仅供单测注入；失败安全：detect 抛异常时回落到 npm（不会误导 brew 用户走 npm）。
export function getInstallMethod({
  electron = process.versions && process.versions.electron,
  detect = detectHomebrewInstall,
} = {}) {
  if (electron) return 'electron';
  try {
    if (detect()) return 'brew';
  } catch { /* 探测失败 → 回落 npm */ }
  return 'npm';
}

function projectName(req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ projectName: _projectName || '' }));
}

function projectDir(req, res) {
  const dir = process.env.CCV_PROJECT_DIR || process.cwd();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ dir }));
}

function versionInfo(req, res) {
  try {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf-8'));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ version: pkg.version, installMethod: getInstallMethod() }));
  } catch {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to read version' }));
  }
}

function projectStats(req, res) {
  try {
    if (!_projectName) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No project name' }));
      return;
    }
    const statsFile = join(LOG_DIR, _projectName, `${_projectName}.json`);
    if (!existsSync(statsFile)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Stats file not found' }));
      return;
    }
    const stats = readFileSync(statsFile, 'utf-8');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(stats);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

function allProjectStats(req, res) {
  try {
    const allStats = {};
    if (existsSync(LOG_DIR)) {
      const entries = readdirSync(LOG_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const project = entry.name;
        const statsFile = join(LOG_DIR, project, `${project}.json`);
        if (existsSync(statsFile)) {
          try {
            allStats[project] = JSON.parse(readFileSync(statsFile, 'utf-8'));
          } catch { }
        }
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(allStats));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

function refreshStats(req, res, parsedUrl, isLocal, deps) {
  try {
    if (!deps.statsWorker) deps.startStatsWorker();
    if (deps.statsWorker) {
      const timeout = setTimeout(() => {
        deps.statsWorker?.removeListener('message', onDone);
        res.writeHead(504, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Stats refresh timed out' }));
      }, 30000);
      const onDone = (m) => {
        if (m.type === 'scan-all-done') {
          clearTimeout(timeout);
          deps.statsWorker?.removeListener('message', onDone);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        }
      };
      deps.statsWorker.on('message', onDone);
      deps.statsWorker.postMessage({ type: 'scan-all', logDir: LOG_DIR });
    } else {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Stats worker not available' }));
    }
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

function cliMode(req, res, parsedUrl, isLocal, deps) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ cliMode: deps.isCliMode, sdkMode: deps.isSdkMode, workspaceMode: deps.isWorkspaceMode && !deps.workspaceLaunched }));
}

export const projectMetaRoutes = [
  { method: 'GET', match: 'exact', path: '/api/project-name', handler: projectName },
  { method: 'GET', match: 'exact', path: '/api/project-dir', handler: projectDir },
  { method: 'GET', match: 'exact', path: '/api/version-info', handler: versionInfo },
  { method: 'GET', match: 'exact', path: '/api/project-stats', handler: projectStats },
  { method: 'GET', match: 'exact', path: '/api/all-project-stats', handler: allProjectStats },
  { method: 'POST', match: 'exact', path: '/api/refresh-stats', handler: refreshStats },
  { method: 'GET', match: 'exact', path: '/api/cli-mode', handler: cliMode },
];
