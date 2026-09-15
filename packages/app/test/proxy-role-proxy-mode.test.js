// proxy 模式（ccv run / ccv CLI / Electron tab）按角色分流的 live 端到端：真实 startProxy +
// 双本地上游，验证属主进程在 body 缓冲后按角色分类选上游、重试引擎按角色 profile 替换模型、
// fetch hook 对 trace 请求的同角色改写（auth 注入幂等一致）。
// 覆盖 proxy.js 分类块的全部臂：子标记→子源 / 无标记→主源 / count_tokens 留主（utility 跳过
// 解析）/ 非 JSON body 回退 main 语义。环境范式同 proxy-server.test.js（env 先于动态 import）。
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-proxy-role-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
delete process.env.ANTHROPIC_BASE_URL;

// 双上游：各自记录 (url, body, x-api-key)。main=主源，sub=子源。
const hits = { main: [], sub: [] };
function startUpstream(bucket) {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      let data = '';
      req.on('data', (c) => { data += c; });
      req.on('end', () => {
        hits[bucket].push({ url: req.url, body: data, apiKey: req.headers['x-api-key'] || null });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: 1 }));
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

let mainSrv, subSrv, proxyPort, itc;

function proxyReq(path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const r = request({
      hostname: '127.0.0.1', port: proxyPort, path, method: 'POST',
      headers: { 'content-length': Buffer.byteLength(payload), ...extraHeaders },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    r.on('error', reject);
    r.write(payload);
    r.end();
  });
}

before(async () => {
  mainSrv = await startUpstream('main');
  subSrv = await startUpstream('sub');
  const mainPort = mainSrv.address().port;
  const subPort = subSrv.address().port;
  itc = await import('../server/interceptor.js');
  // profile.json：main1=主源、sub1=子源（各带 ANTHROPIC_MODEL 验证重试引擎按角色替换模型）
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(itc.PROFILE_PATH, JSON.stringify({ profiles: [
    { id: 'max', name: 'Default' },
    { id: 'main1', name: 'Main', baseURL: `http://127.0.0.1:${mainPort}`, apiKey: 'sk-main', ANTHROPIC_MODEL: 'MAIN-MODEL' },
    { id: 'sub1', name: 'Sub', baseURL: `http://127.0.0.1:${subPort}`, apiKey: 'sk-sub', ANTHROPIC_MODEL: 'SUB-MODEL' },
  ] }), { mode: 0o600 });
  itc.setActiveProfileForWorkspace('main1', { subagent: 'sub1', teammate: 'follow' });
  const proxyMod = await import('../server/proxy.js');
  proxyPort = await proxyMod.startProxy();
  assert.ok(proxyPort > 0);
});

