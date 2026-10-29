/**
 * sdk-plan-approval-guard.test.js — source anchors for SDK-mode plan approval.
 *
 * Root cause (2026-10-21 hang, still guarded): --sdk mode sets BOTH CCV_CLI_MODE=1 and
 * CCV_SDK_MODE=1, so the web app receives cliMode=true alongside sdkMode=true. The PTY
 * plan-approval surface was gated on cliMode alone, so in SDK mode the PTY keystroke path
 * activated too — its Approve button sends {type:'input'} keystrokes which the server drops
 * in SDK mode (server.js). The SDK canUseTool promise then never resolves and the session
 * looks hung (5-min timeout deny). Defense-in-depth: the PTY keystroke sinks stay hard-gated
 * on !sdkMode, and pendingPtyPlan is never derived in SDK mode.
 *
 * Current design (plan-approval UI): SDK ExitPlanMode reuses the SAME planModeBox card as PTY,
 * portaled into the global ApprovalModal via the 'ptyPlan' kind. ChatView feeds the SDK pending
 * id (pendingPlanApproval.id === the ExitPlanMode tool_use id, server uses options.toolUseID)
 * to lastPendingPlanId, and routes the card's clicks to sdk-plan-answer handlers instead of PTY
 * keystrokes. The old bottom permission-styled ToolApprovalPanel for plans was removed; the
 * permission ToolApprovalPanel is untouched.
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
const CHAT_MESSAGE = read('src/components/chat/ChatMessage.jsx');
const APPROVAL_MODAL = read('src/components/approval/ApprovalModal.jsx');
const MOBILE = read('src/Mobile.jsx');

describe('SDK mode never activates the PTY plan-approval keystroke surface', () => {
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

  it('the message-list ChatMessage card is interactive in sdkMode (id from pendingPlanApproval)', () => {
    assert.ok(
      /msgLastPlanId[\s\S]{0,180}pendingPlanApproval\?\.id/.test(CHATVIEW),
      'message-list render must feed the SDK pending plan id to lastPendingPlanId under sdkMode',
    );
  });

  it('the LR-bubble ChatMessage card is interactive in sdkMode (id from pendingPlanApproval)', () => {
    assert.ok(
      /respLastPendingPlanId[\s\S]{0,120}pendingPlanApproval\?\.id/.test(CHATVIEW),
      'LR bubble render must feed the SDK pending plan id to lastPendingPlanId under sdkMode',
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

  it('SDK plan approval renders via the modal plan card, not a bottom permission panel', () => {
    // The bottom permission-styled plan panel was removed; only the permission panel remains.
    assert.equal(
      (CHATVIEW.match(/<ToolApprovalPanel/g) || []).length, 1,
      'ChatView must render exactly one ToolApprovalPanel (the permission panel) — the plan panel is gone',
    );
    assert.ok(
      !/toolName="ExitPlanMode"/.test(CHATVIEW),
      'no ToolApprovalPanel may be rendered for ExitPlanMode (plan uses the planModeBox card)',
    );
    // SDK plan bubbles into the global ptyPlan modal channel via the single merged writer:
    // the derived entry picks pendingPlanApproval (SDK) or pendingPtyPlan (PTY) by mode, and the
    // bubble routes the SDK payload into the ptyPlan kind.
    assert.ok(
      /onPendingPtyPlan\(\{[\s\S]{0,400}?ptyPlan: modeOn \? this\.state\.pendingPlanApproval : this\.state\.pendingPtyPlan/.test(CHATVIEW),
      'ChatView must bubble the SDK pending plan through onPendingPtyPlan so the card portals into ApprovalModal',
    );
    // Single-writer invariant: the plan modal bubble is one merged block (enter + clear) plus the
    // unmount cleanup — no second per-transport producer that could wipe the bubble in a commit.
    const bubbleCalls = (CHATVIEW.match(/this\.props\.onPendingPtyPlan\(/g) || []).length;
    assert.equal(bubbleCalls, 3, 'onPendingPtyPlan: merged enter + clear + unmount cleanup only');
  });

  it('both ChatMessage render sites route plan clicks to sdk-plan-answer handlers under sdkMode', () => {
    const optCount = (CHATVIEW.match(/onPlanApprovalClick=\{this\.props\.sdkMode \? this\.handleSdkPlanOptionClick : this\.handlePromptOptionClick\}/g) || []).length;
    assert.equal(optCount, 2, 'both message-list and LR ChatMessage must switch onPlanApprovalClick by sdkMode');
    const fbCount = (CHATVIEW.match(/onPlanFeedbackSubmit=\{this\.props\.sdkMode \? this\.handleSdkPlanFeedbackSubmit : this\.handlePlanFeedbackSubmit\}/g) || []).length;
    assert.equal(fbCount, 2, 'both message-list and LR ChatMessage must switch onPlanFeedbackSubmit by sdkMode');
    // Handler mapping: 1 → approve, else → reject; feedback textarea → reject with feedback.
    const opt = CHATVIEW.match(/handleSdkPlanOptionClick = \(number\) => \{([\s\S]*?)\n  \};/);
    assert.ok(opt, 'handleSdkPlanOptionClick must exist');
    assert.ok(/if \(number === 1\) this\.handlePlanApprove\(id\);/.test(opt[1])
      && /this\.handlePlanReject\(id, ''\)/.test(opt[1]),
    'option 1 must approve; other direct options must reject with empty feedback');
    const fb = CHATVIEW.match(/handleSdkPlanFeedbackSubmit = \(number, text\) => \{([\s\S]*?)\n  \};/);
    assert.ok(fb && /this\.handlePlanReject\(id, text\)/.test(fb[1]),
      'approve-with-edits must resolve as approve:false + feedback (Claude revises and resubmits)');
  });

  it('plan approval sound has a single source (ApprovalModal ptyPlan → planApproval)', () => {
    assert.ok(
      !/playVoiceEvent\('planApproval'/.test(CHATVIEW),
      'ChatView must not fire the planApproval voice directly (ApprovalModal is the single source)',
    );
    assert.ok(
      /ptyPlan: 'planApproval'/.test(APPROVAL_MODAL),
      'ApprovalModal must map the ptyPlan kind to the planApproval voice event',
    );
  });

  it('the plan card hosts the auto-approve countdown strip', () => {
    assert.ok(
      /ui\.planAutoApprove\.countdown/.test(CHAT_MESSAGE)
        && /ui\.planAutoApprove\.cancel/.test(CHAT_MESSAGE),
      'the plan card must render the countdown and cancel affordance',
    );
    const countdownProps = (CHATVIEW.match(/planAutoApproveCountdown=\{this\.state\.planAutoApproveCountdown\}/g) || []).length;
    assert.ok(countdownProps >= 2, 'ChatView must pass planAutoApproveCountdown to both ChatMessage sites');
  });

  it('mobile reuses the modal/inline plan card (no separate SDK plan panel)', () => {
    assert.ok(!/toolName="ExitPlanMode"/.test(MOBILE), 'mobile must not render a plan ToolApprovalPanel');
    assert.ok(!/globalPlanApproval/.test(MOBILE), 'mobile globalPlanApproval state/panel must be gone');
    assert.ok(
      /onPendingPtyPlan=\{this\.handleApprovalPtyPlan\}/.test(MOBILE),
      'mobile must keep feeding the ptyPlan modal channel',
    );
    assert.ok(/<ToolApprovalPanel/.test(MOBILE), 'mobile permission panel must remain');
  });

  it('sdk-plan-resolved clears the panel only for the matching id', () => {
    assert.ok(
      /msg\.type === 'sdk-plan-resolved'\) \{[\s\S]{0,200}?pendingPlanApproval\?\.id === msg\.id[\s\S]{0,200}?pendingPlanApproval: null/.test(CHATVIEW),
      'sdk-plan-resolved must clear pendingPlanApproval by matching id (otherwise the card wedges)',
    );
  });

  it('the removed onPendingPlanApproval prop is fully retired', () => {
    assert.ok(
      !/onPendingPlanApproval/.test(CHATVIEW) && !/onPendingPlanApproval/.test(MOBILE),
      'the onPendingPlanApproval channel was replaced by the onPendingPtyPlan reuse',
    );
  });
});
