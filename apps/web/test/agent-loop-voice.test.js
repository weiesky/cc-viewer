/**
 * agent-loop SSE frames (client) — voice + turn-level contract.
 *
 * The new agent_loop_start / agent_loop_end frames are the authoritative
 * per-turn loop lifecycle. This file pins the client semantics:
 *  - agent_loop_start lights turnActive AND isStreaming immediately (the
 *    spinner shows at prompt/push time, not at the first API call) and rings
 *    the opt-in agentLoopStart cue once per turn (dedupe by turnId);
 *  - agent_loop_end clears the turn on its OWN channel, rings agentLoopEnd on
 *    the rendered channel only (a background project's end stays silent), and
 *    an actual play suppresses the legacy turnEnd ring for the same boundary
 *    (double-ring suppression via lastAgentLoopEnd);
 *  - frames carry scope (project/instance) exactly like turn_end.
 *
 * Harness mirrors turn-end-scope-client.test.js: real AppBase bundled with
 * esbuild, `@ccv/core` real, voicePackPlayer real with a MockAudio spy.
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
const BUNDLE_DIR = join(WEB_ROOT, 'node_modules', '.cache', 'ccv-agent-loop-voice');
const BUNDLE = join(BUNDLE_DIR, 'appbase.bundle.mjs');

// ── Audio spy: the real voicePackPlayer targets this instead of HTMLAudioElement ──
class MockAudio {
  static instances = [];
  static last = null; // the module-level mainAudio singleton survives instances=[] resets
  constructor() {
    this.src = '';
    this.volume = 1;
    this.preload = '';
    this.currentTime = 0;
    this._listeners = {};
    MockAudio.instances.push(this);
    MockAudio.last = this;
  }
  addEventListener(name, fn) { (this._listeners[name] = this._listeners[name] || []).push(fn); }
  removeEventListener() {}
  pause() {}
  play() {
    // Auto-"finish" on the next microtask so the player's serial queue never
    // stays stuck across cases (a real <audio> ends; our mock otherwise parks
    // `playing` forever and every later case's play silently enqueues).
    queueMicrotask(() => this.fire('ended'));
    return Promise.resolve();
  }
  fire(name) { (this._listeners[name] || []).forEach((f) => f()); }
}

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
    documentElement: el('html'), activeElement: null, hasFocus: () => true,
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
  globalThis.Audio = MockAudio;
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

/** Bundle the real AppBase; `@ccv/core` is bundled for REAL (same sanctioned
 *  pattern as turn-end-scope-client.test.js) so the voice-pack player works. */
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

let esList = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fire = (es, name, data) => (es.listeners[name] || []).forEach((f) => f({ data: typeof data === 'string' ? data : JSON.stringify(data) }));
const entry = (ts, text) => JSON.stringify({ timestamp: ts, url: '/v1/messages', mainAgent: true, body: { messages: [{ role: 'user', content: text }] } });

const voicePrefsOn = (over = {}) => ({
  enabled: true,
  volume: 0.5,
  events: {
    planApproval: null,
    askQuestion: null,
    turnEnd: 'default',
    agentLoopStart: 'default',
    agentLoopEnd: 'default',
    ...over,
  },
});

