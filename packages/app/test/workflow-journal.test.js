/**
 * workflow-journal 单元测试
 *
 * normalizeWorkflowJournal 字段映射 + resolveJournalPath/readNormalizedJournal 定位读取
 * （含 runId / taskId 两种解析、坏 runId 拒绝、穿越守卫由 RUN_ID_RE 保证）。
 */
import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SAVED_PROJECTS_DIR = process.env.CCV_PROJECTS_DIR;
const TMP = mkdtempSync(join(tmpdir(), 'ccv-wfj-'));
process.env.CCV_PROJECTS_DIR = TMP;

const { normalizeWorkflowJournal, resolveJournalPath, readNormalizedJournal, resolveWorkflowsDir } =
  await import('../server/lib/workflow-journal.js');
const { clearCache } = await import('../server/lib/session-transcript-reader.js');
const { workflowJournalRoutes } = await import('../server/routes/workflow-journal.js');
const { __setWatchImplForTests, unwatchAllWorkflows } = await import('../server/lib/workflow-watcher.js');

// 路由 happy path 会惰性 arm watch：注入假 fs.watch，规避真实 watch 的平台时序
__setWatchImplForTests(() => ({ close() {}, on() {} }));

function fakeRes() {
  return {
    statusCode: 0, body: '',
    writeHead(c) { this.statusCode = c; },
    end(s) { this.body = s || ''; },
  };
}

const RAW_JOURNAL = {
  runId: 'wf_run-1',
  taskId: 'wt1',
  workflowName: 'demo-flow',
  summary: 'a demo',
  status: 'completed',
  durationMs: 1234,
  agentCount: 2,
  totalTokens: 5000,
  totalToolCalls: 7,
  defaultModel: 'claude-opus-4-8',
  startTime: 1700000000000,
  phases: [
    { title: 'Scan', detail: 'd1' },
    { title: 'Fix', detail: 'd2' },
  ],
  workflowProgress: [
    { type: 'workflow_phase', index: 1, title: 'Scan' },
    { type: 'workflow_agent', index: 1, label: 'scan:a', phaseIndex: 1, phaseTitle: 'Scan', agentId: 'a1', agentType: 'Explore', model: 'claude-haiku-4-5', state: 'done', tokens: 100, toolCalls: 3, durationMs: 500, lastToolName: 'Grep', startedAt: 1, lastProgressAt: 2, promptPreview: 'find the bug', resultPreview: 'fixed in foo.js' },
    { type: 'workflow_agent', index: 2, label: 'fix:b', phaseIndex: 2, phaseTitle: 'Fix', agentId: 'a2', agentType: 'general', model: 'claude-opus-4-8', state: 'running', tokens: 200, toolCalls: 4 },
  ],
};

function setupSession(dir, sid) {
  const projDir = join(TMP, dir);
  mkdirSync(join(projDir, sid, 'workflows'), { recursive: true });
  // 让 findTranscriptPath 解析到该 session
  writeFileSync(join(projDir, `${sid}.jsonl`), JSON.stringify({ type: 'user', sessionId: sid }) + '\n');
  return join(projDir, sid, 'workflows');
}

after(() => {
  unwatchAllWorkflows();
  __setWatchImplForTests(null);
  rmSync(TMP, { recursive: true, force: true });
  if (SAVED_PROJECTS_DIR === undefined) delete process.env.CCV_PROJECTS_DIR;
  else process.env.CCV_PROJECTS_DIR = SAVED_PROJECTS_DIR;
});

beforeEach(() => clearCache());

// 单进程多文件跑(mocha)时各测试文件共享 process.env。根级 beforeEach 是进程全局的(会在姊妹
// 文件的用例前也触发，后注册者胜出 → 互相顶替 CCV_PROJECTS_DIR 致 404)，故改用 describe 作用域
// 的 setEnv()：顶层 describe 顺序执行，作用域 beforeEach 只在本文件用例前跑。server 即时读 env。
const setEnv = () => beforeEach(() => { process.env.CCV_PROJECTS_DIR = TMP; });

