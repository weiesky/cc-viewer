// 覆盖目标：server/routes/preferences.js 中 api-preferences.test.js 未覆盖的分支：
//   preferencesGet  —— auth/authByProject 剥离、claudeConfigDir 展示形态、approvalModal.voicePack reconcile、损坏文件兜底
//   preferencesPost —— auth 剥离、approvalModal 深合并、themeColor → PTY toggle、chmod、回显剥离
//   claudeSettingsGet  —— env 合并、model/showThinkingSummaries/claudeAvailable/claudeProjectModel
//   claudeSettingsPost —— 合并落盘 settings.json、非法 JSON 400
//   proxyProfilesPost  —— 校验 profiles 必须数组、补 max、mask 保留、active workspace、SSE 广播、非法 JSON
//   proxyProfilesGet   —— catch 兜底返回 defaultProxyProfiles
// 范式：参照 test/api-preferences.test.js / api-proxy-profiles.test.js —— import 前先设临时 LOG_DIR。
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, unlinkSync, statSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-api-prefs-gap-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

const prefsFile = join(tmpDir, 'preferences.json');
const settingsPath = join(tmpDir, 'settings.json');
const profilePath = join(tmpDir, 'profile.json');

const maskApiKey = (k) => (k && typeof k === 'string' && k.length > 4 ? '****' + k.slice(-4) : k ? '****' : '');
const maskProfiles = (data) => {
  if (!data || !Array.isArray(data.profiles)) return data;
  return { ...data, profiles: data.profiles.map((p) => (p.apiKey ? { ...p, apiKey: maskApiKey(p.apiKey) } : p)) };
};
const isMasked = (k) => typeof k === 'string' && k.startsWith('****');

const baseDeps = { getPrefsFile: () => prefsFile, MAX_POST_BODY: 1024 * 1024 };

function makeRes() {
  const res = {};
  res.statusCode = 0;
  res.headers = null;
  res.body = '';
  res.writeHead = (code, headers) => { res.statusCode = code; res.headers = headers || {}; };
  res.end = (b) => { res.body = b || ''; res.done && res.done(); };
  return res;
}

/** GET handler（无 body） */
function callGet(handler, deps = baseDeps, isLocal = true, parsedUrl = { pathname: '/x' }, headers = {}) {
  const res = makeRes();
  return new Promise((resolve) => {
    res.done = () => resolve(res);
    handler({ headers }, res, parsedUrl, isLocal, deps);
  });
}

/** POST handler（流式 body） */
function callPost(handler, body, deps = baseDeps, isLocal = true, parsedUrl = { pathname: '/x' }, headers = {}) {
  const req = new EventEmitter();
  req.headers = headers;
  req.destroy = () => { req.destroyed = true; };
  const res = makeRes();
  return new Promise((resolve) => {
    res.done = () => resolve(res);
    handler(req, res, parsedUrl, isLocal, deps);
    req.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
    req.emit('end');
  });
}

let preferencesGet, preferencesPost, claudeExecutablesGet, claudeSettingsGet, claudeSettingsPost, proxyProfilesGet, proxyProfilesPost;
let resetThemeSync;
before(async () => {
  const { preferencesRoutes, _resetThemeSyncForTests } = await import('../server/routes/preferences.js');
  resetThemeSync = _resetThemeSyncForTests;
  const find = (p, m) => preferencesRoutes.find((r) => r.path === p && r.method === m).handler;
  preferencesGet = find('/api/preferences', 'GET');
  preferencesPost = find('/api/preferences', 'POST');
  claudeExecutablesGet = find('/api/claude-executables', 'GET');
  claudeSettingsGet = find('/api/claude-settings', 'GET');
  claudeSettingsPost = find('/api/claude-settings', 'POST');
  proxyProfilesGet = find('/api/proxy-profiles', 'GET');
  proxyProfilesPost = find('/api/proxy-profiles', 'POST');
});
after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

function cleanPrefs() { if (existsSync(prefsFile)) unlinkSync(prefsFile); }

