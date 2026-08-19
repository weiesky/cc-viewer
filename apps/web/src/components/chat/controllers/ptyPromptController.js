/**
 * PTY prompt-detection controller for ChatView.
 *
 * Host-adapter pattern (see askFlowController.js for the reference contract):
 * a plain dependency-injected class. React state (ptyPrompt, ptyPromptHistory,
 * pendingPermission, pendingPtyPlan) stays in ChatView.state and is only
 * touched through the host; the byte-stream machinery that used to live as
 * ChatView instance fields moves onto this controller as one unit:
 *   - the 4KB rolling _buffer of ANSI-stripped PTY output,
 *   - _ansiCarry (a trailing half-CSI/OSC sequence carried into the next
 *     chunk so stripping always runs on complete sequences; deliberately NOT
 *     reset by clearPrompt — it is byte-stream-level state),
 *   - the 200ms detection debounce timer,
 *   - _current (the synchronous mirror of state.ptyPrompt, avoiding stale
 *     closure reads — exposed to AskFlowController via ChatView's host),
 *   - the instant-auto-approve dedupe signature/timestamp window.
 *
 * No antd/i18n/JSX imports — statically loadable under node:test.
 *
 * host interface (injected by ChatView at construction):
 *  - getState()               -> live this.state
 *  - setState(update, cb?)    -> this.setState (functional updaters passed through)
 *  - isInstantAutoApprove()   -> props.autoApproveSeconds === AUTO_APPROVE_INSTANT
 *  - isAskSubmitting()        -> this._askFlow._askSubmitting (don't dismiss during ask submit)
 *  - permissionAutoAllow(p)   -> this._permission.autoAllow(p)
 *  - scrollToBottom()         -> this.scrollToBottom()
 *  - now()                    -> Date.now() (injectable for dedupe-window tests)
 */
import { stripAnsi, splitTrailingAnsiCarry, detectPromptInBuffer, isFalsePositiveQuestion } from '../../../utils/promptDetect.js';
import { isPlanApprovalPrompt, isDangerousOperationPrompt, parseToolInfoFromBuffer } from '../../../utils/promptClassifier.js';

export const AUTO_ALLOW_PTY_DEDUPE_MS = 2000;
export const PTY_BUFFER_MAX = 4096;
export const DETECT_DEBOUNCE_MS = 200;
export const PTY_HISTORY_CAP = 200;

export class PtyPromptController {
  constructor(host) {
    this.host = host;
    this._buffer = '';
    this._ansiCarry = '';
    this._debounceTimer = null;
    this._current = null; // synchronous mirror of state.ptyPrompt
    this._autoAllowedSig = null;
    this._autoAllowedAt = 0;
  }

  getCurrent() { return this._current; }
  setCurrent(v) { this._current = v; }
  getBuffer() { return this._buffer; }

  clearDebounce() {
    if (this._debounceTimer) { clearTimeout(this._debounceTimer); this._debounceTimer = null; }
  }

  /** Append a PTY output chunk and (debounced) re-run prompt detection. */
  appendData(raw) {
    // ANSI sequences can be cut mid-way by PTY chunking: a trailing unfinished
    // CSI/OSC is carried and re-joined with the next chunk before stripping.
    const [safe, carry] = splitTrailingAnsiCarry(this._ansiCarry + raw);
    this._ansiCarry = carry;
    this._buffer += stripAnsi(safe);
    if (this._buffer.length > PTY_BUFFER_MAX) {
      this._buffer = this._buffer.slice(-PTY_BUFFER_MAX);
    }
    this.clearDebounce();
    this._debounceTimer = setTimeout(() => this._detectPrompt(), DETECT_DEBOUNCE_MS);
  }

  /** Reset after a prompt answer was submitted: drop the buffer and any armed detection. */
  resetBufferAfterSubmit() {
    this._buffer = '';
    this.clearDebounce();
  }

  /** Full prompt clear (terminal exit etc.). The ANSI carry survives on purpose. */
  clearPrompt() {
    this._buffer = '';
    this._current = null;
    this._autoAllowedSig = null; // re-arm the instant-auto-approve dedupe for the next prompt round
    this.clearDebounce();
    if (this.host.getState().ptyPrompt) {
      this.host.setState({ ptyPrompt: null });
    }
  }

  dispose() {
    this.clearDebounce();
  }

