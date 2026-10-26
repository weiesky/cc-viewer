import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(HERE, '..');
const ENTRY = join(HERE, 'fixtures', 'sdk-context-provider-probe.jsx');
const BUNDLE_DIR = join(WEB_ROOT, 'node_modules', '.cache', 'ccv-sdk-context-provider');
const BUNDLE = join(BUNDLE_DIR, 'provider.bundle.mjs');
let React, ReactDOMClient, probe;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function installDom() {
  class NodeBase {}
  for (const name of ['HTMLElement', 'HTMLIFrameElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLButtonElement', 'HTMLDivElement', 'HTMLSpanElement', 'HTMLAnchorElement', 'HTMLBodyElement', 'HTMLHtmlElement', 'HTMLCanvasElement', 'HTMLImageElement', 'SVGElement', 'Element', 'DocumentFragment', 'Text', 'Comment', 'CharacterData', 'Document', 'Window', 'Event']) globalThis[name] = class extends NodeBase {};
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
  globalThis.document = {
    nodeType: 9, createElement: el, createElementNS: (ns, t) => el(t), createTextNode: () => el('#text'),
    createDocumentFragment: () => el('#fragment'), createComment: () => el('#comment'),
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    addEventListener() {}, removeEventListener() {}, body: el('body'), head: el('head'), documentElement: el('html'), activeElement: null,
  };
  globalThis.window = globalThis;
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node' }, configurable: true });
  globalThis.location = { search: '', pathname: '/', href: 'http://localhost/', hash: '' };
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  globalThis.cancelAnimationFrame = clearTimeout;
}

