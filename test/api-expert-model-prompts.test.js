// Coverage target: server/routes/expert.js (/api/expert/model-prompts GET/POST)
// 范式同 test/api-expert-system-text.test.js：handler 为 (req,res,parsedUrl,isLocal,deps)，
// req 是 EventEmitter（emit data/end），res 收集 writeHead/end，deps 注入最小依赖。
// 隔离：CCV_LOG_DIR/CLAUDE_CONFIG_DIR 指向临时目录并在 import 前设置；CCV_PROJECT_DIR 充当工作区。
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-api-modelprompt-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '0';
process.env.CCV_CLI_MODE = '0';
// GET 回包新增 modelId/matched(经 resolveSpawnModel 读 process.env)：宿主 shell 导出的
// 模型 env 会漏进来造成机器状态依赖 —— import 前一律 delete，用例内按需 set 并 restore。
delete process.env.CLAUDE_MODEL;
delete process.env.ANTHROPIC_MODEL;
delete process.env.CCV_DISABLE_AUTO_SYSTEM_PROMPT;
const wsDir = join(tmpDir, 'project');
mkdirSync(wsDir, { recursive: true });
process.env.CCV_PROJECT_DIR = wsDir;

const { expertRoutes } = await import('../packages/app/server/routes/expert.js');
const { MODEL_PROMPT_DIR } = await import('../packages/app/server/lib/model-system-prompts.js');
const { LOG_DIR } = await import('../packages/app/findcc.js');
const wsModelDir = join(wsDir, MODEL_PROMPT_DIR);
const globalModelDir = join(LOG_DIR, MODEL_PROMPT_DIR);

function routeFor(method) {
  const r = expertRoutes.find((x) => x.method === method && x.path === '/api/expert/model-prompts');
  assert.ok(r, `route ${method} /api/expert/model-prompts must exist`);
  return r.handler;
}
function makeRes() {
  return {
    code: null, body: null, headers: null,
    writeHead(code, headers) { this.code = code; this.headers = headers; },
    end(s) { this.body = s; },
    json() { return JSON.parse(this.body); },
  };
}
function makeReq() {
  const req = new EventEmitter();
  req.destroy = () => { req._destroyed = true; };
  return req;
}
function baseDeps(o = {}) { return { MAX_POST_BODY: 10 * 1024 * 1024, isWorkspaceMode: false, ...o }; }

async function callGet(deps = baseDeps()) {
  const res = makeRes();
  await routeFor('GET')(makeReq(), res, null, true, deps);
  return res;
}
function callPost(obj, deps = baseDeps()) {
  return new Promise((resolve) => {
    const req = makeReq();
    const res = makeRes();
    const origEnd = res.end.bind(res);
    res.end = (s) => { origEnd(s); resolve(res); };
    routeFor('POST')(req, res, null, true, deps);
    req.emit('data', Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)));
    req.emit('end');
  });
}

