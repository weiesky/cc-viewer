/**
 * Enrich Workflow
 *
 * 在 cc-viewer 出 SSE/REST 之前，给 Workflow 工具的 tool_result block 补一个
 * `_ccvWorkflow = { runId, taskId, sessionId, project }` 标记，供前端定位并拉取
 * workflow run journal（`<sessionDir>/workflows/<runId>.json`）渲染工作流面板。
 *
 * 数据来源：
 * - taskId：API wire 上 tool_result 文本 "Workflow launched in background. Task ID: <id>"。
 * - runId：仅在 CC transcript 行顶层 toolUseResult.runId，按 tool_use_id 反查
 *   （session-transcript-reader.lookupToolUseResult），wire 上没有。
 *
 * 不修改 Workflow 之外的工具；不覆盖已有 _ccvWorkflow（共享引用幂等）。
 */

import { lookupToolUseResult } from './session-transcript-reader.js';

const WF_RESULT_SUBSTR = 'Workflow launched in background. Task ID:';
const TASK_ID_RE = /Task ID:\s*([A-Za-z0-9_-]+)/;

/**
 * 廉价子串预过滤：原始 JSON 字符串里有没有 Workflow 工具结果文本。
 *
 * @param {string} raw
 * @returns {boolean}
 */
export function rawHasWorkflowToolResult(raw) {
  if (typeof raw !== 'string' || !raw) return false;
  return raw.indexOf(WF_RESULT_SUBSTR) !== -1;
}

function getResultText(block) {
  const c = block.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.map(p => (typeof p === 'string' ? p : (p && typeof p.text === 'string' ? p.text : ''))).join('');
  }
  return '';
}

function findWorkflowResultBlocks(content, out) {
  if (!Array.isArray(content)) return;
  for (const blk of content) {
    if (!blk || blk.type !== 'tool_result') continue;
    if (typeof blk.tool_use_id !== 'string' || !blk.tool_use_id) continue;
    if (blk._ccvWorkflow) continue;  // 已补（共享引用幂等）
    const txt = getResultText(blk);
    if (txt.indexOf(WF_RESULT_SUBSTR) === -1) continue;
    out.push({ blk, txt });
  }
}

/**
 * 遍历 entry 的 body.messages[*].content[] 找 Workflow tool_result，注入 _ccvWorkflow。
 * tool_result 只出现在 user 轮，不扫当前轮 response。
 *
 * @param {object} entry - 已 JSON.parse 的日志条目
 * @returns {{ enriched: number, missed: number }}
 */
export function enrichEntry(entry) {
  if (!entry || typeof entry !== 'object') return { enriched: 0, missed: 0 };
  if (entry.mainAgent === false) return { enriched: 0, missed: 0 };  // sub-agent 不补
  const sid = entry.headers?.['x-claude-code-session-id'] || null;
  if (!sid) return { enriched: 0, missed: 0 };
  const projectHint = typeof entry.project === 'string' ? entry.project : undefined;

  const candidates = [];
  const msgs = entry.body?.messages;
  if (Array.isArray(msgs)) {
    for (const m of msgs) {
      if (m && Array.isArray(m.content)) findWorkflowResultBlocks(m.content, candidates);
    }
  }
  if (candidates.length === 0) return { enriched: 0, missed: 0 };

  let enriched = 0, missed = 0;
  for (const { blk, txt } of candidates) {
    const m = TASK_ID_RE.exec(txt);
    const textTaskId = m ? m[1] : null;
    const found = lookupToolUseResult(sid, blk.tool_use_id, projectHint);
    const runId = found?.runId || null;
    const taskId = found?.taskId || textTaskId;
    if (runId || taskId) {
      const marker = { sessionId: sid };
      if (runId) marker.runId = runId;
      if (taskId) marker.taskId = taskId;
      if (projectHint) marker.project = projectHint;
      blk._ccvWorkflow = marker;
      enriched++;
    } else {
      missed++;
    }
  }
  return { enriched, missed };
}
