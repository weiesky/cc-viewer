/**
 * terminalAnchor (apps/web/src/utils/terminalAnchor.js): computes the
 * { project, sessionId } anchor stamped on every terminal-bound send frame.
 * Pure function — no DOM.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { terminalAnchor } from '../src/utils/terminalAnchor.js';

const sess = (uuid) => ({ _seqEpoch: `v2:${uuid}` });
const UUID_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const UUID_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

describe('terminalAnchor', () => {
  it('project = viewProject when set, else projectName', () => {
    assert.equal(terminalAnchor({ viewProject: 'finqa-remote-cc', projectName: 'sage' }).project, 'finqa-remote-cc');
    assert.equal(terminalAnchor({ viewProject: null, projectName: 'sage' }).project, 'sage');
    assert.equal(terminalAnchor({}).project, null);
  });

  it('sessionId derives from the latest rendered session (the [对话] source of truth)', () => {
    const a = terminalAnchor({ viewProject: 'finqa-remote-cc', mainAgentSessions: [sess(UUID_A), sess(UUID_B)] });
    assert.equal(a.sessionId, UUID_B, 'latest session wins');
  });

  it('attachedSid (historical view) suppresses sessionId → project-only routing', () => {
    const a = terminalAnchor({ viewProject: 'finqa-remote-cc', attachedSid: UUID_A, mainAgentSessions: [sess(UUID_B)] });
    assert.equal(a.sessionId, null);
    assert.equal(a.project, 'finqa-remote-cc');
  });

  it('no sessions / malformed epoch → sessionId null', () => {
    assert.equal(terminalAnchor({ viewProject: 'p', mainAgentSessions: [] }).sessionId, null);
    assert.equal(terminalAnchor({ viewProject: 'p', mainAgentSessions: [{ _seqEpoch: 'garbage' }] }).sessionId, null);
    assert.equal(terminalAnchor({ viewProject: 'p' }).sessionId, null);
  });

  it('sessionId is lowercased and segIdx stripped', () => {
    const a = terminalAnchor({ viewProject: 'p', mainAgentSessions: [{ _seqEpoch: `v2:${UUID_A.toUpperCase()}:3` }] });
    assert.equal(a.sessionId, UUID_A);
  });

  it('viewInstance passes through as instanceKey (multi-instance same-cwd disambiguation)', () => {
    const a = terminalAnchor({ viewProject: 'solo', viewInstance: 'ccv-abc123' });
    assert.equal(a.instanceKey, 'ccv-abc123', 'instanceKey carried to the anchor');
    assert.equal(a.project, 'solo');
  });

  it('malformed / absent viewInstance → instanceKey null (never stamps a bogus key)', () => {
    assert.equal(terminalAnchor({ viewProject: 'p', viewInstance: 'not a key' }).instanceKey, null);
    assert.equal(terminalAnchor({ viewProject: 'p', viewInstance: '' }).instanceKey, null);
    assert.equal(terminalAnchor({ viewProject: 'p' }).instanceKey, null, 'no viewInstance → null');
  });
});
