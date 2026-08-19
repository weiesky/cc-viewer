/**
 * Interaction-ownership arbitration for ask/plan approval cards.
 *
 * Answers ONE question consistently for the whole chat surface: which single
 * <ChatMessage> instance owns the pending AskUserQuestion / ExitPlanMode
 * interaction — a messages-side bubble or the Last-Response block? Historically
 * this logic was duplicated across four sites inside ChatView (messages-side
 * pending scan, LR pre-scan, session-cache heal, LR block) that had to agree
 * by hand; every drift produced the double-portal bug class (two ask/plan
 * cards portaled into ApprovalModal, or a stale lastPendingPlanId re-opening
 * a resolved plan modal). This module is the single implementation.
 *
 * Pure functions over plain data — no React/antd/i18n imports, statically
 * loadable under node:test. All React element mutation (cloneElement strips,
 * cache write-backs) stays in ChatView.
 *
 * Two DELIBERATE asymmetries callers must respect (both test-pinned):
 *  - Map sources differ by side: the messages-side scan and the ask-heal use
 *    the MERGED maps (JSONL + local optimistic answers); the LR-side plan
 *    checks and the plan-heal use the RAW session planApprovalMap. Parameter
 *    names keep them apart — do not "simplify" to one source.
 *  - lrWillOwnPlan is cliMode-gated (ChatMessage only renders ExitPlanMode as
 *    interactive under cliMode, so outside cliMode the messages side must keep
 *    ownership or both sides go inert); respLastPendingPlanId is NOT gated —
 *    it feeds buildLpid → _currentLastPendingPlanId → the pendingPtyPlan
 *    derivation in componentDidUpdate, which applies its own cliMode gate.
 */

/** Every AskUserQuestion / ExitPlanMode tool_use id in a session's history. */
export function collectHistoryToolIds(messages) {
  const askIds = new Set();
  const planIds = new Set();
  for (const m of messages || []) {
    if (m && m.role === 'assistant' && Array.isArray(m.content)) {
      for (const b of m.content) {
        if (b.type === 'tool_use' && b.name === 'AskUserQuestion') askIds.add(b.id);
        if (b.type === 'tool_use' && b.name === 'ExitPlanMode') planIds.add(b.id);
      }
    }
  }
  return { askIds, planIds };
}

/**
 * Messages-side pending scan. Only tools in the LAST non-empty assistant
 * message can be pending: once a later assistant message exists, any earlier
 * plan/ask must already have been handled (Claude cannot continue the turn
 * otherwise) — treating older ones as pending made every historical plan
 * re-open its modal forever (ExitPlanMode V2 has no tool_result, so its
 * planApprovalMap entry stays undefined).
 *
 * ownerIdx values are RAW message indices (the render loop compares them
 * against its own `mi`), locking the pending id to exactly one bubble even
 * when streaming repeats the same toolId across incrementally-pushed messages.
 *
 * @param planApprovalMap MERGED plan-approval map
 * @param askAnswerMap    MERGED ask-answer map (JSONL + local optimistic)
 */
export function computeMessagesPending({ messages, planApprovalMap, askAnswerMap }) {
  let lastPendingAskId = null;
  let lastPendingPlanId = null;
  let askOwnerIdx = -1;
  let planOwnerIdx = -1;
  let lastAssistantIdx = -1;
  const msgs = messages || [];
  for (let mi = msgs.length - 1; mi >= 0; mi--) {
    const m = msgs[mi];
    if (m && m.role === 'assistant' && Array.isArray(m.content) && m.content.length > 0) {
      lastAssistantIdx = mi;
      break;
    }
  }
  if (lastAssistantIdx >= 0) {
    for (const block of msgs[lastAssistantIdx].content) {
      if (block.type === 'tool_use' && block.name === 'ExitPlanMode') {
        const approval = (planApprovalMap || {})[block.id];
        if (!approval || approval.status === 'pending') {
          lastPendingPlanId = block.id;
          planOwnerIdx = lastAssistantIdx;
        }
      }
      if (block.type === 'tool_use' && block.name === 'AskUserQuestion') {
        const answers = (askAnswerMap || {})[block.id];
        if (!answers || Object.keys(answers).length === 0) {
          lastPendingAskId = block.id;
          askOwnerIdx = lastAssistantIdx;
        }
      }
    }
  }
  return { lastPendingAskId, lastPendingPlanId, askOwnerIdx, planOwnerIdx };
}

/**
 * Incremental session-cache heal: the new segment produced no pending ids, but
 * the cached ones may still be unresolved — keep them, or the approval modal
 * flickers closed and re-opens between streaming increments. A cached id whose
 * approval/answer has since landed is dropped.
 *
 * Asymmetry (see module header): plan checks the RAW sessionPlanApprovalMap,
 * ask checks the MERGED answer map.
 */
