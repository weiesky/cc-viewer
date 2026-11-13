import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Watchdog coverage for the blood-bar freeze fix: the /ws/terminal socket had no
// keepalive, so a silently half-open connection (NAT/proxy/sleep-wake) never fired
// onclose and every push-only consumer (sdk-context-usage, approvals, queue state)
// froze until a page refresh. These tests drive the REAL watchdog code:
//   - watchdogShouldForceClose: the pure gate (version-skew ping evidence included)
//   - _forceClose / _onSocketClose: force-close → close-path → 2s reconnect, with the
//     stale-onclose guard protecting the fresh connection
const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '..');
let mod;
let sockets;

class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.frames = [];
    this.closed = false;
    sockets.push(this);
  }
  send(frame) { this.frames.push(JSON.parse(frame)); }
  close() { this.closed = true; this.readyState = 3; /* wedged: never fires onclose */ }
  open() { this.readyState = FakeWebSocket.OPEN; this.onopen(); }
  deliver(obj) { this.onmessage({ data: JSON.stringify(obj) }); }
}

before(async () => {
  globalThis.window = { location: { protocol: 'http:', host: 'localhost', search: '', pathname: '/', hash: '' } };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.document = { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' };
  globalThis.WebSocket = FakeWebSocket;
  const appRequire = createRequire(join(webRoot, 'package.json'));
  const esbuildPath = createRequire(appRequire.resolve('vite')).resolve('esbuild');
  const esbuild = await import(pathToFileURL(esbuildPath).href);
  const result = await esbuild.build({
    entryPoints: [join(webRoot, 'src/components/terminal/TerminalWsContext.jsx')],
    bundle: true, format: 'esm', platform: 'browser', write: false,
    jsx: 'automatic', loader: { '.jsx': 'jsx', '.js': 'jsx' },
  });
  mod = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
});

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function provider(states) {
  const view = new mod.TerminalWsProvider({ open: true, viewedProject: null, viewedInstance: null });
  view._notifyState = (s) => states.push(s);
  return view;
}

const OPEN = () => ({ readyState: FakeWebSocket.OPEN });

describe('watchdogShouldForceClose — pure gate', () => {
  it('fires only for an idle OPEN socket that has seen a server ping', () => {
    const base = { ws: OPEN(), open: true, unmounted: false, lastInboundAt: 0, pingSeen: true, now: 50_000 };
    assert.equal(mod.watchdogShouldForceClose(base), true, 'idle + open + ping-seen → force-close');
    assert.equal(mod.watchdogShouldForceClose({ ...base, pingSeen: false }), false,
      'no ping evidence (old server) → stay passive, no 45s reconnect churn');
    assert.equal(mod.watchdogShouldForceClose({ ...base, lastInboundAt: 49_000 }), false,
      'recent traffic resets the idle clock');
    assert.equal(mod.watchdogShouldForceClose({ ...base, ws: { readyState: FakeWebSocket.CONNECTING } }), false,
      'CONNECTING has the browser dial timeout, not the watchdog');
    assert.equal(mod.watchdogShouldForceClose({ ...base, ws: null }), false);
    assert.equal(mod.watchdogShouldForceClose({ ...base, open: false }), false);
    assert.equal(mod.watchdogShouldForceClose({ ...base, unmounted: true }), false);
    assert.equal(mod.watchdogShouldForceClose({ ...base, now: 45_001 }), true, 'strictly past the threshold');
    assert.equal(mod.watchdogShouldForceClose({ ...base, now: 45_000 }), false, 'at the threshold is not past it');
  });
});

describe('TerminalWsProvider watchdog integration', () => {
  it('force-close → manual fallback → close notification → reconnect to a fresh socket', async () => {
    sockets = [];
    const states = [];
    const view = provider(states);
    view.componentDidMount();
    const first = sockets[0];
    first.open();
    first.deliver({ type: 'ping', ts: Date.now() });
    assert.equal(view._pingSeen, true);

    // Simulate the tick decision, then run the REAL force-close path.
    view._lastInboundAt = Date.now() - mod.SOCKET_IDLE_MS - 1;
    assert.equal(mod.watchdogShouldForceClose({
      ws: first, open: view.props.open, unmounted: view._unmounted,
      lastInboundAt: view._lastInboundAt, pingSeen: view._pingSeen,
    }), true);
    view._forceClose(first);
    assert.equal(first.closed, true, 'force-close issued to the wedged socket');

    // The wedged socket never fires onclose → the grace fallback runs the close path.
    await sleep(mod.WATCHDOG_CLOSE_GRACE_MS + 200);
    assert.ok(states.includes('close'), 'listeners notified of the close');
    assert.equal(view.ws, null, 'superseded socket cleared');

    await sleep(2100); // reconnect delay
    assert.equal(sockets.length, 2, 'a fresh socket was created by the reconnect');
    view.disconnect();
  });

  it('a real onclose beats the manual fallback and runs the close path exactly once', async () => {
    sockets = [];
    const states = [];
    const view = provider(states);
    view.componentDidMount();
    const first = sockets[0];
    first.open();
    first.deliver({ type: 'ping', ts: Date.now() });
    view._lastInboundAt = Date.now() - mod.SOCKET_IDLE_MS - 1;

    view._forceClose(first);
    // The socket is NOT wedged this time: the browser delivers onclose promptly.
    states.length = 0;
    first.onclose?.();
    assert.deepEqual(states, ['close'], 'stock close path ran');
    assert.equal(view.ws, null);

    // The grace fallback fires later but must be a no-op (socket already superseded).
    await sleep(mod.WATCHDOG_CLOSE_GRACE_MS + 200);
    assert.deepEqual(states, ['close'], 'fallback did not double-notify');
    view.disconnect();
  });

  it('a late onclose from a superseded socket never tears down the fresh connection', async () => {
    sockets = [];
    const states = [];
    const view = provider(states);
    view.componentDidMount();
    const old = sockets[0];
    old.open();
    old.deliver({ type: 'ping', ts: Date.now() });
    view._lastInboundAt = Date.now() - mod.SOCKET_IDLE_MS - 1;

    view._forceClose(old);
    await sleep(mod.WATCHDOG_CLOSE_GRACE_MS + 200); // manual fallback supersedes old
    await sleep(2100); // reconnect
    const fresh = sockets[1];
    assert.ok(fresh, 'fresh socket exists');
    fresh.open();

    states.length = 0;
    old.onclose?.(); // wedged socket finally delivers its close event
    assert.equal(states.length, 0, 'stale onclose must not notify listeners');
    assert.equal(view.ws, fresh, 'stale onclose must not clear the fresh socket');
    view.disconnect();
  });

  it('any inbound frame resets the idle clock and records ping evidence', () => {
    sockets = [];
    const view = provider([]);
    view.componentDidMount();
    sockets[0].open();
    view._lastInboundAt = Date.now() - 30000;
    sockets[0].deliver({ type: 'state', running: false });
    assert.ok(Date.now() - view._lastInboundAt < 1000, 'frame refreshed the idle clock');
    assert.equal(view._pingSeen, false, 'non-ping frames do not arm the force-close gate');
    sockets[0].deliver({ type: 'ping', ts: Date.now() });
    assert.equal(view._pingSeen, true);
    view.disconnect();
  });
});