describe('normalizeWorkflowJournal', () => {
  setEnv();
  it('映射顶层 + phases + agents（仅 workflow_agent）', () => {
    const n = normalizeWorkflowJournal(RAW_JOURNAL);
    assert.equal(n.workflowName, 'demo-flow');
    assert.equal(n.status, 'completed');
    assert.equal(n.totalTokens, 5000);
    assert.equal(n.phases.length, 2);
    assert.deepEqual(n.phases[0], { index: 1, title: 'Scan', detail: 'd1' });
    assert.equal(n.agents.length, 2);
    assert.equal(n.agents[0].label, 'scan:a');
    assert.equal(n.agents[0].state, 'done');
    assert.equal(n.agents[1].state, 'running');
    assert.equal(n.agents[1].durationMs, null);
    // 头/尾菱形 hover 预览：原样透传；缺字段 → 空串
    assert.equal(n.agents[0].promptPreview, 'find the bug');
    assert.equal(n.agents[0].resultPreview, 'fixed in foo.js');
    assert.equal(n.agents[1].promptPreview, '');
    assert.equal(n.agents[1].resultPreview, '');
    assert.equal(n.live, false);   // 权威完成快照显式标记，供前端防 live 帧回退
  });

  it('坏输入 → null', () => {
    assert.equal(normalizeWorkflowJournal(null), null);
    assert.equal(normalizeWorkflowJournal(42), null);
  });

  it('缺 phases/progress → 空数组', () => {
    const n = normalizeWorkflowJournal({ workflowName: 'x' });
    assert.deepEqual(n.phases, []);
    assert.deepEqual(n.agents, []);
    assert.equal(n.agentCount, 0);
  });
});

describe('resolveJournalPath / readNormalizedJournal', () => {
  setEnv();
  it('按 runId 定位并读取', () => {
    const wfDir = setupSession('-proj-a', 'sid-a');
    writeFileSync(join(wfDir, 'wf_run-1.json'), JSON.stringify(RAW_JOURNAL));
    const p = resolveJournalPath({ sessionId: 'sid-a', projectHint: 'a', runId: 'wf_run-1' });
    assert.ok(p && p.endsWith('wf_run-1.json'));
    const data = readNormalizedJournal(p);
    assert.equal(data.workflowName, 'demo-flow');
  });

  it('按 taskId 扫描定位', () => {
    const wfDir = setupSession('-proj-b', 'sid-b');
    writeFileSync(join(wfDir, 'wf_run-2.json'), JSON.stringify({ ...RAW_JOURNAL, runId: 'wf_run-2', taskId: 'wtB' }));
    const p = resolveJournalPath({ sessionId: 'sid-b', projectHint: 'b', taskId: 'wtB' });
    assert.ok(p && p.endsWith('wf_run-2.json'));
  });

  it('坏 runId（路径分隔符）→ null', () => {
    setupSession('-proj-c', 'sid-c');
    assert.equal(resolveJournalPath({ sessionId: 'sid-c', projectHint: 'c', runId: '../../etc/passwd' }), null);
    assert.equal(resolveJournalPath({ sessionId: 'sid-c', projectHint: 'c', runId: 'wf_/nope' }), null);
  });

  it('文件不存在 → null', () => {
    setupSession('-proj-d', 'sid-d');
    assert.equal(resolveJournalPath({ sessionId: 'sid-d', projectHint: 'd', runId: 'wf_missing' }), null);
  });

  it('resolveWorkflowsDir 指向 <session>/workflows', () => {
    setupSession('-proj-e', 'sid-e');
    const dir = resolveWorkflowsDir('sid-e', 'e');
    assert.ok(dir && dir.endsWith(join('sid-e', 'workflows')));
  });
});

