/**
 * 从当前会话的 requests 提取所有 Workflow(UltraCode)run。
 *
 * 数据源:tool_result 块在 requests[i].body.messages 的 **user 轮**(与 toolResultBuilder.js
 * 的全局索引扫描同源,见其 role==='user' 分支)。每个 Workflow 工具的后台启动返回文本
 * 原生携带 Task ID / Run ID / Transcript dir 路径(含 sessionId),由 parseWorkflowFromText 解析,
 * 无需服务端 _ccvWorkflow 注入——历史日志(含旧日志)同样可枚举。
 *
 * 镜像 teamSessionParser.js 的 extractTeamSessions 模式:纯函数、无副作用,便于 node --test 直接 import。
 */

import { extractToolResultText, parseWorkflowFromText } from './toolResultCore.js';

const SUMMARY_RE = /Summary:\s*(.+)/;

/**
 * 枚举 requests 里的全部 workflow run,按 taskId 主键去重(回填缺失的 runId/sessionId),
 * 按最早出现时间倒序(最新在前)。
 *
 * @param {Array} requests - ChatView 的 requests 数组(每项含 timestamp 与 body.messages)
 * @returns {Array<{ runId: string|null, taskId: string|null, sessionId: string|null,
 *                    resultText: string, timestamp: any, summary: string|null }>}
 */
export function extractWorkflowRuns(requests) {
  if (!Array.isArray(requests)) return [];

  // 以「逻辑 run 键」聚合:taskId 优先(launch 文本必有、1:1 对应一次 run),
  // 缺失才退回 runId。合并同键时回填先到条目缺失的字段,避免「仅 taskId」与
  // 「taskId+runId」因键漂移而漏去重。
  const byKey = new Map();

  // tool_use_id → 工具名。仅认 Workflow 工具产生的 tool_result——否则其它工具
  // (Read/Bash/Write 等)若回显含 "Workflow launched in background"/"Run ID:" 字面量的
  // 源码或日志,会被 parseWorkflowFromText 误判为一次真实启动(自引用误检)。
  // 与 ToolResultView 渲染内联面板前判 toolName==='Workflow' 同源,扫法对齐 toolResultBuilder。
  const toolNameById = buildToolUseNameMap(requests);

  for (const req of requests) {
    const msgs = req?.body?.messages;
    if (!Array.isArray(msgs)) continue;
    for (const m of msgs) {
      if (m?.role !== 'user' || !Array.isArray(m.content)) continue;
      for (const block of m.content) {
        if (block?.type !== 'tool_result') continue;
        if (toolNameById.get(block.tool_use_id) !== 'Workflow') continue;
        const txt = extractToolResultText(block);
        const wf = parseWorkflowFromText(txt);
        if (!wf) continue;

        const key = wf.taskId || wf.runId;
        if (!key) continue;
        const summary = (txt.match(SUMMARY_RE) || [])[1]?.trim() || null;

        const existing = byKey.get(key);
        if (!existing) {
          byKey.set(key, {
            runId: wf.runId,
            taskId: wf.taskId,
            sessionId: wf.sessionId,
            resultText: txt,
            timestamp: req?.timestamp ?? null,
            summary,
          });
        } else {
          // 回填缺失字段(取任一非空);timestamp 保留最早出现的一条。
          if (!existing.runId && wf.runId) existing.runId = wf.runId;
          if (!existing.taskId && wf.taskId) existing.taskId = wf.taskId;
          if (!existing.sessionId && wf.sessionId) existing.sessionId = wf.sessionId;
          if (!existing.summary && summary) existing.summary = summary;
          if (isEarlier(req?.timestamp, existing.timestamp)) {
            existing.timestamp = req.timestamp;
            existing.resultText = txt;
          }
        }
      }
    }
  }

  // 最新在前:timestamp 降序;无 timestamp 的排末尾。
  return Array.from(byKey.values()).sort((a, b) => tsValue(b.timestamp) - tsValue(a.timestamp));
}

/**
 * 扫 assistant 轮(body.messages)与当前轮 response(response.body.content)的 tool_use,
 * 建 id → name 映射。tool_result 凭 tool_use_id 反查工具名,只放行 Workflow。
 */
function buildToolUseNameMap(requests) {
  const map = new Map();
  for (const req of requests) {
    const msgs = req?.body?.messages;
    if (Array.isArray(msgs)) {
      for (const m of msgs) {
        if (m?.role === 'assistant' && Array.isArray(m.content)) {
          for (const b of m.content) {
            if (b?.type === 'tool_use' && b.id) map.set(b.id, b.name);
          }
        }
      }
    }
    const respContent = req?.response?.body?.content;
    if (Array.isArray(respContent)) {
      for (const b of respContent) {
        if (b?.type === 'tool_use' && b.id) map.set(b.id, b.name);
      }
    }
  }
  return map;
}

function tsValue(ts) {
  if (ts == null) return -Infinity;
  const n = typeof ts === 'number' ? ts : Date.parse(ts);
  return Number.isNaN(n) ? -Infinity : n;
}

function isEarlier(candidate, current) {
  return tsValue(candidate) < tsValue(current);
}
