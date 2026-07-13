// LLM Request Interceptor
// 拦截并记录所有Claude API请求
// Wire format 协议详见 docs/WIRE_FORMAT.md（mainAgent entry 形态 / 关键字段 / 信号链路）

// 非交互命令（如 claude -v, claude --help）不需要启动 ccv
const _ccvSkipArgs = ['--version', '-v', '--v', '--help', '-h', 'doctor', 'install', 'update', 'upgrade', 'auth', 'setup-token', 'agents', 'plugin', 'plugins', 'mcp'];
const _ccvSkip = _ccvSkipArgs.includes(process.argv[2]);

import './lib/proxy-env.js';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, statSync, unlinkSync, existsSync, watchFile, openSync, readSync, closeSync } from 'node:fs';
import { AsyncWriteQueue } from './lib/async-write-queue.js';
import { renameSyncWithRetry } from './lib/file-api.js';
import http from 'node:http';
import https from 'node:https';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { LOG_DIR } from '../findcc.js';
import { assembleStreamMessage, createStreamAssembler, cleanupTempFiles, findRecentLog, claimUntaggedLog, logFilePrefix, isAnthropicApiPath, isMainAgentRequest, rotateLogFile, fingerprintMsg, replaceTopLevelModel, injectOutputConfigEffort, resolveProfileModel, extractAgentSpawnPairs, parseRotationContextHead } from './lib/interceptor-core.js';
import { setRetryConfigPath, loadRetryConfig, DEFAULT_RETRY_CONFIG } from './lib/proxy-retry.js';



const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Live-streaming 用的端口：由 server.js 在 listen 成功后通过 setLivePort 注入。
// 不用 process.env.CCVIEWER_PORT 是为了避免主进程 env 污染被 child_process.spawn
// 继承到 Bash 工具子进程 / MCP server / Electron tab-worker 等无关进程。
let _livePort = null;
let _liveProtocol = 'http';
export function setLivePort(port, protocol) { _livePort = port ? String(port) : null; _liveProtocol = protocol || 'http'; }

// 流式请求的实时状态（供 server.js SSE 推送）
export const streamingState = { active: false, requestId: null, startTime: null, model: null, bytesReceived: 0, chunksReceived: 0 };
export function resetStreamingState() {
  streamingState.active = false;
  streamingState.requestId = null;
  streamingState.startTime = null;
  streamingState.model = null;
  streamingState.bytesReceived = 0;
  streamingState.chunksReceived = 0;
}

// ─── IM 逐字流式的文本源 ───
// 钉钉 AI 卡片流式（server/lib/adapters/dingtalk-adapter.js）需要「对话过程中」的主 agent 增量文本。
// 复用本拦截器对主 agent SSE 的增量解析，累计 text_delta（跳过 thinking_delta，与 im-bridge-core
// 的 extractLastAssistantText「只取 text 块」一致），供 IM bridge 节流推送给钉钉 /card/streaming。
// 关键：按「注入轮次」重置 —— 由 bridge 在 armActiveInjection 时调 resetImLiveText()。**绝不**在
// resetStreamingState() 内重置：带工具的回合中间 streamingState 会 false↔true（每个 Anthropic API
// 调用各一次），那样会把半截回复清空，typewriter 跨工具间隙断流。
// 默认仅 IM worker 进程（CCV_IM_PLATFORM 已设）采集，其它进程零成本、不解析。
let _imLiveText = '';
const _imCaptureEnabled = !!process.env.CCV_IM_PLATFORM;
export function getImLiveText() { return _imLiveText; }
export function resetImLiveText() { _imLiveText = ''; }
// 判定一个 SSE event 是否为可见正文 text_delta（跳过 thinking_delta / 工具入参 / 其它），是则返回其
// 文本片段，否则 null。抽成纯函数：既给下方采集循环复用，也便于单测覆盖「只收 text_delta」规则。
export function imTextDeltaOf(ev) {
  return (ev && ev.type === 'content_block_delta'
    && ev.delta && ev.delta.type === 'text_delta'
    && typeof ev.delta.text === 'string') ? ev.delta.text : null;
}

// 缓存从请求 headers 中提取的 API Key 或 Authorization header
export let _cachedApiKey = null;
export let _cachedAuthHeader = null;
// 缓存从请求 body 中提取的模型名，供翻译接口使用
export let _cachedModel = null;
// 缓存 haiku 模型名（从实际请求中捕获），翻译接口优先使用
export let _cachedHaikuModel = null;

// Proxy profile hot-switch support
// 数据模型：
//   profile.json (全局共享): 仅存 profiles 列表，watchFile 跨 ccv 进程同步 CRUD。
//     兼容老数据：若文件里仍有 active 字段，读为"全局回退默认"；但本模块不再写它。
//   <projectDir>/active-profile.json (每 workspace 独占): 仅存 { activeId }；
//     切换 active 只影响当前 ccv 进程的 workspace，不污染其他实例。
// profile.json 存放在 LOG_DIR 下，受 --log-dir / CCV_LOG_DIR 影响
const PROFILE_PATH = join(LOG_DIR, 'profile.json');
let _activeProfile = null; // { id, name, baseURL?, apiKey?, effort?, ANTHROPIC_MODEL?, ANTHROPIC_DEFAULT_OPUS_MODEL?, ANTHROPIC_DEFAULT_SONNET_MODEL?, ANTHROPIC_DEFAULT_HAIKU_MODEL?, activeModel?(legacy) }

// ── 代理重试配置（运行时热切换，对齐 profile 模式）──
// retry-config.json 存全局共享的重试配置（mode/interval/maxRetries/maxConcurrent 等）。
// env（CCV_PROXY_RETRY_*）仍是启动默认/兜底，文件字段覆盖 env（文件优先）。
// watchFile 1.5s 跨 ccv 进程同步；proxy.js 经 namespace import 读 _retryConfigState live binding。
const RETRY_CONFIG_PATH = join(LOG_DIR, 'retry-config.json');
let _retryConfigState = { ...DEFAULT_RETRY_CONFIG }; // 可变，由 _loadRetryConfigState 刷新

// 把配置文件路径注入 proxy-retry.js（其 resolveRetryConfig 在 fileOverride=true 时读此路径）。
// 在模块加载阶段同步注入，确保后续 _loadRetryConfigState() 调用时路径已就绪。
setRetryConfigPath(RETRY_CONFIG_PATH);

/** 重读 retry-config.json + env 合并，刷新 _retryConfigState（live binding 消费方即取到新值）。 */
function _loadRetryConfigState() {
  try {
    _retryConfigState = loadRetryConfig();
  } catch (err) {
    if (process.env.CCV_DEBUG) console.error('[ccv retry-config] _loadRetryConfigState failed:', err && err.message);
  }
}

// 启动时捕获的原始配置（首次 API 请求时记录，不可变）
let _defaultConfig = null; // { origin, authType, model }

function _getActiveProfileFilePath() {
  // _projectName/_logDir 声明在 ~line 218；本函数只会在这些变量初始化后被调用
  // （_loadProxyProfile 的初始调用与 watchFile 挂载都被挪到 _projectName/_logDir 初始化之后；watchFile 回调、HTTP handler 也都在之后）
  if (!_projectName || !_logDir) return null;
  return join(_logDir, 'active-profile.json');
}

function _readWorkspaceActiveId() {
  const p = _getActiveProfileFilePath();
  if (!p) return null;
  try {
    if (existsSync(p)) {
      const data = JSON.parse(readFileSync(p, 'utf-8'));
      return typeof data?.activeId === 'string' ? data.activeId : null;
    }
  } catch { }
  return null;
}

function _writeWorkspaceActiveId(activeId) {
  const p = _getActiveProfileFilePath();
  if (!p) {
    // 诊断用：能把"为什么 workspace 路径不可用"暴露到启动 ccv 的终端
    console.error('[ccv proxy-profile] skip workspace write: ' +
      `_projectName="${_projectName}" _logDir="${_logDir}" (both required)`);
    return false;
  }
  try {
    mkdirSync(dirname(p), { recursive: true });
    const payload = { activeId: (activeId && typeof activeId === 'string') ? activeId : 'max' };
    writeFileSync(p, JSON.stringify(payload, null, 2), { mode: 0o600 });
    return true;
  } catch (err) {
    console.error('[ccv proxy-profile] workspace write failed:', p, err && err.message);
    return false;
  }
}

