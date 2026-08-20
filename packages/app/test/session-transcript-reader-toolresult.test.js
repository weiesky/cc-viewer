/**
 * lookupToolUseResult 单元测试
 *
 * 合成 CC transcript（type:"user" 行带 tool_result block + 顶层 toolUseResult），
 * 验证按 sessionId + tool_use.id 取 { runId, taskId }；命中 / miss / 缓存。
 */
import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SAVED_PROJECTS_DIR = process.env.CCV_PROJECTS_DIR;
const TMP = mkdtempSync(join(tmpdir(), 'ccv-tur-'));
process.env.CCV_PROJECTS_DIR = TMP;

const { lookupToolUseResult, clearCache } = await import('../server/lib/session-transcript-reader.js');

function writeUserToolResult(dir, sid, tuId, toolUseResult) {
  const projDir = join(TMP, dir);
  mkdirSync(projDir, { recursive: true });
  const line = JSON.stringify({
    type: 'user',
    sessionId: sid,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tuId, content: 'Workflow launched in background. Task ID: ' + (toolUseResult.taskId || '') }] },
    toolUseResult,
  });
  writeFileSync(join(projDir, `${sid}.jsonl`), line + '\n');
}

after(() => {
  rmSync(TMP, { recursive: true, force: true });
  if (SAVED_PROJECTS_DIR === undefined) delete process.env.CCV_PROJECTS_DIR;
  else process.env.CCV_PROJECTS_DIR = SAVED_PROJECTS_DIR;
});

beforeEach(() => clearCache());

describe('lookupToolUseResult', () => {
  it('命中 → 返回 { runId, taskId }', () => {
    writeUserToolResult('-proj-a', 'sid-a', 'toolu_1', { status: 'async_launched', runId: 'wf_abc-1', taskId: 'wt1' });
    const r = lookupToolUseResult('sid-a', 'toolu_1', 'a');
    assert.deepEqual(r, { runId: 'wf_abc-1', taskId: 'wt1' });
  });

  it('tool_use.id 不匹配 → null', () => {
    writeUserToolResult('-proj-b', 'sid-b', 'toolu_2', { runId: 'wf_def-2', taskId: 'wt2' });
    assert.equal(lookupToolUseResult('sid-b', 'toolu_NOPE', 'b'), null);
  });

  it('缺 sessionId / toolUseId → null', () => {
    assert.equal(lookupToolUseResult('', 'toolu_1'), null);
    assert.equal(lookupToolUseResult('sid-a', ''), null);
  });

  it('transcript 不存在 → null', () => {
    assert.equal(lookupToolUseResult('sid-missing', 'toolu_x'), null);
  });

  it('无 runId 的行（仅 taskId）→ null（taskId 走 enrich 文本兜底，不依赖 transcript）', () => {
    writeUserToolResult('-proj-c', 'sid-c', 'toolu_3', { taskId: 'wt3' });
    assert.equal(lookupToolUseResult('sid-c', 'toolu_3', 'c'), null);
  });
});
