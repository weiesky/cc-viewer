/**
 * workflow-live + 逐帧 watcher 单元测试
 *
 * 合成 subagents/workflows/<runId>/（agent-*.jsonl + meta + journal.jsonl）+ scripts，
 * 验证 deriveLiveJournal 推导（token/工具/running·done/workflowName/status）与
 * armWorkflowLiveWatch 经 SSE 广播 workflow_update + 去重。
 */
import { describe, it, after, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SAVED = process.env.CCV_PROJECTS_DIR;
const TMP = mkdtempSync(join(tmpdir(), 'ccv-live-'));
process.env.CCV_PROJECTS_DIR = TMP;

const { deriveLiveJournal, resolveRunDir, parsePhasesFromScript, __clearPhasesCacheForTests } =
  await import('../server/lib/workflow-live.js');
const { armWorkflowLiveWatch, unwatchAllWorkflows, __setWatchImplForTests, __triggerLiveScanForTests } =
  await import('../server/lib/workflow-watcher.js');

const ENC = '-proj';
const SID = 'sid-live';
const RUN = 'wf_live-1';

function sessionDir() { return join(TMP, ENC, SID); }
function runDir() { return join(sessionDir(), 'subagents', 'workflows', RUN); }

function agentLines({ prompt, model, tools, usage }) {
  const lines = [
    JSON.stringify({ type: 'user', timestamp: '2026-06-07T09:00:00.000Z', message: { role: 'user', content: prompt } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-06-07T09:00:05.000Z', message: { role: 'assistant', model, content: tools.map(n => ({ type: 'tool_use', name: n })), usage } }),
  ];
  return lines.join('\n') + '\n';
}

function setup({ doneA = true } = {}) {
  const rd = runDir();
  mkdirSync(rd, { recursive: true });
  mkdirSync(join(sessionDir(), 'workflows', 'scripts'), { recursive: true });
  writeFileSync(join(sessionDir(), 'workflows', 'scripts', `myflow-${RUN}.js`), '// script');

  writeFileSync(join(rd, 'agent-A.jsonl'), agentLines({
    prompt: 'Read server/foo.js and summarize its purpose',
    model: 'claude-haiku-4-5-20251001',
    tools: ['Read', 'Grep'],
    usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 5, cache_read_input_tokens: 9999 },
  }));
  writeFileSync(join(rd, 'agent-A.meta.json'), JSON.stringify({ agentType: 'Explore' }));

  writeFileSync(join(rd, 'agent-B.jsonl'), agentLines({
    prompt: 'Read server/bar.js',
    model: 'claude-haiku-4-5-20251001',
    tools: ['Read'],
    usage: { input_tokens: 100, output_tokens: 200, cache_creation_input_tokens: 0 },
  }));
  writeFileSync(join(rd, 'agent-B.meta.json'), JSON.stringify({ agentType: 'Explore' }));

  const jl = [JSON.stringify({ type: 'started', agentId: 'A' }), JSON.stringify({ type: 'started', agentId: 'B' })];
  if (doneA) jl.push(JSON.stringify({ type: 'result', agentId: 'A', result: 'ok' }));
  writeFileSync(join(rd, 'journal.jsonl'), jl.join('\n') + '\n');
  return rd;
}

after(() => {
  unwatchAllWorkflows();
  __setWatchImplForTests(null);
  rmSync(TMP, { recursive: true, force: true });
  if (SAVED === undefined) delete process.env.CCV_PROJECTS_DIR;
  else process.env.CCV_PROJECTS_DIR = SAVED;
});

afterEach(() => unwatchAllWorkflows());

// 单进程多文件跑(mocha)时各测试文件共享 process.env。根级 beforeEach 是进程全局的(会在姊妹
// 文件用例前也触发 → 互相顶替 CCV_PROJECTS_DIR)，故改用 describe 作用域的 setEnv()：顶层
// describe 顺序执行，作用域 beforeEach 只在本文件用例前跑。server 在调用时即时读 env。
const setEnv = () => beforeEach(() => { process.env.CCV_PROJECTS_DIR = TMP; });

describe('deriveLiveJournal', () => {
  setEnv();
  it('推导 token(in+out+cc，排除 cache_read)/工具/状态/workflowName', () => {
    const rd = setup({ doneA: true });
    const d = deriveLiveJournal(rd, RUN);
    assert.ok(d);
    assert.equal(d.live, true);
    assert.equal(d.workflowName, 'myflow');
    assert.equal(d.status, 'running');           // B 仍 running
    assert.equal(d.agentCount, 2);
    assert.deepEqual(d.phases, []);              // 运行中无 phase
    const A = d.agents.find(a => a.agentId === 'A');
    const B = d.agents.find(a => a.agentId === 'B');
    assert.equal(A.state, 'done');
    assert.equal(B.state, 'running');
    assert.equal(A.tokens, 35);                  // 10+20+5（不含 cache_read 9999）
    assert.equal(A.toolCalls, 2);
    assert.equal(A.agentType, 'Explore');
    assert.equal(A.label, 'Read server/foo.js and summarize its purpose');
    assert.equal(A.promptPreview, 'Read server/foo.js and summarize its purpose');  // 头部菱形 hover 预览
    assert.equal(A.resultPreview, '');  // 实时态尾部预览待完成快照补
    assert.equal(d.totalTokens, 35 + 300);
    assert.equal(d.totalToolCalls, 3);
  });

  it('全部 done → status finishing', () => {
    const rd = setup({ doneA: true });
    writeFileSync(join(rd, 'journal.jsonl'),
      [JSON.stringify({ type: 'started', agentId: 'A' }), JSON.stringify({ type: 'started', agentId: 'B' }),
       JSON.stringify({ type: 'result', agentId: 'A' }), JSON.stringify({ type: 'result', agentId: 'B' })].join('\n') + '\n');
    const d = deriveLiveJournal(rd, RUN);
    assert.equal(d.status, 'finishing');
  });

  it('无 agent 文件 → null', () => {
    const empty = join(TMP, ENC, 'sid-empty', 'subagents', 'workflows', 'wf_x');
    mkdirSync(empty, { recursive: true });
    assert.equal(deriveLiveJournal(empty, 'wf_x'), null);
  });

  it('增量续读：append 新行只读增量并累加 token/工具/lastTool', () => {
    const rd = join(TMP, ENC, 'sid-inc', 'subagents', 'workflows', 'wf_inc');
    mkdirSync(rd, { recursive: true });
    writeFileSync(join(rd, 'agent-X.jsonl'), agentLines({
      prompt: 'p', model: 'm', tools: ['Read'],
      usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 5 },
    }));
    writeFileSync(join(rd, 'agent-X.meta.json'), JSON.stringify({ agentType: 'Explore' }));
    writeFileSync(join(rd, 'journal.jsonl'), JSON.stringify({ type: 'started', agentId: 'X' }) + '\n');

    let d = deriveLiveJournal(rd, 'wf_inc');
    let X = d.agents.find(a => a.agentId === 'X');
    assert.equal(X.tokens, 35);
    assert.equal(X.toolCalls, 1);

    // append 一条 assistant 行（新增 6 token + Edit 工具）→ 仅增量读新增字节
    appendFileSync(join(rd, 'agent-X.jsonl'), JSON.stringify({
      type: 'assistant', timestamp: '2026-06-07T09:00:10.000Z',
      message: { role: 'assistant', model: 'm', content: [{ type: 'tool_use', name: 'Edit' }], usage: { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 3 } },
    }) + '\n');

    d = deriveLiveJournal(rd, 'wf_inc');
    X = d.agents.find(a => a.agentId === 'X');
    assert.equal(X.tokens, 41);          // 35 + 6
    assert.equal(X.toolCalls, 2);        // 1 + 1
    assert.equal(X.lastToolName, 'Edit');
  });
});

describe('parsePhasesFromScript', () => {
  const meta = (phasesSrc) => `export const meta = {\n  name: 'demo',\n  description: 'd',\n  phases: ${phasesSrc},\n}\nconst ROOT = '/tmp'\nconst SCHEMA = { type: 'object', items: [1, 2] }\n`;

  it('多行 phases（title+detail）→ index 从 1 同形', () => {
    const r = parsePhasesFromScript(meta(`[\n    { title: 'Review', detail: 'parallel reviewers' },\n    { title: 'Verify', detail: 'adversarial' },\n  ]`));
    assert.deepEqual(r, [
      { index: 1, title: 'Review', detail: 'parallel reviewers' },
      { index: 2, title: 'Verify', detail: 'adversarial' },
    ]);
  });

  it('单行紧凑 phases', () => {
    const r = parsePhasesFromScript(meta(`[{ title: 'TopUp', detail: '3 个并行 agent' }]`));
    assert.deepEqual(r, [{ index: 1, title: 'TopUp', detail: '3 个并行 agent' }]);
  });

  it('detail 可选 → 缺省空串', () => {
    const r = parsePhasesFromScript(meta(`[{ title: 'Explore' }, { title: 'Design' }]`));
    assert.deepEqual(r, [
      { index: 1, title: 'Explore', detail: '' },
      { index: 2, title: 'Design', detail: '' },
    ]);
  });

  it('phases 后紧跟其它代码不被吞（字符串感知配对）', () => {
    const r = parsePhasesFromScript(meta(`[{ title: 'A', detail: 'a' }]`));
    assert.equal(r.length, 1);
    assert.equal(r[0].title, 'A');
  });

  it('detail 含 ] } 逗号 与转义引号', () => {
    const r = parsePhasesFromScript(meta(`[{ title: 'Step [B]', detail: 'desc: }, x\\' y' }]`));
    assert.deepEqual(r, [{ index: 1, title: 'Step [B]', detail: "desc: }, x' y" }]);
  });

  it('双引号字符串', () => {
    const r = parsePhasesFromScript(meta(`[{ title: "Scan", detail: "d1" }]`));
    assert.deepEqual(r, [{ index: 1, title: 'Scan', detail: 'd1' }]);
  });

  it('空 phases → []', () => {
    assert.deepEqual(parsePhasesFromScript(meta(`[]`)), []);
  });

  it('无 meta / 非字符串 / 空 → []', () => {
    assert.deepEqual(parsePhasesFromScript('function f() {}'), []);
    assert.deepEqual(parsePhasesFromScript('// just a comment'), []);
    assert.deepEqual(parsePhasesFromScript(null), []);
    assert.deepEqual(parsePhasesFromScript(''), []);
  });

  it('项数上限保护（>50 截断）', () => {
    const items = Array.from({ length: 60 }, (_, i) => `{ title: 't${i}' }`).join(', ');
    const r = parsePhasesFromScript(meta(`[${items}]`));
    assert.equal(r.length, 50);
  });

  it('更长键名不抢匹配（subtitle/subdetail 不命中 title/detail）', () => {
    const r = parsePhasesFromScript(meta(`[{ subtitle: 'no', title: 'yes', subdetail: 'nope', detail: 'real' }]`));
    assert.deepEqual(r, [{ index: 1, title: 'yes', detail: 'real' }]);
  });

  it('反引号模板串 title/detail（含 ${} 插值不破坏配对）', () => {
    const r = parsePhasesFromScript(meta('[{ title: `Step ${n}`, detail: `a ${x[0]} b` }]'));
    assert.deepEqual(r, [{ index: 1, title: 'Step ${n}', detail: 'a ${x[0]} b' }]);
  });

  it('字段顺序无关（detail 在 title 之前）', () => {
    const r = parsePhasesFromScript(meta(`[{ detail: 'first', title: 'T' }]`));
    assert.deepEqual(r, [{ index: 1, title: 'T', detail: 'first' }]);
  });

  it('phases 为变量引用（非字面量）→ []', () => {
    const r = parsePhasesFromScript(`export const meta = {\n  name: 'x',\n  phases: PHASES,\n}\nconst PHASES = []\n`);
    assert.deepEqual(r, []);
  });
});

describe('deriveLiveJournal phases 集成 + 缓存', () => {
  setEnv();
  beforeEach(() => __clearPhasesCacheForTests());

  function setupWithMeta(scriptBody) {
    const ENC2 = '-proj', SID2 = 'sid-phases', RUN2 = 'wf_phases-1';
    const sdir = join(TMP, ENC2, SID2);
    const rd = join(sdir, 'subagents', 'workflows', RUN2);
    mkdirSync(rd, { recursive: true });
    mkdirSync(join(sdir, 'workflows', 'scripts'), { recursive: true });
    const scriptPath = join(sdir, 'workflows', 'scripts', `flowp-${RUN2}.js`);
    writeFileSync(scriptPath, scriptBody);
    writeFileSync(join(rd, 'agent-A.jsonl'), agentLines({
      prompt: 'do x', model: 'm', tools: ['Read'],
      usage: { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 0 },
    }));
    writeFileSync(join(rd, 'agent-A.meta.json'), JSON.stringify({ agentType: 'Explore' }));
    writeFileSync(join(rd, 'journal.jsonl'), JSON.stringify({ type: 'started', agentId: 'A' }) + '\n');
    return { rd, RUN2, scriptPath };
  }

  it('运行中填充 phases，且 agent 不丢、phaseIndex 仍 null', () => {
    const { rd, RUN2 } = setupWithMeta(
      `export const meta = {\n  name: 'flowp',\n  phases: [{ title: 'Review', detail: 'r' }, { title: 'Verify' }],\n}\n`);
    const d = deriveLiveJournal(rd, RUN2);
    assert.ok(d);
    assert.equal(d.workflowName, 'flowp');
    assert.deepEqual(d.phases, [
      { index: 1, title: 'Review', detail: 'r' },
      { index: 2, title: 'Verify', detail: '' },
    ]);
    assert.equal(d.agents.length, 1);             // agent 列不消失（回归保护）
    assert.equal(d.agents[0].phaseIndex, null);   // 运行中无权威映射
  });

  it('脚本无 meta → phases []', () => {
    const { rd, RUN2 } = setupWithMeta('// no meta here');
    assert.deepEqual(deriveLiveJournal(rd, RUN2).phases, []);
  });

  it('缓存按 mtime/size 失效：改写脚本后重解析', () => {
    const { rd, RUN2, scriptPath } = setupWithMeta(
      `export const meta = {\n  name: 'flowp',\n  phases: [{ title: 'One' }],\n}\n`);
    assert.deepEqual(deriveLiveJournal(rd, RUN2).phases, [{ index: 1, title: 'One', detail: '' }]);
    // 改写脚本（size 变）→ 缓存失效 → 拿到新 phases
    writeFileSync(scriptPath, `export const meta = {\n  name: 'flowp',\n  phases: [{ title: 'One' }, { title: 'Two' }],\n}\n`);
    const r2 = deriveLiveJournal(rd, RUN2).phases;
    assert.equal(r2.length, 2);
    assert.equal(r2[1].title, 'Two');
  });
});

describe('resolveRunDir 路径穿越防御', () => {
  setEnv();
  it('合法 wf_ runId 拼出 run 目录；穿越/非法 runId 一律 null', () => {
    const SID2 = 'sid-guard';
    writeFileSync(join(TMP, ENC, `${SID2}.jsonl`), '{}\n');  // 让 findTranscriptPath 命中
    const good = resolveRunDir(SID2, undefined, 'wf_good-1');
    assert.ok(good && good.endsWith(join(SID2, 'subagents', 'workflows', 'wf_good-1')));
    // 复用与完成态 journal 相同的 RUN_ID_RE：含 ../ 或路径分隔符/无 wf_ 前缀 → null（不拼路径）
    assert.equal(resolveRunDir(SID2, undefined, '../evil'), null);
    assert.equal(resolveRunDir(SID2, undefined, 'wf_../escape'), null);
    assert.equal(resolveRunDir(SID2, undefined, 'no-prefix'), null);
    assert.equal(resolveRunDir(SID2, undefined, ''), null);
  });
});

describe('armWorkflowLiveWatch', () => {
  setEnv();
  it('arm 即广播一帧；变更后再广播；无变化不广播', () => {
    const rd = setup({ doneA: false });
    __setWatchImplForTests(() => ({ close() {}, on() {} }));
    const writes = [];
    const clients = [{ write: (p) => { writes.push(p); return true; } }];

    armWorkflowLiveWatch({ runDir: rd, runId: RUN, sessionId: SID, clients });
    __triggerLiveScanForTests(rd);  // 强制首帧（绕过防抖）
    const evs1 = writes.filter(w => w.startsWith('event: workflow_update')).map(w => JSON.parse(w.match(/data: (.*)\n\n$/s)[1]));
    assert.ok(evs1.length >= 1);
    assert.equal(evs1[evs1.length - 1].runId, RUN);
    assert.equal(evs1[evs1.length - 1].data.live, true);

    const before = writes.length;
    __triggerLiveScanForTests(rd);  // 无变化
    assert.equal(writes.length, before);

    // A 完成 → 签名变化 → 广播
    writeFileSync(join(rd, 'journal.jsonl'),
      [JSON.stringify({ type: 'started', agentId: 'A' }), JSON.stringify({ type: 'started', agentId: 'B' }),
       JSON.stringify({ type: 'result', agentId: 'A' })].join('\n') + '\n');
    __triggerLiveScanForTests(rd);
    assert.ok(writes.length > before);
    const last = JSON.parse(writes[writes.length - 1].match(/data: (.*)\n\n$/s)[1]);
    assert.equal(last.data.agents.find(a => a.agentId === 'A').state, 'done');
  });

  it('权威完成快照落盘后逐帧 watch 自我拆除（safetyTimer 不再空转）', () => {
    const rd = setup({ doneA: false });
    __setWatchImplForTests(() => ({ close() {}, on() {} }));
    const writes = [];
    const clients = [{ write: (p) => { writes.push(p); return true; } }];

    armWorkflowLiveWatch({ runDir: rd, runId: RUN, sessionId: SID, clients });
    __triggerLiveScanForTests(rd);
    assert.ok(writes.length >= 1);  // 首帧

    // 写入权威 <runId>.json → 下次逐帧扫描应检测到并自我拆除
    writeFileSync(join(sessionDir(), 'workflows', `${RUN}.json`),
      JSON.stringify({ runId: RUN, status: 'completed', workflowProgress: [] }));
    __triggerLiveScanForTests(rd);
    const afterTeardown = writes.length;

    // watch 已拆：再改 + 触发不再广播（且 __trigger 对已移除的 runDir 是 no-op）
    writeFileSync(join(rd, 'journal.jsonl'),
      [JSON.stringify({ type: 'started', agentId: 'A' }), JSON.stringify({ type: 'result', agentId: 'A' }),
       JSON.stringify({ type: 'result', agentId: 'B' })].join('\n') + '\n');
    __triggerLiveScanForTests(rd);
    assert.equal(writes.length, afterTeardown);
  });
});
