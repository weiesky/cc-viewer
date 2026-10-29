import { describe, it, before, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(here, '..');
const BUNDLE_DIR = join(WEB_ROOT, 'node_modules', '.cache', 'ccv-plan-auto-approve-test');
const BUNDLE = join(BUNDLE_DIR, `ChatView-${process.pid}.mjs`);

// Match the existing response-thinking ChatView harness: real application modules,
// inert third-party UI dependencies, and a directly constructible ChatView.
function collectStubExportNames(root) {
  const names = new Set();
  const visit = (dir) => {
    for (const entry of readdirSync(dir)) {
      const file = join(dir, entry);
      if (statSync(file).isDirectory()) visit(file);
      else if (/\.[jt]sx?$/.test(entry)) {
        const src = readFileSync(file, 'utf8');
        const add = (body) => body.split(',').forEach((part) => {
          const name = part.trim().split(/\s+as\s+/).pop().trim();
          if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
        });
        for (const match of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"][^'"]+['"]/gs)) add(match[1]);
        for (const match of src.matchAll(/export\s*\{([^}]*)\}\s*from\s*['"][^'"]+['"]/gs)) add(match[1]);
      }
    }
  };
  visit(join(root, 'src'));
  return [...names];
}

async function buildChatView() {
  const appRequire = createRequire(join(WEB_ROOT, 'package.json'));
  const esbuildPath = createRequire(appRequire.resolve('vite')).resolve('esbuild');
  const esbuild = await import(pathToFileURL(esbuildPath).href);
  const names = new Set(collectStubExportNames(WEB_ROOT));
  names.add('tags');
  const stub = [
    'const h = () => null;',
    'const S = new Proxy(function(){}, { apply:()=>S, construct:()=>({}), get:()=>S });',
    'export default S;',
    ...[...names].map((name) => `export const ${name} = S;`),
  ].join('\n');
  const plugin = {
    name: 'ccv-plan-auto-approve-stubs',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        const path = args.path;
        if (/\.(css|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|eot|mp3|wav|ogg)$/.test(path.split('?')[0])) return { path, namespace: 'asset' };
        if (path.startsWith('.') || path.startsWith('/') || path.startsWith('node:')) return null;
        if (path === 'react' || path === 'react-dom' || path === 'react-dom/client' || path.startsWith('react/')) return null;
        return { path, namespace: 'stub' };
      });
      build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: stub, loader: 'js' }));
      build.onLoad({ filter: /.*/, namespace: 'asset' }, (args) => ({
        contents: /\.css$/.test(args.path) ? 'export default new Proxy({}, { get: () => "" });' : 'export default "";',
        loader: 'js',
      }));
    },
  };
  const result = await esbuild.build({
    entryPoints: [join(WEB_ROOT, 'src/components/chat/ChatView.jsx')],
    bundle: true, format: 'esm', platform: 'browser', write: false,
    jsx: 'automatic', loader: { '.jsx': 'jsx', '.js': 'jsx' }, plugins: [plugin], logLevel: 'silent',
  });
  mkdirSync(BUNDLE_DIR, { recursive: true });
  writeFileSync(BUNDLE, result.outputFiles[0].contents);
}

let ChatView;
const sent = [];
const sharedProps = {
  cliMode: true,
  sdkMode: true,
  mainAgentSessions: [],
  requests: [],
  thinkingRequests: [],
  preferences: {},
  viewProject: 'project-a',
  viewInstance: 'instance-a',
};

// Bubble spy — installed per-test, records every onPendingPtyPlan payload (or null clear).
let ptyPlanBubble;
function watchPlanBubble(view) {
  ptyPlanBubble = [];
  view.props = { ...view.props, onPendingPtyPlan: (data) => ptyPlanBubble.push(data) };
  return ptyPlanBubble;
}

function makeView(planAutoApproveSeconds) {
  const view = new ChatView({ ...sharedProps, planAutoApproveSeconds });
  view.context = {
    send: (message) => { sent.push(message); return true; },
    isOpen: () => true,
    addMessageHandler: () => () => {},
    addStateListener: () => () => {},
  };
  view.setState = (update, callback) => {
    const patch = typeof update === 'function' ? update(view.state, view.props) : update;
    view.state = { ...view.state, ...patch };
    callback?.();
  };
  // These tests exercise the actual plan lifecycle, not unrelated browser layout work.
  view._bindInputStackRO = () => {};
  view._bindChatScrollbarRO = () => {};
  view._attachMdCodeProbe = () => {};
  view._maybeScheduleLocalLogAutoFill = () => {};
  view._stickyController = { bind() {}, startSmoothFollow() {}, resetUserScrollState() {}, isUserScrolling() { return false; }, refreshFollowTarget() {}, writeUnderLock() {} };
  return view;
}

