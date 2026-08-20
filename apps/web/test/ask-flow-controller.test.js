// 行为测试：AskFlowController（从 ChatView 抽出的 AskUserQuestion 问答流状态机）。
//
// 控制器是依赖注入的纯逻辑类，可直接在 node:test 下 import（不依赖 antd / i18n / window）。
// 用 fake host + mock ws 覆盖诊断发现的"编排层零行为测试"缺口：
//   队列 promote/dedupe、handleSubmit 三路路由、_applyCancelLocal sentinel/promoteHead、
//   abort 回滚、R2 的 promote 后按 questionText 编 key（不错位）。

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AskFlowController, ASK_KIND, LEGACY_ASK_PLACEHOLDER_ID } from '../src/components/chat/controllers/askFlowController.js';

// node:test 环境可能没有全局 WebSocket（Node < 22）；控制器只用到 WebSocket.OPEN 常量。
if (typeof globalThis.WebSocket === 'undefined') globalThis.WebSocket = { OPEN: 1 };

// ─── fake host：模拟 ChatView 的 state/props/ws 桥接 ───────────────────────────
function makeHost({ sdkMode = false, wsOpen = true, sendOk = true } = {}) {
  const state = {
    pendingAsk: null,
    askQueue: [],
    askMetaMap: {},
    localAskAnswers: {},
    ptyPrompt: null,
    ptyPromptHistory: [],
  };
  const sent = [];          // ws.send 捕获
  const ctxSent = [];       // ctxSend 捕获
  const msgHandlers = new Set();
  const warned = [];        // warnSubmitRetry 捕获
  const flushSent = [];     // sendUserMessageImmediate 捕获
  let currentPtyPrompt = null;
  const pendingFlush = [];  // {askId, text, tid}

  const host = {
    _state: state,
    _sent: sent,
    _ctxSent: ctxSent,
    _warned: warned,
    _flushSent: flushSent,
    _pendingFlush: pendingFlush,
    _msgHandlers: msgHandlers,
    setWsOpen: (v) => { wsOpen = v; },

    getState: () => state,
    setState: (updater, cb) => {
      const partial = typeof updater === 'function' ? updater(state) : updater;
      if (partial) Object.assign(state, partial);
      if (typeof cb === 'function') cb();
    },
    getProps: () => ({ sdkMode }),
    ws: () => (wsOpen ? { readyState: 1, send: (s) => { sent.push(JSON.parse(s)); return sendOk; } } : { readyState: 3, send: () => false }),
    ctxSend: (obj) => { ctxSent.push(obj); return sendOk && wsOpen; },
    ctxIsOpen: () => wsOpen,
    addMessageHandler: (fn) => { msgHandlers.add(fn); return () => msgHandlers.delete(fn); },
    getCurrentPtyPrompt: () => currentPtyPrompt,
    setCurrentPtyPrompt: (v) => { currentPtyPrompt = v; },
    getPtyBuffer: () => '',
    clearPtyDebounce: () => {},
    scrollToBottom: () => {},
    sendUserMessageImmediate: (text, ta, skip) => { flushSent.push({ text, skip }); },
    takePendingFlush: (askId) => {
      const idx = pendingFlush.findIndex(e => e.askId === askId);
      if (idx < 0) return null;
      return pendingFlush.splice(idx, 1)[0];
    },
    isUnmounted: () => false,
    fetchPendingAsks: () => Promise.resolve(null),
    notifyAskResolved: () => {},
    warnSubmitRetry: (reason) => { warned.push(reason); },
  };
  return host;
}

const Q1 = [{ question: 'Pick a color?', options: [{ label: 'Red' }, { label: 'Blue' }] }];
const Q2 = [{ question: 'Pick a size?', options: [{ label: 'S' }, { label: 'M' }] }];

