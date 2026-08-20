import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// The core writes per-platform audit logs into LOG_DIR; redirect it before import.
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-imconnstate-test-'));
process.env.CCV_LOG_DIR = tmpDir;

const core = await import('../server/lib/im/im-bridge-core.js');

// Event-driven fake adapter: captures the hooks object so tests can fire onConnectionChange.
function makeEventFake(id) {
  const rec = { hooks: null, connectError: null, connectDelayMs: 0, disconnects: 0 };
  core.registerAdapter({
    id,
    i18nNs: 'server.dingtalk',
    allowListField: 'allowStaffIds',
    capabilities: { inboundAck: false },
    rateLimit: { max: 1000, windowMs: 60_000 },
    hasCreds: () => true,
    statusFields: () => ({}),
    async connect(cfg, hooks) {
      rec.hooks = hooks;
      if (rec.connectError) throw rec.connectError;
      if (rec.connectDelayMs) await new Promise((r) => setTimeout(r, rec.connectDelayMs));
      return { id };
    },
    async disconnect() { rec.disconnects++; },
    ack() {},
    async sendOne() {},
    async testConnection() { return { ok: true }; },
  });
  return rec;
}

// Probe-driven fake adapter: the core polls connectionProbe(client) instead of receiving events.
function makeProbeFake(id) {
  const rec = { probeState: 'connected', probeCalls: 0 };
  core.registerAdapter({
    id,
    i18nNs: 'server.dingtalk',
    allowListField: 'allowStaffIds',
    capabilities: { inboundAck: false },
    rateLimit: { max: 1000, windowMs: 60_000 },
    hasCreds: () => true,
    statusFields: () => ({}),
    async connect() { return { id }; },
    connectionProbe() {
      rec.probeCalls++;
      if (rec.probeThrow) throw new Error('probe boom');
      return rec.probeState;
    },
    async disconnect() {},
    ack() {},
    async sendOne() {},
    async testConnection() { return { ok: true }; },
  });
  return rec;
}

const evRec = makeEventFake('imEv');
const prRec = makeProbeFake('imPr');

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const cfg = { enabled: true, appKey: 'k', appSecret: 's', allowStaffIds: [], maxChunkChars: 3800 };
const deps = () => ({
  writeToPty: () => {},
  writeToPtySequential: (chunks, cb) => { if (cb) cb(true); },
  getPtyState: () => ({ running: true, exitCode: null }),
  getPtyKind: () => 'claude',
  getPtySkipPermissions: () => false,
  isStreaming: () => false,
  getConfig: () => cfg,
});

function auditEvents(id, event) {
  const p = join(tmpDir, `${id}-audit.log`);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf-8').split('\n').filter(Boolean)
    .map((l) => JSON.parse(l)).filter((e) => e.event === event);
}

beforeEach(() => {
  core.__resetForTests('imEv');
  core.__resetForTests('imPr');
  core.__setConnPollMsForTests(5);
  evRec.hooks = null; evRec.connectError = null; evRec.connectDelayMs = 0; evRec.disconnects = 0;
  prRec.probeState = 'connected'; prRec.probeCalls = 0; prRec.probeThrow = false;
});