function update(view, previousState = view.state) {
  const prevState = previousState;
  view.componentDidUpdate(view.props, prevState);
}

function receivePlan(view, id = 'plan-1', owner = {}) {
  const previousState = view.state;
  view._onTerminalWsMessage({
    type: 'sdk-plan-pending', id, input: { plan: 'test plan' },
    cwd: '/work/project-a', instanceKey: 'instance-a', ...owner,
  });
  update(view, previousState);
}

function changeView(view, project, instanceKey) {
  const previousProps = view.props;
  const previousState = view.state;
  view.props = { ...view.props, viewProject: project, viewInstance: instanceKey };
  view.componentDidUpdate(previousProps, previousState);
}

function changeSeconds(view, seconds) {
  const previousProps = view.props;
  const previousState = view.state;
  view.props = { ...view.props, planAutoApproveSeconds: seconds };
  view.componentDidUpdate(previousProps, previousState);
}

before(async () => {
  globalThis.window = globalThis;
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node' }, configurable: true });
  globalThis.location = { search: '', pathname: '/', href: 'http://localhost/', hash: '' };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.document = {
    documentElement: { style: { setProperty() {}, removeProperty() {} }, getAttribute: () => null, setAttribute() {} },
    createElement: () => ({ style: {}, setAttribute() {}, removeAttribute() {} }),
    body: { appendChild() {}, removeChild() {} },
    querySelector: () => null,
  };
  globalThis.WebSocket = { OPEN: 1, CLOSED: 3 };
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  await buildChatView();
  ChatView = (await import(pathToFileURL(BUNDLE).href)).default;
});

afterEach(() => {
  sent.length = 0;
  mock.timers.reset();
  mock.restoreAll();
});

