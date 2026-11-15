/**
 * SDK active-agents identity helpers (pure functions — no React, no SVG asset
 * imports), so this module is directly loadable by node:test.
 *
 * Active set = sdkTaskTracker tasks whose taskType is an agent task
 * (local_agent / in_process_teammate) and whose status is not terminal.
 * Two consumers: the active-agent card (ActiveAgentsBar — identity resolution
 * for display) and the SDK task tracker (sdkTaskTracker — the AGENT_TASK_TYPES
 * gate). The click-to-filter matching helpers used to live here and were
 * removed together with that feature.
 *
 * Identity resolution does NOT trust the task_started description prefix
 * ("name: prompt..."): real Agent-tool descriptions are short blurbs without a
 * "name:" prefix, and teammate names may contain spaces. The reliable source is
 * the MainAgent's Agent/Task tool_use block, joined by toolUseId (exact) or by
 * prompt prefix (PROMPT_PREFIX_LEN chars, the same heuristic resolveTeammateNames
 * uses in @ccv/core/contentFilter). The description prefix is only a last-resort
 * fallback.
 */

import { PROMPT_PREFIX_LEN } from '@ccv/core/contentFilter';

// Re-exported so existing importers of this module keep working; the value itself
// is sourced from @ccv/core/contentFilter (one shared definition, no drift).
export { PROMPT_PREFIX_LEN };

// task_started.task_type values that represent a user-visible agent (subagent
// or teammate). local_workflow / local_bash / remote_agent are excluded: they
// are workflow-internal agents or background shells, not a chat peer.
export const AGENT_TASK_TYPES = new Set(['local_agent', 'in_process_teammate']);

// Statuses after which an agent no longer counts as active. sdkTaskTracker maps
// killed/stopped to 'failed', so only these two are terminal here.
const TERMINAL_STATUSES = new Set(['completed', 'failed']);

// "name: rest" teammate prefix, used ONLY as a fallback when the tool_use join
// misses. Allows spaces in the name (up to the first colon) — names are not
// whitespace-restricted (agent-id.js only trims / caps at 64 chars). The space
// after the colon is optional: a full-width CJK colon "：" is conventionally
// followed by no space.
const NAME_PREFIX_RE = /^(.{1,64}?)\s*[:：]\s*\S/;

/**
 * Build a lookup of the MainAgent's Agent/Task tool_use blocks, keyed by BOTH
 * toolUseId (exact) and prompt prefix (first PROMPT_PREFIX_LEN chars), so an
 * active agent task can be joined back to its spawn input for the real
 * name / subagent_type / description.
 *
 * @param {Array<object>} requests - the transcript request list (v1 shape).
 * @returns {{byToolUseId: Map<string, object>, byPromptPrefix: Map<string, object>}}
 *   values: { name, subagentType, description, prompt, promptPrefix }
 */
export function buildAgentToolUseMap(requests) {
  const byToolUseId = new Map();
  const byPromptPrefix = new Map();
  if (!Array.isArray(requests)) return { byToolUseId, byPromptPrefix };
  for (const req of requests) {
    if (!req || req.mainAgent === false) continue; // only the main agent spawns
    const content = req.response?.body?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || block.type !== 'tool_use') continue;
      if (block.name !== 'Agent' && block.name !== 'Task') continue;
      const inp = block.input;
      if (!inp || typeof inp !== 'object') continue;
      const prompt = typeof inp.prompt === 'string' ? inp.prompt : '';
      const promptPrefix = prompt.trimStart().slice(0, PROMPT_PREFIX_LEN);
      const entry = {
        name: typeof inp.name === 'string' ? inp.name : null,
        subagentType: typeof inp.subagent_type === 'string' ? inp.subagent_type : null,
        description: typeof inp.description === 'string' ? inp.description : null,
        prompt,
        promptPrefix,
        // The spawn block's own tool_use id — the only reliable cross-reference
        // between an active task and a transcript row (prompt prefixes diverge).
        toolUseId: block.id != null ? String(block.id) : null,
      };
      if (block.id) byToolUseId.set(String(block.id), entry);
      // Later duplicates overwrite — idempotent and matches resolveTeammateNames.
      if (promptPrefix) byPromptPrefix.set(promptPrefix, entry);
    }
  }
  return { byToolUseId, byPromptPrefix };
}

/** Fallback teammate-name parse from a "name: prompt..." description. */
function parseNamePrefix(text) {
  if (typeof text !== 'string') return null;
  const m = NAME_PREFIX_RE.exec(text.trim());
  if (!m) return null;
  const name = m[1].trim();
  // Guard against treating a bare imperative sentence ("Fix the bug") as a name:
  // require the captured prefix to look name-ish (short, no sentence punctuation).
  if (!name || name.length > 32) return null;
  return name;
}