describe('GET /api/workflow-journal session 校验', () => {
  setEnv();
  const handler = workflowJournalRoutes[0].handler;
  const call = (qs) => {
    const res = fakeRes();
    handler({}, res, new URL('http://x/api/workflow-journal?' + qs), true, { clients: [] });
    return res;
  };

  it('缺 session → 400 missing session', () => {
    const res = call('runId=wf_x');
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /missing session/);
  });

  it('非法 session（含 ../ 等路径字符）→ 400 invalid session（不进 findTranscriptPath 拼路径）', () => {
    for (const s of ['../evil', 'a/b', 'a.b', 'sid space']) {
      const res = call('session=' + encodeURIComponent(s) + '&runId=wf_x');
      assert.equal(res.statusCode, 400, `session=${s} 应 400`);
      assert.match(res.body, /invalid session/);
    }
  });

  it('合法 session 但无数据 → 404（通过校验，进入定位逻辑）', () => {
    const res = call('session=sid-nope-xyz&runId=wf_none');
    assert.equal(res.statusCode, 404);
  });
});

describe('GET /api/workflow-journal 数据路径', () => {
  setEnv();
  const handler = workflowJournalRoutes[0].handler;
  const call = (qs) => {
    const res = fakeRes();
    handler({}, res, new URL('http://x/api/workflow-journal?' + qs), true, { clients: [] });
    return res;
  };

  it('runId 命中完成快照 → 200 归一化数据（live:false）', () => {
    const wfDir = setupSession('-proj-f', 'sid-f');
    writeFileSync(join(wfDir, 'wf_run-f.json'), JSON.stringify({ ...RAW_JOURNAL, runId: 'wf_run-f' }));
    const res = call('session=sid-f&runId=wf_run-f&project=f');
    assert.equal(res.statusCode, 200);
    const j = JSON.parse(res.body);
    assert.equal(j.ok, true);
    assert.equal(j.data.workflowName, 'demo-flow');
    assert.equal(j.data.live, false);
    assert.equal(j.data.agents.length, 2);
  });

  it('taskId 扫描命中 → 200', () => {
    const wfDir = setupSession('-proj-g', 'sid-g');
    writeFileSync(join(wfDir, 'wf_run-g.json'), JSON.stringify({ ...RAW_JOURNAL, runId: 'wf_run-g', taskId: 'wtG' }));
    const res = call('session=sid-g&taskId=wtG&project=g');
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).data.runId, 'wf_run-g');
  });

  it('runId 与 taskId 同传 → runId 优先（不走 taskId 扫描）', () => {
    const wfDir = setupSession('-proj-h', 'sid-h');
    writeFileSync(join(wfDir, 'wf_run-h1.json'), JSON.stringify({ ...RAW_JOURNAL, runId: 'wf_run-h1', taskId: 'wtH1', workflowName: 'by-run' }));
    writeFileSync(join(wfDir, 'wf_run-h2.json'), JSON.stringify({ ...RAW_JOURNAL, runId: 'wf_run-h2', taskId: 'wtH2', workflowName: 'by-task' }));
    const res = call('session=sid-h&runId=wf_run-h1&taskId=wtH2&project=h');
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).data.workflowName, 'by-run');
  });

  it('快照缺失但 runDir 有 agent 文件 → 200 live 推导（live:true）', () => {
    setupSession('-proj-i', 'sid-i');
    const rd = join(TMP, '-proj-i', 'sid-i', 'subagents', 'workflows', 'wf_run-i');
    mkdirSync(rd, { recursive: true });
    writeFileSync(join(rd, 'agent-A.jsonl'), [
      JSON.stringify({ type: 'user', timestamp: '2026-06-07T09:00:00.000Z', message: { role: 'user', content: 'do x' } }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-06-07T09:00:05.000Z', message: { role: 'assistant', model: 'claude-haiku-4-5-20251001', content: [{ type: 'tool_use', name: 'Read' }], usage: { input_tokens: 10, output_tokens: 20 } } }),
    ].join('\n') + '\n');
    writeFileSync(join(rd, 'journal.jsonl'), JSON.stringify({ type: 'started', agentId: 'A' }) + '\n');
    const res = call('session=sid-i&runId=wf_run-i&project=i');
    assert.equal(res.statusCode, 200);
    const j = JSON.parse(res.body);
    assert.equal(j.ok, true);
    assert.equal(j.data.live, true);
    assert.equal(j.data.status, 'running');
    assert.equal(j.data.agents.length, 1);
    assert.equal(j.data.agents[0].tokens, 30);
  });
});
