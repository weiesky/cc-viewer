/**
 * sdk-plan-approval-guard.test.js — source anchors for the 2026-10-21 fix for the
 * SDK-mode plan approval hang.
 *
 * Root cause: --sdk mode sets BOTH CCV_CLI_MODE=1 and CCV_SDK_MODE=1, so the web app
 * receives cliMode=true alongside sdkMode=true. The PTY plan-approval surface was gated
 * on cliMode alone, so in SDK mode the PTY card / global ApprovalModal activated too —
 * and its Approve button sends PTY keystrokes ({type:'input'}) which the server drops
 * in SDK mode (server.js). The SDK canUseTool promise then never resolves and the
 * session looks hung (5-min timeout deny).
 *
 * The fix gates every PTY plan surface on !sdkMode, leaving the bottom ToolApprovalPanel
 * (sdk-plan-pending → sdk-plan-answer) as the single SDK approval channel.
 *
 * Source-anchor style per house precedent (resume-history-menu.test.js): ChatView is a
 * React class that can't be imported into node:test, so these assertions read the source
 * and fail loudly if a future refactor drops a guard.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const read = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', rel), 'utf8');
const CHATVIEW = read('src/components/chat/ChatView.jsx');
const CHAT_INPUT = read('src/components/chat/ChatInputBar.jsx');
const APPROVAL_PANEL = read('src/components/approval/ToolApprovalPanel.jsx');
const MOBILE = read('src/Mobile.jsx');

describe('SDK mode never activates the PTY plan-approval surface', () => {
  it('componentDidUpdate derives pendingPtyPlan only when cliMode && !sdkMode', () => {
    assert.ok(
      /if \(this\.props\.cliMode && !this\.props\.sdkMode && lpid && !skipped\)/.test(CHATVIEW),
      'the pendingPtyPlan derivation must be gated on !sdkMode (SDK plan approval uses sdk-plan-answer)',
    );
  });

  it('plan auto-approve uses an explicit channel and never PTY keystrokes in SDK mode', () => {
    assert.ok(
      /_startPlanAutoApprove = \(planId, channel, \{ autoApproveAt = null, autoApproveSeconds = null, autoCancelled = false \} = \{\}\) =>/.test(CHATVIEW)
        && /if \(!seconds\) return;/.test(CHATVIEW),
      'the shared timer must accept a transport channel and remain disabled when the setting is off',
    );
    assert.ok(
      /if \(seconds === AUTO_APPROVE_INSTANT && !\(autoApproveAt > 0\)\) \{/.test(CHATVIEW),
      'instant approval must preserve the configured channel',
    );
    assert.ok(
      /this\._startPlanAutoApprove\(curTarget\.id, curTarget\.channel, curAuto\)/.test(CHATVIEW)
        && /pendingPlanApproval: this\.state\.pendingPlanApproval/.test(CHATVIEW),
      'the timer lifecycle must include the SDK pending plan as well as the PTY plan',
    );
    // 服务端兜底：pending 帧/重放携带 autoApproveAt（wall-clock 截止）与 autoCancelled，
    // 客户端按截止时间倒计时（重连显示剩余而非重置满额），取消的计划永不重武装。
    assert.ok(
      /autoApproveAt: msg\.autoApproveAt \?\? null/.test(CHATVIEW)
        && /startDeadlineCountdown/.test(CHATVIEW),
      'SDK plan frames must carry the server auto-approve deadline and the countdown must be wall-clock driven',
    );
    const fire = CHATVIEW.match(/_firePlanAutoApprove = \(planId, channel\) => \{([\s\S]*?)\n  \};/);
    assert.ok(fire, 'the auto-approve firing method must accept a channel');
    assert.ok(
      /if \(channel === 'sdk'\) \{\s*this\.handlePlanApprove\(planId\);/.test(fire[1]),
      'SDK auto-approval must resolve through handlePlanApprove → sdk-plan-answer',
    );
    assert.ok(
      /target\?\.id !== planId \|\| target\.channel !== channel/.test(fire[1]),
      'late timer ticks must not approve a different plan or transport',
    );
  });

  it('cancel resolves the active channel and a disconnect cannot silently re-arm it', () => {
    const cancel = CHATVIEW.match(/cancelPlanAutoApprove = \(\) => \{([\s\S]*?)\n  \};/);
    assert.ok(cancel && /resolvePlanAutoApproveTarget/.test(cancel[1])
      && /this\._planAutoCancelled\.add\(target\.id\)/.test(cancel[1]),
    'cancel must remember the active SDK or PTY plan id');
    assert.ok(
      /Retain cancellation until this plan is resolved/.test(CHATVIEW)
        && !/if \(planChanged && curPlanId\)/.test(CHATVIEW),
      'cancelled ids must survive a transient empty pending state during reconnect',
    );
  });

  it('the SDK quick menu exposes the now-functional Plan auto-approve setting', () => {
    assert.ok(!/hidePlan=\{!!sdkMode\}/.test(CHAT_INPUT));
  });

  it('the message-list ChatMessage gets lastPendingPlanId=null under sdkMode (card stays read-only)', () => {
    assert.ok(
      /const msgLastPlanId = \(mi === lastPendingPlanOwnerIdx && !this\.props\.sdkMode\) \? lastPendingPlanId : null;/.test(CHATVIEW),
      'message-list render must suppress the interactive plan id in sdkMode',
    );
  });

  it('the LR-bubble ChatMessage gets lastPendingPlanId=null under sdkMode', () => {
    assert.ok(
      /const respLastPendingPlanId = this\.props\.sdkMode \? null : lr\.respLastPendingPlanId;/.test(CHATVIEW),
      'LR bubble render must suppress the interactive plan id in sdkMode',
    );
  });

  it('the PTY keystroke sinks are hard-gated in sdkMode (defense in depth)', () => {
    const click = CHATVIEW.match(/handlePromptOptionClick = \(number\) => \{([\s\S]{0,300})/);
    assert.ok(click && /this\.props\.sdkMode\) return;/.test(click[1]),
      'handlePromptOptionClick must return early in sdkMode (server drops input frames)');
    const fb = CHATVIEW.match(/handlePlanFeedbackSubmit = \(number, text\) => \{([\s\S]{0,300})/);
    assert.ok(fb && /this\.props\.sdkMode\) return;/.test(fb[1]),
      'handlePlanFeedbackSubmit must return early in sdkMode');
  });

  it('LR ownership receives an sdkMode-aware cliMode (lrWillOwnPlan stays consistent)', () => {
    assert.ok(
      /cliMode: this\.props\.cliMode && !this\.props\.sdkMode,/.test(CHATVIEW),
      'computeLrOwnership must get cliMode && !sdkMode so lrWillOwnPlan matches the gated surfaces',
    );
  });

  it('the SDK approval channel itself is untouched (pendingPlanApproval → sdk-plan-answer)', () => {
    assert.ok(
      /msg\.type === 'sdk-plan-pending'/.test(CHATVIEW)
        && /setState\(\{ pendingPlanApproval: \{[\s\S]{0,160}?id: msg\.id, input: msg\.input/.test(CHATVIEW),
      'sdk-plan-pending must still set pendingPlanApproval',
    );
    assert.ok(
      /type: 'sdk-plan-answer', id, approve: true/.test(CHATVIEW),
      'handlePlanApprove must still send sdk-plan-answer',
    );
  });

  it('the SDK plan approval PANEL still renders and is wired to the approve/reject handlers', () => {
    // Regression net for the hang: if the ToolApprovalPanel render is removed or mis-wired,
    // SDK plan approval has no working surface and canUseTool waits out the 5-min timeout.
    assert.ok(
      /this\.state\.pendingPlanApproval && \([\s\S]{0,300}?<ToolApprovalPanel/.test(CHATVIEW),
      'pendingPlanApproval must render the ToolApprovalPanel',
    );
    assert.ok(
      /requestId=\{this\.state\.pendingPlanApproval\.id\}/.test(CHATVIEW),
      'panel must be keyed by the pending plan id',
    );
    assert.ok(
      /onAllow=\{this\.handlePlanApprove\}/.test(CHATVIEW)
        && /onDeny=\{\(id\) => this\.handlePlanReject\(id, ''\)\}/.test(CHATVIEW),
      'panel Allow/Deny must route to handlePlanApprove/handlePlanReject',
    );
    assert.ok(
      /planAutoApproveCountdown=\{this\.state\.planAutoApproveCountdown\}/.test(CHATVIEW)
        && /onCancelPlanAutoApprove=\{this\.cancelPlanAutoApprove\}/.test(CHATVIEW),
      'the SDK panel must display the shared countdown and cancellation affordance',
    );
    const panel = CHATVIEW.match(/this\.state\.pendingPlanApproval && \([\s\S]{0,700}?<ToolApprovalPanel[\s\S]{0,700}?\/>/);
    assert.ok(panel && !/autoApproveSeconds/.test(panel[0]),
      'plan auto-approval must not reuse the ordinary permission autoApproveSeconds setting');
    assert.ok(
      /ui\.planAutoApprove\.countdown/.test(APPROVAL_PANEL)
        && /ui\.planAutoApprove\.cancel/.test(APPROVAL_PANEL),
      'the shared panel must use the existing plan countdown translations',
    );
  });

  it('mobile mirrors the ChatView countdown into the global SDK plan panel', () => {
    assert.ok(/onPlanAutoApproveCountdown=\{this\.handlePlanAutoApproveCountdown\}/.test(MOBILE));
    assert.ok(/planAutoApproveCountdown=\{this\.state\.globalPlanAutoApproveCountdown\}/.test(MOBILE));
    assert.ok(/onCancelPlanAutoApprove=\{this\.state\.globalPlanApproval\.handlers\.cancelAutoApprove\}/.test(MOBILE));
  });

  it('sdk-plan-resolved clears the panel only for the matching id', () => {
    assert.ok(
      /msg\.type === 'sdk-plan-resolved'\) \{[\s\S]{0,200}?pendingPlanApproval\?\.id === msg\.id[\s\S]{0,200}?pendingPlanApproval: null/.test(CHATVIEW),
      'sdk-plan-resolved must clear pendingPlanApproval by matching id (otherwise the panel wedges)',
    );
  });
});
