// Unit tests for the PTY ask-prompt retry decision tree implemented inline in
// src/components/chat/controllers/askFlowController.js _submitViaSequentialQueueInternal()
// （原在 ChatView.jsx，Step 抽离后移入控制器）。
//
// 测试范围 = 该函数前半段的"判定 + 兜底"决策（决定 abort / 重试 / 走 state / 走 history），
// 不包含后半段实际 send chunks 的路径（依赖 ws context，由 e2e 覆盖）。
//
// KEEP IN SYNC: askFlowController.js _submitViaSequentialQueueInternal 三段式决策若变化（自检条件 /
// 重试次数 / history 兜底过滤），同步修改本文件的 decideRetry() 镜像。
//
// 引入真实的 promptClassifier 而不是 mock —— 保证决策与生产用同一份分类规则。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isPlanApprovalPrompt, isDangerousOperationPrompt } from '../src/utils/promptClassifier.js';

// 内联镜像 askFlowController.js 的 isValidAskPrompt 表达式
function isValidAskPrompt(p) {
  return !!(p && Array.isArray(p.options) && p.options.length > 0
    && !isPlanApprovalPrompt(p)
    && !isDangerousOperationPrompt(p));
}

// 内联镜像 askFlowController.js 的 history 兜底查找
function findFallbackAskPromptFromHistory(history) {
  if (!Array.isArray(history)) return null;
  return history.slice().reverse()
    .find(pp => pp && pp.status === 'active'
      && Array.isArray(pp.options) && pp.options.length > 0
      && !isPlanApprovalPrompt(pp)
      && !isDangerousOperationPrompt(pp)) || null;
}

// 镜像 _submitViaSequentialQueueInternal 决策段：返回 {action, reason?, prompt?, source?}
// action ∈ 'abort' | 'retry-150ms' | 'submit'
function decideRetry(state, ctx, retryCount) {
  if (!ctx || !ctx.isOpen || !ctx.isOpen()) {
    return { action: 'abort', reason: 'ws-not-open' };
  }
  const p = state.ptyPrompt;
  const isValid = isValidAskPrompt(p);
  if (!isValid && retryCount === 0) {
    return { action: 'retry-150ms' };
  }
  if (!isValid) {
    const fromHistory = findFallbackAskPromptFromHistory(state.ptyPromptHistory);
    if (fromHistory) {
      return { action: 'submit', source: 'history', prompt: fromHistory };
    }
    return { action: 'abort', reason: 'pty-prompt-invalid' };
  }
  return { action: 'submit', source: 'state', prompt: p };
}

const openCtx = { isOpen: () => true };
const closedCtx = { isOpen: () => false };

// 注意：options 文案需避开 isDangerousOperationPrompt 的 allow/deny 启发式
// （包含同时 ^allow|^yes 和 ^no|^deny|^reject 的两选项会被识别为 dangerous）。
// 也避开 isPlanApprovalPrompt 的 3-option approve/edit/reject 兜底。
const validAsk = {
  question: 'Pick one of the following options',
  options: [{ text: 'Option A' }, { text: 'Option B' }, { text: 'Option C' }],
  status: 'active',
};

const planPrompt = {
  question: 'Would you like to approve this plan?',
  options: [{ text: 'Approve' }, { text: 'Approve with edits' }, { text: 'Reject' }],
  status: 'active',
};

const dangerousPrompt = {
  question: 'Do you want to make this edit?',
  options: [{ text: 'Yes, allow' }, { text: 'No, deny' }],
  status: 'active',
};

describe('PTY ask submit: ws-not-open 短路', () => {
  it('ws 未连接 → 立即 abort, 不进入自检', () => {
    const result = decideRetry({ ptyPrompt: validAsk, ptyPromptHistory: [] }, closedCtx, 0);
    assert.equal(result.action, 'abort');
    assert.equal(result.reason, 'ws-not-open');
  });
});

describe('PTY ask submit: 第一次自检 (retryCount=0)', () => {
  it('合法 ask prompt → submit (state 路径)', () => {
    const result = decideRetry({ ptyPrompt: validAsk, ptyPromptHistory: [] }, openCtx, 0);
    assert.equal(result.action, 'submit');
    assert.equal(result.source, 'state');
    assert.deepEqual(result.prompt, validAsk);
  });

  it('ptyPrompt=null → 调度 150ms 重试 (不直接走 history 兜底)', () => {
    const result = decideRetry({ ptyPrompt: null, ptyPromptHistory: [validAsk] }, openCtx, 0);
    assert.equal(result.action, 'retry-150ms');
  });

  it('ptyPrompt 选项为空 → 调度 150ms 重试', () => {
    const empty = { question: 'Q', options: [], status: 'active' };
    const result = decideRetry({ ptyPrompt: empty, ptyPromptHistory: [] }, openCtx, 0);
    assert.equal(result.action, 'retry-150ms');
  });

  it('ptyPrompt 是 plan-approval → 调度 150ms 重试 (state.ptyPrompt 不能直接用)', () => {
    const result = decideRetry({ ptyPrompt: planPrompt, ptyPromptHistory: [] }, openCtx, 0);
    assert.equal(result.action, 'retry-150ms');
  });

  it('ptyPrompt 是 dangerous-operation → 调度 150ms 重试', () => {
    const result = decideRetry({ ptyPrompt: dangerousPrompt, ptyPromptHistory: [] }, openCtx, 0);
    assert.equal(result.action, 'retry-150ms');
  });
});

