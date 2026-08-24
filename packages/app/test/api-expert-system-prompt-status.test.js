// Coverage target: server/routes/expert.js (/api/expert/system-prompt-status GET)
// 范式同 test/api-expert-model-prompts.test.js：handler 为 (req,res,parsedUrl,isLocal,deps)，
// res 收集 writeHead/end，deps 注入最小依赖。
// 隔离：CCV_LOG_DIR/CLAUDE_CONFIG_DIR 指向临时目录并在 import 前设置；CCV_PROJECT_DIR 充当工作区。
// computeSystemPromptStatus 经 resolveSpawnModel 直读 process.env（pty-manager 的 NODE_TEST_CONTEXT
// 护栏不覆盖路由层），宿主 shell 导出的 CLAUDE_MODEL/ANTHROPIC_MODEL/CCV_DISABLE_AUTO_SYSTEM_PROMPT
// 会漏进来造成机器状态依赖 —— import 前一律 delete，各用例按需 set 并 restore。
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-api-sysprompt-status-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '0';
process.env.CCV_CLI_MODE = '0';
delete process.env.CLAUDE_MODEL;
delete process.env.ANTHROPIC_MODEL;
delete process.env.CCV_DISABLE_AUTO_SYSTEM_PROMPT;
const wsDir = join(tmpDir, 'project');
mkdirSync(wsDir, { recursive: true });
process.env.CCV_PROJECT_DIR = wsDir;

const { expertRoutes } = await import('../server/routes/expert.js');
const { MODEL_PROMPT_DIR } = await import('../server/lib/model-system-prompts.js');
const { LOG_DIR } = await import('../findcc.js');
const wsModelDir = join(wsDir, MODEL_PROMPT_DIR);
const globalModelDir = join(LOG_DIR, MODEL_PROMPT_DIR);

const handler = expertRoutes.find((x) => x.method === 'GET' && x.path === '/api/expert/system-prompt-status')?.handler;
assert.ok(handler, 'route GET /api/expert/system-prompt-status must exist');

function makeRes() {
  return {
    code: null, body: null, headers: null,
    writeHead(code, headers) { this.code = code; this.headers = headers; },
    end(s) { this.body = s; },
    json() { return JSON.parse(this.body); },
  };
}
function baseDeps(o = {}) { return { MAX_POST_BODY: 10 * 1024 * 1024, isWorkspaceMode: false, ...o }; }

async function callGet(deps = baseDeps()) {
  const res = makeRes();
  await handler({}, res, null, true, deps);
  return res;
}

// 用例级 env 操作助手：返回 restore 函数，finally 里调用(原值缺失则删回)。
function setEnv(key, value) {
  const saved = process.env[key];
  if (value === undefined) delete process.env[key]; else process.env[key] = value;
  return () => { if (saved === undefined) delete process.env[key]; else process.env[key] = saved; };
}

function writeEntry(dir, fileName, text = 'PROMPT') {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, fileName), text);
}

