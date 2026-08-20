// Unit tests for src/components/chat/controllers/ptyPromptController.js —
// the PTY byte-stream + prompt-detection state machine extracted from ChatView.
// Fake-host pattern per ask-flow-controller.test.js; the 200ms detection
// debounce is driven with node:test mock timers (sibling convention:
// tool-file-change-controller.test.js) — no real sleeps, no CI flake margin.
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  PtyPromptController,
  AUTO_ALLOW_PTY_DEDUPE_MS,
  PTY_BUFFER_MAX,
  PTY_HISTORY_CAP,
  DETECT_DEBOUNCE_MS,
} from '../src/components/chat/controllers/ptyPromptController.js';

beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }); });
afterEach(() => { mock.timers.reset(); });

// A plain (non-dangerous) prompt shape the linear parser detects. NOTE:
// "Do you want to proceed?"-style yes/no prompts classify as dangerous-operation
// prompts and route to the permission panel — use a neutral question here.
const NUMBERED_PROMPT = 'Pick one?\n  ❯ 1. First\n    2. Second\n';
// A dangerous-operation prompt (routes to the permission panel / auto-allow).
const DANGER_PROMPT = 'Do you want to make this edit to app.js?\n  ❯ Yes\n    Yes, allow all edits during this session (shift+tab)\n    No\n';

function makeHost({ instantAutoApprove = false, askSubmitting = false, state = {} } = {}) {
  const host = {
    _state: { ptyPrompt: null, ptyPromptHistory: [], pendingPermission: null, pendingPtyPlan: null, ...state },
    _now: 1_000_000,
    autoAllows: [],
    scrolls: 0,
    getState: () => host._state,
    setState: (update, cb) => {
      const partial = typeof update === 'function' ? update(host._state) : update;
      host._state = { ...host._state, ...partial };
      if (cb) cb();
    },
    isInstantAutoApprove: () => instantAutoApprove,
    isAskSubmitting: () => askSubmitting,
    permissionAutoAllow: (perm) => host.autoAllows.push(perm),
    scrollToBottom: () => { host.scrolls++; },
    now: () => host._now,
  };
  return host;
}

// Advance past the detection debounce (runs the armed detection synchronously).
const tick = () => mock.timers.tick(DETECT_DEBOUNCE_MS + 10);