function _loadProxyProfile() {
  try {
    const data = JSON.parse(readFileSync(PROFILE_PATH, 'utf-8'));
    // active 解析优先级：workspace override > profile.json.active (兼容老数据 / 全局回退) > null
    const wsActive = _readWorkspaceActiveId();
    const activeId = wsActive || data.active;
    const active = data.profiles?.find(p => p.id === activeId);
    _activeProfile = (active && active.id !== 'max') ? active : null;
  } catch (err) {
    _activeProfile = null;
    if (process.env.CCV_DEBUG_HOTSWITCH) {
      console.error('[ccv hotswitch] _loadProxyProfile failed:', err && err.message);
    }
  }
}

// 为 server.js::POST /api/proxy-profiles 使用，切换当前 workspace 的 active。
// 同时写两个位置，彼此互为兜底：
//   (1) <logDir>/active-profile.json    —— 每 workspace 独占，读取优先级最高
//   (2) profile.json.active             —— 全局默认，watchFile 跨实例同步；用作
//       UI 在 workspace 文件读失败 / 不存在时的回落，避免"切换后立刻回切"的幽灵 revert
// 回落一致性：其他 ccv 实例如果自己 workspace 文件已存在，_loadProxyProfile 会优先用自己
// 的，不受这里改动影响；只有"从未切过"的实例会跟随最新全局默认（符合直觉）。
// 返回 { workspace: bool, profile: bool } 指示两条路径的落盘结果。
function setActiveProfileForWorkspace(activeId) {
  const normalizedId = (activeId && typeof activeId === 'string') ? activeId : 'max';
  const result = { workspace: false, profile: false };

  // (1) workspace override
  result.workspace = _writeWorkspaceActiveId(normalizedId);

  // (2) profile.json.active —— 幂等更新，老数据兼容 + UI GET 回落兜底
  try {
    const data = existsSync(PROFILE_PATH)
      ? JSON.parse(readFileSync(PROFILE_PATH, 'utf-8'))
      : { profiles: [{ id: 'max', name: 'Default' }] };
    if (data.active !== normalizedId) {
      data.active = normalizedId;
      mkdirSync(dirname(PROFILE_PATH), { recursive: true });
      writeFileSync(PROFILE_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
    }
    result.profile = true;
  } catch { /* 双失败场景下 result 全 false，由调用方自行兜底 */ }

  _loadProxyProfile(); // 立刻刷新本进程 _activeProfile
  return result;
}

function getActiveProfileId() {
  // UI 需要知道当前 workspace 的 active（优先 workspace 文件，回退 profile.json.active）
  const ws = _readWorkspaceActiveId();
  if (ws) return ws;
  try {
    const data = JSON.parse(readFileSync(PROFILE_PATH, 'utf-8'));
    return data.active || 'max';
  } catch { return 'max'; }
}

// _loadProxyProfile 的初始调用 + watchFile 挂载挪到 _projectName/_logDir 初始化之后
// （见 "初始化日志文件路径" 段后的 _loadProxyProfile() + watchFile(PROFILE_PATH, …) 挂载），避免 TDZ。

// 纯函数：把 headers 里任意大小写的 authorization / x-api-key 替换为 profile 的 apiKey；
// 两者都不存在时强制植入 x-api-key（第三方代理最常见的鉴权形式）。
// 返回 { headers, matchedAuthKey, matchedXApiKey }，诊断日志据此判断是否真正写入。
function _replaceProxyAuthHeaders(headers, apiKey) {
  const newHeaders = { ...headers };
  let matchedAuthKey = null, matchedXApiKey = null;
  for (const k of Object.keys(newHeaders)) {
    const lk = k.toLowerCase();
    if (lk === 'authorization') matchedAuthKey = k;
    else if (lk === 'x-api-key') matchedXApiKey = k;
  }
  if (matchedAuthKey) newHeaders[matchedAuthKey] = `Bearer ${apiKey}`;
  if (matchedXApiKey) newHeaders[matchedXApiKey] = apiKey;
  if (!matchedAuthKey && !matchedXApiKey) newHeaders['x-api-key'] = apiKey;
  return { headers: newHeaders, matchedAuthKey, matchedXApiKey };
}

export { _activeProfile, _defaultConfig, _loadProxyProfile, PROFILE_PATH, setActiveProfileForWorkspace, getActiveProfileId, RETRY_CONFIG_PATH, _retryConfigState, _loadRetryConfigState };

// 生成新的日志文件路径
function generateNewLogFilePath() {
  const now = new Date();
  const ts = now.getFullYear().toString()
    + String(now.getMonth() + 1).padStart(2, '0')
    + String(now.getDate()).padStart(2, '0')
    + '_'
    + String(now.getHours()).padStart(2, '0')
    + String(now.getMinutes()).padStart(2, '0')
    + String(now.getSeconds()).padStart(2, '0');
  let cwd;
  try { cwd = process.cwd(); } catch { cwd = homedir(); }
  const projectName = basename(cwd).replace(/[^a-zA-Z0-9_\-\.]/g, '_');
  const dir = join(LOG_DIR, projectName);
  try { mkdirSync(dir, { recursive: true }); } catch { }
  // `--pid`(CCV_INSTANCE_ID) 实例：文件名前缀 `<pid>__`，让每个实例只读/续自己的日志血脉（多进程隔离）。
  // 内部读 env（与上面内部读 cwd 同理）→ 轮转/workspace 等所有 caller 自动带前缀，无需逐处传参。
  // 前缀走单一来源 logFilePrefix（与 matcher 共用，防漂移）。
  const instanceId = process.env.CCV_INSTANCE_ID || '';
  return { filePath: join(dir, `${logFilePrefix(projectName, instanceId)}${ts}.jsonl`), dir, projectName };
}

// Resume 状态（供 server.js 使用）
let _resumeState = null;
let _resolveChoice = null;
const _choicePromise = new Promise(resolve => { _resolveChoice = resolve; });

function resolveResumeChoice(choice) {
  if (!_resumeState) return;
  const { recentFile, tempFile } = _resumeState;
  try {
    if (choice === 'continue') {
      // 将临时文件内容追加到旧日志
      if (existsSync(tempFile)) {
        const tempContent = readFileSync(tempFile, 'utf-8');
        if (tempContent.trim()) {
          appendFileSync(recentFile, tempContent);
        }
        unlinkSync(tempFile);
      }
      LOG_FILE = recentFile;
      seedSpawnRegistryFromLogHead(LOG_FILE);
    } else {
      // new: 将临时文件 rename 为正式新日志文件名（空文件直接删除）
      const newPath = tempFile.replace('_temp.jsonl', '.jsonl');
      if (existsSync(tempFile)) {
        const sz = statSync(tempFile).size;
        if (sz > 0) {
          renameSyncWithRetry(tempFile, newPath);
        } else {
          try { unlinkSync(tempFile); } catch { }
        }
      }
      LOG_FILE = newPath;
    }
  } catch (err) {
    console.error('[CC Viewer] resolveResumeChoice error:', err);
  }
  const result = { logFile: LOG_FILE };
  _resumeState = null;
  _resolveChoice(result);
  return result;
}

// Delta storage: 增量存储开关和状态（默认开启，设置 CCV_DISABLE_DELTA=1 关闭）
// 注意：delta 计算原本依赖 mainAgent 请求串行假设。实证发现 teammate 终止 / 多 SSE 通道
// 注入等情况会让两条 mainAgent 请求 30ms 内连续到达（前一条流式响应未完成时后一条已发起），
// 导致仅在 completed 时更新 _lastMessagesCount/_lastTailFp 出现状态滞后 → Plan C 漏检。
const _deltaStorageEnabled = process.env.CCV_DISABLE_DELTA !== '1';
// In-place last-msg replace 检测开关（默认开启，设置 CCV_DISABLE_TAIL_FP_CHECKPOINT=1 关闭）。
// 关闭后回退到旧行为（仅按长度算 delta，遇到末位原地替换会丢失"末位换内容"信息）。
const _tailFpCheckEnabled = process.env.CCV_DISABLE_TAIL_FP_CHECKPOINT !== '1';
// 这两个变量代表"截至本次请求开始前的最新已知态"。请求开始处理时即同步更新（eager），
// 不再等到 _commitDeltaState（completed 时执行）。Plan C 检测使用进入函数前的快照。
// 异常分支（请求失败 / 服务端不发送）不会回滚——下一个成功请求覆盖即可，状态不会永久错位。
// 命名说明：变量名保留 `_last` 前缀（历史命名），但语义已由"上次 commit 后"变为"上次见到的最新态"。
// 三路并发场景下，连续 3 个请求若 length 非单调（如 257→259→258），_lastMessagesCount 会跟随
// 最新一次 startRequest，可能让早到的更大值被覆盖；这种情况 Plan C 走 length 不等支路最终
// 命中 needsCheckpoint 写完整快照，client 拿到正确数据，不破坏正确性。
let _lastMessagesCount = 0;     // 截至最近一次 startRequest 的完整 messages 数量（eager-updated）
let _lastTailFp = '';           // 截至最近一次 startRequest 的末位 message 指纹（eager-updated）
let _mainAgentDeltaCount = 0;   // mainAgent 请求计数器（用于触发定期 checkpoint）
const CHECKPOINT_INTERVAL = 10; // 每 N 条 mainAgent 请求写一个 checkpoint

// 完成序倒置守卫（KEEP IN SYNC: server/lib/delta-reconstructor.js + docs/WIRE_FORMAT.md §3.7）：
// entry 形态在请求发起时冻结，但 completed entry 按响应完成顺序落盘（AsyncWriteQueue FIFO）。
// burst 下慢请求的条目会落在快请求之后，文件序 ≠ 请求序，重建器按文件序拼接会翻倍。
// `_seq` 记录请求发起序（语义序），`_seqEpoch` 标识写进程（重启 / 多进程混写时 seq 不可比，
// 重建器据 epoch 切换基线而不是误判乱序）。teammate 子进程不参与（其条目不进 mainAgent 重建）。
let _seqCounter = 0;
// 时间戳 + 6 位随机尾：随机尾用于区分同毫秒启动的第二写进程（IM worker 场景）
const _seqEpoch = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Delta storage: completed 写入成功后更新状态。
 *
 * 幂等守卫（`originalLength > _lastMessagesCount`）：eager-update 已在请求开始时把
 * _lastMessagesCount/_lastTailFp 推到本次值；本函数对同 originalLength 的 commit no-op，
 * 且必须严格大于才更新——防止两条 mainAgent 请求乱序完成时，先到的较短 commit 把
 * 已被 eager 推高的状态倒推回去（A 流式数秒、B 短先 commit、A 后 commit 时 _lastMessagesCount
 * 与 _lastTailFp 都会被 A.length/fp 覆盖，下条 C 拿陈旧 prev → Plan C 漏/误检 → doubled-history
 * 残余）。等长情况下也不动 fp：等长 in-place replace 的 _lastTailFp 已被 eager 推到 latest 值，
 * commit 倒推会让下条请求的 Plan C 误判 in-place。
 *
 * 作用域纠正（不是真的兜底）：本函数与 eager 块共享 "可写入" 前置条件——caller 传
 * `_deltaOriginalMessagesLength`，该值只有在 `_deltaStorageEnabled && mainAgent &&
 * Array.isArray(messages) && messages.length>0` 时才非 0；其它分支传 0 进来这里就
 * short-circuit。即 `_deltaStorageEnabled=false / messages 非数组` 等 eager 跳过的分支
 * 本函数同样跳过，不能视作异常路径的兜底。保留本函数是为了首次启动 / 定期 checkpoint
 * 后的快路径回写（与 eager 等价但解耦 commit 时序），让未来 eager 块若重构调用顺序时
 * commit 仍能把状态推上去。请求失败 / 服务端不发送时永远不调本函数；状态由 eager 残留，
 * 下个成功请求覆盖即可，不会永久错位。
 */
function _commitDeltaState(originalLength, originalTailFp) {
  if (_deltaStorageEnabled && originalLength > 0 && originalLength > _lastMessagesCount) {
    _lastMessagesCount = originalLength;
    if (typeof originalTailFp === 'string') {
      _lastTailFp = originalTailFp;
    }
  }
}

// Teammate 子进程检测：--parent-session-id（旧模式）或 --agent-name（原生 team 模式）
const _isTeammate = process.argv.includes('--parent-session-id') || process.argv.includes('--agent-name');
// 提取 teammate 元数据（--agent-name worker-1 --team-name fix-ts-errors）
let _teammateName = null;
let _teamName = null;
{
  const args = process.argv;
  const nameIdx = args.indexOf('--agent-name');
  if (nameIdx !== -1 && nameIdx + 1 < args.length) _teammateName = args[nameIdx + 1];
  const teamIdx = args.indexOf('--team-name');
  if (teamIdx !== -1 && teamIdx + 1 < args.length) _teamName = args[teamIdx + 1];
}

// `--pid` 实例 id（cli.js 在 import server 前已设 env，时序安全）。null = 默认模式（不分实例）。
// 只用于日志文件名的分实例隔离（findRecentLog/cleanupTempFiles/claim）；不影响 claude 自己的 -c。
const INSTANCE_ID = process.env.CCV_INSTANCE_ID || null;

// 初始化日志文件路径（异步，支持用户交互）
// 工作区模式下延迟到选择工作区后再初始化
let _newLogFile, _logDir, _projectName;
if (process.env.CCV_WORKSPACE_MODE === '1') {
  _newLogFile = '';
  _logDir = '';
  _projectName = '';
} else if (_isTeammate) {
  // Teammate 子进程：只需 projectName 和 logDir 来查找 leader 日志，不生成新文件路径
  let cwd;
  try { cwd = process.cwd(); } catch { cwd = homedir(); }
  _projectName = basename(cwd).replace(/[^a-zA-Z0-9_\-\.]/g, '_');
  _logDir = join(LOG_DIR, _projectName);
  // teammate 子进程继承同一 env（含 CCV_INSTANCE_ID）→ 命中 leader 的 pid 日志；无 env 时为 null = 现状。
  const _leaderLog = findRecentLog(_logDir, _projectName, INSTANCE_ID);
  _newLogFile = _leaderLog || ''; // 没有 leader 日志时不写入
} else {
  ({ filePath: _newLogFile, dir: _logDir, projectName: _projectName } = generateNewLogFilePath());
  // 启动时清理残留临时文件（按本实例收窄，避免多进程下 rename 掉别的实例正在写的 _temp）
  cleanupTempFiles(_logDir, _projectName, INSTANCE_ID);
}
let LOG_FILE = _newLogFile;

// 异步写入队列 — 替代 appendFileSync，避免阻塞事件循环（Windows NTFS 尤为严重）
const _writeQueue = new AsyncWriteQueue(() => LOG_FILE);

// 现在 _projectName/_logDir 已初始化，可以安全加载 proxy profile（含 workspace override）
// 并挂载 watchFile 同步列表变化。
_loadProxyProfile();
try { watchFile(PROFILE_PATH, { interval: 1500 }, _loadProxyProfile); } catch { }

// 代理重试配置：首次加载 + watchFile 跨进程同步（UI 改 retry-config.json 后 1.5s 内热刷新）。
_loadRetryConfigState();
try { watchFile(RETRY_CONFIG_PATH, { interval: 1500 }, _loadRetryConfigState); } catch { }

const _initPromise = (async () => {
  if (!_logDir || !_projectName) return; // 工作区模式下跳过
  if (_isTeammate) return; // Teammate 已在上方同步初始化，跳过 async resume 流程
  try {
    let recentLog = findRecentLog(_logDir, _projectName, INSTANCE_ID);
    // 首启接管（仅 --pid 实例）：本 pid 还没有自己的日志时，可接管项目里最近的【无标签】日志
    // （原子 rename 成 `<pid>__…`），从此并入该 pid 血脉。claim 必须在 build _resumeState 之前，
    // 这样 _resumeState.recentFile 指向 rename 后的新路径（否则会指向已被移走的旧名）。
    if (!recentLog && INSTANCE_ID) {
      const claimed = claimUntaggedLog(_logDir, _projectName, INSTANCE_ID);
      if (claimed) recentLog = claimed;
    }
    if (recentLog) {
      // IM worker：无人值守、无 UI 可应答 resume 交互。直接 continue 最近会话日志（保留记忆、
      // 让记录弹窗读到同一份持续增长的文件），不进入 resume 交互状态（否则会一直写 *_temp.jsonl，
      // 仅在干净退出时才 rename，SIGKILL 下丢失）。
      if (process.env.CCV_IM_PLATFORM) {
        LOG_FILE = recentLog;
        seedSpawnRegistryFromLogHead(LOG_FILE);
        return;
      }
      // Leader / 普通进程：走 resume 交互流程
      const tempFile = _newLogFile.replace('.jsonl', '_temp.jsonl');
      LOG_FILE = tempFile;
      _resumeState = {
        recentFile: recentLog,
        recentFileName: basename(recentLog),
        tempFile,
      };
    }
  } catch { }
})();

export { LOG_FILE, _initPromise, _resumeState, _choicePromise, resolveResumeChoice, _projectName, _logDir };

// 工作区模式：动态初始化指定路径的日志文件
// 如果有 1 小时内的最近日志，自动复用（与单目录模式行为一致）
export function initForWorkspace(projectPath, { forceNew = false } = {}) {
  const projectName = basename(projectPath).replace(/[^a-zA-Z0-9_\-\.]/g, '_');
  const dir = join(LOG_DIR, projectName);
  try { mkdirSync(dir, { recursive: true }); } catch {}

  cleanupTempFiles(dir, projectName, INSTANCE_ID);

  // 检查是否有最近的日志文件可以复用（始终复用最新日志）
  // forceNew: Electron multi-tab 模式下强制创建新文件，避免与已有 ccv 实例共享日志
  let recentLog = !forceNew && findRecentLog(dir, projectName, INSTANCE_ID);
  // 首启接管（与单项目模式 _initPromise 一致）：本 pid 在该 workspace 还没有自己的日志时，
  // 接管最近的无标签日志，避免 workspace 模式下 --pid 首启不接管的不一致。forceNew 时显式不接管。
  if (!recentLog && INSTANCE_ID && !forceNew) {
    const claimed = claimUntaggedLog(dir, projectName, INSTANCE_ID);
    if (claimed) recentLog = claimed;
  }
  if (recentLog) {
    _projectName = projectName;
    _logDir = dir;
    LOG_FILE = recentLog;
    // Same lifecycle as the single-project boot paths: start this workspace's
    // registry fresh, then re-seed from the resumed segment's head sentinel so
    // the next rotation's carry-forward stays complete after a restart/switch.
    _agentSpawnRegistry.clear();
    seedSpawnRegistryFromLogHead(LOG_FILE);
    // workspace 切换后，重读该 workspace 的 active-profile.json（可能和上一个 workspace 不同）
    _loadProxyProfile();
    return { filePath: recentLog, dir, projectName, resumed: true };
  }

  // 没有最近日志，创建新文件
  const now = new Date();
  const ts = now.getFullYear().toString()
    + String(now.getMonth() + 1).padStart(2, '0')
    + String(now.getDate()).padStart(2, '0')
    + '_'
    + String(now.getHours()).padStart(2, '0')
    + String(now.getMinutes()).padStart(2, '0')
    + String(now.getSeconds()).padStart(2, '0');

  // 与 generateNewLogFilePath 同款命名（共用 logFilePrefix）：`--pid` 实例带 `<pid>__` 前缀。
  const filePath = join(dir, `${logFilePrefix(projectName, INSTANCE_ID)}${ts}.jsonl`);

  _projectName = projectName;
  _logDir = dir;
  LOG_FILE = filePath;
  // Fresh file for a fresh workspace context — no carried names apply.
  _agentSpawnRegistry.clear();
  _loadProxyProfile(); // 同上

  return { filePath, dir, projectName, resumed: false };
}

// 工作区模式：重置日志状态（返回工作区列表时调用）
export function resetWorkspace() {
  _projectName = '';
  _logDir = '';
  LOG_FILE = '';
  // Workspace context gone: drop carried teammate names — the registry is
  // module-global, and without this a rotation in the NEXT workspace would
  // write a sentinel carrying THIS workspace's names (unbounded growth +
  // cross-workspace leakage into the route's teammateNames snapshot).
  _agentSpawnRegistry.clear();
  _loadProxyProfile(); // workspace 上下文消失，回落到 profile.json.active
}

// Windows NTFS + Defender 下大文件 I/O 代价远高于 Mac/Linux，降低分割阈值减轻压力
const MAX_LOG_SIZE = (process.platform === 'win32' ? 150 : 300) * 1024 * 1024;

// Agent-spawn registry: prompt-prefix(60) → teammate name, accumulated from
// mainAgent responses as they are written. Carried into the next segment via
// the rotation-context sentinel so post-split viewers can still resolve
// teammate names whose spawn turn lives in the previous file. The pure
// extraction/parsing lives in interceptor-core.js (unit-tested there).
const _agentSpawnRegistry = new Map();

function collectAgentSpawns(entry) {
  try {
    if (!entry || !entry.mainAgent) return;
    for (const [prefix, name] of extractAgentSpawnPairs(entry.response?.body)) {
      _agentSpawnRegistry.set(prefix, name);
    }
  } catch { }
}

// Boot re-seed: when resuming an existing log whose FIRST frame is a
// rotation-context sentinel, load its carried names so a restarted leader
// still writes a complete sentinel at the next rotation. Bounded read of the
// file head only — never a whole-segment scan (segments reach 300MB).
function seedSpawnRegistryFromLogHead(file) {
  try {
    if (!file || !existsSync(file)) return;
    const fd = openSync(file, 'r');
    let head;
    try {
      const buf = Buffer.alloc(64 * 1024);
      const n = readSync(fd, buf, 0, buf.length, 0);
      head = buf.toString('utf-8', 0, n);
    } finally {
      closeSync(fd);
    }
    const entry = parseRotationContextHead(head);
    if (!entry || !Array.isArray(entry.teammateNames)) return;
    for (const pair of entry.teammateNames) {
      if (Array.isArray(pair) && pair[0] && pair[1]) _agentSpawnRegistry.set(pair[0], pair[1]);
    }
  } catch { }
}

async function checkAndRotateLogFile() {
  // Teammate 不做日志轮转，由 leader 负责
  if (_isTeammate) return;
  try {
    if (!existsSync(LOG_FILE) || statSync(LOG_FILE).size < MAX_LOG_SIZE) return;
  } catch { return; }
  await _writeQueue.flush();
  const { filePath } = generateNewLogFilePath();
  // Sentinel is baked into the new file's CREATION (rotateLogFile initial
  // content): queueing it after the fact races the watcher's rotation-follow
  // and can leave it undelivered. Synthetic url gives it a stable dedup key.
  const sentinel = JSON.stringify({
    ccvRotationContext: 1,
    url: 'ccv://rotation-context',
    from: basename(LOG_FILE),
    teammateNames: [..._agentSpawnRegistry.entries()],
    timestamp: new Date().toISOString(),
  }) + '\n---\n';
  const result = rotateLogFile(LOG_FILE, filePath, MAX_LOG_SIZE, sentinel);
  if (result.rotated) {
    LOG_FILE = result.newFile;
    // 重置 delta 状态，强制下一条 mainAgent 请求写完整 checkpoint
    if (_deltaStorageEnabled) {
      _lastMessagesCount = 0;
      _lastTailFp = '';
      _mainAgentDeltaCount = 0;
    }
  }
}

// Exposed for the /api/prev-segment-teammates route (belt-and-braces seed
// delivery when the in-band sentinel falls outside the client's load window).
export function getAgentSpawnRegistrySnapshot() {
  return [..._agentSpawnRegistry.entries()];
}

// 从环境变量 ANTHROPIC_BASE_URL 提取域名用于请求匹配
function getBaseUrlHost() {
  try {
    const baseUrl = process.env.ANTHROPIC_BASE_URL;
    if (baseUrl) {
      return new URL(baseUrl).hostname;
    }
  } catch { }
  return null;
}
const CUSTOM_API_HOST = getBaseUrlHost();

// 保存 viewer 模块引用
let viewerModule = null;

/**
 * Fire-and-forget POST a streaming chunk to cc-viewer server.
 * Non-blocking: returns immediately, errors silently ignored.
 * Only active when _livePort has been set (via setLivePort, by server.js).
 * @param {function(boolean)} [onDone] - optional callback: true=success, false=413 (payload too large)
 */
export function sendStreamChunk(entry, chunkSeq, onDone) {
  const port = _livePort;
  if (!port) return;
  try {
    const payload = JSON.stringify({ ...entry, _chunkSeq: chunkSeq });
    const mod = _liveProtocol === 'https' ? https : http;
    const req = mod.request({
      hostname: '127.0.0.1',
      port: Number(port),
      path: '/api/stream-chunk',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'x-cc-viewer-internal': '1',
      },
      timeout: 500,
      rejectUnauthorized: false,
    }, (res) => {
      // 413 = payload too large → notify caller to stop sending further chunks
      if (onDone) onDone(res.statusCode !== 413);
      res.resume(); // drain
    });
    req.on('error', () => { if (onDone) onDone(true); });  // network error: keep trying
    req.on('timeout', () => { try { req.destroy(); } catch {} if (onDone) onDone(true); });
    req.write(payload);
    req.end();
  } catch { if (onDone) onDone(true); }
}