describe('api expert system-prompt-status', () => {
  after(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ } });

  it('空工作区 → 全不激活', async () => {
    const res = await callGet();
    assert.equal(res.code, 200);
    assert.deepEqual(res.json(), { active: false, modelId: null, matched: null, defaultActive: false });
  });

  it('工作区默认 sentinel(CC_APPEND_SYSTEM.md) → active+defaultActive', async () => {
    writeEntry(wsDir, 'CC_APPEND_SYSTEM.md');
    try {
      const j = (await callGet()).json();
      assert.equal(j.active, true);
      assert.equal(j.defaultActive, true);
      assert.equal(j.matched, null);
    } finally {
      rmSync(join(wsDir, 'CC_APPEND_SYSTEM.md'), { force: true });
    }
  });

  it('override sentinel(CC_SYSTEM.md)同样激活 defaultActive(|| 另一支)', async () => {
    writeEntry(wsDir, 'CC_SYSTEM.md');
    try {
      const j = (await callGet()).json();
      assert.equal(j.active, true);
      assert.equal(j.defaultActive, true);
      assert.equal(j.matched, null);
    } finally {
      rmSync(join(wsDir, 'CC_SYSTEM.md'), { force: true });
    }
  });

  it('配置了模型但无条目命中 + sentinel 在 → 默认提示词仍激活(matched=null)', async () => {
    const restore = setEnv('ANTHROPIC_MODEL', 'gpt-5'); // 无任何对应条目
    writeEntry(wsDir, 'CC_APPEND_SYSTEM.md');
    try {
      const j = (await callGet()).json();
      assert.equal(j.modelId, 'gpt-5');
      assert.equal(j.matched, null);
      assert.equal(j.active, true);
      assert.equal(j.defaultActive, true);
    } finally {
      restore();
      rmSync(join(wsDir, 'CC_APPEND_SYSTEM.md'), { force: true });
    }
  });

  it('条目命中与 sentinel 并存 → matched 与 defaultActive 同时成立', async () => {
    const restore = setEnv('ANTHROPIC_MODEL', 'k3');
    writeEntry(globalModelDir, 'KIMI-K3_SYSTEM.md');
    writeEntry(wsDir, 'CC_APPEND_SYSTEM.md');
    try {
      const j = (await callGet()).json();
      assert.deepEqual(j.matched, { scope: 'global', name: 'KIMI-K3', mode: 'override' });
      assert.equal(j.defaultActive, true);
      assert.equal(j.active, true);
    } finally {
      restore();
      rmSync(join(globalModelDir, 'KIMI-K3_SYSTEM.md'), { force: true });
      rmSync(join(wsDir, 'CC_APPEND_SYSTEM.md'), { force: true });
    }
  });

  it('env 模型命中全局条目 → matched 回传 scope/name/mode', async () => {
    const restore = setEnv('ANTHROPIC_MODEL', 'k3'); // 裸 k3 经别名表展开命中 KIMI-K3
    writeEntry(globalModelDir, 'KIMI-K3_SYSTEM.md');
    try {
      const j = (await callGet()).json();
      assert.equal(j.modelId, 'k3');
      assert.deepEqual(j.matched, { scope: 'global', name: 'KIMI-K3', mode: 'override' });
      assert.equal(j.active, true);
      assert.equal(j.defaultActive, false);
    } finally {
      restore();
      rmSync(join(globalModelDir, 'KIMI-K3_SYSTEM.md'), { force: true });
    }
  });

  it('CCV_DISABLE_AUTO_SYSTEM_PROMPT=1 → 一律不激活', async () => {
    const restoreModel = setEnv('ANTHROPIC_MODEL', 'k3');
    const restoreKill = setEnv('CCV_DISABLE_AUTO_SYSTEM_PROMPT', '1');
    writeEntry(globalModelDir, 'KIMI-K3_SYSTEM.md');
    writeEntry(wsDir, 'CC_APPEND_SYSTEM.md');
    try {
      assert.deepEqual((await callGet()).json(), { active: false, modelId: null, matched: null, defaultActive: false });
    } finally {
      restoreKill();
      restoreModel();
      rmSync(join(globalModelDir, 'KIMI-K3_SYSTEM.md'), { force: true });
      rmSync(join(wsDir, 'CC_APPEND_SYSTEM.md'), { force: true });
    }
  });

  it('同模型双作用域命中 → 工作区压过全局', async () => {
    const restore = setEnv('ANTHROPIC_MODEL', 'k3');
    writeEntry(globalModelDir, 'KIMI-K3_SYSTEM.md');
    writeEntry(wsModelDir, 'KIMI_SYSTEM.md');
    try {
      const j = (await callGet()).json();
      assert.deepEqual(j.matched, { scope: 'workspace', name: 'KIMI', mode: 'override' });
      assert.equal(j.active, true);
    } finally {
      restore();
      rmSync(join(globalModelDir, 'KIMI-K3_SYSTEM.md'), { force: true });
      rmSync(join(wsModelDir, 'KIMI_SYSTEM.md'), { force: true });
    }
  });

  it('无活动工作区(dir=null) → 全局条目仍可命中', async () => {
    const restoreDir = setEnv('CCV_PROJECT_DIR', undefined);
    const restore = setEnv('ANTHROPIC_MODEL', 'k3');
    writeEntry(globalModelDir, 'KIMI-K3_SYSTEM.md');
    try {
      const j = (await callGet(baseDeps({ isWorkspaceMode: true }))).json();
      assert.equal(j.defaultActive, false);
      assert.deepEqual(j.matched, { scope: 'global', name: 'KIMI-K3', mode: 'override' });
      assert.equal(j.active, true);
    } finally {
      restore();
      restoreDir();
      rmSync(join(globalModelDir, 'KIMI-K3_SYSTEM.md'), { force: true });
    }
  });
});

describe('api expert system-prompt-status — builtin 层', () => {
  it('无用户文件 + env 裸 k3 → matched.scope=builtin（内置命中即激活）', async () => {
    const restore = setEnv('ANTHROPIC_MODEL', 'k3');
    try {
      const j = (await callGet()).json();
      assert.equal(j.modelId, 'k3');
      assert.deepEqual(j.matched, { scope: 'builtin', name: 'KIMI-K3', mode: 'override' });
      assert.equal(j.active, true);
      assert.equal(j.defaultActive, false);
      assert.equal(j.builtinDisabled, undefined, '未禁用时不得出现 tombstonedBuiltin 字段');
    } finally {
      restore();
    }
  });

  it('墓碑禁用命中内置 → matched=null + tombstonedBuiltin 出现（active 视 sentinel 而定）', async () => {
    const restore = setEnv('ANTHROPIC_MODEL', 'k3');
    writeEntry(globalModelDir, '.builtin-disabled.json', '["KIMI-K3"]\n');
    try {
      const j = (await callGet()).json();
      assert.equal(j.matched, null);
      assert.deepEqual(j.builtinDisabled, { name: 'KIMI-K3' });
      assert.equal(j.active, false);
    } finally {
      restore();
      rmSync(join(globalModelDir, '.builtin-disabled.json'), { force: true });
    }
  });

  it('用户文件命中时内置层不介入（无 tombstonedBuiltin）', async () => {
    const restore = setEnv('ANTHROPIC_MODEL', 'k3');
    writeEntry(globalModelDir, 'KIMI-K3_SYSTEM.md');
    writeEntry(globalModelDir, '.builtin-disabled.json', '["KIMI-K3"]\n');
    try {
      const j = (await callGet()).json();
      assert.deepEqual(j.matched, { scope: 'global', name: 'KIMI-K3', mode: 'override' });
      assert.equal(j.builtinDisabled, undefined, '用户文件胜出时不得报墓碑');
    } finally {
      restore();
      rmSync(join(globalModelDir, 'KIMI-K3_SYSTEM.md'), { force: true });
      rmSync(join(globalModelDir, '.builtin-disabled.json'), { force: true });
    }
  });

  it('无匹配模型（gpt-5）→ matched:null 且无 tombstonedBuiltin', async () => {
    const restore = setEnv('ANTHROPIC_MODEL', 'gpt-5');
    try {
      const j = (await callGet()).json();
      assert.equal(j.matched, null);
      assert.equal(j.builtinDisabled, undefined);
      assert.equal(j.active, false);
    } finally {
      restore();
    }
  });
});
