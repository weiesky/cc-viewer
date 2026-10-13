/**
 * turn_end scope gating, CLIENT side (per-workspace SSE channels, 2026-10) —
 * RUNTIME contract.
 *
 * turn_end is now scope-routed server-side (additive project/instance on the
 * frame), so the SDK-mode "deliberately ignore turn_end in PTY mode" hack is
 * gone: a turn_end carrying THIS channel's scope clears its turn-level loading
 * flag (incl. SDK mode) and rings the voice pack on the rendered channel. A
 * frame for a background project clears only that background channel's vm —
 * never the rendered view's spinner, and never a sound.
 *
 * Runtime style follows sid-not-found-live-empty.test.js (real AppBase bundled
 * with esbuild; `@ccv/core` resolved for real so the voice-pack player works).
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
const BUNDLE_DIR = join(WEB_ROOT, 'node_modules', '.cache', 'ccv-turn-end-scope');
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

const entry = (ts, text) => JSON.stringify({ timestamp: ts, url: '/v1/messages', mainAgent: true, body: { messages: [{ role: 'user', content: text }] } });


describe('turn_end scope gating (client)', () => {
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

  /** Mount + commit the bound channel (projectName bound 'boundProj'). */
  async function mountCommitted() {
    const from = esList.length;
    const inst = await mount();
    const mine = () => esList.slice(from);
    inst.setState({ projectName: 'boundProj' });
    const boundES = mine()[0];
    fire(boundES, 'load_start', { total: 1, incremental: false });
    fire(boundES, 'load_chunk', `[${entry('2026-10-13T00:00:01Z', 'bound hi')}]`);
    fire(boundES, 'load_end', {});
    await sleep(250);
    return { inst, mine, boundES };
  }

  /** A scope-matching live turn source: PTY turn_active lights the flag. */
  const lightTurn = (es, scopeData = {}) => fire(es, 'turn_active', { active: true, ...scopeData });

  it('a matching turn_end clears the turn-level flag in PTY mode (the old SDK-only hack is gone)', async () => {
    const { inst, boundES } = await mountCommitted();
    lightTurn(boundES, { project: 'boundProj' });
    await sleep(40);
    assert.equal(inst.state.turnActive, true, 'turn lit');
    // SDK OFF (PTY): the frame used to be deliberately ignored here.
    fire(boundES, 'turn_end', { project: 'boundProj', ts: 111 });
    await sleep(40);
    assert.equal(inst.state.turnActive, false, 'a scope-matching turn_end clears the flag in PTY mode');
  });

  it('a mismatched-project turn_end leaves the rendered spinner alone', async () => {
    const { inst, boundES } = await mountCommitted();
    lightTurn(boundES, { project: 'boundProj' });
    await sleep(40);
    // Defensive guard: a foreign project's turn_end must never kill this view.
    fire(boundES, 'turn_end', { project: 'otherProj', ts: 112 });
    await sleep(40);
    assert.equal(inst.state.turnActive, true, 'foreignproject turn_end ignored');
  });

  it('an instance-scoped channel drops a turn_end for a DIFFERENT instance', async () => {
    const { inst, mine } = await mountCommitted();
    inst.handleActivateChip({ project: 'projI', instanceKey: 'ccv-aaaa' });
    await sleep(30);
    const instES = mine()[1];
    fire(instES, 'load_start', { total: 0, incremental: false });
    fire(instES, 'load_end', {});
    await sleep(150);
    assert.equal(inst._channels.getRendered().key, 'project:projI\x00ccv-aaaa');
    lightTurn(instES, { project: 'projI', instance: 'ccv-aaaa' });
    await sleep(40);
    assert.equal(inst.state.turnActive, true, 'instance turn lit');
    fire(instES, 'turn_end', { project: 'projI', instance: 'ccv-bbbb', ts: 113 });
    await sleep(40);
    assert.equal(inst.state.turnActive, true, 'a twin instance turn_end is ignored');
    fire(instES, 'turn_end', { project: 'projI', instance: 'ccv-aaaa', ts: 114 });
    await sleep(40);
    assert.equal(inst.state.turnActive, false, 'the matching instance turn_end clears');
  });

  it('a BACKGROUND project\'s turn_end clears only that channel (no voicePack on the rendered view)', async () => {
    const { inst, mine, boundES } = await mountCommitted();
    inst.handleActivateChip({ project: 'projP' });
    await sleep(30);
    const projES = mine()[1];
    fire(projES, 'load_start', { total: 1, incremental: false });
    fire(projES, 'load_chunk', `[${entry('2026-10-13T00:01:00Z', 'P hi')}]`);
    fire(projES, 'load_end', {});
    await sleep(250);
    const projCh = inst._channels.get('project:projP');

    // Rendered view (projP) is mid-turn; bound goes background and its own
    // turn ends — that must clear ONLY the bound channel's own state.
    lightTurn(projES, { project: 'projP' });
    lightTurn(boundES, { project: 'boundProj' });
    await sleep(40);
    assert.equal(inst.state.turnActive, true, 'rendered projP turn lit');
    assert.equal(inst._channels.get('bound').vm.react.turnActive, true, 'background bound turn lit');
    fire(boundES, 'turn_end', { project: 'boundProj', ts: 115 });
    await sleep(40);
    assert.equal(inst._channels.get('bound').vm.react.turnActive, false, 'background clear applies to the background channel');
    assert.equal(inst.state.turnActive, true, 'the rendered view spinner survives a background turn end');
    assert.equal(projCh.vm.react.turnActive, true, 'the rendered channel vm untouched');
  });
});