export function setupInterceptor() {
  // 避免重复拦截
  if (globalThis._ccViewerInterceptorInstalled) {
    return;
  }
  globalThis._ccViewerInterceptorInstalled = true;

  // 启动 viewer 服务。Teammate 子进程跳过，避免端口冲突（leader 已启动 viewer）
  if (!_isTeammate) {
    // Windows 下 import(绝对路径) 会被拒 (ERR_UNSUPPORTED_ESM_URL_SCHEME)；统一走 pathToFileURL。
    const serverPath = join(__dirname, 'server.js');
    import(pathToFileURL(serverPath).href).then(module => {
      viewerModule = module;
    }).catch((err) => {
      console.warn('[cc-viewer] failed to load viewer server module:', err?.message || err);
    });
  }

  // 注册退出处理器
  // NB: 三个 handler 被 setupInterceptor 上面 `_ccViewerInterceptorInstalled` 守卫保护，
  // 同一进程内重复 import 不会重复注册（cleanupViewer 闭包也不会堆积）。
  const cleanupViewer = async () => {
    if (viewerModule && typeof viewerModule.stopViewer === 'function') {
      try {
        await viewerModule.stopViewer();
      } catch (err) {
        // Silently fail
      }
    }
  };

  process.on('SIGINT', () => {
    _writeQueue.close().then(() => cleanupViewer()).finally(() => process.exit(0));
  });

  process.on('SIGTERM', () => {
    _writeQueue.close().then(() => cleanupViewer()).finally(() => process.exit(0));
  });

  process.on('beforeExit', () => {
    _writeQueue.close().then(() => cleanupViewer());
  });

  const _originalFetch = globalThis.fetch;

  globalThis.fetch = async function (url, options) {
    // cc-viewer 内部请求（翻译等）直接透传，不拦截
    const internalHeader = options?.headers?.['x-cc-viewer-internal']
      || (options?.headers instanceof Headers && options.headers.get('x-cc-viewer-internal'));
    if (internalHeader) {
      return _originalFetch.apply(this, arguments);
    }

    const startTime = Date.now();
    let requestEntry = null;

    try {
      const urlStr = typeof url === 'string' ? url : url?.url || String(url);
      // 检查 headers 中是否包含 x-cc-viewer-trace 标记
      const headers = options?.headers || {};
      const isProxyTrace = headers['x-cc-viewer-trace'] === 'true' || headers['x-cc-viewer-trace'] === true;

      // 如果是 proxy 转发的，或者符合 URL 规则
      if (isProxyTrace || urlStr.includes('anthropic') || urlStr.includes('claude') || (CUSTOM_API_HOST && urlStr.includes(CUSTOM_API_HOST)) || isAnthropicApiPath(urlStr)) {
        // 如果是 proxy 转发的，需要清理掉标记 header 避免发给上游
        if (isProxyTrace && options?.headers) {
          delete options.headers['x-cc-viewer-trace'];
        }

        const timestamp = new Date().toISOString();
        let body = null;
        if (options?.body) {
          try {
            body = JSON.parse(options.body);
          } catch {
            body = String(options.body).slice(0, 500);
          }
        }

        // 转换 headers 为普通对象（支持 Request 对象、options.headers、Headers 实例）
        let headers = {};
        const rawHeaders = options?.headers || (url instanceof Request ? url.headers : null);
        if (rawHeaders) {
          if (rawHeaders instanceof Headers) {
            headers = Object.fromEntries(rawHeaders.entries());
          } else if (typeof rawHeaders === 'object') {
            headers = { ...rawHeaders };
          }
        }

        // 缓存 API Key / Authorization 供翻译接口使用（缓存原始值）
        if (headers['x-api-key'] && !_cachedApiKey) {
          _cachedApiKey = headers['x-api-key'];
        }
        if (headers['authorization'] && !_cachedAuthHeader) {
          _cachedAuthHeader = headers['authorization'];
        }

        // 首次 API 请求时捕获原始配置（仅一次，用于 Default profile 展示和自动匹配）
        if (!_defaultConfig) {
          try {
            const _u = new URL(urlStr);
            _defaultConfig = {
              origin: _u.origin,
              authType: headers['authorization'] ? 'OAuth' : headers['x-api-key'] ? 'API Key' : 'Unknown',
              apiKey: headers['x-api-key'] || null,
              model: body?.model || null,
            };
          } catch { }
        }

        // 缓存请求中的模型名（仅 mainAgent 请求，避免 SubAgent 覆盖）
        // 注意：写入移到 requestEntry 构建之后

        // 脱敏敏感 headers，避免写入日志泄漏凭证
        const safeHeaders = { ...headers };
        if (safeHeaders['x-api-key']) {
          const k = safeHeaders['x-api-key'];
          safeHeaders['x-api-key'] = k.length > 12 ? k.slice(0, 8) + '****' + k.slice(-4) : '****';
        }
        if (safeHeaders['authorization']) {
          const v = safeHeaders['authorization'];
          const spaceIdx = v.indexOf(' ');
          if (spaceIdx > 0) {
            const scheme = v.slice(0, spaceIdx);
            const token = v.slice(spaceIdx + 1);
            safeHeaders['authorization'] = scheme + ' ' + (token.length > 12 ? token.slice(0, 8) + '****' + token.slice(-4) : '****');
          } else {
            safeHeaders['authorization'] = '****';
          }
        }

        requestEntry = {
          timestamp,
          project: (() => { try { return basename(process.cwd()); } catch { return 'unknown'; } })(),
          url: urlStr,
          method: options?.method || 'GET',
          headers: safeHeaders,
          body: body,
          response: null,
          duration: 0,
          isStream: body?.stream === true,
          isHeartbeat: /\/api\/eval\/sdk-/.test(urlStr),
          isCountTokens: /\/messages\/count_tokens/.test(urlStr),
          mainAgent: isMainAgentRequest(body),
          ...(_isTeammate && { teammate: _teammateName, teamName: _teamName })
        };
      }
    } catch { }

    // 用户新指令边界：检查日志文件大小，超过 250MB 则切换新文件
    if (requestEntry?.mainAgent) {
      await checkAndRotateLogFile();
      // 仅 mainAgent 请求时缓存模型名，避免 SubAgent 覆盖
      if (requestEntry.body?.model && typeof requestEntry.body.model === 'string') {
        _cachedModel = requestEntry.body.model;
        // 捕获 haiku 模型名供翻译接口使用
        if (/haiku/i.test(requestEntry.body.model)) {
          _cachedHaikuModel = requestEntry.body.model;
        }
      }
    }

    // Delta storage：仅 mainAgent 且开关启用时，将 body.messages 转为增量格式
    let _deltaOriginalMessagesLength = 0; // 缓存本次请求的原始 messages 长度，用于 completed 后更新状态
    let _deltaOriginalTailFp = '';        // 缓存本次请求末位 message 的指纹，用于 completed 后更新 _lastTailFp
    if (_deltaStorageEnabled && requestEntry?.mainAgent && Array.isArray(requestEntry.body?.messages)) {
      const messages = requestEntry.body.messages;
      _deltaOriginalMessagesLength = messages.length;
      // 立即把末位 fp 算成字符串保存（不存对象引用），避免后续 mutation 风险
      _deltaOriginalTailFp = messages.length > 0 ? fingerprintMsg(messages[messages.length - 1]) : '';
      _mainAgentDeltaCount++;

      // 完成序倒置守卫：请求发起序号（必须与下方 Plan C eager 块同处一个同步段，中间不得插 await）
      if (!_isTeammate) {
        requestEntry._seq = ++_seqCounter;
        requestEntry._seqEpoch = _seqEpoch;
      }

      // 并发竞态修复（详见模块顶部注释 + history.md Unreleased 段 fix(interceptor) 条目）：
      // snapshot 上一请求处理时的 count/fp 给 Plan C 用，然后 eager 把模块级状态推到本次值
      // （不等 _commitDeltaState）。BUG 来源：teammate 终止快速串行让 mainAgent 30ms 内连续
      // firing，旧 commit 时序使 Plan C 拿陈旧 prev 漏检 → client doubled-history。
      const _prevMessagesCount = _lastMessagesCount;
      const _prevTailFp = _lastTailFp;
      if (_deltaOriginalMessagesLength > 0) {
        _lastMessagesCount = _deltaOriginalMessagesLength;
        if (_deltaOriginalTailFp !== '') _lastTailFp = _deltaOriginalTailFp;
      }

      // In-place last-msg replace 检测：messages.length 不变但末位 fp 不同。
      // 触发场景：CLI 在 mainAgent 末位"原地替换"user msg（SUGGESTION MODE → 用户真实输入；
      // synthetic recap 通道注入；teammate 终止快速串行 → SUGGESTION MODE 多次替换；等），
      // wire 上长度未变内容变了。旧逻辑 messages.slice(_lastMessagesCount) 算出 delta=[]，
      // 丢失了"末位换内容"信息 → 客户端重建拿到错误的"前态末位"。
      // 检测命中即强制写 checkpoint，让客户端拿到完整 wire 真实内容。
      const _sameLenInPlaceReplace =
        _tailFpCheckEnabled &&
        messages.length === _prevMessagesCount &&
        _prevMessagesCount > 0 &&
        _prevTailFp !== '' &&
        _deltaOriginalTailFp !== '' &&
        _deltaOriginalTailFp !== _prevTailFp;

      // 判断是否需要写 checkpoint
      const needsCheckpoint =
        _prevMessagesCount === 0 ||                           // 进程重启 / 首次请求
        messages.length < _prevMessagesCount ||               // messages 缩短（/clear、context 压缩）
        (_mainAgentDeltaCount % CHECKPOINT_INTERVAL === 0) || // 定期 checkpoint
        _sameLenInPlaceReplace;                                // in-place last-msg replace 检测

      if (needsCheckpoint) {
        // checkpoint：保持完整 messages，标记 _isCheckpoint
        requestEntry._deltaFormat = 1;
        requestEntry._totalMessageCount = messages.length;
        requestEntry._conversationId = 'mainAgent';
        requestEntry._isCheckpoint = true;
        if (_sameLenInPlaceReplace) {
          // 诊断字段：标记此 checkpoint 是被 in-place replace 检测触发的（频率约 1-2%，
          // 用于在生产 jsonl 里事后核对触发率，不影响重建逻辑）。
          // 双方协议（KEEP IN SYNC: src/utils/sessionManager.js applyInPlaceLastMsgReplace）：
          // 客户端 helper 看到此字段=true（与 _isCheckpoint:true 同时存在）时直接 in-place 替换
          // lastSession.messages 末位，跳过 sessionMerge prefix-overlap 算法（避开 doubled-history）。
          // 字段重命名 / 删除前需同步两端 + 重跑双向回归测试。
          requestEntry._inPlaceReplaceDetected = true;
        }
      } else {
        // delta：只保留新增的 messages（必须用 _prevMessagesCount，不是 eager 已更新的 _lastMessagesCount）
        const delta = messages.slice(_prevMessagesCount);
        requestEntry._deltaFormat = 1;
        requestEntry._totalMessageCount = messages.length;
        requestEntry._conversationId = 'mainAgent';
        requestEntry._isCheckpoint = false;
        requestEntry.body.messages = delta;
      }
    }

    // 生成唯一请求 ID，用于关联在途请求和完成请求
    const requestId = `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    if (requestEntry) {
      requestEntry.requestId = requestId;
      requestEntry.inProgress = true;  // 标记为在途请求
    }

    // 在发起请求前先写入一条未完成的条目，让前端可以检测在途请求
    // 例外：live-streaming 场景下，placeholder 由 sendStreamChunk 通过 HTTP 即时投递，
    // 跳过磁盘预写可避免 log-watcher 500ms 后用空 placeholder 覆盖已显示的流式内容
    if (requestEntry) {
      const willLiveStream = !!_livePort && requestEntry.mainAgent && !_isTeammate;
      if (!willLiveStream) {
        _writeQueue.append(JSON.stringify(requestEntry) + '\n---\n');
      }
    }

    // 流式请求状态追踪（仅对 Claude API 流式请求）
    if (requestEntry?.isStream) {
      streamingState.active = true;
      streamingState.requestId = requestId;
      streamingState.startTime = Date.now();
      streamingState.model = requestEntry.body?.model || '';
      streamingState.bytesReceived = 0;
      streamingState.chunksReceived = 0;
    }

    // Proxy profile request rewriting
    let _fetchUrl = url;
    let _fetchOpts = options;
    if (_activeProfile && _activeProfile.baseURL && requestEntry) {
      try {
        // 1. URL 重写: 用 baseURL 替换 origin，智能处理路径重叠
        //    baseURL="https://proxy.com/v1" + pathname="/v1/messages" → "https://proxy.com/v1/messages"（去重 /v1）
        //    baseURL="https://proxy.com"    + pathname="/v1/messages" → "https://proxy.com/v1/messages"（无重叠）
        if (typeof _fetchUrl === 'string') {
          const _origUrl = new URL(_fetchUrl);
          const _baseUrl = new URL(_activeProfile.baseURL);
          const _basePath = _baseUrl.pathname.replace(/\/+$/, '');
          const _origPath = _origUrl.pathname;
          // 如果原始路径以 baseURL 的路径开头（如都有 /v1/），去掉重叠部分
          // 使用 _basePath + '/' 避免 /api 误匹配 /api-v2
          const _finalPath = (!_basePath || _origPath === _basePath || _origPath.startsWith(_basePath + '/')) ? _origPath : _basePath + _origPath;
          _fetchUrl = _baseUrl.origin + _finalPath + _origUrl.search;
        }
        // 2. Auth 替换 —— 兼容 lowercase / TitleCase，且 x-api-key / Authorization 同时替换以覆盖两种鉴权形式
        if (_activeProfile.apiKey && _fetchOpts?.headers) {
          const h = _fetchOpts.headers;
          if (typeof h === 'object' && !(h instanceof Headers)) {
            const { headers: newHeaders, matchedAuthKey, matchedXApiKey } =
              _replaceProxyAuthHeaders(h, _activeProfile.apiKey);
            _fetchOpts = { ..._fetchOpts, headers: newHeaders };

            // 诊断日志：让 stderr 能看到替换是否真的发生
            // 只输出"是否命中/是否写入"布尔，绝不输出任何 apiKey 明文或片段
            // （日志聚合/审计规则会把尾 N 字符一并标记为敏感泄漏）
            if (process.env.CCV_DEBUG_HOTSWITCH) {
              console.error('[ccv hotswitch]', {
                profile: _activeProfile.name,
                url: _fetchUrl,
                matchedAuth: matchedAuthKey || '(none)',
                matchedXApiKey: matchedXApiKey || '(none)',
                authSet: !!(matchedAuthKey && newHeaders[matchedAuthKey]),
                xApiKeySet: !!(newHeaders[matchedXApiKey] || newHeaders['x-api-key']),
              });
            }
          }
        }
        // 3. Model 替换 —— 按 body.model 家族名解析目标（opus/sonnet/haiku 各自字段，
        //    fable/mythos/未识别 → ANTHROPIC_MODEL；旧数据回退 activeModel 整体替换）。
        //    避免对整条 wire body（-c 重启后全量 checkpoint 可达数十 MB）二次 JSON.parse +
        //    全量 re-stringify：用 requestEntry.body 读旧值（函数级作用域；行 606 的 body 是
        //    if 块级变量，此处已越界——历史 BUG），对原始字符串做有界定向替换（唯一非歧义匹配
        //    才生效）；定位失败回退旧 parse 路径。注意只读 .model：delta 路径只改 .messages，
        //    不能整体复用 requestEntry.body 重建 wire。
        const _rb = requestEntry.body;
        const _oldModel = (_rb && typeof _rb === 'object' && typeof _rb.model === 'string') ? _rb.model : undefined;
        const _targetModel = _oldModel ? resolveProfileModel(_oldModel, _activeProfile) : null;
        if (_targetModel && _fetchOpts?.body) {
          const _replaced = (typeof _fetchOpts.body === 'string')
            ? replaceTopLevelModel(_fetchOpts.body, _oldModel, _targetModel)
            : null;
          if (_replaced !== null) {
            _fetchOpts = { ..._fetchOpts, body: _replaced };
          } else {
            try {
              const _b = JSON.parse(_fetchOpts.body);
              if (_b.model) {
                _b.model = _targetModel;
                _fetchOpts = { ..._fetchOpts, body: JSON.stringify(_b) };
              }
            } catch { }
          }
        }
        // 4. Effort 注入 —— 强制 output_config.effort（对应 CLAUDE_CODE_EFFORT_LEVEL）。
        //    在 model 替换之后执行，操作 _fetchOpts.body 的最新形态；仅当 profile 显式设置了
        //    合法 effort 才注入。排除 count_tokens / heartbeat：这些端点可能拒绝未知字段（400），
        //    且 output_config 对它们无意义。hasOutputConfig 优先用 requestEntry.body（函数级作用域，
        //    行 606 的 body 在此已越界）判定；解析失败退化为截断字符串时，回退到对 wire 串扫描
        //    "output_config"（避免误走前插路径产生重复键 → JSON "后者胜" 把注入的 effort 丢掉）。
        if (_activeProfile.effort && typeof _fetchOpts?.body === 'string' &&
            !requestEntry.isCountTokens && !requestEntry.isHeartbeat) {
          const _hasOutputConfig = (_rb && typeof _rb === 'object')
            ? (!!_rb.output_config && typeof _rb.output_config === 'object')
            : _fetchOpts.body.includes('"output_config"');
          const _injected = injectOutputConfigEffort(_fetchOpts.body, _activeProfile.effort, _hasOutputConfig);
          if (_injected !== null) _fetchOpts = { ..._fetchOpts, body: _injected };
        }
        // 记录 proxy 信息到日志条目
        requestEntry.proxyProfile = _activeProfile.name;
        requestEntry.proxyUrl = _fetchUrl;
      } catch { }
    }

    let response;
    try {
      response = await _originalFetch.call(this, _fetchUrl, _fetchOpts);
    } catch (err) {
      if (requestEntry?.isStream) resetStreamingState();
      throw err;
    }

    if (requestEntry) {
      const duration = Date.now() - startTime;
      requestEntry.duration = duration;

      // 对于流式响应，拦截并捕获内容
      if (requestEntry.isStream) {
        try {
          requestEntry.response = {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            body: { events: [] }
          };

          const originalBody = response.body;
          const reader = originalBody.getReader();
          const decoder = new TextDecoder();
          // 延迟物化：避免 V8 ConsString 多次 O(n) 拷贝
          let streamedChunks = [];
          let streamedContentLen = 0;

          // 实时流式：仅对 mainAgent 且 server live-port 已注入时启用
          let liveStreamEnabled = !!_livePort && requestEntry.mainAgent && !_isTeammate;
          const liveAssembler = liveStreamEnabled ? createStreamAssembler() : null;
          // IM 逐字采集：独立于前端 live-stream / _livePort，仅 worker 内对主 agent 累计 text_delta。
          const imCapture = _imCaptureEnabled && requestEntry.mainAgent && !_isTeammate;
          let imStreamAppended = false; // 本 stream 是否已追加过；跨 API 调用的消息间补一个 \n\n 分隔
          let livePendingBuffer = '';
          let liveChunkSeq = 0;
          let liveLastFlushMs = 0;
          let liveLastFlushBytes = 0;
          let liveFlushInFlight = false;
          let liveHasPendingSnapshot = false;
          let liveFlushTimer = null;

          // 非阻塞 flush：合并待发快照（latest-wins），单 in-flight。
          // payload 只包含 server 实际消费的 4 字段（timestamp/url/content/model）+ _chunkSeq，
          // 避免克隆完整 requestEntry（含 headers/messages/tools，每次 O(N) 序列化导致 O(N²) 累计）。
          const liveFlush = () => {
            if (!liveStreamEnabled || !liveAssembler || !liveAssembler.hasMessage()) return;
            if (liveFlushInFlight) {
              liveHasPendingSnapshot = true;
              return;
            }
            liveFlushInFlight = true;
            liveHasPendingSnapshot = false;
            const snap = liveAssembler.snapshot();
            const chunkEntry = {
              timestamp: requestEntry.timestamp,
              url: requestEntry.url,
              response: { body: snap },
              body: { model: requestEntry.body?.model },
            };
            sendStreamChunk(chunkEntry, ++liveChunkSeq, (ok) => {
              // 413 → 禁用当次流式，后续全由最终 appendFileSync 交付
              if (!ok) liveStreamEnabled = false;
            });
            // 短延迟后清标志，允许下一次发送；若中途有新快照等待，立即再发
            if (liveFlushTimer) clearTimeout(liveFlushTimer);
            liveFlushTimer = setTimeout(() => {
              liveFlushTimer = null;
              liveFlushInFlight = false;
              if (liveHasPendingSnapshot && liveStreamEnabled) liveFlush();
            }, 50);
          };

          // 首次：立即 POST 当前 inProgress 骨架（无 body），保证前端先看到占位条目。
          // 传 onDone 回调熔断：若 skeleton 就触发 413（极少见但可能，例如 requestEntry 本身异常大），
          // 立即禁用当次 live-stream，后续仅走最终 entry 落盘路径。
          if (liveStreamEnabled) {
            sendStreamChunk({
              timestamp: requestEntry.timestamp,
              url: requestEntry.url,
              response: { body: null },
              body: { model: requestEntry.body?.model },
            }, 0, (ok) => { if (!ok) liveStreamEnabled = false; });
          }

          const stream = new ReadableStream({
            async start(controller) {
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) {
                    // flush decoder 残留字节
                    {
                      const tail = decoder.decode();
                      if (tail) { streamedChunks.push(tail); streamedContentLen += tail.length; }
                    }
                    // 流结束，组装完整的消息对象。
                    // 此处一次性 join — 流式累积期间唯一的物化点（错误路径除外）。
                    const fullContent = streamedChunks.join('');
                    try {
                      // HTTP SSE 规范是 \r\n\r\n 分块，POSIX 上常被 normalize 成 \n\n
                      // 但 Windows 直接收到的就是 CRLF，硬切 '\n\n' 在 Win 上整块响应当一个事件解析失败。
                      const events = fullContent.split(/\r?\n\r?\n/)
                        .filter(block => block.trim())
                        .map(block => {
                          // SSE 块可能包含多行: event: xxx\ndata: {...}
                          const lines = block.split(/\r?\n/);
                          const dataLine = lines.find(l => l.startsWith('data:'));
                          if (dataLine) {
                            // 处理 "data:" 或 "data: " 两种格式
                            const jsonStr = dataLine.startsWith('data: ')
                              ? dataLine.substring(6)
                              : dataLine.substring(5);
                            try {
                              return JSON.parse(jsonStr);
                            } catch {
                              return jsonStr;
                            }
                          }
                          return null;
                        })
                        .filter(Boolean);

                      // 组装完整的 message 对象（GLM 使用标准格式，但 data: 后无空格）
                      const assembledMessage = assembleStreamMessage(events);

                      // 直接使用组装后的 message 对象作为 response.body
                      // 如果组装失败（例如非标准 SSE），则使用原始流内容
                      requestEntry.response.body = assembledMessage || fullContent;
                      // Must run before the post-write `response = null` release.
                      collectAgentSpawns(requestEntry);


                      // 移除在途请求标记，保持原始报文
                      delete requestEntry.inProgress;
                      delete requestEntry.requestId;
                      { const _dl = _deltaOriginalMessagesLength, _tf = _deltaOriginalTailFp;
                        _writeQueue.append(JSON.stringify(requestEntry) + '\n---\n', () => _commitDeltaState(_dl, _tf)); }
                      // Release memory: clear large objects after disk write
                      streamedChunks = [];
                      streamedContentLen = 0;
                      requestEntry.response = null;
                      resetStreamingState();
                    } catch (err) {
                      requestEntry.response.body = fullContent.slice(0, 1000);
                      delete requestEntry.inProgress;
                      delete requestEntry.requestId;
                      { const _dl = _deltaOriginalMessagesLength, _tf = _deltaOriginalTailFp;
                        _writeQueue.append(JSON.stringify(requestEntry) + '\n---\n', () => _commitDeltaState(_dl, _tf)); }
                      streamedChunks = [];
                      streamedContentLen = 0;
                      requestEntry.response = null;
                      resetStreamingState();
                    }
                    controller.close();
                    break;
                  }
                  streamingState.bytesReceived += value.byteLength;
                  streamingState.chunksReceived++;
                  const chunk = decoder.decode(value, { stream: true });
                  streamedChunks.push(chunk);
                  streamedContentLen += chunk.length;
                  controller.enqueue(value);

                  // 实时流式：增量解析完整的 SSE events。前端 live-stream（liveAssembler）与 IM 逐字
                  // 采集（imCapture）共用同一次 split 解析，避免重复扫描；任一开启即进入。
                  if ((liveAssembler && liveStreamEnabled) || imCapture) {
                    livePendingBuffer += chunk;
                    let sawBlockStop = false;
                    let idx;
                    while ((idx = livePendingBuffer.indexOf('\n\n')) !== -1) {
                      const eventBlock = livePendingBuffer.slice(0, idx);
                      livePendingBuffer = livePendingBuffer.slice(idx + 2);
                      if (!eventBlock.trim()) continue;
                      const lines = eventBlock.split('\n');
                      const dataLine = lines.find(l => l.startsWith('data:'));
                      if (!dataLine) continue;
                      const jsonStr = dataLine.startsWith('data: ')
                        ? dataLine.substring(6)
                        : dataLine.substring(5);
                      try {
                        const ev = JSON.parse(jsonStr);
                        if (liveAssembler && liveStreamEnabled) {
                          liveAssembler.feed(ev);
                          if (ev.type === 'content_block_stop') sawBlockStop = true;
                        }
                        // IM 逐字：只累计可见正文 text_delta（跳过 thinking_delta / 工具入参），与
                        // extractLastAssistantText 的「只取 text 块」对齐，避免 finalize 时闪烁/重复。
                        if (imCapture) {
                          const td = imTextDeltaOf(ev);
                          if (td !== null) {
                            if (!imStreamAppended && _imLiveText) _imLiveText += '\n\n'; // 跨 API 调用的消息间分隔
                            imStreamAppended = true;
                            _imLiveText += td;
                          }
                        }
                      } catch {}
                    }
                    if (liveAssembler && liveStreamEnabled) {
                      const now = Date.now();
                      const overdue = (now - liveLastFlushMs) >= 100;
                      const bigChunk = (streamedContentLen - liveLastFlushBytes) > 16384;
                      if (sawBlockStop || overdue || bigChunk) {
                        liveLastFlushMs = now;
                        liveLastFlushBytes = streamedContentLen;
                        liveFlush();
                      }
                    }
                  }
                }
              } catch (err) {
                resetStreamingState();
                controller.error(err);
              }
            }
          });

          // 返回带有代理流的新响应
          return new Response(stream, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          });
        } catch (err) {
          requestEntry.response = {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            body: '[Streaming Response - Capture failed]'
          };
          delete requestEntry.inProgress;
          delete requestEntry.requestId;
          { const _dl = _deltaOriginalMessagesLength, _tf = _deltaOriginalTailFp;
            _writeQueue.append(JSON.stringify(requestEntry) + '\n---\n', () => _commitDeltaState(_dl, _tf)); }
          resetStreamingState();
        }
      } else {
        // 对于非流式响应，可以安全读取body
        try {
          const clonedResponse = response.clone();
          const responseText = await clonedResponse.text();
          let responseData = null;

          try {
            responseData = JSON.parse(responseText);
          } catch {
            responseData = responseText.slice(0, 1000);
          }

          requestEntry.response = {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            body: responseData
          };

          collectAgentSpawns(requestEntry);

          delete requestEntry.inProgress;
          delete requestEntry.requestId;

          { const _dl = _deltaOriginalMessagesLength, _tf = _deltaOriginalTailFp;
            _writeQueue.append(JSON.stringify(requestEntry) + '\n---\n', () => _commitDeltaState(_dl, _tf)); }
        } catch (err) {
          delete requestEntry.inProgress;
          delete requestEntry.requestId;
          { const _dl = _deltaOriginalMessagesLength, _tf = _deltaOriginalTailFp;
            _writeQueue.append(JSON.stringify(requestEntry) + '\n---\n', () => _commitDeltaState(_dl, _tf)); }
        }
      }
    }

    return response;
  };
}

// 自动执行拦截器设置
// proxy 模式下（ccv CLI 或 ccv run），外层 proxy.js 已显式调用 setupInterceptor()，
// 这里跳过自动执行，避免 Claude 进程中重复拦截 fetch
// Teammate 子进程即使继承了 CCV_PROXY_MODE 也需要启用拦截（它是独立 claude 进程，不走 proxy）
if (!_ccvSkip && (!process.env.CCV_PROXY_MODE || _isTeammate)) setupInterceptor();

// 等待日志文件初始化完成后启动 Web Viewer 服务
// 如果是 ccv --c 通过 proxy 模式启动的，外层已有 server，跳过
// Teammate 子进程也跳过，避免端口冲突（leader 已启动 viewer）
if (!_ccvSkip && !process.env.CCV_PROXY_MODE && !_isTeammate) {
  _initPromise.then(() => import('./server.js')).catch((err) => {
    console.error('[CC-Viewer] Failed to start viewer server:', err);
  });
}