describe('SdkContextUsageProvider — real hook lifecycle', () => {
  let root, ws, fetches, deferred;
  const usage = { totalTokens: 100, maxTokens: 1000, percentage: 10, categories: [] };
  const frame = (project = 'demo', instanceKey = 'one', ts = 1) => ({
    type: 'sdk-context-usage', cwd: `/tmp/${project}`, instanceKey, sessionId: 's', ts, usage,
  });

  before(async () => {
    installDom();
    const appReq = createRequire(join(WEB_ROOT, 'package.json'));
    const esbuild = await import(pathToFileURL(createRequire(appReq.resolve('vite')).resolve('esbuild')).href);
    const result = await esbuild.build({
      entryPoints: [ENTRY], bundle: true, format: 'esm', platform: 'node', write: false,
      jsx: 'automatic', loader: { '.jsx': 'jsx', '.js': 'jsx' },
      resolveExtensions: ['.js', '.jsx', '.json'],
      external: ['react', 'react-dom', 'react-dom/client', 'react-dom/test-utils'],
      logLevel: 'silent',
    });
    mkdirSync(BUNDLE_DIR, { recursive: true });
    writeFileSync(BUNDLE, result.outputFiles[0].contents);
    React = (await import('react')).default;
    ReactDOMClient = await import('react-dom/client');
    probe = await import(pathToFileURL(BUNDLE).href);
  });

  after(() => { setTimeout(() => process.exit(0), 30).unref(); });

  async function mount(props = {}) {
    ws = { messages: new Set(), states: new Set() };
    fetches = [];
    deferred = [];
    let firstInactive = !!props.initialInactive;
    globalThis.fetch = (url) => {
      fetches.push(url);
      const inactive = firstInactive;
      firstInactive = false;
      return new Promise((resolve) => deferred.push(() => resolve({ json: async () => {
        if (props.onFetch) return props.onFetch(url, inactive);
        return inactive ? { ok: false, reason: 'session-inactive' } : { ok: true, snapshot: frame() };
      } })));
    };
    const view = {
      enabled: false, viewProject: 'demo', viewInstance: 'one', clearVersion: 0, ...props,
    };
    root = ReactDOMClient.createRoot(globalThis.document.createElement('div'));
    const render = (next) => root.render(React.createElement(probe.ProviderProbe, {
      ...view, ...next, ws: {
        addMessageHandler: (fn) => { ws.messages.add(fn); return () => ws.messages.delete(fn); },
        addStateListener: (fn) => { ws.states.add(fn); return () => ws.states.delete(fn); },
      },
    }));
    render();
    await sleep(15);
    return { render, emit: async (msg) => { ws.messages.forEach((fn) => fn(msg)); await sleep(10); } };
  }

  it('does no work for PTY/unresolved view, then fetches on SDK enablement', async () => {
    const app = await mount();
    assert.equal(fetches.length, 0);
    assert.equal(probe.latest.enabled, false);
    app.render({ enabled: true });
    await sleep(10);
    assert.deepEqual(fetches, ['/api/sdk-context-usage?project=demo&instance=one']);
    deferred.shift()();
    await sleep(10);
    assert.equal(probe.latest.detail.usage.totalTokens, 100);
    assert.equal(probe.latest.status, 'ready');
    await app.emit(frame('demo', 'two', 2));
    assert.equal(probe.latest.detail.ts, 1, 'foreign instance never lands');
    root.unmount();
  });

  it('dedupes initial open and allows confirmed project-only WS updates', async () => {
    const app = await mount({ enabled: true, viewInstance: null });
    assert.equal(fetches.length, 1);
    ws.states.forEach((fn) => fn('open'));
    await sleep(5);
    assert.equal(fetches.length, 1, 'in-flight open shares the same request');
    deferred.shift()();
    await sleep(10);
    await app.emit(frame('demo', 'one', 2));
    assert.equal(probe.latest.detail.ts, 2, 'HTTP-confirmed instance can stream');
    await app.emit(frame('demo', 'two', 3));
    assert.equal(probe.latest.detail.ts, 2, 'another twin is rejected');
    root.unmount();
  });

  it('reuses no learned instance after a scope change to an unpinned view', async () => {
    const app = await mount({ enabled: true, viewInstance: null });
    deferred.shift()();
    await sleep(10);
    assert.equal(probe.latest.detail.instanceKey, 'one');
    app.render({ enabled: true, viewInstance: null, viewProject: 'other' });
    await sleep(5);
    assert.equal(fetches.at(-1), '/api/sdk-context-usage?project=other');
    root.unmount();
  });

  it('re-discovers an inferred instance after it is replaced', async () => {
    let replacement = false;
    const app = await mount({
      enabled: true, viewInstance: null,
      onFetch: (url) => replacement && url.includes('instance=one')
        ? { ok: false, reason: 'session-inactive' }
        : { ok: true, snapshot: frame('demo', replacement ? 'two' : 'one', replacement ? 2 : 1) },
    });
    deferred.shift()();
    await sleep(10);
    replacement = true;
    ws.states.forEach((fn) => fn('open'));
    await sleep(5);
    assert.match(fetches.at(-1), /instance=one/);
    deferred.shift()();
    await sleep(5);
    assert.equal(fetches.length, 3, 'inactive inferred instance retries once project-only');
    deferred.shift()();
    await sleep(10);
    assert.equal(probe.latest.status, 'ready');
    root.unmount();
  });

  it('queues first-turn rediscovery when the initial pull is still in flight', async () => {
    const app = await mount({ enabled: true, viewInstance: null, initialInactive: true });
    await app.emit(frame('demo', 'one', 2));
    assert.equal(fetches.length, 1);
    deferred.shift()();
    await sleep(10);
    assert.equal(fetches.length, 2, 'WS recovery leaves one rerun after the older inactive response');
    deferred.shift()();
    await sleep(10);
    assert.equal(probe.latest.status, 'ready');
    root.unmount();
  });

  it('re-pulls when a project-only first-turn frame arrives after an inactive pull', async () => {
    const app = await mount({ enabled: true, viewInstance: null, initialInactive: true });
    deferred.shift()();
    await sleep(10);
    assert.equal(probe.latest.status, 'inactive');
    await app.emit(frame('demo', 'one', 2));
    assert.equal(fetches.length, 2, 'stamped frame proves the query now exists and triggers one anchored retry');
    deferred.shift()();
    await sleep(10);
    assert.equal(probe.latest.status, 'ready');
    assert.equal(probe.latest.detail.ts, 1);
    root.unmount();
  });

  it('holds zero after clear until a fresh snapshot, and resets on scope switch', async () => {
    const app = await mount({ enabled: true });
    deferred.shift()();
    await sleep(10);
    assert.equal(probe.latest.status, 'ready');
    assert.equal(fetches.length, 1);
    app.render({ enabled: true, clearVersion: 1, locked: true });
    await sleep(15);
    await sleep(5);
    assert.equal(probe.latest.awaitingFresh, true);
    assert.equal(probe.latest.locked, true);
    deferred.shift()();
    await sleep(10);
    assert.equal(probe.latest.awaitingFresh, true, 'HTTP before the server clear frame is still pre-clear data');
    await app.emit({ ...frame('demo', 'one', 2), trigger: 'context-cleared', usage: null });
    await app.emit(frame('demo', 'one', 3));
    assert.equal(probe.latest.awaitingFresh, false);
    assert.equal(probe.latest.detail.ts, 3);
    app.render({ enabled: true, clearVersion: 1, locked: false, viewProject: 'other' });
    await sleep(5);
    assert.equal(probe.latest.detail, null, 'old view cannot leak into the new view');
    assert.match(fetches.at(-1), /project=other/);
    root.unmount();
  });
});
