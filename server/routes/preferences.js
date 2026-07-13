// Preferences, Claude settings, and proxy-profile routes (moved verbatim from server.js).
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { LOG_DIR, setLogDir, getClaudeConfigDir } from '../../findcc.js';
import { PROFILE_PATH, _defaultConfig, getActiveProfileId, setActiveProfileForWorkspace, _loadProxyProfile, RETRY_CONFIG_PATH, _retryConfigState, _loadRetryConfigState } from '../interceptor.js';
import { migrateProxyProfileList } from '../lib/interceptor-core.js';
import { DEFAULT_RETRY_CONFIG, validateRetryConfig, resolveRetryConfig } from '../lib/proxy-retry.js';
import { discoverCcSwitchProviders, mergeImportedProfiles } from '../lib/ccswitch-import.js';
import { setLang } from '../i18n.js';
import { reconcileVoicePackPrefs as vpReconcile } from '../lib/voice-pack-manager.js';
import { readClaudeProjectModel } from '../lib/context-watcher.js';
import { sendEventToClients } from '../lib/log-watcher.js';
import { listPlatforms } from '../lib/im-config.js';
import { mutatePrefs, applyPrefsPatch, readPrefsRaw } from '../lib/prefs-store.js';
import {
  getCurrentProjectKey, getCurrentProjectName, hasFork, listForks, resolveScoped,
} from '../lib/project-prefs.js';

// IM bridge configs (dingtalk, feishu, …) carry base64 app secrets and are only exposed via the
// admin-only /api/dingtalk/* and /api/im/* surfaces (with secrets masked). Strip every platform's
// key from any /api/preferences read/write so an authorized LAN client can never see or set them.
function stripImConfigs(obj) {
  if (obj) for (const id of listPlatforms()) delete obj[id];
}

// /theme 选择器特征：选项文案高特异、不太可能出现在普通生成输出里（ESC 兜底的门控签名）
const THEME_PICKER_RE = /Auto \(match terminal\)|colorblind-friendly/;

// 并发切主题防重入：双端同时 POST themeColor 时只允许一条 /theme 同步链路在途，
// 防止双监听器 + 双 /theme 注入 + 双 ESC（后到的 POST 仅落盘偏好，跳过 PTY 同步）。
let _themeSyncInFlight = false;
export function _resetThemeSyncForTests() { _themeSyncInFlight = false; }

