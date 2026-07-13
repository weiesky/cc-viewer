import { resolveNativePath, LOG_DIR } from '../findcc.js';
import { fileURLToPath } from 'node:url';
import { join, dirname, sep } from 'node:path';
import { chmodSync, statSync, existsSync } from 'node:fs';
import { platform, arch, homedir } from 'node:os';
import { createRequire } from 'node:module';
import { prepareEmbeddedShellSpawn, stripClaudeNoFlickerUnlessOptedIn, applyClaudeAltScreenPref } from './lib/terminal-env.js';
import { killPtyTree } from './lib/term-signals.js';
import { findSafeSliceStart, splitTrailingIncomplete } from './lib/ansi-safe-slice.js';
import { buildSystemPromptFileArgs } from './lib/system-prompt-files.js';
import { renderSystemPromptFileArgs } from './lib/system-prompt-render.js';
import { MODEL_PROMPT_DIR } from './lib/model-system-prompts.js';
import { readClaudeProjectModel } from './lib/context-watcher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let ptyProcess = null;
// Kind of the current PTY: 'claude' (real Claude Code session), 'shell' (fallback bare
// shell auto-spawned on input), or null (none). The DingTalk bridge uses this to refuse
// injecting into a bare shell — typing a prompt into a shell would execute it as a command.
let ptyKind = null;
// Whether the current Claude session was launched with --dangerously-skip-permissions
// (cli.js canonicalizes --d/--ad before spawn). Surfaced for the bridge's RCE warning.
let ptySkipPermissions = false;
let dataListeners = [];
let exitListeners = [];
let lastExitCode = null;
let outputBuffer = '';
let currentWorkspacePath = null;
let lastWorkspacePath = null; // 进程退出后保留，用于 respawn shell
let lastPtyCols = 120;
let lastPtyRows = 30;
// 主 PTY spawn 的在途闸：guard 在 await getPty 之前、ptyProcess 赋值在 await 之后，
// 两条同步到达的 input 消息会越过 guard 双开（首个 pty 失引用泄漏 + 输出串扰）。
// 同步占位一个 promise，并发调用复用它，绝不二次 spawn（仿 scratch-pty-manager._spawnInflight）。
let _spawnInflight = null;
// resize 入口的 cols/rows 钳制范围：上界足够宽（4K 显示器超宽终端），下界 ≥2 列/1 行
// 防 FitAddon 在 0 尺寸容器算出的 2×1 或畸形客户端的 NaN/负数毒化 lastPtyCols/Rows。
const PTY_COLS_MIN = 2, PTY_COLS_MAX = 1000;
const PTY_ROWS_MIN = 1, PTY_ROWS_MAX = 1000;
const MAX_BUFFER = 200000;
// 裁剪滞回：超 MAX_BUFFER 触发后一次裁到 TRIM_TO，而非每个 chunk 都裁到 MAX_BUFFER——
// 把 ~200KB slice 重分配的频率从每 chunk 一次降到每 ~20KB 新输出一次。
const BUFFER_TRIM_TO = 180000;
let batchBuffer = '';
let batchScheduled = false;
let _ptyImportForTests = null;

export function _setPtyImportForTests(fn) {
  _ptyImportForTests = fn;
}

// spawn 时读取「上次启动所用模型 id」供模型定制 system prompt 匹配。
// readClaudeProjectModel 读的是真实 ~/.claude.json(无 NODE_TEST_CONTEXT 屏障)，
// 而多数 pty 单测以仓库根为 cwd —— 默认读取器在测试上下文里必须失活，
// 否则开发机的真实模型记录会漏进单测(机器状态依赖)。测试用 _setSpawnModelReaderForTests 显式注入。
// env/reader 参数化只为可测性：单测能直接断言「测试上下文 → null / 生产 → 透传」，
// 而无需真的读 ~/.claude.json(见 test/pty-manager.test.js 的 guard 单测)。
export function _defaultSpawnModelReader(c, env = process.env, reader = readClaudeProjectModel) {
  return env.NODE_TEST_CONTEXT ? null : reader(c);
}
let _spawnModelReader = _defaultSpawnModelReader;
export function _setSpawnModelReaderForTests(fn) {
  _spawnModelReader = fn || _defaultSpawnModelReader;
}