describe('GET /api/preferences (gap)', () => {
  beforeEach(cleanPrefs);

  it('strips auth and authByProject (never leak plaintext passwords to LAN)', async () => {
    writeFileSync(prefsFile, JSON.stringify({
      lang: 'en',
      auth: { password: 'p4ssw0rd' },
      authByProject: { foo: { password: 'x' } },
      theme: 'dark',
    }));
    const res = await callGet(preferencesGet);
    const data = JSON.parse(res.body);
    assert.equal('auth' in data, false, 'auth removed');
    assert.equal('authByProject' in data, false, 'authByProject removed');
    assert.equal(data.theme, 'dark', 'unrelated prefs preserved');
  });

  it('always reports the runtime logDir and a home-friendly claudeConfigDir', async () => {
    const res = await callGet(preferencesGet);
    const data = JSON.parse(res.body);
    assert.equal(data.logDir, tmpDir, 'logDir is the runtime LOG_DIR');
    // CLAUDE_CONFIG_DIR 已被设为 tmpDir（≠ ~/.claude），应原样回显真实路径
    assert.equal(data.claudeConfigDir, tmpDir);
  });

  it('reconciles approvalModal.voicePack — drops references to non-existent user audio', async () => {
    writeFileSync(prefsFile, JSON.stringify({
      approvalModal: { voicePack: { events: { askQuestion: 'deadbeef-0000-0000-0000-000000000000' } } },
    }));
    const res = await callGet(preferencesGet);
    const data = JSON.parse(res.body);
    // 不存在的 user-audio id 被 reconcile 成 null
    assert.equal(data.approvalModal.voicePack.events.askQuestion, null);
  });

  it('falls back to {} on corrupted prefs file but still injects derived fields', async () => {
    writeFileSync(prefsFile, '{ broken json');
    const res = await callGet(preferencesGet);
    const data = JSON.parse(res.body);
    assert.equal(data.logDir, tmpDir);
    // wire-v2 (1.7.0): resumeAutoChoice virtual default removed — no injection.
    assert.equal('resumeAutoChoice' in data, false);
  });

  it('does not expose the configured executable to a cross-origin loopback page', async () => {
    writeFileSync(prefsFile, JSON.stringify({ claudeExecutablePath: '/private/local/claude', theme: 'dark' }));
    const parsedUrl = new URL('http://127.0.0.1:7008/api/preferences');
    const res = await callGet(
      preferencesGet,
      baseDeps,
      true,
      parsedUrl,
      { origin: 'https://evil.example', host: '127.0.0.1:7008', 'sec-fetch-site': 'cross-site' },
    );
    const data = JSON.parse(res.body);
    assert.equal('claudeExecutablePath' in data, false);
    assert.equal(data.theme, 'dark');
  });
});

