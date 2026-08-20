// Coverage target: server/routes/expert.js (expertRoutes array)
// 范式同 test/api-workspaces.test.js：handler 为 (req,res,parsedUrl,isLocal,deps)，
// req 是 EventEmitter（emit data/end），res 收集 writeHead/end，deps 注入最小依赖。
// 隔离：CCV_LOG_DIR/CLAUDE_CONFIG_DIR 指向临时目录并在 import 前设置；CCV_PROJECT_DIR 充当工作区。
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-api-expert-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '0';
process.env.CCV_CLI_MODE = '0';
const wsDir = join(tmpDir, 'project');
mkdirSync(wsDir, { recursive: true });
process.env.CCV_PROJECT_DIR = wsDir;

const { expertRoutes } = await import('../server/routes/expert.js');
const { SYSTEM_PROMPT_FILE, APPEND_SYSTEM_PROMPT_FILE } = await import('../server/lib/system-prompt-files.js');
const SYS = join(wsDir, SYSTEM_PROMPT_FILE);
const APP = join(wsDir, APPEND_SYSTEM_PROMPT_FILE);

function routeFor(method) {
  const r = expertRoutes.find((x) => x.method === method && x.path === '/api/expert/system-text');
  assert.ok(r, `route ${method} /api/expert/system-text must exist`);
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

describe('api expert system-text', () => {
  after(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ } });

  it('GET 初始 → active=true, dir=工作区, append 空', async () => {
    const res = await callGet();
    assert.equal(res.code, 200);
    const j = res.json();
    assert.equal(j.active, true);
    assert.equal(j.dir, wsDir);
    assert.deepEqual({ mode: j.mode, text: j.text }, { mode: 'append', text: '' });
  });

  it('POST override → 写 CC_SYSTEM.md，GET 能回显', async () => {
    const res = await callPost({ mode: 'override', text: 'HELLO' });
    assert.equal(res.code, 200);
    assert.equal(res.json().ok, true);
    assert.equal(readFileSync(SYS, 'utf-8'), 'HELLO');
    assert.equal(existsSync(APP), false);
    const g = (await callGet()).json();
    assert.deepEqual({ mode: g.mode, text: g.text }, { mode: 'override', text: 'HELLO' });
  });

  it('POST append → 写 CC_APPEND_SYSTEM.md、删 CC_SYSTEM.md', async () => {
    const res = await callPost({ mode: 'append', text: 'WORLD' });
    assert.equal(res.code, 200);
    assert.equal(readFileSync(APP, 'utf-8'), 'WORLD');
    assert.equal(existsSync(SYS), false);
  });

  it('POST 空白文本 → 删两份(cleared)', async () => {
    writeFileSync(SYS, 'x');
    const res = await callPost({ mode: 'override', text: '   ' });
    assert.equal(res.code, 200);
    assert.equal(res.json().cleared, true);
    assert.equal(existsSync(SYS), false);
    assert.equal(existsSync(APP), false);
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

  it('POST 无活动工作区 → 400 no_active_workspace', async () => {
    const saved = process.env.CCV_PROJECT_DIR;
    delete process.env.CCV_PROJECT_DIR;
    try {
      const res = await callPost({ mode: 'append', text: 'x' }, baseDeps({ isWorkspaceMode: true }));
      assert.equal(res.code, 400);
      assert.equal(res.json().error, 'no_active_workspace');
    } finally {
      process.env.CCV_PROJECT_DIR = saved;
    }
  });
});