describe('ChatView SDK plan auto-approval runtime behavior', () => {
  it('keeps manual approval when the preference is off', () => {
    const view = makeView(0);
    receivePlan(view);
    assert.equal(view._planAutoTimer, null);
    assert.equal(view.state.pendingPlanApproval.id, 'plan-1');
    assert.deepEqual(sent, []);
  });

  it('answers immediately in instant mode without starting a timer', () => {
    const view = makeView(-1);
    receivePlan(view);
    assert.deepEqual(sent, [{ type: 'sdk-plan-answer', id: 'plan-1', approve: true }]);
    assert.equal(view.state.pendingPlanApproval, null);
    assert.equal(view._planAutoTimer, null);
  });

  it('sends an SDK answer at countdown expiry, never PTY keystrokes', () => {
    mock.timers.enable({ apis: ['setInterval', 'Date'] });
    const view = makeView(3);
    receivePlan(view);
    assert.equal(view.state.planAutoApproveCountdown, 3);
    mock.timers.tick(1000);
    const tickingState = view.state;
    update(view, tickingState);
    assert.equal(view.state.planAutoApproveCountdown, 2);
    assert.deepEqual(sent, []);
    mock.timers.tick(2000);
    const expiryState = view.state;
    update(view, expiryState);
    assert.deepEqual(sent, [{ type: 'sdk-plan-answer', id: 'plan-1', approve: true }]);
    assert.equal(view.state.pendingPlanApproval, null);
    assert.equal(view.state.planAutoApproveCountdown, null);
  });

  it('starts and stops a countdown when the preference changes', () => {
    const view = makeView(0);
    receivePlan(view);
    assert.equal(view._planAutoTimer, null);
    changeSeconds(view, 10);
    assert.equal(view.state.planAutoApproveCountdown, 10);
    changeSeconds(view, 0);
    assert.equal(view._planAutoTimer, null);
    assert.equal(view.state.planAutoApproveCountdown, null);
    // 偏好关闭 = 显式取消：销毁服务端兜底计时器（sdk-plan-auto-cancel），而非仅本地停止。
    assert.deepEqual(sent, [{
      type: 'sdk-plan-auto-cancel', id: 'plan-1',
      cwd: '/work/project-a', project: null, instanceKey: 'instance-a',
    }]);
  });

  it('does not re-arm a cancelled plan after disconnect/replay', () => {
    mock.timers.enable({ apis: ['setInterval', 'Date'] });
    const view = makeView(3);
    receivePlan(view);
    view.cancelPlanAutoApprove();
    sent.length = 0; // Cancellation is a new WS control message, not an approval answer.
    assert.equal(view.state.planAutoApproveCountdown, null);
    const previousState = view.state;
    view.setState({ pendingPlanApproval: null });
    update(view, previousState);
    receivePlan(view);
    mock.timers.tick(5000);
    assert.deepEqual(sent, []);
    assert.equal(view.state.pendingPlanApproval.id, 'plan-1');
  });

  it('counts down from the server deadline (autoApproveAt), not a fresh local countdown', () => {
    mock.timers.enable({ apis: ['setInterval', 'Date'] });
    const view = makeView(30);
    // 服务端 1s 前到达的请求，N=30 → autoApproveAt = now + 29s：重放显示剩余而非满额 30。
    const deadline = Date.now() + 29_000;
    receivePlan(view, 'plan-1', { autoApproveAt: deadline, autoApproveSeconds: 30 });
    assert.equal(view.state.planAutoApproveCountdown, 29);
    mock.timers.tick(2000);
    update(view, view.state);
    assert.equal(view.state.planAutoApproveCountdown, 27);
    // 到点（deadline 处）自动批准
    mock.timers.tick(27_000);
    update(view, view.state);
    assert.deepEqual(sent, [{ type: 'sdk-plan-answer', id: 'plan-1', approve: true }]);
  });

  it('a replayed autoCancelled plan never arms the countdown', () => {
    mock.timers.enable({ apis: ['setInterval', 'Date'] });
    const view = makeView(10);
    receivePlan(view, 'plan-1', { autoApproveAt: Date.now() + 10_000, autoApproveSeconds: 10, autoCancelled: true });
    assert.equal(view._planAutoTimer, null);
    assert.equal(view.state.planAutoApproveCountdown, null);
    assert.equal(view._planAutoCancelled.has('plan-1'), true);
    mock.timers.tick(20_000);
    update(view, view.state);
    assert.equal(sent.some((m) => m.type === 'sdk-plan-answer'), false);
  });

  it('re-arms the countdown on WS open after the pending plan survived a close', () => {
    mock.timers.enable({ apis: ['setInterval', 'Date'] });
    const view = makeView(5);
    receivePlan(view);
    // 模拟 ws 断开后再开：open 重武装仍在 pending 的计划
    view._clearPlanAutoApprove();
    assert.equal(view._planAutoTimer, null);
    view._onTerminalWsState('open');
    assert.ok(view._planAutoTimer, 'open must re-arm the countdown');
    assert.equal(view.state.planAutoApproveCountdown, 5);
  });

  it('does not re-arm on open after the plan was resolved', () => {
    mock.timers.enable({ apis: ['setInterval', 'Date'] });
    const view = makeView(5);
    receivePlan(view);
    const prev = view.state;
    view.setState({ pendingPlanApproval: null });
    update(view, prev);
    view._onTerminalWsState('open');
    assert.equal(view._planAutoTimer, null);
  });

  it('does not approve a replayed background plan before view hydration', () => {
    const view = makeView(-1);
    view.props = { ...view.props, viewProject: null, viewInstance: null };
    receivePlan(view, 'background-plan', { cwd: '/work/background', instanceKey: 'background-instance' });
    assert.equal(sent.some((message) => message.type === 'sdk-plan-answer'), false);
    const previousProps = view.props;
    const previousState = view.state;
    view.props = { ...view.props, viewProject: 'project-a', viewInstance: 'instance-a' };
    view.componentDidUpdate(previousProps, previousState);
    assert.equal(view.state.pendingPlanApproval, null, 'the mismatched card must be dismissed after hydration');
    assert.deepEqual(sent, []);
  });

  it('keeps an explicit cancellation after another plan activates and this plan replays', () => {
    mock.timers.enable({ apis: ['setInterval', 'Date'] });
    const view = makeView(3);
    receivePlan(view, 'plan-a');
    view.cancelPlanAutoApprove();
    sent.length = 0;
    receivePlan(view, 'plan-b');
    receivePlan(view, 'plan-a');
    mock.timers.tick(5000);
    assert.equal(sent.some((message) => message.type === 'sdk-plan-answer'), false);
    assert.equal(view._planAutoCancelled.has('plan-a'), true);
  });

  it('synchronizes cancellation to other viewers without resolving the plan', () => {
    const view = makeView(3);
    receivePlan(view);
    view.cancelPlanAutoApprove();
    assert.deepEqual(sent, [{
      type: 'sdk-plan-auto-cancel', id: 'plan-1', cwd: '/work/project-a',
      project: null, instanceKey: 'instance-a',
    }]);
    const other = makeView(3);
    other._onTerminalWsMessage({
      type: 'sdk-plan-auto-cancel', id: 'plan-1', cwd: '/work/project-a', instanceKey: 'instance-a',
    });
    receivePlan(other);
    assert.equal(other._planAutoTimer, null);
    assert.equal(other.state.pendingPlanApproval.id, 'plan-1');
  });

  it('cancels the old timer when another client resolves the plan', () => {
    mock.timers.enable({ apis: ['setInterval', 'Date'] });
    const view = makeView(3);
    receivePlan(view);
    const previousState = view.state;
    view._onTerminalWsMessage({ type: 'sdk-plan-resolved', id: 'plan-1' });
    update(view, previousState);
    assert.equal(view._planAutoTimer, null);
    assert.equal(view.state.planAutoApproveCountdown, null);
    mock.timers.tick(5000);
    assert.deepEqual(sent, []);
    assert.equal(view.state.pendingPlanApproval, null);
  });

  it('honors a switch to instant approval during an active countdown', () => {
    mock.timers.enable({ apis: ['setInterval', 'Date'] });
    const view = makeView(30);
    receivePlan(view);
    changeSeconds(view, -1);
    assert.deepEqual(sent, [{ type: 'sdk-plan-answer', id: 'plan-1', approve: true }]);
    assert.equal(view._planAutoTimer, null);
  });

  it('cancels a countdown from the composer Escape without affecting slash-menu keys', () => {
    const view = makeView(10);
    view.state = { ...view.state, pendingPlanApproval: { id: 'plan-1', cwd: '/work/project-a', instanceKey: 'instance-a' }, planAutoApproveCountdown: 10 };
    view.state.slashMenu = { ...view.state.slashMenu, open: true };
    const keyEvent = { key: 'a', keyCode: 65, preventDefault() {} };
    view.handleInputKeyDown(keyEvent);
    assert.equal(view._planAutoCancelled.has('plan-1'), false, 'ordinary menu input must not cancel');
    const enterEvent = { key: 'Enter', keyCode: 13, preventDefault() {} };
    view.handleInputKeyDown(enterEvent);
    assert.equal(view._planAutoCancelled.has('plan-1'), false, 'Enter must not cancel');
    const escapeEvent = { key: 'Escape', keyCode: 27, preventDefault() {} };
    view.handleInputKeyDown(escapeEvent);
    assert.equal(view.state.slashMenu.open, false, 'the slash menu keeps its own Escape behavior');
    assert.equal(view._planAutoCancelled.has('plan-1'), false, 'closing the menu must not cancel the plan');
    view.handleInputKeyDown(escapeEvent);
    assert.equal(view._planAutoCancelled.has('plan-1'), true, 'Escape after the menu closes cancels the countdown');
  });

  it('stops auto-approval when the plan leaves the current view', () => {
    mock.timers.enable({ apis: ['setInterval', 'Date'] });
    const view = makeView(3);
    receivePlan(view);
    changeView(view, 'project-b', 'instance-b');
    mock.timers.tick(5000);
    assert.deepEqual(sent, []);
    assert.equal(view._planAutoTimer, null);
    assert.equal(view.state.pendingPlanApproval, null, 'a plan from the old view must not remain actionable');
    // A replay in the owning view can surface the same pending request again.
    changeView(view, 'project-a', 'instance-a');
    receivePlan(view);
    mock.timers.tick(3000);
    assert.deepEqual(sent, [{ type: 'sdk-plan-answer', id: 'plan-1', approve: true }]);
  });

  it('does not accept a plan from a different viewed workspace or instance', () => {
    const view = makeView(-1);
    receivePlan(view, 'other-plan', { cwd: '/work/project-b' });
    assert.equal(view.state.pendingPlanApproval, null);
    assert.deepEqual(sent, []);
    receivePlan(view, 'other-instance', { instanceKey: 'instance-b' });
    assert.equal(view.state.pendingPlanApproval, null);
    assert.deepEqual(sent, []);
  });
});