describe('PTY ask submit: 第二次自检 (retryCount=1) - history 兜底', () => {
  it('state 仍 null + history 有合法 ask → submit (history 路径)', () => {
    const result = decideRetry({ ptyPrompt: null, ptyPromptHistory: [validAsk] }, openCtx, 1);
    assert.equal(result.action, 'submit');
    assert.equal(result.source, 'history');
    assert.deepEqual(result.prompt, validAsk);
  });

  it('state null + history 空 → abort pty-prompt-invalid', () => {
    const result = decideRetry({ ptyPrompt: null, ptyPromptHistory: [] }, openCtx, 1);
    assert.equal(result.action, 'abort');
    assert.equal(result.reason, 'pty-prompt-invalid');
  });

  it('state null + history 全是 plan/dangerous → abort (兜底过滤这两类)', () => {
    const result = decideRetry({
      ptyPrompt: null,
      ptyPromptHistory: [planPrompt, dangerousPrompt],
    }, openCtx, 1);
    assert.equal(result.action, 'abort');
    assert.equal(result.reason, 'pty-prompt-invalid');
  });

  it('state null + history 全是 status=answered → abort (只接受 active)', () => {
    const answered = { ...validAsk, status: 'answered' };
    const result = decideRetry({
      ptyPrompt: null,
      ptyPromptHistory: [answered, answered],
    }, openCtx, 1);
    assert.equal(result.action, 'abort');
    assert.equal(result.reason, 'pty-prompt-invalid');
  });

  it('history 多条 active → 取最新（reverse 后第一个匹配）', () => {
    const older = { ...validAsk, options: [{ text: 'old-1' }, { text: 'old-2' }] };
    const newer = { ...validAsk, options: [{ text: 'new-1' }, { text: 'new-2' }] };
    const result = decideRetry({
      ptyPrompt: null,
      ptyPromptHistory: [older, newer],   // 时间顺序：older 在前，newer 在后
    }, openCtx, 1);
    assert.equal(result.action, 'submit');
    assert.equal(result.source, 'history');
    assert.deepEqual(result.prompt.options, newer.options);
  });

  it('history 后半段是 plan 但前半段有合法 ask → 取最新合法 active', () => {
    // reverse 后顺序：planPrompt -> validAsk -> 命中 validAsk
    const result = decideRetry({
      ptyPrompt: null,
      ptyPromptHistory: [validAsk, planPrompt],
    }, openCtx, 1);
    assert.equal(result.action, 'submit');
    assert.equal(result.source, 'history');
    assert.deepEqual(result.prompt, validAsk);
  });

  it('state 是合法 ask → 直接 submit (history 兜底不参与)', () => {
    // retryCount=1 但 state 已有效，不应该看 history
    const stale = { ...validAsk, options: [{ text: 'stale' }] };
    const result = decideRetry({
      ptyPrompt: validAsk,
      ptyPromptHistory: [stale],
    }, openCtx, 1);
    assert.equal(result.action, 'submit');
    assert.equal(result.source, 'state');
    assert.deepEqual(result.prompt, validAsk);
  });
});

describe('PTY ask submit: history 单调累加 retryCount 永不无限循环', () => {
  it('retryCount=0 至多触发一次 retry-150ms 调度', () => {
    // 模拟 ChatView 内的 setTimeout(() => internal(answer, opts, 1), 150)
    // 即外层不会无限调度；本测试用断言 retry 动作只发生在 retryCount===0
    const r0 = decideRetry({ ptyPrompt: null, ptyPromptHistory: [] }, openCtx, 0);
    assert.equal(r0.action, 'retry-150ms');
    const r1 = decideRetry({ ptyPrompt: null, ptyPromptHistory: [] }, openCtx, 1);
    assert.notEqual(r1.action, 'retry-150ms', 'retryCount=1 时不应再次 schedule retry-150ms');
    const r2 = decideRetry({ ptyPrompt: null, ptyPromptHistory: [] }, openCtx, 2);
    assert.notEqual(r2.action, 'retry-150ms', 'retryCount>1 同样');
  });
});
