/**
 * SDK active-agents identity helpers (pure functions — no React, no SVG asset
 * imports), so this module is directly loadable by node:test.
 *
 * Active set = sdkTaskTracker tasks whose taskType is an agent task
 * (local_agent / in_process_teammate) and whose status is not terminal.
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
 * Map an Agent tool_use subagent_type (or a SubAgent:<type> transcript label)
 * to the getSvgAvatar() sub-* icon type. Mirrors ChatMessage._getSubAvatarType
 * (explore|search→sub-search, plan→sub-plan, else sub).
 */
export function avatarTypeFromSubType(subType) {
  const st = String(subType || '').toLowerCase();
  if (st === 'explore' || st === 'search') return 'sub-search';
  if (st === 'plan') return 'sub-plan';
  return 'sub';
}

/** ChatMessage parity: label "SubAgent:<type>" → sub-* icon type. */
export function avatarTypeFromSubLabel(label) {
  const m = /SubAgent:\s*(\w+)/i.exec(label || '');
  return avatarTypeFromSubType(m ? m[1] : '');
}

export function isTeammateLabel(label) {
  return /^Teammate:\s*/i.test(label || '');
}

export function isSubAgentLabel(label) {
  return label === 'SubAgent' || /^SubAgent:/i.test(label || '');
}

/**
 * First user-message text of a transcript request — used to instance-match an
 * anonymous subagent row against the focused agent's prompt prefix. Handles the
 * string and the content-block-array message shapes; '' when none.
 */
export function firstUserText(req) {
  const msgs = req?.body?.messages;
  if (!Array.isArray(msgs)) return '';
  for (const msg of msgs) {
    if (!msg || msg.role !== 'user') continue;
    const c = msg.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) {
      for (const b of c) {
        if (b && b.type === 'text' && typeof b.text === 'string') return b.text;
      }
    }
    return '';
  }
  return '';
}

/**
 * Derive the active agent list from a taskStore snapshot's task array.
 * Identity (name) is intentionally NOT resolved here — it needs the transcript
 * (buildAgentToolUseMap), which this pure module must not depend on. The caller
 * joins each entry via resolveAgentIdentity.
 *
 * @param {Array<object>} tasks - taskStore snapshot tasks.
 * @returns {Array<{taskId:string, toolUseId:string|null, kind:'teammate'|'subagent',
 *   taskType:string, prompt:string, description:string, status:string}>}
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
 *   avatarType:string, title:string, matchable:boolean, promptPrefix:string}}
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
    // Exact spawn anchor when the join resolved a tool_use block — lets the row
    // filter match by id instead of the unreliable prompt prefix. Prefer the
    // task frame's own toolUseId; fall back to the joined block's id.
    toolUseId: agent.toolUseId || (joined && joined.toolUseId) || null,
  };
}

/**
 * Does a transcript row label belong to the focused agent?
 * Teammate: clean-name match against "Teammate: name(model)" (prefix + suffix
 * stripped, mirroring getTeammateAvatar's cleaning), case-insensitive.
 * Subagent: instance-level prompt-prefix match is handled by the caller (which
 * has the row's req); here we only do the type-level fallback on the label.
 *
 * @param {string} label - the row label (item.props.label).
 * @param {object} identity - a resolveAgentIdentity result (the focused agent).
 */
export function labelMatchesAgent(label, identity) {
  if (!label || !identity) return false;
  if (identity.kind === 'teammate') {
    if (!identity.name || !isTeammateLabel(label)) return false;
    const clean = label.replace(/^Teammate:\s*/i, '').replace(/\([^)]*\)\s*$/, '').trim();
    return clean.toLowerCase() === identity.name.toLowerCase();
  }
  if (!isSubAgentLabel(label)) return false;
  return avatarTypeFromSubLabel(label) === identity.avatarType;
}

/**
 * Instance-level match for a subagent transcript row: does the row's first user
 * message share the focused agent's prompt prefix? Returns null when the row has
 * no usable prompt text (caller falls back to type-level labelMatchesAgent).
 *
 * @param {string|null} rowPromptText - first user-message text of the row's req.
 * @param {object} identity - focused subagent identity (uses .promptPrefix).
 */
export function promptMatchesAgent(rowPromptText, identity) {
  if (!identity || identity.kind !== 'subagent') return null;
  const prefix = identity.promptPrefix;
  if (!prefix) return null;
  if (typeof rowPromptText !== 'string' || !rowPromptText) return null;
  return rowPromptText.trimStart().startsWith(prefix);
}

