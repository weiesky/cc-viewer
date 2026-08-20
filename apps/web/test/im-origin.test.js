import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseImOrigin, IM_ORIGIN_RE } from '../src/utils/imOrigin.js';

describe('parseImOrigin', () => {
  it('strips a leading dingtalk marker and reports the source', () => {
    assert.deepEqual(parseImOrigin('⟦im:dingtalk⟧看一下整体效果'), { text: '看一下整体效果', imSource: 'dingtalk', senderId: null });
  });

  it('strips the single optional space after the marker', () => {
    assert.deepEqual(parseImOrigin('⟦im:dingtalk⟧ hello'), { text: 'hello', imSource: 'dingtalk', senderId: null });
  });

  it('returns text unchanged when there is no marker', () => {
    assert.deepEqual(parseImOrigin('just a normal message'), { text: 'just a normal message', imSource: null, senderId: null });
  });

  it('only matches a LEADING marker (not mid-string)', () => {
    const s = 'hello ⟦im:dingtalk⟧ world';
    assert.deepEqual(parseImOrigin(s), { text: s, imSource: null, senderId: null });
  });

  it('captures an arbitrary IM id (extensible to other bridges)', () => {
    assert.deepEqual(parseImOrigin('⟦im:slack⟧hi'), { text: 'hi', imSource: 'slack', senderId: null });
  });

  it('is case-sensitive (an upper-case lookalike is not a marker)', () => {
    const s = '⟦IM:DINGTALK⟧hi';
    assert.deepEqual(parseImOrigin(s), { text: s, imSource: null, senderId: null });
  });

  it('preserves multi-line content after the marker', () => {
    assert.deepEqual(parseImOrigin('⟦im:dingtalk⟧line1\nline2'), { text: 'line1\nline2', imSource: 'dingtalk', senderId: null });
  });

  it('tolerates non-string input', () => {
    assert.deepEqual(parseImOrigin(undefined), { text: undefined, imSource: null, senderId: null });
    assert.deepEqual(parseImOrigin(null), { text: null, imSource: null, senderId: null });
  });

  it('IM_ORIGIN_RE is anchored at start', () => {
    assert.equal(IM_ORIGIN_RE.source.startsWith('^'), true);
  });

  // ── senderId variant (⟦im:<id>:<senderId>⟧) ─────────────────────────────
  it('extracts the optional senderId after the platform id', () => {
    assert.deepEqual(parseImOrigin('⟦im:dingtalk:staff123⟧hi'), { text: 'hi', imSource: 'dingtalk', senderId: 'staff123' });
  });

  it('handles senderIds with dots/underscores (feishu open_id, discord snowflake)', () => {
    assert.deepEqual(parseImOrigin('⟦im:feishu:ou_a1b2.c3⟧你好'), { text: '你好', imSource: 'feishu', senderId: 'ou_a1b2.c3' });
    assert.deepEqual(parseImOrigin('⟦im:discord:123456789012345678⟧yo'), { text: 'yo', imSource: 'discord', senderId: '123456789012345678' });
  });

  it('strips the optional space after a sender marker too', () => {
    assert.deepEqual(parseImOrigin('⟦im:dingtalk:u1⟧ hello'), { text: 'hello', imSource: 'dingtalk', senderId: 'u1' });
  });

  it('legacy markers without a senderId still parse (backward compatible)', () => {
    assert.deepEqual(parseImOrigin('⟦im:dingtalk⟧legacy'), { text: 'legacy', imSource: 'dingtalk', senderId: null });
  });
});
