/**
 * 单 ws 合并(方案 D) 后 ChatView._submitViaSequentialQueue 的提交守护行为测试
 *
 * 回归背景:v1.6.226 把 ChatView 的 _inputWs 与 TerminalPanel 的 ws 合并到 TerminalWsProvider 后,
 *   - wsOpen 一度绑到 cliMode || terminalVisible,导致非该状态下 ctx.isOpen()=false → 提交失败
 *   - _submitViaSequentialQueue 中 ctx.send() 返回值未校验,readyState 检查到实际 send 之间的
 *     ws.onclose race 会让消息静默丢失 + 孤儿 handler 等满 15s
 *
 * 测试策略:内联抽取 _submitViaSequentialQueue 的核心逻辑成纯函数 + mock ctx,
 * 不引入 ChatView/JSX/i18n(ChatView 构造依赖 localStorage / antd / promptClassifier 等
 * 无法在 node:test jsdom 下起来)。参考 plan-v2-extract.test.js 的内联模式。
 *
 * 覆盖 4 个 case:
 *   1. ctx.isOpen()=false → abort('ws-not-open'),不调 ctx.send / 不挂 handler
 *   2. ctx.isOpen()=true && ctx.send=()=>false → abort('ws-send-failed'),不挂 handler
 *   3. ctx.isOpen()=true && ctx.send=()=>true + matched-seq done → finish 被调用 + handler 注销
 *   4. ctx.isOpen()=true && ctx.send=()=>true + wrong-seq done → finish 不被调用
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ─── 内联:_submitViaSequentialQueue 的核心逻辑(纯函数版) ─────────────────────
//
// 真实代码位于 src/components/chat/controllers/askFlowController.js（_submitViaSequentialQueueInternal，原在 ChatView.jsx）。
// 此处把核心提交逻辑抽取为接收依赖注入的纯函数,便于单测。
function submitViaSequentialQueue({ ctx, ptyPrompt, isPlanApprovalPrompt, isDangerousOperationPrompt,
                                    chunks, settleMs, seq,
                                    onAbort, onFinish }) {
  // ws 守护
  if (!ctx || !ctx.isOpen || !ctx.isOpen()) {
    onAbort('ws-not-open');
    return null;
  }
  // pty prompt 守护
  const p = ptyPrompt;
  const isValidAskPrompt = !!(p && Array.isArray(p.options) && p.options.length > 0
    && !isPlanApprovalPrompt(p) && !isDangerousOperationPrompt(p));
  if (!isValidAskPrompt) {
    onAbort('pty-prompt-invalid');
    return null;
  }
  // 先 send,失败同步 abort,不挂 handler
  const sent = ctx.send({ type: 'input-sequential', chunks, settleMs, seq });
  if (!sent) {
    onAbort('ws-send-failed');
    return null;
  }
  // 注册 handler
  let unsub = null;
  const onceMsg = (msg) => {
    if (msg && msg.type === 'input-sequential-done' && msg.seq === seq) {
      if (unsub) { try { unsub(); } catch {} unsub = null; }
      onFinish();
    }
  };
  unsub = ctx.addMessageHandler(onceMsg);
  return { onceMsg, getUnsub: () => unsub };
}

// ─── helpers:mock ctx 工厂 ────────────────────────────────────────────────────
function makeCtx({ isOpen = true, sendOk = true } = {}) {
  const handlers = new Set();
  const sendCalls = [];
  return {
    handlers,
    sendCalls,
    isOpen: () => isOpen,
    send: (obj) => { sendCalls.push(obj); return sendOk; },
    addMessageHandler: (fn) => {
      handlers.add(fn);
      return () => { handlers.delete(fn); };
    },
    addStateListener: () => () => {},
  };
}

const VALID_PROMPT = { options: [{ label: 'Yes' }, { label: 'No' }] };
const NOT_PLAN = () => false;
const NOT_DANGER = () => false;
const NOOP_PROMPT = () => false;

// ─── tests ──────────────────────────────────────────────────────────────────

describe('_submitViaSequentialQueue 守护行为', () => {

  it('case 1: ctx.isOpen()=false → abort("ws-not-open"),不调 send,不挂 handler', () => {
    const ctx = makeCtx({ isOpen: false });
    let abortReason = null;
    let finished = false;
    const ret = submitViaSequentialQueue({
      ctx,
      ptyPrompt: VALID_PROMPT,
      isPlanApprovalPrompt: NOT_PLAN,
      isDangerousOperationPrompt: NOT_DANGER,
      chunks: ['y'], settleMs: 300, seq: 'cv-1',
      onAbort: (r) => { abortReason = r; },
      onFinish: () => { finished = true; },
    });
    assert.equal(abortReason, 'ws-not-open');
    assert.equal(ctx.sendCalls.length, 0, 'ctx.send 不应被调用');
    assert.equal(ctx.handlers.size, 0, '不应挂 handler');
    assert.equal(ret, null);
    assert.equal(finished, false);
  });

  it('case 2: ctx.send()=false → abort("ws-send-failed"),不挂 handler', () => {
    const ctx = makeCtx({ isOpen: true, sendOk: false });
    let abortReason = null;
    let finished = false;
    const ret = submitViaSequentialQueue({
      ctx,
      ptyPrompt: VALID_PROMPT,
      isPlanApprovalPrompt: NOT_PLAN,
      isDangerousOperationPrompt: NOT_DANGER,
      chunks: ['y'], settleMs: 300, seq: 'cv-2',
      onAbort: (r) => { abortReason = r; },
      onFinish: () => { finished = true; },
    });
    assert.equal(abortReason, 'ws-send-failed');
    assert.equal(ctx.sendCalls.length, 1, 'send 必须被尝试');
    assert.equal(ctx.handlers.size, 0, '失败后不应挂 handler');
    assert.equal(ret, null);
    assert.equal(finished, false);
  });

  it('case 3: send 成功 + matched-seq done → finish 被调用 + handler 注销', () => {
    const ctx = makeCtx({ isOpen: true, sendOk: true });
    let abortReason = null;
    let finished = false;
    const ret = submitViaSequentialQueue({
      ctx,
      ptyPrompt: VALID_PROMPT,
      isPlanApprovalPrompt: NOT_PLAN,
      isDangerousOperationPrompt: NOT_DANGER,
      chunks: ['y'], settleMs: 300, seq: 'cv-3',
      onAbort: (r) => { abortReason = r; },
      onFinish: () => { finished = true; },
    });
    assert.equal(abortReason, null);
    assert.equal(ctx.sendCalls.length, 1);
    assert.equal(ctx.handlers.size, 1, 'send 成功后挂 handler');
    assert.notEqual(ret, null);

    // 模拟 server unicast 一个 matched-seq done
    for (const h of ctx.handlers) h({ type: 'input-sequential-done', seq: 'cv-3' });
    assert.equal(finished, true, 'finish 应被触发');
    assert.equal(ctx.handlers.size, 0, 'handler 应已自注销');
  });

  it('case 4: send 成功 + wrong-seq done → finish 不被调用 (避免 ChatView/TerminalPanel 串扰)', () => {
    const ctx = makeCtx({ isOpen: true, sendOk: true });
    let abortReason = null;
    let finished = false;
    submitViaSequentialQueue({
      ctx,
      ptyPrompt: VALID_PROMPT,
      isPlanApprovalPrompt: NOT_PLAN,
      isDangerousOperationPrompt: NOT_DANGER,
      chunks: ['y'], settleMs: 300, seq: 'cv-4-mine',
      onAbort: (r) => { abortReason = r; },
      onFinish: () => { finished = true; },
    });
    assert.equal(abortReason, null);
    assert.equal(ctx.handlers.size, 1);

    // TerminalPanel 触发的 done(seq 不同)被严格过滤
    for (const h of ctx.handlers) h({ type: 'input-sequential-done', seq: 'tp-other-seq' });
    assert.equal(finished, false, 'wrong-seq 不应触发 finish');
    assert.equal(ctx.handlers.size, 1, 'handler 不应被注销');

    // 自己的 seq 到达再触发
    for (const h of ctx.handlers) h({ type: 'input-sequential-done', seq: 'cv-4-mine' });
    assert.equal(finished, true);
    assert.equal(ctx.handlers.size, 0);
  });

  it('case 5(回归):pty-prompt 不合法 → abort("pty-prompt-invalid") 不发送', () => {
    // 既有逻辑保留:plan / danger prompt 或空 options 都视为非法 ask prompt
    const ctx = makeCtx({ isOpen: true, sendOk: true });
    let abortReason = null;
    submitViaSequentialQueue({
      ctx,
      ptyPrompt: { options: [] },
      isPlanApprovalPrompt: NOT_PLAN,
      isDangerousOperationPrompt: NOT_DANGER,
      chunks: ['y'], settleMs: 300, seq: 'cv-5',
      onAbort: (r) => { abortReason = r; },
      onFinish: () => {},
    });
    assert.equal(abortReason, 'pty-prompt-invalid');
    assert.equal(ctx.sendCalls.length, 0);
    assert.equal(ctx.handlers.size, 0);
  });
});
