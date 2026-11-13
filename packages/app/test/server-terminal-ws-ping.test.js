/**
 * /ws/terminal per-connection app-level ping (server/lib/terminal-ws-ping.js).
 *
 * The terminal WS carries every SDK push frame (sdk-context-usage blood bar,
 * approvals, queue state) and historically had NO keepalive: a NAT/proxy could
 * half-open the socket, the browser never fired onclose, and the bar froze until
 * a page refresh. The ping keeps the client watchdog fed.
 *
 * Imports ONLY the helper module — pulling in server.js here would leak module
 * state into the shared test process and break sibling server tests.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const mod = await import('../server/lib/terminal-ws-ping.js');

function makeFakeTimers() {
  const timers = new Map();
  let nextId = 1;
  return {
    timers,
    setI: (fn, ms) => { const id = nextId++; timers.set(id, { fn, ms }); return { id, unref() {} }; },
    clearI: (t) => { if (t) timers.delete(t.id); },
    fireAll: () => { for (const [, t] of [...timers]) t.fn(); },
  };
}

function makeFakeWs() {
  const listeners = new Map();
  return {
    readyState: 1,
    sent: [],
    send(m) { this.sent.push(String(m)); },
    on(name, fn) { listeners.set(name, fn); },
    emit(name, ...args) { listeners.get(name)?.(...args); },
  };
}

describe('attachTerminalWsPing', () => {
  it('sends a {type:"ping", ts} frame every 25s while the socket is OPEN', () => {
    const fake = makeFakeTimers();
    const ws = makeFakeWs();
    mod.attachTerminalWsPing(ws, { setI: fake.setI, clearI: fake.clearI });
    // The first ping is sent IMMEDIATELY on connect — this closes the window where a
    // freshly-reconnected client has reset its ping-seen evidence but the socket goes
    // half-open before the first interval elapses (a permanent watchdog blind spot).
    assert.equal(ws.sent.length, 1, 'immediate first ping on connect');
    assert.equal(JSON.parse(ws.sent[0]).type, 'ping');
    assert.equal(fake.timers.size, 1);
    const [{ ms }] = fake.timers.values();
    assert.equal(ms, mod.TERMINAL_WS_PING_MS);

    fake.fireAll();
    assert.equal(ws.sent.length, 2, 'interval ping after the first immediate one');
    fake.fireAll();
    assert.equal(ws.sent.length, 3, 'cadence repeats');
  });

  it('skips non-OPEN sockets instead of throwing (broadcast semantics unchanged)', () => {
    const fake = makeFakeTimers();
    const ws = makeFakeWs();
    ws.readyState = 3; // CLOSED-ish before attach
    mod.attachTerminalWsPing(ws, { setI: fake.setI, clearI: fake.clearI });
    fake.fireAll();
    assert.equal(ws.sent.length, 0, 'no send on a non-OPEN socket (connect or interval)');
  });

  it('swallows send() failures (a wedged socket must not kill the loop)', () => {
    const fake = makeFakeTimers();
    const ws = makeFakeWs();
    ws.send = () => { throw new Error('wedged'); };
    mod.attachTerminalWsPing(ws, { setI: fake.setI, clearI: fake.clearI }); // immediate send throws, swallowed
    fake.fireAll(); // must not throw
    fake.fireAll();
  });

  it('stops pinging after the connection closes', () => {
    const fake = makeFakeTimers();
    const ws = makeFakeWs();
    mod.attachTerminalWsPing(ws, { setI: fake.setI, clearI: fake.clearI });
    fake.fireAll();
    assert.equal(ws.sent.length, 2); // immediate + first interval
    ws.emit('close');
    assert.equal(fake.timers.size, 0, 'timer cleared on close');
    fake.fireAll();
    assert.equal(ws.sent.length, 2, 'no further sends');
  });
});
