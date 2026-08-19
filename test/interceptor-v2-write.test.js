/**
 * wire-v2 — v2-only 写路径的集成测试（1.7.0：v2 是唯一日志存储）。
 *
 * 驱动真实 fetch hook（手动 setupInterceptor over fake fetch），断言：
 *   (a) v2 session 目录取 WIRE_FORMAT_V2.md 的规范形态（meta/journal/conversations/
 *       responses/blobs），append 复用 CAS blob 引用；
 *   (b) 项目目录下【不再】出现任何 v1 .jsonl 文件；getLiveLogSource() 返回当前
 *       session dir；
 *   (c) v2 writer 被 sabotage（方法抛错）时 fetch hook 不受影响（响应照常返回），
 *       恢复后继续正常写入。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';

// ████ 数据安全死命令(2026-06-06 事故:测试五次删用户真实 ~/.claude 数据)████
// env 必须先于任何项目模块的【动态】import 锁死到进程私有临时目录；
// 严禁把 ../server/interceptor.js 改成顶层静态 import。
process.env.CCV_PROXY_MODE = '1';      // 跳过模块顶层 setupInterceptor 自执行
process.env.CCV_SYNC_WRITES = '1';     // 同步写盘，便于读取断言（v2 写队列读此 env）
delete process.env.CCV_WORKSPACE_MODE;
delete process.env.CCV_IM_PLATFORM;
const __isoDir = mkdtempSync(join(tmpdir(), 'ccv-v2w-'));
process.env.CCV_LOG_DIR = __isoDir;
process.env.CLAUDE_CONFIG_DIR = __isoDir;

const SID = '11112222-3333-4444-5555-666677778888';
const USER_ID = JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: SID });

let mod;
let nextResponse;

function makeMainAgentTools() {
  return [
    { name: 'Edit' }, { name: 'Bash' }, { name: 'Task' },
    { name: 'Read' }, { name: 'Write' }, { name: 'Glob' },
    { name: 'Grep' }, { name: 'Agent' }, { name: 'WebFetch' },
    { name: 'WebSearch' }, { name: 'NotebookEdit' }, { name: 'AskUser' },
  ];
}
const textMsg = (role, text) => ({ role, content: [{ type: 'text', text }] });
function mainAgentBody(messages, extra = {}) {
  return {
    system: [{ type: 'text', text: 'You are Claude Code, the official CLI.' }],
    tools: makeMainAgentTools(),
    metadata: { user_id: USER_ID },
    messages,
    ...extra,
  };
}

function projectDir() {
  const project = basename(process.cwd()).replace(/[^a-zA-Z0-9_\-\.]/g, '_');
  return join(__isoDir, project);
}

function sessionDir() {
  // Task C: the writer names dirs `<ts>_<uuid>`; resolve by UUID suffix.
  const sroot = join(projectDir(), 'sessions');
  let name = SID;
  try { name = readdirSync(sroot).find((n) => n === SID || n.endsWith('_' + SID)) || SID; } catch { /* not created yet */ }
  return join(sroot, name);
}

function readJsonl(path) {
  return readFileSync(path, 'utf-8').trim().split('\n').map(l => JSON.parse(l));
}

async function fireMainAgent(messages, respBody = { content: [], usage: { input_tokens: 3, output_tokens: 2 } }, extraHeaders = {}) {
  nextResponse = () => new Response(JSON.stringify(respBody), { status: 200, headers: { 'content-type': 'application/json' } });
  const res = await globalThis.fetch('https://api.anthropic.com/v1/messages?beta=true', {
    method: 'POST',
    headers: { 'x-api-key': 'sk-test-key-000000', ...extraHeaders },
    body: JSON.stringify(mainAgentBody(messages)),
  });
  assert.equal(res.status, 200);
  return res;
}

before(async () => {
  globalThis.fetch = async () => (nextResponse ? nextResponse() : new Response('{}', { status: 200 }));
  mod = await import('../packages/app/server/interceptor.js');
  mod.setupInterceptor();
  assert.equal(mod.LOG_FILE, '', '1.7.0 起 LOG_FILE 恒为空串（deprecated 占位导出）');
  assert.ok(mod._v2Writer.enabled, 'v2 writer 常开（唯一写路径）');
});

