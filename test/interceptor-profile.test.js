/**
 * interceptor.js — proxy profile / workspace / v2 会话增量语义路径测试。
 *
 * 覆盖目标（setupInterceptor + 模块级状态机）：
 *   - _loadProxyProfile / getActiveProfileId / setActiveProfileForWorkspace（workspace + profile.json 双写）
 *   - proxy 请求改写：URL origin 替换（含 /v1 路径去重）、x-api-key / authorization 注入、
 *     以及 model 家族改写（opus/sonnet/haiku → 对应字段，其余 → ANTHROPIC_MODEL，旧 activeModel 回退）
 *   - initForWorkspace / resetWorkspace（1.7.0：不再复用/新建 v1 日志文件，filePath 恒空）
 *   - v2 会话增量（adapter 合成视图）：首条 mainAgent → checkpoint；append → delta 切片；
 *     缩短 → 强制 checkpoint；in-place 末位替换 → checkpoint + _inPlaceReplaceDetected
 *
 * 同 interceptor-fetch.test.js：CCV_PROXY_MODE=1 跳过自执行；手动 setupInterceptor()；
 * CCV_SYNC_WRITES=1 同步写盘便于断言；读回统一走 iterateV2RawEntries(getLiveLogSource())。
 *
 * 历史注记：model 改写段曾误用 if 块级 body 变量（越界 ReferenceError 被 catch 吞掉，导致
 * 设了 activeModel 时 model 不替换）。现改用函数级 requestEntry.body 读旧值，该 BUG 已修复。
 * 1.8 起 ingestRequest 移到 proxy 改写之后执行，proxyProfile/proxyUrl/proxyRole 落盘记账
 * 完整 —— 本文件改写用例断言 proxyUrl，角色分流用例断言 proxyRole。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';

// ████ 数据安全死命令(2026-06-06 事故:测试五次删用户真实 ~/.claude 数据)████
// ESM 静态 import 会被 hoist,先于本文件任何语句执行 —— 因此【必须】先锁死
// CCV_LOG_DIR / CLAUDE_CONFIG_DIR 到进程私有临时目录,再让项目模块(interceptor)
// 通过 before() 里的【动态】import 读取这些 env。顺序绝不能反:env→动态 import。
// 严禁把 ../server/interceptor.js 改成顶层静态 import。
process.env.CCV_PROXY_MODE = '1';
process.env.CCV_SYNC_WRITES = '1';
delete process.env.CCV_WORKSPACE_MODE;
const __isoDir = mkdtempSync(join(tmpdir(), 'ccv-itcprof-'));
process.env.CCV_LOG_DIR = __isoDir;
process.env.CLAUDE_CONFIG_DIR = __isoDir;

// 本文件的固定 v2 session（引导请求携带；后续无 metadata 请求 §8.3 回落到它）
const SID = 'ffff1111-2222-3333-4444-555566667777';
const USER_ID = JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: SID });

let mod;
let iterateV2RawEntries;
let nextResponse;
let lastFetchArgs;

/** 经 v2→v1 adapter 读取当前 session 的合成 entry 数组（seq 序） */
function readEntries() {
  const dir = mod.getLiveLogSource();
  if (!dir) return [];
  return [...iterateV2RawEntries(dir)].map(p => JSON.parse(p));
}
function lastCompleted() {
  const e = readEntries();
  for (let i = e.length - 1; i >= 0; i--) if (!e[i].inProgress) return e[i];
  return null;
}

function writeProfile(json) {
  mkdirSync(dirname(mod.PROFILE_PATH), { recursive: true });
  writeFileSync(mod.PROFILE_PATH, JSON.stringify(json));
}

// workspace active-profile.json 优先级最高（_readWorkspaceActiveId）。setActiveProfileForWorkspace
// 用例会写它；清掉后才能让 profile.json.active 单独决定 _activeProfile。
function clearWorkspaceActive() {
  if (!mod._logDir) return;
  try { rmSync(join(mod._logDir, 'active-profile.json'), { force: true }); } catch {}
}