describe('AskFlowController — 队列 promote / dedupe', () => {
  it('ask-hook-pending：首条成为 head 并 set 路由 flag', () => {
    const host = makeHost();
    const c = new AskFlowController(host);
    const handled = c.handleWsMessage({ type: 'ask-hook-pending', id: 'a1', questions: Q1 });
    assert.equal(handled, true);
    assert.equal(host._state.pendingAsk.id, 'a1');
    assert.equal(c._askHookActive, true);
    assert.equal(c._askHookEverActive, true);
    assert.equal(c._sdkAskId, null);
    assert.deepEqual(c._askHookQuestions, Q1);
  });

  it('ask-hook-pending：同 id 再来（WS 重发）不重复入队', () => {
    const host = makeHost();
    const c = new AskFlowController(host);
    c.handleWsMessage({ type: 'ask-hook-pending', id: 'a1', questions: Q1 });
    c.handleWsMessage({ type: 'ask-hook-pending', id: 'a1', questions: Q1 });
    assert.equal(host._state.askQueue.length, 0);
    assert.equal(host._state.pendingAsk.id, 'a1');
  });

  it('并发 ask：第二条不同 id 入队，resolve 头条后 promote 第二条', () => {
    const host = makeHost();
    const c = new AskFlowController(host);
    c.handleWsMessage({ type: 'ask-hook-pending', id: 'a1', questions: Q1 });
    c.handleWsMessage({ type: 'ask-hook-pending', id: 'a2', questions: Q2 });
    assert.equal(host._state.pendingAsk.id, 'a1');
    assert.equal(host._state.askQueue.length, 1);
    assert.equal(host._state.askQueue[0].id, 'a2');
    assert.equal(host._state.askQueue[0].kind, ASK_KIND.HOOK);
    // 头条被远端 resolve → promote a2
    c.handleWsMessage({ type: 'ask-hook-resolved', id: 'a1' });
    assert.equal(host._state.pendingAsk.id, 'a2');
    assert.equal(host._state.askQueue.length, 0);
    assert.deepEqual(c._askHookQuestions, Q2);
  });

  it('sdk-ask-pending：成为 head 并标记 _sdkAskId', () => {
    const host = makeHost({ sdkMode: true });
    const c = new AskFlowController(host);
    c.handleWsMessage({ type: 'sdk-ask-pending', id: 'sdk1', questions: Q1 });
    assert.equal(host._state.pendingAsk.id, 'sdk1');
    assert.equal(c._sdkAskId, 'sdk1');
    assert.equal(host._state.askQueue[0]?.kind, undefined); // head 不入队
  });

  it('非 ask 类型 → handleWsMessage 返回 false（交回 ChatView）', () => {
    const c = new AskFlowController(makeHost());
    assert.equal(c.handleWsMessage({ type: 'data', data: 'x' }), false);
    assert.equal(c.handleWsMessage({ type: 'perm-hook-pending', id: 'p1' }), false);
    assert.equal(c.handleWsMessage({ type: undefined }), false); // typeless message stays unhandled
  });
});

describe('AskFlowController — handleAskQuestionSubmit 路由', () => {
  it('SDK 模式：发 sdk-ask-answer，answers 按 questionText 编 key', () => {
    const host = makeHost({ sdkMode: true });
    const c = new AskFlowController(host);
    c.handleWsMessage({ type: 'sdk-ask-pending', id: 'sdk1', questions: Q1 });
    c.handleAskQuestionSubmit([{ questionIndex: 0, optionIndex: 1 }], 'sdk1', Q1);
    const msg = host._sent.find(m => m.type === 'sdk-ask-answer');
    assert.ok(msg, '应发出 sdk-ask-answer');
    assert.equal(msg.id, 'sdk1');
    assert.deepEqual(msg.answers, { 'Pick a color?': 'Blue' });
  });

  it('Hook 模式：发 ask-hook-answer，带 head id', () => {
    const host = makeHost();
    const c = new AskFlowController(host);
    c.handleWsMessage({ type: 'ask-hook-pending', id: 'a1', questions: Q1 });
    c.handleAskQuestionSubmit([{ questionIndex: 0, optionIndex: 0 }], 'a1', Q1);
    const msg = host._sent.find(m => m.type === 'ask-hook-answer');
    assert.ok(msg, '应发出 ask-hook-answer');
    assert.equal(msg.id, 'a1');
    assert.deepEqual(msg.answers, { 'Pick a color?': 'Red' });
  });

  it('R2：并发 ask 下提交头条，promote 后答案仍按头条 questions 编 key（不被下一条错位）', () => {
    const host = makeHost();
    const c = new AskFlowController(host);
    // a1(Q1) head, a2(Q2) queued
    c.handleWsMessage({ type: 'ask-hook-pending', id: 'a1', questions: Q1 });
    c.handleWsMessage({ type: 'ask-hook-pending', id: 'a2', questions: Q2 });
    // 提交 a1 —— handleAskQuestionSubmit 内部会先 snapshot 再 promote 到 a2
    c.handleAskQuestionSubmit([{ questionIndex: 0, optionIndex: 1 }], 'a1', Q1);
    const msg = host._sent.find(m => m.type === 'ask-hook-answer');
    assert.ok(msg);
    assert.equal(msg.id, 'a1');
    // 关键断言：key 必须是 Q1 的 'Pick a color?' 而非 promote 后 head(a2) 的 'Pick a size?'
    assert.deepEqual(msg.answers, { 'Pick a color?': 'Blue' });
    // 且 head 已乐观推进到 a2
    assert.equal(host._state.pendingAsk.id, 'a2');
  });

  it('legacy 占位 id：提交时省略 id（让 server FIFO 兜底）', () => {
    const host = makeHost();
    const c = new AskFlowController(host);
    // 无 id 的 ask-hook-pending → 用 LEGACY_ASK_PLACEHOLDER_ID 作 head
    c.handleWsMessage({ type: 'ask-hook-pending', questions: Q1 });
    assert.equal(host._state.pendingAsk.id, LEGACY_ASK_PLACEHOLDER_ID);
    c.handleAskQuestionSubmit([{ questionIndex: 0, optionIndex: 0 }], LEGACY_ASK_PLACEHOLDER_ID, Q1);
    const msg = host._sent.find(m => m.type === 'ask-hook-answer');
    assert.ok(msg);
    assert.equal(msg.id, undefined, 'legacy 占位不带 id');
  });
});