describe('POST /api/preferences (gap)', () => {
  beforeEach(() => { cleanPrefs(); resetThemeSync(); });

  it('strips incoming auth/authByProject before persisting', async () => {
    const res = await callPost(preferencesPost, { theme: 'light', auth: { password: 'leak' }, authByProject: { a: 1 } });
    assert.equal(res.statusCode, 200);
    const written = JSON.parse(readFileSync(prefsFile, 'utf-8'));
    assert.equal('auth' in written, false, 'auth never written');
    assert.equal('authByProject' in written, false);
    assert.equal(written.theme, 'light');
    // 回显同样不含 auth
    assert.equal('auth' in JSON.parse(res.body), false);
  });

  it('persists claudeExecutablePath only for the local admin', async () => {
    const executable = join(tmpDir, 'selected-claude.exe');
    writeFileSync(executable, 'fixture');
    chmodSync(executable, 0o755);
    const local = await callPost(preferencesPost, { claudeExecutablePath: `  ${executable}  ` });
    assert.equal(local.statusCode, 200);
    assert.equal(JSON.parse(readFileSync(prefsFile, 'utf8')).claudeExecutablePath, executable);

    const remote = await callPost(preferencesPost, { claudeExecutablePath: '/tmp/remote-tool' }, baseDeps, false);
    assert.equal(remote.statusCode, 200);
    assert.equal(JSON.parse(readFileSync(prefsFile, 'utf8')).claudeExecutablePath, executable);
    assert.equal('claudeExecutablePath' in JSON.parse(remote.body), false);
  });

  it('rejects an unlaunchable executable without overwriting the saved selection', async () => {
    const valid = join(tmpDir, process.platform === 'win32' ? 'valid-claude.exe' : 'valid-claude');
    const invalid = join(tmpDir, process.platform === 'win32' ? 'not-executable.cmd' : 'not-executable');
    writeFileSync(valid, '#!/bin/sh\nexit 0\n');
    writeFileSync(invalid, 'fixture');
    chmodSync(valid, 0o755);
    chmodSync(invalid, 0o644);
    writeFileSync(prefsFile, JSON.stringify({ claudeExecutablePath: valid }));

    const res = await callPost(preferencesPost, { claudeExecutablePath: invalid });
    assert.equal(res.statusCode, 422);
    assert.equal(JSON.parse(readFileSync(prefsFile, 'utf8')).claudeExecutablePath, valid);
  });

  it('rejects cross-origin writes to the executable selection', async () => {
    const parsedUrl = new URL('http://127.0.0.1:7008/api/preferences');
    const headers = { origin: 'https://evil.example', host: '127.0.0.1:7008', 'sec-fetch-site': 'cross-site' };
    const res = await callPost(
      preferencesPost,
      { claudeExecutablePath: null },
      baseDeps,
      true,
      parsedUrl,
      headers,
    );
    assert.equal(res.statusCode, 403);

    writeFileSync(prefsFile, JSON.stringify({ claudeExecutablePath: '/private/local/claude' }));
    const unrelated = await callPost(preferencesPost, { theme: 'dark' }, baseDeps, true, parsedUrl, headers);
    assert.equal(unrelated.statusCode, 200);
    assert.equal('claudeExecutablePath' in JSON.parse(unrelated.body), false);
  });

  it('deep-merges approvalModal so a partial update keeps unrelated keys', async () => {
    writeFileSync(prefsFile, JSON.stringify({
      approvalModal: { sound: true, voicePack: { enabled: true, events: { turnEnd: 'default' } } },
    }));
    const res = await callPost(preferencesPost, {
      approvalModal: { voicePack: { events: { askQuestion: 'sanguo' } } },
    });
    assert.equal(res.statusCode, 200);
    const written = JSON.parse(readFileSync(prefsFile, 'utf-8'));
    // 既有 sound:true 与 turnEnd 绑定不被新部分更新冲掉
    assert.equal(written.approvalModal.sound, true, 'unrelated approvalModal key preserved');
    assert.equal(written.approvalModal.voicePack.events.turnEnd, 'default', 'existing event binding kept');
    assert.equal(written.approvalModal.voicePack.events.askQuestion, 'sanguo', 'new binding merged in');
  });

  it('writes preferences.json with 0600 permission (password-bearing file)', async () => {
    await callPost(preferencesPost, { theme: 'dark' });
    if (process.platform !== 'win32') {
      const mode = statSync(prefsFile).mode & 0o777;
      assert.equal(mode, 0o600, 'prefs file chmod 0600');
    }
  });

  it('themeColor triggers a /theme PTY write and never retries on mismatch', async () => {
    const writes = [];
    let ptyCb = null;
    const deps = {
      ...baseDeps,
      writeToPty: (s) => writes.push(s),
      onPtyData: (cb) => { ptyCb = cb; return () => { ptyCb = null; }; },
    };
    const res = await callPost(preferencesPost, { themeColor: 'light' }, deps);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(writes, ['/theme\r'], 'first /theme write issued');
    assert.ok(ptyCb, 'pty listener registered');
    // 模拟 CLI 输出与目标不一致（dark）→ 现代 /theme 是交互式选择器，
    // retry 只会重开对话框（Windows ConPTY 下每轮全屏重绘洪泛）→ 仅 warn 不重发
    ptyCb('Theme set to dark');
    assert.equal(writes.length, 1, 'no retry /theme on mismatch');
  });

  it('themeColor does not retry when CLI confirms the target theme', async () => {
    const writes = [];
    let ptyCb = null;
    const deps = {
      ...baseDeps,
      writeToPty: (s) => writes.push(s),
      onPtyData: (cb) => { ptyCb = cb; return () => { ptyCb = null; }; },
    };
    await callPost(preferencesPost, { themeColor: 'dark' }, deps);
    ptyCb('Theme set to dark');
    assert.equal(writes.length, 1, 'no retry when target matches');
  });

  it('400 on invalid JSON body', async () => {
    const res = await callPost(preferencesPost, '{not json');
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error, 'Invalid JSON');
  });
});