function preferencesGet(req, res, parsedUrl, isLocal, deps) {
  let prefs = {};
  try { if (existsSync(deps.getPrefsFile())) prefs = JSON.parse(readFileSync(deps.getPrefsFile(), 'utf-8')); } catch { }
  // auth 配置(含明文密码)与偏好同存于 preferences.json,但绝不能从这里下发 ——
  // 密码仅由 admin-only 的 /api/auth/state 暴露给本机。否则远程密码登录用户也能读到明文。
  // 全局 auth 与每个项目的 authByProject 覆盖都要剥离(后者同样含明文密码)。
  delete prefs.auth;
  delete prefs.authByProject;
  stripImConfigs(prefs); // dingtalk / feishu / … — admin-only, never to a LAN client
  // 项目独立配置（多人共用一台 server 时按项目隔离偏好）：非本机(LAN)客户端若当前项目有 fork，
  // 解析出该项目的有效偏好；本机(admin)始终看全局。forks blob 绝不下发，仅以 _projectPrefsKeys
  // 元信息告知本机管理入口该不该出现。元字段以 _ 前缀标记，POST 侧会剥离不落盘。
  const _projectKey = getCurrentProjectKey();
  const _scoped = !isLocal && hasFork(prefs, _projectKey);
  const _forkKeys = isLocal ? listForks(prefs) : null; // 计算需早于 delete prefsByProject
  const _fork = _scoped ? prefs.prefsByProject[_projectKey] : null;
  delete prefs.prefsByProject;
  if (_scoped) {
    prefs = resolveScoped(prefs, _fork);
    // 防御性二次剥离：fork 按构造已不含密码/IM（写入侧已剥），但这是唯一把 fork 内容下发给远程
    // 客户端的读路径，与 admin 列表口保持对称——手改 preferences.json 注入的脏 fork 也不会泄露。
    delete prefs.auth;
    delete prefs.authByProject;
    stripImConfigs(prefs);
  }
  prefs.logDir = LOG_DIR; // 始终返回当前运行时的日志目录
  // 日志设置出厂默认"继承"：键缺失（从未设置过）才注入；显式关闭持久化的是 null（键存在），不覆盖。
  // 虚拟默认 —— 仅注入回包不落盘（GET 不写文件），直接读 preferences.json 的代码看不到该默认。
  if (!('resumeAutoChoice' in prefs)) prefs.resumeAutoChoice = 'continue';
  // home-friendly 展示形态：设了 CLAUDE_CONFIG_DIR 的用户看到真实路径，默认用户看到 "~/.claude"
  // join() 而非字符串拼接，避免 Windows 分隔符不匹配导致比较失败
  const _cDir = getClaudeConfigDir();
  prefs.claudeConfigDir = _cDir === join(homedir(), '.claude') ? '~/.claude' : _cDir;
  // voice-pack id reconcile — strip references to audio files that no longer exist
  // so the client never tries to play a 404. Read-only here; client save path also runs this.
  if (prefs.approvalModal?.voicePack) {
    prefs.approvalModal.voicePack = vpReconcile(LOG_DIR, prefs.approvalModal.voicePack);
  }
  // 项目独立配置元信息（_ 前缀 = 仅回包、不落盘；POST 侧统一剥离）：前端据此决定
  // 非本机显示"启动项目独立配置"开关、本机在有 fork 时显示"配置管理"入口。
  prefs._isLocal = isLocal;
  prefs._projectName = getCurrentProjectName();
  prefs._projectScoped = _scoped;
  if (isLocal) prefs._projectPrefsKeys = _forkKeys;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(prefs));
}

