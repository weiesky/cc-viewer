/**
 * SSE channel manager lifecycle (per-workspace channels, 2026-10).
 *
 * Uses a fake EventSource + fake timers to verify: get-or-create, per-channel
 * gen bump on reconnect, heartbeat watchdog, reconnect budget, LRU eviction
 * (never rendered/bound), and cap enforcement.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createChannelManager, scopeKeyFor, scopeOfKey, BOUND_CHANNEL_KEY } from '../src/utils/sseChannels.js';

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

describe('scopeKeyFor / scopeOfKey', () => {
  it('round-trips every scope shape', () => {
    assert.equal(scopeKeyFor({}), BOUND_CHANNEL_KEY);
    assert.equal(scopeKeyFor({ project: 'alpha' }), 'project:alpha');
    assert.equal(scopeKeyFor({ project: 'alpha', instance: 'ccv-aa' }), 'project:alpha\x00ccv-aa');
    assert.equal(scopeKeyFor({ sid: 'uuid-1' }), 'sid:uuid-1');
    assert.deepEqual(scopeOfKey('project:alpha\x00ccv-aa'), { sid: null, project: 'alpha', instance: 'ccv-aa' });
    assert.deepEqual(scopeOfKey(BOUND_CHANNEL_KEY), { sid: null, project: null, instance: null });
  });
});

describe('createChannelManager lifecycle', () => {
  it('ensure creates and connects once; re-ensure does not reconnect without cold', () => {
    const es = fakeES(); const tm = fakeTimers();
    const m = createChannelManager({ openEventSource: es.factory, setTimeout: tm.setTimeout, clearTimeout: tm.clearTimeout });
    const a = m.ensure('bound', { url: '/events?limit=400' });
    assert.equal(es.instances.length, 1);
    const b = m.ensure('bound');
    assert.equal(a, b, 'same channel returned');
    assert.equal(es.instances.length, 1, 'no reconnect without cold');
  });

  it('reconnect closes the old socket and bumps gen', () => {
    const es = fakeES(); const tm = fakeTimers();
    const m = createChannelManager({ openEventSource: es.factory, setTimeout: tm.setTimeout, clearTimeout: tm.clearTimeout, backoff: () => 0 });
    m.ensure('bound', { url: '/events' });
    const g0 = m.genOf('bound');
    const first = es.instances[0];
    m.reconnect('bound');
    tm.fireAll(); // fire the backoff timer
    assert.equal(first.closed, true, 'old socket closed');
    assert.equal(es.instances.length, 2, 'new socket opened');
    assert.ok(m.genOf('bound') > g0, 'gen bumped');
  });

  it('heartbeat timeout fires the handler; touch re-arms it', () => {
    const es = fakeES(); const tm = fakeTimers();
    let timeouts = 0;
    const m = createChannelManager({
      openEventSource: es.factory, setTimeout: tm.setTimeout, clearTimeout: tm.clearTimeout,
      handlers: { onHeartbeatTimeout: () => { timeouts++; } },
    });
    m.ensure('bound', { url: '/events' });
    const hbIds = [...tm.pending.keys()];
    assert.equal(hbIds.length, 1, 'one heartbeat armed');
    tm.fire(hbIds[0]);
    assert.equal(timeouts, 1);
  });

  it('reconnect budget is enforced', () => {
    const es = fakeES(); const tm = fakeTimers();
    const m = createChannelManager({ openEventSource: es.factory, setTimeout: tm.setTimeout, clearTimeout: tm.clearTimeout, reconnectBudget: 2, backoff: () => 0 });
    m.ensure('bound', { url: '/events' });
    assert.equal(m.reconnect('bound'), true);
    tm.fireAll();
    assert.equal(m.reconnect('bound'), true);
    tm.fireAll();
    assert.equal(m.reconnect('bound'), false, 'budget exhausted');
    assert.ok(
      [...tm.pending.values()].some((t) => t.ms === 30000),
      'a slow-retry timer is armed after exhaustion instead of giving up',
    );
  });

  it('LRU eviction never evicts rendered or bound, and onEvict fires with the victim', () => {
    const es = fakeES(); const tm = fakeTimers();
    const evicted = [];
    const m = createChannelManager({
      openEventSource: es.factory, setTimeout: tm.setTimeout, clearTimeout: tm.clearTimeout,
      maxChannels: 2, onEvict: (ch) => evicted.push(ch.key),
    });
    m.ensure('bound', { url: '/e1' });
    m.setRendered('bound');
    m.ensure('project:alpha', { url: '/e2' });
    m.ensure('project:beta', { url: '/e3' }); // over cap: must evict alpha (not bound/rendered)
    assert.deepEqual(m.keys().sort(), ['bound', 'project:beta']);
    assert.deepEqual(evicted, ['project:alpha'], 'the non-rendered non-bound LRU victim evicted');
  });

  it('touch re-arms the heartbeat and reports liveness', () => {
    const es = fakeES(); const tm = fakeTimers();
    let timeouts = 0;
    const m = createChannelManager({
      openEventSource: es.factory, setTimeout: tm.setTimeout, clearTimeout: tm.clearTimeout,
      handlers: { onHeartbeatTimeout: () => { timeouts++; } },
    });
    m.ensure('bound', { url: '/events' });
    const first = [...tm.pending.keys()][0];
    assert.equal(m.touch('bound'), true, 'a live channel is touchable');
    assert.equal(tm.pending.has(first), false, 'the stale heartbeat was cleared');
    tm.fireAll(); // fires the re-armed heartbeat only
    assert.equal(timeouts, 1, 'exactly one heartbeat fired after the re-arm');
    assert.equal(m.touch('nope'), false, 'unknown key reports not-live');
  });

  it('ensure({rendered:true}) never evicts the channel being created (evicts the demoted previous rendered)', () => {
    const es = fakeES(); const tm = fakeTimers();
    const evicted = [];
    const m = createChannelManager({
      openEventSource: es.factory, setTimeout: tm.setTimeout, clearTimeout: tm.clearTimeout,
      maxChannels: 2, onEvict: (ch) => evicted.push(ch.key),
    });
    m.ensure('bound', { url: '/e1', rendered: true });
    m.ensure('project:a', { url: '/e2', rendered: true });
    // Third channel while project:a is still the recorded rendered key: the
    // create-then-render flow must survive — project:a (about to be demoted)
    // is the victim, NOT the new project:b.
    const created = m.ensure('project:b', { url: '/e3', rendered: true });
    assert.equal(m.get('project:b'), created, 'the newly created channel still lives');
    assert.equal(m.renderedKey, 'project:b');
    assert.deepEqual(m.keys().sort(), ['bound', 'project:b']);
    assert.deepEqual(evicted, ['project:a'], 'the demoted previous rendered channel is the victim');
  });

  it('close cleans timers and drops the channel', () => {
    const es = fakeES(); const tm = fakeTimers();
    const m = createChannelManager({ openEventSource: es.factory, setTimeout: tm.setTimeout, clearTimeout: tm.clearTimeout });
    m.ensure('bound', { url: '/events' });
    assert.equal(tm.pending.size >= 1, true, 'heartbeat armed');
    m.close('bound');
    assert.equal(m.get('bound'), null);
    assert.equal(tm.pending.size, 0, 'timers cleared on close');
  });
});
