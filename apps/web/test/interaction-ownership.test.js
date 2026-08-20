// Unit tests for src/components/chat/interactionOwnership.js — the ask/plan
// ownership arbitration extracted from ChatView's four hand-synced sites.
// (The LR-vs-messages dedup matrix lives in lr-messages-dedup.test.js, which
// imports the same module; this file pins the remaining decision surfaces.)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectHistoryToolIds,
  computeMessagesPending,
  healStalePendingIds,
  computeLrOwnership,
  filterLrContent,
  hasVisibleLrContent,
  collectLrAskQuestions,
} from '../src/components/chat/interactionOwnership.js';

const ask = (id, questions = [{ question: 'q', options: [] }]) => ({ type: 'tool_use', id, name: 'AskUserQuestion', input: { questions } });
const plan = (id) => ({ type: 'tool_use', id, name: 'ExitPlanMode', input: { plan: 'p' } });
const asst = (...content) => ({ role: 'assistant', content });

describe('collectHistoryToolIds', () => {
  it('collects ask and plan ids from assistant messages only', () => {
    const { askIds, planIds } = collectHistoryToolIds([
      asst(ask('a1'), plan('p1'), { type: 'text', text: 'x' }),
      { role: 'user', content: [ask('a-user')] }, // non-assistant: ignored
      asst(ask('a2')),
    ]);
    assert.deepEqual([...askIds].sort(), ['a1', 'a2']);
    assert.deepEqual([...planIds], ['p1']);
  });
});

describe('computeMessagesPending', () => {
  it('last-assistant-only rule: an unapproved plan in an EARLIER assistant message is not pending', () => {
    // The "old plans re-modal forever" regression: ExitPlanMode V2 has no
    // tool_result, so planApprovalMap[id] stays undefined for handled plans.
    const r = computeMessagesPending({
      messages: [asst(plan('p_old')), asst({ type: 'text', text: 'done' })],
      planApprovalMap: {},
      askAnswerMap: {},
    });
    assert.equal(r.lastPendingPlanId, null);
    assert.equal(r.planOwnerIdx, -1);
  });

  it('ownerIdx is the LAST assistant message index, even when streaming duplicated the toolId', () => {
    const r = computeMessagesPending({
      messages: [asst(ask('a_dup')), { role: 'user', content: 'ok' }, asst(ask('a_dup'))],
      planApprovalMap: {},
      askAnswerMap: {},
    });
    assert.equal(r.lastPendingAskId, 'a_dup');
    assert.equal(r.askOwnerIdx, 2, 'only the last assistant bubble owns the interaction');
  });

  it('answered ask / approved plan in the last assistant message is not pending', () => {
    const messages = [asst(ask('a1'), plan('p1'))];
    const r = computeMessagesPending({
      messages,
      planApprovalMap: { p1: { status: 'approved' } },
      askAnswerMap: { a1: { q: 'answered' } },
    });
    assert.equal(r.lastPendingAskId, null);
    assert.equal(r.lastPendingPlanId, null);
    const r2 = computeMessagesPending({ messages, planApprovalMap: { p1: { status: 'pending' } }, askAnswerMap: { a1: {} } });
    assert.equal(r2.lastPendingAskId, 'a1', 'empty answer object still counts as pending');
    assert.equal(r2.lastPendingPlanId, 'p1', 'explicit pending status counts as pending');
  });

  it('empty-content assistant messages are skipped when finding the last assistant', () => {
    const r = computeMessagesPending({
      messages: [asst(ask('a1')), { role: 'assistant', content: [] }],
      planApprovalMap: {},
      askAnswerMap: {},
    });
    assert.equal(r.lastPendingAskId, 'a1');
    assert.equal(r.askOwnerIdx, 0);
  });
});

describe('healStalePendingIds (session-cache heal on incremental builds)', () => {
  it('plan: resolved approval drops the cached id; pending/missing retains it (modal-flicker regression)', () => {
    const base = { resultAskId: null, resultPlanId: null, prevAskId: null, mergedAskAnswerMap: {} };
    assert.equal(healStalePendingIds({ ...base, prevPlanId: 'p1', sessionPlanApprovalMap: { p1: { status: 'approved' } } }).lastPendingPlanId, null);
    assert.equal(healStalePendingIds({ ...base, prevPlanId: 'p1', sessionPlanApprovalMap: { p1: { status: 'pending' } } }).lastPendingPlanId, 'p1');
    assert.equal(healStalePendingIds({ ...base, prevPlanId: 'p1', sessionPlanApprovalMap: {} }).lastPendingPlanId, 'p1');
  });

  it('ask: answered (merged map) drops the cached id; unanswered retains it', () => {
    const base = { resultAskId: null, resultPlanId: null, prevPlanId: null, sessionPlanApprovalMap: {} };
    assert.equal(healStalePendingIds({ ...base, prevAskId: 'a1', mergedAskAnswerMap: { a1: { q: 'A' } } }).lastPendingAskId, null);
    assert.equal(healStalePendingIds({ ...base, prevAskId: 'a1', mergedAskAnswerMap: { a1: {} } }).lastPendingAskId, 'a1');
    assert.equal(healStalePendingIds({ ...base, prevAskId: 'a1', mergedAskAnswerMap: {} }).lastPendingAskId, 'a1');
  });

  it('fresh result ids win: heal only fills gaps', () => {
    const r = healStalePendingIds({
      resultAskId: 'a_new', resultPlanId: 'p_new', prevAskId: 'a_old', prevPlanId: 'p_old',
      sessionPlanApprovalMap: {}, mergedAskAnswerMap: {},
    });
    assert.equal(r.lastPendingAskId, 'a_new');
    assert.equal(r.lastPendingPlanId, 'p_new');
  });
});