function preferencesPost(req, res, parsedUrl, isLocal, deps) {
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > deps.MAX_POST_BODY) req.destroy(); });
  req.on('end', async () => {
    // 解析与持久化分两段 try：JSON 坏 → 400 'Invalid JSON'；写盘/取锁失败 → 500/503（不再被误报成
    // 400 让客户端以为是请求体问题、也不重试瞬时锁超时）。
    let incoming;
    try { incoming = JSON.parse(body); }
    catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }
    try {
      // auth 只能经 admin-only 的 /api/auth/config 修改;剥掉 incoming.auth 与 incoming.authByProject
      // 防止任意已授权客户端(含远程密码登录用户)借 /api/preferences 改开关/密码、或植入/篡改
      // 任意项目的覆盖,绕过 admin 门禁。
      delete incoming.auth;
      delete incoming.authByProject;
      // prefsByProject(项目独立配置 fork)只能经 admin-only 的 /api/project-prefs/* 修改；元字段
      // (_isLocal/_projectScoped/…)仅 GET 回包，绝不让它们经 /api/preferences 落盘污染。
      delete incoming.prefsByProject;
      for (const k of Object.keys(incoming)) if (k[0] === '_') delete incoming[k];
      // IM bridge configs 同理：只能经 admin-only 的 /api/dingtalk/config、/api/im/* 修改，禁止借
      // /api/preferences 植入凭据。
      stripImConfigs(incoming);
      // 切日志目录：把旧文件的完整内容（含 auth 密码 / prefsByProject forks / 其它偏好）带到新位置，
      // 避免切目录后密码与各项目 fork 凭空消失；并把写目标在 setLogDir 前后固定为"新文件"，让本次
      // 合并只跑在一个文件 / 一把锁上（不再因 LOG_DIR 中途漂移而劈裂进程内锁队列）。
      let targetFile = deps.getPrefsFile();
      let carried = null;
      if (incoming.logDir && typeof incoming.logDir === 'string') {
        carried = readPrefsRaw(targetFile); // 旧文件全量（锁外读，迁移属罕见 admin 操作）
        setLogDir(incoming.logDir);
        targetFile = deps.getPrefsFile();
      }
      // 全局写入：locked + atomic（prefs-store），与 fork 写共用同一把锁，避免并发写互相覆盖含密码的
      // preferences.json。Deep-merge approvalModal 的逻辑下沉到 applyPrefsPatch，与 /api/project-prefs
      // 的 fork 写共用一份合并实现，防止两路漂移。
      const prefs = await mutatePrefs((p) => {
        // 迁移：把旧文件里新文件尚无的键（auth/forks/其它偏好）带过来，再应用本次补丁
        if (carried) for (const k of Object.keys(carried)) if (!(k in p)) p[k] = carried[k];
        applyPrefsPatch(p, incoming, { logDir: LOG_DIR });
      }, targetFile);
      // UI 切语言时同步服务端 i18n currentLang，让 DingTalk 桥接等服务端 t() 立即跟随。
      // setLang 自带 locale 校验，非法值回落 en。
      if (incoming.lang) setLang(incoming.lang);
      // 主题切换时同步到 Claude Code CLI：发 /theme，监听输出验证结果。
      // 现代 CLI（≥2.x）的 /theme 是交互式选择器（args 被忽略），注入后对话框可能
      // 残留在终端：
      //   - mismatch 时**不再重发** /theme —— toggle 语义已不存在，重发只会把选择器
      //     再次打开，把终端困进"确认-重开"循环（Windows ConPTY 下每轮全屏重绘洪泛）。
      //   - 5s 超时若 buf 检出选择器特征（选项文案，见 THEME_PICKER_RE），补发一次
      //     ESC 关闭残留对话框。无特征绝不发 ESC —— CLI 正在流式生成时 /theme 只是被
      //     排队、对话框未开，误发 ESC 会 interrupt 用户正在跑的任务（宁漏关不误发）。
      if (incoming.themeColor && deps.writeToPty && deps.onPtyData && !_themeSyncInFlight) {
        _themeSyncInFlight = true;
        const target = incoming.themeColor === 'light' ? 'light' : 'dark';
        let buf = '';
        const removeListener = deps.onPtyData((data) => {
          buf += data;
          if (buf.length > 4096) buf = buf.slice(-2048); // 限制 buf 大小
          // 解析 PTY 输出中的 "Theme set to light" 或 "Theme set to dark"
          const match = buf.match(/Theme set to (light|dark)/);
          if (match) {
            removeListener();
            clearTimeout(timeout);
            _themeSyncInFlight = false;
            if (match[1] !== target) {
              console.warn(`[preferences] CLI theme sync mismatch: got ${match[1]}, wanted ${target} (no retry; modern /theme is an interactive picker)`);
            }
          }
        });
        // 5 秒超时，避免监听器泄漏；检出选择器残留时 ESC 兜底关闭
        const timeout = setTimeout(() => {
          removeListener();
          _themeSyncInFlight = false;
          if (THEME_PICKER_RE.test(buf)) {
            try { deps.writeToPty('\x1b'); } catch {}
          }
        }, 5000);
        try { deps.writeToPty('/theme\r'); } catch {}
      }
      // 回显里也剥离 auth/authByProject(含 base64 密码) —— GET 已剥离,POST 回显同样不能漏给
      // 已授权的远程客户端。磁盘上的值已在上面写入,这里只清内存对象供响应用。
      delete prefs.auth;
      delete prefs.authByProject;
      delete prefs.prefsByProject; // fork blob 绝不回显（与 GET 一致）
      stripImConfigs(prefs);
      prefs.logDir = LOG_DIR;
      // 与 GET 一致：回显里补齐 resumeAutoChoice 虚拟默认（已在上方落盘，文件不含该默认值）
      if (!('resumeAutoChoice' in prefs)) prefs.resumeAutoChoice = 'continue';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(prefs));
    } catch (err) {
      // 写盘/取锁失败：锁超时 → 503（瞬时，客户端可重试）；其余持久化错误 → 500。绝不再用 400。
      const isLockTimeout = /Lock acquisition timeout/.test(err?.message || '');
      res.writeHead(isLockTimeout ? 503 : 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to save preferences' }));
    }
  });
}

