/**
 * sid-not-found reason handling — RUNTIME contract (2026-10-10).
 *
 * Regression guard for the "new workspace empty view" fix: the `sid-not-found`
 * SSE listener used to ignore its payload entirely and always toast
 * `ui.resume.switchTimeout` ("switch timed out") — a misleading message for a
 * ?instance PTY that simply died before its first write
 * (reason 'instance-no-session'). The listener now parses `event.data` and
 * picks a dedicated key (`ui.resume.noSession`) for that reason; BOTH shapes
 * still auto-detach (a dead instance / pruned sid can never produce content).
 * A LIVE instance with no session yet never reaches this frame at all — the
 * server serves an empty view instead (events.js liveness-aware guard).
 *
 * Why a runtime test: mirrors the house style of view-switch-sse-scope.test.js
 * — the REAL AppBase is bundled once with esbuild (UI/asset imports stubbed),
 * mounted under a real React root against the minimal DOM shim, and the
 * listener registered on a recorded EventSource is dispatched synthetic frames.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(HERE, '..');
const APPBASE = join(WEB_ROOT, 'src', 'AppBase.jsx');
// Written under node_modules/.cache (gitignored) so a bare `react` import inside
// the bundle resolves against apps/web's own dependency tree at test time.
const BUNDLE_DIR = join(WEB_ROOT, 'node_modules', '.cache', 'ccv-sid-not-found-live-empty');
const BUNDLE = join(BUNDLE_DIR, 'appbase.bundle.mjs');

// ─── minimal DOM shim (react-dom@18 createRoot surface; no jsdom) ─────────────
function installDomShim() {
  class NodeBase {}
  for (const n of ['HTMLElement', 'HTMLIFrameElement', 'HTMLInputElement', 'HTMLTextAreaElement',
    'HTMLSelectElement', 'HTMLButtonElement', 'HTMLDivElement', 'HTMLSpanElement', 'HTMLAnchorElement',
    'HTMLBodyElement', 'HTMLHtmlElement', 'HTMLCanvasElement', 'HTMLImageElement', 'SVGElement', 'Element',
    'DocumentFragment', 'Text', 'Comment', 'CharacterData', 'Document', 'Window', 'Event']) {
    globalThis[n] = class extends NodeBase {};
  }
  const el = (tag = 'div') => {
    const node = Object.assign(Object.create(globalThis.HTMLElement.prototype), {
      nodeType: 1, nodeName: tag.toUpperCase(), tagName: tag.toUpperCase(), localName: tag,
      namespaceURI: 'http://www.w3.org/1999/xhtml', parentNode: null,
      style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      childNodes: [], children: [], firstChild: null, lastChild: null, textContent: '', innerHTML: '', innerText: '', value: '',
      setAttribute() {}, getAttribute: () => null, removeAttribute() {}, hasAttribute: () => false,
      appendChild(c) { return c; }, removeChild(c) { return c; }, insertBefore(c) { return c; }, replaceChild(c) { return c; },
      addEventListener() {}, removeEventListener() {}, remove() {}, focus() {}, blur() {}, click() {}, dispatchEvent() { return true; },
      querySelector: () => null, querySelectorAll: () => [], closest: () => null, contains: () => false,
      getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }),
      getRootNode() { return this; }, cloneNode() { return el(tag); },
    });
    Object.defineProperty(node, 'ownerDocument', { get: () => globalThis.document, configurable: true });
    return node;
  };
  const doc = {
    nodeType: 9, createElement: (t) => el(t), createElementNS: (ns, t) => el(t), createTextNode: () => el('#text'),
    createDocumentFragment: () => el('#fragment'), createComment: () => el('#comment'),
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    addEventListener() {}, removeEventListener() {}, body: el('body'), head: el('head'),
    documentElement: el('html'), activeElement: null,
  };
  globalThis.document = doc;
  globalThis.window = globalThis;
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, clear() {} };
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node' }, configurable: true });
  globalThis.location = { search: '', pathname: '/', href: 'http://localhost/', hash: '' };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
  globalThis.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
}

/** Recursively list .js/.jsx files under dir. */
function walkSource(dir) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkSource(abs));
    else if (/\.(jsx|js)$/.test(ent.name)) out.push(abs);
  }
  return out;
}