async function getPty() {
  if (typeof _ptyImportForTests === 'function') {
    return _ptyImportForTests();
  }
  const ptyMod = await import('node-pty');
  return ptyMod.default || ptyMod;
}

// ANSI 安全截断起点：实现迁至 lib/ansi-safe-slice.js（锚点扫描算法，见该文件 doc）。
// 保持从本模块 export——server.js 解构注入洪泛限流器、单测均从这里导入。
export { findSafeSliceStart };

// DEC Private Mode 2026 (Synchronized Output) markers.
// xterm.js 6.0+ 原生支持：收到 BEGIN 后缓存所有写入，收到 END 后一次性渲染，
// 消除批次内的中间帧闪烁。不支持的终端会忽略这些序列。
const SYNC_BEGIN = '\x1b[?2026h';
const SYNC_END   = '\x1b[?2026l';

function flushBatch(force = false) {
  batchScheduled = false;
  if (!batchBuffer) return;
  // 批边界半截序列缓带：每批都包 SYNC 标记，若批边界劈开一条转义序列，注入的标记
  // 会吃掉它的 ESC、让后半段以字面渲染（`[9m`/`8;2;102m` 类残片的总根源）。半截尾巴
  // 留到下一批（PTY 续写必然补全）；force=true（进程退出）时不缓带，冲洗全部残余。
  let safe = batchBuffer;
  let carry = '';
  if (!force) [safe, carry] = splitTrailingIncomplete(batchBuffer);
  batchBuffer = carry;
  if (!safe) return;
  const chunk = SYNC_BEGIN + safe + SYNC_END;
  for (const cb of dataListeners) {
    try { cb(chunk); } catch { }
  }
}

// 向嵌入式终端注入一行合成提示(非 claude 输出)。append 到 outputBuffer 让新接入/重连客户端也能
// 从快照看到(server.js 的 data-resync 走 getOutputBuffer)，再实时广播给当前 dataListeners。
function emitSpawnNotice(line) {
  const chunk = `\x1b[2m${line}\x1b[0m\r\n`;
  outputBuffer += chunk;
  for (const cb of dataListeners) {
    try { cb(SYNC_BEGIN + chunk + SYNC_END); } catch { }
  }
}

// 走 createRequire().resolve 而非 join(__dirname, '..', 'node_modules', ...) ——
// pnpm / yarn workspace 把 node-pty hoist 到上级 node_modules 时相对路径会找不到，
// 静默 chmod 失败 → 运行 PTY 时 EACCES，且全程无 log 难排查。
function fixSpawnHelperPermissions() {
  const os = platform();
  const cpu = arch();
  const subPath = `node-pty/prebuilds/${os}-${cpu}/spawn-helper`;
  let helperPath;
  try {
    const req = createRequire(import.meta.url);
    helperPath = req.resolve(subPath);
  } catch (err) {
    // node-pty 没安装/没该平台 prebuild：放过，spawn 时会另报错
    return;
  }
  try {
    const stat = statSync(helperPath);
    if (!(stat.mode & 0o111)) {
      chmodSync(helperPath, stat.mode | 0o755);
    }
  } catch (err) {
    console.warn('[cc-viewer] fixSpawnHelperPermissions failed:', helperPath, err?.message || err);
  }
}

// Opus 4.7 默认不再返回 thinking；为所有非显式覆写的调用加上 summarized。
// 纯函数：仅根据 args 决定是否注入；用户已显式传入 `--thinking-display` 时原样返回。
export function withDefaultThinkingDisplay(args) {
  if (!Array.isArray(args)) return args;
  const hasFlag = args.some(a =>
    a === '--thinking-display' || (typeof a === 'string' && a.startsWith('--thinking-display='))
  );
  return hasFlag ? args : [...args, '--thinking-display', 'summarized'];
}

// 默认总是尝试注入 `--thinking-display summarized`；若目标 claude（或 claude-兼容 CLI/fork/wrapper）
// 不识别该 flag，spawnClaude 的 onExit 会检测到 "unknown option" 错误，自动把 claudePath
// 标记到本集合，下次 spawn 直接跳过注入——完全基于实际运行反馈，不依赖版本号或品牌。
const _thinkingDisplayRejectedPaths = new Set();