describe('api expert model-prompts', () => {
  after(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ } });

  it('GET 初始 → 两个作用域均空、globalDir 指向 LOG_DIR 下', async () => {
    const res = await callGet();
    assert.equal(res.code, 200);
    const j = res.json();
    assert.equal(j.workspaceActive, true);
    assert.equal(j.workspaceDir, wsDir);
    assert.equal(j.globalDir, globalModelDir);
    assert.deepEqual(j.workspace, []);
    assert.deepEqual(j.global, []);
  });

  it('POST workspace → 文件落 <ws>/system_prompt/,名字大写规范化回显', async () => {
    const res = await callPost({ scope: 'workspace', name: 'Gemini3', mode: 'override', text: 'WS-PROMPT' });
    assert.equal(res.code, 200);
    const j = res.json();
    assert.equal(j.ok, true);
    assert.equal(j.name, 'GEMINI3');
    assert.equal(readFileSync(join(wsModelDir, 'GEMINI3_SYSTEM.md'), 'utf-8'), 'WS-PROMPT');
    const g = (await callGet()).json();
    assert.deepEqual(g.workspace, [{ name: 'GEMINI3', mode: 'override', text: 'WS-PROMPT' }]);
  });

  it('POST global → 文件落 <LOG_DIR>/system_prompt/', async () => {
    const res = await callPost({ scope: 'global', name: 'opus', mode: 'append', text: 'G-PROMPT' });
    assert.equal(res.code, 200);
    assert.equal(readFileSync(join(globalModelDir, 'OPUS_APPEND_SYSTEM.md'), 'utf-8'), 'G-PROMPT');
    const g = (await callGet()).json();
    assert.deepEqual(g.global, [{ name: 'OPUS', mode: 'append', text: 'G-PROMPT' }]);
  });

  it('POST 空文本 → 删条目(cleared)', async () => {
    await callPost({ scope: 'global', name: 'opus', mode: 'append', text: 'x' });
    const res = await callPost({ scope: 'global', name: 'opus', text: '   ' });
    assert.equal(res.code, 200);
    assert.equal(res.json().cleared, true);
    assert.equal(existsSync(join(globalModelDir, 'OPUS_APPEND_SYSTEM.md')), false);
    assert.equal(existsSync(join(globalModelDir, 'OPUS_SYSTEM.md')), false);
  });

  it('POST 非空文本缺 mode → 默认 append', async () => {
    const res = await callPost({ scope: 'global', name: 'glm5', text: 'no-mode' });
    assert.equal(res.code, 200);
    assert.equal(res.json().mode, 'append');
    assert.equal(readFileSync(join(globalModelDir, 'GLM5_APPEND_SYSTEM.md'), 'utf-8'), 'no-mode');
    await callPost({ scope: 'global', name: 'glm5', text: '' }); // 清理，避免影响后续 GET 断言
  });

  it('POST 非法 scope/name → 400 错误码', async () => {
    assert.equal((await callPost({ scope: 'nope', name: 'opus', text: 'x' })).json().error, 'bad_scope');
    assert.equal((await callPost({ scope: 'global', name: 'a/b', text: 'x' })).json().error, 'bad_model_name');
    assert.equal((await callPost({ scope: 'global', name: 'X_APPEND', text: 'x' })).json().error, 'bad_model_name');
    assert.equal((await callPost({ scope: 'global', name: 'default', text: 'x' })).json().error, 'bad_model_name');
  });

  it('POST 坏 JSON → 500', async () => {
    const res = await callPost('{bad');
    assert.equal(res.code, 500);
  });

  it('POST 超 MAX_POST_BODY → req.destroy() 且不回包', () => {
    const req = makeReq();
    const res = makeRes();
    routeFor('POST')(req, res, null, true, baseDeps({ MAX_POST_BODY: 4 }));
    req.emit('data', Buffer.from('123456789'));
    assert.equal(req._destroyed, true);
    req.emit('end'); // truncated 守卫：不应再写响应
    assert.equal(res.code, null);
  });

  it('无活动工作区：workspace scope → 400;global scope 照常;GET 仍成功', async () => {
    const saved = process.env.CCV_PROJECT_DIR;
    delete process.env.CCV_PROJECT_DIR;
    try {
      const deps = baseDeps({ isWorkspaceMode: true });
      const bad = await callPost({ scope: 'workspace', name: 'opus', mode: 'append', text: 'x' }, deps);
      assert.equal(bad.code, 400);
      assert.equal(bad.json().error, 'no_active_workspace');
      const ok = await callPost({ scope: 'global', name: 'sonnet', mode: 'append', text: 'g' }, deps);
      assert.equal(ok.code, 200);
      const g = await callGet(deps);
      assert.equal(g.code, 200);
      assert.equal(g.json().workspaceActive, false);
      assert.deepEqual(g.json().workspace, []);
      assert.ok(g.json().global.some((e) => e.name === 'SONNET'));
    } finally {
      process.env.CCV_PROJECT_DIR = saved;
    }
  });

  it('GET 回包带 modelId/matched：env 模型命中条目时回传命中信息，未命中为 null', async () => {
    const saved = process.env.ANTHROPIC_MODEL;
    process.env.ANTHROPIC_MODEL = 'k3'; // 裸 k3 经别名表展开命中 KIMI-K3
    try {
      await callPost({ scope: 'global', name: 'kimi-k3', mode: 'override', text: 'K3-PROMPT' });
      const hit = (await callGet()).json();
      assert.equal(hit.modelId, 'k3');
      assert.deepEqual(hit.matched, { scope: 'global', name: 'KIMI-K3', mode: 'override' });
      process.env.ANTHROPIC_MODEL = 'gpt-5'; // 无对应条目 → 未命中
      const miss = (await callGet()).json();
      assert.equal(miss.modelId, 'gpt-5');
      assert.equal(miss.matched, null);
    } finally {
      if (saved === undefined) delete process.env.ANTHROPIC_MODEL; else process.env.ANTHROPIC_MODEL = saved;
      await callPost({ scope: 'global', name: 'kimi-k3', text: '' }); // 清理，避免影响其它断言
    }
  });
});
