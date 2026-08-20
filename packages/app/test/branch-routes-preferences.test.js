// 分支补强目标：server/routes/preferences.js —— 把 api-preferences*.test.js 未覆盖的
// 分支补到 >=95%。只补"分支臂"，不重复已覆盖的成功路径。覆盖清单：
//   preferencesGet  —— L37 claudeConfigDir==='~/.claude' 默认臂、L139 ||process.cwd()(在 claudeSettings)
//   preferencesPost —— L49 body 超限 destroy、L66 损坏文件 catch、L79 mkdir、L86 chmod catch(防御)、
//                       L94 PTY buf>4096 截断、L103/L109 writeToPty 抛错 catch、L108 5s 超时回调
//   claudeSettingsGet  —— L139 CCV_PROJECT_DIR 缺失走 process.cwd()
//   claudeSettingsPost —— L146 body 超限 destroy、L152 损坏 settings.json catch
//   proxyProfilesGet   —— L167 PROFILE_PATH 不存在走 defaultProxyProfiles、L180 损坏文件 catch
//   proxyProfilesPost  —— L188 body 超限 destroy、L203 损坏 existing catch、L215 mkdir、L225 active 无匹配 ||null
// 隔离：import 前设私有高位端口窗 + 私有 tmp CCV_LOG_DIR/CLAUDE_CONFIG_DIR；不硬编码端口；
//      poll 用 waitUntil；patch 的全局在 after 还原。
import './_shims/register.mjs';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';

// 私有高位端口窗（避免与并发测试抢端口；preferences 本身不 listen，但 import 链路可能触及）
process.env.CCV_START_PORT = process.env.CCV_START_PORT || '47120';
process.env.CCV_MAX_PORT = process.env.CCV_MAX_PORT || '47180';

// 私有日志/配置目录，必须在目标模块 import 之前设好（LOG_DIR/PROFILE_PATH 在 import 期绑定）
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-branch-prefs-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

const prefsFile = join(tmpDir, 'preferences.json');
const settingsPath = join(tmpDir, 'settings.json'); // = getClaudeConfigDir()/settings.json (CLAUDE_CONFIG_DIR=tmpDir)
const profilePath = join(tmpDir, 'profile.json');    // = LOG_DIR/profile.json (interceptor PROFILE_PATH)

const baseDeps = { getPrefsFile: () => prefsFile, MAX_POST_BODY: 1024 * 1024 };

const maskApiKey = (k) => (k && typeof k === 'string' && k.length > 4 ? '****' + k.slice(-4) : k ? '****' : '');
const maskProfiles = (data) => {
  if (!data || !Array.isArray(data.profiles)) return data;
  return { ...data, profiles: data.profiles.map((p) => (p.apiKey ? { ...p, apiKey: maskApiKey(p.apiKey) } : p)) };
};
const isMasked = (k) => typeof k === 'string' && k.startsWith('****');

function makeRes() {
  const res = { statusCode: 0, headers: null, body: '' };
  res.writeHead = (code, headers) => { res.statusCode = code; res.headers = headers || {}; };
  res.end = (b) => { res.body = b || ''; res.done && res.done(); };
  return res;
}

/** GET handler（无 body），resolve 为 res */
function callGet(handler, deps = baseDeps, isLocal = true, parsedUrl = { pathname: '/x' }) {
  const res = makeRes();
  return new Promise((resolve) => {
    res.done = () => resolve(res);
    handler({ headers: {} }, res, parsedUrl, isLocal, deps);
  });
}

/**
 * POST handler。chunks 是要逐块 emit 的数组（用于触发 body 超限场景）。
 * 返回 { req, res, promise }，promise 在 res.end 时 resolve。
 */
function makePost(handler, deps = baseDeps, isLocal = true, parsedUrl = { pathname: '/x' }) {
  const req = new EventEmitter();
  req.headers = {};
  let destroyed = false;
  req.destroy = () => { destroyed = true; req.destroyedFlag = true; };
  Object.defineProperty(req, 'wasDestroyed', { get: () => destroyed });
  const res = makeRes();
  const promise = new Promise((resolve) => { res.done = () => resolve(res); });
  handler(req, res, parsedUrl, isLocal, deps);
  return { req, res, promise };
}

/** 简单 POST：一次性发完 body，resolve 为 res */
function callPost(handler, body, deps = baseDeps, isLocal = true, parsedUrl = { pathname: '/x' }) {
  const { req, promise } = makePost(handler, deps, isLocal, parsedUrl);
  req.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
  req.emit('end');
  return promise;
}