/** Every named import/reexport from a non-react bare specifier across src/. */
function collectStubExportNames(srcDir) {
  const names = new Set();
  for (const file of walkSource(srcDir)) {
    const src = readFileSync(file, 'utf8');
    const add = (inner, spec) => {
      if (spec.startsWith('.') || spec === 'react' || spec.startsWith('react-dom') || spec.startsWith('react/')) return;
      for (const raw of inner.split(',').map((x) => x.trim()).filter(Boolean)) {
        const mm = raw.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
        if (mm) { names.add(mm[1]); if (mm[2]) names.add(mm[2]); }
      }
    };
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gs)) add(m[1], m[2]);
    for (const m of src.matchAll(/export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gs)) add(m[1], m[2]);
  }
  return [...names].filter((n) => /^[A-Za-z_$][\w$]*$/.test(n) && n !== 'default');
}

/** Bundle the real AppBase with UI/asset imports stubbed (esbuild via vite's dep). */
async function buildAppBaseBundle() {
  const appReq = createRequire(join(WEB_ROOT, 'package.json'));
  const esbuildPath = createRequire(appReq.resolve('vite')).resolve('esbuild');
  const esbuild = await import(pathToFileURL(esbuildPath).href);

  const names = collectStubExportNames(join(WEB_ROOT, 'src'));
  const STUB = [
    'const h = () => null;',
    'const S = new Proxy(function(){}, { apply:()=>S, construct:()=>({}), get:()=>S });',
    'export default S;',
    ...names.map((n) => `export const ${n} = S;`),
  ].join('\n');

  const stubPlugin = {
    name: 'ccv-stub-ui',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        const p = args.path;
        if (/\.(css|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|eot|mp3|wav|ogg)$/.test(p.split('?')[0])) {
          return { path: p, namespace: 'asset' };
        }
        // i18n.js stays REAL (self-contained, no imports): t(key) resolves to
        // the localized string. antd gets a REAL tiny stub (not the Proxy —
        // its get trap would swallow the spy) whose message.warning records
        // the toasted TEXT on globalThis.__ccvWarnings.
        if (p === 'antd') return { path: p, namespace: 'antd-stub' };
        if (p.startsWith('.') || p.startsWith('/') || p.startsWith('node:')) return null;
        if (p === 'react' || p === 'react-dom' || p === 'react-dom/client' || p.startsWith('react/')) return null;
        return { path: p, namespace: 'stub' };
      });
      build.onLoad({ filter: /.*/, namespace: 'antd-stub' }, () => ({
        contents: [
          'const S = new Proxy(function(){}, { apply:()=>S, construct:()=>({}), get:()=>S });',
          // message.warning is REAL (records the toasted text); every other
          // named antd export resolves to the permissive Proxy.
          'const message = {',
          '  warning: (text) => { (globalThis.__ccvWarnings ||= []).push(String(text && text.content !== undefined ? text.content : text)); },',
          '  success: () => {}, error: () => {}, info: () => {}, loading: () => {}, open: () => {}, destroy: () => {},',
          '};',
          'export default S;',
          'export { message };',
          ...names.filter((n) => n !== 'message' && n !== 'default').map((n) => `export const ${n} = S;`),
        ].join('\n'),
        loader: 'js',
      }));
      build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: STUB, loader: 'js' }));
      build.onLoad({ filter: /.*/, namespace: 'asset' }, (args) => ({
        contents: /\.css$/.test(args.path) ? 'export default new Proxy({}, { get: () => "" });' : 'export default "";',
        loader: 'js',
      }));
    },
  };

  const result = await esbuild.build({
    entryPoints: [APPBASE], bundle: true, format: 'esm', platform: 'browser', write: false,
    jsx: 'automatic', loader: { '.jsx': 'jsx', '.js': 'jsx' },
    plugins: [stubPlugin], logLevel: 'silent',
  });
  mkdirSync(BUNDLE_DIR, { recursive: true });
  writeFileSync(BUNDLE, result.outputFiles[0].contents);
}

let React;
let ReactDOMClient;
let AppBase;

// The most recent EventSource with its registered listeners, so tests can
// dispatch synthetic frames into the REAL handlers.
let currentES = null;

