/**
 * chat-pending-images-guard.test.js — images pasted into the chat composer must
 * survive incoming conversation updates; they are dropped only on a real
 * session/view switch.
 *
 * Root cause: ChatView.componentDidUpdate called _clearPendingImages()
 * UNGUARDED whenever the mainAgentSessions prop reference changed. But
 * mergeMainAgentSessions returns a fresh outer array (`[...prevSessions]`) on
 * every streaming SSE tick while mutating the session objects in place — so the
 * very next incoming request wiped the composer's pendingImages while the user
 * was composing. The queued-messages clear in the same branch already carried a
 * guard with a comment describing this exact ref-churn hazard; the attachment
 * clear was left outside it.
 *
 * Fix contract under test:
 *  1. Same-session streaming tick (new array, SAME session objects) → keep.
 *  2. Same-conversation rebuilds (new session object + rebuilt messages array,
 *     the applyInPlaceLastMsgReplace shape at every turn completion; fresh
 *     message objects with copied _timestamps, the cold-load replay shape) →
 *     keep. These pin VALUE-based stable-id comparison: object- or
 *     array-identity guards would still clear here.
 *  3. First session-list commit after mount (cold load landing while the user
 *     already pasted) → keep; a load-earlier shard prepend (same conversation
 *     growing backwards) → keep.
 *  4. New session appended, or same-length turnover (MAX_SESSIONS trim) →
 *     clear.
 *  5. View switch (viewProject/viewInstance/attachedSid change) → clear;
 *     attachedSid-only change → clear; null→real async boot init → keep.
 *
 * Harness: esbuild-bundles the real ChatView with stubbed non-relative imports
 * and drives componentDidUpdate on a bare instance (same pattern as
 * optimistic-queue-chat.test.js). NOTE the seeding discipline: _prevSessions
 * starts null and the first non-empty commit is explicitly a KEEP (case 3), so
 * tests that need an established baseline must seed sessions BEFORE attaching
 * images — otherwise they exercise the first-commit path instead.
 */
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const liveViews = new Set();

const here = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(here, '..');
const BUNDLE_DIR = join(WEB_ROOT, 'node_modules', '.cache', 'ccv-pending-images-test');
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
    name: 'ccv-pending-images-stubs',
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
    send: () => true,
    isOpen: () => true,
    addMessageHandler: () => () => {},
    addStateListener: () => () => {},
  };
  view.setState({ visibleCount: 100 });
  view.scrollToBottom = () => {};
  view._bindInputStackRO = () => {};
  view._bindChatScrollbarRO = () => {};
  view._attachMdCodeProbe = () => {};
  view._maybeScheduleLocalLogAutoFill = () => {};
  view._stickyController = { bind() {}, startSmoothFollow() {}, resetUserScrollState() {}, isUserScrolling: () => false };
  liveViews.add(view);
  return view;
}

function updateSessions(view, sessions) {
  const previousProps = view.props;
  const previousState = view.state;
  view.props = { ...view.props, mainAgentSessions: sessions };
  view.componentDidUpdate(previousProps, previousState);
}

function session(ts) {
  return { messages: [{ role: 'user', content: `prompt ${ts}`, _timestamp: ts }], response: null };
}