export function healStalePendingIds({ resultAskId, resultPlanId, prevAskId, prevPlanId, sessionPlanApprovalMap, mergedAskAnswerMap }) {
  let lastPendingAskId = resultAskId;
  let lastPendingPlanId = resultPlanId;
  if (!lastPendingPlanId && prevPlanId) {
    const prevPlanApproval = (sessionPlanApprovalMap || {})[prevPlanId];
    if (!prevPlanApproval || prevPlanApproval.status === 'pending') {
      lastPendingPlanId = prevPlanId;
    }
  }
  if (!lastPendingAskId && prevAskId) {
    const prevAns = (mergedAskAnswerMap || {})[prevAskId];
    if (!prevAns || Object.keys(prevAns).length === 0) {
      lastPendingAskId = prevAskId;
    }
  }
  return { lastPendingAskId, lastPendingPlanId };
}

/**
 * Last-Response ownership, computed ONCE per (last) session and consumed by
 * BOTH the pre-scan (lrWillOwn* → strip the messages side) and the LR block
 * (respLastPending* → the LR <ChatMessage>'s pending props), so the two sides
 * structurally cannot disagree.
 *
 * historyAskIds/historyPlanIds are built whenever the LR renders at all
 * (isLastSession + array respContent + !shouldHide). The old pre-scan built
 * them only when an interactive block existed — observably identical, since
 * without ask/plan blocks in respContent nothing ever consults the sets.
 *
 * respLastPending scans are last-match-wins (no break), mirroring the
 * original LR block.
 */
export function computeLrOwnership({ isLastSession, respContent, messages, mergedAskAnswerMap, localAskAnswers, sessionPlanApprovalMap, cliMode }) {
  const result = {
    shouldHide: false,
    hasInteractiveBlock: false,
    historyAskIds: null,
    historyPlanIds: null,
    lrWillOwnAsk: false,
    lrWillOwnPlan: false,
    respLastPendingAskId: null,
    respLastPendingPlanId: null,
  };
  if (!isLastSession || !Array.isArray(respContent)) return result;

  result.hasInteractiveBlock = respContent.some(b =>
    b.type === 'tool_use' && (b.name === 'AskUserQuestion' || b.name === 'ExitPlanMode')
  );
  const hasSuggestionMode = respContent.some(b =>
    b.type === 'text' && typeof b.text === 'string' && b.text.includes('[SUGGESTION MODE:')
  );
  result.shouldHide = hasSuggestionMode && !result.hasInteractiveBlock;
  if (result.shouldHide) return result;

  const { askIds, planIds } = collectHistoryToolIds(messages);
  result.historyAskIds = askIds;
  result.historyPlanIds = planIds;

  const localAsk = localAskAnswers || {};
  for (const b of respContent) {
    if (b.type !== 'tool_use') continue;
    if (b.name === 'AskUserQuestion') {
      // Already rendered by a messages-side bubble → that bubble owns it.
      if (askIds.has(b.id)) continue;
      // Answered (server ack in the merged map, or local optimistic) → not pending.
      const merged = (mergedAskAnswerMap || {})[b.id];
      if (merged && Object.keys(merged).length > 0) continue;
      const la = localAsk[b.id];
      if (!la || Object.keys(la).length === 0) {
        result.lrWillOwnAsk = true;
        result.respLastPendingAskId = b.id;
      }
    }
    if (b.name === 'ExitPlanMode') {
      const approval = (sessionPlanApprovalMap || {})[b.id];
      const pending = !approval || approval.status === 'pending';
      // The pending id is NOT history-deduped and NOT cliMode-gated (the old
      // LR block's semantics): it feeds the LR bubble's lastPendingPlanId
      // prop and buildLpid, whose consumer applies its own cliMode gate.
      if (pending) result.respLastPendingPlanId = b.id;
      // Interactive OWNERSHIP is both: only under cliMode (ChatMessage renders
      // ExitPlanMode as interactive only there) and only for blocks the
      // message history does not already render.
      if (pending && cliMode && !planIds.has(b.id)) result.lrWillOwnPlan = true;
    }
  }
  return result;
}

/**
 * The LR content filter: hide tool_use blocks except interactive cards that
 * are NOT already rendered in the message history (dedupe both kinds).
 */
export function filterLrContent(respContent, historyAskIds, historyPlanIds) {
  return (respContent || []).filter(b =>
    b.type !== 'tool_use'
    || (b.name === 'AskUserQuestion' && !(historyAskIds && historyAskIds.has(b.id)))
    || (b.name === 'ExitPlanMode' && !(historyPlanIds && historyPlanIds.has(b.id)))
  );
}

/** Whether a filtered LR content list still has anything worth rendering. */
export function hasVisibleLrContent(lrContent) {
  return (lrContent || []).some(b => {
    if (b.type === 'text') return typeof b.text === 'string' && b.text.trim().length > 0;
    if (b.type === 'tool_use') return true; // AskUserQuestion / ExitPlanMode
    if (b.type === 'thinking') return typeof b.thinking === 'string' && b.thinking.trim().length > 0;
    return false;
  });
}

/** All AskUserQuestion question texts in the LR (PTY prompt dedupe source). */
export function collectLrAskQuestions(respContent) {
  const questions = new Set();
  for (const block of respContent || []) {
    if (block.type === 'tool_use' && block.name === 'AskUserQuestion') {
      const qs = block.input?.questions;
      if (Array.isArray(qs)) {
        for (const q of qs) {
          if (q.question) questions.add(q.question);
        }
      }
    }
  }
  return questions;
}
