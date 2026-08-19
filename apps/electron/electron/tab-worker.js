/**
 * Tab Worker — child process for each Electron tab.
 * Launched via fork() from electron/main.js.
 * Each worker runs an isolated proxy + server + Claude PTY.
 *
 * Uses workspace mode (CCV_WORKSPACE_MODE=1) so interceptor.js skips auto-init.
 * Then manually: startViewer() → initForWorkspace() → spawnClaude().
 * This mirrors the workspace-launch flow behind /api/workspaces/launch (cf. cli.js runCliMode).
 */
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Packaged staging layout: electron/ sits next to server/ → app root is '..'.
// Monorepo dev layout: this file lives at apps/electron/electron/ while the app
// payload lives at packages/app/ → up three levels, then into packages/app.
const rootDir = existsSync(join(__dirname, '..', 'server', 'server.js'))
  ? join(__dirname, '..')
  : join(__dirname, '..', '..', '..', 'packages', 'app');
// Windows 下 import(绝对路径) 会被拒 (ERR_UNSUPPORTED_ESM_URL_SCHEME)；统一走 pathToFileURL。
// POSIX 下等价 —— pathToFileURL('/abs/foo.js').href === 'file:///abs/foo.js'，Node ESM 对两种形式行为等价。
const importAbs = (p) => import(pathToFileURL(p).href);
// Static `import ... from '../findcc.js'` only resolves in the packaged layout;
// go through importAbs so monorepo dev works too.
const { applyAgentTeamsDefault } = await importAbs(join(rootDir, 'findcc.js'));

// Set env BEFORE any imports of server.js / interceptor.js
if (process.platform === 'win32' && !process.env.UV_THREADPOOL_SIZE) {
  process.env.UV_THREADPOOL_SIZE = '16';
}
process.env.CCV_CLI_MODE = '1';
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_START_PORT = process.env.CCV_START_PORT || '7048';
process.env.CCV_MAX_PORT = process.env.CCV_MAX_PORT || '7099';
// Default agent-teams (UltraPlan / AgentTeam) on unless explicitly configured (shell env or settings.json).
applyAgentTeamsDefault();

// 等首条 claude PTY 数据落入 outputBuffer 的兜底超时——超过仍 send ready 让前端开始加载。
// claude TUI 启动通常 200-400ms 出首帧；600ms 留足空间又不至于让用户感受到明显延迟。
const CLAUDE_STARTUP_TIMEOUT_MS = 600;

// Receive launch command from parent
process.on('message', async (msg) => {
  if (msg.type === 'launch') {
    try {
      await launch(msg);
    } catch (err) {
      try { process.send({ type: 'error', message: err.message }); } catch {}
      process.exit(1);
    }
  }
  if (msg.type === 'shutdown') {
    await shutdown();
  }
});

// Safety net: parent died
process.on('disconnect', async () => {
  await shutdown();
});

let serverMod = null;
let killPtyFn = null;

async function launch({ path: projectPath, extraArgs = [], claudePath, isNpmVersion }) {
  console.log('[worker] launch:', projectPath, 'claude:', claudePath, 'npm:', isNpmVersion);
  // 1. Register hooks (idempotent)
  const { ensureHooks } = await importAbs(join(rootDir, 'server', 'lib', 'ensure-hooks.js'));
  ensureHooks();

  // 2. Start proxy
  const { startProxy } = await importAbs(join(rootDir, 'server', 'proxy.js'));
  const proxyPort = await startProxy();
  process.env.CCV_PROXY_PORT = String(proxyPort);
  process.env.CCV_PROJECT_DIR = projectPath;

  // 3. Import server.js (workspace mode → skips auto-start)
  serverMod = await importAbs(join(rootDir, 'server', 'server.js'));

  // 4. Manually start server
  await serverMod.startViewer();

  // 5. Get port
  const port = serverMod.getPort();
  if (!port) throw new Error('Server failed to bind port');

  // 6. Store Claude path/args for potential later use by server APIs
  if (claudePath) {
    serverMod.setWorkspaceClaudeArgs(extraArgs);
    serverMod.setWorkspaceClaudePath(claudePath, isNpmVersion);
  }

  // 7. Initialize workspace log directory (sets LOG_FILE, _projectName, _logDir)
  //    forceNew: false — 复用最近的日志文件以保留历史数据
  const { initForWorkspace } = await importAbs(join(rootDir, 'server', 'interceptor.js'));
  const result = initForWorkspace(projectPath, { forceNew: false });

  // 7b. Mark workspace as launched so React app shows chat view instead of workspace selector
  serverMod.setWorkspaceLaunched(true);

  // 7c. Start log watcher, stats worker, streaming status (mirrors /api/workspaces/launch logic)
  serverMod.initPostLaunch();

  // 8. Spawn Claude PTY FIRST so its initial TUI lands in outputBuffer
  // 之前是先 send ready 再 spawnClaude；那种顺序下前端 ws 可能在 PTY 启动前就连上，
  // outputBuffer 为空 + claude 等待输入不再重绘 → 主 TerminalPanel 黑屏。
  // 现在等 spawnClaude 完成且首条 PTY 数据落地（或 600ms 兜底超时）后再 send ready。
  const { spawnClaude, killPty, onPtyExit, onPtyData } = await importAbs(join(rootDir, 'server', 'pty-manager.js'));
  killPtyFn = killPty;

  onPtyExit((code) => {
    try { process.send({ type: 'pty-exit', code }); } catch {}
  });

  if (claudePath) {
    try {
      console.log('[worker] spawnClaude proxyPort:', proxyPort, 'serverPort:', port, 'path:', projectPath);
      await spawnClaude(proxyPort, projectPath, extraArgs, claudePath, isNpmVersion, port, serverMod.getProtocol(), serverMod.getInternalToken());
      // 等首条 PTY 数据 或 超时兜底（claude TUI 启动通常 200-400ms 内首帧）
      await new Promise((resolve) => {
        let done = false;
        const finish = () => { if (done) return; done = true; clearTimeout(timer); remove(); resolve(); };
        const timer = setTimeout(finish, CLAUDE_STARTUP_TIMEOUT_MS);
        const remove = onPtyData(() => finish());
      });
    } catch (err) {
      try { process.send({ type: 'pty-error', message: err.message }); } catch {}
      // spawnClaude 失败时不再 send 'ready'：让 main.js 30s timeout 自动标 tab error，
      // 避免前端激活一个无 PTY 的 tab 出现"看似可用但黑屏"的体验。
      return;
    }
  }

  // 9. Notify parent — view will load with outputBuffer already populated
  const token = serverMod.getAccessToken();
  console.log('[worker] sending ready:', port, result.projectName);
  process.send({
    type: 'ready',
    port,
    token,
    projectName: result.projectName,
  });
}

async function shutdown() {
  try {
    if (killPtyFn) killPtyFn();
    if (serverMod) await serverMod.stopViewer().catch(() => {});
  } catch {}
  process.exit(0);
}