function pasteImage(view) {
  view.setState({ pendingImages: [{ path: '/tmp/cc-viewer-uploads/a.png', source: 'paste' }] });
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

describe('ChatView composer attachments vs incoming conversation updates', () => {
  it('keeps pasted images across a same-session streaming tick (fresh outer array, same objects)', () => {
    const view = makeView();
    const s = session('t1');
    updateSessions(view, [s]); // seed _prevSessions before attaching
    pasteImage(view);
    updateSessions(view, [s]); // same object, fresh array — mergeMainAgentSessions tick shape
    assert.equal(view.state.pendingImages.length, 1, 'same-session tick must not wipe composer attachments');
  });

  it('keeps pasted images when the session is cloned with a rebuilt messages array (turn-completion replace shape)', () => {
    const view = makeView();
    const s = session('t1');
    updateSessions(view, [s]);
    pasteImage(view);
    // applyInPlaceLastMsgReplace shape: new session object + NEW messages array
    // (slice + push) — the first message keeps its _timestamp while the tail is
    // replaced, so the guard must compare stable ids by VALUE (an object- or
    // array-identity guard would wrongly clear here, at every turn completion).
    const clone = { ...s, messages: [{ ...s.messages[0] }, { role: 'assistant', content: 'done', _timestamp: 't2' }] };
    const previousProps = view.props;
    const previousState = view.state;
    view.props = { ...view.props, mainAgentSessions: [clone] };
    view.componentDidUpdate(previousProps, previousState);
    assert.equal(view.state.pendingImages.length, 1, 'rebuilt messages array within the same conversation must keep attachments');
  });

  it('keeps pasted images when message objects are rebuilt with the same timestamps (cold-load replay shape)', () => {
    const view = makeView();
    const s = session('t1');
    updateSessions(view, [s]);
    pasteImage(view);
    // Cold-load/shard replay: fresh message objects, same _timestamp values.
    updateSessions(view, [{ ...s, messages: [{ ...s.messages[0] }] }]);
    assert.equal(view.state.pendingImages.length, 1, 'value-identical rebuild must keep attachments');
  });

  it('keeps pasted images on the first session-list commit after mount (cold load landing)', () => {
    const view = makeView(); // _prevSessions starts null — composer is live during cold load
    pasteImage(view);
    updateSessions(view, [session('t1')]);
    assert.equal(view.state.pendingImages.length, 1, 'first commit after mount is not a switch — nothing is being left');
  });

  it('keeps pasted images on a load-earlier-history shard prepend (same conversation, growing backwards)', () => {
    const view = makeView();
    const s2 = session('t2');
    updateSessions(view, [s2]);
    pasteImage(view);
    const previousProps = view.props;
    const previousState = view.state;
    // AppBase commits the prepended list and bumps shardPrependCount together.
    view.props = { ...view.props, mainAgentSessions: [session('t1'), s2], shardPrependCount: 1 };
    view.componentDidUpdate(previousProps, previousState);
    assert.equal(view.state.pendingImages.length, 1, 'shard prepend must not wipe composer attachments');
  });

  it('clears pasted images when the list length is unchanged but the session identity changes (MAX_SESSIONS trim)', () => {
    const view = makeView();
    updateSessions(view, [session('t1'), session('t2')]);
    pasteImage(view);
    // Oldest dropped + new appended: same length, only the stable-id compare can tell.
    updateSessions(view, [session('t2'), session('t3')]);
    assert.deepEqual(view.state.pendingImages, [], 'same-length session turnover is still a session switch');
  });

  it('clears pasted images when a new session is appended', () => {
    const view = makeView();
    const s = session('t1');
    updateSessions(view, [s]);
    pasteImage(view);
    updateSessions(view, [s, session('t2')]);
    assert.deepEqual(view.state.pendingImages, [], 'a real new session must drop the old composer attachments');
  });

  it('clears pasted images on a real view switch', () => {
    const view = makeView();
    const s = session('t1');
    updateSessions(view, [s]);
    pasteImage(view);
    const previousProps = view.props;
    const previousState = view.state;
    view.props = { ...view.props, viewProject: 'project-b', viewInstance: 'instance-b', attachedSid: 'session-b' };
    view.componentDidUpdate(previousProps, previousState);
    assert.deepEqual(view.state.pendingImages, [], 'switching workspace must drop the old composer attachments');
  });

  it('clears pasted images when only attachedSid changes (resume into another session)', () => {
    const view = makeView();
    const s = session('t1');
    updateSessions(view, [s]);
    pasteImage(view);
    const previousProps = view.props;
    const previousState = view.state;
    view.props = { ...view.props, attachedSid: 'session-b' };
    view.componentDidUpdate(previousProps, previousState);
    assert.deepEqual(view.state.pendingImages, [], 'an attach switch alone must drop the old attachments');
  });

  it('keeps pasted images when viewProject/viewInstance resolve from null (async boot init)', () => {
    const view = makeView();
    view.props = { ...view.props, viewProject: null, viewInstance: null };
    const s = session('t1');
    updateSessions(view, [s]); // seed _prevSessions while the view is unresolved
    pasteImage(view);
    const previousProps = view.props;
    const previousState = view.state;
    // /api/project-name and the bound instance land after mount — not a real switch.
    view.props = { ...view.props, viewProject: 'project-a', viewInstance: 'instance-a' };
    view.componentDidUpdate(previousProps, previousState);
    assert.equal(view.state.pendingImages.length, 1, 'null→real view init must not drop attachments');
  });
});
