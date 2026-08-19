// AskFlowController — ChatView 的 AskUserQuestion 问答流状态机（从 ChatView.jsx 抽出）。
//
// 设计：依赖注入的纯逻辑类，不是 React hook（ChatView 是 class + 单 contextType，
// 用不了 hook）。React state 仍留在 ChatView.state，本控制器通过构造时注入的 `host`
// 适配器读写 ChatView 的 state / props / ws / PTY 字段；ChatView 的 ask 方法退化为
// 一行委托。这样渲染模型、state 位置、contextType 绑定、componentDidUpdate 冒泡、
// WS 订阅全部不变 —— 纯逻辑搬迁，可独立单测（见 test/ask-flow-controller.test.js）。
//
// host 接口约定（ChatView 构造时注入）：
//   getState()        → live this.state（非快照，_applyCancelLocal 等依赖 setState 后同步读）
//   setState(u, cb)   → this.setState
//   getProps()        → this.props
//   ws()              → this._inputWs（基于 this.context 的 send/readyState facade）
//   ctxSend(obj)      → this.context.send（input-sequential 用）
//   ctxIsOpen()       → this.context.isOpen()（_submitViaSequentialQueueInternal 直接调）
//   addMessageHandler(fn) → this.context.addMessageHandler（input-sequential-done 一次性 handler）
//   getCurrentPtyPrompt() / setCurrentPtyPrompt(v) → ChatView 的 _currentPtyPrompt
//   clearPtyDebounce()→ 清 _ptyDebounceTimer
//   sendUserMessageImmediate(t, ta, skip) → this._sendUserMessageImmediate
//   takePendingFlush(askId) → 从 ChatView 的 _pendingFlushQueue 取走匹配 entry（findIndex+splice+clearTimeout）
//   isUnmounted()     → this._unmounted
//   notifyAskResolved(payload) → window.tabBridge?.notifyAskResolved（透传 tabId/reason）

import { buildChunksForAnswer } from '../../../utils/ptyChunkBuilder.js';
import { isPlanApprovalPrompt, isDangerousOperationPrompt } from '../../../utils/promptClassifier.js';

// 故意不 import antd / i18n / 任何 JSX：让本控制器能在 node:test 下被直接 import 单测
// （antd 在无 DOM 的 node 环境会炸——参见 test/single-ws-submit.test.js 的注释）。
// 用户可见的提示（Modal.warning + i18n 文案 + JSX）经 host.warnSubmitRetry 留在 ChatView。

// pendingAsk.id 占位符 — 仅连旧 server（pre-Map ask-hook 协议、ask-hook-pending 不带 id）时启用。
// FIXME: 待旧 server 版本完全淘汰后统一去掉此 fallback 路径。
export const LEGACY_ASK_PLACEHOLDER_ID = '__ask__';

// askQueue entry.kind — 决定 _promoteNextAskFromQueue 弹起后路由哪条 submit 路径。
export const ASK_KIND = { HOOK: 'hook', SDK: 'sdk' };

export class AskFlowController {
  constructor(host) {
    this.host = host;
    // ── ask 状态机实例字段（从 ChatView 平移；过渡期 ChatView 用 getter/setter 垫片转发）──
    this._askHookActive = false;      // PreToolUse hook bridge is pending
    // hook bridge 在本 session 内是否曾经握手过——区分"新版 CC 有 ask-bridge"和"老版无 hook"两种场景。
    this._askHookEverActive = false;
    this._askHookQuestions = null;    // 当前 head 的 questions
    this._sdkAskId = null;            // 当前 SDK ask id（SDK 模式）
    this._pendingHookAnswers = null;  // answers waiting for hook bridge
    this._askHookWaitRetries = 0;     // hook bridge wait retry counter
    this._hookWaitTimer = null;       // hook bridge wait timer
    this._askAbortRequested = false;  // Cancel 路径请求 polling 立即退出（每次新 submit 入口重置）
    this._askSubmitting = false;      // submission in progress
    this._askAnswerQueue = null;      // PTY 路径 answer chunk 队列
    this._isMultiQuestionForm = false;
    this._askPromptRetries = 0;       // 等 PTY prompt 出现的重试计数
    this._askWsRetries = 0;           // 等 WS open 的重试计数
    this._waitForWsTimer = null;
    this._waitForPtyTimer = null;
    this._lastClearedPendingAsk = null; // PTY 路径 abort 回滚面包屑
    this._lastAskSubmitId = null;
    this._pendingCancelIds = null;    // Map<askId, reason>：WS 不可用时缓存的 cancel，reopen 时重发
  }

