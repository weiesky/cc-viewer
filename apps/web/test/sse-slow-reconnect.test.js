/**
 * SSE slow-cadence retry after the reconnect budget is spent (2026-10, R7).
 *
 * Once the budget-limited reconnect gives up, the manager must keep probing
 * every slowRetryMs (instead of dying forever), notify exactly once per
 * exhaustion cycle, and reset all of that when a socket reopens. A fresh
 * connect or close must supersede a pending slow-retry timer (no double
 * connect).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createChannelManager } from '../src/utils/sseChannels.js';

function fakeES() {
  const instances = [];
  return {
    instances,
    factory(url) {
      const es = {
        url,
        closed: false,
        onmessage: null,
        onopen: null,
        onerror: null,
        close() { this.closed = true; },
      };
      instances.push(es);
      return es;
    },
  };
}

function fakeTimers() {
  const pending = new Map();
  let nextId = 1;
  return {
    pending,
    setTimeout: (fn, ms) => { const id = nextId++; pending.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => { pending.delete(id); },
    fire(id) { const t = pending.get(id); if (t) { pending.delete(id); t.fn(); } },
    fireAll() { for (const id of [...pending.keys()]) this.fire(id); },
  };
}

/** Ids of pending timers registered with exactly `ms`. */
function idsWithMs(tm, ms) {
  return [...tm.pending.entries()].filter(([, t]) => t.ms === ms).map(([id]) => id);
}

describe('createChannelManager slow reconnect after budget exhaustion', () => {
  it('notifies onReconnectExhausted exactly once across repeated reconnect() calls', () => {
    const es = fakeES(); const tm = fakeTimers();
    const notified = [];
    const m = createChannelManager({
      openEventSource: es.factory, setTimeout: tm.setTimeout, clearTimeout: tm.clearTimeout,
      reconnectBudget: 1, backoff: () => 0,
      onReconnectExhausted: (ch) => notified.push(ch.key),
    });
    m.ensure('bound', { url: '/events' });
    assert.equal(m.reconnect('bound'), true);
    assert.equal(m.reconnect('bound'), false, 'budget exhausted');
    assert.equal(m.reconnect('bound'), false, 'still exhausted');
    assert.equal(m.reconnect('bound'), false, 'still exhausted');
    assert.deepEqual(notified, ['bound'], 'one notice per exhaustion cycle');
    assert.equal(idsWithMs(tm, 30000).length, 1, 'exactly one slow-retry timer armed');
  });

  it('opens a new EventSource after slowRetryMs without incrementing reconnectCount', () => {
    const es = fakeES(); const tm = fakeTimers();
    const notified = [];
    const m = createChannelManager({
      openEventSource: es.factory, setTimeout: tm.setTimeout, clearTimeout: tm.clearTimeout,
      reconnectBudget: 1, backoff: () => 0, slowRetryMs: 30000,
      onReconnectExhausted: (ch) => notified.push(ch.key),
    });
    m.ensure('bound', { url: '/events' });
    assert.equal(m.reconnect('bound'), true);
    tm.fire(idsWithMs(tm, 0)[0]); // backoff fires: a new socket is opened
    const ch = m.get('bound');
    const instancesBefore = es.instances.length;
    const countBefore = ch.reconnectCount;
    assert.equal(m.reconnect('bound'), false, 'budget exhausted');
    const slowIds = idsWithMs(tm, 30000);
    assert.equal(slowIds.length, 1, 'slow-retry timer armed');
    tm.fire(slowIds[0]);
    assert.equal(es.instances.length, instancesBefore + 1, 'slow retry opened a new EventSource');
    assert.equal(ch.reconnectCount, countBefore, 'slow retry did not consume the reconnect budget');
    assert.equal(ch.slowRetryTimer, null, 'slow-retry timer cleared once fired');
    assert.deepEqual(notified, ['bound']);
  });

  it('es.onopen resets the budget and re-arms the exhaustion notice', () => {
    const es = fakeES(); const tm = fakeTimers();
    const notified = [];
    const m = createChannelManager({
      openEventSource: es.factory, setTimeout: tm.setTimeout, clearTimeout: tm.clearTimeout,
      reconnectBudget: 1, backoff: () => 0, slowRetryMs: 30000,
      onReconnectExhausted: (ch) => notified.push(ch.key),
    });
    m.ensure('bound', { url: '/events' });
    assert.equal(m.reconnect('bound'), true);
    tm.fire(idsWithMs(tm, 0)[0]);
    assert.equal(m.reconnect('bound'), false, 'budget exhausted once');
    assert.deepEqual(notified, ['bound']);
    tm.fire(idsWithMs(tm, 30000)[0]); // slow retry opens the live socket
    const live = es.instances[es.instances.length - 1];
    live.onopen();
    const ch = m.get('bound');
    assert.equal(ch.reconnectCount, 0, 'budget restored on open');
    assert.equal(ch.exhaustedNotified, false, 'notice re-armed');
    assert.equal(ch.slowRetryTimer, null);
    assert.equal(m.reconnect('bound'), true, 'reconnect works again after open');
    assert.equal(m.reconnect('bound'), false, 'budget exhausted a second time');
    assert.deepEqual(notified, ['bound', 'bound'], 'a fresh exhaustion notifies again');
  });

  it('close() clears a pending slow-retry timer', () => {
    const es = fakeES(); const tm = fakeTimers();
    const m = createChannelManager({
      openEventSource: es.factory, setTimeout: tm.setTimeout, clearTimeout: tm.clearTimeout,
      reconnectBudget: 0,
    });
    m.ensure('bound', { url: '/events' });
    assert.equal(m.reconnect('bound'), false, 'budget already spent');
    assert.equal(idsWithMs(tm, 30000).length, 1, 'slow-retry timer armed');
    m.close('bound');
    assert.equal(tm.pending.size, 0, 'all timers (incl. slow retry) cleared on close');
  });

  it('a fresh _connect() clears a pending slow-retry timer (no double connect)', () => {
    const es = fakeES(); const tm = fakeTimers();
    const m = createChannelManager({
      openEventSource: es.factory, setTimeout: tm.setTimeout, clearTimeout: tm.clearTimeout,
      reconnectBudget: 0,
    });
    m.ensure('bound', { url: '/events' });
    assert.equal(m.reconnect('bound'), false, 'budget already spent');
    assert.equal(idsWithMs(tm, 30000).length, 1, 'slow-retry timer armed');
    const before = es.instances.length;
    m.ensure('bound', { url: '/events?cold=1', cold: true });
    assert.equal(es.instances.length, before + 1, 'fresh connect opened one socket');
    assert.equal(idsWithMs(tm, 30000).length, 0, 'stale slow-retry timer cleared');
    tm.fireAll();
    assert.equal(es.instances.length, before + 1, 'no second connect from the stale slow timer');
  });
});
