/**
 * enrichWorkflow 单元测试
 *
 * 合成 transcript（取 runId）+ 合成 entry（body.messages 里的 Workflow tool_result），
 * 验证 rawHasWorkflowToolResult / enrichEntry 注入 _ccvWorkflow。
 */
import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SAVED_PROJECTS_DIR = process.env.CCV_PROJECTS_DIR;
const TMP = mkdtempSync(join(tmpdir(), 'ccv-ewf-'));
process.env.CCV_PROJECTS_DIR = TMP;

const { enrichEntry, rawHasWorkflowToolResult } = await import('../server/lib/enrich-workflow.js');
const { clearCache } = await import('../server/lib/session-transcript-reader.js');

function writeTranscript(dir, sid, tuId, toolUseResult) {
  const projDir = join(TMP, dir);
  mkdirSync(projDir, { recursive: true });
  const line = JSON.stringify({
    type: 'user',
    sessionId: sid,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tuId }] },
    toolUseResult,
  });
  writeFileSync(join(projDir, `${sid}.jsonl`), line + '\n');
}

function entryWithWorkflowResult({ sid, tuId, taskId = 'wt9', project = 'p' }) {
  return {
    timestamp: new Date().toISOString(),
    project,
    headers: { 'x-claude-code-session-id': sid },
    body: {
      messages: [
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: tuId, content: `Workflow launched in background. Task ID: ${taskId}\nSummary: x` }] },
      ],
    },
    response: { body: { content: [] } },
  };
}

after(() => {
  rmSync(TMP, { recursive: true, force: true });
  if (SAVED_PROJECTS_DIR === undefined) delete process.env.CCV_PROJECTS_DIR;
  else process.env.CCV_PROJECTS_DIR = SAVED_PROJECTS_DIR;
});

beforeEach(() => clearCache());

describe('rawHasWorkflowToolResult', () => {
  it('命中 Workflow 结果文本 → true', () => {
    assert.equal(rawHasWorkflowToolResult('...Workflow launched in background. Task ID: wt1...'), true);
  });
  it('无关文本 → false', () => {
    assert.equal(rawHasWorkflowToolResult('{"name":"Read"}'), false);
    assert.equal(rawHasWorkflowToolResult(null), false);
  });
});

describe('enrichEntry', () => {
  it('注入 _ccvWorkflow（runId 来自 transcript，taskId 来自文本）', () => {
    writeTranscript('-proj-a', 'sid-a', 'toolu_1', { runId: 'wf_run-1', taskId: 'wt1' });
    const entry = entryWithWorkflowResult({ sid: 'sid-a', tuId: 'toolu_1', taskId: 'wt1', project: 'a' });
    const { enriched } = enrichEntry(entry);
    assert.equal(enriched, 1);
    const blk = entry.body.messages[0].content[0];
    assert.deepEqual(blk._ccvWorkflow, { sessionId: 'sid-a', runId: 'wf_run-1', taskId: 'wt1', project: 'a' });
  });

  it('transcript miss 时仍按文本 taskId 注入', () => {
    const entry = entryWithWorkflowResult({ sid: 'sid-x', tuId: 'toolu_none', taskId: 'wtX', project: 'x' });
    const { enriched } = enrichEntry(entry);
    assert.equal(enriched, 1);
    const blk = entry.body.messages[0].content[0];
    assert.equal(blk._ccvWorkflow.taskId, 'wtX');
    assert.equal(blk._ccvWorkflow.sessionId, 'sid-x');
    assert.equal('runId' in blk._ccvWorkflow, false);
  });

  it('缺 sessionId header → 不补', () => {
    const entry = entryWithWorkflowResult({ sid: 'sid-a', tuId: 'toolu_1' });
    delete entry.headers['x-claude-code-session-id'];
    assert.deepEqual(enrichEntry(entry), { enriched: 0, missed: 0 });
  });

  it('非 Workflow tool_result → 不动', () => {
    const entry = {
      headers: { 'x-claude-code-session-id': 'sid-a' },
      body: { messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'normal output' }] }] },
    };
    assert.deepEqual(enrichEntry(entry), { enriched: 0, missed: 0 });
    assert.equal('_ccvWorkflow' in entry.body.messages[0].content[0], false);
  });

  it('幂等：已有 _ccvWorkflow 不重复处理', () => {
    const entry = entryWithWorkflowResult({ sid: 'sid-a', tuId: 'toolu_1', taskId: 'wt1' });
    entry.body.messages[0].content[0]._ccvWorkflow = { sessionId: 'sid-a', taskId: 'wt1' };
    assert.deepEqual(enrichEntry(entry), { enriched: 0, missed: 0 });
  });

  it('sub-agent 条目（mainAgent===false）不补', () => {
    const entry = entryWithWorkflowResult({ sid: 'sid-a', tuId: 'toolu_1' });
    entry.mainAgent = false;
    assert.deepEqual(enrichEntry(entry), { enriched: 0, missed: 0 });
  });
});