function makeMainAgentTools() {
  return [
    { name: 'Edit' }, { name: 'Bash' }, { name: 'Task' }, { name: 'Read' },
    { name: 'Write' }, { name: 'Glob' }, { name: 'Grep' }, { name: 'Agent' },
    { name: 'WebFetch' }, { name: 'WebSearch' }, { name: 'NotebookEdit' }, { name: 'AskUser' },
  ];
}
function mainBody(messages, extra = {}) {
  return {
    system: [{ type: 'text', text: 'You are Claude Code, official CLI.' }],
    tools: makeMainAgentTools(),
    metadata: { user_id: USER_ID },
    messages,
    model: 'claude-x',
    ...extra,
  };
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
  ({ iterateV2RawEntries } = await import('../packages/app/server/lib/v2/adapter.js'));
  mod.setupInterceptor();
  // 引导请求：携带 SID 建立 _currentSid，让后续无 metadata 请求路由到同一 session。
  await globalThis.fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': 'boot' },
    body: JSON.stringify({ model: 'm', messages: [], metadata: { user_id: USER_ID } }),
  });
  await mod._v2Writer.flush();
  assert.ok(mod.getLiveLogSource().endsWith(SID), '引导请求应建立本文件的固定 v2 session');
});

after(() => {
  // 清理我们写入的 profile.json，避免污染同 LOG_DIR 其他用例（虽然 LOG_DIR 是 per-pid 临时目录）
  try { rmSync(mod.PROFILE_PATH, { force: true }); } catch {}
  mod.setLivePort(null);
  setTimeout(() => process.exit(0), 30).unref();
});

describe('proxy profile 加载与查询', () => {
  it('_loadProxyProfile：active 指向非 max profile → _activeProfile 被设', () => {
    writeProfile({ active: 'p1', profiles: [
      { id: 'max', name: 'Default' },
      { id: 'p1', name: 'ProxyOne', baseURL: 'https://proxy.example.com/v1', apiKey: 'sk-proxy' },
    ] });
    mod._loadProxyProfile();
    assert.equal(mod._activeProfile.name, 'ProxyOne');
    assert.equal(mod.getActiveProfileId(), 'p1');
  });

  it('_loadProxyProfile：active === max → _activeProfile 为 null（Default 不算 profile）', () => {
    writeProfile({ active: 'max', profiles: [{ id: 'max', name: 'Default' }, { id: 'p1', name: 'P1', baseURL: 'x' }] });
    mod._loadProxyProfile();
    assert.equal(mod._activeProfile, null);
    assert.equal(mod.getActiveProfileId(), 'max');
  });

  it('_loadProxyProfile：文件损坏 / 不存在 → _activeProfile 安全降级为 null', () => {
    writeFileSync(mod.PROFILE_PATH, '{ not valid json');
    mod._loadProxyProfile();
    assert.equal(mod._activeProfile, null);
    // getActiveProfileId 读不到合法 json → 回落 'max'
    assert.equal(mod.getActiveProfileId(), 'max');
  });
});

describe('setActiveProfileForWorkspace 双写', () => {
  it('普通模式下 _logDir 已初始化 → workspace 文件 + profile.json 都写成功', () => {
    writeProfile({ active: 'max', profiles: [{ id: 'max', name: 'Default' }, { id: 'p2', name: 'P2', baseURL: 'https://b.example.com' }] });
    const result = mod.setActiveProfileForWorkspace('p2');
    assert.equal(result.workspace, true, 'workspace override 落盘');
    assert.equal(result.profile, true, 'profile.json.active 落盘');
    // 切换后 _activeProfile 立即刷新为 P2
    assert.equal(mod._activeProfile.name, 'P2');
    assert.equal(mod.getActiveProfileId(), 'p2');
  });

  it('非法 activeId（非字符串）规范化为 max', () => {
    const result = mod.setActiveProfileForWorkspace(null);
    assert.equal(result.workspace, true);
    assert.equal(mod.getActiveProfileId(), 'max');
    assert.equal(mod._activeProfile, null);
  });
});

