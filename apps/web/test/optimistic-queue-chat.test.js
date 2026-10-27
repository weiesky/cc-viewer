import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Track every view created so afterEach can disarm its sweep timer — otherwise the
// real 30s timeouts armed by _handleQueueSendNow linger across tests (harmless under
// --test-force-exit, but they make test order matter and pollute coverage).
const liveViews = new Set();

const here = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(here, '..');
const BUNDLE_DIR = join(WEB_ROOT, 'node_modules', '.cache', 'ccv-optimistic-queue-test');
const BUNDLE = join(BUNDLE_DIR, `ChatView-${process.pid}.mjs`);

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
    name: 'ccv-optimistic-queue-stubs',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        const path = args.path;
        if (/\.(css|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|eot|mp3|wav|ogg)$/.test(path.split('?')[0])) return { path, namespace: 'asset' };
        if (path.startsWith('.') || path.startsWith('/') || path.startsWith('node:')) return null;
        if (path === 'react' || path === 'react-dom' || path === 'react-dom/client' || path.startsWith('react/')) return null;
        if (path === './optimisticQueueMessage' && args.importer.endsWith('ChatView.jsx')) return null;
        if (path === '@ccv/core/contentFilter' || path === '@ccv/core/queued-prompt') return null;
        return { path, namespace: 'stub' };
      });
      build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: stub, loader: 'js' }));
      build.onLoad({ filter: /.*/, namespace: 'asset' }, (args) => ({
        contents: /\.css$/.test(args.path) ? 'export default new Proxy({}, { get: () => "" });' : 'export default "";', loader: 'js',
      }));
    },
  };
  const result = await esbuild.build({
    entryPoints: [join(WEB_ROOT, 'src/components/chat/ChatView.jsx')], bundle: true, format: 'esm', platform: 'browser', write: false,
    jsx: 'automatic', loader: { '.jsx': 'jsx', '.js': 'jsx' }, plugins: [plugin], logLevel: 'silent',
  });
  mkdirSync(BUNDLE_DIR, { recursive: true });
  writeFileSync(BUNDLE, result.outputFiles[0].contents);
}

let ChatView;
function makeView() {
  const events = [];
  const view = new ChatView({
    cliMode: true, sdkMode: true, mainAgentSessions: [], requests: [], thinkingRequests: [], preferences: {},
    viewProject: 'project-a', viewInstance: 'instance-a', attachedSid: 'session-a',
  });
  view.setState = (update, callback) => {
    const patch = typeof update === 'function' ? update(view.state, view.props) : update;
    view.state = { ...view.state, ...patch };
    callback?.();
  };
  view.context = {
    send: (frame) => { events.push(frame); return true; },
    isOpen: () => true,
    addMessageHandler: () => () => {},
    addStateListener: () => () => {},
  };
  view.setState({ visibleCount: 100 });
  view.scrollToBottom = () => events.push('scroll');
  view._bindInputStackRO = () => {};
  view._bindChatScrollbarRO = () => {};
  view._attachMdCodeProbe = () => {};
  view._maybeScheduleLocalLogAutoFill = () => {};
  view._stickyController = { bind() {}, startSmoothFollow() {}, resetUserScrollState() {}, isUserScrolling: () => false };
  liveViews.add(view);
  return { view, events };
}

function updateSessions(view, sessions) {
  const previousProps = view.props;
  const previousState = view.state;
  view.props = { ...view.props, mainAgentSessions: sessions };
  view.componentDidUpdate(previousProps, previousState);
  view.setState({ allItems: view.buildAllItems() });
}

function userTexts(items) {
  return (Array.isArray(items) ? items : [items])
    .filter((item) => item?.props?.role === 'user' && typeof item.props.text === 'string')
    .map((item) => item.props.text);
}

before(async () => {
  globalThis.window = globalThis;
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node' }, configurable: true });
  globalThis.location = { search: '', pathname: '/', href: 'http://localhost/', hash: '' };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.document = { documentElement: { style: { setProperty() {}, removeProperty() {} }, getAttribute: () => null, setAttribute() {} }, querySelector: () => null, addEventListener() {}, removeEventListener() {} };
  globalThis.WebSocket = { OPEN: 1, CLOSED: 3 };
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  await buildChatView();
  ChatView = (await import(pathToFileURL(BUNDLE).href)).default;
});

afterEach(() => {
  for (const view of liveViews) {
    try { view._clearOptimisticQueueSweepTimer(); } catch {}
    liveViews.delete(view);
  }
});

