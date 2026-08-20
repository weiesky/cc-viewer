/**
 * 单元测试目标：src/utils/workflowRuns.js 的 extractWorkflowRuns
 *
 * 验证从当前会话 requests 枚举所有 Workflow run:user 轮 tool_result 定位、taskId 主键去重 +
 * runId/sessionId 回填、最早 timestamp 倒序、summary 解析、边界。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractWorkflowRuns } from '../src/utils/workflowRuns.js';

let _idSeq = 0;

// 构造一条「Workflow 工具调用 + 其结果」的 request:
//   assistant 轮 tool_use(name='Workflow') + user 轮 tool_result(同 tool_use_id)。
// extractWorkflowRuns 需凭 tool_use_id 反查工具名,只认 Workflow。
function req(timestamp, text, toolName = 'Workflow') {
  const id = `tu_${_idSeq++}`;
  return {
    timestamp,
    body: {
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id, name: toolName }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] },
      ],
    },
  };
}

const launch = (taskId, runId, session, summary) =>
  `Workflow launched in background. Task ID: ${taskId}\n` +
  (summary ? `Summary: ${summary}\n` : '') +
  (session ? `Transcript dir: /Users/x/.claude/projects/-enc/${session}/subagents/workflows/${runId}\n` : '') +
  (runId ? `Run ID: ${runId}\n` : '');

describe('extractWorkflowRuns', () => {
  test('从 user 轮 tool_result 解析出一个 run', () => {
    const runs = extractWorkflowRuns([
      req('2026-06-08T01:00:00Z', launch('t1', 'wf_aaa', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'Fix foo')),
    ]);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].runId, 'wf_aaa');
    assert.equal(runs[0].taskId, 't1');
    assert.equal(runs[0].sessionId, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    assert.equal(runs[0].summary, 'Fix foo');
    assert.ok(runs[0].resultText.includes('Task ID: t1'));
  });

  test('多个不同 run 全部枚举', () => {
    const runs = extractWorkflowRuns([
      req('2026-06-08T01:00:00Z', launch('t1', 'wf_aaa', 's1aaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')),
      req('2026-06-08T02:00:00Z', launch('t2', 'wf_bbb', 's2aaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')),
    ]);
    assert.equal(runs.length, 2);
    const ids = runs.map(r => r.runId).sort();
    assert.deepEqual(ids, ['wf_aaa', 'wf_bbb']);
  });

  test('同一 run 多次重试(同 taskId+runId)去重为一条', () => {
    const runs = extractWorkflowRuns([
      req('2026-06-08T01:00:00Z', launch('t1', 'wf_aaa', 's1aaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')),
      req('2026-06-08T01:30:00Z', launch('t1', 'wf_aaa', 's1aaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')),
    ]);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].runId, 'wf_aaa');
  });

  test('先「仅 taskId、无 runId」后「taskId+runId」→ 合并为一条并回填 runId/sessionId', () => {
    const runs = extractWorkflowRuns([
      // 第一条 Run ID 行被截断、路径缺失
      req('2026-06-08T01:00:00Z', 'Workflow launched in background. Task ID: t1\n(truncated)'),
      // 第二条完整
      req('2026-06-08T01:30:00Z', launch('t1', 'wf_aaa', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')),
    ]);
    assert.equal(runs.length, 1, '应去重为一条(taskId 主键)');
    assert.equal(runs[0].runId, 'wf_aaa', '应回填 runId');
    assert.equal(runs[0].sessionId, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', '应回填 sessionId');
  });

  test('按最早出现的 timestamp 倒序(最新在前)', () => {
    const runs = extractWorkflowRuns([
      req('2026-06-08T01:00:00Z', launch('t1', 'wf_old', 's1aaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')),
      req('2026-06-08T03:00:00Z', launch('t2', 'wf_new', 's2aaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')),
    ]);
    assert.deepEqual(runs.map(r => r.runId), ['wf_new', 'wf_old']);
  });

  test('timestamp 取该 run 最早一次出现', () => {
    const runs = extractWorkflowRuns([
      req('2026-06-08T05:00:00Z', launch('t1', 'wf_aaa', 's1aaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')),
      req('2026-06-08T01:00:00Z', launch('t1', 'wf_aaa', 's1aaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')),
    ]);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].timestamp, '2026-06-08T01:00:00Z');
  });

  test('非 Workflow 的 tool_result 跳过', () => {
    const runs = extractWorkflowRuns([
      req('2026-06-08T01:00:00Z', 'Edit applied to foo.js'),
      { timestamp: 't', body: { messages: [{ role: 'assistant', content: [{ type: 'text', text: 'hi' }] }] } },
    ]);
    assert.equal(runs.length, 0);
  });

  test('只扫 user 轮:assistant 轮里的同文本不被当作 tool_result', () => {
    const runs = extractWorkflowRuns([
      { timestamp: 't', body: { messages: [
        { role: 'assistant', content: [{ type: 'tool_use', name: 'Workflow' }] },
      ] } },
    ]);
    assert.equal(runs.length, 0);
  });

  test('非 Workflow 工具(Read/Bash)回显含 marker 字面量的源码不被误检', () => {
    // 复现 bug:某 Read/Bash 结果文本里包含测试 fixture / marker 源码字面量,
    // 含 "Workflow launched in background"/"Task ID:"/"Run ID: wf_..." 但其工具名不是 Workflow。
    const sourceEcho =
      'Workflow launched in background. Task ID: t1\n' +
      "(summary ? `Summary: ${summary}\\n` : '') +\n" +
      'Run ID: wf_fake\n' +
      'Transcript dir: /Users/x/.claude/projects/-enc/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/x';
    const runs = extractWorkflowRuns([
      req('2026-06-08T11:53:00Z', sourceEcho, 'Read'),
      req('2026-06-08T11:53:00Z', sourceEcho, 'Bash'),
    ]);
    assert.equal(runs.length, 0, '非 Workflow 工具的结果不应产生 run');
  });

  test('Workflow 与非 Workflow 工具结果共存:只取 Workflow 的', () => {
    const real = launch('treal', 'wf_real', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'real run');
    const fake = 'Workflow launched in background. Task ID: tfake\nRun ID: wf_fake\nSummary: noise';
    const runs = extractWorkflowRuns([
      req('2026-06-08T10:00:00Z', real, 'Workflow'),
      req('2026-06-08T11:00:00Z', fake, 'Read'),
    ]);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].runId, 'wf_real');
  });

  test('空/畸形输入安全返回 []', () => {
    assert.deepEqual(extractWorkflowRuns(null), []);
    assert.deepEqual(extractWorkflowRuns(undefined), []);
    assert.deepEqual(extractWorkflowRuns([]), []);
    assert.deepEqual(extractWorkflowRuns([{}, { body: null }, { body: { messages: null } }]), []);
  });
});