/**
 * Map an Agent tool_use subagent_type to the getSvgAvatar() sub-* icon type.
 * Mirrors ChatMessage._getSubAvatarType (explore|search→sub-search,
 * plan→sub-plan, else sub). Used internally by resolveAgentIdentity.
 */
export function avatarTypeFromSubType(subType) {
  const st = String(subType || '').toLowerCase();
  if (st === 'explore' || st === 'search') return 'sub-search';
  if (st === 'plan') return 'sub-plan';
  return 'sub';
}

/**
 * Derive the active agent list from a taskStore snapshot's task array.
 * Identity (name) is intentionally NOT resolved here — it needs the transcript
 * (buildAgentToolUseMap), which this pure module must not depend on. The caller
 * joins each entry via resolveAgentIdentity.
 *
 * @param {Array<object>} tasks - taskStore snapshot tasks.
 * @returns {Array<{taskId:string, toolUseId:string|null, kind:'teammate'|'subagent',
 *   taskType:string, prompt:string, description:string, status:string,
 *   lastToolName:string|null, createdAt:number|null}>}
 *   in taskStore insertion (creation) order.
 */
export function deriveActiveAgents(tasks) {
  const out = [];
  for (const task of tasks || []) {
    if (!task || !AGENT_TASK_TYPES.has(task.taskType)) continue;
    if (TERMINAL_STATUSES.has(task.status)) continue;
    const taskId = String(task.taskId ?? '');
    if (!taskId) continue;
    out.push({
      taskId,
      toolUseId: task.toolUseId != null ? String(task.toolUseId) : null,
      kind: task.taskType === 'in_process_teammate' ? 'teammate' : 'subagent',
      taskType: task.taskType,
      prompt: typeof task.promptSnippet === 'string' ? task.promptSnippet : '',
      description: typeof task.subject === 'string' ? task.subject : '',
      status: task.status,
      // Live per-task fields the card renders directly (current-tool pill,
      // elapsed clock); carried here so the caller needs no second join.
      lastToolName: typeof task.lastToolName === 'string' ? task.lastToolName : null,
      createdAt: Number.isFinite(task.createdAt) ? task.createdAt : null,
    });
  }
  return out;
}

/**
 * Resolve one active agent's display identity against the transcript.
 *
 * @param {object} agent - a deriveActiveAgents entry.
 * @param {{byToolUseId: Map, byPromptPrefix: Map}} toolUseMap - from buildAgentToolUseMap.
 * @returns {{key:string, taskId:string, kind:'teammate'|'subagent', name:string|null,
 *   avatarType:string, title:string, matchable:boolean, promptPrefix:string, toolUseId:string|null}}
 */
export function resolveAgentIdentity(agent, toolUseMap) {
  const { byToolUseId, byPromptPrefix } = toolUseMap || { byToolUseId: new Map(), byPromptPrefix: new Map() };
  const promptPrefix = (agent.prompt || '').trimStart().slice(0, PROMPT_PREFIX_LEN);

  // Join priority: exact toolUseId, then prompt prefix.
  let joined = null;
  if (agent.toolUseId && byToolUseId.has(agent.toolUseId)) joined = byToolUseId.get(agent.toolUseId);
  if (!joined && promptPrefix && byPromptPrefix.has(promptPrefix)) joined = byPromptPrefix.get(promptPrefix);

  if (agent.kind === 'teammate') {
    const name = (joined && joined.name) || parseNamePrefix(agent.description) || null;
    return {
      key: name ? `tm:${name.toLowerCase()}` : `tm-task:${agent.taskId}`,
      taskId: agent.taskId,
      kind: 'teammate',
      name,
      avatarType: 'teammate',
      title: name || agent.description || '',
      matchable: !!name,
      promptPrefix,
    };
  }
  // subagent
  const subType = joined && joined.subagentType;
  const avatarType = subType ? avatarTypeFromSubType(subType) : 'sub';
  const title = (joined && (joined.description || joined.name)) || agent.description || '';
  return {
    key: `sa:${agent.taskId}`,
    taskId: agent.taskId,
    kind: 'subagent',
    name: null,
    avatarType,
    title,
    matchable: true,
    promptPrefix,
    // The spawn anchor when the join resolved a tool_use block (the exact
    // cross-reference between an active task and its transcript spawn). Prefer
    // the task frame's own toolUseId; fall back to the joined block's id.
    toolUseId: agent.toolUseId || (joined && joined.toolUseId) || null,
  };
}