  _detectPrompt() {
    const state = this.host.getState();
    const buf = this._buffer.trimEnd();

    // Linear line-scan parser (see utils/promptDetect.js).
    const detected = detectPromptInBuffer(buf);
    const question = detected ? detected.question : null;
    const options = detected ? detected.options : null;

    if (question && options) {
      // Skip false positives (file paths, status bars, timing output). This is
      // a hard return, deliberately distinct from the dismiss branch below.
      if (isFalsePositiveQuestion(question)) return;

      const prev = state.ptyPrompt;
      const prompt = { question, options };

      // SubAgent permission prompt: route to ToolApprovalPanel instead of the
      // danger-approval bubble when hooks don't fire (subAgent tool calls
      // bypass PreToolUse hooks).
      if (isDangerousOperationPrompt(prompt) && !state.pendingPermission) {
        // Instant auto-approve: allow at the source without opening the panel.
        // Structural reentry guard: auto-allow sets no pendingPermission (the
        // old gate), and the 500ms _promptSubmitting window alone can't stop
        // the same prompt re-detecting during slow PTY echo — dedupe by prompt
        // signature within a short window.
        if (this.host.isInstantAutoApprove()) {
          const sig = `${prompt.question}\x00${(prompt.options || []).map(o => o.text).join('\x01')}`;
          const now = this.host.now();
          const dup = this._autoAllowedSig === sig && (now - (this._autoAllowedAt || 0)) < AUTO_ALLOW_PTY_DEDUPE_MS;
          if (!dup) {
            this._autoAllowedSig = sig;
            this._autoAllowedAt = now;
            this.host.permissionAutoAllow({ source: 'pty', ptyPrompt: prompt });
          }
          return;
        }
        const toolInfo = parseToolInfoFromBuffer(this._buffer, question, options);
        const id = `pty_${this.host.now()}_${Math.random().toString(36).slice(2, 8)}`;
        this._current = prompt;
        this.host.setState(s => {
          const history = s.ptyPromptHistory.slice();
          // Mark as 'pty-routed' (not 'active') so renderDangerApproval is not triggered.
          history.push({ ...prompt, status: 'pty-routed', selectedNumber: null, timestamp: new Date(this.host.now()).toISOString() });
          if (history.length > PTY_HISTORY_CAP) history.splice(0, history.length - PTY_HISTORY_CAP);
          return {
            pendingPermission: { id, toolName: toolInfo.toolName, input: toolInfo.input, source: 'pty', ptyPrompt: prompt },
            ptyPromptHistory: history,
          };
        });
        this.host.scrollToBottom();
        return;
      }

      // Same question: only the options changed (cursor moved) — update in
      // place, no new history entry.
      if (prev && prev.question === question) {
        this._current = prompt;
        this.host.setState({ ptyPrompt: prompt });
      } else {
        // New prompt: mark the previous active entry dismissed first.
        this._current = prompt;
        this.host.setState(s => {
          const history = s.ptyPromptHistory.slice();
          if (s.ptyPrompt) {
            const last = history[history.length - 1];
            if (last && last.status === 'active') {
              history[history.length - 1] = { ...last, status: 'dismissed' };
            }
          }
          const ts = new Date(this.host.now()).toISOString();
          history.push({ ...prompt, status: 'active', selectedNumber: null, timestamp: ts });
          if (history.length > PTY_HISTORY_CAP) history.splice(0, history.length - PTY_HISTORY_CAP);
          return { ptyPrompt: prompt, ptyPromptHistory: history };
        });
        this.host.scrollToBottom();
      }
      return;
    }
    // No match — dismiss the active prompt, EXCEPT plan-approval and dangerous
    // prompts (they stay active until explicitly answered) and while an
    // AskUserQuestion submission is in flight.
    if (state.ptyPrompt) {
      if (isPlanApprovalPrompt(state.ptyPrompt)) return;
      if (isDangerousOperationPrompt(state.ptyPrompt)) return;
      if (this.host.isAskSubmitting()) return;
      this._current = null;
      this.host.setState(s => {
        const history = s.ptyPromptHistory.slice();
        const last = history[history.length - 1];
        if (last && last.status === 'active') {
          history[history.length - 1] = { ...last, status: 'dismissed' };
        }
        // Prompt vanished with no match: also defensively clear pendingPtyPlan.
        return { ptyPrompt: null, ptyPromptHistory: history, pendingPtyPlan: null };
      });
    }
  }
}