describe('proxy 请求改写（通过真实 fetch hook）', () => {
  before(() => clearWorkspaceActive());

  it('URL origin 替换 + /v1 路径去重；x-api-key / authorization 同时注入', async () => {
    writeProfile({ active: 'p1', profiles: [
      { id: 'p1', name: 'ProxyOne', baseURL: 'https://gw.example.com/v1', apiKey: 'sk-injected' },
    ] });
    mod._loadProxyProfile();
    await postJson('https://api.anthropic.com/v1/messages?beta=1',
      { model: 'mm', messages: [] },
      { 'x-api-key': 'orig-key', authorization: 'Bearer orig' });
    // 上游收到改写后的 URL（/v1 去重，保留 query）
    assert.equal(lastFetchArgs[0], 'https://gw.example.com/v1/messages?beta=1');
    // 两种鉴权都被替换
    assert.equal(lastFetchArgs[1].headers['x-api-key'], 'sk-injected');
    assert.equal(lastFetchArgs[1].headers['authorization'], 'Bearer sk-injected');
    // 条目仍以原始 URL 记录；proxy 记账已落盘（1.8 修复：ingest 移到改写之后）
    const entry = lastCompleted();
    assert.ok(entry, '改写后的请求仍应记录完成条目');
    assert.equal(entry.url, 'https://api.anthropic.com/v1/messages?beta=1');
    assert.equal(entry.proxyUrl, 'https://gw.example.com/v1/messages?beta=1', 'proxyUrl 落盘记账');
  });

  it('baseURL 无路径前缀 → 直接拼接原始 pathname', async () => {
    writeProfile({ active: 'p1', profiles: [
      { id: 'p1', name: 'Bare', baseURL: 'https://bare.example.com', apiKey: 'sk-bare' },
    ] });
    mod._loadProxyProfile();
    await postJson('https://api.anthropic.com/v1/messages', { model: 'mm', messages: [] });
    assert.equal(lastFetchArgs[0], 'https://bare.example.com/v1/messages');
  });

  it('无 authorization / x-api-key 时强制植入 x-api-key', async () => {
    writeProfile({ active: 'p1', profiles: [
      { id: 'p1', name: 'Force', baseURL: 'https://f.example.com', apiKey: 'sk-force' },
    ] });
    mod._loadProxyProfile();
    // headers 里只有一个无关 header
    nextResponse = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    await globalThis.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'mm', messages: [] }),
    });
    assert.equal(lastFetchArgs[1].headers['x-api-key'], 'sk-force');
  });

  it('legacy activeModel 设置时：model 被整体替换 + proxyProfile/proxyUrl 正常记录（BUG 已修）', async () => {
    writeProfile({ active: 'p1', profiles: [
      { id: 'p1', name: 'WithModel', baseURL: 'https://m.example.com', apiKey: 'sk-m', activeModel: 'TARGET-MODEL' },
    ] });
    mod._loadProxyProfile();
    await postJson('https://api.anthropic.com/v1/messages', { model: 'claude-x', messages: [] });
    // URL 被改写
    assert.equal(lastFetchArgs[0], 'https://m.example.com/v1/messages');
    // model 被替换为 activeModel（旧数据回退语义）
    const upstreamBody = JSON.parse(lastFetchArgs[1].body);
    assert.equal(upstreamBody.model, 'TARGET-MODEL');
    // 条目仍记录且保留原始 model（改写只作用于发给上游的 wire，不改写日志条目）
    const entry = lastCompleted();
    assert.ok(entry, '改写后的请求仍应记录完成条目');
    assert.equal(entry.body.model, 'claude-x', '日志条目保留原始 model');
  });

  it('家族映射：opus/sonnet/haiku 各命中对应字段，未识别家族(fable)→ANTHROPIC_MODEL', async () => {
    writeProfile({ active: 'p1', profiles: [
      { id: 'p1', name: 'Fam', baseURL: 'https://m.example.com', apiKey: 'sk-m',
        ANTHROPIC_MODEL: 'PRIMARY', ANTHROPIC_DEFAULT_OPUS_MODEL: 'OPUS-T',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'SONNET-T', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'HAIKU-T' },
    ] });
    mod._loadProxyProfile();
    const cases = [
      ['claude-opus-4-8', 'OPUS-T'],
      ['claude-sonnet-4-6', 'SONNET-T'],
      ['claude-3-5-haiku-20241022', 'HAIKU-T'],
      ['claude-fable-5', 'PRIMARY'],
    ];
    for (const [wire, expected] of cases) {
      await postJson('https://api.anthropic.com/v1/messages', { model: wire, messages: [] });
      assert.equal(JSON.parse(lastFetchArgs[1].body).model, expected, `${wire} → ${expected}`);
    }
  });

  it('家族字段留空 → 回落到 ANTHROPIC_MODEL', async () => {
    writeProfile({ active: 'p1', profiles: [
      { id: 'p1', name: 'PartialFam', baseURL: 'https://m.example.com', apiKey: 'sk-m',
        ANTHROPIC_MODEL: 'PRIMARY', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'HAIKU-T' },
    ] });
    mod._loadProxyProfile();
    // opus 家族无字段 → ANTHROPIC_MODEL(PRIMARY) 兜底替换
    await postJson('https://api.anthropic.com/v1/messages', { model: 'claude-opus-4-8', messages: [] });
    assert.equal(JSON.parse(lastFetchArgs[1].body).model, 'PRIMARY', 'opus 字段空 → PRIMARY 兜底');
    // sonnet 家族也无字段 → PRIMARY 兜底
    await postJson('https://api.anthropic.com/v1/messages', { model: 'claude-sonnet-4', messages: [] });
    assert.equal(JSON.parse(lastFetchArgs[1].body).model, 'PRIMARY', 'sonnet 字段空 → PRIMARY 兜底');
    // haiku 家族有字段 → 替换
    await postJson('https://api.anthropic.com/v1/messages', { model: 'claude-3-5-haiku', messages: [] });
    assert.equal(JSON.parse(lastFetchArgs[1].body).model, 'HAIKU-T');
  });

  it('恢复：清掉 activeProfile 后请求不再改写', async () => {
    writeProfile({ active: 'max', profiles: [{ id: 'max', name: 'Default' }] });
    mod._loadProxyProfile();
    assert.equal(mod._activeProfile, null);
    await postJson('https://api.anthropic.com/v1/messages', { model: 'claude-x', messages: [] });
    assert.equal(lastFetchArgs[0], 'https://api.anthropic.com/v1/messages', 'origin 未改');
  });
});

