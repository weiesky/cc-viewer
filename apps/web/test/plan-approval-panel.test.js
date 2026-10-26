import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE_DIR = join(WEB_ROOT, 'node_modules', '.cache', 'ccv-plan-approval-panel-test');
const BUNDLE = join(BUNDLE_DIR, `ToolApprovalPanel-${process.pid}.mjs`);
let React, ReactDOMClient, ToolApprovalPanel;

function installDom() {
  class NodeBase {}
  for (const name of ['HTMLElement', 'HTMLIFrameElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLButtonElement', 'HTMLDivElement', 'HTMLSpanElement', 'HTMLAnchorElement', 'HTMLBodyElement', 'HTMLHtmlElement', 'HTMLCanvasElement', 'HTMLImageElement', 'SVGElement', 'Element', 'DocumentFragment', 'Text', 'Comment', 'CharacterData', 'Document', 'Window', 'Event']) globalThis[name] = class extends NodeBase {};
  const el = (tag = 'div') => {
    const node = Object.assign(Object.create(globalThis.HTMLElement.prototype), {
      nodeType: 1, nodeName: tag.toUpperCase(), tagName: tag.toUpperCase(), localName: tag,
      namespaceURI: 'http://www.w3.org/1999/xhtml', parentNode: null,
      id: '',
      style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      childNodes: [], children: [], firstChild: null, lastChild: null, textContent: '', innerHTML: '', innerText: '', value: '',
      setAttribute(name, value) { this[name] = value; }, getAttribute(name) { return this[name] ?? null; }, removeAttribute() {}, hasAttribute: () => false,
      appendChild(c) { c.parentNode = this; this.childNodes.push(c); this.children.push(c); this.firstChild = this.childNodes[0]; this.lastChild = this.childNodes[this.childNodes.length - 1]; return c; },
      removeChild(c) { this.childNodes = this.childNodes.filter((child) => child !== c); this.children = this.children.filter((child) => child !== c); this.firstChild = this.childNodes[0] || null; this.lastChild = this.childNodes[this.childNodes.length - 1] || null; return c; },
      insertBefore(c) { return this.appendChild(c); }, replaceChild(c) { return c; },
      addEventListener() {}, removeEventListener() {}, remove() {}, focus() { globalThis.document.activeElement = this; }, blur() {}, click() {}, dispatchEvent() { return true; },
      querySelector: () => null, querySelectorAll: () => [], closest: () => null,
      contains(other) { for (let current = other; current; current = current.parentNode) if (current === this) return true; return false; },
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
    addEventListener(type, listener) { (this.listeners ||= new Map()).set(type, listener); },
    removeEventListener(type, listener) { if (this.listeners?.get(type) === listener) this.listeners.delete(type); },
    body: el('body'), head: el('head'), documentElement: el('html'), activeElement: null,
  };
  globalThis.window = globalThis;
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node' }, configurable: true });
  globalThis.location = { search: '', pathname: '/', href: 'http://localhost/', hash: '' };
  globalThis.requestAnimationFrame = (cb) => { cb(Date.now()); return 1; };
  globalThis.cancelAnimationFrame = clearTimeout;
}

before(async () => {
  installDom();
  const appRequire = createRequire(join(WEB_ROOT, 'package.json'));
  const esbuild = await import(pathToFileURL(createRequire(appRequire.resolve('vite')).resolve('esbuild')).href);
  const result = await esbuild.build({
    entryPoints: [join(WEB_ROOT, 'src/components/approval/ToolApprovalPanel.jsx')],
    bundle: true, format: 'esm', platform: 'node', write: false,
    jsx: 'automatic', loader: { '.jsx': 'jsx', '.js': 'jsx' },
    plugins: [{
      name: 'ccv-test-assets',
      setup(build) {
        build.onResolve({ filter: /\.(css|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|eot|mp3|wav|ogg)(\?.*)?$/ }, (args) => ({ path: args.path, namespace: 'asset' }));
        build.onLoad({ filter: /.*/, namespace: 'asset' }, (args) => ({
          contents: /\.css(\?.*)?$/.test(args.path) ? 'export default new Proxy({}, { get: () => "" });' : 'export default "";', loader: 'js',
        }));
      },
    }],
    external: ['react', 'react-dom', 'react-dom/client', 'react-dom/test-utils'], logLevel: 'silent',
  });
  mkdirSync(BUNDLE_DIR, { recursive: true });
  writeFileSync(BUNDLE, result.outputFiles[0].contents);
  React = (await import('react')).default;
  ReactDOMClient = await import('react-dom/client');
  ToolApprovalPanel = (await import(pathToFileURL(BUNDLE).href)).default;
});


describe('ToolApprovalPanel plan auto-approval keyboard behavior', () => {
  it('keeps composer focus, cancels on Escape, then permits explicit denial', async () => {
    const composer = globalThis.document.createElement('textarea');
    globalThis.document.activeElement = composer;
    const calls = [];
    const root = ReactDOMClient.createRoot(globalThis.document.createElement('div'));
    root.render(React.createElement(ToolApprovalPanel, {
      toolName: 'ExitPlanMode', toolInput: { plan: 'test plan' }, requestId: 'plan-1',
      visible: true, planAutoApproveSeconds: 3, planAutoApproveCountdown: 3,
      onAllow: () => calls.push('allow'),
      onDeny: () => calls.push('deny'),
      onCancelPlanAutoApprove: () => {
        calls.push('cancel');
        root.render(React.createElement(ToolApprovalPanel, {
          toolName: 'ExitPlanMode', toolInput: { plan: 'test plan' }, requestId: 'plan-1',
          visible: true, planAutoApproveSeconds: 3, planAutoApproveCountdown: null,
          onAllow: () => calls.push('allow'),
          onDeny: () => calls.push('deny'),
          onCancelPlanAutoApprove: () => calls.push('cancel'),
        }));
      },
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(globalThis.document.activeElement, composer, 'auto-approval must not steal focus');

    const findKeyHandler = (fiber) => {
      if (!fiber) return null;
      if (fiber.memoizedProps?.onKeyDown) return fiber.memoizedProps.onKeyDown;
      return findKeyHandler(fiber.child) || findKeyHandler(fiber.sibling);
    };
    const container = root._internalRoot?.current;
    assert.ok(container, 'React root should expose its current fiber for this local harness');
    const keyHandler = findKeyHandler(container);
    assert.equal(typeof keyHandler, 'function');
    keyHandler({ key: 'Escape', preventDefault() {} });
    assert.deepEqual(calls, ['cancel']);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(globalThis.document.activeElement, composer, 'cancel must restore the previous composer focus');
    const currentKeyHandler = findKeyHandler(root._internalRoot?.current);
    assert.equal(typeof currentKeyHandler, 'function');
    // After cancellation the plan stays visible in manual mode, so a second Escape
    // uses the panel's normal deny handler rather than auto-approving anything.
    currentKeyHandler({ key: 'Escape', preventDefault() {} });
    assert.deepEqual(calls, ['cancel', 'deny']);
    root.unmount();
    assert.equal(globalThis.document.activeElement, composer);
  });

  it('preserves focus restoration for manual plan approval', async () => {
    const composer = globalThis.document.createElement('textarea');
    globalThis.document.activeElement = composer;
    const root = ReactDOMClient.createRoot(globalThis.document.createElement('div'));
    root.render(React.createElement(ToolApprovalPanel, {
      toolName: 'ExitPlanMode', toolInput: { plan: 'manual plan' }, requestId: 'manual-plan',
      visible: true, planAutoApproveSeconds: 0, onDeny() {}, onAllow() {},
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const allow = globalThis.document.activeElement;
    assert.equal(allow?.localName, 'button', 'manual panel should focus its Allow button');
    assert.equal(allow.textContent, 'Allow', 'the focused button must be Allow, not Deny');
    root.unmount();
    assert.equal(globalThis.document.activeElement, composer, 'closing the manual panel should restore composer focus');
  });

  it('does not steal focus from the settings control when approval is disabled', async () => {
    const settingsControl = globalThis.document.createElement('input');
    globalThis.document.activeElement = settingsControl;
    const root = ReactDOMClient.createRoot(globalThis.document.createElement('div'));
    const render = (seconds) => root.render(React.createElement(ToolApprovalPanel, {
      toolName: 'ExitPlanMode', toolInput: { plan: 'test plan' }, requestId: 'plan-1',
      visible: true, planAutoApproveSeconds: seconds,
      planAutoApproveCountdown: seconds ? seconds : null,
      onAllow() {}, onDeny() {}, onCancelPlanAutoApprove() {},
    }));
    render(10);
    await new Promise((resolve) => setTimeout(resolve, 20));
    render(0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(globalThis.document.activeElement, settingsControl, 'disabling auto-approve must not focus the background panel');
    root.unmount();
  });
});
