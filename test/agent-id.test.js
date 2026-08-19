// agent-id.js — parseAgentId / findHeader unit tests.
// The wire `x-claude-code-agent-id` header carries teammate/subagent identity:
//   named teammate:    `frontend-reviewer@session-17e1f37a-...`
//   anonymous subagent: `a7eea0a140349f80d` (pure hex, no @)
// Names are persisted from this header so display no longer depends on the
// frontend's window-scoped heuristic registry.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseAgentId, findHeader } from '../packages/app/server/lib/v2/agent-id.js';

describe('parseAgentId', () => {
  it('named teammate: name@session-<uuid>', () => {
    assert.deepEqual(parseAgentId('frontend-reviewer@session-17e1f37a-04e2-4d76-9192-26d35581a452'), { agentName: 'frontend-reviewer', named: true });
  });

  it('named teammate with @-suffix of another shape (uuid, no session- prefix)', () => {
    // The @-suffix is deliberately not validated.
    assert.deepEqual(parseAgentId('code-quality-reviewer@123e4567-e89b-12d3-a456-426614174000'), { agentName: 'code-quality-reviewer', named: true });
  });

  it('anonymous subagent: pure hex, no @', () => {
    assert.deepEqual(parseAgentId('a7eea0a140349f80d'), { agentName: null, named: false });
  });

  it('hex id of other lengths (8..64) still anonymous', () => {
    assert.deepEqual(parseAgentId('a1b2c3d4'), { agentName: null, named: false });
    assert.deepEqual(parseAgentId('a'.repeat(32)), { agentName: null, named: false });
  });

  it('hex id followed by @ is treated as anonymous, not a name', () => {
    assert.deepEqual(parseAgentId('a7eea0a140349f80d@session-abc'), { agentName: null, named: false });
  });

  it('name is truncated to 64 chars', () => {
    const long = 'x'.repeat(100) + '@session-1';
    assert.equal(parseAgentId(long).agentName.length, 64);
  });

  it('non-agent values return null (never guess a name)', () => {
    assert.equal(parseAgentId(null), null);
    assert.equal(parseAgentId(undefined), null);
    assert.equal(parseAgentId(''), null);
    assert.equal(parseAgentId('   '), null);
    assert.equal(parseAgentId('session-17e1f37a'), null); // no @, not hex
    assert.equal(parseAgentId('@session-1'), null);       // empty name before @
    assert.equal(parseAgentId('just-a-name'), null);      // no @, not hex
  });
});

describe('findHeader', () => {
  it('exact-key match', () => {
    assert.equal(findHeader({ 'x-claude-code-agent-id': 'a@b' }, 'x-claude-code-agent-id'), 'a@b');
  });

  it('case-insensitive match (undici folds to lowercase)', () => {
    assert.equal(findHeader({ 'X-Claude-Code-Agent-Id': 'a@b' }, 'x-claude-code-agent-id'), 'a@b');
    assert.equal(findHeader({ 'x-claude-code-agent-id': 'a@b' }, 'X-Claude-Code-Agent-Id'), 'a@b');
  });

  it('missing header returns undefined', () => {
    assert.equal(findHeader({ 'x-api-key': 'k' }, 'x-claude-code-agent-id'), undefined);
    assert.equal(findHeader(null, 'x-claude-code-agent-id'), undefined);
  });
});
