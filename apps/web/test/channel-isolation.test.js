/**
 * Channel isolation (per-workspace SSE channels, 2026-10) — RUNTIME contract.
 *
 * A background ("tap") channel keeps receiving its own scope's live frames
 * while another view is rendered. Those frames must NEVER touch the rendered
 * this.state (the cross-project bleed class), must update the tap's own vm,
 * and must surface when the channel becomes rendered again — including the
 * journaled live entries, which the warm drain replays through the ingest
 * pipeline.
 *
 * Runtime style follows sid-not-found-live-empty.test.js: the REAL AppBase is
 * bundled with esbuild (`@ccv/core` resolved for real so the ingest pipeline
 * runs) and mounted under a real React root against the minimal DOM shim.
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
const BUNDLE_DIR = join(WEB_ROOT, 'node_modules', '.cache', 'ccv-channel-isolation');
const BUNDLE = join(BUNDLE_DIR, 'appbase.bundle.mjs');

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

function walkSource(dir) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkSource(abs));
    else if (/\.(jsx|js)$/.test(ent.name)) out.push(abs);
  }
  return out;
}

function collectStubExportNames(srcDir) {
  const names = new Set();
  for (const file of walkSource(srcDir)) {
    const src = readFileSync(file, 'utf8');
    const add = (inner, spec) => {
      if (spec.startsWith('.') || spec === 'react' || spec.startsWith('react-dom') || spec.startsWith('react/') || spec.startsWith('@ccv/core')) return;
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

/** Bundle the real AppBase; `@ccv/core` is bundled for REAL so the ingest
 *  pipeline (reconstruct/slim/session merge) behaves like production. */
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
        if (p.startsWith('.') || p.startsWith('/') || p.startsWith('node:')) return null;
        if (p === '@ccv/core' || p.startsWith('@ccv/core/')) return null; // REAL core
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

let esList = [];   // every EventSource constructed, in order
let esUrls = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Dispatch one named frame to a recorded EventSource. */
const fire = (es, name, data) => (es.listeners[name] || []).forEach((f) => f({ data: typeof data === 'string' ? data : JSON.stringify(data) }));

/** Dispatch one `data:` (live entry) frame — the manager wires it via onmessage. */
const fireData = (es, data) => es.onmessage && es.onmessage({ data: typeof data === 'string' ? data : JSON.stringify(data) });

const entry = (ts, text) => JSON.stringify({ timestamp: ts, url: '/v1/messages', mainAgent: true, body: { messages: [{ role: 'user', content: text }] } });


