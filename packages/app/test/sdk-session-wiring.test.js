// R6 — durable process wiring. setSdkProcessWiring registers callbacks ONCE so a
// workspace stop→relaunch (which calls stopSession, clearing the mutable callbacks,
// then re-inits WITHOUT them) re-adopts the process wiring instead of silently losing
// every sdk-* frame. Tests never set it, so stopSession's clear-contract is unchanged.
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let sdk;
let tmpDir;

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ccv-sdk-wiring-'));
  process.env.CCV_LOG_DIR = tmpDir;
  process.env.CLAUDE_CONFIG_DIR = tmpDir;
  sdk = await import('../server/lib/sdk-manager.js');
});

afterEach(() => {
  try { sdk.stopSession(); } catch { /* best-effort */ }
  sdk.setSdkProcessWiring(null); // reset the seam so tests never leak durable wiring
});

function sysInit(sessionId = 'sess-1') {
  return { type: 'system', subtype: 'init', session_id: sessionId, model: 'm', slash_commands: [], tools: [] };
}
function resultMsg(extra = {}) { return { type: 'result', subtype: 'success', ...extra }; }
function makeResidentQuery({ initMsgs } = {}) {
  function fakeQuery({ prompt, options }) {
    const state = { ended: false };
    return {
      async *[Symbol.asyncIterator]() {
        for (const m of initMsgs || []) { if (state.ended) return; await Promise.resolve(); yield m; }
        for await (const msg of prompt) { if (state.ended) return; await Promise.resolve(); yield resultMsg(); }
      },
      interrupt() { return Promise.resolve(); },
      close() { state.ended = true; },
    };
  }
  return fakeQuery;
}

describe('sdk-session — durable process wiring (R6)', () => {
  it('stopSession clears callbacks; next init re-adopts the process wiring', async () => {
    const broadcasts = [];
    const turnEnds = [];
    sdk.setSdkProcessWiring({
      onTurnEnd: (x) => turnEnds.push(x),
      broadcastWs: (m) => broadcasts.push(m),
      // no explicit per-init deps on the second init below
    });
    sdk.__setQueryForTests(makeResidentQuery({ initMsgs: [sysInit()] }));
    // First init WITH no explicit broadcastWs/onTurnEnd — adopted from process wiring.
    sdk.initSdkSession(tmpDir, 'proj', {});
    await sdk.sendUserMessage('hi');
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    assert.ok(turnEnds.length >= 1, 'onTurnEnd adopted from process wiring on first init');
    assert.ok(broadcasts.some((b) => b.type === 'sdk-session-state'), 'broadcastWs adopted on first init');

    // stopSession clears the mutable callbacks (its test contract).
    sdk.stopSession();
    // Relaunch WITHOUT callbacks — the process wiring must re-fill them, or frames die.
    const broadcasts2 = [];
    const turnEnds2 = [];
    sdk.setSdkProcessWiring({ onTurnEnd: (x) => turnEnds2.push(x), broadcastWs: (m) => broadcasts2.push(m) });
    sdk.__setQueryForTests(makeResidentQuery({ initMsgs: [sysInit()] }));
    sdk.initSdkSession(tmpDir, 'proj', {}); // note: no onTurnEnd/broadcastWs here
    await sdk.sendUserMessage('again');
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    assert.ok(turnEnds2.length >= 1, 'relaunch re-adopts onTurnEnd from the durable process wiring');
    assert.ok(broadcasts2.some((b) => b.type === 'sdk-session-state'), 'relaunch re-adopts broadcastWs');
  });

  it('explicit init callbacks WIN over the process wiring (adoption only fills gaps)', async () => {
    const explicit = [];
    const process = [];
    sdk.setSdkProcessWiring({ broadcastWs: (m) => process.push(m) });
    sdk.__setQueryForTests(makeResidentQuery({ initMsgs: [sysInit()] }));
    sdk.initSdkSession(tmpDir, 'proj', { broadcastWs: (m) => explicit.push(m) });
    await sdk.sendUserMessage('hi');
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    assert.ok(explicit.some((b) => b.type === 'sdk-session-state'), 'explicit callback receives frames');
    assert.equal(process.filter((b) => b.type === 'sdk-session-state').length, 0, 'process wiring does not override an explicit callback');
  });

  it('setSdkProcessWiring(null) resets the seam (no adoption afterwards)', async () => {
    const broadcasts = [];
    sdk.setSdkProcessWiring({ broadcastWs: (m) => broadcasts.push(m) });
    sdk.setSdkProcessWiring(null);
    sdk.__setQueryForTests(makeResidentQuery({ initMsgs: [sysInit()] }));
    sdk.initSdkSession(tmpDir, 'proj', {});
    await sdk.sendUserMessage('hi');
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    assert.equal(broadcasts.length, 0, 'null reset leaves no durable wiring to adopt');
  });
});