describe('ChatView send-now optimistic conversation behavior', () => {
  it('renders immediately, reconciles real text, and restores queue on pre-push failure', () => {
    const { view, events } = makeView();
    view.setState({ queuedMessages: [{ id: 'q1', text: 'follow up', status: 'queued', ts: 1 }] });
    view._handleQueueSendNow(view.state.queuedMessages[0]);
    assert.deepEqual(events, ['scroll', { type: 'queue-send-now', id: 'q1', project: 'project-a', instanceKey: 'instance-a' }]);
    assert.equal(view.state.optimisticQueueMessages[0].text, 'follow up');
    assert.deepEqual(view.state.optimisticQueueMessages.map((item) => item.text), ['follow up']);

    view._onTerminalWsMessage({ type: 'queue-state', project: 'project-a', instanceKey: 'instance-a', items: [] });
    assert.equal(view.state.optimisticQueueMessages.length, 1, 'accepted is not proof that the prompt has rendered');
    updateSessions(view, [{ messages: [{ role: 'user', content: 'follow up' }], response: null }]);
    assert.equal(view.state.optimisticQueueMessages.length, 0);
    assert.deepEqual(userTexts(view.state.allItems), ['follow up'], 'real prompt replaces rather than duplicates the placeholder');

    view.setState({ queuedMessages: [{ id: 'q2', text: 'retry', status: 'queued', ts: 2 }] });
    view._handleQueueSendNow(view.state.queuedMessages[0]);
    view._onTerminalWsMessage({ type: 'queue-state', project: 'project-a', instanceKey: 'instance-a', items: [{ id: 'q2', text: 'retry', status: 'dispatching', ts: 2 }] });
    view._onTerminalWsMessage({ type: 'queue-state', project: 'project-a', instanceKey: 'instance-a', items: [{ id: 'q2', text: 'retry', status: 'queued', ts: 2 }] });
    assert.equal(view.state.optimisticQueueMessages.length, 0);
    assert.equal(view.state.queuedMessages[0].id, 'q2');
  });

  it('keeps identical old history distinct and scopes placeholders to the view', () => {
    const { view } = makeView();
    const history = [{ messages: [{ role: 'user', content: 'same' }], response: null }];
    view.props = { ...view.props, mainAgentSessions: history };
    view._handleQueueSendNow({ id: 'q1', text: 'same', status: 'queued', ts: 1 });
    updateSessions(view, history);
    assert.equal(view.state.optimisticQueueMessages.length, 1, 'historical identical text cannot acknowledge a new send');
    updateSessions(view, [{ messages: [{ role: 'user', content: 'same' }, { role: 'user', content: 'same' }], response: null }]);
    assert.equal(view.state.optimisticQueueMessages.length, 0);

    view._handleQueueSendNow({ id: 'q2', text: 'other session', status: 'queued', ts: 2 });
    const previousProps = view.props;
    const previousState = view.state;
    view.props = { ...view.props, viewInstance: 'instance-b', attachedSid: 'session-b', mainAgentSessions: [] };
    view.componentDidUpdate(previousProps, previousState);
    assert.equal(view.state.optimisticQueueMessages.length, 0);
  });

  it('renders SDK block-array queued prompts once across incremental growth', () => {
    const { view } = makeView();
    const prompt = [{ type: 'text', text: '[Request interrupted by user]\nSDK follow up' }];
    const session = {
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'working' }] }],
      response: null,
      _ccvQueuedPrompts: [{ content: prompt, afterIndex: 0, _ccvSourceId: 'q-array' }],
    };
    updateSessions(view, [session]);
    assert.deepEqual(userTexts(view.state.allItems), ['SDK follow up']);
    assert.equal(prompt[0].text, '[Request interrupted by user]\nSDK follow up', 'raw transcript content is unchanged');

    session.messages.push({ role: 'assistant', content: [{ type: 'text', text: 'next' }] });
    updateSessions(view, [session]);
    assert.deepEqual(userTexts(view.state.allItems), ['SDK follow up'], 'next assistant does not duplicate the cached prompt');

    session.messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'done' }] });
    updateSessions(view, [session]);
    assert.deepEqual(userTexts(view.state.allItems), ['SDK follow up'], 'tool result growth also preserves one prompt');
  });

  it('acknowledges the wire envelope, cleans up on close, and honors target-gone ids', () => {
    const { view } = makeView();
    view._handleQueueSendNow({ id: 'q-wire', text: 'wire follow up', status: 'queued', ts: 1 });
    const content = 'The user sent a new message while you were working:\nwire follow up\n\nIMPORTANT: After completing your current task, you MUST address the user\'s message above. Do not ignore it.';
    updateSessions(view, [{ messages: [{ role: 'system', content }], response: null }]);
    assert.equal(view.state.optimisticQueueMessages.length, 0);

    view._handleQueueSendNow({ id: 'q-gone', text: 'gone', status: 'queued', ts: 2 });
    view._onTerminalWsMessage({ type: 'queue-rejected', reason: 'target-gone', id: 'q-gone', project: 'project-a', instanceKey: 'instance-a' });
    assert.equal(view.state.optimisticQueueMessages.length, 0);

    view._handleQueueSendNow({ id: 'q-close', text: 'close', status: 'queued', ts: 3 });
    view._onTerminalWsState('close');
    assert.equal(view.state.optimisticQueueMessages.length, 0);
  });

  it('stamps sentAt and clears the placeholder when the accepted dispatch leaves the snapshot', () => {
    const { view } = makeView();
    view._handleQueueSendNow({ id: 'q1', text: 'follow up', status: 'queued', ts: 1 });
    assert.equal(typeof view.state.optimisticQueueMessages[0].sentAt, 'number');

    view._onTerminalWsMessage({ type: 'queue-state', project: 'project-a', instanceKey: 'instance-a', items: [{ id: 'q1', text: 'follow up', status: 'dispatching', ts: 1 }] });
    assert.equal(view.state.optimisticQueueMessages.length, 1);
    assert.equal(view.state.optimisticQueueMessages[0].dispatchingSeen, true);

    view._onTerminalWsMessage({ type: 'queue-state', project: 'project-a', instanceKey: 'instance-a', items: [] });
    assert.equal(view.state.optimisticQueueMessages.length, 0, 'accepted dispatch removes the placeholder immediately');
    view._clearOptimisticQueueSweepTimer();
  });

  it('clears the accepted dispatch in a pinned view where text acknowledgement is disabled', () => {
    const { view } = makeView();
    view.props = { ...view.props, sessionUpperBoundTs: 'next-session', mainAgentSessions: [{ messages: [], response: null }] };
    view._handleQueueSendNow({ id: 'q1', text: 'follow up', status: 'queued', ts: 1 });

    view._onTerminalWsMessage({ type: 'queue-state', project: 'project-a', instanceKey: 'instance-a', items: [{ id: 'q1', text: 'follow up', status: 'dispatching', ts: 1 }] });
    view._onTerminalWsMessage({ type: 'queue-state', project: 'project-a', instanceKey: 'instance-a', items: [] });
    assert.equal(view.state.optimisticQueueMessages.length, 0, 'pinned view still clears on dispatch acceptance');
    view._clearOptimisticQueueSweepTimer();
  });

  it('drops an unacknowledged placeholder after the bounded ack timeout', () => {
    const { view } = makeView();
    view._handleQueueSendNow({ id: 'q1', text: 'follow up', status: 'queued', ts: 1 });
    const sentAt = view.state.optimisticQueueMessages[0].sentAt;

    view._sweepExpiredOptimisticQueueMessages(sentAt + 1000);
    assert.equal(view.state.optimisticQueueMessages.length, 1, 'still within the ack window');

    view._sweepExpiredOptimisticQueueMessages(sentAt + 30001);
    assert.equal(view.state.optimisticQueueMessages.length, 0, 'past the window the placeholder is dropped');
    view._clearOptimisticQueueSweepTimer();
  });

  it('acknowledges a prompt that renders in a non-last displayed session', () => {
    const { view } = makeView();
    const first = { messages: [], response: null };
    const second = { messages: [], response: null };
    // Sync _prevSessions first so the post-send-now updateSessions takes the reconcile
    // path (same session object references) instead of the session-switch clear.
    updateSessions(view, [first, second]);
    view._handleQueueSendNow({ id: 'q1', text: 'follow up', status: 'queued', ts: 1 });
    assert.equal(view.state.optimisticQueueMessages.length, 1);

    first.messages.push({ role: 'user', content: 'follow up' });
    updateSessions(view, [first, second]);
    assert.equal(view.state.optimisticQueueMessages.length, 0, 'text in a non-last session still acks the placeholder');
    view._clearOptimisticQueueSweepTimer();
  });

  it('baseline aggregates across all displayed sessions, not just the last', () => {
    const { view } = makeView();
    // Seed the FIRST (non-last) session with an identical historical prompt. If the
    // baseline only scanned the last session, the captured count would be 0 — and a
    // single new occurrence anywhere would falsely ack this fresh send. The all-sessions
    // baseline (1 here) is what prevents that.
    const first = { messages: [{ role: 'user', content: 'same' }], response: null };
    const second = { messages: [], response: null };
    // Run one updateSessions first so _prevSessions syncs to these session objects —
    // otherwise the NEXT updateSessions (after send-now) takes the session-switch
    // clear branch (sessionsActuallyChanged) and wipes the placeholder for the wrong
    // reason, defeating the point of this test.
    updateSessions(view, [first, second]);
    view._handleQueueSendNow({ id: 'q1', text: 'same', status: 'queued', ts: 1 });
    assert.equal(view.state.optimisticQueueMessages.length, 1);
    assert.equal(view.state.optimisticQueueMessages[0].baselineTextCount, 1, 'baseline counts the historical copy in the non-last session');

    // An unrelated re-render with no new text: the placeholder must survive. Same
    // session objects → sessionsActuallyChanged=false → reconcile path, not the
    // session-switch clear.
    updateSessions(view, [first, second]);
    assert.equal(view.state.optimisticQueueMessages.length, 1, 'historical copy alone cannot ack the new send');

    // The real echo lands (anywhere in the displayed sessions): count rises to 2,
    // exceeding the aggregated baseline of 1 — placeholder clears via text-ack.
    second.messages.push({ role: 'user', content: 'same' });
    updateSessions(view, [first, second]);
    assert.equal(view.state.optimisticQueueMessages.length, 0, 'a new copy above the aggregated baseline acks the send');
    view._clearOptimisticQueueSweepTimer();
  });
});