  // 清 askMetaMap 中指定 askId 的 entry — 内存回收钩子。entry 不存在时返 null（不触发 re-render）。
  _clearAskMeta = (askId) => {
    if (!askId) return;
    this.host.setState(prev => {
      if (!prev.askMetaMap || !prev.askMetaMap[askId]) return null;
      const next = { ...prev.askMetaMap };
      delete next[askId];
      return { askMetaMap: next };
    });
  };

  _promoteNextAskFromQueue = () => {
    // 清当前 head 的 askMetaMap 条目（内存回收）
    const state = this.host.getState();
    const prevHeadId = state.pendingAsk?.id;
    if (prevHeadId) this._clearAskMeta(prevHeadId);

    const queue = state.askQueue;
    const next = queue && queue.length > 0 ? queue[0] : null;
    if (next) {
      if (next.kind === ASK_KIND.SDK) {
        this._sdkAskId = next.id;
        this._askHookActive = false;
      } else {
        this._sdkAskId = null;
        this._askHookActive = true; this._askHookEverActive = true;
      }
      this._askHookQuestions = next.questions;
      this.host.setState({
        pendingAsk: { id: next.id, questions: next.questions },
        askQueue: queue.slice(1),
      });
    } else {
      this._askHookActive = false;
      this._sdkAskId = null;
      this._askHookQuestions = null;
      this.host.setState({ pendingAsk: null, askQueue: [] });
    }
  };

  /**
   * Plan submission strategy for each answer based on question structure.
   * Annotates each answer with `isLast` flag.
   */
  _planSubmissionSteps(answers) {
    return answers.map((answer, i) => ({
      ...answer,
      isLast: i === answers.length - 1,
    }));
  }

