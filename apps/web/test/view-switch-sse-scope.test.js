/**
 * View-switch SSE scope — RUNTIME contract (2026-10-06).
 *
 * Regression guard for the P0 found in the B3 review: `initSSE()` used to read
 * `this.state.attachedSid / viewedProject / viewedInstance` AFTER a handler had
 * already called `setState(...)` for the new view. Under React 18's createRoot,
 * setState is batched — `this.state` still holds the PREVIOUS view when initSSE
 * runs synchronously right after, so the SSE cold load targeted the wrong
 * project/instance (one step behind). The fix threads the new scope into
 * `initSSE(scopeOverride)`.
 *
 * Why a runtime test (not a source-anchor test): the original bug slipped past
 * every existing web test because they all MIRROR setState synchronously
 * (`Object.assign(this.state, patch)`) — the very assumption real React does not
 * hold. Text-anchor assertions also stay green if a future edit reorders the
 * handler body without changing the literal call text. This test mounts the REAL
 * AppBase under a real React root and asserts the ACTUAL `new EventSource(...)`
 * URL, so it fails if the scope is ever read one step stale again.
 *
 * No jsdom dependency: the DOM shim below is the minimal surface react-dom@18
 * createRoot needs (house style — several web tests hand-roll a document stub).
 * AppBase is bundled once with esbuild (resolved through vite's declared
 * dependency, so no new package) with the UI/asset imports stubbed.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(HERE, '..');
const APPBASE = join(WEB_ROOT, 'src', 'AppBase.jsx');
// Written under node_modules/.cache (gitignored) so a bare `react` import inside
// the bundle resolves against apps/web's own dependency tree at test time.
const BUNDLE_DIR = join(WEB_ROOT, 'node_modules', '.cache', 'ccv-view-switch-sse-scope');
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

  // Stub module: a permissive self-returning Proxy default PLUS an explicit named
  // export for every identifier the source tree imports from a bare specifier
  // (esbuild statically verifies named imports, so the names must be declared).
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
        if (p.startsWith('.') || p.startsWith('/') || p.startsWith('node:')) return null;
        if (p === 'react' || p === 'react-dom' || p === 'react-dom/client' || p.startsWith('react/')) return null;
        return { path: p, namespace: 'stub' };
      });
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

// Record every EventSource the app constructs.
let esUrls = [];

describe('view-switch SSE scope (runtime)', () => {
  // The DOM shim is installed for the whole file and intentionally NOT torn down:
  // the handlers schedule rAF/timers whose callbacks would otherwise fire after a
  // teardown and raise spurious "window is not defined" errors. node:test runs
  // each test FILE in its own process, so the shim cannot leak into siblings.
  before(async () => {
    installDomShim();
    globalThis.EventSource = class {
      constructor(url) { this.url = url; esUrls.push(url); this.close = () => {}; }
      addEventListener() {}
    };
    globalThis.WebSocket = class { constructor() { this.readyState = 0; } send() {} close() {} };

    await buildAppBaseBundle();
    React = (await import('react')).default;
    ReactDOMClient = await import('react-dom/client');
    AppBase = (await import(pathToFileURL(BUNDLE).href)).default;
  });

  after(() => { esUrls = []; });

  // R2 compliance (test/real-request-guard.test.js): this file assigns `globalThis.fetch` (a
  // permanent synthetic upstream for the whole process). The guard requires either a
  // save/restore or an exit backstop — use the sanctioned "permanent synthetic fetch + forced
  // exit" pattern (same as interceptor-instance-header.test.js) so the next test file in this
  // process never sees our fetch.
  after(() => { setTimeout(() => process.exit(0), 30).unref(); });

  /** Mount the real AppBase (render overridden) and return a handle to the instance. */
  async function mount() {
    const ref = React.createRef();
    class Probe extends AppBase {
      constructor(props) {
        super(props);
        // Neutralize side effects that need a live server so the test stays offline.
        this._maintainPinState = () => {};
        this._hydratePin = () => {};
        this._snapshotCurrentView = () => {};
      }
      render() { return React.createElement('div', null, 'probe'); }
    }
    const root = ReactDOMClient.createRoot(globalThis.document.createElement('div'));
    root.render(React.createElement(Probe, { ref }));
    await new Promise((r) => setTimeout(r, 120));
    assert.ok(ref.current, 'AppBase instance mounted');
    return ref.current;
  }

  /** Run `fn`, wait a tick, and return the EventSource URLs it produced. */
  async function urlsAfter(fn) {
    esUrls = [];
    fn();
    await new Promise((r) => setTimeout(r, 80));
    return esUrls.slice();
  }

  it('handleActivateChip cold-loads the NEW project+instance (not the previous view)', async () => {
    const inst = await mount();
    const urls = await urlsAfter(() => inst.handleActivateChip({ project: 'projA', instanceKey: 'ccv-deadbeef' }));
    assert.ok(
      urls.some((u) => u.includes('project=projA') && u.includes('instance=ccv-deadbeef')),
      `expected ?project=projA&instance=ccv-deadbeef, got ${JSON.stringify(urls)}`,
    );
  });

  it('handleDetachView cold-loads the bound project (no ?project=/?instance=)', async () => {
    const inst = await mount();
    // Enter a parallel view first so detach has something to clear.
    await urlsAfter(() => inst.handleActivateChip({ project: 'projA', instanceKey: 'ccv-deadbeef' }));
    const urls = await urlsAfter(() => inst.handleDetachView());
    assert.ok(
      urls.some((u) => !u.includes('project=') && !u.includes('instance=') && !u.includes('sid=')),
      `expected a plain bound cold load, got ${JSON.stringify(urls)}`,
    );
  });

  it('handleResumeSession opens a confirm (no initSSE until confirmed)', async () => {
    // Post-migration (2026-10-06): a row pick opens a centered Modal.confirm and returns
    // without touching SSE; the switch only proceeds on OK via _doResumeSwitch. antd is
    // stubbed (Proxy), so Modal.confirm is inert — this asserts the pick alone does NOT
    // cold-load (the confirm gate is real, not a passthrough).
    const inst = await mount();
    const urls = await urlsAfter(() => inst.handleResumeSession({ sessionUuid: 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE' }));
    assert.ok(
      !urls.some((u) => u.includes('sid=')),
      `expected no ?sid= cold-load before confirm, got ${JSON.stringify(urls)}`,
    );
  });

  it('_applyViewAttach cold-loads ?sid=<uuid> (the post-confirm attach)', async () => {
    // The attach half of a true resume: after the server injects /resume, the view
    // attaches to the now-live session by cold-loading ?sid=<uuid> (lowercased).
    const inst = await mount();
    const urls = await urlsAfter(() => inst._applyViewAttach('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'));
    assert.ok(
      urls.some((u) => u.includes('sid=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')),
      `expected ?sid=<lowercased uuid>, got ${JSON.stringify(urls)}`,
    );
  });

  it('_applyViewAttach with a parallel-project scope cold-loads ?sid=<uuid>&project=<B> and keeps the view on B', async () => {
    // Parallel true-resume (review P1-a): resuming into a parallel VIEWED project must keep
    // the view on that project — the sid lives under B's dir, so the cold-load must be
    // scoped ?sid=<uuid>&project=<B>, and viewedProject must NOT be cleared to the bound
    // project (which would snap the view back and never render the resumed conversation).
    const inst = await mount();
    inst.setState({ projectName: 'boundProj', viewedProject: 'projB', viewedInstance: null });
    await new Promise((r) => setTimeout(r, 60));
    const urls = await urlsAfter(() => inst._applyViewAttach('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', { project: 'projB', instance: null }));
    assert.ok(
      urls.some((u) => u.includes('sid=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee') && u.includes('project=projB')),
      `expected ?sid=<uuid>&project=projB, got ${JSON.stringify(urls)}`,
    );
    assert.equal(inst.state.viewedProject, 'projB', 'view stays on the parallel project');
    assert.equal(inst.state.attachedSid, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  it('_applyViewAttach with a bound scope clears any parallel view (bound project resume)', async () => {
    // Bound true-resume: projectName === scope project (or scope null) → attach wins and any
    // parallel view is cleared; the cold-load targets the bound project.
    const inst = await mount();
    inst.setState({ projectName: 'boundProj', viewedProject: 'projB', viewedInstance: null });
    await new Promise((r) => setTimeout(r, 60));
    const urls = await urlsAfter(() => inst._applyViewAttach('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', { project: 'boundProj', instance: null }));
    assert.ok(
      urls.some((u) => u.includes('sid=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee') && u.includes('project=boundProj')),
      `expected ?sid=<uuid>&project=boundProj, got ${JSON.stringify(urls)}`,
    );
    assert.equal(inst.state.viewedProject, null, 'bound resume clears the parallel view');
  });
});
