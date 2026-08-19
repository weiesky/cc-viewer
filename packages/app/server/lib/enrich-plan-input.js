/**
 * Enrich Plan Input
 *
 * 在 cc-viewer 出 SSE/REST 之前，把 ExitPlanMode tool_use 的空 input 用 session 转写
 * 里 normalizeToolInput 写进去的 plan / planFilePath 补全。
 *
 * 不修改 ExitPlanMode 之外的工具；不覆盖已有 input 字段。
 */

import { lookupToolUseInput } from './session-transcript-reader.js';
import { enrichEntry as enrichWorkflowEntry, rawHasWorkflowToolResult } from './enrich-workflow.js';

const EMPTY_INPUT_SUBSTR = '"name":"ExitPlanMode","input":{}';

/**
 * 廉价子串预过滤：原始 JSON 字符串里有没有「ExitPlanMode + 空 input」的字节序列。
 * 实测当前 CC 的 interceptor 用 default JSON.stringify(body)，零空格，恒定字节序。
 *
 * @param {string} raw
 * @returns {boolean}
 */
export function rawHasEmptyExitPlanMode(raw) {
  if (typeof raw !== 'string' || !raw) return false;
  return raw.indexOf(EMPTY_INPUT_SUBSTR) !== -1;
}

function findEmptyExitPlanModeBlocks(content, out) {
  if (!Array.isArray(content)) return;
  for (const blk of content) {
    if (!blk || blk.type !== 'tool_use' || blk.name !== 'ExitPlanMode') continue;
    const inp = blk.input;
    if (!inp || typeof inp !== 'object' || Array.isArray(inp)) continue;
    if (Object.keys(inp).length !== 0) continue;
    if (typeof blk.id !== 'string' || !blk.id) continue;
    out.push(blk);
  }
}

/**
 * 遍历 entry 中所有 ExitPlanMode tool_use（response.body.content 当前轮 +
 * body.messages[*].content[] 历史轮），把空 input 用 session 转写补全。
 *
 * 设计说明：
 * - 早返回：缺 sessionId header（旧版 CC 无该 header）→ 不查表，不计 missed。
 * - 早返回：sub-agent / 非 mainAgent 条目不 enrich——子代理 transcript 在另一目录
 *   (`<sid>/subagents/agent-<hash>.jsonl`)，按主 transcript 的 tool_use.id 查表
 *   理论上不会命中，但显式守卫避免万一同 id 撞库。
 * - Header 名规范：interceptor 走 fetch Headers.entries() 全小写（WHATWG 规范），
 *   只查小写键即可。
 * - In-place mutation by design：用 Object.assign(blk.input, patch) 而非
 *   `blk.input = {...}`。增量重建器 (server/lib/delta-reconstructor.js) 会让同一 tool_use
 *   block 在多个 entry 间共享对象引用；in-place mutate 让后续 entry 的「Object.keys
 *   (inp).length === 0」预检自动跳过——正是我们想要的 (相同 plan，不重新查盘)。
 *   注意：此优化仅在 SSE / live 路径（共享对象）生效；REST 路径 raw → JSON.parse
 *   每条独立对象，每条仍走一次 lookup（命中走 LRU，O(1)）。
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
  const respContent = entry.response?.body?.content;
  findEmptyExitPlanModeBlocks(respContent, candidates);
  const msgs = entry.body?.messages;
  if (Array.isArray(msgs)) {
    for (const m of msgs) {
      if (m && Array.isArray(m.content)) findEmptyExitPlanModeBlocks(m.content, candidates);
    }
  }
  if (candidates.length === 0) return { enriched: 0, missed: 0 };

  let enriched = 0, missed = 0;
  for (const blk of candidates) {
    const found = lookupToolUseInput(sid, blk.id, projectHint);
    if (found && (found.plan || found.planFilePath)) {
      const patch = {};
      if (typeof found.plan === 'string') patch.plan = found.plan;
      if (typeof found.planFilePath === 'string') patch.planFilePath = found.planFilePath;
      Object.assign(blk.input, patch);
      enriched++;
    } else {
      missed++;
    }
  }
  return { enriched, missed };
}

/**
 * 服务端三处接入点共用：raw 字符串预过滤 → 命中才 parse + enrich + stringify。
 * 一次 parse 上同时跑 ExitPlanMode plan 补全与 Workflow _ccvWorkflow 注入两道 enricher。
 *
 * 设计原则：保持 server/lib/log-stream.js 的「原始字符串透传」哲学，只对真正需要补全的
 * 条目做 parse / stringify，其它一律按 raw 透传。
 *
 * @param {string} raw - 一条日志条目的原始 JSON 字符串
 * @returns {string} - enriched JSON 字符串，或原始 raw
 */
export function enrichRawIfNeeded(raw) {
  const needPlan = rawHasEmptyExitPlanMode(raw);
  const needWorkflow = rawHasWorkflowToolResult(raw);
  if (!needPlan && !needWorkflow) return raw;
  let entry;
  try { entry = JSON.parse(raw); } catch { return raw; }
  let changed = 0;
  if (needPlan) { try { changed += enrichEntry(entry).enriched; } catch {} }
  if (needWorkflow) { try { changed += enrichWorkflowEntry(entry).enriched; } catch {} }
  if (changed === 0) return raw;
  try { return JSON.stringify(entry); } catch { return raw; }
}