  /**
   * 等待 hook bridge（ask-hook-pending）到达。
   * - _askHookEverActive=true（新版 CC）：无隐式超时，用户 Cancel 是唯一逃生口。
   * - _askHookEverActive=false（老版 CC）：等 ~30s（150 × 200ms）后兜底 fallback 到 PTY。
   */
  _waitForHookBridge() {
    if (this.host.isUnmounted()) return;
    if (this._askAbortRequested) {
      this._askAbortRequested = false;
      this._pendingHookAnswers = null;
      this._askSubmitting = false;
      return;
    }
    if (this._askHookActive) {
      const answers = this._pendingHookAnswers;
      this._pendingHookAnswers = null;
      this._submitViaHookBridge(answers);
      return;
    }
    // ws 突然 closed：hook 路径无法走 → 转 PTY 由 _waitForWsAndSubmit 接管重连
    const ws = this.host.ws();
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      const answers = this._pendingHookAnswers;
      this._pendingHookAnswers = null;
      this._submitViaPty(answers);
      return;
    }
    this._askHookWaitRetries = (this._askHookWaitRetries || 0) + 1;
    // 老版 CC 兜底：本 session 从未见过 ask-hook-pending → 30s 后视作 hook 不可用，走 PTY
    if (!this._askHookEverActive && this._askHookWaitRetries > 150) {
      const answers = this._pendingHookAnswers;
      this._pendingHookAnswers = null;
      this._submitViaPty(answers);
      return;
    }
    this._hookWaitTimer = setTimeout(() => this._waitForHookBridge(), 200);
  }

  /**
   * PTY 模拟路径（从 handleAskQuestionSubmit 提取）
   */
  _submitViaPty(answers) {
    const ws = this.host.ws();

    // ws 暂时不可用 → 准备 queue 后等 Provider 自动重连。
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      this._askAnswerQueue = this._planSubmissionSteps(answers);
      this._askSubmitting = true;
      this._isMultiQuestionForm = answers.length > 1;
      this._askWsRetries = 0;
      this._waitForWsAndSubmit();
      return;
    }

    this._askAnswerQueue = this._planSubmissionSteps(answers);
    this._askSubmitting = true;
    this._isMultiQuestionForm = answers.length > 1;

    // ptyPrompt may not be available yet (streaming response renders before CLI prompt appears)
    if (!this.host.getCurrentPtyPrompt()) {
      this._askPromptRetries = 0;
      this._waitForPtyPromptAndSubmit();
      return;
    }

    this._processNextAskAnswer();
  }

  _waitForWsAndSubmit() {
    this._askWsRetries = (this._askWsRetries || 0) + 1;
    if (this._askWsRetries > 30) {
      // Give up after ~3 seconds
      this._askSubmitting = false;
      this._askAnswerQueue = [];
      return;
    }
    const ws = this.host.ws();
    if (ws && ws.readyState === WebSocket.OPEN) {
      // WS connected, now wait for ptyPrompt
      if (!this.host.getCurrentPtyPrompt()) {
        this._askPromptRetries = 0;
        this._waitForPtyPromptAndSubmit();
      } else {
        this._processNextAskAnswer();
      }
      return;
    }
    this._waitForWsTimer = setTimeout(() => this._waitForWsAndSubmit(), 100);
  }

  _waitForPtyPromptAndSubmit() {
    this._askPromptRetries = (this._askPromptRetries || 0) + 1;
    if (this._askPromptRetries > 50) {
      // Timeout: proceed without ptyPrompt (assume first option selected, CLI default)
      this._processNextAskAnswer();
      return;
    }
    if (this.host.getCurrentPtyPrompt()) {
      this._processNextAskAnswer();
      return;
    }
    this._waitForPtyTimer = setTimeout(() => this._waitForPtyPromptAndSubmit(), 100);
  }

  _processNextAskAnswer() {
    if (!this._askAnswerQueue || this._askAnswerQueue.length === 0) {
      this._askSubmitting = false;
      return;
    }
    const answer = this._askAnswerQueue.shift();

    // Multi-select Other: handle as single PTY submission.
    if (answer.type === 'other' && answer.isMultiSelect) {
      this._submitViaSequentialQueue(answer, { settleMs: 500 });
      return;
    }

    if (answer.type === 'other') {
      this._submitOtherAnswer(answer);
    } else if (answer.type === 'multi') {
      this._submitMultiSelectAnswer(answer);
    } else {
      this._submitSingleSelectAnswer(answer);
    }
  }

  _submitSingleSelectAnswer(answer) {
    this._submitViaSequentialQueue(answer);
  }

  _submitMultiSelectAnswer(answer) {
    this._submitViaSequentialQueue(answer);
  }

  _submitOtherAnswer(answer) {
    this._submitViaSequentialQueue(answer);
  }

  /**
   * PTY 路径 abort：清提交中状态、回滚 handleAskQuestionSubmit 入口乐观写入的
   * pendingAsk + localAskAnswers，让用户重试。
   */
  _abortAskSubmitWithRollback(reason) {
    this._askSubmitting = false;
    this._askAnswerQueue = [];
    if (this._lastClearedPendingAsk) {
      const restored = this._lastClearedPendingAsk;
      this._lastClearedPendingAsk = null;
      this.host.setState({ pendingAsk: restored });
    }
    const askId = this._lastAskSubmitId;
    if (askId) {
      this._lastAskSubmitId = null;
      this.host.setState((prev) => {
        const nextLocal = { ...(prev.localAskAnswers || {}) };
        delete nextLocal[askId];
        return { localAskAnswers: nextLocal };
      });
    }
    // 用户可见提示（antd Modal + i18n 文案 + JSX）留在 ChatView，经 host 调用 — 保持本控制器纯净可单测。
    this.host.warnSubmitRetry(reason);
  }

  /**
   * Unified PTY submission: build chunks via ptyChunkBuilder, send via server-side sequential queue.
   * PTY-prompt 自检 + 三层兜底（同步重试 / history 兜底 / 硬阻断），详见原 ChatView 注释。
   */
  _submitViaSequentialQueue(answer, opts = {}) {
    this._submitViaSequentialQueueInternal(answer, opts, 0);
  }

  _submitViaSequentialQueueInternal(answer, opts, retryCount) {
    if (!this.host.ctxIsOpen()) {
      this._abortAskSubmitWithRollback('ws-not-open');
      return;
    }

    // PTY prompt 类型自检：必须是合法的 AskUserQuestion inquirer prompt
    const p = this.host.getState().ptyPrompt;
    const isValidAskPrompt = !!(p && Array.isArray(p.options) && p.options.length > 0
      && !isPlanApprovalPrompt(p)
      && !isDangerousOperationPrompt(p));

    // 第一次自检失败 → 150ms 后重试一次
    if (!isValidAskPrompt && retryCount === 0) {
      setTimeout(() => this._submitViaSequentialQueueInternal(answer, opts, 1), 150);
      return;
    }

    // 重试仍失败 → 从 history 找最新 active 合法 ask prompt 兜底
    let effectivePrompt = p;
    if (!isValidAskPrompt) {
      const fromHistory = (this.host.getState().ptyPromptHistory || []).slice().reverse()
        .find(pp => pp && pp.status === 'active'
          && Array.isArray(pp.options) && pp.options.length > 0
          && !isPlanApprovalPrompt(pp)
          && !isDangerousOperationPrompt(pp));
      if (fromHistory) {
        effectivePrompt = fromHistory;
        if (typeof globalThis !== 'undefined' && globalThis.__CCV_PTY_TRACE__ === true) {
          // eslint-disable-next-line no-console
          try { console.warn('[pty.trace] _submitViaSequentialQueue: state.ptyPrompt 自检未命中，从 ptyPromptHistory 取最新 active ask prompt 兜底乐观提交'); } catch {}
        }
      } else {
        this._abortAskSubmitWithRollback('pty-prompt-invalid');
        return;
      }
    }

    const isMultiQuestion = !!this._isMultiQuestionForm;
    const chunks = buildChunksForAnswer(answer, effectivePrompt, isMultiQuestion);
    const settleMs = opts.settleMs || 300;

    // 用 seq 区分本 ws 上的多发送方，handler 严格按 seq 匹配
    const seq = `cv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // 先 send,只有发送成功才挂 handler
    const sent = this.host.ctxSend({ type: 'input-sequential', chunks, settleMs, seq });
    if (!sent) {
      this._abortAskSubmitWithRollback('ws-send-failed');
      return;
    }

    let unsub = null;
    const onceMsg = (msg) => {
      if (msg && msg.type === 'input-sequential-done' && msg.seq === seq) {
        if (unsub) { try { unsub(); } catch {} unsub = null; }
        this._finishCurrentAskAnswer();
      }
    };
    unsub = this.host.addMessageHandler(onceMsg);

    setTimeout(() => {
      if (unsub) { try { unsub(); } catch {} unsub = null; }
      if (this._askSubmitting) {
        this._finishCurrentAskAnswer();
      }
    }, 15000);
  }

  _finishCurrentAskAnswer() {
    // Mark current prompt as answered and clear buffer
    this.host.setCurrentPtyPrompt(null);
    this.host.setState(state => {
      const history = state.ptyPromptHistory.slice();
      const last = history[history.length - 1];
      if (last && last.status === 'active') {
        history[history.length - 1] = { ...last, status: 'answered' };
      }
      return { ptyPrompt: null, ptyPromptHistory: history };
    });
    // Only clear debounce timer when no more answers pending
    if (!this._askAnswerQueue || this._askAnswerQueue.length === 0) {
      this.host.clearPtyDebounce();
      // 队列已空 = PTY 路径成功结束。清掉 abort 回滚用的暂存字段
      this._lastClearedPendingAsk = null;
      this._lastAskSubmitId = null;
    }

    // Wait for next prompt to appear (multi-question scenario)
    if (this._askAnswerQueue && this._askAnswerQueue.length > 0) {
      setTimeout(() => {
        this._processNextAskAnswer();
      }, 500);
    } else {
      this._askSubmitting = false;
    }
  }

  /**
   * Submit AskUserQuestion answers via hook bridge (structured JSON, no PTY simulation).
   */
  _submitViaHookBridge(answers, explicitHeadId, explicitQuestions) {
    const ws = this.host.ws();
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      // Fallback to PTY path
      this._askHookActive = false;
      this._askHookQuestions = null;
      this._submitViaPty(answers);
      return;
    }

    this._askSubmitting = true;

    // 优先用快照 questions（promote 已把 instance 字段切到下一个 ask）
    const questions = explicitQuestions || this._askHookQuestions || [];
    const hookAnswers = {};

    for (const answer of answers) {
      const q = questions[answer.questionIndex];
      if (!q) continue;
      const questionText = q.question;

      if (answer.type === 'other') {
        hookAnswers[questionText] = answer.text || '';
      } else if (answer.type === 'multi') {
        const labels = (answer.selectedIndices || [])
          .map((i) => q.options?.[i]?.label)
          .filter(Boolean);
        hookAnswers[questionText] = labels.join(', ');
      } else {
        hookAnswers[questionText] = q.options?.[answer.optionIndex]?.label || '';
      }
    }

    // Resolve which pending ask in pendingAskHooks Map this answer addresses.
    const resolvedAskId = (explicitHeadId !== undefined ? explicitHeadId : this.host.getState().pendingAsk?.id) || null;
    const payload = { type: 'ask-hook-answer', answers: hookAnswers };
    if (resolvedAskId && resolvedAskId !== LEGACY_ASK_PLACEHOLDER_ID) payload.id = resolvedAskId;
    ws.send(JSON.stringify(payload));

    // 成功路径：清掉 abort 回滚用的暂存字段
    this._lastClearedPendingAsk = null;
    this._lastAskSubmitId = null;

    // 不立即清除 _askHookActive：保留 hook bridge 状态以支持重试
    this._askSubmitting = false;

    // Update UI state — mark prompt as answered
    this.host.setCurrentPtyPrompt(null);
    this.host.setState((state) => {
      const history = state.ptyPromptHistory.slice();
      const last = history[history.length - 1];
      if (last && last.status === 'active') {
        history[history.length - 1] = { ...last, status: 'answered' };
      }
      return { ptyPrompt: null, ptyPromptHistory: history };
    });
    this.host.clearPtyDebounce();
  }

  /**
   * 共享 cancel local-state 应用逻辑 — handleAskCancel（本端）和 'ask-hook-cancelled'（远端 ack）两处调用。
   * step 1: 写 __cancelled__ sentinel 到 localAskAnswers（hasRealAnswer / 幂等 双 guard）
   * step 2: head 推进（promoteHead=true）或非 head 过滤 queue
   */
  _applyCancelLocal = (askId, reason, { promoteHead = true } = {}) => {
    if (!askId) return;
    const cancelReason = typeof reason === 'string' && reason ? reason : 'User aborted';

    this.host.setState(prev => {
      const existingLocal = prev.localAskAnswers && prev.localAskAnswers[askId];
      const hasRealAnswer = existingLocal
        && !existingLocal.__cancelled__
        && !existingLocal.__rejected__
        && Object.keys(existingLocal).length > 0;
      if (hasRealAnswer) return null;
      if (existingLocal && existingLocal.__cancelled__ === true) return null;
      return {
        localAskAnswers: { ...(prev.localAskAnswers || {}), [askId]: { __cancelled__: true, __cancelReason__: cancelReason } },
      };
    });

    if (this.host.getState().pendingAsk?.id === askId) {
      // 内存回收：head 分支无条件清 askMetaMap entry；幂等。
      this._clearAskMeta(askId);
      if (promoteHead) this._promoteNextAskFromQueue();
    } else if (this.host.getState().askQueue.some(a => a.id === askId)) {
      this._clearAskMeta(askId);
      this.host.setState(state => ({ askQueue: state.askQueue.filter(a => a.id !== askId) }));
    }
  };

  /**
   * Cancel a pending AskUserQuestion — Cancel 按钮 / typed-interrupt 触发。
   * 乐观写 localAskAnswers + 推 head；发 WS ask-cancel；WS 不可用时缓存到 _pendingCancelIds 待重发。
   */
  handleAskCancel = (askId, reason) => {
    if (!askId) return;
    const cancelReason = typeof reason === 'string' && reason ? reason : 'User aborted';

    // 通知 _waitForHookBridge 的 polling 立即停下（用户取消是唯一逃生口）。
    this._askAbortRequested = true;
    if (this._hookWaitTimer) { clearTimeout(this._hookWaitTimer); this._hookWaitTimer = null; }
    this._pendingHookAnswers = null;
    this._askSubmitting = false;

    this._applyCancelLocal(askId, cancelReason);

    // 通知 Electron main 清 dock badge / pendingByTab[tabId].ask（host 补 tabId）
    this.host.notifyAskResolved({ id: askId, reason: 'cancel' });

    // 发 WS ask-cancel；WS 不可用 → 缓存到 _pendingCancelIds 让 reopen 时重发
    const ws = this.host.ws();
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: 'ask-cancel', id: askId, reason: cancelReason })); } catch {}
    } else {
      if (!this._pendingCancelIds) this._pendingCancelIds = new Map();
      this._pendingCancelIds.set(askId, cancelReason);
    }
    return askId;
  };

  handleAskQuestionSubmit = (answers, askId, questions) => {
    // 每次新提交入口重置 abort。
    this._askAbortRequested = false;
    // 关键：在 _promoteNextAskFromQueue 之前把当前 head 的所有提交上下文整体快照下来。
    // promote 会立刻把 _askHookQuestions / _askHookActive / _sdkAskId 切到下一个 ask。
    const submitCtx = {
      headAskId: this.host.getState().pendingAsk?.id || null,
      hookQuestions: this._askHookQuestions,
      wasHookActive: this._askHookActive,
      wasSdkAskId: this._sdkAskId,
    };
    // 立即更新本地答案映射，解除 Last Response 中"提交中..."卡住状态
    if (askId && questions) {
      const localAnswers = {};
      for (const answer of answers) {
        const q = questions[answer.questionIndex];
        if (!q) continue;
        if (answer.type === 'other') {
          localAnswers[q.question] = answer.text;
        } else if (answer.type === 'multi') {
          const labels = answer.selectedIndices.map(i => (q.options || [])[i]?.label).filter(Boolean);
          localAnswers[q.question] = labels.join(', ');
        } else {
          localAnswers[q.question] = (q.options || [])[answer.optionIndex]?.label || '';
        }
      }
      // 暂存原 pendingAsk + askId：PTY 路径 prompt 失效时 _abortAskSubmitWithRollback 据此恢复。
      this._lastClearedPendingAsk = this.host.getState().pendingAsk;
      this._lastAskSubmitId = askId;
      this.host.setState(prev => ({
        localAskAnswers: { ...(prev.localAskAnswers || {}), [askId]: localAnswers },
      }));
      // 乐观推进 head：全局 modal 与 inline form 同帧切到下一个 ask（或清空），不依赖 server ack。
      this._promoteNextAskFromQueue();
    }

    // SDK 模式：直接通过 WS 发送结构化答案
    if (this.host.getProps().sdkMode) {
      const resolvedId = askId || submitCtx.wasSdkAskId;
      if (!resolvedId) {
        this._lastClearedPendingAsk = null;
        this._lastAskSubmitId = null;
        return;
      }
      const ws = this.host.ws();
      if (ws && ws.readyState === WebSocket.OPEN) {
        // 构造 answers 对象: { questionText: selectedLabel }；qs 优先取快照（promote 后会错位）
        const sdkAnswers = {};
        const qs = submitCtx.hookQuestions || questions;
        for (const answer of answers) {
          const q = qs?.[answer.questionIndex];
          if (!q) continue;
          if (answer.type === 'other') {
            sdkAnswers[q.question] = answer.text;
          } else if (answer.type === 'multi') {
            const labels = answer.selectedIndices.map(i => (q.options || [])[i]?.label).filter(Boolean);
            sdkAnswers[q.question] = labels.join(', ');
          } else {
            sdkAnswers[q.question] = (q.options || [])[answer.optionIndex]?.label || '';
          }
        }
        ws.send(JSON.stringify({ type: 'sdk-ask-answer', id: resolvedId, answers: sdkAnswers }));
        this._lastClearedPendingAsk = null;
        this._lastAskSubmitId = null;
      } else {
        this._lastClearedPendingAsk = null;
        this._lastAskSubmitId = null;
      }
      return;
    }

    // Hook bridge path（路由判定用快照）
    if (submitCtx.wasHookActive && !this._askSubmitting) {
      this._submitViaHookBridge(answers, submitCtx.headAskId, submitCtx.hookQuestions);
      return;
    }

    // _askHookActive=false 但 pendingAsk 仍存在 + ws OPEN → 直接尝试 hook bridge
    if (!submitCtx.wasHookActive && !this._askSubmitting
        && submitCtx.headAskId
        && this.host.ws() && this.host.ws().readyState === WebSocket.OPEN) {
      this._submitViaHookBridge(answers, submitCtx.headAskId, submitCtx.hookQuestions);
      return;
    }

    // Hook bridge 可能尚未就绪（streaming response 先于 hook 触发）：短暂等待
    if (!submitCtx.wasHookActive && !this._askSubmitting
        && this.host.ws() && this.host.ws().readyState === WebSocket.OPEN) {
      this._pendingHookAnswers = answers;
      this._askHookWaitRetries = 0;
      this._askSubmitting = true;
      this._waitForHookBridge();
      return;
    }

    this._submitViaPty(answers);
  };

  /**
   * 处理 ask / sdk-ask 类 WS 消息。返回 true 表示已处理（ChatView dispatcher 据此短路）；
   * 非 ask 类型返回 false，交回 ChatView 处理（data/exit/perm/plan/image）。
   */
  handleWsMessage(msg) {
    if (msg.type === 'ask-hook-pending') {
      // Hook bridge: server 发 id 让多并发 ask（sub-agents）经 pendingAskHooks Map 多路复用互不阻塞。
      // Legacy server（无 id）→ fall back 到 LEGACY_ASK_PLACEHOLDER_ID 单槽语义。
      if (Array.isArray(msg.questions) && msg.questions.length > 0) {
        const askId = msg.id != null ? String(msg.id) : LEGACY_ASK_PLACEHOLDER_ID;
        if (typeof msg.startedAt === 'number' && typeof msg.timeoutMs === 'number') {
          this.host.setState(prev => ({
            askMetaMap: { ...prev.askMetaMap, [askId]: { startedAt: msg.startedAt, timeoutMs: msg.timeoutMs } },
          }));
        }
        if (msg.id == null && this.host.getState().pendingAsk?.id === LEGACY_ASK_PLACEHOLDER_ID) {
          console.warn('[ChatView] legacy ask-hook-pending without id arrived while a placeholder ask is already active — second ask will be silently dropped (legacy server does not support concurrent asks). Upgrade server to enable multi-ask multiplexing.');
        }
        this.host.setState(state => {
          if (state.pendingAsk) {
            if (state.pendingAsk.id === askId) return null;
            if (state.askQueue.some(a => a.id === askId)) return null;
            return { askQueue: [...state.askQueue, { id: askId, questions: msg.questions, kind: ASK_KIND.HOOK }] };
          }
          this._askHookActive = true; this._askHookEverActive = true;
          this._askHookQuestions = msg.questions;
          this._sdkAskId = null;
          return { pendingAsk: { id: askId, questions: msg.questions } };
        });
      }
      return true;
    }
    if (msg.type === 'ask-hook-timeout') {
      // id-aware：只在 timed-out ask 匹配 head 时 clear/promote。
      const askId = msg.id != null ? String(msg.id) : null;
      if (askId == null) {
        if (this.host.getState().pendingAsk?.id === LEGACY_ASK_PLACEHOLDER_ID) this._promoteNextAskFromQueue();
        return true;
      }
      if (this.host.getState().pendingAsk?.id === askId) {
        this._promoteNextAskFromQueue();
      } else if (this.host.getState().askQueue.some(a => a.id === askId)) {
        this._clearAskMeta(askId);
        this.host.setState(state => ({ askQueue: state.askQueue.filter(a => a.id !== askId) }));
      }
      return true;
    }
    if (msg.type === 'sdk-ask-pending') {
      // SDK mode: AskUserQuestion via canUseTool — id 是 SDK toolUseId。与 hook 共用队列。
      if (msg.id == null) {
        console.warn('[ChatView] sdk-ask-pending missing id — server invariant violated, ignoring');
        return true;
      }
      if (Array.isArray(msg.questions) && msg.questions.length > 0) {
        const askId = String(msg.id);
        if (typeof msg.startedAt === 'number' && typeof msg.timeoutMs === 'number') {
          this.host.setState(prev => ({
            askMetaMap: { ...prev.askMetaMap, [askId]: { startedAt: msg.startedAt, timeoutMs: msg.timeoutMs } },
          }));
        }
        this.host.setState(state => {
          if (state.pendingAsk) {
            if (state.pendingAsk.id === askId) return null;
            if (state.askQueue.some(a => a.id === askId)) return null;
            return { askQueue: [...state.askQueue, { id: askId, questions: msg.questions, kind: ASK_KIND.SDK }] };
          }
          this._askHookActive = true; this._askHookEverActive = true;
          this._askHookQuestions = msg.questions;
          this._sdkAskId = msg.id;
          return { pendingAsk: { id: askId, questions: msg.questions } };
        });
      }
      return true;
    }
    if (msg.type === 'sdk-ask-timeout') {
      const askId = msg.id != null ? String(msg.id) : null;
      if (askId == null) return true;
      if (this.host.getState().pendingAsk?.id === askId) {
        this._promoteNextAskFromQueue();
      } else if (this.host.getState().askQueue.some(a => a.id === askId)) {
        this._clearAskMeta(askId);
        this.host.setState(state => ({ askQueue: state.askQueue.filter(a => a.id !== askId) }));
      }
      return true;
    }
    if (msg.type === 'ask-hook-resolved' || msg.type === 'ask-hook-already-answered') {
      // resolved：另一端回答了；already-answered：本端抢答失败 ack。两者语义一样（清 modal/queue）。
      const askId = msg.id != null ? String(msg.id) : null;
      if (askId == null) {
        if (this.host.getState().pendingAsk?.id === LEGACY_ASK_PLACEHOLDER_ID) this._promoteNextAskFromQueue();
      } else if (this.host.getState().pendingAsk?.id === askId) {
        this._promoteNextAskFromQueue();
      } else if (this.host.getState().askQueue.some(a => a.id === askId)) {
        this._clearAskMeta(askId);
        this.host.setState(state => ({ askQueue: state.askQueue.filter(a => a.id !== askId) }));
      }
      return true;
    }
    if (msg.type === 'sdk-ask-resolved') {
      const askId = msg.id != null ? String(msg.id) : null;
      if (askId != null && this.host.getState().pendingAsk?.id === askId) {
        this._promoteNextAskFromQueue();
      } else if (askId != null && this.host.getState().askQueue.some(a => a.id === askId)) {
        this._clearAskMeta(askId);
        this.host.setState(state => ({ askQueue: state.askQueue.filter(a => a.id !== askId) }));
      }
      return true;
    }
    if (msg.type === 'ask-hook-cancelled') {
      // server ack：handleAskCancel 发的 ask-cancel 已处理。① 本端发起 + 等 ack flush → 立即 flush；
      // ② 兜底清 modal/queue（远端 cancel）；③ 写 localAskAnswers 灰态。
      const askId = msg.id != null ? String(msg.id) : null;
      if (!askId) return true;
      // 优先 flush 等待中的 user message（ack 协议核心）。takePendingFlush 内部 FIFO 取最早入队 entry。
      const entry = this.host.takePendingFlush(askId);
      let isLocalAck = false;
      if (entry) {
        this.host.sendUserMessageImmediate(entry.text, null, true);
        isLocalAck = true;
      }
      // 应用 cancel local state — promoteHead 仅远端场景需要（本端 handleAskCancel 已 promote）
      this._applyCancelLocal(askId, msg.reason, { promoteHead: !isLocalAck });
      // 远端取消时本 tab 可能正在 _waitForHookBridge polling 该 ask — 同步打破循环并清 submit 状态。
      if (!isLocalAck) {
        this._askAbortRequested = true;
        if (this._hookWaitTimer) { clearTimeout(this._hookWaitTimer); this._hookWaitTimer = null; }
        this._pendingHookAnswers = null;
        this._askSubmitting = false;
      }
      return true;
    }
    return false;
  }

  /**
   * After a WS reopen: resend cached _pendingCancelIds and pull /api/pending-asks to
   * restore ask UI missed during the disconnect (including disk-only entries orphaned
   * by a server restart — the ApprovalModal fallback form renders them so the user
   * can answer or durably cancel).
   *
   * Historical note: this injection used to wrap entries as `{ data: JSON.stringify(...) }`
   * (the raw-socket-event shape), but handleWsMessage dispatches on the PARSED message's
   * `.type`, so the wrapper made recovery a silent no-op. Pass the message object directly.
   */
  onWsOpen() {
    if (this.host.isUnmounted()) return;
    const ws = this.host.ws();
    if (this._pendingCancelIds && this._pendingCancelIds.size > 0 && ws && ws.readyState === WebSocket.OPEN) {
      for (const [askId, reason] of this._pendingCancelIds) {
        try { ws.send(JSON.stringify({ type: 'ask-cancel', id: askId, reason })); } catch {}
      }
      this._pendingCancelIds.clear();
    }
    try {
      this.host.fetchPendingAsks()
        .then(data => {
          if (this.host.isUnmounted() || !data || !Array.isArray(data.pendingAsks)) return;
          for (const ask of data.pendingAsks) {
            if (!ask || !ask.id || !Array.isArray(ask.questions) || ask.questions.length === 0) continue;
            this.handleWsMessage({
              type: 'ask-hook-pending', id: ask.id, questions: ask.questions,
              startedAt: ask.createdAt, timeoutMs: 24 * 60 * 60 * 1000,
            });
          }
        })
        .catch(() => { /* silent: old servers lack this endpoint → ws replay still covers most cases */ });
    } catch {}
  }

  /** WS close：只 reset 控制器实例 flag（不调 setState — ask 的 state 键由 ChatView close 分支合并清）。 */
  resetAskFlagsOnClose() {
    this._sdkAskId = null;
    this._askHookActive = false;
    this._askHookQuestions = null;
  }

  /** componentWillUnmount 调：清 ask 计时器 + buffered answers / cancel ids。 */
  dispose() {
    if (this._hookWaitTimer) clearTimeout(this._hookWaitTimer);
    if (this._waitForWsTimer) clearTimeout(this._waitForWsTimer);
    if (this._waitForPtyTimer) clearTimeout(this._waitForPtyTimer);
    this._pendingHookAnswers = null;
    if (this._pendingCancelIds) this._pendingCancelIds.clear();
  }
}
