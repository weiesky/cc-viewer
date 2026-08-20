// Unit tests for src/utils/contextTurns.js — Context tab turn pairing, including
// mid-conversation role:"system" messages (mid-conversation-system beta) that must
// be folded into turns instead of orphaning the assistant reply that follows them.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

let M;
before(async () => {
  M = await import('../src/utils/contextTurns.js');
});

const user = (text, ts) => ({ role: 'user', content: text, ...(ts ? { _timestamp: ts } : {}) });
const asst = (text, ts) => ({ role: 'assistant', content: [{ type: 'text', text }], ...(ts ? { _timestamp: ts } : {}) });
const sys = (text, ts) => ({ role: 'system', content: text, ...(ts ? { _timestamp: ts } : {}) });

describe('groupMessagesIntoTurns — backward compatibility (no system messages)', () => {
  it('pairs strict user→assistant adjacency exactly as before', () => {
    const msgs = [user('q1', 't1'), asst('a1', 't2'), user('q2'), asst('a2')];
    const turns = M.groupMessagesIntoTurns(msgs);
    assert.equal(turns.length, 2);
    assert.equal(turns[0].id, 'turn__0');
    assert.equal(turns[0].turnIndex, 0);
    assert.equal(turns[0].timestamp, 't1');
    assert.equal(turns[0].assistantTimestamp, 't2');
    assert.equal(turns[0].rawUser, msgs[0]);
    assert.equal(turns[0].rawAssistant, msgs[1]);
    assert.equal(turns[0].systemBlocks, null);
    assert.equal(turns[0].rawSystem, null);
    assert.equal(turns[1].id, 'turn__2');
    assert.equal(turns[1].turnIndex, 1);
  });

  it('user without assistant reply → assistant fields null', () => {
    const turns = M.groupMessagesIntoTurns([user('q1'), user('q2'), asst('a2')]);
    assert.equal(turns.length, 2);
    assert.equal(turns[0].assistantBlocks, null);
    assert.equal(turns[0].rawAssistant, null);
    assert.equal(turns[1].rawAssistant.content[0].text, 'a2');
  });

  it('leading assistant / non-user-headed messages are skipped (documented invariant)', () => {
    const turns = M.groupMessagesIntoTurns([asst('orphan'), user('q'), asst('a')]);
    assert.equal(turns.length, 1);
    assert.equal(turns[0].id, 'turn__1');
  });

  it('empty input → empty output', () => {
    assert.deepEqual(M.groupMessagesIntoTurns([]), []);
  });
});

describe('groupMessagesIntoTurns — mid-conversation system messages', () => {
  it('system between user and assistant → assistant still pairs, system folded into turn', () => {
    const msgs = [user('q', 'tu'), sys('reminder text', 'ts'), asst('a', 'ta')];
    const turns = M.groupMessagesIntoTurns(msgs);
    assert.equal(turns.length, 1);
    assert.equal(turns[0].rawAssistant, msgs[2]);
    assert.equal(turns[0].assistantTimestamp, 'ta');
    assert.equal(turns[0].rawSystem.length, 1);
    assert.equal(turns[0].rawSystem[0], msgs[1]);
    assert.equal(turns[0].systemBlocks.length, 1);
    assert.equal(turns[0].systemBlocks[0].timestamp, 'ts');
    assert.deepEqual(turns[0].systemBlocks[0].blocks, [{ type: 'markdown', text: 'reminder text' }]);
  });

  it('consecutive system messages are all folded into the same turn', () => {
    const msgs = [user('q'), sys('r1'), sys('r2'), asst('a'), user('q2'), asst('a2')];
    const turns = M.groupMessagesIntoTurns(msgs);
    assert.equal(turns.length, 2);
    assert.equal(turns[0].rawSystem.length, 2);
    assert.equal(turns[0].rawAssistant, msgs[3]);
    // next turn's index namespace is unaffected by folding
    assert.equal(turns[1].id, 'turn__4');
    assert.equal(turns[1].turnIndex, 1);
  });

  it('system after user with no assistant following → turn keeps system, next user starts new turn', () => {
    const msgs = [user('q1'), sys('r'), user('q2'), asst('a2')];
    const turns = M.groupMessagesIntoTurns(msgs);
    assert.equal(turns.length, 2);
    assert.equal(turns[0].rawSystem.length, 1);
    assert.equal(turns[0].rawAssistant, null);
    assert.equal(turns[1].rawAssistant, msgs[3]);
  });

  it('trailing system message at end of list does not create a turn', () => {
    const turns = M.groupMessagesIntoTurns([user('q'), asst('a'), sys('tail')]);
    assert.equal(turns.length, 1);
    assert.equal(turns[0].rawSystem, null);
  });

  it('only role==="system" is skipped when pairing — unknown roles still end the turn', () => {
    const msgs = [user('q'), { role: 'tool', content: 'x' }, asst('a')];
    const turns = M.groupMessagesIntoTurns(msgs);
    assert.equal(turns.length, 1);
    assert.equal(turns[0].rawAssistant, null);
  });
});

describe('parseContentBlocks / extractPreviewText — string content passthrough', () => {
  it('string content → single markdown block', () => {
    assert.deepEqual(M.parseContentBlocks('hello'), [{ type: 'markdown', text: 'hello' }]);
    assert.deepEqual(M.parseContentBlocks('   '), []);
  });

  it('preview text from string and block-array content', () => {
    assert.equal(M.extractPreviewText('line1\nline2'), 'line1 line2');
    assert.equal(M.extractPreviewText([{ type: 'text', text: 'block text' }]), 'block text');
  });
});