describe('AskFlowController — cancel / rollback', () => {
  it('_applyCancelLocal：写 __cancelled__ sentinel 且 promote head', () => {
    const host = makeHost();
    const c = new AskFlowController(host);
    c.handleWsMessage({ type: 'ask-hook-pending', id: 'a1', questions: Q1 });
    c.handleWsMessage({ type: 'ask-hook-pending', id: 'a2', questions: Q2 });
    c._applyCancelLocal('a1', 'User aborted');
    assert.equal(host._state.localAskAnswers['a1'].__cancelled__, true);
    assert.equal(host._state.pendingAsk.id, 'a2'); // promoted
  });

  it('_applyCancelLocal：已有真实 answer 时不覆盖为 cancelled', () => {
    const host = makeHost();
    const c = new AskFlowController(host);
    host._state.localAskAnswers = { a1: { 'Pick a color?': 'Red' } };
    host._state.pendingAsk = { id: 'a1', questions: Q1 };
    c._applyCancelLocal('a1', 'User aborted');
    assert.deepEqual(host._state.localAskAnswers['a1'], { 'Pick a color?': 'Red' });
  });

  it('handleAskCancel：ws OPEN → 发 ask-cancel', () => {
    const host = makeHost();
    const c = new AskFlowController(host);
    c.handleWsMessage({ type: 'ask-hook-pending', id: 'a1', questions: Q1 });
    c.handleAskCancel('a1', 'changed mind');
    const msg = host._sent.find(m => m.type === 'ask-cancel');
    assert.ok(msg);
    assert.equal(msg.id, 'a1');
    assert.equal(msg.reason, 'changed mind');
  });

  it('handleAskCancel：ws CLOSED → 缓存到 _pendingCancelIds 待重发', () => {
    const host = makeHost({ wsOpen: false });
    const c = new AskFlowController(host);
    host._state.pendingAsk = { id: 'a1', questions: Q1 };
    c.handleAskCancel('a1', 'offline cancel');
    assert.ok(c._pendingCancelIds instanceof Map);
    assert.equal(c._pendingCancelIds.get('a1'), 'offline cancel');
    assert.equal(host._sent.find(m => m.type === 'ask-cancel'), undefined);
  });

  it('ask-hook-cancelled：本端等 ack 的 user message 被 flush', () => {
    const host = makeHost();
    const c = new AskFlowController(host);
    c.handleWsMessage({ type: 'ask-hook-pending', id: 'a1', questions: Q1 });
    host._pendingFlush.push({ askId: 'a1', text: 'my next prompt', tid: null });
    c.handleWsMessage({ type: 'ask-hook-cancelled', id: 'a1', reason: 'interrupt' });
    assert.equal(host._flushSent.length, 1);
    assert.equal(host._flushSent[0].text, 'my next prompt');
  });

  it('_abortAskSubmitWithRollback：恢复 pendingAsk + 调 warnSubmitRetry', () => {
    const host = makeHost();
    const c = new AskFlowController(host);
    c._lastClearedPendingAsk = { id: 'a1', questions: Q1 };
    c._lastAskSubmitId = 'a1';
    host._state.localAskAnswers = { a1: { 'Pick a color?': 'Red' } };
    c._abortAskSubmitWithRollback('pty-prompt-invalid');
    assert.equal(host._state.pendingAsk.id, 'a1'); // restored
    assert.equal(host._state.localAskAnswers['a1'], undefined); // rolled back
    assert.deepEqual(host._warned, ['pty-prompt-invalid']);
  });
});