function claudeSettingsGet(req, res, parsedUrl, isLocal, deps) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  const fileEnv = deps.claudeSettings.env || {};
  // 与 Claude Code 保持一致：settings.json env 优先，fallback 到 process.env
  const env = { ...fileEnv };
  if (!env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS && process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS) {
    env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS;
  }
  // claudeProjectModel：从 ~/.claude.json projects[cwd].lastModelUsage 推断，
  // 给前端血条 calibration 'auto' 模式作启动期回落（避免 haiku init ping 让血条
  // 错显 200K，详见 src/utils/helpers.js resolveCalibrationTokens）。
  const projectCwd = process.env.CCV_PROJECT_DIR || process.cwd();
  const claudeSettings = deps.claudeSettings;
  res.end(JSON.stringify({ env, model: claudeSettings.model || null, showThinkingSummaries: claudeSettings.showThinkingSummaries || false, claudeAvailable: process.env.CCV_CLAUDE_MISSING !== '1', claudeProjectModel: readClaudeProjectModel(projectCwd) }));
}

function claudeSettingsPost(req, res, parsedUrl, isLocal, deps) {
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > deps.MAX_POST_BODY) req.destroy(); });
  req.on('end', () => {
    try {
      const incoming = JSON.parse(body);
      const settingsPath = join(getClaudeConfigDir(), 'settings.json');
      let settings = {};
      try { if (existsSync(settingsPath)) settings = JSON.parse(readFileSync(settingsPath, 'utf-8')); } catch { }
      Object.assign(settings, incoming);
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      Object.assign(deps.claudeSettings, incoming);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
  });
}

function proxyProfilesGet(req, res, parsedUrl, isLocal, deps) {
  try {
    let data = existsSync(PROFILE_PATH) ? JSON.parse(readFileSync(PROFILE_PATH, 'utf-8')) : deps.defaultProxyProfiles;
    // 旧配置一次性迁移（models/activeModel → ANTHROPIC_MODEL）；有变更则回写磁盘并刷新 active profile。
    if (Array.isArray(data.profiles)) {
      const { profiles: migrated, changed } = migrateProxyProfileList(data.profiles);
      if (changed) {
        data = { ...data, profiles: migrated };
        try {
          mkdirSync(dirname(PROFILE_PATH), { recursive: true });
          writeFileSync(PROFILE_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
          _loadProxyProfile();
        } catch { /* 迁移落盘失败不阻塞 GET；下次仍会尝试 */ }
      }
    }
    // 用 interceptor.getActiveProfileId() 返回 effective active（workspace > profile.json.active > 'max'）
    const effectiveActive = getActiveProfileId();
    // 本机(127.0.0.1)= admin：下发明文 profile.apiKey 供本人在编辑表单(👁 折叠)里查阅/复制；已授权
    // 的远程客户端只拿脱敏值(****+后4位)。保存时若回传脱敏值，POST 侧 isMasked() 会保留磁盘原值。
    // 镜像 /api/auth/state 的密码、/api/dingtalk/status 的 appSecret 策略。
    const full = { ...data, active: effectiveActive };
    const payload = isLocal ? full : deps.maskProfiles(full);
    // defaultConfig.apiKey 始终脱敏：它在列表里是常显文本(无 👁 折叠)，且 Max/OAuth 默认配置的 key
    // 可能是 OAuth token；只有可编辑 profile 的 key 才按 isLocal 明文下发。
    if (_defaultConfig) payload.defaultConfig = { ..._defaultConfig, apiKey: _defaultConfig.apiKey ? deps.maskApiKey(_defaultConfig.apiKey) : null };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  } catch {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(deps.defaultProxyProfiles));
  }
}