describe('sid-not-found reason handling (runtime)', () => {
  // The DOM shim is installed for the whole file and intentionally NOT torn down
  // (same rationale as view-switch-sse-scope.test.js — node:test isolates files).
  before(async () => {
    installDomShim();
    globalThis.EventSource = class {
      constructor(url) {
        this.url = url;
        this.listeners = {};
        this.close = () => {};
        currentES = this;
      }
      addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
    };
    globalThis.WebSocket = class { constructor() { this.readyState = 0; } send() {} close() {} };

    await buildAppBaseBundle();
    React = (await import('react')).default;
    ReactDOMClient = await import('react-dom/client');
    AppBase = (await import(pathToFileURL(BUNDLE).href)).default;
  });

  // R2 compliance (test/real-request-guard.test.js): permanent synthetic fetch +
  // forced exit, same sanctioned pattern as view-switch-sse-scope.test.js.
  after(() => { setTimeout(() => process.exit(0), 30).unref(); });

  /** Mount the real AppBase with detach/warn probes wired in. */
  async function mount() {
    const ref = React.createRef();
    class Probe extends AppBase {
      constructor(props) {
        super(props);
        this._maintainPinState = () => {};
        this._hydratePin = () => {};
        this._snapshotCurrentView = () => {};
        this.detachCalls = 0;
        this.handleDetachView = () => { this.detachCalls++; };
      }
      render() { return React.createElement('div', null, 'probe'); }
    }
    const root = ReactDOMClient.createRoot(globalThis.document.createElement('div'));
    root.render(React.createElement(Probe, { ref }));
    await new Promise((r) => setTimeout(r, 120));
    assert.ok(ref.current, 'AppBase instance mounted');
    return ref.current;
  }

  /** Texts toasted via antd message.warning since the last reset. */
  const warnings = () => (globalThis.__ccvWarnings ||= []);
  // The two user-visible texts under test. i18n.js detects the 'node'
  // navigator as English, so assert the en copy (the zh copy is the same key
  // — new-ui-i18n.test.js guards all 18 locales of both keys).
  const NO_SESSION_TEXT = 'No displayable session for this project';
  const TIMEOUT_TEXT = 'Switch timed out: target project did not respond';

  /** initSSE against a fresh EventSource and return its sid-not-found listener. */
  async function listenerFor(inst, scope) {
    currentES = null;
    inst.initSSE(scope);
    await new Promise((r) => setTimeout(r, 40));
    assert.ok(currentES, 'an EventSource was constructed');
    const fns = currentES.listeners['sid-not-found'] || [];
    assert.equal(fns.length, 1, 'exactly one sid-not-found listener per connection');
    return fns[0];
  }

  it('reason "instance-no-session" detaches with the dedicated ui.resume.noSession message', async () => {
    const inst = await mount();
    const fn = await listenerFor(inst, { sid: null, project: 'projB', instance: 'ccv-deadbeef' });
    globalThis.__ccvWarnings = [];
    fn({ data: JSON.stringify({ sid: null, instance: 'ccv-deadbeef', reason: 'instance-no-session', ts: 1 }) });
    assert.equal(inst.detachCalls, 1, 'a dead instance still auto-detaches to the bound view');
    assert.ok(warnings().includes(NO_SESSION_TEXT), `expected the no-session text, got ${JSON.stringify(warnings())}`);
    assert.ok(!warnings().includes(TIMEOUT_TEXT), 'the misleading "switch timed out" text must not appear');
  });

  it('a pruned ?sid (no reason) keeps the switchTimeout message and still detaches', async () => {
    const inst = await mount();
    const fn = await listenerFor(inst, { sid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', project: 'projB', instance: null });
    globalThis.__ccvWarnings = [];
    fn({ data: JSON.stringify({ sid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', ts: 1 }) });
    assert.equal(inst.detachCalls, 1);
    assert.ok(warnings().includes(TIMEOUT_TEXT), `expected the switch-timeout text, got ${JSON.stringify(warnings())}`);
  });

  it('a malformed payload never throws and degrades to the generic message + detach', async () => {
    const inst = await mount();
    const fn = await listenerFor(inst, { sid: null, project: 'projB', instance: 'ccv-deadbeef' });
    globalThis.__ccvWarnings = [];
    fn({ data: 'not-json' });
    assert.equal(inst.detachCalls, 1, 'parse failure must not skip the detach');
    assert.ok(warnings().includes(TIMEOUT_TEXT));
  });

  it('a stale (pre-reconnect) listener is guarded off by the sse generation check', async () => {
    const inst = await mount();
    const fn = await listenerFor(inst, { sid: null, project: 'projB', instance: 'ccv-deadbeef' });
    // Reconnect: bumps the generation, making the previously captured listener stale.
    await listenerFor(inst, { sid: null, project: null, instance: null });
    globalThis.__ccvWarnings = [];
    fn({ data: JSON.stringify({ sid: null, instance: 'ccv-deadbeef', reason: 'instance-no-session', ts: 2 }) });
    assert.equal(inst.detachCalls, 0, 'stale listeners must not fire (sse-connection-gen contract)');
    assert.deepEqual(warnings(), [], 'a stale listener must not toast at all');
  });

  it('empty view mainline: load_end clears the switch overlay with NO toast and NO detach', async () => {
    // The PRIMARY UX path of the fix: a LIVE empty instance never gets a
    // sid-not-found frame — the server sends load_start{total:0,empty:true}
    // then load_end, and the overlay must clear in place (regression: it used
    // to hang until the 30s backstop). No sid-not-found ⇒ no toast, no detach.
    const inst = await mount();
    currentES = null;
    inst.initSSE({ sid: null, project: 'projB', instance: 'ccv-livebeef' });
    await new Promise((r) => setTimeout(r, 40));
    assert.ok(currentES, 'an EventSource was constructed');
    // Arm the probe FIRST, then raise the overlay — initSSE's own mount-time
    // clear (on the null value) must not consume the probe.
    let clearCalls = 0;
    const prevClear = inst._clearResumeSwitch.bind(inst);
    inst._clearResumeSwitch = () => { clearCalls++; prevClear(); };
    inst.setState({ resumeSwitch: { uuid: 'projB' } });
    await new Promise((r) => setTimeout(r, 60)); // let React commit the overlay
    assert.deepEqual(inst.state.resumeSwitch, { uuid: 'projB' }, 'overlay is up before the cold load ends');
    globalThis.__ccvWarnings = [];
    const fire = (name, data) => (currentES.listeners[name] || []).forEach((f) => { try { f({ data }); } catch (e) { console.log('LISTENER THREW', name, e && e.message); } });
    fire('load_start', JSON.stringify({ total: 0, incremental: false, empty: true }));
    fire('load_end', '{}');
    await new Promise((r) => setTimeout(r, 120)); // flush the listener's batched setState
    assert.ok(clearCalls >= 1, 'load_end must invoke _clearResumeSwitch (the overlay-clear path)');
    assert.equal(inst.state.resumeSwitch, null, 'load_end must clear the switch overlay');
    assert.equal(inst.detachCalls, 0, 'a live empty view must NOT detach');
    assert.deepEqual(warnings(), [], 'a live empty view must NOT toast');
  });

  it('empty:true on load_start invalidates the restored view-cache snapshot and clears its content', async () => {
    // Regression for the incremental-restore leak: the user viewed session S1 of
    // projB, S1 was pruned while the PTY stayed alive, and switching back painted
    // the CACHED S1 before resuming with ?since&cc=. An empty:true delta must drop
    // that snapshot + content — otherwise the deleted conversation keeps rendering.
    const inst = await mount();
    const key = 'projB\x00ccv-livebeef';
    inst._viewCache.snapshot(key, {
      requests: [{ timestamp: '2026-10-10T06:00:00.000Z', url: 'u', mainAgent: true }],
      v2Rows: [], v2RowsMeta: { totalCount: 1, hasMore: false, oldestTs: '' },
      mainAgentSessions: [], pinnedSessionTs: null, selectedIndex: 0,
    });
    // Simulate the cache-hit paint that initSSE performs before the delta.
    inst.setState({ requests: [{ timestamp: '2026-10-10T06:00:00.000Z', url: 'u', mainAgent: true }] });
    currentES = null;
    inst.initSSE({ sid: null, project: 'projB', instance: 'ccv-livebeef' });
    await new Promise((r) => setTimeout(r, 40));
    assert.ok(currentES, 'an EventSource was constructed');
    globalThis.__ccvWarnings = [];
    const fire = (name, data) => (currentES.listeners[name] || []).forEach((f) => f({ data }));
    fire('load_start', JSON.stringify({ total: 0, incremental: true, empty: true }));
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(inst._viewCache.restore(key), null, 'the stale snapshot must be invalidated');
    assert.deepEqual(inst.state.requests, [], 'the restored (deleted) conversation must be cleared');
    assert.equal(inst.detachCalls, 0);
    assert.deepEqual(warnings(), []);
  });
});