// 启动目录里的 CC_SYSTEM.md / CC_APPEND_SYSTEM.md 自动注入 --system-prompt-file/--append-system-prompt-file。
// 若目标 claude(或三方 fork/wrapper)不识别该 flag，onExit 检测 "unknown option" 后把 claudePath 记入此集，
// 下次 spawn 跳过注入并去 flag 重启(对齐 _thinkingDisplayRejectedPaths 自愈)。
const _systemPromptFileRejectedPaths = new Set();

// 内部重启(-c 重试 / flag 自愈)时抑制一次注入提示，避免终端重复打印同一行。
let _suppressNextSpawnNotice = false;

// 仅用于测试/内部：清空拒绝集
export function _clearThinkingDisplayRejectedPaths() {
  _thinkingDisplayRejectedPaths.clear();
}

// 仅用于测试：查询路径是否已被标记为不支持
export function _isThinkingDisplayRejected(claudePath) {
  return _thinkingDisplayRejectedPaths.has(claudePath);
}

// 仅用于测试：强制把路径加入拒绝集，绕过第一次 crash
export function _markThinkingDisplayRejected(claudePath) {
  _thinkingDisplayRejectedPaths.add(claudePath);
}

// 仅用于测试/内部：清空 system-prompt-file 拒绝集
export function _clearSystemPromptFileRejectedPaths() {
  _systemPromptFileRejectedPaths.clear();
}

// 仅用于测试：查询路径是否已被标记为不支持 --system-prompt-file
export function _isSystemPromptFileRejected(claudePath) {
  return _systemPromptFileRejectedPaths.has(claudePath);
}

export async function spawnClaude(proxyPort, cwd, extraArgs = [], claudePath = null, isNpmVersion = false, serverPort = null, serverProtocol = 'http', internalToken = null) {
  // 等待任何在途 spawn 完成再 kill+spawn，避免与 spawnShell 双开/串台（自身串行化）。
  // while 而非 if：≥3 个并发 spawn 时，A 完成后 B 会设新的 inflight=pB，单次 if 的 C
  // 不会复查 pB 就 kill+spawn 致 implB/implC 并发双开——循环到真正无在途为止才放行。
  while (_spawnInflight) { try { await _spawnInflight; } catch { } }
  if (ptyProcess) {
    killPty();
  }
  const p = _spawnClaudeImpl(proxyPort, cwd, extraArgs, claudePath, isNpmVersion, serverPort, serverProtocol, internalToken);
  _spawnInflight = p;
  try { return await p; } finally { if (_spawnInflight === p) _spawnInflight = null; }
}

