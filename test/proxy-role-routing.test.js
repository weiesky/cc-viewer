/**
 * 按角色分源（mainAgent/subagent/teammate）— 纯函数 + 路由契约 + 进程形态覆盖。
 *
 *   - classifyProxyRole / isValidRoleValue 纯函数全分支（interceptor-core.js）
 *   - POST /api/proxy-profiles 的 roles 校验（垃圾值归 follow、杂键丢弃、悬空 id 归 follow、
 *     不带 roles 保留存储值）与 GET 的 roles/officialDefault 增量字段
 *   - teammate 进程端到端（spawnSync 子进程带 --agent-name argv）
 *
 * 环境范式同 interceptor-profile.test.js：env 先于动态 import；不预置 ANTHROPIC_BASE_URL
 * （CUSTOM_API_HOST=null → isOfficialDefaultEndpoint 的 env 回退臂 = 官方）。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INTERCEPTOR = join(REPO_ROOT, 'packages', 'app', 'server', 'interceptor.js');

process.env.CCV_PROXY_MODE = '1';
process.env.CCV_SYNC_WRITES = '1';
delete process.env.CCV_WORKSPACE_MODE;
delete process.env.ANTHROPIC_BASE_URL; // 隔离：自定义端点臂在 proxy-role-custom-endpoint.test.js
const __isoDir = mkdtempSync(join(tmpdir(), 'ccv-prole-'));
process.env.CCV_LOG_DIR = __isoDir;
process.env.CLAUDE_CONFIG_DIR = __isoDir;

const SID = 'aaaa2222-3333-4444-5555-666677778888';
const USER_ID = JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: SID });

const maskApiKey = (k) => (k && typeof k === 'string' && k.length > 4 ? '****' + k.slice(-4) : k ? '****' : '');
const maskProfiles = (data) => (data && Array.isArray(data.profiles)
  ? { ...data, profiles: data.profiles.map((p) => (p.apiKey ? { ...p, apiKey: maskApiKey(p.apiKey) } : p)) }
  : data);
const isMasked = (k) => typeof k === 'string' && k.startsWith('****');

let mod;
let core;
let proxyProfilesGet, proxyProfilesPost;
let nextResponse, lastFetchArgs;

function makeRes() {
  const res = {};
  res.statusCode = 0;
  res.body = '';
  res.writeHead = (code) => { res.statusCode = code; };
  res.end = (b) => { res.body = b || ''; res.done && res.done(); };
  return res;
}
function callGet(handler, deps, isLocal = true) {
  const res = makeRes();
  return new Promise((resolve) => {
    res.done = () => resolve(res);
    handler({ headers: {} }, res, { pathname: '/api/proxy-profiles' }, isLocal, deps);
  });
}
function callPost(handler, body, deps) {
  const req = new EventEmitter();
  req.headers = {};
  req.destroy = () => {};
  const res = makeRes();
  return new Promise((resolve) => {
    res.done = () => resolve(res);
    handler(req, res, { pathname: '/api/proxy-profiles' }, true, deps);
    req.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
    req.emit('end');
  });
}
const ppDeps = () => ({
  maskApiKey, maskProfiles, isMasked,
  defaultProxyProfiles: { profiles: [{ id: 'max', name: 'Default' }] },
  clients: [],
});

function writeProfile(json) {
  mkdirSync(dirname(mod.PROFILE_PATH), { recursive: true });
  writeFileSync(mod.PROFILE_PATH, JSON.stringify(json));
}
async function postJson(url, body, headers = { 'x-api-key': 'kk' }) {
  nextResponse = () => new Response('{"ok":1}', { status: 200, headers: { 'content-type': 'application/json' } });
  return globalThis.fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
}

before(async () => {
  globalThis.fetch = async (url, opts) => {
    lastFetchArgs = [url, opts];
    return nextResponse ? nextResponse(url, opts) : new Response('{}', { status: 200 });
  };
  mod = await import('../packages/app/server/interceptor.js');
  core = await import('../packages/app/server/lib/interceptor-core.js');
  const { preferencesRoutes } = await import('../packages/app/server/routes/preferences.js');
  const find = (p, m) => preferencesRoutes.find((r) => r.path === p && r.method === m).handler;
  proxyProfilesGet = find('/api/proxy-profiles', 'GET');
  proxyProfilesPost = find('/api/proxy-profiles', 'POST');
  mod.setupInterceptor();
  // 引导请求建立固定 v2 session（无 metadata 的后续请求回落到它）
  await globalThis.fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': 'boot' },
    body: JSON.stringify({ model: 'm', messages: [], metadata: { user_id: USER_ID } }),
  });
  await mod._v2Writer.flush();
});

after(() => {
  try { rmSync(__isoDir, { recursive: true, force: true }); } catch {}
  mod.setLivePort(null);
  setTimeout(() => process.exit(0), 30).unref();
});

describe('classifyProxyRole（纯函数，正向分类）', () => {
  const subBody = { system: [{ type: 'text', text: 'You are Claude Code.\ncc_is_subagent=true; x=1' }], messages: [] };
  const mainBody = { system: [{ type: 'text', text: 'You are Claude Code, official CLI.' }], messages: [] };

  it('teammate 进程内一切请求 → teammate（含 utility 标记）', () => {
    assert.equal(core.classifyProxyRole(subBody, { isTeammate: true }), 'teammate');
    assert.equal(core.classifyProxyRole(null, { isTeammate: true, isCountTokens: true }), 'teammate');
  });

  it('同进程 team 成员（无 argv，system 带团队标记）→ teammate', () => {
    // CC 2.1.x 原生 agent teams：in-process teammate 的 system 注入
    // "running as an agent in a team" / "Agent Teammate Communication"（经线上会话 blob 验证），
    // 不带 --agent-name argv、不带 cc_is_subagent 标记。
    const teamBody = { system: [{ type: 'text', text: 'You are a Claude agent, running as an agent in a team.\nAgent Teammate Communication: ...' }], messages: [] };
    assert.equal(core.classifyProxyRole(teamBody, {}), 'teammate');
    // utility 优先级高于团队标记（leader 进程内 utility 恒走 main 源）
    assert.equal(core.classifyProxyRole(teamBody, { isCountTokens: true }), 'main');
  });

  it('utility（count_tokens/heartbeat）→ main（非 teammate 进程）', () => {
    assert.equal(core.classifyProxyRole(subBody, { isCountTokens: true }), 'main');
    assert.equal(core.classifyProxyRole(subBody, { isHeartbeat: true }), 'main');
  });

  it('cc_is_subagent=true 阳性标记 → subagent', () => {
    assert.equal(core.classifyProxyRole(subBody, {}), 'subagent');
  });

  it('无标记请求（含 compaction/标题类轻量请求）→ main', () => {
    assert.equal(core.classifyProxyRole(mainBody, {}), 'main');
    assert.equal(core.classifyProxyRole({ model: 'm', messages: [] }, {}), 'main');
    assert.equal(core.classifyProxyRole(null, {}), 'main');
    assert.equal(core.classifyProxyRole(undefined), 'main');
  });

  it('system 为字符串形态也能识别阳性标记', () => {
    assert.equal(core.classifyProxyRole({ system: 'x cc_is_subagent=true; y', messages: [] }, {}), 'subagent');
    // =truex 不应命中（\b 锚定）
    assert.equal(core.classifyProxyRole({ system: 'cc_is_subagent=truex', messages: [] }, {}), 'main');
  });
});

describe('isValidRoleValue（纯函数）', () => {
  const byId = new Map([['max', { id: 'max' }], ['p1', { id: 'p1' }]]);
  it('follow / max 恒合法；列表内 id 合法；其余非法', () => {
    assert.equal(core.isValidRoleValue('follow', byId), true);
    assert.equal(core.isValidRoleValue('max', byId), true);
    assert.equal(core.isValidRoleValue('p1', byId), true);
    assert.equal(core.isValidRoleValue('ghost', byId), false);
    assert.equal(core.isValidRoleValue('', byId), false);
    assert.equal(core.isValidRoleValue(42, byId), false);
    assert.equal(core.isValidRoleValue(null, byId), false);
  });
});

describe('POST /api/proxy-profiles — roles 校验与合并', () => {
  const twoProfiles = [
    { id: 'max', name: 'Default' },
    { id: 'p1', name: 'Main', baseURL: 'https://main.example.com', apiKey: 'sk-main' },
    { id: 'sub1', name: 'Sub', baseURL: 'https://sub.example.com', apiKey: 'sk-sub' },
  ];

  it('合法 roles 落盘（合并保留 activeId）；GET 回读存储值 + officialDefault', async () => {
    writeProfile({ profiles: twoProfiles });
    mod.setActiveProfileForWorkspace('p1');
    const res = await callPost(proxyProfilesPost, {
      profiles: twoProfiles,
      roles: { subagent: 'sub1', teammate: 'max' },
    }, ppDeps());
    assert.equal(res.statusCode, 200);
    // 存储值：roles 写入成功，activeId 未被 roles-only 调用改动
    assert.deepEqual(mod.getStoredRoles(), { subagent: 'sub1', teammate: 'max' });
    assert.equal(mod.getActiveProfileId(), 'p1');
    // GET 增量字段：roles=存储值、officialDefault（env 未设 → 官方 true）
    const g = await callGet(proxyProfilesGet, ppDeps());
    const data = JSON.parse(g.body);
    assert.deepEqual(data.roles, { subagent: 'sub1', teammate: 'max' });
    assert.equal(data.officialDefault, true);
    assert.equal(data.active, 'p1');
  });

  it('非法 roles 值归 follow；roles.main 等杂键丢弃', async () => {
    writeProfile({ profiles: twoProfiles });
    const res = await callPost(proxyProfilesPost, {
      profiles: twoProfiles,
      roles: { subagent: 'ghost-id', teammate: 42, main: 'p1', extra: 'x' },
    }, ppDeps());
    assert.equal(res.statusCode, 200);
    assert.deepEqual(mod.getStoredRoles(), { subagent: 'follow', teammate: 'follow' });
  });

  it('POST 不带 roles → 保留已存储的角色分配', async () => {
    writeProfile({ profiles: twoProfiles });
    mod.setActiveProfileForWorkspace('p1', { subagent: 'sub1', teammate: 'follow' });
    const res = await callPost(proxyProfilesPost, { profiles: twoProfiles, active: 'p1' }, ppDeps());
    assert.equal(res.statusCode, 200);
    assert.deepEqual(mod.getStoredRoles(), { subagent: 'sub1', teammate: 'follow' }, 'roles 未被列表 CRUD 冲掉');
  });

  it('POST 后 SSE 广播帧携带 roles', async () => {
    writeProfile({ profiles: twoProfiles });
    const deps = ppDeps();
    const client = { writes: [], write(p) { this.writes.push(p); return true; } };
    deps.clients = [client];
    mod.setActiveProfileForWorkspace('p1', { subagent: 'sub1' });
    await callPost(proxyProfilesPost, { profiles: twoProfiles, active: 'p1' }, deps);
    const frame = client.writes.find((w) => w.includes('event: proxy_profile'));
    assert.ok(frame, 'proxy_profile broadcast');
    assert.match(frame, /"roles"/, '广播帧含 roles');
    assert.match(frame, /"subagent":"sub1"/);
  });

  it('GET catch 路径（profile.json 损坏）保持 defaultProxyProfiles 原 shape（无 roles 字段）', async () => {
    writeFileSync(mod.PROFILE_PATH, '{ corrupt');
    const deps = ppDeps();
    const res = await callGet(proxyProfilesGet, deps);
    assert.deepEqual(JSON.parse(res.body), deps.defaultProxyProfiles);
  });
});

// teammate 进程端到端：_isTeammate 由模块加载期的 process.argv 冻结，进程内测试无法翻转，
// 必须用带子进程 argv 的真实进程覆盖「argv → classifyProxyRole(teammate) → 角色解析 → 改写」链路。
describe('teammate 进程（--agent-name argv）角色分流端到端', () => {
  it('teammate 子进程：全部请求按 teammate 角色改写到 team 源', () => {
    const subDir = mkdtempSync(join(tmpdir(), 'ccv-prole-tm-'));
    try {
      // 子进程 cwd = 本测试进程 cwd（repo root）→ 项目目录名按 basename 清洗规则推导
      const projName = basename(process.cwd()).replace(/[^a-zA-Z0-9_\-\.]/g, '_');
      const projDir = join(subDir, projName);
      mkdirSync(projDir, { recursive: true });
      writeFileSync(join(subDir, 'profile.json'), JSON.stringify({ profiles: [
        { id: 'max', name: 'Default' },
        { id: 'main1', name: 'Main', baseURL: 'https://main.example.com', apiKey: 'sk-main' },
        { id: 'team1', name: 'Team', baseURL: 'https://team.example.com', apiKey: 'sk-team' },
      ] }));
      writeFileSync(join(projDir, 'active-profile.json'), JSON.stringify({
        activeId: 'main1', roles: { subagent: 'follow', teammate: 'team1' },
      }));
      const driver = join(subDir, '_tm-driver.mjs');
      writeFileSync(driver,
        `let lastUrl = null;\n` +
        `globalThis.fetch = async (u, o) => { lastUrl = u; return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); };\n` +
        `const m = await import(${JSON.stringify(INTERCEPTOR)});\n` + // argv 带 --agent-name → 模块加载即装 hook
        `await globalThis.fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': 'k' }, body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }) });\n` +
        `console.log('TM_ROLE_URL=' + lastUrl);\n` +
        `process.exit(0);\n`);
      const sub = spawnSync(process.execPath, [driver, '--agent-name', 'worker-1', '--team-name', 'tm'],
        { env: { ...process.env, CCV_LOG_DIR: subDir, CCV_PROXY_MODE: '1', CCV_SYNC_WRITES: '1' },
          encoding: 'utf-8', timeout: 30000 });
      assert.match(sub.stdout, /TM_ROLE_URL=https:\/\/team\.example\.com\/v1\/messages/,
        `teammate 进程请求应改写到 team 源: ${sub.stderr}`);
    } finally {
      rmSync(subDir, { recursive: true, force: true });
    }
  });
});

// proxy 模式（ccv run / ccv CLI / Electron tab）角色分流：属主进程在 proxy.js 里按角色选上游
// （getOriginalBaseUrl 角色覆盖三态）——由 test/proxy-role-proxy-mode.test.js 的 live startProxy
// 端到端用例覆盖；test/proxy.test.js 的 getOriginalBaseUrl 副本只镜像「传入 profile 对象」臂，
// 不模拟 undefined→模块 _activeProfile 回退臂（副本无法表达，注意漂移）。

// ████ 顺序敏感：teammate 子进程用例与本文件其它用例相互独立（子进程隔离模块态）。

describe('setDefaultEndpointResolver / hasExplicitRoleAssignments', () => {
  it('注册的解析器优先于 _defaultConfig 实证（属主进程出站 origin 不可信）', () => {
    // 本进程 _defaultConfig 已被引导请求捕获为 api.anthropic.com（官方）
    assert.equal(mod.isOfficialDefaultEndpoint(), true);
    mod.setDefaultEndpointResolver(() => 'https://third-party.example.com');
    assert.equal(mod.isOfficialDefaultEndpoint(), false, 'resolver 胜出');
    mod.setDefaultEndpointResolver(() => 'https://api.anthropic.com');
    assert.equal(mod.isOfficialDefaultEndpoint(), true);
    mod.setDefaultEndpointResolver(null); // 还原：回落实证臂
    assert.equal(mod.isOfficialDefaultEndpoint(), true);
  });

  it('hasExplicitRoleAssignments：全 follow → false；任一显式分配 → true', () => {
    // 前面的 GET catch 用例把 profile.json 写成损坏态 —— 先恢复合法列表，
    // 否则 _loadProxyProfile 的 catch 会把 _roleIds 归 follow/follow。
    writeProfile({ profiles: [
      { id: 'max', name: 'Default' },
      { id: 'p1', name: 'Main', baseURL: 'https://main.example.com', apiKey: 'sk-main' },
      { id: 'sub1', name: 'Sub', baseURL: 'https://sub.example.com', apiKey: 'sk-sub' },
    ] });
    mod.setActiveProfileForWorkspace('p1', { subagent: 'follow', teammate: 'follow' });
    assert.equal(mod.hasExplicitRoleAssignments(), false);
    mod.setActiveProfileForWorkspace('p1', { subagent: 'sub1' });
    assert.equal(mod.hasExplicitRoleAssignments(), true);
    mod.setActiveProfileForWorkspace('p1', { subagent: 'follow', teammate: 'follow' });
    assert.equal(mod.hasExplicitRoleAssignments(), false);
  });
});
