/**
 * 单元测试目标：src/utils/toolResultCore.js 的 parseWorkflowFromText
 *
 * 验证从 Workflow tool_result 原始文本解析 { runId, taskId, sessionId } 定位线索——
 * 这些线索原生存在于 wire 文本，前端解析为主，不依赖服务端 _ccvWorkflow 注入。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkflowFromText } from '../src/utils/toolResultCore.js';

// 真实后台启动返回文本（取自 ?logfile= 历史日志条目）
const REAL_LAUNCH_TEXT = `Workflow launched in background. Task ID: wn2lxeyto
Summary: logfile= 历史日志模式:忽略仅当前会话设置 + 一次性全量加载渲染
Transcript dir: /Users/sky/.claude/projects/-Users-sky--npm-global-lib-node-modules-cc-viewer/f4b9d1bc-831f-4376-b737-e27575e72779/subagents/workflows/wf_155b73f5-60d
Script file: /Users/sky/.claude/projects/-Users-sky--npm-global-lib-node-modules-cc-viewer/f4b9d1bc-831f-4376-b737-e27575e72779/workflows/scripts/fix-logfile-mode-wf_155b73f5-60d.js
Run ID: wf_155b73f5-60d
To resume after editing the script: ...`;

describe('parseWorkflowFromText', () => {
  test('从真实后台启动文本解析出 runId / taskId / sessionId', () => {
    const r = parseWorkflowFromText(REAL_LAUNCH_TEXT);
    assert.deepEqual(r, {
      runId: 'wf_155b73f5-60d',
      taskId: 'wn2lxeyto',
      sessionId: 'f4b9d1bc-831f-4376-b737-e27575e72779',
    });
  });

  test('仅有 Task ID（无 Run ID / 路径）也能命中', () => {
    const r = parseWorkflowFromText('Workflow launched in background. Task ID: abc123');
    assert.equal(r.taskId, 'abc123');
    assert.equal(r.runId, null);
    assert.equal(r.sessionId, null);
  });

  test('sessionId 仅从 /projects/<cwd>/<UUID>/ 路径段提取', () => {
    const txt = 'Workflow launched in background. Task ID: t1\nScript file: /a/projects/-enc-cwd/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/workflows/scripts/x.js';
    const r = parseWorkflowFromText(txt);
    assert.equal(r.sessionId, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  test('非 Workflow 文本返回 null', () => {
    assert.equal(parseWorkflowFromText('some unrelated tool output'), null);
    assert.equal(parseWorkflowFromText('Edit applied to file foo.js'), null);
  });

  test('有启动标记但既无 Run ID 也无 Task ID → null', () => {
    assert.equal(parseWorkflowFromText('Workflow launched in background. (truncated)'), null);
  });

  test('非字符串输入安全返回 null', () => {
    assert.equal(parseWorkflowFromText(null), null);
    assert.equal(parseWorkflowFromText(undefined), null);
    assert.equal(parseWorkflowFromText({}), null);
    assert.equal(parseWorkflowFromText(123), null);
  });
});
