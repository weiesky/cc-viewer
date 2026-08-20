import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveImConnState, imBadgeModel } from '../src/utils/imConnState.js';

describe('deriveImConnState — legacy payloads (no connectionState, old workers)', () => {
  it('reproduces the chip four-state logic byte-for-byte', () => {
    assert.equal(deriveImConnState(null), 'stopped');
    assert.equal(deriveImConnState({ running: false, connected: false }), 'stopped');
    assert.equal(deriveImConnState({ running: true, connected: false }), 'running');
    assert.equal(deriveImConnState({ running: true, connected: true }), 'connected');
    assert.equal(deriveImConnState({ running: true, connected: true, lastError: 'boom' }), 'error');
    assert.equal(deriveImConnState({ running: false, connected: false, lastError: 'boom' }), 'error');
  });
});

describe('deriveImConnState — tri-state payloads', () => {
  it('the bug case: stale connected boolean cannot mask a reconnecting link', () => {
    assert.equal(deriveImConnState({ running: true, connected: true, connectionState: 'reconnecting' }), 'reconnecting');
  });

  it('reconnecting outranks lastError (the retained disconnect cause must not mask the retry)', () => {
    assert.equal(
      deriveImConnState({ running: true, connected: false, connectionState: 'reconnecting', lastError: 'net down' }),
      'reconnecting');
  });

  it('a dead worker cannot be reconnecting', () => {
    assert.equal(deriveImConnState({ running: false, connected: false, connectionState: 'reconnecting' }), 'stopped');
  });

  it('disconnected-while-running maps to error with lastError, running without', () => {
    assert.equal(
      deriveImConnState({ running: true, connected: false, connectionState: 'disconnected', lastError: 'kicked' }),
      'error');
    assert.equal(
      deriveImConnState({ running: true, connected: false, connectionState: 'disconnected' }),
      'running');
  });

  it('connected / stopped map straight through', () => {
    assert.equal(deriveImConnState({ running: true, connected: true, connectionState: 'connected' }), 'connected');
    assert.equal(deriveImConnState({ running: false, connected: false, connectionState: 'disconnected' }), 'stopped');
  });
});

describe('imBadgeModel — proc-state matrix', () => {
  const conn = (over = {}) => ({ running: true, connected: true, connectionState: 'connected', ...over });

  it('ready + connected → success Connected with port', () => {
    const m = imBadgeModel({ procState: 'ready', connection: conn() });
    assert.deepEqual(m, { key: 'ui.im.statusConnected', fallback: 'Connected', color: 'success', withPort: true, error: null });
  });

  it('ready + reconnecting → warning Reconnecting with port, outranking lastError', () => {
    const m = imBadgeModel({ procState: 'ready', connection: conn({ connected: false, connectionState: 'reconnecting', lastError: 'net down' }) });
    assert.deepEqual(m, { key: 'ui.im.statusReconnecting', fallback: 'Reconnecting…', color: 'warning', withPort: true, error: null });
  });

  it('ready + not connected → processing Running with port', () => {
    const m = imBadgeModel({ procState: 'ready', connection: conn({ connected: false, connectionState: 'disconnected' }) });
    assert.equal(m.key, 'ui.im.statusRunning');
    assert.equal(m.withPort, true);
  });

  it('lastError (not reconnecting) → error tag carrying the detail', () => {
    const m = imBadgeModel({ procState: 'ready', connection: conn({ lastError: 'boom' }) });
    assert.equal(m.key, 'ui.im.statusError');
    assert.equal(m.color, 'error');
    assert.equal(m.error, 'boom');
  });

  it('booting / hung / dead ignore the connection and never carry a port', () => {
    assert.equal(imBadgeModel({ procState: 'booting', connection: null }).key, 'ui.im.statusBooting');
    assert.equal(imBadgeModel({ procState: 'hung', connection: null }).key, 'ui.im.statusHung');
    const dead = imBadgeModel({ procState: 'dead', connection: null });
    assert.equal(dead.key, 'ui.im.statusDisconnected');
    assert.equal(dead.withPort, false);
    // A dead process cannot show reconnecting even if a stale connection payload claims it.
    assert.equal(
      imBadgeModel({ procState: 'dead', connection: conn({ connectionState: 'reconnecting' }) }).key,
      'ui.im.statusDisconnected');
  });

  it('remote fallback (no procState): reconnecting / connected / running / disconnected, no port', () => {
    assert.equal(imBadgeModel({ procState: undefined, connection: null }), null);
    const rc = imBadgeModel({ procState: undefined, connection: conn({ connected: false, connectionState: 'reconnecting' }) });
    assert.equal(rc.key, 'ui.im.statusReconnecting');
    assert.equal(rc.withPort, false);
    assert.equal(imBadgeModel({ procState: undefined, connection: conn() }).key, 'ui.im.statusConnected');
    assert.equal(imBadgeModel({ procState: undefined, connection: { running: true } }).key, 'ui.im.statusRunning');
    assert.equal(imBadgeModel({ procState: undefined, connection: { running: false } }).key, 'ui.im.statusDisconnected');
  });

  it('legacy remote payload (no connectionState) keeps the old behavior', () => {
    assert.equal(imBadgeModel({ procState: undefined, connection: { running: true, connected: true } }).key, 'ui.im.statusConnected');
    assert.equal(imBadgeModel({ procState: 'ready', connection: { running: true, connected: false } }).key, 'ui.im.statusRunning');
  });
});