after(() => {
  core.__setConnPollMsForTests(null);
  core.__resetAllForTests();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('connection state via onConnectionChange', () => {
  it('starts connected, flips to reconnecting and back, keeping connected boolean in sync', async () => {
    await core.startBridge('imEv', deps());
    assert.deepEqual(
      (({ running, connected, connectionState }) => ({ running, connected, connectionState }))(core.getBridgeStatus('imEv')),
      { running: true, connected: true, connectionState: 'connected' });

    evRec.hooks.onConnectionChange('reconnecting');
    let st = core.getBridgeStatus('imEv');
    assert.equal(st.connectionState, 'reconnecting');
    assert.equal(st.connected, false);
    assert.equal(st.running, true);

    evRec.hooks.onConnectionChange('connected');
    st = core.getBridgeStatus('imEv');
    assert.equal(st.connectionState, 'connected');
    assert.equal(st.connected, true);
  });

  it('recovery clears the retained disconnect cause (no stuck "Error" after a blip)', async () => {
    await core.startBridge('imEv', deps());
    // Real adapters pass the disconnect cause with the reconnecting transition.
    evRec.hooks.onConnectionChange('reconnecting', new Error('net down'));
    let st = core.getBridgeStatus('imEv');
    assert.equal(st.connectionState, 'reconnecting');
    assert.match(st.lastError, /net down/);
    evRec.hooks.onConnectionChange('connected');
    st = core.getBridgeStatus('imEv');
    assert.equal(st.connectionState, 'connected');
    assert.equal(st.lastError, null, 'the connected transition must clear the stale disconnect cause');
  });

  it('a deduped connected repeat does NOT clear lastError (send-failure diagnostics survive)', async () => {
    await core.startBridge('imEv', deps());
    evRec.hooks.onConnectionChange(null, new Error('send failed'));
    evRec.hooks.onConnectionChange('connected'); // same state → dedupe, no clearing
    const st = core.getBridgeStatus('imEv');
    assert.equal(st.connectionState, 'connected');
    assert.match(st.lastError, /send failed/);
  });

  it('a terminal disconnect records the error and state', async () => {
    await core.startBridge('imEv', deps());
    evRec.hooks.onConnectionChange('disconnected', new Error('session invalidated'));
    const st = core.getBridgeStatus('imEv');
    assert.equal(st.connectionState, 'disconnected');
    assert.equal(st.connected, false);
    assert.match(st.lastError, /session invalidated/);
  });

  it('state=null records lastError only, without flipping the state', async () => {
    await core.startBridge('imEv', deps());
    evRec.hooks.onConnectionChange(null, new Error('gateway hiccup'));
    const st = core.getBridgeStatus('imEv');
    assert.equal(st.connectionState, 'connected');
    assert.equal(st.connected, true);
    assert.match(st.lastError, /gateway hiccup/);
  });

  it('dedupes identical consecutive states (one audit line per transition)', async () => {
    await core.startBridge('imEv', deps());
    const baseline = auditEvents('imEv', 'connection').length;
    evRec.hooks.onConnectionChange('reconnecting');
    evRec.hooks.onConnectionChange('reconnecting');
    evRec.hooks.onConnectionChange('reconnecting');
    assert.equal(core.getBridgeStatus('imEv').connectionState, 'reconnecting');
    assert.equal(auditEvents('imEv', 'connection').length - baseline, 1);
  });

  it('a stale listener firing after stopBridge cannot flip the state', async () => {
    await core.startBridge('imEv', deps());
    const staleHooks = evRec.hooks;
    await core.stopBridge('imEv');
    staleHooks.onConnectionChange('connected');
    const st = core.getBridgeStatus('imEv');
    assert.equal(st.connectionState, 'disconnected');
    assert.equal(st.connected, false);
    assert.equal(st.running, false);
  });

  it('a stale listener from before a reloadBridge is ignored; the new generation works', async () => {
    await core.startBridge('imEv', deps());
    const staleHooks = evRec.hooks;
    await core.reloadBridge('imEv', deps());
    assert.equal(core.getBridgeStatus('imEv').connectionState, 'connected');
    staleHooks.onConnectionChange('reconnecting'); // old generation → ignored
    assert.equal(core.getBridgeStatus('imEv').connectionState, 'connected');
    evRec.hooks.onConnectionChange('reconnecting'); // current generation → applied
    assert.equal(core.getBridgeStatus('imEv').connectionState, 'reconnecting');
  });

  it('a failed connect reports disconnected + lastError', async () => {
    evRec.connectError = new Error('bad creds');
    await core.startBridge('imEv', deps());
    const st = core.getBridgeStatus('imEv');
    assert.equal(st.running, false);
    assert.equal(st.connected, false);
    assert.equal(st.connectionState, 'disconnected');
    assert.match(st.lastError, /bad creds/);
  });

  it('stopBridge during a slow connect wins the race: no resurrection, late client torn down', async () => {
    evRec.connectDelayMs = 30;
    const startP = core.startBridge('imEv', deps());
    await new Promise((r) => setTimeout(r, 5)); // connect is in flight
    await core.stopBridge('imEv');
    await startP;
    const st = core.getBridgeStatus('imEv');
    assert.equal(st.running, false, 'a superseded start must not re-mark the instance running');
    assert.equal(st.connectionState, 'disconnected');
    assert.ok(evRec.disconnects >= 1, 'the late-arriving client must be disconnected, not leaked');
  });

  it('getBridgeStatus for an unknown platform defaults to disconnected', () => {
    assert.deepEqual(core.getBridgeStatus('nope'),
      { running: false, connected: false, connectionState: 'disconnected', lastError: null, boundConversationId: null });
  });
});

describe('connection state via connectionProbe polling', () => {
  it('polls the probe and applies its transitions', async () => {
    await core.startBridge('imPr', deps());
    assert.equal(core.getBridgeStatus('imPr').connectionState, 'connected');
    prRec.probeState = 'reconnecting';
    await tick();
    assert.ok(prRec.probeCalls > 0, 'probe must have been polled');
    assert.equal(core.getBridgeStatus('imPr').connectionState, 'reconnecting');
    prRec.probeState = 'connected';
    await tick();
    assert.equal(core.getBridgeStatus('imPr').connectionState, 'connected');
  });

  it('a throwing probe freezes the state but keeps the poll interval alive', async () => {
    await core.startBridge('imPr', deps());
    prRec.probeThrow = true;
    await tick();
    assert.equal(core.getBridgeStatus('imPr').connectionState, 'connected', 'state frozen while the probe throws');
    prRec.probeThrow = false;
    prRec.probeState = 'reconnecting';
    await tick();
    assert.equal(core.getBridgeStatus('imPr').connectionState, 'reconnecting', 'interval must survive the throw');
  });

  it('stopBridge clears the poll timer', async () => {
    await core.startBridge('imPr', deps());
    await tick();
    await core.stopBridge('imPr');
    const calls = prRec.probeCalls;
    await tick(30);
    assert.equal(prRec.probeCalls, calls, 'no probe calls after stop');
    assert.equal(core.getBridgeStatus('imPr').connectionState, 'disconnected');
  });
});