describe('AskFlowController — _waitForHookBridge 即时判定', () => {
  it('abort 请求 → 立即清状态、不继续', () => {
    const host = makeHost();
    const c = new AskFlowController(host);
    c._askAbortRequested = true;
    c._pendingHookAnswers = [{ questionIndex: 0, optionIndex: 0 }];
    c._askSubmitting = true;
    c._waitForHookBridge();
    assert.equal(c._askAbortRequested, false);
    assert.equal(c._pendingHookAnswers, null);
    assert.equal(c._askSubmitting, false);
  });

  it('hook 已 active → 立即走 _submitViaHookBridge', () => {
    const host = makeHost();
    const c = new AskFlowController(host);
    c.handleWsMessage({ type: 'ask-hook-pending', id: 'a1', questions: Q1 });
    c._pendingHookAnswers = [{ questionIndex: 0, optionIndex: 0 }];
    c._waitForHookBridge();
    const msg = host._sent.find(m => m.type === 'ask-hook-answer');
    assert.ok(msg, 'hook active 时应直接提交');
    assert.equal(c._pendingHookAnswers, null);
  });
});

describe('AskFlowController — PTY sequential 提交 (_submitViaSequentialQueueInternal)', () => {
  const ASK_PROMPT = { options: [{ number: 1, text: 'Red', selected: true }, { number: 2, text: 'Blue' }] };
  const SINGLE_ANSWER = { type: 'single', optionIndex: 1, isLast: true };

  it('ws 未开 → abort("ws-not-open")，不发 input-sequential', () => {
    const host = makeHost({ wsOpen: false });
    const c = new AskFlowController(host);
    c._submitViaSequentialQueueInternal(SINGLE_ANSWER, {}, 1); // retryCount=1 跳过 150ms 重试
    assert.deepEqual(host._warned, ['ws-not-open']);
    assert.equal(host._ctxSent.length, 0);
  });

  it('ptyPrompt 失效 + history 无兜底 → abort("pty-prompt-invalid")', () => {
    const host = makeHost();           // ws open
    const c = new AskFlowController(host);
    host._state.ptyPrompt = null;
    host._state.ptyPromptHistory = [];
    c._submitViaSequentialQueueInternal(SINGLE_ANSWER, {}, 1);
    assert.deepEqual(host._warned, ['pty-prompt-invalid']);
    assert.equal(host._ctxSent.length, 0);
  });

  it('合法 ptyPrompt → 发 input-sequential；done(seq) 匹配 → finish（清 ptyPrompt + _askSubmitting=false）', () => {
    const host = makeHost();
    const c = new AskFlowController(host);
    host._state.ptyPrompt = ASK_PROMPT;
    c._askSubmitting = true;
    c._submitViaSequentialQueueInternal(SINGLE_ANSWER, {}, 1);
    const sent = host._ctxSent.find(m => m.type === 'input-sequential');
    assert.ok(sent, '应发出 input-sequential');
    assert.ok(sent.seq, '应带 seq');
    // 模拟 server 回 done（seq 匹配）→ 触发已注册的一次性 handler
    for (const h of host._msgHandlers) h({ type: 'input-sequential-done', seq: sent.seq });
    assert.equal(host._state.ptyPrompt, null, 'finish 后 ptyPrompt 清空');
    assert.equal(c._askSubmitting, false);
  });

  it('done(seq) 不匹配 → 不 finish（_askSubmitting 仍 true）', () => {
    const host = makeHost();
    const c = new AskFlowController(host);
    host._state.ptyPrompt = ASK_PROMPT;
    c._askSubmitting = true;
    c._submitViaSequentialQueueInternal(SINGLE_ANSWER, {}, 1);
    for (const h of host._msgHandlers) h({ type: 'input-sequential-done', seq: 'WRONG' });
    assert.equal(c._askSubmitting, true, '错 seq 不应 finish');
  });

  it('ctxSend 返回 false → abort("ws-send-failed")', () => {
    const host = makeHost({ sendOk: false });
    const c = new AskFlowController(host);
    host._state.ptyPrompt = ASK_PROMPT;
    c._submitViaSequentialQueueInternal(SINGLE_ANSWER, {}, 1);
    assert.deepEqual(host._warned, ['ws-send-failed']);
  });

  it('state.ptyPrompt 为 null 但 history 有 active 合法 prompt → 用 history 兜底，不 abort', () => {
    const host = makeHost();
    const c = new AskFlowController(host);
    host._state.ptyPrompt = null;
    host._state.ptyPromptHistory = [{ ...ASK_PROMPT, status: 'active' }];
    c._submitViaSequentialQueueInternal(SINGLE_ANSWER, {}, 1);
    assert.equal(host._warned.length, 0, '有 history 兜底不应 abort');
    assert.ok(host._ctxSent.find(m => m.type === 'input-sequential'));
  });
});

