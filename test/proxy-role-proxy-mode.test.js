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

function proxyReq(path, body) {
  return new Promise((resolve, reject) => {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const r = request({
      hostname: '127.0.0.1', port: proxyPort, path, method: 'POST',
      headers: { 'content-length': Buffer.byteLength(payload) },
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
  itc = await import('../packages/app/server/interceptor.js');
  // profile.json：main1=主源、sub1=子源（各带 ANTHROPIC_MODEL 验证重试引擎按角色替换模型）
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(itc.PROFILE_PATH, JSON.stringify({ profiles: [
    { id: 'max', name: 'Default' },
    { id: 'main1', name: 'Main', baseURL: `http://127.0.0.1:${mainPort}`, apiKey: 'sk-main', ANTHROPIC_MODEL: 'MAIN-MODEL' },
    { id: 'sub1', name: 'Sub', baseURL: `http://127.0.0.1:${subPort}`, apiKey: 'sk-sub', ANTHROPIC_MODEL: 'SUB-MODEL' },
  ] }), { mode: 0o600 });
  itc.setActiveProfileForWorkspace('main1', { subagent: 'sub1', teammate: 'follow' });
  const proxyMod = await import('../packages/app/server/proxy.js');
  proxyPort = await proxyMod.startProxy();
  assert.ok(proxyPort > 0);
});

after(() => {
  try { mainSrv?.close(); } catch { }
  try { subSrv?.close(); } catch { }
  rmSync(tmpDir, { recursive: true, force: true });
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
});
