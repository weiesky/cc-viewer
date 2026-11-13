import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(here, '..');
const BUNDLE_DIR = join(WEB_ROOT, 'node_modules', '.cache', 'ccv-slow-upstream-test');
const BUNDLE = join(BUNDLE_DIR, `ChatView-${process.pid}.mjs`);
const liveViews = new Set();
const toastEvents = [];

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
    name: 'ccv-slow-upstream-stubs',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        const path = args.path;
        if (/\.(css|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|eot|mp3|wav|ogg)$/.test(path.split('?')[0])) return { path, namespace: 'asset' };
        if (path.startsWith('.') || path.startsWith('/') || path.startsWith('node:')) return null;
        if (path === 'react' || path === 'react-dom' || path === 'react-dom/client' || path.startsWith('react/')) return null;
        if (path === '@ccv/core/contentFilter' || path === '@ccv/core/queued-prompt') return null;
        return { path, namespace: 'stub' };
      });
      build.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => {
        if (args.path === 'antd') return { contents: `const message = { open: (options) => globalThis.__ccvSlowToastEvents.push(['open', options]), destroy: (key) => globalThis.__ccvSlowToastEvents.push(['destroy', key]), error() {}, warning() {} };\n${stub.replace('export const message = S;', 'export { message };')}`, loader: 'js' };
        return { contents: stub, loader: 'js' };
      });
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
  const sent = [];
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
    send: (frame) => { sent.push(frame); return true; },
    isOpen: () => true,
    addMessageHandler: () => () => {},
    addStateListener: () => () => {},
  };
  liveViews.add(view);
  return { view, sent };
}

function slow(view, requestId) {
  view._onTerminalWsMessage({ type: 'sdk-slow-upstream', requestId, cwd: '/work/project-a', instanceKey: 'instance-a', waitingMs: 30000 });
}

before(async () => {
  globalThis.window = globalThis;
  globalThis.__ccvSlowToastEvents = toastEvents;
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
    view._clearSlowUpstreamToast();
    view._clearDeferSend();
    clearTimeout(view._stopOptimisticTimer);
    liveViews.delete(view);
  }
  toastEvents.length = 0;
});

describe('ChatView slow-upstream lifecycle', () => {
  it('clears an announced request on WS close so its tick cannot revive the toast', () => {
    const { view } = makeView();
    slow(view, 'sq-1');
    assert.equal(view._slowUpstreamPending.size, 1);
    assert.ok(view._slowUpstreamTickTimer);
    view._onTerminalWsState('close');
    assert.equal(view._slowUpstreamPending.size, 0);
    assert.equal(view._slowUpstreamTickTimer, null);
    assert.ok(toastEvents.some(([type, key]) => type === 'destroy' && key === 'sdk-slow-upstream'));
  });

  it('resolves only the matching request and preserves concurrent waits', () => {
    const { view } = makeView();
    slow(view, 'sq-1');
    slow(view, 'sq-2');
    view._onTerminalWsMessage({ type: 'sdk-slow-upstream-resolved', requestId: 'sq-1', cwd: '/work/project-a', instanceKey: 'instance-a' });
    assert.deepEqual([...view._slowUpstreamPending.keys()], ['sq-2']);
    assert.ok(view._slowUpstreamTickTimer);
    view._onTerminalWsMessage({ type: 'sdk-slow-upstream-resolved', requestId: 'sq-2', cwd: '/work/project-a', instanceKey: 'instance-a' });
    assert.equal(view._slowUpstreamTickTimer, null);
  });

  it('preserves a still-pending wait when a follow-up is sent or another turn becomes idle', () => {
    const { view, sent } = makeView();
    slow(view, 'sq-1');
    view._sendUserMessageImmediate('next question');
    assert.equal(view._slowUpstreamPending.size, 1);
    assert.equal(sent[0].type, 'sdk-user-message');
    view._onTerminalWsMessage({ type: 'sdk-session-state', state: 'idle', sessionId: 'session-a', cwd: '/work/project-a', instanceKey: 'instance-a', turnId: 'turn-1' });
    assert.equal(view._slowUpstreamPending.size, 1, 'a session frame does not resolve an independent request');
    view.handleInputStop();
    assert.equal(view._slowUpstreamPending.size, 0, 'explicit Stop dismisses the current view');
    assert.equal(sent[1].type, 'sdk-interrupt');
  });

  it('restores an unresolved request replayed after reconnect with its real elapsed time', () => {
    const { view } = makeView();
    view._onTerminalWsState('close');
    slow(view, 'sq-replayed');
    assert.equal(view._slowUpstreamPending.size, 1);
    assert.ok(view._slowUpstreamTickTimer);
    view._onTerminalWsState('open');
    assert.equal(view._slowUpstreamPending.size, 0, 'open invalidates requests that settled during a silent disconnect');
    slow(view, 'sq-replayed');
    assert.equal(view._slowUpstreamPending.size, 1);
    assert.ok(view._slowUpstreamTickTimer);
    const open = toastEvents.find(([type, options]) => type === 'open' && options.key === 'sdk-slow-upstream');
    assert.ok(open, 'the replay rebuilds the toast');
    assert.match(open[1].content, /30/);
    assert.equal(open[1].duration, 90);
  });
});