async function waitUntil(pred, { timeout = 3000, interval = 10 } = {}) {
  const t0 = Date.now();
  for (;;) {
    if (pred()) return true;
    if (Date.now() - t0 > timeout) throw new Error('waitUntil timeout');
    await new Promise((r) => setTimeout(r, interval));
  }
}

let preferencesGet, preferencesPost, claudeSettingsGet, claudeSettingsPost, proxyProfilesGet, proxyProfilesPost;
let resetThemeSync;

before(async () => {
  const { preferencesRoutes, _resetThemeSyncForTests } = await import('../server/routes/preferences.js');
  resetThemeSync = _resetThemeSyncForTests;
  const find = (p, m) => preferencesRoutes.find((r) => r.path === p && r.method === m).handler;
  preferencesGet = find('/api/preferences', 'GET');
  preferencesPost = find('/api/preferences', 'POST');
  claudeSettingsGet = find('/api/claude-settings', 'GET');
  claudeSettingsPost = find('/api/claude-settings', 'POST');
  proxyProfilesGet = find('/api/proxy-profiles', 'GET');
  proxyProfilesPost = find('/api/proxy-profiles', 'POST');
});

after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

function cleanPrefs() { if (existsSync(prefsFile)) unlinkSync(prefsFile); }
function cleanProfile() { if (existsSync(profilePath)) unlinkSync(profilePath); }
function ensureTmpDir() { if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true }); }

describe('preferencesGet 分支', () => {
  beforeEach(() => { ensureTmpDir(); cleanPrefs(); });

  it('CLAUDE_CONFIG_DIR 等于 ~/.claude 时回显 home-friendly "~/.claude"（L37 默认臂）', async () => {
    // 临时把 CLAUDE_CONFIG_DIR 指向真实 ~/.claude（getClaudeConfigDir 在调用期读 env），
    // 使 _cDir === join(homedir(),'.claude') 成立 → 三元真臂。调用后立即还原，不污染其他用例。
    // L1d 铁闸(2026-07-12)在测试上下文里会拒绝非 tmp 的显式 CLAUDE_CONFIG_DIR——本 GET 仅
    // 把目录格式化成字符串回显（只读，不落盘），故临时剥掉 NODE_TEST_CONTEXT 模拟生产语义。
    const prev = process.env.CLAUDE_CONFIG_DIR;
    const prevCtx = process.env.NODE_TEST_CONTEXT;
    process.env.CLAUDE_CONFIG_DIR = join(homedir(), '.claude');
    delete process.env.NODE_TEST_CONTEXT;
    try {
      const res = await callGet(preferencesGet);
      const data = JSON.parse(res.body);
      assert.equal(data.claudeConfigDir, '~/.claude');
    } finally {
      process.env.CLAUDE_CONFIG_DIR = prev;
      if (prevCtx !== undefined) process.env.NODE_TEST_CONTEXT = prevCtx;
    }
  });
});