function proxyProfilesPost(req, res, parsedUrl, isLocal, deps) {
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > deps.MAX_POST_BODY) req.destroy(); });
  req.on('end', () => {
    try {
      const incoming = JSON.parse(body);
      if (!incoming || typeof incoming !== 'object' || !Array.isArray(incoming.profiles)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid profile data: profiles must be an array' }));
        return;
      }
      // 确保 max profile 始终存在
      if (!incoming.profiles.some(p => p.id === 'max')) {
        incoming.profiles = [{ id: 'max', name: 'Default' }, ...(incoming.profiles || [])];
      }
      // 如果 apiKey 是 mask 值（未修改），从磁盘读取原始值保留
      let existing = {};
      try { if (existsSync(PROFILE_PATH)) existing = JSON.parse(readFileSync(PROFILE_PATH, 'utf-8')); } catch { }
      const existingMap = {};
      if (existing.profiles) existing.profiles.forEach(p => { if (p.apiKey) existingMap[p.id] = p.apiKey; });
      for (const p of incoming.profiles) {
        if (p.apiKey && deps.isMasked(p.apiKey) && existingMap[p.id]) {
          p.apiKey = existingMap[p.id];
        }
      }
      // 只写 profiles 列表到 profile.json；active 不再入文件（避免跨进程串台）
      // 保留老数据里的 active 字段不变，以便老版本 ccv 或手动编辑者的回退能力
      const toWrite = { ...existing, profiles: incoming.profiles };
      const dir = dirname(PROFILE_PATH);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(PROFILE_PATH, JSON.stringify(toWrite, null, 2), { mode: 0o600 });
      // active 走 workspace 级别存储（当前进程独占）
      if (typeof incoming.active === 'string' && incoming.active) {
        setActiveProfileForWorkspace(incoming.active);
      } else {
        _loadProxyProfile(); // 仅列表变化时也刷新一次以反映删除 / 重命名
      }
      // SSE 广播仅给本进程客户端（sendEventToClients 本就是 per-process；另外 active 不跨进程）
      const effectiveActive = getActiveProfileId();
      const activeProfile = incoming.profiles?.find(p => p.id === effectiveActive) || null;
      const maskedProfile = activeProfile?.apiKey ? { ...activeProfile, apiKey: deps.maskApiKey(activeProfile.apiKey) } : activeProfile;
      sendEventToClients(deps.clients, 'proxy_profile', { active: effectiveActive, profile: maskedProfile });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
  });
}

// ── 代理重试配置（GET/POST，仿 proxyProfilesGet/Post，但无密钥脱敏、无 workspace 隔离）──
// 返回 { config, defaults }：config = 当前生效（env 基础 + retry-config.json 覆盖后的 live binding）；
// defaults = DEFAULT_RETRY_CONFIG，供 UI「恢复默认」按钮参照。

function retryConfigGet(req, res, _parsedUrl, _isLocal, _deps) {
  try {
    // _retryConfigState 是 live binding（watchFile 刷新），即当前生效配置。
    // 缺省兜底：若拦截器尚未初始化（理论上不会，但防御性），即时解析一次。
    const config = _retryConfigState || resolveRetryConfig();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ config, defaults: DEFAULT_RETRY_CONFIG }));
  } catch {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ config: DEFAULT_RETRY_CONFIG, defaults: DEFAULT_RETRY_CONFIG }));
  }
}

function retryConfigPost(req, res, _parsedUrl, _isLocal, deps) {
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > deps.MAX_POST_BODY) req.destroy(); });
  req.on('end', () => {
    try {
      const incoming = JSON.parse(body);
      if (!incoming || typeof incoming !== 'object' || !incoming.config || typeof incoming.config !== 'object') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid retry config: expected { config: {...} }' }));
        return;
      }
      // 校验 + 归一化（与 resolveRetryConfig 共用 validateRetryConfig，单一真源）
      const validated = validateRetryConfig(incoming.config);
      // 合并默认值，保证写盘的是完整配置（缺字段回落默认，避免读到半截配置）
      const toWrite = { ...DEFAULT_RETRY_CONFIG, ...validated };
      const dir = dirname(RETRY_CONFIG_PATH);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(RETRY_CONFIG_PATH, JSON.stringify(toWrite, null, 2), { mode: 0o600 });
      // 立即刷新本进程 live binding（不等 watchFile 1.5s 轮询）
      _loadRetryConfigState();
      // SSE 广播给本进程所有客户端（同 proxy_profile 模式）
      sendEventToClients(deps.clients, 'retry_config', { config: _retryConfigState });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
  });
}

// ── cc-switch 导入 ─────────────────────────────────────
// cc-switch 是 Tauri 桌面应用，把供应商凭证存 SQLite（cc-switch.db providers 表）。
// 本路由跨平台探测 cc-switch 数据目录，只读查 claude 类型供应商，映射成 cc-viewer profile。
// GET=预览（不落盘）；POST=执行导入（merge 进 profile.json + SSE 广播刷新）。

