import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import './_shims/register.mjs';

const { loadPanelScript, loadPanelStyles } = await import('../src/utils/panelLoader.js');
const { installPanelRuntime } = await import('../src/components/plugins/panelRuntime.js');

// node:test has no DOM: inject fake doc/win. The fake script's src setter triggers bundle execution
// (matching real browsers: a classic script executes synchronously after insertion; currentScript points at itself).

function makeFakeDom({ fixture, manual = false }) {
  const listeners = new Map(); // type -> Set<cb> (real DOM allows many listeners per type)
  const win = {
    addEventListener(type, cb) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(cb);
    },
    removeEventListener(type, cb) { listeners.get(type)?.delete(cb); },
    _fireError(event) {
      for (const cb of listeners.get('error') || []) cb(event);
    },
  };
  installPanelRuntime(win, null); // doc is wired later - registerPanel reads doc.currentScript

  const scripts = [];
  const links = [];
  let currentScript = null;
  const doc = {
    head: {
      appendChild(el) {
        if (el.tagName === 'script' || el.src) {
          scripts.push(el);
          // Some tests keep the script pending to simulate late execution.
          if (manual) return el;
          // Execute the bundle synchronously (real browsers: runs on insert, onload fires afterwards)
          currentScript = el;
          try {
            const fn = new Function('window', 'document', fixture);
            fn(win, doc);
          } catch (err) {
            currentScript = null;
            if (listeners.get('error')?.size) win._fireError({ filename: el.src, message: err.message });
            else if (el.onerror) el.onerror(err);
            return el;
          }
          currentScript = null;
          if (el.onload) el.onload();
        } else {
          links.push(el);
          el._parent = this;
        }
        return el;
      },
    },
    createElement(tag) {
      const el = {
        tagName: tag,
        attrs: {},
        children: [],
        setAttribute(k, v) { this.attrs[k] = v; if (k === 'data-ccv-load') this._loadId = v; },
        getAttribute(k) { return this.attrs[k] ?? null; },
        remove() { this._removed = true; },
      };
      if (tag === 'script') {
        Object.defineProperty(el, 'src', {
          get() { return this._src; },
          set(v) { this._src = v; },
        });
      }
      if (tag === 'link') {
        Object.defineProperty(el, 'href', {
          get() { return this._href; },
          set(v) { this._href = v; },
        });
      }
      return el;
    },
    get currentScript() { return currentScript; },
  };
  // Re-install the runtime (this time with the real doc)
  delete win.CCV;
  installPanelRuntime(win, doc);
  return {
    win, doc, scripts, links,
    setCurrentScript: (el) => { currentScript = el; },
  };
}

const GOOD_FIXTURE = `window.CCV.registerPanel('demo-panel', function Panel(){ return null; });`;

