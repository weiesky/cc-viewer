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
  it('replays an authoritative empty frame before any task frame (not null)', async () => {
    const { deps } = makeDeps();
    sdk.__setQueryForTests(makeResidentQuery({ initMsgs: [sysInit()] }));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('hi');
    await tick();

    const snap = sdk.getSdkTaskSnapshot();
    assert.ok(snap, 'empty table still yields a replay frame — the client reconciles to "no tasks"');
    assert.equal(snap.type, 'sdk-task-snapshot');
    assert.equal(snap.sessionId, 'sess-1');
    assert.deepEqual(snap.tasks, []);
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
        // Status-only terminal frame: relies on the fold preserving the started
        // frame's description (prev merge, not replace — regression: the fold
        // used to receive prev=undefined because the LRU delete ran before get).
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
    assert.equal(snap.tasks[0].description, 'd', 'started frame description survives the fold merge');
    assert.equal(snap.tasks[0].toolUseId, 'toolu_1', 'started frame toolUseId survives the fold merge');
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
    assert.equal(sdk.getSdkTaskSnapshot().tasks.length, 1);

    const r = sdk.switchToSession('sess-other');
    assert.equal(r.ok, true);
    const snap = sdk.getSdkTaskSnapshot();
    assert.deepEqual(snap.tasks, [], 'table cleared on session switch (empty frame, not null)');
  });

  it('an init with a new session_id (/clear) clears the table with no task frame following', async () => {
    const { deps } = makeDeps();
    let turn = 0;
    sdk.__setQueryForTests(makeResidentQuery({
      initMsgs: [sysInit()],
      respond: () => {
        turn += 1;
        return turn === 1
          ? [taskMsg('task_started', { task_id: 't1', task_type: 'local_agent', tool_use_id: 'toolu_1', description: 'd', prompt: 'p' }), resultMsg()]
          : [sysInit('sess-2'), resultMsg()]; // /clear re-init, no task frame
      },
    }));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('hi');
    await tick(8);
    assert.equal(sdk.getSdkTaskSnapshot().tasks.length, 1);

    await sdk.sendUserMessage('/clear');
    await tick(8);
    const snap = sdk.getSdkTaskSnapshot();
    assert.equal(snap.sessionId, 'sess-2');
    assert.deepEqual(snap.tasks, [], 'init session boundary drops the outgoing session that had no terminal frame');
  });

  it('skipTranscript tasks are folded (session boundary still detected) but excluded from the replay', async () => {
    const { deps } = makeDeps();
    sdk.__setQueryForTests(makeResidentQuery({
      initMsgs: [sysInit()],
      respond: () => [
        taskMsg('task_started', { task_id: 'bg', task_type: 'local_agent', skip_transcript: true, description: 'ambient' }),
        taskMsg('task_started', { task_id: 'vis', task_type: 'local_agent', tool_use_id: 'toolu_2', description: 'visible' }),
        resultMsg(),
      ],
    }));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('hi');
    await tick(8);

    const snap = sdk.getSdkTaskSnapshot();
    assert.deepEqual(snap.tasks.map((t) => t.taskId), ['vis'], 'ambient task hidden from the replay (live-path parity)');

    // Folding (not dropping) the ambient entry is what keeps the session-boundary check
    // working when a skipTranscript frame is the first one carrying the new sessionId.
    const { deps: deps2 } = makeDeps();
    sdk.__setQueryForTests(makeResidentQuery({
      initMsgs: [sysInit()],
      respond: () => [
        taskMsg('task_started', { task_id: 'vis', task_type: 'local_agent', tool_use_id: 'toolu_3', description: 'visible' }),
        taskMsg('task_started', { task_id: 'bg', task_type: 'local_agent', skip_transcript: true }, 'sess-2'),
        resultMsg(),
      ],
    }));
    sdk.initSdkSession(tmpDir, 'proj', deps2);
    await sdk.sendUserMessage('hi');
    await tick(8);
    const snap2 = sdk.getSdkTaskSnapshot();
    assert.equal(snap2.sessionId, 'sess-2', 'skipTranscript frame still triggers the session boundary');
    assert.deepEqual(snap2.tasks, []);
  });

  it('merges task_updated.patch.description into the folded entry', async () => {
    const { deps } = makeDeps();
    sdk.__setQueryForTests(makeResidentQuery({
      initMsgs: [sysInit()],
      respond: () => [
        taskMsg('task_started', { task_id: 't1', task_type: 'local_agent', description: 'old blurb' }),
        taskMsg('task_updated', { task_id: 't1', patch: { description: 'new blurb', status: 'running' } }),
        resultMsg(),
      ],
    }));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('hi');
    await tick(8);

    const t = sdk.getSdkTaskSnapshot().tasks[0];
    assert.equal(t.description, 'new blurb');
    assert.equal(t.status, 'running');
    assert.equal(t.terminal, false);
  });

  it('hides label-less terminal entries (no description, no summary) from the replay', async () => {
    // The HUD renders subject || description || '#id'. A label-less entry —
    // realistic origin: a status-only task_updated or task_notification (no
    // summary) arriving as the FIRST frame for its taskId, with no prior
    // started/description to merge into — would surface as a bare "#id" row,
    // which is noise, not an actionable TODO. The replay must NOT send it.
    const { deps } = makeDeps();
    sdk.__setQueryForTests(makeResidentQuery({
      initMsgs: [sysInit()],
      respond: () => [
        // Only task_notification, no task_started, no summary.
        taskMsg('task_notification', { task_id: 'ghost', status: 'completed' }),
        taskMsg('task_started', { task_id: 'vis', task_type: 'local_agent', tool_use_id: 'toolu_v', description: 'visible' }),
        resultMsg(),
      ],
    }));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('hi');
    await tick(8);

    const snap = sdk.getSdkTaskSnapshot();
    assert.deepEqual(snap.tasks.map((t) => t.taskId), ['vis'],
      'label-less ghost (no started, no summary) is hidden from the replay');
  });

  it('keeps a summary-only task_notification entry (label via summary → client description)', async () => {
    // Degenerate-but-displayable: a task_notification with a summary (terminal
    // result blurb) and no description still renders a meaningful row on the
    // HUD via the subject || description fallback (client maps summary →
    // description), so the replay should keep it. The fixture has NO
    // task_started frame — this entry is the "ghost" the HUD fallback relabels.
    const { deps } = makeDeps();
    sdk.__setQueryForTests(makeResidentQuery({
      initMsgs: [sysInit()],
      respond: () => [
        taskMsg('task_notification', { task_id: 'sum', status: 'completed', summary: 'Find dispatch of non-interactive local commands' }),
        resultMsg(),
      ],
    }));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('hi');
    await tick(8);

    const snap = sdk.getSdkTaskSnapshot();
    assert.deepEqual(snap.tasks.map((t) => t.taskId), ['sum'],
      'summary-only entry is kept in the replay (client maps summary → description)');
    assert.equal(snap.tasks[0].summary, 'Find dispatch of non-interactive local commands');
  });

  it('label-less filter spares skipTranscript ambient entries independently', async () => {
    // skipTranscript is hidden by its own filter (session-boundary detection).
    // The new description/summary filter must not change that behaviour.
    const { deps } = makeDeps();
    sdk.__setQueryForTests(makeResidentQuery({
      initMsgs: [sysInit()],
      respond: () => [
        taskMsg('task_started', { task_id: 'bg', task_type: 'local_agent', skip_transcript: true, description: 'ambient' }),
        taskMsg('task_notification', { task_id: 'ghost2', status: 'completed' }), // label-less, hidden by new filter
        taskMsg('task_started', { task_id: 'vis', task_type: 'local_agent', description: 'visible' }),
        resultMsg(),
      ],
    }));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('hi');
    await tick(8);

    const snap = sdk.getSdkTaskSnapshot();
    assert.deepEqual(snap.tasks.map((t) => t.taskId), ['vis'],
      'ambient hidden by skipTranscript filter; ghost hidden by label-less filter');
  });

  it('a started task keeps its label across a status-only task_updated patch', async () => {
    // Regression guard for the fold bug: the LRU delete used to run before the
    // .get(), so _foldSdkTask received prev=undefined and any patch-only frame
    // would replace the entry, wiping description/toolUseId. The label-less
    // filter would then hide a real, running task from the replay.
    const { deps } = makeDeps();
    sdk.__setQueryForTests(makeResidentQuery({
      initMsgs: [sysInit()],
      respond: () => [
        taskMsg('task_started', { task_id: 't1', task_type: 'local_agent', tool_use_id: 'toolu_1', description: 'Explore codebase', prompt: 'find things' }),
        taskMsg('task_updated', { task_id: 't1', patch: { status: 'completed' } }), // status-only patch
        resultMsg(),
      ],
    }));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('hi');
    await tick(8);

    const snap = sdk.getSdkTaskSnapshot();
    assert.equal(snap.tasks.length, 1, 'started task survives a status-only patch (fold merge, not replace)');
    const t = snap.tasks[0];
    assert.equal(t.taskId, 't1');
    assert.equal(t.description, 'Explore codebase', 'description survives');
    assert.equal(t.toolUseId, 'toolu_1', 'toolUseId survives');
    assert.equal(t.taskType, 'local_agent', 'taskType survives');
    assert.equal(t.promptSnippet, 'find things', 'promptSnippet survives');
    assert.equal(t.status, 'completed');
    assert.equal(t.terminal, true);
  });

  it('a task_started re-fire resets run-scoped state (status, summary, usage)', async () => {
    // Regression guard for the P1 introduced by the fold merge fix: prev is
    // now correctly passed in, but a task_started re-fire must NOT inherit the
    // previous run's terminal status / summary / usage — a taskId can be reused
    // (e.g. agent respawned after completion). The client tracker resets to
    // in_progress on re-fire; the server fold must match or a WS reconnect
    // would clobber the live row back to the stale terminal state.
    const { deps } = makeDeps();
    let turn = 0;
    sdk.__setQueryForTests(makeResidentQuery({
      initMsgs: [sysInit()],
      respond: () => {
        turn += 1;
        if (turn === 1) {
          return [
            taskMsg('task_started', { task_id: 't1', task_type: 'local_agent', tool_use_id: 'toolu_1', description: 'Run A' }),
            taskMsg('task_notification', { task_id: 't1', status: 'completed', summary: 'A done' }),
            resultMsg(),
          ];
        }
        // Second turn: re-fire task_started with the same taskId (new run).
        return [
          taskMsg('task_started', { task_id: 't1', task_type: 'local_agent', tool_use_id: 'toolu_2', description: 'Run B' }),
          resultMsg(),
        ];
      },
    }));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('hi');
    await tick(8);
    // Sanity: after run A the entry is terminal-completed with summary.
    let t = sdk.getSdkTaskSnapshot().tasks.find((x) => x.taskId === 't1');
    assert.equal(t.status, 'completed');
    assert.equal(t.summary, 'A done');

    await sdk.sendUserMessage('again');
    await tick(8);
    t = sdk.getSdkTaskSnapshot().tasks.find((x) => x.taskId === 't1');
    assert.equal(t.status, 'running', 're-fired started resets status');
    assert.equal(t.terminal, false, 're-fired started clears terminal flag');
    assert.equal(t.summary, undefined, 'previous run summary is cleared');
    assert.equal(t.description, 'Run B', 'new description wins');
    assert.equal(t.toolUseId, 'toolu_2', 'new toolUseId wins');
  });
});
