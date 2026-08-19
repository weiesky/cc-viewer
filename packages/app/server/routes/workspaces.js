// Workspace routes (moved verbatim from server.js handleRequest).
import { existsSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { initForWorkspace, resetWorkspace, getLiveLogSource, markContinuedLaunch, markForkSession, markResumeSession, isContinuedLaunch } from '../interceptor.js';
import { LOG_DIR } from '../../findcc.js';
import { migrationStatus } from '../lib/v2/migrate-prompt.js';
import { reportSwallowed } from '../lib/error-report.js';

// P2: claude continuation flags — the workspace launcher injects `-c` itself
// (WorkspaceList's logCount heuristic), so argv scanning in cli.js never sees
// it; this is detection channel ② of interceptor.isContinuedLaunch().
const CONTINUE_FLAGS = new Set(['-c', '--continue', '-r', '--resume']);
// Explicit resume flags — continued for the migrate prompt, but `-c` folder
// adoption must NOT fire (it targets the latest main session, not the user's
// chosen one). Mirrors cli.js's CCV_CLAUDE_RESUME channel.
const RESUME_FLAGS = new Set(['-r', '--resume']);
import { unwatchAllWorkflows } from '../lib/workflow-watcher.js';
import { readClaudeProjectModel } from '../lib/context-watcher.js';
import { countLogEntries, streamRawEntriesAsync } from '../lib/log-stream.js';
import { sseWrite } from '../lib/wire-compress.js';

function workspacesList(req, res, parsedUrl, isLocal, deps) {
  import('../workspace-registry.js').then(async ({ getWorkspaces }) => {
    const workspaces = await getWorkspaces();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ workspaces, workspaceMode: deps.isWorkspaceMode && !deps.workspaceLaunched }));
  }).catch(err => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  });
}

function workspacesLaunch(req, res, parsedUrl, isLocal, deps) {
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > deps.MAX_POST_BODY) req.destroy(); });
  req.on('end', async () => {
    try {
      const { path: wsPath, extraArgs: launchExtraArgs } = JSON.parse(body);
      if (!wsPath || !existsSync(wsPath) || !statSync(wsPath).isDirectory()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid directory path' }));
        return;
      }

      const { registerWorkspace } = await import('../workspace-registry.js');
      await registerWorkspace(wsPath);

      // Electron multi-tab 模式：管理 server 只触发 callback，不做日志初始化
      // 所有日志相关操作（initForWorkspace、watchLogFile、spawnClaude）由 tab-worker 子进程负责
      if (process.env.CCV_ELECTRON_MULTITAB === '1') {
        if (deps.launchCallback) {
          deps.launchCallback(wsPath, Array.isArray(launchExtraArgs) ? launchExtraArgs : []);
        }
        deps.setWorkspaceLaunched(true);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, projectName: basename(wsPath) }));
        return;
      }

      // 非 Electron 模式（web / CLI）：完整逻辑
      const result = initForWorkspace(wsPath);
      process.env.CCV_PROJECT_DIR = wsPath;

      // 启动日志监听（S6b: v2 live feed when the v2 writer is active）
      deps.startLogWatch();

      // 启动 stats worker（如果尚未启动）
      if (!deps.statsWorker) deps.startStatsWorker();
      deps.startStreamingStatusTimer();

      // P2 检测通道②：workspace 启动器注入的 -c/--continue/-r/--resume（无论
      // 是否走 PTY 分支都要打标——迁移提示的 continued 语义只取决于参数本身）。
      const mergedArgs = [...deps.workspaceClaudeArgs, ...(Array.isArray(launchExtraArgs) ? launchExtraArgs : [])];
      if (mergedArgs.some((a) => CONTINUE_FLAGS.has(a))) markContinuedLaunch();
      // `--fork-session`: a continuation that mints a NEW session id on purpose —
      // `-c` folder adoption must NOT fire for it.
      if (mergedArgs.includes('--fork-session')) markForkSession();
      // `-r`/`--resume`: user-chosen target session — adoption must not redirect
      // it to the latest main session.
      if (mergedArgs.some((a) => RESUME_FLAGS.has(a))) markResumeSession();

      // 启动 PTY
      const proxyPort = process.env.CCV_PROXY_PORT;
      if (proxyPort) {
        const { spawnClaude } = await import('../pty-manager.js');
        await spawnClaude(parseInt(proxyPort), wsPath, mergedArgs, deps.workspaceClaudePath, deps.workspaceIsNpmVersion, deps.actualPort, deps.protocol, deps.INTERNAL_TOKEN);
      }

      deps.setWorkspaceLaunched(true);

      // 通知所有 SSE 客户端
      const startedPayload = `event: workspace_started\ndata: ${JSON.stringify({ projectName: result.projectName, path: wsPath, claudeProjectModel: readClaudeProjectModel(wsPath) })}\n\n`;
      deps.clients.forEach(client => {
        try {
          sseWrite(client, startedPayload);
        } catch {}
      });

      // 流式分段广播以刷新会话区域，避免全量加载 OOM
      // S6b: the live source is the v2 session dir when the v2 writer is
      // active (a fresh workspace has no session yet → empty stream, the live
      // feed picks up from the first request).
      const wsReloadSource = getLiveLogSource();
      const wsReloadTotal = await countLogEntries(wsReloadSource);
      deps.clients.forEach(client => {
        try { sseWrite(client, `event: load_start\ndata: ${JSON.stringify({ total: wsReloadTotal, incremental: false })}\n\n`); } catch {}
      });
      await streamRawEntriesAsync(wsReloadSource, (raw) => {
        deps.clients.forEach(client => {
          try { sseWrite(client, 'event: load_chunk\ndata: ['); sseWrite(client, raw.replace(/\n/g, '')); sseWrite(client, ']\n\n'); } catch {}
        });
      });
      deps.clients.forEach(client => {
        try { sseWrite(client, `event: load_end\ndata: {}\n\n`); } catch {}
      });

      // 1.7.0 迁移引导（P2）：切进的项目仍有未转换 v1 日志 → 对存量连接广播
      // migrate_prompt（新连接由 /events 的连接帧覆盖）。
      try {
        const mig = migrationStatus(LOG_DIR, result.projectName || '');
        if (mig.pending) {
          const frame = `event: migrate_prompt\ndata: ${JSON.stringify({ ...mig, continued: isContinuedLaunch() })}\n\n`;
          deps.clients.forEach(client => { try { sseWrite(client, frame); } catch {} });
        }
      } catch (e) { reportSwallowed('sse.migrate_prompt', e); }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, projectName: result.projectName }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