describe('panelLoader.loadPanelScript', () => {
  it('resolves the registered component on success', async () => {
    const { win, doc } = makeFakeDom({ fixture: GOOD_FIXTURE });
    const { component } = await loadPanelScript('/plugin-panels/demo/index.js?v=1', { name: 'demo-panel', win, doc });
    assert.equal(typeof component, 'function');
  });

  it('appends attempt cache-buster and a per-load nonce to the URL', async () => {
    const { win, doc, scripts } = makeFakeDom({ fixture: GOOD_FIXTURE });
    await loadPanelScript('/x/index.js?v=1', { name: 'demo-panel', attempt: 3, win, doc });
    assert.match(scripts[0].src, /\?v=1&r=3&lid=/);
  });

  it('abort() rejects with code aborted, removes the script and detaches listeners', async () => {
    const { win, doc, scripts } = makeFakeDom({ fixture: '', manual: true });
    const pending = loadPanelScript('/x/index.js', { name: 'demo-panel', win, doc });
    const script = scripts[0];
    pending.abort();
    await assert.rejects(pending, (err) => err.code === 'aborted');
    assert.equal(script._removed, true);
    // No listener left behind: a late error event must not throw or re-settle anything.
    win._fireError({ filename: script.src, message: 'late boom' });
  });

  it('tombstones the loadId so a bundle that still executes cannot register after abort', async () => {
    const { win, doc, scripts, setCurrentScript } = makeFakeDom({ fixture: '', manual: true });
    const pending = loadPanelScript('/x/index.js', { name: 'demo-panel', win, doc });
    const script = scripts[0];
    const loadId = script.getAttribute('data-ccv-load');
    pending.abort();
    await assert.rejects(pending, (err) => err.code === 'aborted');

    setCurrentScript(script);
    const ok = win.CCV.registerPanel('demo-panel', function LatePanel() {});
    setCurrentScript(null);
    assert.equal(ok, false, 'aborted load registration must be dropped');
    assert.equal(win.CCV._consumeRegistration(loadId), null);
  });

  it('a delayed error from an aborted load cannot affect the next load of the same panel', async () => {
    const { win, doc, scripts, setCurrentScript } = makeFakeDom({ fixture: '', manual: true });
    const first = loadPanelScript('/x/index.js?v=1', { name: 'demo-panel', attempt: 0, win, doc });
    const oldScript = scripts[0];
    first.abort();
    await assert.rejects(first, (err) => err.code === 'aborted');

    // Same panel, attempt reset to 0 (close then reopen) — the URL must still be unique.
    const second = loadPanelScript('/x/index.js?v=1', { name: 'demo-panel', attempt: 0, win, doc });
    const newScript = scripts[1];
    assert.notEqual(newScript.src, oldScript.src, 'each load needs a unique URL');

    win._fireError({ filename: oldScript.src, message: 'old bundle boom' });
    setCurrentScript(newScript);
    assert.equal(win.CCV.registerPanel('demo-panel', function NewPanel() {}), true);
    setCurrentScript(null);
    newScript.onload();
    const { component } = await second;
    assert.equal(component.name, 'NewPanel');
  });

  it('fails not-registered when bundle never registers', async () => {
    const { win, doc } = makeFakeDom({ fixture: '// nothing here' });
    await assert.rejects(
      loadPanelScript('/x/index.js', { name: 'demo-panel', win, doc }),
      (err) => err.code === 'not-registered',
    );
  });

  it('fails not-registered when bundle registers a different name', async () => {
    const { win, doc } = makeFakeDom({ fixture: `window.CCV.registerPanel('other', function(){})` });
    await assert.rejects(
      loadPanelScript('/x/index.js', { name: 'demo-panel', win, doc }),
      (err) => err.code === 'not-registered',
    );
  });

  it('fails load-failed when bundle throws during evaluation', async () => {
    const { win, doc } = makeFakeDom({ fixture: `throw new Error('bundle boom')` });
    await assert.rejects(
      loadPanelScript('/x/index.js', { name: 'demo-panel', win, doc }),
      (err) => err.code === 'load-failed',
    );
  });

  it('fails timeout when neither onload nor registration fires', async () => {
    const { win, doc } = makeFakeDom({ fixture: GOOD_FIXTURE });
    // Hijack appendChild: fire no callbacks (simulate a hanging network)
    doc.head.appendChild = (el) => el;
    await assert.rejects(
      loadPanelScript('/x/index.js', { name: 'demo-panel', win, doc, timeoutMs: 30 }),
      (err) => err.code === 'timeout',
    );
  });

  it('fails host-unavailable when window.CCV is missing', async () => {
    const emptyWin = { addEventListener() {}, removeEventListener() {} };
    await assert.rejects(
      loadPanelScript('/x/index.js', { name: 'demo-panel', win: emptyWin, doc: {} }),
      (err) => err.code === 'host-unavailable',
    );
  });

  it('registerPanel rejects calls outside script execution (async registration)', async () => {
    const { win, doc } = makeFakeDom({ fixture: GOOD_FIXTURE });
    await loadPanelScript('/x/index.js', { name: 'demo-panel', win, doc });
    // doc.currentScript is null - async registration must be rejected
    const ok = win.CCV.registerPanel('demo-panel', function () {});
    assert.equal(ok, false);
  });

  it('stale loadId registration is ignored by the new attempt', async () => {
    // Build a genuinely late registration: the first script stays pending, the second
    // attempt starts, then the old bundle registers under its stale loadId.
    const { win, doc, scripts, setCurrentScript } = makeFakeDom({ fixture: '', manual: true });
    const first = loadPanelScript('/x/index.js?v=1', { name: 'demo-panel', attempt: 0, win, doc, timeoutMs: 80 });
    const oldScript = scripts[0];
    const second = loadPanelScript('/x/index.js?v=1', { name: 'demo-panel', attempt: 1, win, doc });
    const newScript = scripts[1];

    setCurrentScript(oldScript);
    const oldOk = win.CCV.registerPanel('demo-panel', function OldPanel() {});
    setCurrentScript(null);
    assert.equal(oldOk, true, 'the stale registration lands in pending under the old loadId');

    setCurrentScript(newScript);
    const newOk = win.CCV.registerPanel('demo-panel', function NewPanel() {});
    setCurrentScript(null);
    assert.equal(newOk, true);

    newScript.onload();
    const { component } = await second;
    assert.equal(component.name, 'NewPanel', 'the new attempt consumes only its own registration');
    await assert.rejects(first, (err) => err.code === 'timeout');
  });

  it('attributes a delayed error event to the older attempt only', async () => {
    const { win, doc, scripts, setCurrentScript } = makeFakeDom({ fixture: '', manual: true });
    const first = loadPanelScript('/x/index.js?v=1', { name: 'demo-panel', attempt: 0, win, doc, timeoutMs: 80 });
    const oldSrc = scripts[0].src;
    const second = loadPanelScript('/x/index.js?v=1', { name: 'demo-panel', attempt: 1, win, doc });
    const newScript = scripts[1];

    // The error belongs to attempt 0 by exact URL; attempt 1 must survive and resolve.
    win._fireError({ filename: oldSrc, message: 'old bundle boom' });

    setCurrentScript(newScript);
    win.CCV.registerPanel('demo-panel', function NewPanel() {});
    setCurrentScript(null);
    newScript.onload();
    const { component } = await second;
    assert.equal(component.name, 'NewPanel');
    await assert.rejects(first, (err) => err.code === 'load-failed');
  });

  it('drops a registration that arrives after the timeout', async () => {
    const { win, doc, scripts, setCurrentScript } = makeFakeDom({ fixture: '', manual: true });
    const pending = loadPanelScript('/x/index.js', { name: 'demo-panel', win, doc, timeoutMs: 20 });
    const script = scripts[0];
    await assert.rejects(pending, (err) => err.code === 'timeout');
    const loadId = script.getAttribute('data-ccv-load');

    setCurrentScript(script);
    const ok = win.CCV.registerPanel('demo-panel', function LatePanel() {});
    setCurrentScript(null);
    assert.equal(ok, false, 'late registration after cancellation must be rejected');
    assert.equal(win.CCV._consumeRegistration(loadId), null, 'nothing lands in pending');
  });
});