describe('AskFlowController — timeout 队列移除 / 生命周期', () => {
  it('ask-hook-timeout：head 命中 → promote 下一条', () => {
    const host = makeHost();
    const c = new AskFlowController(host);
    c.handleWsMessage({ type: 'ask-hook-pending', id: 'a1', questions: Q1 });
    c.handleWsMessage({ type: 'ask-hook-pending', id: 'a2', questions: Q2 });
    c.handleWsMessage({ type: 'ask-hook-timeout', id: 'a1' });
    assert.equal(host._state.pendingAsk.id, 'a2');
  });

  it('ask-hook-timeout：非 head（在 queue）→ 从 askQueue 移除', () => {
    const host = makeHost();
    const c = new AskFlowController(host);
    c.handleWsMessage({ type: 'ask-hook-pending', id: 'a1', questions: Q1 });
    c.handleWsMessage({ type: 'ask-hook-pending', id: 'a2', questions: Q2 });
    c.handleWsMessage({ type: 'ask-hook-timeout', id: 'a2' });
    assert.equal(host._state.pendingAsk.id, 'a1', 'head 不变');
    assert.equal(host._state.askQueue.length, 0, 'a2 被移除');
  });

  it('sdk-ask-timeout：head 命中 → promote', () => {
    const host = makeHost({ sdkMode: true });
    const c = new AskFlowController(host);
    c.handleWsMessage({ type: 'sdk-ask-pending', id: 's1', questions: Q1 });
    c.handleWsMessage({ type: 'sdk-ask-pending', id: 's2', questions: Q2 });
    c.handleWsMessage({ type: 'sdk-ask-timeout', id: 's1' });
    assert.equal(host._state.pendingAsk.id, 's2');
  });

  it('dispose：清 _pendingHookAnswers + _pendingCancelIds', () => {
    const host = makeHost();
    const c = new AskFlowController(host);
    c._pendingHookAnswers = [{ x: 1 }];
    c._pendingCancelIds = new Map([['a1', 'r']]);
    c._hookWaitTimer = setTimeout(() => {}, 9999);
    c.dispose();
    assert.equal(c._pendingHookAnswers, null);
    assert.equal(c._pendingCancelIds.size, 0);
  });

  it('onWsOpen：重发缓存的 _pendingCancelIds 并清空', () => {
    const host = makeHost(); // ws open
    const c = new AskFlowController(host);
    c._pendingCancelIds = new Map([['a1', 'r1'], ['a2', 'r2']]);
    c.onWsOpen();
    const cancels = host._sent.filter(m => m.type === 'ask-cancel');
    assert.equal(cancels.length, 2);
    assert.equal(c._pendingCancelIds.size, 0, '重发后清空');
  });

  it('onWsOpen: /api/pending-asks entries actually set pendingAsk (regression: {data:JSON} wrapper was a silent no-op)', async () => {
    const host = makeHost();
    host.fetchPendingAsks = () => Promise.resolve({
      pendingAsks: [
        { id: 'toolu_disk1', questions: Q1, createdAt: 123 },
        { id: 'toolu_disk2', questions: Q2, createdAt: 456 },
        { id: 'bad_empty', questions: [], createdAt: 789 }, // filtered: empty questions
      ],
    });
    const c = new AskFlowController(host);
    c.onWsOpen();
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(host._state.pendingAsk?.id, 'toolu_disk1');
    assert.deepEqual(host._state.pendingAsk?.questions, Q1);
    assert.equal(host._state.askQueue.length, 1, 'second entry queued behind the head');
    assert.equal(host._state.askQueue[0].id, 'toolu_disk2');
    assert.equal(host._state.askMetaMap['toolu_disk1']?.startedAt, 123, 'createdAt flows into askMetaMap');
  });

  it('onWsOpen: replayed entry already pending is deduped (no duplicate head/queue)', async () => {
    const host = makeHost();
    host.fetchPendingAsks = () => Promise.resolve({
      pendingAsks: [{ id: 'toolu_dup', questions: Q1, createdAt: 1 }],
    });
    const c = new AskFlowController(host);
    c.handleWsMessage({ type: 'ask-hook-pending', id: 'toolu_dup', questions: Q1 });
    c.onWsOpen();
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(host._state.pendingAsk?.id, 'toolu_dup');
    assert.equal(host._state.askQueue.length, 0);
  });
});