describe('ChatView optimistic queue sweep timer', () => {
  it('arms the sweep on send-now and disarms when the placeholder is accepted', (t) => {
    const { view } = makeView();
    view._handleQueueSendNow({ id: 'q1', text: 'a', status: 'queued', ts: 1 });
    assert.ok(view._optimisticQueueSweepTimer, 'send-now arms the sweep timer');

    view._onTerminalWsMessage({ type: 'queue-state', project: 'project-a', instanceKey: 'instance-a', items: [{ id: 'q1', text: 'a', status: 'dispatching', ts: 1 }] });
    view._onTerminalWsMessage({ type: 'queue-state', project: 'project-a', instanceKey: 'instance-a', items: [] });
    assert.equal(view.state.optimisticQueueMessages.length, 0);
    assert.equal(view._optimisticQueueSweepTimer, null, 'acceptance path disarms the sweep timer');
  });

  it('keeps the timer armed while a placeholder survives a partial sweep', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const { view } = makeView();
    view._handleQueueSendNow({ id: 'q1', text: 'a', status: 'queued', ts: 1 });
    const firstTimer = view._optimisticQueueSweepTimer;
    assert.ok(firstTimer, 'first placeholder arms the timer');

    // A second placeholder arrives 1s later; the guard must NOT double-arm.
    t.mock.timers.tick(1000);
    view._handleQueueSendNow({ id: 'q2', text: 'b', status: 'queued', ts: 2 });
    assert.equal(view._optimisticQueueSweepTimer, firstTimer, 'no double-arm while armed');

    // Advance to q1's deadline (T0+30s): the armed timer fires, q1 expires, q2 (1s
    // younger) survives, and the sweep re-arms a fresh handle for q2's remaining 1s.
    t.mock.timers.tick(29000);
    assert.deepEqual(view.state.optimisticQueueMessages.map((item) => item.id), ['q2'], 'partial sweep drops only the expired placeholder');
    assert.ok(view._optimisticQueueSweepTimer, 'timer re-armed for the surviving placeholder');
    assert.notEqual(view._optimisticQueueSweepTimer, firstTimer, 're-arm uses a fresh handle');

    // Tick past q2's own deadline: list empties and the timer self-clears.
    t.mock.timers.tick(1000);
    assert.equal(view.state.optimisticQueueMessages.length, 0);
    assert.equal(view._optimisticQueueSweepTimer, null, 'no timer survives an empty list');
    t.mock.timers.reset();
  });

  it('clears the timer when the last placeholder is removed via queue-rejected', () => {
    const { view } = makeView();
    view._handleQueueSendNow({ id: 'q1', text: 'a', status: 'queued', ts: 1 });
    assert.ok(view._optimisticQueueSweepTimer);

    view._onTerminalWsMessage({ type: 'queue-rejected', reason: 'queue-full', id: 'q1', project: 'project-a', instanceKey: 'instance-a' });
    assert.equal(view.state.optimisticQueueMessages.length, 0);
    assert.equal(view._optimisticQueueSweepTimer, null, 'queue-rejected disarms the sweep timer');
  });

  it('clears the timer on view switch and on ws close', () => {
    const { view } = makeView();
    view._handleQueueSendNow({ id: 'q1', text: 'a', status: 'queued', ts: 1 });
    assert.ok(view._optimisticQueueSweepTimer);
    const previousProps = view.props;
    const previousState = view.state;
    view.props = { ...view.props, viewInstance: 'instance-b', attachedSid: 'session-b', mainAgentSessions: [] };
    view.componentDidUpdate(previousProps, previousState);
    assert.equal(view._optimisticQueueSweepTimer, null, 'view switch disarms');

    view._handleQueueSendNow({ id: 'q2', text: 'b', status: 'queued', ts: 2 });
    assert.ok(view._optimisticQueueSweepTimer);
    view._onTerminalWsState('close');
    assert.equal(view._optimisticQueueSweepTimer, null, 'ws close disarms');
  });
});