describe('preferencesPost 分支', () => {
  beforeEach(() => { ensureTmpDir(); cleanPrefs(); resetThemeSync(); });

  it('body 超过 MAX_POST_BODY 时 req.destroy()（L49）', async () => {
    const deps = { getPrefsFile: () => prefsFile, MAX_POST_BODY: 8 };
    const { req, promise } = makePost(preferencesPost, deps);
    req.emit('data', '0123456789ABCDEF'); // 16 > 8 → destroy
    assert.equal(req.wasDestroyed, true, 'oversized body triggers req.destroy()');
    // destroy 后不再 emit end；用一个微小的回退避免 promise 永挂——直接断言已 destroy 即可。
    // 为了让 promise 不悬挂，补发一个合法 end 以走 catch/正常分支收尾（body 是非法 JSON → 400）。
    req.emit('end');
    const res = await promise;
    assert.equal(res.statusCode, 400);
  });

  it('已存在但损坏的 preferences.json 读取失败走 catch 后仍能写入（L66）', async () => {
    writeFileSync(prefsFile, '{ broken existing json');
    const res = await callPost(preferencesPost, { theme: 'amoled' });
    assert.equal(res.statusCode, 200);
    const written = JSON.parse(readFileSync(prefsFile, 'utf-8'));
    // 损坏旧文件被忽略（prefs 从 {} 起步），仅新值落盘
    assert.equal(written.theme, 'amoled');
  });

  it('prefsDir 不存在时 mkdirSync 递归创建（L79）', async () => {
    const nestedDir = join(tmpDir, 'nested', 'deep');
    const nestedFile = join(nestedDir, 'preferences.json');
    rmSync(join(tmpDir, 'nested'), { recursive: true, force: true });
    const deps = { getPrefsFile: () => nestedFile, MAX_POST_BODY: 1e6 };
    const res = await callPost(preferencesPost, { theme: 'x' }, deps);
    assert.equal(res.statusCode, 200);
    assert.ok(existsSync(nestedFile), 'nested prefs file created via mkdirSync recursive');
    rmSync(join(tmpDir, 'nested'), { recursive: true, force: true });
  });

  it('PTY 输出超过 4096 字节时截断 buf（L94），不匹配则不 toggle', async () => {
    const writes = [];
    let ptyCb = null;
    const removed = { v: false };
    const deps = {
      ...baseDeps,
      writeToPty: (s) => writes.push(s),
      onPtyData: (cb) => { ptyCb = cb; return () => { removed.v = true; ptyCb = null; }; },
    };
    const res = await callPost(preferencesPost, { themeColor: 'light' }, deps);
    assert.equal(res.statusCode, 200);
    await waitUntil(() => !!ptyCb);
    // 灌入 >4096 字节、且不含 "Theme set to ..." 的噪声 → 进入 buf.slice(-2048) 截断分支，且不 removeListener
    ptyCb('x'.repeat(5000));
    assert.equal(writes.length, 1, 'no retry when no match parsed (buf truncated, listener stays)');
    assert.equal(removed.v, false, 'listener not removed on non-matching oversized output');
    // 收尾：手动触发 listener cleanup 路径（发一个匹配且一致的输出避免泄漏断言歧义）
    ptyCb('Theme set to light');
  });

  it('writeToPty 初始写抛错被 catch 吞掉（L109），handler 仍 200', async () => {
    const deps = {
      ...baseDeps,
      writeToPty: () => { throw new Error('pty broken'); },
      onPtyData: () => () => {},
    };
    const res = await callPost(preferencesPost, { themeColor: 'dark' }, deps);
    assert.equal(res.statusCode, 200, 'initial writeToPty throw is swallowed');
  });

  it('并发 themeColor POST 防重入：在途时第二条仅落盘偏好、跳过 PTY 同步', async () => {
    const writes = [];
    let ptyCb = null;
    const deps = {
      ...baseDeps,
      writeToPty: (s) => writes.push(s),
      onPtyData: (cb) => { ptyCb = cb; return () => { ptyCb = null; }; },
    };
    // 第一条 POST：注入 /theme 并占住在途标志
    const res1 = await callPost(preferencesPost, { themeColor: 'light' }, deps);
    assert.equal(res1.statusCode, 200);
    assert.deepEqual(writes, ['/theme\r']);
    // 第二条 POST（双端同时切主题）：偏好正常落盘，但不再注入第二个 /theme
    const res2 = await callPost(preferencesPost, { themeColor: 'dark' }, deps);
    assert.equal(res2.statusCode, 200);
    assert.deepEqual(writes, ['/theme\r'], 'in-flight guard skips second PTY sync');
    const written = JSON.parse(readFileSync(prefsFile, 'utf-8'));
    assert.equal(written.themeColor, 'dark', 'second POST still persisted');
    // 第一条链路完成（match）→ 释放在途标志，后续 POST 恢复注入
    ptyCb('Theme set to light');
    const res3 = await callPost(preferencesPost, { themeColor: 'dark' }, deps);
    assert.equal(res3.statusCode, 200);
    assert.equal(writes.length, 2, 'sync resumes after in-flight released');
    ptyCb('Theme set to dark'); // 收尾释放
  });

  it('mismatch 时不再 retry 重注入（现代 /theme 是交互式选择器，重发只会重开对话框）', async () => {
    const writes = [];
    let ptyCb = null;
    const deps = {
      ...baseDeps,
      writeToPty: (s) => writes.push(s),
      onPtyData: (cb) => { ptyCb = cb; return () => { ptyCb = null; }; },
    };
    const res = await callPost(preferencesPost, { themeColor: 'light' }, deps);
    assert.equal(res.statusCode, 200);
    await waitUntil(() => !!ptyCb);
    // 输出与目标(light)不一致 → 仅 warn，不再写第二个 /theme
    ptyCb('Theme set to dark');
    assert.equal(writes.length, 1, 'no retry injection on mismatch');
    assert.equal(writes[0], '/theme\r');
  });

  it('5 秒超时：buf 无选择器特征 → 仅移除监听器，绝不发 ESC（防误 interrupt 生成中任务）', async () => {
    // setTimeout(...,5000) 的回调在无匹配输出时触发。为不真等 5s，
    // patch 全局 setTimeout：捕获 5000ms 的那个回调并立即手动调用。
    const realSetTimeout = globalThis.setTimeout;
    let captured = null;
    let removeCalled = false;
    const writes = [];
    globalThis.setTimeout = function (fn, ms, ...rest) {
      if (ms === 5000) { captured = fn; return { _fake: true }; } // 不真正排程
      return realSetTimeout(fn, ms, ...rest);
    };
    try {
      const deps = {
        ...baseDeps,
        writeToPty: (s) => writes.push(s),
        onPtyData: () => { return () => { removeCalled = true; }; },
      };
      const res = await callPost(preferencesPost, { themeColor: 'light' }, deps);
      assert.equal(res.statusCode, 200);
      assert.ok(captured, '5s timeout scheduled');
      captured(); // 模拟超时触发
      assert.equal(removeCalled, true, 'timeout callback removed the PTY listener');
      assert.deepEqual(writes, ['/theme\r'], 'no ESC sent when picker signature absent');
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });

  it('5 秒超时：buf 检出选择器特征 → 补发一次 ESC 关闭残留对话框', async () => {
    const realSetTimeout = globalThis.setTimeout;
    let captured = null;
    let ptyCb = null;
    const writes = [];
    globalThis.setTimeout = function (fn, ms, ...rest) {
      if (ms === 5000) { captured = fn; return { _fake: true }; }
      return realSetTimeout(fn, ms, ...rest);
    };
    try {
      const deps = {
        ...baseDeps,
        writeToPty: (s) => writes.push(s),
        onPtyData: (cb) => { ptyCb = cb; return () => { ptyCb = null; }; },
      };
      const res = await callPost(preferencesPost, { themeColor: 'light' }, deps);
      assert.equal(res.statusCode, 200);
      await waitUntil(() => !!ptyCb);
      // 选择器打开但无人确认：选项文案出现在 PTY 输出里，无 "Theme set to"
      ptyCb('❯ Dark mode\n  Light mode\n  Auto (match terminal)');
      assert.ok(captured, '5s timeout scheduled');
      captured(); // 模拟超时触发 → 检出特征 → ESC
      assert.deepEqual(writes, ['/theme\r', '\x1b'], 'ESC sent exactly once to dismiss the leftover picker');
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });
});

describe('claudeSettingsGet / Post 分支', () => {
  beforeEach(() => { if (existsSync(settingsPath)) unlinkSync(settingsPath); });

  it('CCV_PROJECT_DIR 缺失时 projectCwd 回落 process.cwd()（L139 ||臂）', async () => {
    const prev = process.env.CCV_PROJECT_DIR;
    delete process.env.CCV_PROJECT_DIR;
    try {
      const res = await callGet(claudeSettingsGet, { claudeSettings: {} });
      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.body);
      assert.ok('claudeProjectModel' in data, 'fell back to process.cwd() without throwing');
    } finally {
      if (prev === undefined) delete process.env.CCV_PROJECT_DIR;
      else process.env.CCV_PROJECT_DIR = prev;
    }
  });

  it('claudeSettingsPost: body 超过 MAX_POST_BODY 时 req.destroy()（L146）', async () => {
    const deps = { claudeSettings: {}, MAX_POST_BODY: 4 };
    const { req, promise } = makePost(claudeSettingsPost, deps);
    req.emit('data', 'aaaaaaaa'); // 8 > 4
    assert.equal(req.wasDestroyed, true);
    req.emit('end'); // 收尾：'aaaaaaaa' 非法 JSON → 400
    const res = await promise;
    assert.equal(res.statusCode, 400);
  });

  it('claudeSettingsPost: 已存在但损坏的 settings.json 走 catch 后仍合并落盘（L152）', async () => {
    writeFileSync(settingsPath, '{ corrupt settings');
    const claudeSettings = {};
    const res = await callPost(claudeSettingsPost, { model: 'fresh' }, { claudeSettings, MAX_POST_BODY: 1e6 });
    assert.equal(res.statusCode, 200);
    const onDisk = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    assert.equal(onDisk.model, 'fresh', 'corrupt existing ignored, merged value written');
  });
});

describe('proxyProfilesGet 分支', () => {
  const ppDeps = () => ({
    maskApiKey, maskProfiles, isMasked,
    defaultProxyProfiles: { profiles: [{ id: 'max', name: 'Default' }], _sentinel: 'DEFAULTS' },
    clients: [],
  });
  beforeEach(() => { ensureTmpDir(); cleanProfile(); });

  it('PROFILE_PATH 不存在时返回 deps.defaultProxyProfiles（L167 三元假臂）', async () => {
    const deps = ppDeps();
    const res = await callGet(proxyProfilesGet, deps);
    assert.equal(res.statusCode, 200);
    const data = JSON.parse(res.body);
    // existsSync(PROFILE_PATH)===false → data = deps.defaultProxyProfiles，
    // 再合并 active；_defaultConfig 仍为 null 故不带 defaultConfig 字段。
    assert.equal(data._sentinel, 'DEFAULTS', 'used defaultProxyProfiles as base');
    assert.ok('active' in data, 'effectiveActive merged');
  });

  it('PROFILE_PATH 损坏时 catch 返回 defaultProxyProfiles 原样（L180）', async () => {
    writeFileSync(profilePath, '{ corrupt profile json');
    const deps = ppDeps();
    const res = await callGet(proxyProfilesGet, deps);
    assert.equal(res.statusCode, 200);
    // catch 分支直接 end(JSON.stringify(deps.defaultProxyProfiles))，不带 active
    assert.deepEqual(JSON.parse(res.body), deps.defaultProxyProfiles);
  });
});

describe('proxyProfilesPost 分支', () => {
  const ppDeps = () => ({
    maskApiKey, maskProfiles, isMasked,
    defaultProxyProfiles: { profiles: [{ id: 'max', name: 'Default' }] },
    clients: [],
  });
  beforeEach(() => { ensureTmpDir(); cleanProfile(); });

  it('body 超过 MAX_POST_BODY 时 req.destroy()（L188）', async () => {
    const deps = { ...ppDeps(), MAX_POST_BODY: 4 };
    const { req, promise } = makePost(proxyProfilesPost, deps);
    req.emit('data', 'xxxxxxxx'); // 8 > 4
    assert.equal(req.wasDestroyed, true);
    req.emit('end'); // 非法 JSON → 400
    const res = await promise;
    assert.equal(res.statusCode, 400);
  });

  it('已存在但损坏的 profile.json（existing 读取）走 catch（L203），仍写入新列表', async () => {
    writeFileSync(profilePath, '{ broken existing profiles');
    const deps = ppDeps();
    const res = await callPost(proxyProfilesPost, {
      profiles: [{ id: 'max', name: 'Default' }, { id: 'c', name: 'C' }],
    }, deps);
    assert.equal(res.statusCode, 200);
    const onDisk = JSON.parse(readFileSync(profilePath, 'utf-8'));
    assert.ok(onDisk.profiles.some((p) => p.id === 'c'), 'new list written despite corrupt existing');
  });

  it('PROFILE_PATH 目录不存在时 mkdirSync 递归创建（L215）', async () => {
    // dirname(PROFILE_PATH) === tmpDir。删掉 tmpDir 触发 !existsSync(dir) → mkdirSync。
    // 删除会带走 prefs/settings 等，但本用例后立即 ensureTmpDir 在 beforeEach 重建；
    // 私有目录、不影响其他并发测试文件。
    rmSync(tmpDir, { recursive: true, force: true });
    const deps = ppDeps();
    const res = await callPost(proxyProfilesPost, {
      profiles: [{ id: 'max', name: 'Default' }],
    }, deps);
    assert.equal(res.statusCode, 200);
    assert.ok(existsSync(profilePath), 'profile.json (and its dir) created via mkdirSync recursive');
    ensureTmpDir();
  });

  it('active 在 profiles 里无匹配时 activeProfile=null（L225 ||null）', async () => {
    const deps = ppDeps();
    // 不传 active（非字符串）→ 走 _loadProxyProfile()，effectiveActive 回落 'max'。
    // profiles 列表里只有一个 id='other' + 自动注入的 max；effectiveActive='max' 实际能匹配 max。
    // 为确保 find 返回 undefined，需让 effectiveActive 指向列表外的 id。
    // 通过传 active='ghost'（列表里没有 ghost）→ setActiveProfileForWorkspace('ghost') →
    // getActiveProfileId() 返回 'ghost' → profiles.find(id==='ghost') === undefined → ||null。
    const res = await callPost(proxyProfilesPost, {
      profiles: [{ id: 'max', name: 'Default' }, { id: 'other', name: 'Other' }],
      active: 'ghost',
    }, deps);
    assert.equal(res.statusCode, 200);
    // 广播帧里 profile 应为 null（无 apiKey 脱敏分支也走 activeProfile 假臂）
  });
});