describe('按角色分流（main/subagent/teammate）', () => {
  // 引导请求已把 _defaultConfig.origin 捕获为 api.anthropic.com → isOfficialDefaultEndpoint()=true，
  // 本文件的休眠用例依赖这一点。文件头 CCV_PROXY_MODE=1 仅跳过自执行，不影响角色分流。
  const SUB_SYS = 'You are Claude Code, official CLI.\ncc_is_subagent=true; effort=max';
  const subBody = () => ({ system: [{ type: 'text', text: SUB_SYS }], messages: [], model: 'claude-x' });

  function writeTwoProfiles() {
    writeProfile({ active: 'p1', profiles: [
      { id: 'max', name: 'Default' },
      { id: 'p1', name: 'Main', baseURL: 'https://main.example.com', apiKey: 'sk-main' },
      { id: 'sub1', name: 'Sub', baseURL: 'https://sub.example.com', apiKey: 'sk-sub' },
    ] });
  }

  it('子 Agent 显式分配：cc_is_subagent=true 阳性标记请求改写到子源，proxyRole 落盘', async () => {
    writeTwoProfiles();
    mod.setActiveProfileForWorkspace('p1', { subagent: 'sub1', teammate: 'follow' });
    await postJson('https://api.anthropic.com/v1/messages', subBody());
    assert.equal(lastFetchArgs[0], 'https://sub.example.com/v1/messages', '子代理请求应改写到 sub 源');
    assert.equal(lastFetchArgs[1].headers['x-api-key'], 'sk-sub');
    const entry = lastCompleted();
    assert.equal(entry.proxyProfile, 'Sub');
    assert.equal(entry.proxyRole, 'subagent', 'proxyRole 经 journal proxy.role → adapter 回读');
    assert.equal(entry.proxyUrl, 'https://sub.example.com/v1/messages');
  });

  it('主 Agent 请求仍走 main 源（proxyRole=main）', async () => {
    writeTwoProfiles();
    mod.setActiveProfileForWorkspace('p1', { subagent: 'sub1', teammate: 'follow' });
    await postJson('https://api.anthropic.com/v1/messages', mainBody([{ role: 'user', content: 'hi' }]));
    assert.equal(lastFetchArgs[0], 'https://main.example.com/v1/messages');
    assert.equal(lastCompleted().proxyRole, 'main');
  });

  it('follow 默认：子标记请求跟随 main 源', async () => {
    writeTwoProfiles();
    mod.setActiveProfileForWorkspace('p1', { subagent: 'follow', teammate: 'follow' });
    await postJson('https://api.anthropic.com/v1/messages', subBody());
    assert.equal(lastFetchArgs[0], 'https://main.example.com/v1/messages', 'follow → main 源');
    assert.equal(lastCompleted().proxyRole, 'subagent', '角色是 subagent，但解析到 main 的 profile');
  });

  it('utility 跟随 main：count_tokens 即使分配了子源也不走子源', async () => {
    writeTwoProfiles();
    mod.setActiveProfileForWorkspace('p1', { subagent: 'sub1', teammate: 'follow' });
    await postJson('https://api.anthropic.com/v1/messages/count_tokens', { model: 'claude-x', messages: [] });
    assert.equal(lastFetchArgs[0], 'https://main.example.com/v1/messages/count_tokens', 'count_tokens 跟随 main 源');
    assert.equal(lastCompleted().proxyRole, 'main');
  });

  it('无阳性标记的非 main 请求（compaction/标题类）不会被误路由到子源', async () => {
    writeTwoProfiles();
    mod.setActiveProfileForWorkspace('p1', { subagent: 'sub1', teammate: 'follow' });
    // 无 system / 无 tools / 无 cc_is_subagent 标记的轻量请求 → 角色归 main
    await postJson('https://api.anthropic.com/v1/messages', { model: 'claude-haiku-x', messages: [{ role: 'user', content: 'summarize' }] });
    assert.equal(lastFetchArgs[0], 'https://main.example.com/v1/messages', '正向分类：无标记请求留在 main');
  });

  it('休眠：main=Default + 官方端点（_defaultConfig 实证）→ 存储的子分配不生效但保留', async () => {
    writeTwoProfiles();
    mod.setActiveProfileForWorkspace('max', { subagent: 'sub1', teammate: 'follow' });
    assert.equal(mod._activeProfile, null, 'main=Default 无改写');
    assert.equal(mod.getStoredRoles().subagent, 'sub1', '存储值保留（休眠≠清除）');
    await postJson('https://api.anthropic.com/v1/messages', subBody());
    assert.equal(lastFetchArgs[0], 'https://api.anthropic.com/v1/messages', '休眠：子请求未被改写');
    assert.equal(lastCompleted().proxyRole, undefined, '未改写则无 proxyRole');
    // 主切回 profile → 分配复活
    mod.setActiveProfileForWorkspace('p1');
    assert.equal(mod.getStoredRoles().subagent, 'sub1', '切走后存储分配原样恢复');
    await postJson('https://api.anthropic.com/v1/messages', subBody());
    assert.equal(lastFetchArgs[0], 'https://sub.example.com/v1/messages', '复活后子请求改写生效');
  });

  it('同进程 team 成员（system 团队标记，无 argv）→ 改写到 teammate 源', async () => {
    writeTwoProfiles();
    writeProfile({ active: 'p1', profiles: [
      { id: 'max', name: 'Default' },
      { id: 'p1', name: 'Main', baseURL: 'https://main.example.com', apiKey: 'sk-main' },
      { id: 'sub1', name: 'Sub', baseURL: 'https://sub.example.com', apiKey: 'sk-sub' },
      { id: 'team1', name: 'Team', baseURL: 'https://team.example.com', apiKey: 'sk-team' },
    ] });
    mod.setActiveProfileForWorkspace('p1', { subagent: 'sub1', teammate: 'team1' });
    // CC 2.1.x 原生 teams 的同进程 teammate：system 带团队标记、无 cc_is_subagent、无 argv
    await postJson('https://api.anthropic.com/v1/messages', {
      system: [{ type: 'text', text: 'You are a Claude agent, running as an agent in a team. Agent Teammate Communication: on' }],
      messages: [{ role: 'user', content: 'tm-task' }], model: 'claude-x',
    });
    assert.equal(lastFetchArgs[0], 'https://team.example.com/v1/messages', '同进程 teammate 应改写到 team 源');
    assert.equal(lastCompleted().proxyRole, 'teammate');
  });

  it('getProxyRoleProfiles：返回各角色有效 profile（含休眠置 null）', () => {
    writeTwoProfiles();
    mod.setActiveProfileForWorkspace('p1', { subagent: 'sub1', teammate: 'follow' });
    let rp = mod.getProxyRoleProfiles();
    assert.equal(rp.main?.name, 'Main');
    assert.equal(rp.subagent?.name, 'Sub');
    assert.equal(rp.teammate?.name, 'Main', 'teammate follow → main profile');
    mod.setActiveProfileForWorkspace('max', { subagent: 'sub1' });
    rp = mod.getProxyRoleProfiles();
    assert.equal(rp.main, null);
    assert.equal(rp.subagent, null, '官方端点 + main=Default → 休眠');
  });
});