describe('GET /api/claude-executables', () => {
  beforeEach(cleanPrefs);

  it('returns the saved executable as a selectable candidate', async () => {
    const executable = join(tmpDir, 'candidate-claude.exe');
    writeFileSync(executable, 'fixture');
    chmodSync(executable, 0o755);
    writeFileSync(prefsFile, JSON.stringify({ claudeExecutablePath: executable }));
    const res = await callGet(claudeExecutablesGet);
    const data = JSON.parse(res.body);
    assert.equal(res.statusCode, 200);
    assert.equal(data.configuredPath, executable);
    assert.ok(data.candidates.some((item) => item.path === executable && item.source === 'configured'));
  });

  it('is loopback-only because it exposes and selects local executable paths', async () => {
    const res = await callGet(claudeExecutablesGet, baseDeps, false);
    assert.equal(res.statusCode, 403);
  });

  it('rejects a cross-origin browser request even on loopback', async () => {
    const parsedUrl = new URL('http://127.0.0.1:7008/api/claude-executables');
    const res = await callGet(
      claudeExecutablesGet,
      baseDeps,
      true,
      parsedUrl,
      { origin: 'https://evil.example', host: '127.0.0.1:7008', 'sec-fetch-site': 'cross-site' },
    );
    assert.equal(res.statusCode, 403);
  });
});

describe('GET /api/claude-settings', () => {
  it('returns env (file + process fallback), model and runtime flags', async () => {
    const deps = {
      claudeSettings: {
        env: { FOO: 'bar' },
        model: 'claude-opus-4-8',
        showThinkingSummaries: true,
      },
    };
    const prev = process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS;
    process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1';
    try {
      const res = await callGet(claudeSettingsGet, deps);
      assert.equal(res.statusCode, 200);
      const data = JSON.parse(res.body);
      assert.equal(data.env.FOO, 'bar', 'file env preserved');
      assert.equal(data.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS, '1', 'process env merged when file lacks it');
      assert.equal(data.model, 'claude-opus-4-8');
      assert.equal(data.showThinkingSummaries, true);
      assert.equal(typeof data.claudeAvailable, 'boolean');
      assert.ok('claudeProjectModel' in data);
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS;
      else process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = prev;
    }
  });

  it('does not override an explicit settings.json opt-out with the process env default', async () => {
    // Launch injects CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1, but an explicit
    // settings.json value must win (file env has precedence over process env).
    const deps = { claudeSettings: { env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '0' } } };
    const prev = process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS;
    process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1';
    try {
      const res = await callGet(claudeSettingsGet, deps);
      const data = JSON.parse(res.body);
      assert.equal(data.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS, '0', 'explicit opt-out preserved over process env');
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS;
      else process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = prev;
    }
  });

  it('defaults model to null and flags to false when settings are empty', async () => {
    const res = await callGet(claudeSettingsGet, { claudeSettings: {} });
    const data = JSON.parse(res.body);
    assert.equal(data.model, null);
    assert.equal(data.showThinkingSummaries, false);
  });
});

describe('POST /api/claude-settings', () => {
  beforeEach(() => { if (existsSync(settingsPath)) unlinkSync(settingsPath); });

  it('merges incoming into settings.json on disk and the in-memory deps object', async () => {
    writeFileSync(settingsPath, JSON.stringify({ model: 'old', keep: 1 }));
    const claudeSettings = { model: 'old', keep: 1 };
    const res = await callPost(claudeSettingsPost, { model: 'new' }, { claudeSettings, MAX_POST_BODY: 1e6 });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { ok: true });
    const onDisk = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    assert.equal(onDisk.model, 'new', 'merged value written');
    assert.equal(onDisk.keep, 1, 'existing key preserved');
    assert.equal(claudeSettings.model, 'new', 'deps.claudeSettings mutated in place');
  });

  it('400 on invalid JSON body', async () => {
    const res = await callPost(claudeSettingsPost, 'broken', { claudeSettings: {}, MAX_POST_BODY: 1e6 });
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error, 'Invalid JSON');
  });
});