/**
 * Bind a transcript `sub-agent-chat` row to the focused agent in ONE decision.
 *
 * Splitting this into two independent string matches was the source of the
 * "click selects but the list does not filter" bug: the bar's avatarType is
 * inferred from the Agent tool_use via the task frame's promptSnippet, while
 * the row was matched against the row's own first-user text — and the SDK's
 * reported prompt rarely matches the transcript's wrapped first user message
 * (system injection / <available-deferred-tools> prefix). The two prefixes
 * diverge, the row's prompt check returned false (no type-level fallback), and
 * the type-level label check compared the row's TRUE avatarType against the
 * bar's possibly-wrong inferred one — so every row was filtered out.
 *
 * Correct approach: resolve the row's OWN spawn tool_use (by toolUseId, else by
 * the row's prompt prefix) and compare the resulting identity directly:
 *  - teammate rows: clean-name equality (exact, no prompt heuristic);
 *  - subagent rows: exact toolUseId match wins; otherwise the row binds to the
 *    focused agent only when the row's prompt prefix is consistent with the
 *    same spawn AND the avatarType agrees.
 *
 * @param {{label:string, isTeammate:boolean, rowPromptText:string|null}} row
 * @param {object} identity - resolveAgentIdentity result for the focused agent.
 * @param {{byToolUseId: Map, byPromptPrefix: Map}} toolUseMap - buildAgentToolUseMap result.
 * @returns {boolean}
 */
export function transcriptRowMatchesAgent(row, identity, toolUseMap) {
  if (!row || !identity) return false;
  const label = row.label;
  const maps = toolUseMap || { byToolUseId: new Map(), byPromptPrefix: new Map() };
  if (row.isTeammate) return labelMatchesAgent(label, identity);
  if (identity.kind !== 'subagent') return false;

  // Exact: the focused identity carries its spawn toolUseId and the row's
  // prompt prefix maps to that same spawn block.
  const rowText = typeof row.rowPromptText === 'string' ? row.rowPromptText.trimStart() : '';
  const rowPrefix = rowText ? rowText.slice(0, PROMPT_PREFIX_LEN) : '';
  const rowSpawn = (rowPrefix && maps.byPromptPrefix.get(rowPrefix)) || null;

  if (identity.toolUseId && rowSpawn) {
    return rowSpawn.toolUseId === identity.toolUseId;
  }
  // No exact anchor: fall back to type-level label match ONLY when the prompt
  // prefixes do not actively disagree (a disagreement means the bar's inferred
  // avatarType is untrustworthy, but the row may still be a same-type peer).
  if (rowPrefix && identity.promptPrefix && !rowText.startsWith(identity.promptPrefix)) {
    // Prefixes diverge: cannot instance-match. Accept only a same-type label so
    // the focused subagent still surfaces its own rows (they share its type).
    return isSubAgentLabel(label) && avatarTypeFromSubLabel(label) === identity.avatarType;
  }
  return labelMatchesAgent(label, identity);
}

/**
 * Is the focused agent still active? ONE liveness rule shared by ChatView's cDU
 * backstop and ActiveAgentsBar's reset effect (they previously disagreed):
 *  - teammate: active while ANY active task resolves to the same name — the bar
 *    dedupes a multi-task teammate to one avatar, so matching only the clicked
 *    taskId would drop the focus while a sibling task is still running.
 *  - subagent: active while its own taskId is active (one task per avatar).
 *
 * @param {object} focus - the focus descriptor ({kind, name, taskId}).
 * @param {Array<object>} activeAgents - deriveActiveAgents(...) output (unresolved).
 * @param {{byToolUseId: Map, byPromptPrefix: Map}} toolUseMap - buildAgentToolUseMap result.
 * @returns {boolean}
 */
export function isFocusActive(focus, activeAgents, toolUseMap) {
  if (!focus) return false;
  const list = Array.isArray(activeAgents) ? activeAgents : [];
  if (focus.kind === 'teammate' && focus.name) {
    const want = String(focus.name).toLowerCase();
    return list.some((a) => {
      if (a.kind !== 'teammate') return false;
      const id = resolveAgentIdentity(a, toolUseMap);
      return id.name && id.name.toLowerCase() === want;
    });
  }
  if (focus.taskId) return list.some((a) => a.taskId === focus.taskId);
  return false;
}