describe('panelRuntime handshake', () => {
  function makeRuntime({ loadId = 'load-1', script = true } = {}) {
    const win = { addEventListener() {}, removeEventListener() {} };
    let current = script ? { getAttribute: () => loadId, src: `http://x/${loadId}.js` } : null;
    const doc = { get currentScript() { return current; } };
    const ccv = installPanelRuntime(win, doc);
    return {
      win, ccv,
      setScript(id) {
        current = id ? { getAttribute: () => id, src: `http://x/${id}.js` } : null;
      },
    };
  }

  it('is idempotent per window (second install returns the same runtime)', () => {
    const { win, ccv } = makeRuntime();
    assert.equal(installPanelRuntime(win, { currentScript: null }), ccv);
  });

  it('rejects registration without a script, load id, name, or component', () => {
    assert.equal(makeRuntime({ script: false }).ccv.registerPanel('p', function P() {}), false);
    assert.equal(makeRuntime({ loadId: null }).ccv.registerPanel('p', function P() {}), false);
    assert.equal(makeRuntime().ccv.registerPanel('', function P() {}), false);
    assert.equal(makeRuntime().ccv.registerPanel('p', 42), false);
    assert.equal(makeRuntime().ccv.registerPanel('p', function P() {}), true);
  });

  it('caps the pending registry and evicts the oldest registration', () => {
    const { ccv, setScript } = makeRuntime();
    for (let i = 0; i < 200; i++) {
      setScript(`load-${i}`);
      assert.equal(ccv.registerPanel('p', function P() {}), true);
    }
    setScript('load-overflow');
    assert.equal(ccv.registerPanel('p', function P() {}), true);
    assert.equal(ccv._consumeRegistration('load-0'), null, 'oldest registration evicted');
    assert.ok(ccv._consumeRegistration('load-1'), 'remaining registrations kept');
  });
});

describe('panelLoader.loadPanelStyles', () => {
  it('injects a link and disposes it idempotently', () => {
    const { win, doc, links } = makeFakeDom({ fixture: '' });
    const { dispose } = loadPanelStyles('/plugin-panels/demo/index.css', { doc, name: 'demo-panel' });
    assert.equal(links.length, 1);
    assert.equal(links[0].rel, 'stylesheet');
    dispose();
    assert.equal(links[0]._removed, true);
    dispose(); // idempotent
    assert.equal(links[0]._removed, true);
  });
});