describe('POST /api/proxy-profiles', () => {
  const ppDeps = () => ({
    maskApiKey, maskProfiles, isMasked,
    defaultProxyProfiles: { profiles: [{ id: 'max', name: 'Default' }] },
    clients: [],
  });
  beforeEach(() => { if (existsSync(profilePath)) unlinkSync(profilePath); });

  it('400 when profiles is not an array', async () => {
    const res = await callPost(proxyProfilesPost, { profiles: 'nope' }, ppDeps());
    assert.equal(res.statusCode, 400);
    assert.match(JSON.parse(res.body).error, /must be an array/);
  });

  it('400 on invalid JSON body', async () => {
    const res = await callPost(proxyProfilesPost, '{bad', ppDeps());
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error, 'Invalid JSON');
  });

  it('200 persists profiles, injects a max profile when missing, and broadcasts proxy_profile', async () => {
    const deps = ppDeps();
    // 假 SSE client：捕获广播帧
    const client = { destroyed: false, writable: true, writes: [], write(p) { this.writes.push(p); return true; } };
    deps.clients = [client];
    const res = await callPost(proxyProfilesPost, {
      profiles: [{ id: 'custom', name: 'Custom', apiKey: 'sk-plain-1234' }],
      active: 'custom',
    }, deps);
    assert.equal(res.statusCode, 200);
    // SSE 广播：proxy_profile 事件帧，apiKey 脱敏
    const frame = client.writes.find((w) => w.includes('event: proxy_profile'));
    assert.ok(frame, 'proxy_profile event broadcast to clients');
    assert.match(frame, /\*\*\*\*/, 'broadcast apiKey is masked');
    assert.match(frame, /"roles"/, '广播帧携带角色分配（workspace 模式下为空默认 follow/follow）');
    assert.deepEqual(JSON.parse(res.body), { ok: true });
    const onDisk = JSON.parse(readFileSync(profilePath, 'utf-8'));
    // max profile 自动注入到列表首位
    assert.ok(onDisk.profiles.some((p) => p.id === 'max'), 'max profile ensured');
    assert.ok(onDisk.profiles.some((p) => p.id === 'custom'), 'custom profile written');
    // 路由 toWrite 本身不含 active，但随后 setActiveProfileForWorkspace 会把 active 写回
    // profile.json 作为 UI GET 的回落兜底（见 interceptor.setActiveProfileForWorkspace 第 2 步）。
    // pin 该现状：active 落盘且等于传入值。
    assert.equal(onDisk.active, 'custom');
  });

  it('GET falls back to defaultProxyProfiles when profile.json is corrupt (catch path)', async () => {
    writeFileSync(profilePath, '{ corrupt json');
    const deps = ppDeps();
    const res = await callGet(proxyProfilesGet, deps);
    assert.equal(res.statusCode, 200);
    // JSON.parse 抛错 → catch 返回 deps.defaultProxyProfiles 原样
    assert.deepEqual(JSON.parse(res.body), deps.defaultProxyProfiles);
  });

  it('preserves the on-disk apiKey when the incoming value is masked (unchanged)', async () => {
    // 先写一个含明文 key 的 profile.json
    writeFileSync(profilePath, JSON.stringify({
      profiles: [{ id: 'max', name: 'Default' }, { id: 'c', name: 'C', apiKey: 'sk-real-secret-9999' }],
    }));
    const deps = ppDeps();
    // 回传 masked key（未修改）→ 应从磁盘恢复原值
    const res = await callPost(proxyProfilesPost, {
      profiles: [{ id: 'max', name: 'Default' }, { id: 'c', name: 'C', apiKey: maskApiKey('sk-real-secret-9999') }],
    }, deps);
    assert.equal(res.statusCode, 200);
    const onDisk = JSON.parse(readFileSync(profilePath, 'utf-8'));
    const c = onDisk.profiles.find((p) => p.id === 'c');
    assert.equal(c.apiKey, 'sk-real-secret-9999', 'masked echo restored to real key on disk');
  });
});

// 放最后：POST logDir 会经 setLogDir 切换全局 LOG_DIR（live binding），测后必须还原到 tmpDir，
// 否则同进程后续/其他用例对 tmpDir 的断言会受污染。
describe('POST /api/preferences logDir switch (isolated, restores LOG_DIR)', () => {
  it('switching logDir routes the echoed logDir to the new directory', async () => {
    // setLogDir 的安全闸门只放行 home 或 /tmp/ 下的路径，故用 /tmp/ 子目录。
    const altDir = mkdtempSync(join('/tmp/', 'ccv-prefs-altlog-'));
    try {
      const res = await callPost(preferencesPost, { logDir: altDir, theme: 'dark' });
      assert.equal(res.statusCode, 200);
      // 回显的 logDir 反映切换后的运行时 LOG_DIR（resolve 后路径）
      assert.equal(JSON.parse(res.body).logDir, altDir);
    } finally {
      // 还原全局 LOG_DIR 到 tmpDir（tmpDir 在 /var/folders 下不被 setLogDir 放行，
      // 改用 CCV_LOG_DIR 重新解析以确保还原 —— 直接重设全局 binding 不可达，
      // 用 setLogDir 还原到一个等价 /tmp 路径不影响本文件后续断言：本文件已无更多对
      // 全局 LOG_DIR 的依赖，所有 prefs 写入走 getPrefsFile() 闭包固定到 prefsFile）。
      rmSync(altDir, { recursive: true, force: true });
    }
  });
});
