// Turn-level active flag (turnActive) server-side aggregation unit tests.
//
// Env MUST be set before importing interceptor / server:
// - CCV_PROXY_MODE=1 prevents interceptor from starting a server / setupInterceptor
// - CCV_WORKSPACE_MODE=1 prevents server.js from auto-running startViewer()
// - NODE_ENV=test makes server.js's __testing namespace real (frozen no-op otherwise)
process.env.CCV_PROXY_MODE = '1';
process.env.CCV_WORKSPACE_MODE = '1';
process.env.NODE_ENV = 'test';

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { unwatchFile } from 'node:fs';

let serverMod, turnActive, PROFILE_PATH;

before(async () => {
  const interceptor = await import('../server/interceptor.js');
  turnActive = interceptor.turnActive;
  PROFILE_PATH = interceptor.PROFILE_PATH;
  serverMod = await import('../server/server.js');
});

after(() => { try { unwatchFile(PROFILE_PATH); } catch {} });

beforeEach(() => {
  serverMod.__testing.reset();
});

describe('isTurnStartTaskEvent predicate', () => {
  it('accepts a main-agent UserPromptSubmit', () => {
    assert.equal(serverMod.isTurnStartTaskEvent({ hookEventName: 'UserPromptSubmit', sessionId: 's1' }), true);
  });

  it('rejects subagent/teammate prompt events (agentId)', () => {
    assert.equal(serverMod.isTurnStartTaskEvent({ hookEventName: 'UserPromptSubmit', sessionId: 's1', agentId: 'a-1' }), false);
  });

  it('rejects prompts from a DIFFERENT session than the tracked turn (sessionId is load-bearing)', () => {
    // agentId is NOT reliably present on UserPromptSubmit (task-bridge header) — the
    // sessionId gate is what keeps a teammate's prompt (inheriting CCVIEWER_PORT) from
    // lighting the main view's spinner.
    assert.equal(serverMod.isTurnStartTaskEvent({ hookEventName: 'UserPromptSubmit', sessionId: 'teammate-sess' }, 'main-sess'), false);
    // Same session as the tracked turn passes; null window (nothing tracked) passes.
    assert.equal(serverMod.isTurnStartTaskEvent({ hookEventName: 'UserPromptSubmit', sessionId: 'main-sess' }, 'main-sess'), true);
    assert.equal(serverMod.isTurnStartTaskEvent({ hookEventName: 'UserPromptSubmit', sessionId: 'any' }, null), true);
  });

  it('rejects other hook events and malformed payloads', () => {
    assert.equal(serverMod.isTurnStartTaskEvent({ hookEventName: 'TaskCreated', taskId: '1' }), false);
    assert.equal(serverMod.isTurnStartTaskEvent(null), false);
    assert.equal(serverMod.isTurnStartTaskEvent({}), false);
    assert.equal(serverMod.isTurnStartTaskEvent({ hookEventName: 'UserPromptSubmit' }), false, 'no sessionId → reject');
  });
});

describe('turnActive aggregation', () => {
  it('lights on UserPromptSubmit via the production gate (notifyTaskEvent)', () => {
    assert.equal(serverMod.__testing.getPtyTurnActive(), false);
    serverMod.__testing.notifyTaskEvent({ hookEventName: 'UserPromptSubmit', sessionId: 's1' });
    assert.equal(serverMod.__testing.getPtyTurnActive(), true);
    assert.equal(turnActive.active, true, 'shared interceptor flag is the same truth');
  });

  it('ignores subagent prompt events', () => {
    serverMod.__testing.notifyTaskEvent({ hookEventName: 'UserPromptSubmit', sessionId: 's1', agentId: 'a-9' });
    assert.equal(serverMod.__testing.getPtyTurnActive(), false);
  });

  it('clears on raw Stop POST arrival (clearPtyTurnActive) and is idempotent', () => {
    serverMod.__testing.notifyTaskEvent({ hookEventName: 'UserPromptSubmit', sessionId: 's1' });
    serverMod.__testing.clearPtyTurnActive();
    assert.equal(serverMod.__testing.getPtyTurnActive(), false);
    // Second clear must be a no-op (state-change guard: no double broadcast).
    serverMod.__testing.clearPtyTurnActive();
    assert.equal(serverMod.__testing.getPtyTurnActive(), false);
  });

  it('duplicate UserPromptSubmit does not re-set (state-change guard)', () => {
    serverMod.__testing.notifyTaskEvent({ hookEventName: 'UserPromptSubmit', sessionId: 's1' });
    serverMod.__testing.notifyTaskEvent({ hookEventName: 'UserPromptSubmit', sessionId: 's1' });
    assert.equal(serverMod.__testing.getPtyTurnActive(), true);
  });

  it('__testing.reset() drops the flag (test isolation)', () => {
    serverMod.__testing.setPtyTurnActive(true);
    assert.equal(serverMod.__testing.getPtyTurnActive(), true);
    serverMod.__testing.reset();
    assert.equal(serverMod.__testing.getPtyTurnActive(), false);
    assert.equal(turnActive.active, false);
  });

  it('a DIFFERENT session\'s prompt does not re-light after a clear (sessionId gate)', () => {
    // Main turn running; its Stop clears the flag but KEEPS the session tag; a
    // teammate process prompt (same hook channel, different session, no agentId —
    // the unreliable-agentId case) must not re-light the main view's spinner.
    serverMod.__testing.notifyTaskEvent({ hookEventName: 'UserPromptSubmit', sessionId: 'main-sess' });
    assert.equal(serverMod.__testing.getPtyTurnActive(), true);
    serverMod.__testing.clearPtyTurnActive();
    assert.equal(serverMod.__testing.getPtyTurnActive(), false);
    serverMod.__testing.notifyTaskEvent({ hookEventName: 'UserPromptSubmit', sessionId: 'teammate-sess' });
    assert.equal(serverMod.__testing.getPtyTurnActive(), false, 'foreign session prompt rejected by the sessionId gate');
    // The main session's own next prompt still lights (tag re-arms).
    serverMod.__testing.notifyTaskEvent({ hookEventName: 'UserPromptSubmit', sessionId: 'main-sess' });
    assert.equal(serverMod.__testing.getPtyTurnActive(), true);
  });
});
