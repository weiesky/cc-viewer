/**
 * Same-name SDK twin WS isolation (review P2): a frame stamped with an instanceKey
 * must reach only clients viewing THAT instance — otherwise closing one same-basename
 * workspace wipes the surviving twin viewer's spinner/queue bubbles.
 *
 * Exercises the real broadcastWsMessage filter predicate with stubbed client set.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const tmpDir = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'ccv-ws-iso-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';
process.env.NODE_ENV = 'test';

const mod = await import('../server/server.js');

function makeClient(viewProject, viewInstance) {
  return {
    readyState: 1,
    sent: [],
    _ccvViewProject: viewProject || null,
    _ccvViewInstance: viewInstance || null,
    send(m) { this.sent.push(String(m)); },
  };
}

describe('broadcastWsMessage instance narrowing', () => {
  it('an instanceKey-stamped frame reaches only that instance viewer, not the same-basename twin', () => {
    const wss = { clients: new Set() };
    const a = makeClient('same', 'ccv-aaa111');
    const b = makeClient('same', 'ccv-bbb222');
    wss.clients.add(a);
    wss.clients.add(b);
    mod.setTerminalWssForTests(wss);
    try {
      mod.broadcastWsMessage({ type: 'queue-state', cwd: '/a/same', instanceKey: 'ccv-aaa111', items: [] });
      assert.equal(a.sent.length, 1, 'the owning instance viewer receives the frame');
      assert.equal(b.sent.length, 0, 'the same-basename twin viewer must NOT receive it');
      // Untagged / cwd-only frames narrow only by project — but b's viewInstance stamp
      // alone must not drop a project-scoped frame for it (its project matches).
      mod.broadcastWsMessage({ type: 'sdk-session-state', cwd: '/a/same', state: 'idle' });
      assert.equal(a.sent.length, 2);
      assert.equal(b.sent.length, 1, 'cwd-only frames stay project-scoped (unchanged behavior)');
    } finally {
      mod.setTerminalWssForTests(null);
    }
  });
});