after(() => {
  setTimeout(() => process.exit(0), 30).unref();
});

describe('wire-v2 唯一写路径', () => {
  it('(a) 一次 mainAgent 往返：v2 session dir 取规范形态', async () => {
    await fireMainAgent([textMsg('user', 'hello v2')]);
    await mod._v2Writer.flush();

    const dir = sessionDir();
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf-8'));
    assert.equal(meta.wireFormat, 2);
    assert.equal(meta.sessionId, SID);
    assert.equal(meta.userIdRaw, USER_ID);

    const journal = readJsonl(join(dir, 'journal.jsonl'));
    assert.equal(journal[0].ph, 'meta', 'self-describing sentinel first');
    const req = journal.find(l => l.ph === 'req');
    const done = journal.find(l => l.ph === 'done');
    assert.equal(req.seq, 1);
    assert.equal(req.kind, 'main');
    assert.equal(req.conv, 'main');
    assert.equal(req.evt, 'snapshot');
    assert.ok(req.blobs.tools && req.blobs.sys, 'tools/system extracted to blob refs');
    assert.deepEqual(req.params, { metadata: { user_id: USER_ID } },
      'residual body params inlined on the req line (minus messages/system/tools)');
    assert.equal(typeof req.headers, 'object', 'redacted headers captured on the req line');
    assert.match(req.headers['x-api-key'], /\*\*\*\*/, 'x-api-key 已脱敏');
    assert.equal(done.seq, 1);
    assert.equal(done.status, 'ok');
    assert.equal(done.usage.in, 3);

    const conv = readJsonl(join(dir, 'conversations', 'main', 'e0.jsonl'));
    assert.equal(conv.length, 1);
    assert.equal(conv[0].t, 'snapshot');
    assert.equal(conv[0].msgs[0].content[0].text, 'hello v2');

    const responses = readJsonl(join(dir, 'responses.jsonl'));
    assert.equal(responses.length, 1);
    assert.equal(responses[0].seq, 1);
    assert.deepEqual(responses[0].body.usage, { input_tokens: 3, output_tokens: 2 });

    const blobs = readdirSync(join(dir, 'blobs'));
    assert.equal(blobs.length, 2, 'tools + system blobs');
  });

  it('(b) 项目目录无任何 v1 .jsonl；getLiveLogSource() 返回当前 session dir', () => {
    const names = readdirSync(projectDir());
    assert.ok(!names.some(n => n.endsWith('.jsonl')),
      `项目目录不得出现 v1 单文件日志（实际内容：${names.join(',')}）`);
    assert.equal(mod.getLiveLogSource(), sessionDir(), 'live 读源即当前 v2 session dir');
  });

  it('(a) 第二次延长 wire 的请求：append delta 切片 + 复用 CAS blob 引用', async () => {
    await fireMainAgent([
      textMsg('user', 'hello v2'),
      textMsg('assistant', 'hi there'),
      textMsg('user', 'second turn'),
    ]);
    await mod._v2Writer.flush();

    const dir = sessionDir();
    const journal = readJsonl(join(dir, 'journal.jsonl'));
    const reqs = journal.filter(l => l.ph === 'req');
    assert.equal(reqs.length, 2);
    assert.equal(reqs[1].seq, 2);
    assert.equal(reqs[1].evt, 'append');
    assert.deepEqual([reqs[1].msgFrom, reqs[1].msgTo], [1, 3]);
    assert.equal(reqs[0].blobs.tools, reqs[1].blobs.tools, 'unchanged tools → same CAS ref');

    const conv = readJsonl(join(dir, 'conversations', 'main', 'e0.jsonl'));
    assert.equal(conv.length, 2);
    assert.equal(conv[1].t, 'append');
    assert.equal(conv[1].msgs.length, 2, 'only the new tail slice is stored');

    assert.equal(readdirSync(join(dir, 'blobs')).length, 2, 'no new blobs for identical tools/system');
  });

  it('(c) sabotage v2 writer（方法抛错）→ fetch hook 不受影响，恢复后继续写入', async () => {
    const origIngest = mod._v2Writer.ingestRequest;
    const origCompletion = mod._v2Writer.ingestCompletion;
    mod._v2Writer.ingestRequest = () => { throw new Error('v2 exploded (request)'); };
    mod._v2Writer.ingestCompletion = () => { throw new Error('v2 exploded (completion)'); };
    const dir = sessionDir();
    const reqsBefore = readJsonl(join(dir, 'journal.jsonl')).filter(l => l.ph === 'req').length;
    try {
      // 抛错的 writer 绝不能打断 fetch hook：响应照常返回（fireMainAgent 内断言 200）
      const res = await fireMainAgent([
        textMsg('user', 'hello v2'),
        textMsg('assistant', 'hi there'),
        textMsg('user', 'second turn'),
        textMsg('assistant', 'sure'),
        textMsg('user', 'third turn — v2 is broken now'),
      ]);
      assert.equal(res.status, 200, 'sabotaged writer 下响应仍正常返回');
      const reqsDuring = readJsonl(join(dir, 'journal.jsonl')).filter(l => l.ph === 'req').length;
      assert.equal(reqsDuring, reqsBefore, 'sabotage 期间无新 journal 行（写入被吞掉而非崩溃）');
    } finally {
      mod._v2Writer.ingestRequest = origIngest;
      mod._v2Writer.ingestCompletion = origCompletion;
    }

    // 恢复后继续写入：conv 状态仍是 3 条（sabotage 那次没 ingest），7 条 wire → append 4..7
    await fireMainAgent([
      textMsg('user', 'hello v2'),
      textMsg('assistant', 'hi there'),
      textMsg('user', 'second turn'),
      textMsg('assistant', 'sure'),
      textMsg('user', 'third turn — v2 is broken now'),
      textMsg('assistant', 'recovered'),
      textMsg('user', 'fourth turn'),
    ]);
    await mod._v2Writer.flush();
    const reqs = readJsonl(join(dir, 'journal.jsonl')).filter(l => l.ph === 'req');
    assert.equal(reqs.length, reqsBefore + 1, '恢复后的请求正常落 journal');
    const last = reqs[reqs.length - 1];
    assert.equal(last.seq, reqs[reqs.length - 2].seq + 1, 'journal seq 继续单调递增');
    assert.equal(last.msgTo, 7, '恢复后的 req 描述 7 消息 wire');
    assert.equal(last.evt, 'append');
    assert.deepEqual([last.msgFrom, last.msgTo], [3, 7], '基于恢复前的 conv 状态做增量');
  });

  it('(d) x-claude-code-agent-id 头 → journal req 行持久化 agent 字段', async () => {
    // 前序测试已占用 seq 1..N；本测试追加 3 个请求，从末尾 seq 取各自行。
    await fireMainAgent([textMsg('user', 'agent header')], undefined, { 'x-claude-code-agent-id': 'frontend-reviewer@session-17e1f37a' });
    await mod._v2Writer.flush();
    const dir = sessionDir();
    let journal = readJsonl(join(dir, 'journal.jsonl'));
    const reqNamed = journal.filter(l => l.ph === 'req').at(-1);
    assert.deepEqual(reqNamed.agent, { agentName: 'frontend-reviewer', named: true },
      'named agent identity persisted on the req line');

    await fireMainAgent([textMsg('user', 'anon header')], undefined, { 'x-claude-code-agent-id': 'a7eea0a140349f80d' });
    await mod._v2Writer.flush();
    journal = readJsonl(join(dir, 'journal.jsonl'));
    const reqAnon = journal.filter(l => l.ph === 'req').at(-1);
    assert.deepEqual(reqAnon.agent, { agentName: null, named: false },
      'anonymous hex id persisted with named:false');

    await fireMainAgent([textMsg('user', 'no header')]);
    await mod._v2Writer.flush();
    journal = readJsonl(join(dir, 'journal.jsonl'));
    const reqNone = journal.filter(l => l.ph === 'req').at(-1);
    assert.equal(reqNone.agent, undefined, 'no header → no agent field');
  });
});