describe('channel isolation: background frames never touch the rendered view', () => {
  before(async () => {
    installDomShim();
    globalThis.EventSource = class {
      constructor(url) {
        this.url = url;
        this.listeners = {};
        this.readyState = 1;
        this.close = () => { this.readyState = 2; };
        esList.push(this);
        esUrls.push(url);
      }
      addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
    };
    // WS-mux: AppBase now opens the dialogue channel via createMuxTransport. Throwing in
    // the constructor is the capability-probe failure → the transport synchronously falls
    // back to a native EventSource on the same url, so these tests keep observing pure SSE.
    globalThis.WebSocket = class { constructor() { throw new Error('ws disabled in test'); } };

    await buildAppBaseBundle();
    React = (await import('react')).default;
    ReactDOMClient = await import('react-dom/client');
    AppBase = (await import(pathToFileURL(BUNDLE).href)).default;
  });

  // R2 compliance (test/real-request-guard.test.js): permanent synthetic fetch +
  // forced exit (same sanctioned pattern as view-switch-sse-scope.test.js).
  after(() => { setTimeout(() => process.exit(0), 30).unref(); });

  async function mount() {
    const ref = React.createRef();
    class Probe extends AppBase {
      constructor(props) {
        super(props);
        this._maintainPinState = () => {};
        this._hydratePin = () => {};
        this._snapshotCurrentView = () => {};
      }
      render() { return React.createElement('div', null, 'probe'); }
    }
    const root = ReactDOMClient.createRoot(globalThis.document.createElement('div'));
    root.render(React.createElement(Probe, { ref }));
    await sleep(150); // let componentDidMount's idle-scheduled boot activate run
    assert.ok(ref.current, 'AppBase instance mounted');
    return ref.current;
  }

  /** Mount + boot the bound channel to a committed 1-entry baseline, then
   *  enter (cold) a parallel project and commit it too. Returns the handles. */
  async function mountTwoScopes() {
    const from = esList.length;
    const inst = await mount();
    const mine = () => esList.slice(from);
    const boundES = mine()[0];
    fire(boundES, 'load_start', { total: 1, incremental: false });
    fire(boundES, 'load_chunk', `[${entry('2026-10-13T00:00:01Z', 'bound hi')}]`);
    fire(boundES, 'load_end', {});
    await sleep(250);
    inst.handleActivateChip({ project: 'projP' });
    await sleep(30);
    const projES = mine()[1];
    fire(projES, 'load_start', { total: 1, incremental: false });
    fire(projES, 'load_chunk', `[${entry('2026-10-13T00:01:00Z', 'P hi')}]`);
    fire(projES, 'load_end', {});
    await sleep(250);
    const boundCh = inst._channels.get('bound');
    const projCh = inst._channels.get('project:projP');
    assert.equal(boundCh.vm.committed && projCh.vm.committed, true, 'both channels committed');
    return { inst, mine, boundES, projES, boundCh, projCh };
  }

  it('a tap channel\'s live frames update its vm + journal, never the rendered state', async () => {
    const { inst, projCh, projES } = await mountTwoScopes();
    // Back to bound: projP becomes the background tap.
    inst.handleDetachView();
    await sleep(60);
    assert.equal(inst._channels.getRendered(), inst._channels.get('bound'));
    const renderedBefore = {
      isStreaming: inst.state.isStreaming,
      turnActive: inst.state.turnActive,
      requests: inst.state.requests,
    };

    // Background activity on the projP socket.
    fire(projES, 'streaming_status', { active: true });
    fire(projES, 'turn_active', { active: true });
    fireData(projES, entry('2026-10-13T00:03:00Z', 'P live'));

    assert.equal(inst.state.isStreaming, renderedBefore.isStreaming, 'rendered isStreaming untouched');
    assert.equal(inst.state.turnActive, renderedBefore.turnActive, 'rendered turnActive untouched');
    assert.equal(inst.state.requests, renderedBefore.requests, 'rendered requests array untouched (identity)');
    assert.ok(!inst.state.requests.some((e) => e.timestamp === '2026-10-13T00:03:00Z'), 'no background entry leaked into the rendered list');

    assert.equal(projCh.vm.react.isStreaming, true, 'the tap vm tracks its own streaming');
    assert.equal(projCh.vm.react.turnActive, true, 'the tap vm tracks its own turn');
    assert.equal(projCh.vm.journal.length, 1, 'the live entry was journaled');
    assert.equal(projCh.vm.journal[0].timestamp, '2026-10-13T00:03:00Z');
  });

  it('switching back surfaces the background state: vm flags + drained journal entry', async () => {
    const { inst, mine, projES, projCh } = await mountTwoScopes();
    inst.handleDetachView();
    await sleep(60);
    const esBefore = mine().length;
    fire(projES, 'streaming_status', { active: true });
    fire(projES, 'turn_active', { active: true });
    fireData(projES, entry('2026-10-13T00:03:00Z', 'P live'));

    inst.handleActivateChip({ project: 'projP' });
    await sleep(40); // instant slice swap
    assert.equal(mine().length, esBefore, 'warm return opened no new EventSource');
    assert.equal(inst.state.isStreaming, true, 'tap streaming flag surfaced');
    assert.equal(inst.state.turnActive, true, 'tap turn flag surfaced');
    assert.equal(projCh.vm.journal.length, 0, 'journal drained into the pipeline');
    await sleep(300); // incremental ingest pipeline commit
    assert.equal(inst.state.requests.length, 2, 'journaled entry surfaced through the drain');
    assert.ok(inst.state.requests.some((e) => e.timestamp === '2026-10-13T00:03:00Z'), 'the live entry is in the rendered list');
    assert.ok(inst.state.mainAgentSessions.length >= 1, 'session rebuilt from the merged baseline');
  });
});
