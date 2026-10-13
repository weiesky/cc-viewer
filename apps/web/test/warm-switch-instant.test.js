/**
 * Warm switch (per-workspace SSE channels, 2026-10) — RUNTIME contract.
 *
 * The headline behavior of the channel refactor: a scope that already
 * cold-loaded once stays CONNECTED in the background while another view is
 * rendered; switching back is a state swap — NO new EventSource, NO switch
 * overlay, and the rendered this.state is exactly the channel's vm react slice.
 *
 * Why a runtime test: same house style as sid-not-found-live-empty.test.js —
 * the REAL AppBase is bundled with esbuild (`@ccv/core` resolved for real so
 * the ingest pipeline runs) and mounted under a real React root against the
 * minimal DOM shim; a recording EventSource lets the test drive load_start /
 * load_chunk / load_end frames.
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
const BUNDLE_DIR = join(WEB_ROOT, 'node_modules', '.cache', 'ccv-warm-switch-instant');
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

describe('warm switch is instant (runtime, per-workspace channels)', () => {
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
    globalThis.WebSocket = class { constructor() { this.readyState = 0; } send() {} close() {} };

    await buildAppBaseBundle();
    React = (await import('react')).default;
    ReactDOMClient = await import('react-dom/client');
    AppBase = (await import(pathToFileURL(BUNDLE).href)).default;
  });

  // R2 compliance (test/real-request-guard.test.js): permanent synthetic fetch +
  // forced exit, same sanctioned pattern as view-switch-sse-scope.test.js.
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

  /** Mount and return the instance plus the EventSources IT opened. */
  async function mountIsolated() {
    const from = esList.length;
    const inst = await mount();
    return { inst, mine: () => esList.slice(from) };
  }

  it('cold enter parallel → load_end → switch to bound → switch back: NO new EventSource, no overlay, rendered === vm', async () => {
    const { inst, mine } = await mountIsolated();
    // Boot: one bound channel, committed with a 1-entry baseline.
    assert.equal(mine().length, 1, 'boot opened exactly one EventSource (bound)');
    const boundES = mine()[0];
    assert.ok(!boundES.url.includes('project=') && !boundES.url.includes('sid='), `bound URL: ${boundES.url}`);
    fire(boundES, 'load_start', { total: 1, incremental: false });
    fire(boundES, 'load_chunk', `[${entry('2026-10-13T00:00:01Z', 'bound hi')}]`);
    fire(boundES, 'load_end', {});
    await sleep(250); // chunked ingest pipeline commit
    const boundCh = inst._channels.get('bound');
    assert.equal(boundCh.vm.committed, true, 'bound channel committed');
    assert.equal(inst.state.requests.length, 1, 'bound baseline rendered');

    // Enter the parallel project COLD: a new EventSource + the switch overlay.
    inst.handleActivateChip({ project: 'projP' });
    await sleep(30);
    assert.equal(mine().length, 2, 'cold parallel enter opened a second EventSource');
    const projES = mine()[1];
    assert.ok(projES.url.includes('project=projP'), `parallel URL: ${projES.url}`);
    assert.ok(inst.state.resumeSwitch, 'cold enter shows the switch overlay');
    fire(projES, 'load_start', { total: 1, incremental: false });
    fire(projES, 'load_chunk', `[${entry('2026-10-13T00:01:00Z', 'P hi')}]`);
    fire(projES, 'load_end', {});
    await sleep(250);
    const projCh = inst._channels.get('project:projP');
    assert.equal(projCh.vm.committed, true, 'projP channel committed');
    assert.equal(inst.state.resumeSwitch, null, 'overlay cleared at load_end');
    assert.equal(inst.state.requests.length, 1);

    // Switch back to bound: WARM — no overlay, no new EventSource.
    inst.handleDetachView();
    await sleep(60);
    assert.equal(mine().length, 2, 'warm switch to bound opened NO new EventSource');
    assert.equal(boundES.readyState, 1, 'the bound socket is still the SAME live connection');
    assert.equal(inst.state.resumeSwitch, null, 'warm switch shows no overlay');
    assert.equal(inst.state.requests, boundCh.vm.react.requests, 'rendered state IS the channel vm slice');
    assert.equal(inst._channels.getRendered(), boundCh, 'bound channel is rendered');

    // And back to projP: WARM again — still no new EventSource.
    inst.handleActivateChip({ project: 'projP' });
    await sleep(60);
    assert.equal(mine().length, 2, 'warm switch back opened NO new EventSource');
    assert.equal(projES.readyState, 1, 'the projP socket stayed live in the background');
    assert.equal(inst.state.resumeSwitch, null, 'no overlay on the way back either');
    assert.equal(inst.state.requests, projCh.vm.react.requests, 'projP vm slice rendered');
    assert.equal(inst._channels.getRendered(), projCh);
  });

  it('a COMMITTED channel with a dead socket warm-stales: instant paint + ?since resume (no cold reload)', async () => {
    const { inst, mine } = await mountIsolated();
    const boundES = mine()[0];
    fire(boundES, 'load_start', { total: 1, incremental: false });
    fire(boundES, 'load_chunk', `[${entry('2026-10-13T00:00:01Z', 'bound hi')}]`);
    fire(boundES, 'load_end', {});
    await sleep(250);

    inst.handleActivateChip({ project: 'projQ' });
    await sleep(30);
    const projES = mine()[1];
    assert.ok(projES && projES.url.includes('project=projQ'), `parallel URL: ${projES && projES.url}`);
    fire(projES, 'load_start', { total: 1, incremental: false });
    fire(projES, 'load_chunk', `[${entry('2026-10-13T00:02:00Z', 'Q hi')}]`);
    fire(projES, 'load_end', {});
    await sleep(250);
    const projCh = inst._channels.get('project:projQ');
    assert.equal(projCh.vm.lastCommittedTs, '2026-10-13T00:02:00Z', 'committed cursor = baseline tail');

    // Kill the projQ socket (a dead background connection), leave to bound,
    // then come back: the channel repaints instantly from its vm and resumes
    // with ?since=<cursor>&cc (never a cold window reload).
    projES.readyState = 2;
    inst.handleDetachView();
    await sleep(40);
    inst.handleActivateChip({ project: 'projQ' });
    await sleep(40); // let React flush the painted slice
    assert.equal(inst.state.requests.length, 1, 'baseline painted instantly while the delta loads');
    assert.equal(inst.state.resumeSwitch, null, 'warm-stale shows no cold overlay');
    await sleep(2300); // reconnect backoff (legacy pacing: 2s at budget 1)
    const resumeES = mine().filter((es) => es !== projES).pop();
    assert.ok(resumeES && resumeES !== projES, 'warm-stale opened a replacement connection');
    assert.ok(resumeES.url.includes('project=projQ'), `resume URL: ${resumeES.url}`);
    const since = new URLSearchParams(resumeES.url.split('?')[1]).get('since');
    assert.equal(since, '2026-10-13T00:02:00Z', 'resume URL carries the committed cursor');
    assert.equal(new URLSearchParams(resumeES.url.split('?')[1]).get('cc'), '1', 'cc = baseline count');
  });
});