describe('computeLrOwnership — buildLpid parity (the cliMode asymmetry)', () => {
  it('cliMode=false: lrWillOwnPlan is false BUT respLastPendingPlanId is still set', () => {
    // respLastPendingPlanId feeds buildLpid -> _currentLastPendingPlanId ->
    // componentDidUpdate's pendingPtyPlan derivation, which applies its own
    // cliMode gate — the id itself must not be gated here.
    const lr = computeLrOwnership({
      isLastSession: true,
      respContent: [plan('p1')],
      messages: [],
      mergedAskAnswerMap: {}, localAskAnswers: {}, sessionPlanApprovalMap: {},
      cliMode: false,
    });
    assert.equal(lr.lrWillOwnPlan, false);
    assert.equal(lr.respLastPendingPlanId, 'p1');
  });

  it('history-owned plan: ownership stays with messages, but the pending id is still reported (old LR-block semantics)', () => {
    const lr = computeLrOwnership({
      isLastSession: true,
      respContent: [plan('p_hist')],
      messages: [asst(plan('p_hist'))],
      mergedAskAnswerMap: {}, localAskAnswers: {}, sessionPlanApprovalMap: {},
      cliMode: true,
    });
    assert.equal(lr.lrWillOwnPlan, false, 'history-deduped: messages side owns the card');
    assert.equal(lr.respLastPendingPlanId, 'p_hist', 'pending id not history-deduped (buildLpid parity)');
  });

  it('last-match-wins across multiple pending asks in one response', () => {
    const lr = computeLrOwnership({
      isLastSession: true,
      respContent: [ask('a1'), ask('a2')],
      messages: [],
      mergedAskAnswerMap: {}, localAskAnswers: {}, sessionPlanApprovalMap: {},
      cliMode: true,
    });
    assert.equal(lr.respLastPendingAskId, 'a2');
  });

  it('optimistic local answer suppresses LR ask ownership (the fast-answer race)', () => {
    const lr = computeLrOwnership({
      isLastSession: true,
      respContent: [ask('a1')],
      messages: [],
      mergedAskAnswerMap: {},
      localAskAnswers: { a1: { q: 'picked' } },
      sessionPlanApprovalMap: {},
      cliMode: true,
    });
    assert.equal(lr.lrWillOwnAsk, false);
    assert.equal(lr.respLastPendingAskId, null);
  });
});

describe('computeLrOwnership gating', () => {
  it('non-array respContent on the last session returns the inert result', () => {
    const lr = computeLrOwnership({
      isLastSession: true,
      respContent: 'plain string body',
      messages: [asst(ask('a1'))],
      mergedAskAnswerMap: {}, localAskAnswers: {}, sessionPlanApprovalMap: {},
      cliMode: true,
    });
    assert.equal(lr.lrWillOwnAsk, false);
    assert.equal(lr.respLastPendingAskId, null);
    assert.equal(lr.historyAskIds, null, 'sets not built when the LR cannot render');
  });
});

describe('LR content helpers', () => {
  it('hasVisibleLrContent: whitespace text and empty thinking are invisible; tool_use is visible', () => {
    assert.equal(hasVisibleLrContent([{ type: 'text', text: '   \n' }, { type: 'thinking', thinking: ' ' }]), false);
    assert.equal(hasVisibleLrContent([{ type: 'text', text: 'hi' }]), true);
    assert.equal(hasVisibleLrContent([ask('a1')]), true);
    assert.equal(hasVisibleLrContent([]), false);
  });

  it('filterLrContent hides non-interactive tool_use blocks and history-owned interactive ones', () => {
    const content = [
      { type: 'tool_use', id: 't1', name: 'Bash', input: {} },
      ask('a_new'), ask('a_hist'), plan('p_hist'),
      { type: 'text', text: 'tail' },
    ];
    const out = filterLrContent(content, new Set(['a_hist']), new Set(['p_hist']));
    assert.deepEqual(out.map(b => b.id ?? b.text), ['a_new', 'tail']);
  });

  it('collectLrAskQuestions gathers question texts for PTY prompt dedupe', () => {
    const qs = collectLrAskQuestions([
      ask('a1', [{ question: 'Pick a color?' }, { question: 'Pick a size?' }]),
      { type: 'text', text: 'x' },
    ]);
    assert.deepEqual([...qs].sort(), ['Pick a color?', 'Pick a size?']);
  });
});