describe('perm-hook-pending instant interception honors the server-stamped level', () => {
  // 服务器为 fork-off / npm publish 硬闸 stamp autoApproveSeconds:0；loopback 客户端的
  // 全局偏好不做 fork 解析，可能与服务器档位不一致。即时直放必须以服务器档位为准。
  function receivePerm(view, owner = {}) {
    view._onTerminalWsMessage({
      type: 'perm-hook-pending', id: 'perm-1', toolName: 'Bash', input: { command: 'ls' },
      cwd: '/work/project-a', instanceKey: 'instance-a', ...owner,
    });
  }

  it('server stamps 0 (fork-off / publish) + client pref -1 → NOT instant-allowed', () => {
    const view = makeView(0);
    view.props = { ...view.props, autoApproveSeconds: -1 }; // 客户端全局免审批
    receivePerm(view, { autoApproveSeconds: 0 });            // 服务器说关（publish / fork-off）
    assert.equal(sent.some((m) => m.type === 'perm-hook-answer'), false, 'server-stamped off must win over the local -1');
    assert.equal(view.state.pendingPermission?.id, 'perm-1', 'request stays pending for a manual decision');
  });

  it('server stamps -1 (authoritative instant) → instant-allowed even if local pref is 3', () => {
    const view = makeView(0);
    view.props = { ...view.props, autoApproveSeconds: 3 };
    receivePerm(view, { autoApproveSeconds: -1 });
    assert.deepEqual(sent, [{ type: 'perm-hook-answer', id: 'perm-1', decision: 'allow' }]);
    assert.equal(view.state.pendingPermission, null);
  });

  it('legacy frame without the stamp falls back to the local pref (-1 → instant)', () => {
    const view = makeView(0);
    view.props = { ...view.props, autoApproveSeconds: -1 };
    receivePerm(view, {}); // 无 autoApproveSeconds 字段（老服务器）
    assert.deepEqual(sent, [{ type: 'perm-hook-answer', id: 'perm-1', decision: 'allow' }]);
  });

  it('a locally cancelled id is never instant-allowed on a replayed frame', () => {
    const view = makeView(0);
    view.props = { ...view.props, autoApproveSeconds: -1 };
    view._permAutoCancelled.add('perm-1'); // 用户此前已取消（断线前没送达服务器）
    receivePerm(view, { autoApproveSeconds: -1 });
    assert.equal(sent.some((m) => m.type === 'perm-hook-answer'), false);
    assert.equal(view.state.pendingPermission?.autoCancelled, false, 'replay w/o autoCancelled keeps it manual');
  });
});