describe('v2 会话增量语义（adapter 合成的 delta 信封）', () => {
  // 1.7.0：写盘侧是 v2 conversation-store 的 snapshot/append/ctl 事件；adapter 把它们
  // 合成回 v1 delta 信封（_deltaFormat/_isCheckpoint/_totalMessageCount/_inPlaceReplaceDetected）。
  // 会话状态在本文件内按执行顺序累积，断言相对关系，不假设绝对计数。

  it('首条 mainAgent → _deltaFormat=1 checkpoint entry', async () => {
    await postJson('https://api.anthropic.com/v1/messages', mainBody([{ role: 'user', content: 'm1' }]));
    const entry = lastCompleted();
    assert.equal(entry.mainAgent, true);
    assert.equal(entry._deltaFormat, 1);
    assert.equal(entry._conversationId, 'mainAgent');
    assert.equal(entry._isCheckpoint, true, '全新 main 会话首条应为 checkpoint（snapshot 事件）');
    assert.equal(entry._totalMessageCount, 1);
  });

  it('append（长度增大且延续）→ delta 切片（body.messages 只含新增部分）', async () => {
    // 建立 base（与上一条不延续 → snapshot checkpoint）
    const base = [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }];
    await postJson('https://api.anthropic.com/v1/messages', mainBody(base));
    const baseEntry = lastCompleted();
    const baseTotal = baseEntry._totalMessageCount;
    // append 一条
    const grown = [...base, { role: 'user', content: 'c' }];
    await postJson('https://api.anthropic.com/v1/messages', mainBody(grown));
    const entry = lastCompleted();
    assert.equal(entry._totalMessageCount, baseTotal + 1);
    assert.equal(entry._isCheckpoint, false, '延续增长应为 append delta');
    assert.ok(Array.isArray(entry.body.messages));
    assert.equal(entry.body.messages.length, 1, 'delta 只含新增 message');
    assert.equal(entry.body.messages[0].content, 'c');
  });

  it('messages 缩短（/clear 语义）→ 强制 checkpoint（完整 messages）', async () => {
    // 先建立较长 base
    const longConv = Array.from({ length: 6 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `x${i}` }));
    await postJson('https://api.anthropic.com/v1/messages', mainBody(longConv));
    // 缩短到 1 条
    await postJson('https://api.anthropic.com/v1/messages', mainBody([{ role: 'user', content: 'fresh' }]));
    const entry = lastCompleted();
    assert.equal(entry._isCheckpoint, true);
    assert.equal(entry._totalMessageCount, 1);
    assert.equal(entry.body.messages.length, 1);
    assert.equal(entry.body.messages[0].content, 'fresh');
  });

  it('in-place 末位替换（长度同、末位内容不同）→ 强制 checkpoint + _inPlaceReplaceDetected', async () => {
    const base = [{ role: 'user', content: 'u1' }, { role: 'assistant', content: 'orig-answer' }];
    await postJson('https://api.anthropic.com/v1/messages', mainBody(base)); // snapshot checkpoint（与 fresh 不延续）
    // 末位原地替换：长度仍 2，末位 content 改变 → ctl replace-tail 事件
    const replaced = [{ role: 'user', content: 'u1' }, { role: 'assistant', content: 'totally different answer text' }];
    await postJson('https://api.anthropic.com/v1/messages', mainBody(replaced));
    const entry = lastCompleted();
    assert.equal(entry._isCheckpoint, true);
    assert.equal(entry._inPlaceReplaceDetected, true);
    assert.equal(entry._totalMessageCount, 2);
  });
});

