/**
 * Workflow Journal
 *
 * 定位 + 读取 + 归一化 Claude Code 的 workflow run journal：
 *   <projectsDir>/<encoded-cwd>/<sessionId>/workflows/<runId>.json
 *
 * journal 运行中被整体覆写，含 workflowName / summary / status / phases[] /
 * workflowProgress[](workflow_phase | workflow_agent) / totalTokens / totalToolCalls。
 * 这里把它压成前端工作流面板要用的精简模型（normalizeWorkflowJournal）。
 *
 * 安全：runId 受 RUN_ID_RE 限制（无路径分隔符）；session 子目录由 findTranscriptPath
 * 解析（恒在 projectsDir 内）；读盘前 realpath 复核仍落在 projectsDir 内，防穿越。
 */

import { existsSync, readFileSync, statSync, realpathSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { getClaudeConfigDir } from '../../findcc.js';
import { findTranscriptPath } from './session-transcript-reader.js';

const RUN_ID_RE = /^wf_[A-Za-z0-9_-]+$/;
const TASK_ID_RE = /^[A-Za-z0-9_-]+$/;
const MAX_JOURNAL_BYTES = 16 * 1024 * 1024;  // journal 通常 ~100KB，16MB 兜底防异常大文件

function projectsDir() {
  return process.env.CCV_PROJECTS_DIR || join(getClaudeConfigDir(), 'projects');
}

/**
 * sessionId(+projectHint) → 该 session 的 workflows 目录绝对路径（可能不存在）。
 * @returns {string | null}
 */
export function resolveWorkflowsDir(sessionId, projectHint) {
  if (!sessionId) return null;
  const transcript = findTranscriptPath(sessionId, projectHint);
  if (!transcript) return null;
  return join(dirname(transcript), sessionId, 'workflows');
}

function isInsideProjectsDir(realPath) {
  let root;
  try { root = realpathSync(projectsDir()); } catch { return false; }
  return realPath === root || realPath.startsWith(root + sep);
}

/**
 * 解析 journal 文件绝对路径。
 * - runId：直接 <wfDir>/<runId>.json。
 * - 否则 taskId：扫 wfDir 找 .taskId 匹配的 wf_*.json。
 * @returns {string | null}
 */
export function resolveJournalPath({ sessionId, projectHint, runId, taskId }) {
  const wfDir = resolveWorkflowsDir(sessionId, projectHint);
  if (!wfDir) return null;

  if (runId && RUN_ID_RE.test(runId)) {
    const p = join(wfDir, `${runId}.json`);
    if (!existsSync(p)) return null;
    let real;
    try { real = realpathSync(p); } catch { return null; }
    return isInsideProjectsDir(real) ? real : null;
  }

  if (taskId && TASK_ID_RE.test(taskId)) {
    let files;
    try { files = readdirSync(wfDir); } catch { return null; }
    for (const f of files) {
      if (!f.startsWith('wf_') || !f.endsWith('.json')) continue;
      const p = join(wfDir, f);
      try {
        if (statSync(p).size > MAX_JOURNAL_BYTES) continue;
        const j = JSON.parse(readFileSync(p, 'utf-8'));
        if (j && j.taskId === taskId) {
          const real = realpathSync(p);
          return isInsideProjectsDir(real) ? real : null;
        }
      } catch { /* 跳过坏文件 */ }
    }
  }
  return null;
}

/**
 * 把 journal 原始对象压成前端面板模型。坏输入返回 null。
 */
export function normalizeWorkflowJournal(j) {
  if (!j || typeof j !== 'object') return null;

  const phases = Array.isArray(j.phases)
    ? j.phases.map((p, i) => ({
        index: i + 1,
        title: typeof p?.title === 'string' ? p.title : '',
        detail: typeof p?.detail === 'string' ? p.detail : '',
      }))
    : [];

  const agents = Array.isArray(j.workflowProgress)
    ? j.workflowProgress
        .filter(p => p && p.type === 'workflow_agent')
        .map(a => ({
          index: typeof a.index === 'number' ? a.index : null,
          label: typeof a.label === 'string' ? a.label : '',
          phaseIndex: typeof a.phaseIndex === 'number' ? a.phaseIndex : null,
          phaseTitle: typeof a.phaseTitle === 'string' ? a.phaseTitle : '',
          agentId: typeof a.agentId === 'string' ? a.agentId : '',
          agentType: typeof a.agentType === 'string' ? a.agentType : '',
          model: typeof a.model === 'string' ? a.model : '',
          state: typeof a.state === 'string' ? a.state : '',
          tokens: typeof a.tokens === 'number' ? a.tokens : 0,
          toolCalls: typeof a.toolCalls === 'number' ? a.toolCalls : 0,
          durationMs: typeof a.durationMs === 'number' ? a.durationMs : null,
          lastToolName: typeof a.lastToolName === 'string' ? a.lastToolName : '',
          lastToolSummary: typeof a.lastToolSummary === 'string' ? a.lastToolSummary : '',
          promptPreview: typeof a.promptPreview === 'string' ? a.promptPreview : '',
          resultPreview: typeof a.resultPreview === 'string' ? a.resultPreview : '',
          startedAt: typeof a.startedAt === 'number' ? a.startedAt : null,
          lastProgressAt: typeof a.lastProgressAt === 'number' ? a.lastProgressAt : null,
        }))
    : [];

  return {
    runId: typeof j.runId === 'string' ? j.runId : '',
    taskId: typeof j.taskId === 'string' ? j.taskId : '',
    workflowName: typeof j.workflowName === 'string' ? j.workflowName : '',
    summary: typeof j.summary === 'string' ? j.summary : '',
    status: typeof j.status === 'string' ? j.status : '',
    durationMs: typeof j.durationMs === 'number' ? j.durationMs : null,
    agentCount: typeof j.agentCount === 'number' ? j.agentCount : agents.length,
    totalTokens: typeof j.totalTokens === 'number' ? j.totalTokens : 0,
    totalToolCalls: typeof j.totalToolCalls === 'number' ? j.totalToolCalls : 0,
    defaultModel: typeof j.defaultModel === 'string' ? j.defaultModel : '',
    startTime: typeof j.startTime === 'number' ? j.startTime : null,
    phases,
    agents,
    // 权威完成快照显式标记 live:false（与 deriveLiveJournal 的 live:true 对称）：
    // 让前端「乱序到达的 live REST 不得覆盖已完成快照」的判断可靠，且 workflowStore
    // 据此把该 run 移出活跃集合。
    live: false,
  };
}

/**
 * 读 + 归一化一个 journal 文件路径。坏/超限返回 null。
 */
export function readNormalizedJournal(journalPath) {
  try {
    if (!journalPath || !existsSync(journalPath)) return null;
    if (statSync(journalPath).size > MAX_JOURNAL_BYTES) return null;
    const j = JSON.parse(readFileSync(journalPath, 'utf-8'));
    return normalizeWorkflowJournal(j);
  } catch {
    return null;
  }
}

export const _RUN_ID_RE = RUN_ID_RE;