describe('PtyPromptController', () => {
  it('detects a prompt after the debounce and pushes an active history entry', async () => {
    const host = makeHost();
    const ctl = new PtyPromptController(host);
    ctl.appendData(NUMBERED_PROMPT);
    assert.equal(host._state.ptyPrompt, null, 'not detected synchronously');
    tick();
    assert.equal(host._state.ptyPrompt.question, 'Pick one?');
    assert.equal(host._state.ptyPromptHistory.length, 1);
    assert.equal(host._state.ptyPromptHistory[0].status, 'active');
    assert.equal(ctl.getCurrent().question, 'Pick one?');
    assert.equal(host.scrolls, 1);
  });

  it('debounce coalesces bursts: many appends, one detection', async () => {
    const host = makeHost();
    const ctl = new PtyPromptController(host);
    for (const chunk of ['Pick', ' one?', '\n  ❯ 1. First', '\n    2. Second\n']) ctl.appendData(chunk);
    tick();
    assert.equal(host._state.ptyPromptHistory.length, 1, 'single history entry despite 4 appends');
  });

  it('rolls the buffer at 4KB keeping the tail (prompt still detected)', async () => {
    const host = makeHost();
    const ctl = new PtyPromptController(host);
    ctl.appendData('x'.repeat(PTY_BUFFER_MAX + 500) + '\n' + NUMBERED_PROMPT);
    assert.equal(ctl.getBuffer().length, PTY_BUFFER_MAX);
    tick();
    assert.equal(host._state.ptyPrompt?.question, 'Pick one?');
  });

  it('carries a torn trailing ANSI sequence into the next chunk; carry survives clearPrompt', async () => {
    const host = makeHost();
    const ctl = new PtyPromptController(host);
    ctl.appendData('hello \x1b[3'); // torn CSI: held in carry, not in buffer
    assert.equal(ctl.getBuffer(), 'hello ');
    ctl.clearPrompt(); // byte-stream carry must survive a prompt clear
    ctl.appendData('6mworld\x1b[0m'); // completes the sequence -> strips cleanly
    assert.equal(ctl.getBuffer(), 'world');
    tick();
  });

  it('same question updates options in place without a new history entry', async () => {
    const host = makeHost();
    const ctl = new PtyPromptController(host);
    ctl.appendData(NUMBERED_PROMPT);
    tick();
    ctl.resetBufferAfterSubmit(); // not a submit here — just isolate the next detection
    ctl.appendData('Pick one?\n    1. First\n  ❯ 2. Second\n'); // cursor moved
    tick();
    assert.equal(host._state.ptyPromptHistory.length, 1, 'no second entry for the same question');
    assert.equal(host._state.ptyPrompt.options.find(o => o.selected).number, 2);
  });

  it('a new question dismisses the previous active entry', async () => {
    const host = makeHost();
    const ctl = new PtyPromptController(host);
    ctl.appendData(NUMBERED_PROMPT);
    tick();
    ctl.resetBufferAfterSubmit();
    ctl.appendData('Which flavor?\n  ❯ 1. Sweet\n    2. Salty\n');
    tick();
    assert.equal(host._state.ptyPromptHistory.length, 2);
    assert.equal(host._state.ptyPromptHistory[0].status, 'dismissed');
    assert.equal(host._state.ptyPromptHistory[1].status, 'active');
  });

  it('history at cap: a new prompt splices the oldest entry (normal path)', async () => {
    const fullHistory = Array.from({ length: PTY_HISTORY_CAP }, (_, i) => ({
      question: `old ${i}?`, options: [], status: 'dismissed', selectedNumber: null, timestamp: 't',
    }));
    const host = makeHost({ state: { ptyPromptHistory: fullHistory } });
    const ctl = new PtyPromptController(host);
    ctl.appendData(NUMBERED_PROMPT);
    tick();
    const history = host._state.ptyPromptHistory;
    assert.equal(history.length, PTY_HISTORY_CAP, 'capped, not grown');
    assert.equal(history[history.length - 1].question, 'Pick one?', 'new entry appended');
    assert.equal(history[0].question, 'old 1?', 'oldest entry spliced off');
  });

  it('history at cap: a pty-routed danger prompt splices the oldest entry (danger path)', async () => {
    const fullHistory = Array.from({ length: PTY_HISTORY_CAP }, (_, i) => ({
      question: `old ${i}?`, options: [], status: 'dismissed', selectedNumber: null, timestamp: 't',
    }));
    const host = makeHost({ instantAutoApprove: false, state: { ptyPromptHistory: fullHistory } });
    const ctl = new PtyPromptController(host);
    ctl.appendData(DANGER_PROMPT);
    tick();
    const history = host._state.ptyPromptHistory;
    assert.equal(history.length, PTY_HISTORY_CAP, 'capped, not grown');
    assert.equal(history[history.length - 1].status, 'pty-routed', 'routed entry appended');
    assert.equal(history[0].question, 'old 1?', 'oldest entry spliced off');
  });

  it('instant auto-approve dedupes the same danger prompt within the window, re-allows after it', async () => {
    const host = makeHost({ instantAutoApprove: true });
    const ctl = new PtyPromptController(host);
    ctl.appendData(DANGER_PROMPT);
    tick();
    assert.equal(host.autoAllows.length, 1);
    assert.equal(host._state.pendingPermission, null, 'auto-allow sets no pendingPermission');
    // Same prompt re-detected within the dedupe window -> suppressed.
    ctl.appendData('\n' + DANGER_PROMPT);
    tick();
    assert.equal(host.autoAllows.length, 1);
    // Past the window -> allowed again.
    host._now += AUTO_ALLOW_PTY_DEDUPE_MS + 1;
    ctl.appendData('\n' + DANGER_PROMPT);
    tick();
    assert.equal(host.autoAllows.length, 2);
    // clearPrompt resets the signature -> allowed immediately.
    ctl.clearPrompt();
    ctl.appendData(DANGER_PROMPT);
    tick();
    assert.equal(host.autoAllows.length, 3);
  });

  it('non-instant danger prompt routes to pendingPermission with a pty-routed history entry', async () => {
    const host = makeHost({ instantAutoApprove: false });
    const ctl = new PtyPromptController(host);
    ctl.appendData(DANGER_PROMPT);
    tick();
    assert.equal(host.autoAllows.length, 0);
    assert.ok(host._state.pendingPermission, 'permission panel armed');
    assert.equal(host._state.pendingPermission.source, 'pty');
    assert.equal(host._state.ptyPromptHistory[0].status, 'pty-routed');
    assert.equal(host._state.ptyPrompt, null, 'no active bubble prompt for routed danger');
  });

  it('resetBufferAfterSubmit empties the buffer and cancels an armed detection', async () => {
    const host = makeHost();
    const ctl = new PtyPromptController(host);
    ctl.appendData(NUMBERED_PROMPT);
    ctl.resetBufferAfterSubmit(); // before the 200ms debounce fires
    tick();
    assert.equal(host._state.ptyPrompt, null, 'cancelled detection never fired');
    assert.equal(ctl.getBuffer(), '');
  });

  it('dismiss guards: ordinary prompt dismisses (clearing pendingPtyPlan); ask-submitting blocks dismissal', async () => {
    // Ordinary prompt, then the buffer moves on (submit reset) and only
    // non-matching output arrives -> dismissed + pendingPtyPlan defensively cleared.
    const host = makeHost({ state: { pendingPtyPlan: { id: 'p1' } } });
    const ctl = new PtyPromptController(host);
    ctl.appendData(NUMBERED_PROMPT);
    tick();
    ctl.resetBufferAfterSubmit();
    ctl.appendData('\nplain output with no prompt structure\n');
    tick();
    assert.equal(host._state.ptyPrompt, null);
    assert.equal(host._state.pendingPtyPlan, null);
    assert.equal(host._state.ptyPromptHistory[0].status, 'dismissed');

    // Same sequence while an ask submission is in flight -> NOT dismissed.
    const host2 = makeHost({ askSubmitting: true });
    const ctl2 = new PtyPromptController(host2);
    ctl2.appendData(NUMBERED_PROMPT);
    tick();
    ctl2.resetBufferAfterSubmit();
    ctl2.appendData('\nplain output with no prompt structure\n');
    tick();
    assert.equal(host2._state.ptyPrompt?.question, 'Pick one?', 'kept during ask submit');
  });

  it('plan-approval and dangerous prompts survive a no-match buffer (explicit-answer-only guards)', async () => {
    // Plan-approval prompt stays active until explicitly answered.
    const host = makeHost();
    const ctl = new PtyPromptController(host);
    ctl.appendData('Would you like to proceed?\n  ❯ 1. Yes, and auto-accept edits\n    2. Yes, and manually approve edits\n    3. No, keep planning\n');
    tick();
    assert.ok(host._state.ptyPrompt, 'plan prompt active');
    ctl.resetBufferAfterSubmit();
    ctl.appendData('\nplain output with no prompt structure\n');
    tick();
    assert.ok(host._state.ptyPrompt, 'plan-approval prompt NOT dismissed by no-match output');
  });

  it('false-positive questions are hard-skipped (no dismiss of the active prompt)', async () => {
    const host = makeHost();
    const ctl = new PtyPromptController(host);
    ctl.appendData(NUMBERED_PROMPT);
    tick();
    assert.ok(host._state.ptyPrompt);
    // A path-looking "question" is a false positive: hard return, active prompt untouched.
    ctl.resetBufferAfterSubmit();
    ctl.appendData('~/projects/cc-viewer/src/components/?\n  ❯ 1. a\n    2. b\n');
    tick();
    assert.equal(host._state.ptyPrompt.question, 'Pick one?');
  });

  it('dispose cancels a pending detection', async () => {
    const host = makeHost();
    const ctl = new PtyPromptController(host);
    ctl.appendData(NUMBERED_PROMPT);
    ctl.dispose();
    tick();
    assert.equal(host._state.ptyPrompt, null);
  });
});
