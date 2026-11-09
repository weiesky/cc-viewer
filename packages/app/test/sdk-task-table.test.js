/**
 * sdk-task-table.test.js
 *
 * Covers the bounded server-side sdk-task table added for the active-agents strip
 * (review: stale strip on lost frames / session switch). Until this change the
 * sdk-task relay was stateless — a frame lost in a WS gap was unrecoverable, so a
 * reconnected client never learned an in-flight agent and a client whose terminal
 * frame was lost kept the agent "active" forever.
 *
 * The table is folded from the same normalized frames the relay broadcasts, scoped
 * to one sessionId, capped, cleared on session switch/reset, and exposed via
 * getSdkTaskSnapshot() for WS reconnect replay.
 *
 * No real SDK network (fake query replaces _query). Conventions mirror
 * sdk-session-state.test.js: env first → dynamic import, broadcastWs captured,
 * resident fake query drives system messages, deterministic microtask ticks.
 */

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTest as _resetErrReport } from '@ccv/core/error-report';

let tmpDir;
let sdk;

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ccv-sdk-tasktbl-'));
  process.env.CCV_LOG_DIR = tmpDir;
  sdk = await import('../server/lib/sdk-manager.js');
});

after(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

afterEach(async () => {
  _resetErrReport();
  try { await sdk.stopSession(); } catch { /* best-effort */ }
});

function makeDeps() {
  const broadcasts = [];
  return { deps: { broadcastWs: (m) => broadcasts.push(m), onTurnEnd: () => {} }, broadcasts };
}

function sysInit(sessionId = 'sess-1') {
  return { type: 'system', subtype: 'init', session_id: sessionId, model: 'claude-x', slash_commands: [], tools: [] };
}
function resultMsg() {
  return { type: 'result', subtype: 'success' };
}
function taskMsg(subtype, fields, sessionId = 'sess-1') {
  return { type: 'system', subtype, session_id: sessionId, ...fields };
}

async function tick(n = 6) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

// Minimal resident fake: emits initMsgs, then on each user message emits respond()
// output immediately and ends. Sufficient to push sdk-task system frames through
// _processMessage.
function makeResidentQuery({ initMsgs, respond } = {}) {
  return function fakeQuery({ prompt, options }) {
    void options;
    return {
      async *[Symbol.asyncIterator]() {
        for (const m of initMsgs || []) { await Promise.resolve(); yield m; }
        for await (const msg of prompt) {
          void msg;
          const out = respond ? respond() : [resultMsg()];
          for (const m of out) { await Promise.resolve(); yield m; }
        }
      },
      interrupt: async () => {},
      setPermissionMode: async () => {},
      setModel: async () => {},
      supportedCommands: async () => [],
      mcpServerStatus: async () => [],
    };
  };
}

describe('sdk-task server table', () => {
  it('starts empty: no snapshot before any task frame', async () => {
    const { deps } = makeDeps();
    sdk.__setQueryForTests(makeResidentQuery({ initMsgs: [sysInit()] }));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('hi');
    await tick();
    assert.equal(sdk.getSdkTaskSnapshot(), null);
  });

  it('folds task_started (+toolUseId/prompt) into the table and exposes it via the snapshot', async () => {
    const { deps } = makeDeps();
    sdk.__setQueryForTests(makeResidentQuery({
      initMsgs: [sysInit()],
      respond: () => [
        taskMsg('task_started', { task_id: 't1', task_type: 'local_agent', tool_use_id: 'toolu_1', description: 'Explore codebase', prompt: 'Find boundary checks' }),
        resultMsg(),
      ],
    }));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('hi');
    await tick(8);

    const snap = sdk.getSdkTaskSnapshot();
    assert.ok(snap, 'snapshot present after a task frame');
    assert.equal(snap.type, 'sdk-task-snapshot');
    assert.equal(snap.sessionId, 'sess-1');
    assert.equal(snap.tasks.length, 1);
    const t = snap.tasks[0];
    assert.equal(t.taskId, 't1');
    assert.equal(t.taskType, 'local_agent');
    assert.equal(t.toolUseId, 'toolu_1');
    assert.equal(t.promptSnippet, 'Find boundary checks');
    assert.equal(t.terminal, false);
  });

  it('marks a task terminal via task_notification and keeps it in the table', async () => {
    const { deps } = makeDeps();
    sdk.__setQueryForTests(makeResidentQuery({
      initMsgs: [sysInit()],
      respond: () => [
        taskMsg('task_started', { task_id: 't1', task_type: 'local_agent', tool_use_id: 'toolu_1', description: 'd', prompt: 'p' }),
        taskMsg('task_notification', { task_id: 't1', status: 'completed' }),
        resultMsg(),
      ],
    }));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('hi');
    await tick(8);

    const snap = sdk.getSdkTaskSnapshot();
    assert.equal(snap.tasks.length, 1);
    assert.equal(snap.tasks[0].status, 'completed');
    assert.equal(snap.tasks[0].terminal, true);
  });

  it('a new sessionId on a task frame resets the table (no cross-session leak)', async () => {
    const { deps } = makeDeps();
    sdk.__setQueryForTests(makeResidentQuery({
      initMsgs: [sysInit()],
      respond: () => [
        taskMsg('task_started', { task_id: 'old', task_type: 'local_agent', tool_use_id: 'toolu_old', description: 'd', prompt: 'p' }, 'sess-1'),
        // A frame from a DIFFERENT session — the previous session's task must drop.
        taskMsg('task_started', { task_id: 'new', task_type: 'local_agent', tool_use_id: 'toolu_new', description: 'd2', prompt: 'p2' }, 'sess-2'),
        resultMsg(),
      ],
    }));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('hi');
    await tick(8);

    const snap = sdk.getSdkTaskSnapshot();
    assert.equal(snap.sessionId, 'sess-2');
    assert.deepEqual(snap.tasks.map((t) => t.taskId), ['new'], 'old session task evicted');
  });

  it('switchToSession clears the table (reconnect must not see the old session)', async () => {
    const { deps } = makeDeps();
    sdk.__setQueryForTests(makeResidentQuery({
      initMsgs: [sysInit()],
      respond: () => [
        taskMsg('task_started', { task_id: 't1', task_type: 'local_agent', tool_use_id: 'toolu_1', description: 'd', prompt: 'p' }),
        resultMsg(),
      ],
    }));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('hi');
    await tick(8);
    assert.ok(sdk.getSdkTaskSnapshot());

    const r = sdk.switchToSession('sess-other');
    assert.equal(r.ok, true);
    assert.equal(sdk.getSdkTaskSnapshot(), null, 'table cleared on session switch');
  });
});