after(() => {
  try { mainSrv?.close(); } catch { }
  try { subSrv?.close(); } catch { }
  // live system 固化缓存会异步写 <tmpDir>/<projectKey>/system-prompt-snapshots/live/：
  // 与 rmSync 竞态时偶发 ENOTEMPTY，maxRetries 吸收该窗口（仓库 rm-sync helper 同款思路）。
  try { rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { }
  setTimeout(() => process.exit(0), 30).unref();
});

describe('proxy 模式按角色分流（live startProxy）', () => {
  it('cc_is_subagent=true 请求 → 子源上游 + 子 profile 模型替换 + 子 key 注入', async () => {
    const before = hits.sub.length;
    const res = await proxyReq('/v1/messages', {
      system: [{ type: 'text', text: 'You are Claude Code.\ncc_is_subagent=true; effort=max' }],
      messages: [{ role: 'user', content: 'sub task' }],
      model: 'claude-x',
    });
    assert.equal(res.status, 200);
    assert.equal(hits.sub.length, before + 1, '子请求应命中子源上游');
    const hit = hits.sub[hits.sub.length - 1];
    assert.equal(JSON.parse(hit.body).model, 'SUB-MODEL', '重试引擎按子 profile 替换模型');
    assert.equal(hit.apiKey, 'sk-sub', 'hook 对 trace 请求注入子 profile 的 key');
  });

  it('无标记主请求 → 主源上游 + 主 profile 模型替换', async () => {
    const before = hits.main.length;
    const res = await proxyReq('/v1/messages', {
      system: [{ type: 'text', text: 'You are Claude Code, official CLI.' }],
      messages: [{ role: 'user', content: 'main turn' }],
      model: 'claude-x',
    });
    assert.equal(res.status, 200);
    assert.equal(hits.main.length, before + 1, '主请求应命中主源上游');
    const hit = hits.main[hits.main.length - 1];
    assert.equal(JSON.parse(hit.body).model, 'MAIN-MODEL');
    assert.equal(hit.apiKey, 'sk-main');
  });

  it('count_tokens（utility）→ 留在主源，且不分类解析', async () => {
    const beforeM = hits.main.length;
    const beforeS = hits.sub.length;
    const res = await proxyReq('/v1/messages/count_tokens', {
      system: [{ type: 'text', text: 'cc_is_subagent=true' }],
      messages: [], model: 'claude-x',
    });
    assert.equal(res.status, 200);
    assert.equal(hits.main.length, beforeM + 1, 'utility 跟随 main 源');
    assert.equal(hits.sub.length, beforeS, 'utility 不分流到子源');
    assert.equal(hits.main[hits.main.length - 1].url, '/v1/messages/count_tokens');
  });

  it('非 JSON body 的 LLM 路径请求 → 回退 main 语义，不崩', async () => {
    const beforeM = hits.main.length;
    const res = await proxyReq('/v1/messages', 'not-json{{{');
    assert.equal(res.status, 200);
    assert.equal(hits.main.length, beforeM + 1, '解析失败回退 main 活跃 profile 上游');
  });

  // review P0 回归：x-claude-code-agent-id 是子代理流的 header 硬判据 —— body 不带任何
  // 角色标记（SDK 身份行形态）时，仅凭 header 也必须分流到子源，而非误判 main。
  it('header-only 匿名子代理（body 无标记）→ 子源上游', async () => {
    const before = hits.sub.length;
    const res = await proxyReq('/v1/messages', {
      system: [{ type: 'text', text: 'You are a Claude agent, built on Anthropic\'s Claude Agent SDK.' }],
      messages: [{ role: 'user', content: 'sub task' }],
      model: 'claude-x',
    }, { 'x-claude-code-agent-id': 'a7eea0a140349f80d' });
    assert.equal(res.status, 200);
    assert.equal(hits.sub.length, before + 1, '匿名 hex agent-id → subagent → 子源');
    assert.equal(JSON.parse(hits.sub[hits.sub.length - 1].body).model, 'SUB-MODEL');
  });

  it('header-only 命名队友（body 无标记）→ teammate 角色（follow 语义 → 主源）', async () => {
    const beforeM = hits.main.length;
    const res = await proxyReq('/v1/messages', {
      system: [{ type: 'text', text: 'You are a Claude agent, built on Anthropic\'s Claude Agent SDK.' }],
      messages: [{ role: 'user', content: 'review diff' }],
      model: 'claude-x',
    }, { 'x-claude-code-agent-id': 'reviewer@session-17e1f37a-0000-0000-0000-000000000000' });
    assert.equal(res.status, 200);
    // teammate 分配为 follow → 跟随 main 活跃 profile（主源）；断言的是 header 被识别为
    // teammate 角色而非误判 main 之外的崩溃/错路。
    assert.equal(hits.main.length, beforeM + 1, 'name@… agent-id → teammate → follow 主源');
  });
});

describe('proxy 模式 live system 改写（双写幂等 + role 门）', () => {
  // 启用 live 改写：发布启动判定（resolvedModelId 与 MAIN-MODEL 对齐 → hook seed 后
  // proxy 消费缓存；同 sentinel 重选场景下 append 文本必须在 wire 上恰出现一次）。
  const LIVE_APPEND = 'PROXY-LIVE-APPEND';
  const LIVE_SID = 'ffff1111-2222-3333-4444-555566667777';
  const LIVE_USER_ID = JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: LIVE_SID });
  let liveMod;

  before(async () => {
    liveMod = await import('../server/lib/system-prompt-live.js');
    liveMod._resetLiveForTests();
    liveMod.setLaunchSystemPromptInfo({
      workspaceDir: '/nonexistent-ws',
      resolvedModelId: 'MAIN-MODEL', // 与 main1 profile 的 ANTHROPIC_MODEL 对齐
      entries: [{ flag: '--append-system-prompt-file', content: LIVE_APPEND }],
    });
  });

  it('主请求：append 在 wire 上恰出现一次（proxy+hook 双写幂等），且字节稳定', async () => {
    const before = hits.main.length;
    // hook 会在首请求 seed（resolvedModelId 命中），proxy 消费同一缓存 → 幂等。
    // tools 需满足 isMainAgentRequest 阈值（>5 且含 Edit/Bash/Task），否则 mainAgent=false 被门排除。
    const mainTools = [
      { name: 'Edit' }, { name: 'Bash' }, { name: 'Task' },
      { name: 'Read' }, { name: 'Write' }, { name: 'Glob' },
    ];
    const body = {
      system: [{ type: 'text', text: 'You are Claude Code, official CLI.', cache_control: { type: 'ephemeral' } }],
      tools: mainTools,
      metadata: { user_id: LIVE_USER_ID },
      messages: [{ role: 'user', content: 'turn1' }],
      model: 'claude-x',
    };
    const res = await proxyReq('/v1/messages', body);
    assert.equal(res.status, 200);
    assert.equal(hits.main.length, before + 1);
    const wire = JSON.parse(hits.main[hits.main.length - 1].body);
    const flat = JSON.stringify(wire.system);
    assert.equal(flat.split(LIVE_APPEND).length - 1, 1, 'append 文本在上游 body 中恰出现一次（无重复注入）');
    assert.equal(wire.model, 'MAIN-MODEL', '模型替换不受影响');
  });

  it('subagent（role≠main）→ live 改写跳过（角色分类标记不被破坏）', async () => {
    const before = hits.sub.length;
    const res = await proxyReq('/v1/messages', {
      system: [{ type: 'text', text: 'You are Claude Code.\ncc_is_subagent=true; effort=max' }],
      messages: [{ role: 'user', content: 'sub task' }],
      metadata: { user_id: LIVE_USER_ID },
      model: 'claude-x',
    });
    assert.equal(res.status, 200);
    assert.equal(hits.sub.length, before + 1, '仍分流到子源');
    const wire = JSON.parse(hits.sub[hits.sub.length - 1].body);
    assert.ok(!JSON.stringify(wire.system).includes(LIVE_APPEND), 'subagent 不被 live 改写');
    assert.ok(JSON.stringify(wire.system).includes('cc_is_subagent=true'), '角色标记保留');
  });

  after(() => { liveMod?._resetLiveForTests?.(); });
});