describe('agent_loop SSE frames (client)', () => {
  before(async () => {
    installDomShim();
    globalThis.EventSource = class {
      constructor(url) {
        this.url = url;
        this.listeners = {};
        this.readyState = 1;
        this.close = () => { this.readyState = 2; };
        esList.push(this);
      }
      addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
    };
    // WS-mux capability probe failure → synchronous fallback to native EventSource.
    globalThis.WebSocket = class { constructor() { throw new Error('ws disabled in test'); } };

    await buildAppBaseBundle();
    React = (await import('react')).default;
    ReactDOMClient = await import('react-dom/client');
    AppBase = (await import(pathToFileURL(BUNDLE).href)).default;
  });

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
    await sleep(150);
    assert.ok(ref.current, 'AppBase instance mounted');
    return ref.current;
  }

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

  function enableVoice(inst, over = {}) {
    // Direct in-place mutation (not setState): the mount-time prefs hydrate is
    // async and would clobber a setState seed with the locale defaults before the
    // fired frame lands. The handler reads approvalPrefs synchronously at fire
    // time, so an in-place write is race-free and exactly what the handler sees.
    inst.state.approvalPrefs = { ...inst.state.approvalPrefs, voicePack: voicePrefsOn(over) };
  }

  // The bundled player's module-level queue survives across cases in this file and
  // `playing` stays true until an 'ended' fires (MockAudio never auto-fires) —
  // without a drain, every later case's play just enqueues behind the stuck one
  // and no new Audio instance appears. The mainAudio singleton may predate an
  // instances=[] reset, so drain via MockAudio.last as well as any live instances.
  function drainAudio() {
    const targets = new Set([...MockAudio.instances, MockAudio.last].filter(Boolean));
    for (const a of targets) { try { a.fire('ended'); } catch {} }
  }

  it('agent_loop_start lights turnActive AND isStreaming immediately; agent_loop_end clears both', async () => {
    const { inst, boundES } = await mountCommitted();
    assert.equal(inst.state.turnActive, false);
    fire(boundES, 'agent_loop_start', { project: 'boundProj', ts: 1000, mode: 'sdk', turnId: 't1', turnStartedAt: 500 });
    await sleep(40);
    assert.equal(inst.state.turnActive, true, 'turn lit at loop start');
    assert.equal(inst.state.isStreaming, true, 'spinner lit at loop start (not at first API call)');
    fire(boundES, 'agent_loop_end', { project: 'boundProj', ts: 2000, mode: 'sdk', turnId: 't1', turnStartedAt: 500, reason: 'success' });
    await sleep(40);
    assert.equal(inst.state.turnActive, false);
    assert.equal(inst.state.isStreaming, false);
  });

  it('agent_loop_end rings agentLoopEnd once per turnId on the rendered channel', async () => {
    const { inst, boundES } = await mountCommitted();
    enableVoice(inst);
    drainAudio();
    MockAudio.instances = [];
    fire(boundES, 'agent_loop_end', { project: 'boundProj', ts: 3000, mode: 'sdk', turnId: 't7', reason: 'success' });
    await sleep(60);
    const hits1 = MockAudio.instances.filter((a) => /agentLoopEnd$/.test(a.src));
    assert.equal(hits1.length, 1, 'the boundary rings once');
    // A re-broadcast of the SAME turn's end (two SSE delivery paths) is deduped.
    fire(boundES, 'agent_loop_end', { project: 'boundProj', ts: 3000, mode: 'sdk', turnId: 't7', reason: 'success' });
    await sleep(60);
    const hits2 = MockAudio.instances.filter((a) => /agentLoopEnd$/.test(a.src));
    assert.equal(hits2.length, 1, 'same turnId re-broadcast is silent');
  });

  it('an actual agentLoopEnd play suppresses the legacy turnEnd ring for the same boundary', async () => {
    const { inst, boundES } = await mountCommitted();
    enableVoice(inst);
    drainAudio();
    // Watch src assignments on the shared mainAudio (the player reuses ONE
    // element, so instance COUNT can't observe later plays — src history can).
    const srcLog = [];
    const seen = new Set([...MockAudio.instances, MockAudio.last].filter(Boolean));
    for (const a of seen) {
      if (a.__srcLogged) continue;
      a.__srcLogged = true;
      let cur = a.src;
      Object.defineProperty(a, 'src', {
        get: () => cur,
        set: (v) => { cur = v; srcLog.push(v); },
        configurable: true,
      });
    }
    const ts = 4000;
    fire(boundES, 'agent_loop_end', { project: 'boundProj', ts, mode: 'sdk', turnId: 't9', sessionId: 's1', reason: 'success' });
    await sleep(60);
    // The debounced turn_end arrives later with the SAME boundary ts + session.
    fire(boundES, 'turn_end', { project: 'boundProj', ts, sessionId: 's1' });
    await sleep(60);
    const endHits = srcLog.filter((s) => /agentLoopEnd$/.test(s));
    const turnHits = srcLog.filter((s) => /\/turnEnd$/.test(s));
    assert.equal(endHits.length, 1, 'agentLoopEnd rang');
    assert.equal(turnHits.length, 0, 'legacy turnEnd voice is suppressed for the same boundary');
  });

  it('a background project agent_loop_end clears only that channel and never rings', async () => {
    const { inst, mine, boundES } = await mountCommitted();
    enableVoice(inst);
    inst.handleActivateChip({ project: 'projP' });
    await sleep(30);
    const projES = mine()[1];
    fire(projES, 'load_start', { total: 1, incremental: false });
    fire(projES, 'load_chunk', `[${entry('2026-10-13T00:01:00Z', 'P hi')}]`);
    fire(projES, 'load_end', {});
    await sleep(250);

    // Rendered view = projP; bound goes background and its loop ends.
    fire(projES, 'agent_loop_start', { project: 'projP', ts: 5000, mode: 'sdk', turnId: 'tp1', turnStartedAt: 100 });
    fire(boundES, 'agent_loop_start', { project: 'boundProj', ts: 5001, mode: 'sdk', turnId: 'tb1', turnStartedAt: 101 });
    await sleep(40);
    assert.equal(inst.state.turnActive, true, 'rendered projP lit');
    assert.equal(inst._channels.get('bound').vm.react.turnActive, true, 'background bound lit');

    drainAudio();
    // Watch src assignments on the shared mainAudio (playback reuses ONE element —
    // instance COUNT can't observe a ring, the src history can).
    const srcLog = [];
    for (const a of new Set([...MockAudio.instances, MockAudio.last].filter(Boolean))) {
      if (a.__srcLogged) continue;
      a.__srcLogged = true;
      let cur = a.src;
      Object.defineProperty(a, 'src', { get: () => cur, set: (v) => { cur = v; srcLog.push(v); }, configurable: true });
    }
    MockAudio.instances = [];
    fire(boundES, 'agent_loop_end', { project: 'boundProj', ts: 6000, mode: 'sdk', turnId: 'tb1', reason: 'success' });
    await sleep(60);
    assert.equal(inst._channels.get('bound').vm.react.turnActive, false, 'background clear applies to its own channel');
    assert.equal(inst.state.turnActive, true, 'rendered spinner survives a background loop end');
    assert.equal(srcLog.filter((s) => /agentLoopEnd$/.test(s)).length, 0,
      'a background loop end never rings on the rendered view');
  });

  it('agent_loop frames honor the instance scope guard (twin frames dropped)', async () => {
    const { inst, mine } = await mountCommitted();
    inst.handleActivateChip({ project: 'projI', instanceKey: 'ccv-aaaa' });
    await sleep(30);
    const instES = mine()[1];
    fire(instES, 'load_start', { total: 0, incremental: false });
    fire(instES, 'load_end', {});
    await sleep(150);
    assert.equal(inst._channels.getRendered().key, 'project:projI\x00ccv-aaaa');
    fire(instES, 'agent_loop_start', { project: 'projI', instance: 'ccv-aaaa', ts: 7000, mode: 'sdk', turnId: 'ti1', turnStartedAt: 1 });
    await sleep(40);
    assert.equal(inst.state.turnActive, true);
    fire(instES, 'agent_loop_end', { project: 'projI', instance: 'ccv-bbbb', ts: 8000, mode: 'sdk', turnId: 'tiX', reason: 'success' });
    await sleep(40);
    assert.equal(inst.state.turnActive, true, 'a twin instance loop end is ignored');
    fire(instES, 'agent_loop_end', { project: 'projI', instance: 'ccv-aaaa', ts: 8001, mode: 'sdk', turnId: 'ti1', reason: 'success' });
    await sleep(40);
    assert.equal(inst.state.turnActive, false, 'the matching instance loop end clears');
  });
});