describe('initForWorkspace / resetWorkspace（1.7.0：无 v1 日志文件可复用/新建）', () => {
  it('initForWorkspace：绑定项目目录，filePath 恒空、resumed 恒 false', () => {
    const projectPath = join(mod._logDir || process.cwd(), '..', 'ws-fresh-' + Date.now());
    const r = mod.initForWorkspace(projectPath, { forceNew: true });
    assert.equal(r.resumed, false);
    assert.equal(r.projectName, basename(projectPath).replace(/[^a-zA-Z0-9_\-\.]/g, '_'));
    assert.equal(r.filePath, '', 'v1 日志文件已退役，不再生成 .jsonl 路径');
    assert.ok(existsSync(r.dir), '项目目录已创建');
    assert.equal(mod._projectName, r.projectName);
    assert.equal(mod._logDir, r.dir);
    assert.equal(mod.getLiveLogSource(), '', 'session 绑定被重置，首个 sid 请求前 live source 为空');
  });

  it('initForWorkspace 重复调用（forceNew=false）：v2 下每进程天然新 session，恒不 resume', () => {
    const projectPath = join(mod._logDir || process.cwd(), '..', 'ws-reuse-' + Date.now());
    const r1 = mod.initForWorkspace(projectPath, { forceNew: true });
    const r2 = mod.initForWorkspace(projectPath, { forceNew: false });
    assert.equal(r2.resumed, false, 'v1 的「1 小时内复用」语义已随写路径退役');
    assert.equal(r2.filePath, '');
    assert.equal(r2.dir, r1.dir, '同一项目目录绑定稳定');
  });

  it('resetWorkspace 清空工作区上下文', () => {
    mod.resetWorkspace();
    assert.equal(mod._projectName, '');
    assert.equal(mod._logDir, '');
    assert.equal(mod.LOG_FILE, '');
    assert.equal(mod.getLiveLogSource(), '');
  });
});

// resolveResumeChoice：v1 resume 交互机器已随写路径删除（导出不复存在），对应用例一并移除。
