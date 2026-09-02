import React from 'react';
import { isFullDisplayTool } from './toolDisplayPolicy.js';

/**
 * Minimal-chat post-pass — merges consecutive tool-only turns of the SAME
 * agent into one bubble.
 *
 * Applied at the end of ChatView.buildAllItems on the freshly built element
 * array, AFTER every session's rows and the interleaved sub-agent rows are in
 * place and BEFORE `_scrollTargetIdx` is derived, `applyAvatarAnimationTargets`
 * runs and `_applyMobileSlice` trims the window. It never touches the
 * per-session element cache: the cache keeps the raw one-row-per-message
 * elements and this pass derives a view from them on every build, so
 * streaming appends and v2 split-row content growth (a tool-only turn that
 * later gains text) re-evaluate naturally — there is no "re-split a merged
 * run" path to maintain.
 *
 * Identity: main-agent assistant rows share one stream ('assistant'), each
 * sub-agent / teammate label is its own stream. Rows of OTHER identities never
 * break a stream (they are skipped over, not merged across); content rows
 * (user prompt, plan prompt, skill-loaded, task-notification, teammate
 * message/status) close EVERY open stream — they are natural turn boundaries,
 * and letting a sub-agent run survive them would merge same-label rows from
 * different spawns across a user turn, mis-attributing the earlier spawn's
 * timestamp and "view request" target to the later one. Items without
 * `props.role` (session Divider, banners) close every stream too.
 *
 * `role:"system"` rows (appended system prompts) are absorbed into an open
 * main-agent run as grey-logo members; outside a run they stay as-is.
 *
 * Output: the merged element is emitted at the position of the run's LAST
 * member (so a live run keeps growing at the bottom of the list); the other
 * members are dropped. `indexMap[old] = new` covers every old index plus
 * `indexMap[items.length]` for the Last-Response anchor that points one past
 * the end.
 *
 * Merged element = cloneElement(last non-system member, { key, runMembers }):
 * it keeps the ChatMessage type and the role/label/isTeammate/timestamp/
 * displayTs/modelInfo props every downstream consumer (role filter, avatar
 * animation pass, highlight lookup, Virtuoso keys) already reads. Its key is
 * `run-<first member key>` so a growing run reconciles in place.
 *
 * Memo: `cache` maps runKey → { members, element }; when the member element
 * references are unchanged the previous merged element is returned, so cached
 * rows on the FULL HIT path keep producing a reference-stable merged element.
 * Keys not touched in a pass are evicted.
 */

const MAIN_BREAK_ROLES = new Set([
  'user',
  'plan-prompt',
  'skill-loaded',
  'task-notification',
  'teammate-message',
  'teammate-status',
]);

export function hasThinkingBlock(content) {
  if (!Array.isArray(content)) return false;
  return content.some((b) => b && (b.type === 'thinking' || b.type === 'redacted_thinking'));
}

/**
 * A turn is "tool-only" when every block is thinking, whitespace-only text or a
 * non-full-display tool_use, and at least one thinking/tool_use block exists.
 * Any real text, any full-display tool, or any other block kind (server-side
 * web search, images, unknown) makes the turn keep its own bubble.
 */
export function isToolOnlyAssistantContent(content) {
  if (!Array.isArray(content) || content.length === 0) return false;
  let hasBody = false;
  for (const b of content) {
    if (!b) continue;
    if (b.type === 'thinking' || b.type === 'redacted_thinking') { hasBody = true; continue; }
    if (b.type === 'text') {
      if (typeof b.text === 'string' && b.text.trim()) return false;
      continue;
    }
    if (b.type === 'tool_use') {
      if (isFullDisplayTool(b.name)) return false;
      hasBody = true;
      continue;
    }
    return false;
  }
  return hasBody;
}

/** Stream identity of a row, or null for rows that carry no agent identity. */
export function runIdentityOf(props) {
  if (!props) return null;
  if (props.role === 'assistant') return props.label ? `tm:${props.label}` : 'assistant';
  if (props.role === 'sub-agent-chat') return `sub:${props.label || 'SubAgent'}`;
  return null;
}

function isMergeableItem(props) {
  if (!props) return false;
  // Streaming overlay / interaction owners never merge (defensive: full-display
  // tools already exclude Ask/Plan owners, but a stale owner id must not slip).
  if (props.showTrailingCursor || props.lastPendingAskId || props.lastPendingPlanId || props.imAgent) return false;
  return isToolOnlyAssistantContent(props.content);
}

function buildRunElement(members, cache, touched) {
  const first = members[0];
  const runKey = `run-${first.key != null ? first.key : 'x'}`;
  touched.add(runKey);
  const hit = cache ? cache.get(runKey) : null;
  if (hit && hit.members.length === members.length && hit.members.every((m, i) => m === members[i])) {
    return hit.element;
  }
  let base = null;
  for (let i = members.length - 1; i >= 0; i--) {
    if (members[i].props.role !== 'system') { base = members[i]; break; }
  }
  const runMembers = members.map((m) => React.cloneElement(m, { runMember: true }));
  const element = React.cloneElement(base, { key: runKey, runMembers });
  if (cache) cache.set(runKey, { members, element });
  return element;
}

/**
 * @param {Array} items - buildAllItems output (React elements)
 * @param {Map=} cache - per-ChatView memo Map (see header); optional
 * @returns {{ items: Array, indexMap: number[] }}
 */
export function mergeToolRuns(items, cache) {
  const n = items.length;
  const runOf = new Array(n).fill(null);
  const runs = [];
  const open = new Map();

  for (let i = 0; i < n; i++) {
    const item = items[i];
    const props = item && item.props;
    if (!props || !props.role) { open.clear(); continue; }
    const role = props.role;
    if (role === 'system') {
      const run = open.get('assistant');
      if (run) { run.members.push(i); runOf[i] = run; }
      continue;
    }
    const id = runIdentityOf(props);
    if (id) {
      if (isMergeableItem(props)) {
        let run = open.get(id);
        if (!run) { run = { id, members: [], newIdx: -1 }; runs.push(run); open.set(id, run); }
        run.members.push(i);
        runOf[i] = run;
      } else {
        open.delete(id);
      }
      continue;
    }
    if (MAIN_BREAK_ROLES.has(role)) {
      open.clear();
      continue;
    }
    // Unknown ChatMessage role: be conservative and close every stream.
    open.clear();
  }

  const active = runs.filter((r) => r.members.length >= 2);
  if (active.length === 0) {
    if (cache && cache.size) cache.clear();
    const identity = new Array(n + 1);
    for (let i = 0; i <= n; i++) identity[i] = i;
    return { items, indexMap: identity };
  }
  const activeSet = new Set(active);

  const out = [];
  const indexMap = new Array(n + 1);
  const touched = new Set();
  for (let i = 0; i < n; i++) {
    const run = runOf[i];
    if (!run || !activeSet.has(run)) { indexMap[i] = out.length; out.push(items[i]); continue; }
    if (i !== run.members[run.members.length - 1]) continue; // absorbed member
    run.newIdx = out.length;
    out.push(buildRunElement(run.members.map((mi) => items[mi]), cache, touched));
  }
  for (const run of active) for (const mi of run.members) indexMap[mi] = run.newIdx;
  indexMap[n] = out.length;
  if (cache) for (const k of Array.from(cache.keys())) if (!touched.has(k)) cache.delete(k);
  return { items: out, indexMap };
}