function workspacesAdd(req, res, parsedUrl, isLocal, deps) {
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > deps.MAX_POST_BODY) req.destroy(); });
  req.on('end', async () => {
    try {
      const { path: wsPath } = JSON.parse(body);
      if (!wsPath || !existsSync(wsPath) || !statSync(wsPath).isDirectory()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid directory path' }));
        return;
      }
      const { registerWorkspace } = await import('../workspace-registry.js');
      const entry = await registerWorkspace(wsPath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, workspace: entry }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

function workspacesDelete(req, res, parsedUrl) {
  const url = parsedUrl.pathname;
  const id = url.split('/').pop();
  import('../workspace-registry.js').then(async ({ removeWorkspace }) => {
    const removed = await removeWorkspace(id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: removed }));
  }).catch(err => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  });
}

function workspacesStop(req, res, parsedUrl, isLocal, deps) {
  Promise.all([
    import('../pty-manager.js').then(({ killPty }) => killPty()),
    import('../scratch-pty-manager.js').then(({ killAllScratch }) => killAllScratch()).catch(() => {}),
  ]).then(() => {
    // 接续原有清理流程

    // 停止日志监听（v1 tail + v2 live feed）
    deps.stopLogWatch();
    unwatchAllWorkflows();

    // 重置 interceptor 状态
    resetWorkspace();
    deps.setWorkspaceLaunched(false);

    // 通知所有 SSE 客户端
    deps.clients.forEach(client => {
      try {
        sseWrite(client, `event: workspace_stopped\ndata: {}\n\n`);
      } catch {}
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  }).catch(err => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  });
}

export const workspacesRoutes = [
  { method: 'GET', match: 'exact', path: '/api/workspaces', handler: workspacesList },
  { method: 'POST', match: 'exact', path: '/api/workspaces/launch', handler: workspacesLaunch },
  { method: 'POST', match: 'exact', path: '/api/workspaces/add', handler: workspacesAdd },
  { method: 'DELETE', match: 'prefix', path: '/api/workspaces/', handler: workspacesDelete },
  { method: 'POST', match: 'exact', path: '/api/workspaces/stop', handler: workspacesStop },
];
