import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
});