describe('ChatView PTY plan auto-approval lifecycle', () => {
  it('stops the timer and pending plan on a view switch without sending SDK answers', () => {
    mock.timers.enable({ apis: ['setInterval', 'Date'] });
    const view = makeView(3);
    view.props = { ...view.props, sdkMode: false, viewProject: 'project-a' };
    view.state = { ...view.state, pendingPtyPlan: { id: 'pty-plan' } };
    view._currentLastPendingPlanId = 'pty-plan';
    view._lastObservedLpid = 'pty-plan';
    const ptyCalls = [];
    view.handlePromptOptionClick = (number) => { ptyCalls.push(number); };
    const previousState = { ...view.state, pendingPtyPlan: null };
    update(view, previousState);
    view._startPlanAutoApprove('pty-plan', 'pty');
    assert.equal(view.state.planAutoApproveCountdown, 3);
    view._currentLastPendingPlanId = null;
    changeView(view, 'project-b', 'instance-b');
    assert.equal(view._planAutoTimer, null);
    assert.equal(view.state.pendingPtyPlan, null);
    mock.timers.tick(5000);
    assert.deepEqual(ptyCalls, []);
    assert.deepEqual(sent, []);
  });
});

describe('ChatView SDK plan modal bubble lifecycle', () => {
  it('bubbles the SDK plan into the ptyPlan modal kind on arrival and clears on resolve', () => {
    const view = makeView(0);
    const bubble = watchPlanBubble(view);
    receivePlan(view, 'plan-1');
    // entered: one bubble carrying the SDK plan nested under `ptyPlan`, with SDK handlers.
    assert.equal(bubble.length, 1);
    assert.equal(bubble[0].ptyPlan.id, 'plan-1');
    assert.equal(typeof bubble[0].handlers.approve, 'function');
    assert.equal(typeof bubble[0].handlers.feedbackSubmit, 'function');
    assert.equal(typeof bubble[0].handlers.cancelAutoApprove, 'function');
    // resolve → left: a single null clear.
    const prev = view.state;
    view._onTerminalWsMessage({ type: 'sdk-plan-resolved', id: 'plan-1' });
    update(view, prev);
    assert.equal(bubble.length, 2);
    assert.equal(bubble[1], null);
  });

  it('does not re-bubble on a WS replay of the same plan id (id-keyed, no modal re-pop)', () => {
    const view = makeView(0);
    const bubble = watchPlanBubble(view);
    receivePlan(view, 'plan-1');
    receivePlan(view, 'plan-1'); // replay: same id, fresh object identity
    // Only the first arrival bubbles; the same-id replay must not re-enter.
    assert.equal(bubble.length, 1);
  });

  it('re-bubbles as a transition when a different plan id replaces the pending one', () => {
    const view = makeView(0);
    const bubble = watchPlanBubble(view);
    receivePlan(view, 'plan-a');
    receivePlan(view, 'plan-b');
    // entered(A) then entered(B) — the merged writer treats A→B as a new entry, not a clear.
    assert.equal(bubble.length, 2);
    assert.equal(bubble[0].ptyPlan.id, 'plan-a');
    assert.equal(bubble[1].ptyPlan.id, 'plan-b');
  });

  it('clears the bubble when sdkMode turns off while a plan is pending', () => {
    const view = makeView(0);
    const bubble = watchPlanBubble(view);
    receivePlan(view, 'plan-1');
    assert.equal(bubble.length, 1);
    // Flip sdkMode off with the plan still in state (mode edge must clear the modal).
    const previousProps = view.props;
    const previousState = view.state;
    view.props = { ...view.props, sdkMode: false };
    view.componentDidUpdate(previousProps, previousState);
    assert.equal(bubble[bubble.length - 1], null);
  });
});