async function ccswitchProvidersGet(req, res, _parsedUrl, isLocal, _deps) {
  try {
    const result = await discoverCcSwitchProviders();
    // 脱敏：非本机不下发明文 apiKey（与 proxyProfilesGet 的 maskProfiles 策略一致）
    const profiles = isLocal ? result.profiles : (result.profiles || []).map(p => ({
      ...p,
      apiKey: p.apiKey ? `${p.apiKey.slice(0, 4)}****` : '',
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      profiles,
      currentId: result.currentId || null,
      dbPath: result.dbPath,
      error: result.error,
    }));
  } catch (err) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ profiles: [], error: String(err && err.message || err) }));
  }
}

// POST body 可选 { setActive: true } —— 是否把 cc-switch 的 current 设为 cc-viewer active。
// 默认不设（避免覆盖用户当前选择）。导入只 merge 列表，凭证刷新幂等。
async function ccswitchImportPost(req, res, _parsedUrl, isLocal, deps) {
  if (!isLocal) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'cc-switch import is local-only' }));
    return;
  }
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > deps.MAX_POST_BODY) req.destroy(); });
  req.on('end', async () => {
    try {
      const incoming = body ? JSON.parse(body) : {};
      const setActive = incoming && incoming.setActive === true;
      const result = await discoverCcSwitchProviders();
      if (result.error && result.profiles.length === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: result.error, imported: 0, updated: 0 }));
        return;
      }
      // 读现有 profile.json
      let existing = { profiles: [] };
      try {
        if (existsSync(PROFILE_PATH)) existing = JSON.parse(readFileSync(PROFILE_PATH, 'utf-8'));
      } catch { /* 首次导入无文件 */ }
      // merge
      const merged = mergeImportedProfiles(existing.profiles || [], result.profiles);
      const toWrite = { ...existing, profiles: merged.profiles };
      // 落盘
      const dir = dirname(PROFILE_PATH);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(PROFILE_PATH, JSON.stringify(toWrite, null, 2), { mode: 0o600 });
      // active 处理：setActive=true 且 cc-switch 有 current → 切换；否则保持现状
      let activeChanged = false;
      if (setActive && result.currentId) {
        setActiveProfileForWorkspace(result.currentId);
        activeChanged = true;
      } else {
        _loadProxyProfile(); // 刷新列表（可能增删了）
      }
      // SSE 广播给前端刷新（profile: 'refresh' 是 truthy 哨兵，
      // 触发 AppBase SSE handler 的 if(data.profile) 重新 GET 全量列表）
      const effectiveActive = getActiveProfileId();
      sendEventToClients(deps.clients, 'proxy_profile', {
        active: effectiveActive,
        profile: 'refresh',
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        imported: merged.imported,
        updated: merged.updated,
        total: merged.profiles.length,
        activeChanged,
        dbPath: result.dbPath,
      }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err && err.message || err) }));
    }
  });
}

export const preferencesRoutes = [
  { method: 'GET', match: 'exact', path: '/api/preferences', handler: preferencesGet },
  { method: 'POST', match: 'exact', path: '/api/preferences', handler: preferencesPost },
  { method: 'GET', match: 'exact', path: '/api/claude-settings', handler: claudeSettingsGet },
  { method: 'POST', match: 'exact', path: '/api/claude-settings', handler: claudeSettingsPost },
  { method: 'GET', match: 'exact', path: '/api/proxy-profiles', handler: proxyProfilesGet },
  { method: 'POST', match: 'exact', path: '/api/proxy-profiles', handler: proxyProfilesPost },
  { method: 'GET', match: 'exact', path: '/api/retry-config', handler: retryConfigGet },
  { method: 'POST', match: 'exact', path: '/api/retry-config', handler: retryConfigPost },
  { method: 'GET', match: 'exact', path: '/api/ccswitch-providers', handler: ccswitchProvidersGet },
  { method: 'POST', match: 'exact', path: '/api/ccswitch-import', handler: ccswitchImportPost },
];
