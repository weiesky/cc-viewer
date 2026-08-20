// LLM Request Interceptor
// 拦截并记录所有Claude API请求
// Wire format 协议详见 docs/WIRE_FORMAT.md（mainAgent entry 形态 / 关键字段 / 信号链路）

// 非交互命令（如 claude -v, claude --help）不需要启动 ccv
const _ccvSkipArgs = ['--version', '-v', '--v', '--help', '-h', 'doctor', 'install', 'update', 'upgrade', 'auth', 'setup-token', 'agents', 'plugin', 'plugins', 'mcp'];
const _ccvSkip = _ccvSkipArgs.includes(process.argv[2]);

import './lib/proxy/proxy-env.js';
import { mkdirSync, readFileSync, writeFileSync, existsSync, watchFile, unwatchFile, renameSync, rmSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { LOG_DIR } from '../findcc.js';
import { assembleStreamMessage, createStreamAssembler, isAnthropicApiPath, isMainAgentRequest, replaceTopLevelModel, injectOutputConfigEffort, resolveProfileModel, extractAgentSpawnPairs, classifyProxyRole, resolveRoleProfile, normalizeRoles, mergeActivePayload } from './lib/interceptor-core.js';
import { V2Writer } from './lib/v2/v2-writer.js';
import { reportSwallowed } from '@ccv/core/error-report';
import { latestMainSessionDir, sessionHasCompletedMainTurn } from './lib/v2/session-select.js';
import { sanitizePathComponent } from './lib/v2/layout.js';
import { setRetryConfigPath, loadRetryConfig, DEFAULT_RETRY_CONFIG } from './lib/proxy/proxy-retry.js';
import { setProjectName } from './lib/project-state.js';
import { consumePendingForResume, writeSnapshot, projectKeyForCwd } from './lib/system-prompt-snapshots.js';



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
//     active 字段 = main 角色的全局回退默认（setActiveProfileForWorkspace 幂等双写，
//     供 UI 回落/老数据兼容）。
//   <projectDir>/active-profile.json (每 workspace 独占): { activeId, roles }；
//     activeId = main 角色（旧版 ccv 只认这个字段，向后兼容）；
//     roles = { subagent, teammate }，取值 'follow'(默认) | 'max' | profile id。
//     旧文件无 roles 字段 → normalizeRoles 归 follow/follow；旧版 ccv 整文件覆盖会丢
//     roles（可接受；新版下次写只把 roles 键以默认 follow 带回，原分配不恢复）。
//     跨进程并发写是 read-modify-write 无 CAS（同 workspace 双实例同时写不同字段会
//     丢先写方）——概率极低，已知限制。切换 active/roles 只影响当前 workspace。
// profile.json 存放在 LOG_DIR 下，受 --log-dir / CCV_LOG_DIR 影响
const PROFILE_PATH = join(LOG_DIR, 'profile.json');
let _activeProfile = null; // { id, name, baseURL?, apiKey?, effort?, ANTHROPIC_MODEL?, ANTHROPIC_DEFAULT_OPUS_MODEL?, ANTHROPIC_DEFAULT_SONNET_MODEL?, ANTHROPIC_DEFAULT_HAIKU_MODEL?, activeModel?(legacy) }
// Per-role state (STORED values, never dormancy-adjusted — dormancy is enforced per request):
let _roleIds = normalizeRoles(undefined); // { subagent, teammate }
let _profilesById = new Map();            // id → profile object from profile.json

// proxy 属主进程（ccv run / runCliMode / Electron mgmt+tab-worker）同样参与角色分流：
// proxy.js 在 body 缓冲后按角色选上游 + 供重试引擎做模型替换，本 hook 对 trace 请求
// 再跑一次同角色改写（URL 幂等、auth 注入是承重的——proxy 链路不碰 apiKey、model 已替换
// 时 resolveProfileModel 返回 null 即 no-op），两层输入相同所以结果一致，不会双重改写。

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

function _readWorkspaceActive() {
  const p = _getActiveProfileFilePath();
  const empty = { activeId: null, roles: normalizeRoles(undefined) };
  if (!p) return empty;
  try {
    if (existsSync(p)) {
      const data = JSON.parse(readFileSync(p, 'utf-8'));
      return {
        activeId: typeof data?.activeId === 'string' ? data.activeId : null,
        roles: normalizeRoles(data?.roles),
      };
    }
  } catch (err) {
    // 损坏的工作区文件会把 active/roles 静默回落默认 —— 属"丢数据"级，必须记账（有节流）
    reportSwallowed('proxy-profile.workspace-read', err);
  }
  return empty;
}

function _readWorkspaceActiveId() {
  return _readWorkspaceActive().activeId;
}

function _writeWorkspaceActive(activeId, roles) {
  const p = _getActiveProfileFilePath();
  if (!p) {
    // 诊断用：能把"为什么 workspace 路径不可用"暴露到启动 ccv 的终端
    console.error('[ccv proxy-profile] skip workspace write: ' +
      `_projectName="${_projectName}" _logDir="${_logDir}" (both required)`);
    return false;
  }
  try {
    mkdirSync(dirname(p), { recursive: true });
    // 合并语义：调用方只改 activeId 时必须保留文件里的 roles（反之亦然）——roles 只存
    // 在这个文件里，整文件覆盖会丢角色分配。tmp+rename 原子写：其他 ccv 进程（teammate /
    // 多窗口）经 watchFile 轮询读此文件，不能读到写一半的撕裂内容。
    let existing = null;
    try { if (existsSync(p)) existing = JSON.parse(readFileSync(p, 'utf-8')); } catch { }
    const payload = mergeActivePayload(existing, { activeId, roles });
    const tmp = `${p}.tmp-${process.pid}`;
    try {
      writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
      renameSync(tmp, p);
    } catch (writeErr) {
      try { rmSync(tmp, { force: true }); } catch { } // 不留孤儿 tmp（磁盘满 / 中断场景）
      throw writeErr;
    }
    return true;
  } catch (err) {
    console.error('[ccv proxy-profile] workspace write failed:', p, err && err.message);
    return false;
  }
}

function _loadProxyProfile() {
  try {
    const data = JSON.parse(readFileSync(PROFILE_PATH, 'utf-8'));
    _profilesById = new Map((Array.isArray(data.profiles) ? data.profiles : [])
      .filter(p => p && typeof p.id === 'string').map(p => [p.id, p]));
    // active 解析优先级：workspace override > profile.json.active (兼容老数据 / 全局回退) > null
    const ws = _readWorkspaceActive();
    _roleIds = ws.roles;
    const activeId = ws.activeId || data.active;
    const active = data.profiles?.find(p => p.id === activeId);
    _activeProfile = (active && active.id !== 'max') ? active : null;
  } catch (err) {
    _activeProfile = null;
    _roleIds = normalizeRoles(undefined);
    _profilesById = new Map();
    if (process.env.CCV_DEBUG_HOTSWITCH) {
      console.error('[ccv hotswitch] _loadProxyProfile failed:', err && err.message);
    }
  }
}

// 为 server.js::POST /api/proxy-profiles 使用，切换当前 workspace 的 active / roles。
// 合并语义：activeId 或 roles 传 undefined = 保留文件现值（只改角色不动 main，反之亦然）。
// activeId 有参时同时写两个位置，彼此互为兜底：
//   (1) <logDir>/active-profile.json    —— 每 workspace 独占，读取优先级最高
//   (2) profile.json.active             —— 全局默认；用作 UI 在 workspace 文件读失败 /
//       不存在时的回落，避免"切换后立刻回切"的幽灵 revert
// roles-only 调用只写 (1)：profile.json 的 mtime bump 不再承担跨进程同步职责
// （active-profile.json 自己有 watchFile，见 _armWorkspaceActiveWatcher）。
// 返回 { workspace: bool, profile: bool } 指示两条路径的落盘结果（roles-only 时 profile 恒 false）。
function setActiveProfileForWorkspace(activeId, roles) {
  const result = { workspace: false, profile: false };

  // (1) workspace override（合并写）
  result.workspace = _writeWorkspaceActive(activeId, roles);

  // (2) profile.json.active —— 仅在调用方显式设置 main active 时幂等更新
  if (activeId !== undefined) {
    const normalizedId = (activeId && typeof activeId === 'string') ? activeId : 'max';
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
  }

  _loadProxyProfile(); // 立刻刷新本进程 _activeProfile / _roleIds
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

// 当前 workspace 的**存储**角色分配（不做休眠调整；命名刻意带 Stored —— 与返回有效值的
// getActiveProfileId 区分，避免下游误以为拿到的是请求时生效值）。GET /api/proxy-profiles
// 用它回显：休眠（main=Default+官方端点）只是请求侧不生效，存储值必须原样返回，否则 UI
// 回写会把休眠中的分配清掉（违反"保留但休眠"语义）。
function getStoredRoles() {
  return _readWorkspaceActive().roles;
}

// 官方端点判定。直接注入模式：首个 API 请求捕获的 _defaultConfig.origin 即真实默认端点
// （实证优先），未捕获时回退模块加载期从 ANTHROPIC_BASE_URL 提取的 CUSTOM_API_HOST。
// proxy 属主进程（ccv run / CLI / Electron tab）：_defaultConfig 捕获的是**出站** URL——
// 若首请求挂着第三方 profile，origin 被污染且永不刷新，切回 Default 后休眠将永久失效。
// 故属主进程由 proxy.js 注册解析器：返回 main=Default 时实际会走的上游（settings/env 默认链），
// 与 getOriginalBaseUrl(null) 同源。TDZ：CUSTOM_API_HOST 是加载后段才初始化的 const，
// 本函数只能在模块加载完成后被调用（fetch hook / 路由 / 测试均满足）。
let _defaultEndpointResolver = null;
export function setDefaultEndpointResolver(fn) {
  _defaultEndpointResolver = typeof fn === 'function' ? fn : null;
}
export function isOfficialDefaultEndpoint() {
  if (_defaultEndpointResolver) {
    try {
      const u = _defaultEndpointResolver();
      if (u && typeof u === 'string') return /(^|\.)anthropic\.com$/i.test(new URL(u).hostname);
    } catch { }
  }
  if (_defaultConfig && typeof _defaultConfig.origin === 'string' && _defaultConfig.origin) {
    try { return /(^|\.)anthropic\.com$/i.test(new URL(_defaultConfig.origin).hostname); } catch { }
  }
  return !CUSTOM_API_HOST || /(^|\.)anthropic\.com$/i.test(CUSTOM_API_HOST);
}

// 请求时的有效角色 profile（含休眠强制）。休眠规则：main=Default（无改写）且端点为官方时，
// 存储的 sub/teammate 分配不生效（Max 订阅保护；main 切走后原样恢复）。
function _effectiveRoleProfile(role) {
  const p = resolveRoleProfile(role, _roleIds, _profilesById, _activeProfile);
  if (role !== 'main' && !_activeProfile && isOfficialDefaultEndpoint()) return null;
  return p;
}

// proxy.js 消费方：属主进程在 body 缓冲后按角色选上游，与 hook 的改写保持同一解析路径。
function getEffectiveRoleProfile(role) {
  return _effectiveRoleProfile(role);
}

// proxy.js 分类短路用：存在显式角色分配（非 follow）才值得在属主进程解析 body 分类——
// 无分配时任意角色都解析到 main 活跃 profile，分类不影响选路。
function hasExplicitRoleAssignments() {
  return _roleIds.subagent !== 'follow' || _roleIds.teammate !== 'follow';
}

// 测试用：当前各角色的有效 profile（main 恒为 _activeProfile）。
function getProxyRoleProfiles() {
  return {
    main: _activeProfile,
    subagent: _effectiveRoleProfile('subagent'),
    teammate: _effectiveRoleProfile('teammate'),
  };
}

// active-profile.json 的 watchFile：roles 只存这个文件，而 roles-only 写入不会 bump
// profile.json 的 mtime —— 没有本 watcher，teammate 进程与同项目多窗口永远看不到角色变更。
// watchFile 对不存在的文件也会在创建时触发，与 PROFILE_PATH watcher 行为一致。
// workspace 切换（initForWorkspace/resetWorkspace）时必须 re-arm，否则监听旧路径。
let _workspaceActiveWatcherPath = null;
function _armWorkspaceActiveWatcher() {
  const p = _getActiveProfileFilePath();
  if (p === _workspaceActiveWatcherPath) return;
  if (_workspaceActiveWatcherPath) {
    try { unwatchFile(_workspaceActiveWatcherPath, _loadProxyProfile); } catch { }
  }
  _workspaceActiveWatcherPath = p;
  if (p) {
    try { watchFile(p, { interval: 1500 }, _loadProxyProfile); } catch { }
  }
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

export { _activeProfile, _defaultConfig, _loadProxyProfile, PROFILE_PATH, setActiveProfileForWorkspace, getActiveProfileId, getStoredRoles, getProxyRoleProfiles, getEffectiveRoleProfile, hasExplicitRoleAssignments, RETRY_CONFIG_PATH, _retryConfigState, _loadRetryConfigState };

// 1.7.0: the v1 single-file write path is retired — logs live in per-session
// v2 dirs owned by V2Writer. Only the project binding (name + dir) remains
// here; there is no log FILE to create, resume, rotate or delta-encode.
function resolveProjectBinding() {
  let cwd;
  try { cwd = process.cwd(); } catch { cwd = homedir(); }
  const projectName = projectKeyForCwd(cwd);
  const dir = join(LOG_DIR, projectName);
  try { mkdirSync(dir, { recursive: true }); } catch { }
  return { dir, projectName };
}

// The single completion-write helper shared by all five completion/error
// paths (streaming happy/assemble-fail, stream-setup catch, non-streaming
// happy, read-error). V2Writer catches + reportSwallowed internally; the outer
// catch is belt-and-braces so a broken guard can never crash the fetch hook —
// but a throw that ESCAPED the writer's own guards is a dropped log entry,
// which must never be silent (CLAUDE.md swallowed-catch rule).
function _writeCompletedEntry(requestEntry, v2Handle) {
  try { _v2Writer.ingestCompletion(v2Handle, requestEntry); }
  catch (err) { reportSwallowed('interceptor.ingest-completion', err); }
}

// Teammate 子进程检测：--parent-session-id（旧模式）或 --agent-name（原生 team 模式）
const _isTeammate = process.argv.includes('--parent-session-id') || process.argv.includes('--agent-name');
// 提取 teammate 元数据（--agent-name worker-1 --team-name fix-ts-errors）
let _teammateName = null;
let _teamName = null;
let _parentSessionId = null;
{
  const args = process.argv;
  const nameIdx = args.indexOf('--agent-name');
  if (nameIdx !== -1 && nameIdx + 1 < args.length) _teammateName = args[nameIdx + 1];
  const teamIdx = args.indexOf('--team-name');
  if (teamIdx !== -1 && teamIdx + 1 < args.length) _teamName = args[teamIdx + 1];
  const parentIdx = args.indexOf('--parent-session-id');
  if (parentIdx !== -1 && parentIdx + 1 < args.length) _parentSessionId = args[parentIdx + 1];
}

// 项目绑定初始化。工作区模式下延迟到选择工作区后再初始化。
let _logDir, _projectName;
if (process.env.CCV_WORKSPACE_MODE === '1') {
  _logDir = '';
  _projectName = '';
} else {
  ({ dir: _logDir, projectName: _projectName } = resolveProjectBinding());
}
setProjectName(_projectName); // mirror into the shared leaf (lib readers must not import this module)
// Deprecated (1.7.0): the v1 log file no longer exists. The always-empty
// export keeps legacy read fallbacks ("no file → empty stream") type-stable
// until the last consumers are deleted with the continuity machinery (P3).
const LOG_FILE = '';

// The v2 writer (docs/refactor/WIRE_FORMAT_V2.md §13) — the ONLY log store
// since 1.7.0. Every method is internally caught + reportSwallowed; project
// resolves through a getter because workspace mode rebinds _projectName at
// runtime. The disk-space guard inside is the single remaining write inhibitor.
const _v2Writer = new V2Writer({
  logDir: LOG_DIR,
  project: () => _projectName,
  ...(_isTeammate && {
    leader: {
      ...(_teammateName && { agentName: _teammateName }),
      ...(_teamName && { teamName: _teamName }),
      ...(_parentSessionId && { parentSessionId: _parentSessionId }),
    },
  }),
});
export { _v2Writer };

// S6b: the live read source — the current v2 session dir once the writer has
// resolved a session; '' before the first request (readers treat a missing
// path as an empty stream, same as v1's not-yet-created file did).
//
// Task B (2026-07-15): the [对话] panel must not cold-load empty. Two cases
// produce an empty current session: (a) before the first request, currentSid is
// null; (b) a session's sid resolved but it has NO main turn yet (`-c` startup
// or a background sub/count_tokens request set _currentSid before the user sent
// anything) — cold-loading THAT renders blank (the refresh bug: fresh load
// shows data, a refresh once the empty current session exists shows nothing,
// filling only after the user sends a request). So we serve the current session
// ONLY when it has a main turn ("activated"); otherwise we fall back to the
// newest MAIN session that does. Selection is idempotent across refreshes.
//
// The live feed still follows the ACTUAL written dir (it never reads this
// function), so once the current session gets its first main turn, its entries
// form a newer session the frontend auto-switches to. Selection rides the same
// bounded cold-load window (DEFAULT_EVENTS_LIMIT) as any session — never
// limit=0 — so it stays memory-safe (S10). All three cold-load consumers
// (/events, /api/requests, workspace reload) route through here.
export function getLiveLogSource() {
  const dir = _v2Writer.currentSessionDir();
  // "Activated" requires a COMPLETED main turn, not merely a written main
  // request line: a session with only an in-flight first request has nothing a
  // cold load can render yet, so keep falling back to the previous conversation
  // (which CAN render) until the current one has a done. Removes the blank flash
  // between "first `-c`/fresh main request written" and "its response emitted".
  if (dir && sessionHasCompletedMainTurn(dir)) return dir; // activated current session
  if (!_projectName) return ''; // no project bound yet (mirrors v2-writer's guard)
  try {
    // excludeDir: the current session just failed the completed-turn gate, but
    // the picker's weaker has-a-main-req gate would re-select it (it is the
    // newest dir once its first main req is written) — handing back exactly the
    // blank in-flight session the strict gate rejected. Excluding it makes the
    // fallback actually land on the previous, renderable conversation.
    // skipForeignLive: a parallel ccv window's in-flight session must never be
    // served as THIS window's cold load (multi-window isolation); a crashed
    // window's claim expires with its pid, so its session stays selectable.
    const fallback = latestMainSessionDir(join(LOG_DIR, sanitizePathComponent(_projectName)), { excludeDir: dir, skipForeignLive: true });
    // A current-but-empty session with nothing else on disk: '' (still empty,
    // but the live feed fills it in place — no worse than before the fix).
    return fallback || dir || '';
  } catch (err) {
    reportSwallowed('cold-load.fallback-select', err);
    return dir || '';
  }
}

// SessionStart hook notify (session-start-bridge.js → /api/session-start-notify
// → server.js deps). The only source acted on is 'resume': an in-terminal
// /resume switches the running claude to a PAST conversation while the wire
// session_id may stay the same, so without this signal the writer keeps
// routing the resumed conversation into the OLD session dir (and the panel —
// keyed on `_seqEpoch = v2:<dir identity>` — never switches). The transcript
// basename is the resumed conversation's stable identity; the hook session_id
// is a fresh uuid usable as the new dir identity when nothing was recorded.
// 'startup'/'clear'/'compact' are deliberately ignored (startup needs nothing;
// /clear already has epoch machinery; teammate processes inherit
// CCVIEWER_PORT and fire startup events at this endpoint — the source gate
// drops them).
export function markSessionStart(payload) {
  try {
    const { source, sessionId, transcriptPath, cwd } = payload || {};
    // 'resume' re-binds the writer AND feeds snapshot Bind B; 'fork' feeds only
    // Bind B (a fork mints a fresh wire sid + the fork mark suppresses adoption,
    // so the writer routes it correctly without a switch). Everything else is
    // ignored (startup needs nothing; /clear has epoch machinery; teammate
    // processes inherit CCVIEWER_PORT and fire startup events — dropped here).
    if (source !== 'resume' && source !== 'fork') return;
    if (!transcriptPath || typeof transcriptPath !== 'string') {
      console.warn('[ccv session-start] resume signal without transcript_path — ignored');
      return;
    }
    // Soft cross-project guard: a foreign project's claude that somehow
    // carries our CCVIEWER_PORT must not re-bind THIS project's writer. Only
    // enforced when both sides are known (workspace mode may leave
    // _projectName empty until bound).
    if (cwd && typeof cwd === 'string' && _projectName) {
      const cwdProject = projectKeyForCwd(cwd);
      if (cwdProject !== _projectName) {
        console.warn(`[ccv session-start] resume signal from project "${cwdProject}" ignored (bound to "${_projectName}")`);
        return;
      }
    }
    const transcriptUuid = basename(transcriptPath, '.jsonl');
    if (source === 'resume') {
      _v2Writer.beginResumeSwitch({
        transcriptUuid,
        hookSid: (typeof sessionId === 'string' && sessionId) ? sessionId : null,
      });
    }
    // System-prompt snapshot, Bind B (system-prompt-snapshots.js): a process-level
    // -c/-r launch queued a resumeExpected pending at spawn (pty-manager). The
    // consume is identity-exact — source 'resume' matches on resolvedUuid, 'fork'
    // on the fork flag — so a stolen in-terminal /resume hook or an out-of-order
    // racing hook consumes nothing and poisons nothing; a mismatch only warns.
    try {
      const res = consumePendingForResume(cwd, transcriptUuid, source);
      if (res && res.hit) {
        writeSnapshot(cwd, transcriptUuid, { entries: res.hit.entries, model: res.hit.model, boundVia: 'hook' });
      } else if (res && res.mismatch) {
        console.warn(`[CC Viewer] -c/-r target mismatch (resolved ${res.mismatch}, actual ${transcriptUuid}) — system-prompt snapshot not bound`);
      }
    } catch (err) { reportSwallowed('session-start.sys-prompt-bind', err); }
  } catch (err) {
    reportSwallowed('session-start.mark', err);
  }
}

// P2 (-c migration guidance): three detection channels, any one marks this
// launch as "continuing an older conversation" — the migrate prompt then
// re-prompts even a dismissed user, because the conversation's first half
// lives in un-migrated v1 logs and only migration makes it viewable.
//   ① cli.js scans claude argv and sets CCV_CLAUDE_CONTINUE before importing
//     the server (its own -c pass-through);
//   ② the workspace launcher injects -c server-side (WorkspaceList heuristic)
//     and calls markContinuedLaunch();
//   ③ wire-level fallback in V2Writer: a brand-new session whose FIRST main
//     snapshot already contains assistant turns can only be a continuation.
let _continuedLaunchMarked = false;
let _forkLaunchMarked = false;
export function markContinuedLaunch() { _continuedLaunchMarked = true; _syncContinuationMode(); }
export function isContinuedLaunch() {
  return process.env.CCV_CLAUDE_CONTINUE === '1'
    || _continuedLaunchMarked
    || _v2Writer.sawContinuedSession();
}
// `--fork-session` (resume/continue but mint a NEW session id) — the user
// explicitly wants a fresh session, so `-c` folder adoption must NOT fire.
// Detected two ways, mirroring the continuation channels: ① cli.js sets
// CCV_CLAUDE_FORK_SESSION from the claude argv; ② the workspace launcher calls
// markForkSession().
export function markForkSession() { _forkLaunchMarked = true; _syncContinuationMode(); }
export function isForkSession() {
  return process.env.CCV_CLAUDE_FORK_SESSION === '1' || _forkLaunchMarked;
}
// Explicit `-r`/`--resume` — the user targets a session of THEIR choosing (an
// id or the interactive picker), while adoption always targets the LATEST main
// session; if Claude mints a fresh wire sid for the resume, adoption would
// misroute the resumed conversation into whatever session happens to be newest.
// So an explicit resume keeps the pre-adoption behavior (its own folder);
// adoption serves `-c`/`--continue` only. Same two channels as fork: ① cli.js
// sets CCV_CLAUDE_RESUME from the claude argv; ② the workspace launcher calls
// markResumeSession(). The launch still counts as "continued" for the migrate
// prompt (isContinuedLaunch is unchanged).
let _resumeLaunchMarked = false;
export function markResumeSession() { _resumeLaunchMarked = true; _syncContinuationMode(); }
export function isResumeSession() {
  return process.env.CCV_CLAUDE_RESUME === '1' || _resumeLaunchMarked;
}
// Push the launch's continuation/fork/resume intent into the writer so `-c`
// folder adoption can decide before the first request. Uses ONLY the
// pre-request continuation signals (env / workspace marker) — never the
// wire-level sawContinuedSession, which is known too late to avoid minting the
// folder.
function _syncContinuationMode() {
  _v2Writer.setContinuationMode({
    continued: process.env.CCV_CLAUDE_CONTINUE === '1' || _continuedLaunchMarked,
    fork: isForkSession(),
    resume: isResumeSession(),
  });
}
_syncContinuationMode(); // seed from the CLI env at module load (`ccv -c`)

// 现在 _projectName/_logDir 已初始化，可以安全加载 proxy profile（含 workspace override）
// 并挂载 watchFile 同步列表变化。
_loadProxyProfile();
try { watchFile(PROFILE_PATH, { interval: 1500 }, _loadProxyProfile); } catch { }
_armWorkspaceActiveWatcher();

// Retry config: initial load + watchFile cross-process sync (UI writes
// retry-config.json → hot-reloaded within 1.5s, mirroring PROFILE_PATH above).
_loadRetryConfigState();
try { watchFile(RETRY_CONFIG_PATH, { interval: 1500 }, _loadRetryConfigState); } catch { }

// Kept as an awaited boot barrier for callers; nothing asynchronous remains
// since the v1 resume flow retired (v2 sessions key off wire session_ids).
const _initPromise = Promise.resolve();

export { LOG_FILE, _initPromise, _projectName, _logDir };

// 工作区模式：绑定指定路径的项目（v2 会话目录由 V2Writer 按需创建）。
// forceNew 仅存于签名兼容（Electron multi-tab 传入）：v2 下每个 claude 进程
// 天然是新 session，无旧文件可复用。
export function initForWorkspace(projectPath, { forceNew = false } = {}) { // eslint-disable-line no-unused-vars
  const projectName = projectKeyForCwd(projectPath);
  const dir = join(LOG_DIR, projectName);
  try { mkdirSync(dir, { recursive: true }); } catch {}

  _projectName = projectName;
  setProjectName(projectName);
  _logDir = dir;
  // Fresh workspace context — no carried names apply; future requests must
  // create session dirs under the NEW project.
  _agentSpawnRegistry.clear();
  _v2Writer.resetSessions(); // also clears the per-process `-c` adoption latch
  // A `--fork-session` / `-r` launch marks fork/resume intent; neither must
  // leak into a LATER workspace's `-c` (in a long-lived server that would
  // permanently suppress adoption). Clear both marks per launch and re-sync —
  // the workspace launcher re-marks right after if THIS launch is itself a
  // fork/resume. (`_continuedLaunchMarked` stays sticky on purpose: the migrate
  // prompt relies on it, and a stale continued flag is harmless — adoption also
  // requires the wire to actually replay assistant history.)
  _forkLaunchMarked = false;
  _resumeLaunchMarked = false;
  _syncContinuationMode();
  _armWorkspaceActiveWatcher(); // 工作区切换 → 监听新路径的 active-profile.json
  _loadProxyProfile(); // 重读该 workspace 的 active-profile.json

  return { filePath: '', dir, projectName, resumed: false };
}

// 工作区模式：重置日志状态（返回工作区列表时调用）
export function resetWorkspace() {
  _projectName = '';
  setProjectName('');
  _logDir = '';
  // Workspace context gone: drop carried teammate names — the registry is
  // module-global, and without this a rotation in the NEXT workspace would
  // write a sentinel carrying THIS workspace's names (unbounded growth +
  // cross-workspace leakage into the route's teammateNames snapshot).
  _agentSpawnRegistry.clear();
  _v2Writer.resetSessions(); // wire-v2: empty project → ingest no-ops until re-init
  _armWorkspaceActiveWatcher(); // _projectName 已空 → 摘掉旧路径 watcher
  _loadProxyProfile(); // workspace 上下文消失，回落到 profile.json.active
}

// Agent-spawn registry: prompt-prefix(60) → teammate name, accumulated from
// mainAgent responses. v2 identity keying (ConvResolver) is the surviving
// consumer; the v1 rotation-sentinel carry retired with rotation itself. The
// pure extraction/parsing lives in interceptor-core.js (unit-tested there).
const _agentSpawnRegistry = new Map();

function collectAgentSpawns(entry) {
  try {
    if (!entry || !entry.mainAgent) return;
    for (const [prefix, name] of extractAgentSpawnPairs(entry.response?.body)) {
      _agentSpawnRegistry.set(prefix, name);
    }
  } catch { }
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

  // The v2 queue drains on every exit path — close() falls back to synchronous
  // drain, so a Ctrl-C cannot strand queued lines. The 2s race is insurance:
  // a hung async appendFile (network FS, etc.) must never hold Ctrl-C hostage;
  // the sync-drain fallback inside close() is blocking and cannot hang on the
  // event loop.
  const _closeQueuesBounded = () => Promise.race([
    _v2Writer.close(),
    new Promise(resolve => { const t = setTimeout(resolve, 2000); if (t.unref) t.unref(); }),
  ]);
  process.on('SIGINT', () => {
    _closeQueuesBounded().then(() => cleanupViewer()).finally(() => process.exit(0));
  });

  process.on('SIGTERM', () => {
    _closeQueuesBounded().then(() => cleanupViewer()).finally(() => process.exit(0));
  });

  process.on('beforeExit', () => {
    _closeQueuesBounded().then(() => cleanupViewer());
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

    if (requestEntry?.mainAgent) {
      // 仅 mainAgent 请求时缓存模型名，避免 SubAgent 覆盖
      if (requestEntry.body?.model && typeof requestEntry.body.model === 'string') {
        _cachedModel = requestEntry.body.model;
        // 捕获 haiku 模型名供翻译接口使用
        if (/haiku/i.test(requestEntry.body.model)) {
          _cachedHaikuModel = requestEntry.body.model;
        }
      }
    }

    // 生成唯一请求 ID，用于关联在途请求和完成请求
    const requestId = `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    let _v2Handle = null;
    if (requestEntry) requestEntry.requestId = requestId;

    // 流式请求状态追踪（仅对 Claude API 流式请求）
    if (requestEntry?.isStream) {
      streamingState.active = true;
      streamingState.requestId = requestId;
      streamingState.startTime = Date.now();
      streamingState.model = requestEntry.body?.model || '';
      streamingState.bytesReceived = 0;
      streamingState.chunksReceived = 0;
    }

    // Proxy profile request rewriting —— 按角色（main/subagent/teammate）解析有效 profile。
    // 经 classifyProxyRole 正向分类（teammate 进程恒 teammate；utility 跟随主角色；
    // subagent 只认 cc_is_subagent=true 阳性标记；同进程 team 成员认 system 团队标记）。
    // 休眠：main=Default 且官方端点时 sub/teammate 分配不生效（存储保留），判定在请求时做
    // （_defaultConfig 首请求才捕获）。
    // 短路：无 main profile 且无任何角色分配时，角色不影响结果（_effProfile 恒 null），
    // 跳过分类的 system 文本提取开销 —— 未配置用户零成本。
    let _fetchUrl = url;
    let _fetchOpts = options;
    const _proxyRole = (!_activeProfile && _roleIds.subagent === 'follow' && _roleIds.teammate === 'follow')
      ? 'main'
      : classifyProxyRole(requestEntry?.body, {
        isTeammate: _isTeammate,
        isCountTokens: !!requestEntry?.isCountTokens,
        isHeartbeat: !!requestEntry?.isHeartbeat,
      });
    const _effProfile = _effectiveRoleProfile(_proxyRole);
    if (_effProfile && _effProfile.baseURL && requestEntry) {
      try {
        // 1. URL 重写: 用 baseURL 替换 origin，智能处理路径重叠
        //    baseURL="https://proxy.com/v1" + pathname="/v1/messages" → "https://proxy.com/v1/messages"（去重 /v1）
        //    baseURL="https://proxy.com"    + pathname="/v1/messages" → "https://proxy.com/v1/messages"（无重叠）
        if (typeof _fetchUrl === 'string') {
          const _origUrl = new URL(_fetchUrl);
          const _baseUrl = new URL(_effProfile.baseURL);
          const _basePath = _baseUrl.pathname.replace(/\/+$/, '');
          const _origPath = _origUrl.pathname;
          // 如果原始路径以 baseURL 的路径开头（如都有 /v1/），去掉重叠部分
          // 使用 _basePath + '/' 避免 /api 误匹配 /api-v2
          const _finalPath = (!_basePath || _origPath === _basePath || _origPath.startsWith(_basePath + '/')) ? _origPath : _basePath + _origPath;
          _fetchUrl = _baseUrl.origin + _finalPath + _origUrl.search;
        }
        // 2. Auth 替换 —— 兼容 lowercase / TitleCase，且 x-api-key / Authorization 同时替换以覆盖两种鉴权形式
        if (_effProfile.apiKey && _fetchOpts?.headers) {
          const h = _fetchOpts.headers;
          if (typeof h === 'object' && !(h instanceof Headers)) {
            const { headers: newHeaders, matchedAuthKey, matchedXApiKey } =
              _replaceProxyAuthHeaders(h, _effProfile.apiKey);
            _fetchOpts = { ..._fetchOpts, headers: newHeaders };

            // 诊断日志：让 stderr 能看到替换是否真的发生
            // 只输出"是否命中/是否写入"布尔，绝不输出任何 apiKey 明文或片段
            // （日志聚合/审计规则会把尾 N 字符一并标记为敏感泄漏）
            if (process.env.CCV_DEBUG_HOTSWITCH) {
              console.error('[ccv hotswitch]', {
                profile: _effProfile.name,
                role: _proxyRole,
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
        const _targetModel = _oldModel ? resolveProfileModel(_oldModel, _effProfile) : null;
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
        if (_effProfile.effort && typeof _fetchOpts?.body === 'string' &&
            !requestEntry.isCountTokens && !requestEntry.isHeartbeat) {
          const _hasOutputConfig = (_rb && typeof _rb === 'object')
            ? (!!_rb.output_config && typeof _rb.output_config === 'object')
            : _fetchOpts.body.includes('"output_config"');
          const _injected = injectOutputConfigEffort(_fetchOpts.body, _effProfile.effort, _hasOutputConfig);
          if (_injected !== null) _fetchOpts = { ..._fetchOpts, body: _injected };
        }
        // 记录 proxy 信息到日志条目（proxyRole 仅在发生改写时打标，与该条目的 proxy 信息绑定）
        requestEntry.proxyProfile = _effProfile.name;
        requestEntry.proxyUrl = _fetchUrl;
        requestEntry.proxyRole = _proxyRole;
      } catch { }
    }

    if (requestEntry) {
      // v2 req-phase ingest: journal seq is allocated inside, still in the
      // fetch hook's synchronous segment (the proxy rewrite above is fully
      // synchronous) — initiation order can never diverge from arrival order
      // (§3.7 guard). Running AFTER the rewrite lets the journal req line
      // capture proxyProfile/proxyUrl (they are assigned inside the rewrite;
      // ingesting earlier silently dropped them — 1.8 review finding). The
      // entry carries the pristine wire messages (the delta mutation retired
      // with v1 write). Internally caught; the outer catch is belt-and-braces
      // for a broken guard, same as _writeCompletedEntry — an escaping throw
      // is a dropped entry and must be reported, never silent. The journal req
      // line replaces the v1 in-flight placeholder pre-write.
      try { _v2Handle = _v2Writer.ingestRequest(requestEntry, null); }
      catch (err) { reportSwallowed('interceptor.ingest-request', err); }
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
              // 413 → 禁用当次流式，后续全由最终 v2 completion 交付
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


                      // 移除在途请求标记，保持原始报文（seam 内先做 v2 completion ingest）
                      _writeCompletedEntry(requestEntry, _v2Handle);
                      // Release memory: clear large objects after disk write
                      streamedChunks = [];
                      streamedContentLen = 0;
                      requestEntry.response = null;
                      resetStreamingState();
                    } catch (err) {
                      requestEntry.response.body = fullContent.slice(0, 1000);
                      _writeCompletedEntry(requestEntry, _v2Handle);
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
          _writeCompletedEntry(requestEntry, _v2Handle);
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

          _writeCompletedEntry(requestEntry, _v2Handle);
        } catch (err) {
          _writeCompletedEntry(requestEntry, _v2Handle);
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