async function _spawnClaudeImpl(proxyPort, cwd, extraArgs = [], claudePath = null, isNpmVersion = false, serverPort = null, serverProtocol = 'http', internalToken = null) {
  const pty = await getPty();

  fixSpawnHelperPermissions();

  // 如果没有提供 claudePath，尝试自动查找
  if (!claudePath) {
    claudePath = resolveNativePath();
    if (!claudePath) {
      throw new Error('claude not found');
    }
  }

  const env = { ...process.env };
  env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${proxyPort}`;
  env.CCV_PROXY_MODE = '1'; // 告诉 interceptor.js 不要再启动 server
  env.CCV_LOG_DIR = LOG_DIR; // 让 fork 出的 Claude Code 进程找到同一份 profile.json 等资源
  // 剥离 cc-viewer 的内部短路开关，避免泄漏给 claude 子进程
  delete env.CCV_SKIP_THINKING_DISPLAY;
  // Claude Code NO_FLICKER 会让嵌入式 xterm 走 alt-screen 并丢失 scrollback。
  // cc-viewer 默认剥离继承值；确实需要时可显式设 CCV_KEEP_CLAUDE_CODE_NO_FLICKER=1。
  stripClaudeNoFlickerUnlessOptedIn(env);
  // 新版 Claude Code 默认全屏渲染(整屏原地重绘)→ 终端只剩一屏、上滚不到历史。
  // cc-viewer 默认注入 CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1 让 claude 回经典流式渲染、终端可滚历史;
  // 想保留全屏无闪烁渲染的用户设 CCV_KEEP_CLAUDE_FULLSCREEN=1 opt-out。
  applyClaudeAltScreenPref(env);

  // Resolve real Node.js path (Electron's process.execPath is the Electron binary)
  let nodePath = process.execPath;
  if (process.versions.electron) {
    const { execSync } = await import('node:child_process');
    try {
      nodePath = execSync(process.platform === 'win32' ? 'where node' : 'which node', { encoding: 'utf-8', windowsHide: true }).trim();
      if (process.platform === 'win32') nodePath = nodePath.split('\n')[0].trim();
    } catch {
      nodePath = process.platform === 'win32' ? 'node' : '/usr/local/bin/node';
    }
  }

  // Override EDITOR/VISUAL to use built-in FileContentView
  if (serverPort) {
    const editorScript = join(__dirname, 'lib', 'ccv-editor.js');
    env.EDITOR = `${nodePath} ${editorScript}`;
    env.VISUAL = env.EDITOR;
    env.CCV_EDITOR_PORT = String(serverPort);
    env.CCVIEWER_PORT = String(serverPort); // For ask-hook bridge
    env.CCVIEWER_PROTOCOL = serverProtocol; // For ask/perm-bridge (http vs https)
    if (internalToken) {
      // Anti-CSRF token for bridge → server calls (round-3 P1). Same shared
      // secret across ask / perm / turn-end bridges so server can route-check
      // header `X-CCViewer-Internal`. Loopback-only by design.
      env.CCVIEWER_INTERNAL_TOKEN = internalToken;
    }
  }

  // 禁用 Claude Code CLI 的鼠标事件捕获，保住 xterm 面板原生文本选中（复制粘贴）。
  // 不设时 Claude 会启 SGR mouse tracking (DECSET ?1000/1006)，抢走 xterm 的鼠标事件。
  // ??= 尊重用户显式 export（比如调试时想看 mouse event）。
  env.CLAUDE_CODE_DISABLE_MOUSE ??= '1';

  // 通过 --settings 注入 ANTHROPIC_BASE_URL，确保覆盖 settings.json 中的配置。
  // 仅覆盖 env.ANTHROPIC_BASE_URL，不影响其他 settings 字段。
  const settingsObj = {
    env: {
      ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL
    }
  };
  // IM worker（skip-permissions）注入 permissions.deny 作为第二道防御（见 plan §安全 3）。
  // 仅追加 deny 规则（deny 优先级最高、只会收紧不会放宽），不会破坏用户既有 permissions。
  // 注：bypass 模式下 deny 是否仍被消费取决于 Claude Code 行为；真正可靠的强制层是
  // perm-bridge.js 的 PreToolUse deny（CCV_IM_DENY）。此处为纵深防御的 best-effort 一层。
  if (process.env.CCV_IM_DENY === '1') {
    const home = homedir();
    settingsObj.permissions = {
      deny: [
        'Bash(sudo:*)', 'Bash(rm -rf:*)', 'Bash(rm -fr:*)',
        'Bash(git push:*)', 'Bash(npm publish:*)', 'Bash(ssh:*)', 'Bash(scp:*)',
        `Read(${home}/.ssh/**)`, `Edit(${home}/.ssh/**)`, `Write(${home}/.ssh/**)`,
        `Read(${home}/.aws/**)`, `Edit(${home}/.aws/**)`, `Write(${home}/.aws/**)`,
        // 精确到文件：保护 deny 机制本身(settings/hooks)与 IM 密钥库(preferences.json)，
        // 但不封禁整个 ~/.claude —— worker 的工作目录就在 ~/.claude/cc-viewer/IM_<id>/ 下，需保持可写。
        `Edit(${home}/.claude/settings.json)`, `Write(${home}/.claude/settings.json)`,
        `Edit(${home}/.claude/settings.local.json)`, `Write(${home}/.claude/settings.local.json)`,
        `Edit(${home}/.claude/cc-viewer/preferences.json)`, `Write(${home}/.claude/cc-viewer/preferences.json)`,
      ],
    };
  }
  const settingsJson = JSON.stringify(settingsObj);

  // 注入 --thinking-display summarized；以下任一情况跳过注入：
  // - 路径在拒绝集里（上次因此 crash 过）
  // - 环境变量 CCV_SKIP_THINKING_DISPLAY=1（用户全局 opt-out，与 cli.js 保持一致）
  const shouldInjectThinkingDisplay = !_thinkingDisplayRejectedPaths.has(claudePath)
    && process.env.CCV_SKIP_THINKING_DISPLAY !== '1';
  const finalExtraArgs = shouldInjectThinkingDisplay ? withDefaultThinkingDisplay(extraArgs) : extraArgs;

  // 启动目录存在 CC_SYSTEM.md / CC_APPEND_SYSTEM.md(非空)时，自动追加
  // --system-prompt-file / --append-system-prompt-file(两者独立、用户已传同义 flag 时跳过对应项)。
  // 模型定制：以「上次启动所用模型」在 <cwd>/system_prompt/ 与 <LOG_DIR>/system_prompt/
  // 里模糊匹配，命中的条目整体取代上面两份默认 sentinel。
  // 注：currentWorkspacePath 在下方才赋值，这里用 cwd 参数判定启动目录。
  // LOG_DIR 内的 spawn(IM worker 工作目录 = <LOG_DIR>/IM_<id>/)跳过模型匹配：
  // IM 人格依赖默认 sentinel CC_APPEND_SYSTEM.md 注入，全局模型条目不得静默取代它。
  //
  // 整个 system prompt 构建 + 渲染管道包在 try-catch 里：任何意外抛错（含 readClaudeProjectModel
  // JSON 解析、buildSystemPromptFileArgs 文件系统竞态、renderSystemPromptFileArgs 的
  // createSystemPromptVariables git 子进程异常）都走兜底——当没命中任何条目，launch 不带
  // --system-prompt-file/--append-system-prompt-file，claude 用自身默认 system prompt 启动。
  let sysPrompt;
  try {
    const spawnDir = cwd || process.cwd();
    const insideLogDir = spawnDir === LOG_DIR || spawnDir.startsWith(LOG_DIR + sep);
    const resolvedModelId = insideLogDir ? null : _spawnModelReader(spawnDir);
    sysPrompt = buildSystemPromptFileArgs(spawnDir, finalExtraArgs, process.env, {
      modelId: resolvedModelId,
      globalModelDir: join(LOG_DIR, MODEL_PROMPT_DIR),
    });
    if (_systemPromptFileRejectedPaths.has(claudePath)) {
      sysPrompt = { args: [], loaded: [], model: null };
    } else if (resolvedModelId && !sysPrompt.model && !sysPrompt.suppressed
      && (existsSync(join(spawnDir, MODEL_PROMPT_DIR)) || existsSync(join(LOG_DIR, MODEL_PROMPT_DIR)))) {
      // The one diagnostic case worth a warning: a system_prompt dir is configured
      // but the resolved model matched no entry (likely a misnamed file). Intentional
      // skips (CCV_DISABLE_AUTO_SYSTEM_PROMPT=1, or a manual --system-prompt flag
      // suppressing a matched entry) carry `suppressed` and stay quiet. The
      // successful-injection notice is emitted below via emitSpawnNotice (with
      // internal-restart suppression); no-modelId spawns are the normal quiet path.
      console.warn(`[CC Viewer] model-specific prompt: modelId="${resolvedModelId}" resolved but no matching entry found in workspace or global ${MODEL_PROMPT_DIR}/`);
    }
    // Resolve `${...}` template variables in the injected files (editor stores them literal —
    // the substitution documented by the editor's parameter reference happens here, at launch).
    sysPrompt = renderSystemPromptFileArgs(sysPrompt, { cwd: spawnDir, modelId: resolvedModelId });
  } catch (err) {
    console.warn(`[CC Viewer] system prompt build/render failed, launching without injected prompt:`, err?.message || err);
    sysPrompt = { args: [], loaded: [], model: null };
  }
  const launchArgs = sysPrompt.args.length ? [...finalExtraArgs, ...sysPrompt.args] : finalExtraArgs;

  let command = claudePath;
  let args = ['--settings', settingsJson, ...launchArgs];

  // 如果是 npm 版本（cli.js），需要使用 node 来运行
  if (isNpmVersion && claudePath.endsWith('.js')) {
    command = nodePath;
    args = [claudePath, '--settings', settingsJson, ...launchArgs];
  }

  lastExitCode = null;
  outputBuffer = '';
  currentWorkspacePath = cwd || process.cwd();
  lastWorkspacePath = currentWorkspacePath;

  ptyProcess = pty.spawn(command, args, {
    name: 'xterm-256color',
    cols: lastPtyCols,
    rows: lastPtyRows,
    cwd: currentWorkspacePath,
    env,
  });
  ptyKind = 'claude';
  // --allow-dangerously-skip-permissions only enables a later toggle, so it must NOT count.
  ptySkipPermissions = extraArgs.includes('--dangerously-skip-permissions');

  // 注入了 system prompt 文件时向终端打印一行提示(可见性/安全)；内部重启已抑制以免重复。
  if (sysPrompt.loaded.length && !_suppressNextSpawnNotice) {
    const modelSuffix = sysPrompt.model ? ` (model match: ${sysPrompt.model})` : '';
    emitSpawnNotice(`[CC Viewer] loaded ${sysPrompt.loaded.join(', ')} as system prompt${modelSuffix}`);
  }
  _suppressNextSpawnNotice = false;

  ptyProcess.onData((data) => {
    outputBuffer += data;
    if (outputBuffer.length > MAX_BUFFER) {
      const rawStart = outputBuffer.length - BUFFER_TRIM_TO;
      const safeStart = findSafeSliceStart(outputBuffer, rawStart);
      outputBuffer = outputBuffer.slice(safeStart);
    }
    batchBuffer += data;
    if (!batchScheduled) {
      batchScheduled = true;
      setImmediate(flushBatch);
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    flushBatch(true);
    lastExitCode = exitCode;
    ptyProcess = null;
    ptyKind = null;
    ptySkipPermissions = false;

    // Auto-retry without -c/--continue if "No conversation found"
    // 注意：早退 return 会跳过下方的 exitListeners 广播——第一次失败的 pty 死亡对消费者
    // 是透明的。新 pty 正常启动后自己会上报 state/exit。这样避免前端看到一次假的退出事件。
    const hasContinue = extraArgs.includes('-c') || extraArgs.includes('--continue');
    if (hasContinue && exitCode !== 0 && outputBuffer.includes('No conversation found')) {
      console.error('[CC Viewer] -c failed (no conversation), retrying without -c');
      const retryArgs = extraArgs.filter(a => a !== '-c' && a !== '--continue');
      _suppressNextSpawnNotice = true;
      spawnClaude(proxyPort, cwd, retryArgs, claudePath, isNpmVersion, serverPort, serverProtocol, internalToken);
      return;
    }

    // 事后兜底：如果我们注入了 --thinking-display 且 claude 以 "unknown option" 崩溃，
    // 把该 claudePath 加入拒绝集并去掉 flag 重启一次——老版 claude / 三方 CLI fork / GLM wrapper 由此自愈。
    // 只在「我们注入的」场景触发：extraArgs 没有 flag 但 finalExtraArgs 有 → 说明是注入的；
    // 用户自己传了 --thinking-display 崩溃则不动，避免覆盖用户意图。
    // 和 -c 重试一致，早退 return 跳过 exitListeners 广播，让第一次假失败对消费者透明。
    const weInjectedFlag = shouldInjectThinkingDisplay
      && !extraArgs.some(a => a === '--thinking-display' || (typeof a === 'string' && a.startsWith('--thinking-display=')));
    const flagRejected = weInjectedFlag && exitCode !== 0
      && /unknown option ['"]--thinking-display/i.test(outputBuffer);
    if (flagRejected) {
      console.error('[CC Viewer] claude rejected --thinking-display, marking as unsupported and retrying without flag');
      _thinkingDisplayRejectedPaths.add(claudePath);
      _suppressNextSpawnNotice = true;
      spawnClaude(proxyPort, cwd, extraArgs, claudePath, isNpmVersion, serverPort, serverProtocol, internalToken);
      return;
    }

    // 事后兜底：claude(或三方 fork/wrapper)不识别 --system-prompt-file/--append-system-prompt-file 而崩溃时，
    // 记下该 claudePath、跳过注入并重启一次，避免自动注入把会话拖崩(对齐上面的 --thinking-display 自愈)。
    const sysFileRejected = sysPrompt.loaded.length > 0 && exitCode !== 0
      && /unknown option ['"]--(append-)?system-prompt-file/i.test(outputBuffer);
    if (sysFileRejected) {
      console.error('[CC Viewer] claude rejected --system-prompt-file, skipping CC_SYSTEM.md/CC_APPEND_SYSTEM.md and retrying');
      _systemPromptFileRejectedPaths.add(claudePath);
      _suppressNextSpawnNotice = true;
      spawnClaude(proxyPort, cwd, extraArgs, claudePath, isNpmVersion, serverPort, serverProtocol, internalToken);
      return;
    }

    // 保留 lastWorkspacePath，不清除，用于 respawn
    currentWorkspacePath = null;
    for (const cb of exitListeners) {
      try { cb(exitCode); } catch { }
    }
  });

  return ptyProcess;
}

export function writeToPty(data) {
  if (ptyProcess) {
    ptyProcess.write(data);
    return true;
  }
  return false;
}

/**
 * Send chunks sequentially to PTY, waiting for PTY output between each.
 * Designed for programmatic input (multi-select, paste, etc.) where
 * the target application (e.g. inquirer) needs time to process each chunk.
 * @param {string[]} chunks - array of input strings to send in order
 * @param {Function} [onComplete] - called when all chunks are sent or on error
 * @param {object} [opts] - { timeoutMs: per-chunk timeout (default 4000), settleMs: delay after ACK (default 150) }
 */
export function writeToPtySequential(chunks, onComplete, opts = {}) {
  const timeoutMs = opts.timeoutMs || 4000;
  const settleMs = opts.settleMs || 150;

  if (!ptyProcess || !chunks || chunks.length === 0) {
    if (onComplete) onComplete(false);
    return;
  }

  let idx = 0;
  let dataListener = null;

  const cleanup = () => {
    if (dataListener) {
      dataListeners = dataListeners.filter(l => l !== dataListener);
      dataListener = null;
    }
  };

  const sendNext = () => {
    if (idx >= chunks.length || !ptyProcess) {
      cleanup();
      // Report success only if every chunk was sent. A PTY that died mid-sequence (idx <
      // length) is a partial/failed injection — callers (e.g. the DingTalk bridge) must learn
      // this to avoid wedging on a turn that will never produce output.
      if (onComplete) onComplete(idx >= chunks.length);
      return;
    }

    const chunk = chunks[idx];
    idx++;

    // 防御性纵深（server.js 入口已 every(string) 校验，这里是第二道）：非字符串 chunk 的
    // pty.write 抛 ERR_INVALID_ARG_TYPE、下方 chunk.endsWith 也抛——在 setTimeout 上下文中
    // 脱离任何 try/catch 会变成 uncaughtException 打挂整个进程。统一拦成失败上报。
    if (typeof chunk !== 'string') {
      cleanup();
      if (onComplete) onComplete(false);
      return;
    }
    try {
      ptyProcess.write(chunk);
    } catch (e) {
      cleanup();
      if (onComplete) onComplete(false);
      return;
    }

    // Space, Enter, arrows need more time for inquirer to re-render
    const isToggleOrSubmit = chunk === ' ' || chunk === '\r'
      || chunk === '\x1b[C' || chunk === '\x1b[A' || chunk === '\x1b[B';
    // Bracket-paste end needs a frame for Ink to settle paste→normal state.
    const isPasteEnd = chunk.endsWith('\x1b[201~');
    const delay = (isToggleOrSubmit || isPasteEnd) ? settleMs : 80;
    setTimeout(sendNext, delay);
  };

  sendNext();
}

/**
 * 进程退出后，自动 spawn 一个交互式 shell，让终端恢复可用。
 * 返回 true 表示成功 spawn，false 表示无需或失败。
 */
export async function spawnShell() {
  if (ptyProcess) return false; // 已有进程在运行
  if (_spawnInflight) return _spawnInflight; // 复用在途 spawn，防双开
  const p = _spawnShellImpl();
  _spawnInflight = p;
  try { return await p; } finally { if (_spawnInflight === p) _spawnInflight = null; }
}

async function _spawnShellImpl() {
  const cwd = lastWorkspacePath || process.cwd();

  const pty = await getPty();

  fixSpawnHelperPermissions();

  const shell = process.env.SHELL || (process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh');

  lastExitCode = null;
  currentWorkspacePath = cwd;

  // Clean env: remove cc-viewer specific vars so child shells don't inherit them
  // (prevents CCVIEWER_PORT/CCVIEWER_PROTOCOL leaking to non-cc-viewer Claude instances;
  // 115c48b 加入 CCVIEWER_PROTOCOL 但只更新 spawnClaude，此处对齐)
  const shellEnv = { ...process.env };
  delete shellEnv.CCVIEWER_PORT;
  delete shellEnv.CCV_EDITOR_PORT;
  delete shellEnv.CCVIEWER_PROTOCOL;
  delete shellEnv.CCVIEWER_INTERNAL_TOKEN;
  // 交互 shell 里手动敲 claude 时也禁鼠标，理由同 spawnClaude。
  shellEnv.CLAUDE_CODE_DISABLE_MOUSE ??= '1';
  // 默认让 shell 内手敲的 claude 也回到经典流式渲染(终端可滚历史)，理由同 spawnClaude;
  // CCV_KEEP_CLAUDE_FULLSCREEN=1 可 opt-out。
  applyClaudeAltScreenPref(shellEnv);
  const shellSpawn = prepareEmbeddedShellSpawn(shell, shellEnv);

  ptyProcess = pty.spawn(shellSpawn.command, shellSpawn.args, {
    name: 'xterm-256color',
    cols: lastPtyCols,
    rows: lastPtyRows,
    cwd,
    env: shellSpawn.env,
  });
  ptyKind = 'shell';
  ptySkipPermissions = false;

  ptyProcess.onData((data) => {
    outputBuffer += data;
    if (outputBuffer.length > MAX_BUFFER) {
      const rawStart = outputBuffer.length - BUFFER_TRIM_TO;
      const safeStart = findSafeSliceStart(outputBuffer, rawStart);
      outputBuffer = outputBuffer.slice(safeStart);
    }
    batchBuffer += data;
    if (!batchScheduled) {
      batchScheduled = true;
      setImmediate(flushBatch);
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    flushBatch(true);
    lastExitCode = exitCode;
    ptyProcess = null;
    ptyKind = null;
    ptySkipPermissions = false;
    currentWorkspacePath = null;
    for (const cb of exitListeners) {
      try { cb(exitCode); } catch { }
    }
  });

  return true;
}

// cols/rows 钳制为有限正整数：FitAddon 在 0 尺寸容器会算出 2×1，畸形客户端可能发
// NaN/0/负数——未校验直接存进 lastPtyCols/Rows 会毒化后续 pty.spawn（cols:NaN 抛错，
// spawnShell 的异常被吞 → 终端永远拉不起且无日志）。非有限值回退到上一个有效值。
function _clampDim(v, min, max, fallback) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function resizePty(cols, rows) {
  lastPtyCols = _clampDim(cols, PTY_COLS_MIN, PTY_COLS_MAX, lastPtyCols);
  lastPtyRows = _clampDim(rows, PTY_ROWS_MIN, PTY_ROWS_MAX, lastPtyRows);
  if (ptyProcess) {
    try { ptyProcess.resize(lastPtyCols, lastPtyRows); } catch { }
  }
}

export function killPty() {
  if (ptyProcess) {
    flushBatch(true);
    batchBuffer = '';
    batchScheduled = false;
    // Windows：node-pty 的 ConPTY kill 有已知同步挂起问题（microsoft/node-pty#454），
    // 挂住会连 Ctrl+C 退出链的 watchdog 一起废掉。改用 spawnSync taskkill /T /F 收割
    // 整棵进程树（ConPTY agent + claude），有界（timeout 2s）且提供"返回时已死"语义
    // （spawnClaude 内部 kill→respawn、workspaces stop→launch 依赖这一点）。
    // win32 下完全跳过 ptyProcess.kill()。非 Windows 行为不变。
    if (!killPtyTree(ptyProcess.pid)) {
      try { ptyProcess.kill(); } catch { }
    }
    ptyProcess = null;
    ptyKind = null;
    ptySkipPermissions = false;
  }
}

export function onPtyData(cb) {
  dataListeners.push(cb);
  return () => {
    dataListeners = dataListeners.filter(l => l !== cb);
  };
}

export function onPtyExit(cb) {
  exitListeners.push(cb);
  return () => {
    exitListeners = exitListeners.filter(l => l !== cb);
  };
}

export function getPtyPid() {
  return ptyProcess ? ptyProcess.pid : null;
}

export function getPtyState() {
  return {
    running: !!ptyProcess,
    exitCode: lastExitCode,
  };
}

/** Kind of the active PTY: 'claude' | 'shell' | null. */
export function getPtyKind() {
  return ptyKind;
}

/** True iff the active Claude session was launched with --dangerously-skip-permissions. */
export function getPtySkipPermissions() {
  return ptyKind === 'claude' && ptySkipPermissions;
}

export function getCurrentWorkspace() {
  return {
    running: !!ptyProcess,
    exitCode: lastExitCode,
    cwd: currentWorkspacePath,
  };
}

export function getOutputBuffer() {
  return outputBuffer;
}