describe('ChatView SDK plan card click routing', () => {
  it('option 1 approves, other direct options reject with empty feedback', () => {
    const view = makeView(0);
    receivePlan(view, 'plan-1');
    view.handleSdkPlanOptionClick(1);
    assert.deepEqual(sent, [{ type: 'sdk-plan-answer', id: 'plan-1', approve: true }]);
    assert.equal(view.state.pendingPlanApproval, null);
  });

  it('option 3 rejects with empty feedback', () => {
    const view = makeView(0);
    receivePlan(view, 'plan-1');
    view.handleSdkPlanOptionClick(3);
    assert.deepEqual(sent, [{ type: 'sdk-plan-answer', id: 'plan-1', approve: false, feedback: '' }]);
  });

  it('approve-with-edits resolves as approve:false + feedback (Claude revises)', () => {
    const view = makeView(0);
    receivePlan(view, 'plan-1');
    view.handleSdkPlanFeedbackSubmit(2, 'please add tests');
    assert.deepEqual(sent, [{ type: 'sdk-plan-answer', id: 'plan-1', approve: false, feedback: 'please add tests' }]);
  });

  it('ignores clicks when no plan is pending', () => {
    const view = makeView(0);
    view.handleSdkPlanOptionClick(1);
    view.handleSdkPlanFeedbackSubmit(2, 'x');
    assert.deepEqual(sent, []);
  });
});

describe('ChatView plan countdown card refresh', () => {
  it('pushes countdown ticks into the cached ExitPlanMode card element prop', () => {
    const view = makeView(0);
    // Seed a cached ExitPlanMode-bearing card element in allItems (assistant role + tool_use).
    const cardEl = {
      props: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'plan-1', name: 'ExitPlanMode', input: {} }],
        planAutoApproveCountdown: null,
      },
    };
    view.setState({ allItems: [cardEl], lastResponseItems: null });
    view._setPlanCountdown(7);
    const refreshed = view.state.allItems[0];
    assert.notEqual(refreshed, cardEl, 'the card element must be cloned, not mutated in place');
    assert.equal(refreshed.props.planAutoApproveCountdown, 7);
    assert.equal(typeof refreshed.props.onCancelPlanAutoApprove, 'function');
    // Clearing the countdown clears the card prop too.
    view._setPlanCountdown(null);
    assert.equal(view.state.allItems[0].props.planAutoApproveCountdown, null);
  });

  it('leaves non-plan cards untouched when refreshing the countdown', () => {
    const view = makeView(0);
    const planCard = { props: { role: 'assistant', content: [{ type: 'tool_use', id: 'p', name: 'ExitPlanMode', input: {} }] } };
    const otherCard = { props: { role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'Bash', input: {} }] } };
    view.setState({ allItems: [planCard, otherCard], lastResponseItems: null });
    view._setPlanCountdown(5);
    assert.equal(view.state.allItems[1], otherCard, 'non-ExitPlanMode cards keep their reference');
  });
});
