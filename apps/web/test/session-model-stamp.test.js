/**
 * session.model stamping — the session-level model identity used by ChatView as
 * the per-message fallback when producer resolution is null (the "MainAgent" +
 * generic-avatar flash on carried-over history at a live session boundary).
 *
 * Covers all four session-creating/updating paths of mergeMainAgentSessions,
 * the inProgress body.model → response.body.model latest-wins upgrade, and the
 * applyInPlaceLastMsgReplace carry (the one session-rebuild site that bypasses
 * the merge). sessionManager transitively imports Vite-style extensionless
 * specifiers → shims loader + dynamic import (sessionMerge itself is pure but
 * loaded the same way for consistency).
 */
import './_shims/register.mjs';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

let mergeMainAgentSessions, applyInPlaceLastMsgReplace, getEffectiveModel;

before(async () => {
  ({ mergeMainAgentSessions } = await import('../src/utils/sessionMerge.js'));
  ({ applyInPlaceLastMsgReplace } = await import('../src/utils/sessionManager.js'));
  ({ getEffectiveModel } = await import('../src/utils/effectiveModel.js'));
});

function makeEntry(messages, opts = {}) {
  return {
    timestamp: opts.timestamp || '2026-01-01T00:00:00.000Z',
    _isCheckpoint: opts._isCheckpoint,
    _inPlaceReplaceDetected: opts._inPlaceReplaceDetected,
    inProgress: opts.inProgress,
    body: {
      model: opts.bodyModel,
      messages,
      metadata: { user_id: opts.userId || 'user-1' },
    },
    // response omitted for inProgress entries (interceptor pre-write has none)
    response: 'response' in opts ? opts.response : { status: 200, body: opts.responseModel ? { model: opts.responseModel } : {} },
  };
}

const userMsg = (text) => ({ role: 'user', content: text });
const asstMsg = (text) => ({ role: 'assistant', content: [{ type: 'text', text }] });
const clearMsg = () => ({ role: 'user', content: [{ type: 'text', text: '<command-name>/clear</command-name>' }] });

describe('getEffectiveModel (pure module)', () => {
  it('prefers response.body.model over body.model; null when both missing', () => {
    assert.equal(getEffectiveModel({ body: { model: 'a' }, response: { body: { model: 'b' } } }), 'b');
    assert.equal(getEffectiveModel({ body: { model: 'a' } }), 'a');
    assert.equal(getEffectiveModel({ body: {} }), null);
    assert.equal(getEffectiveModel(null), null);
  });
});

describe('mergeMainAgentSessions stamps session.model on all four paths', () => {
  it('first-turn-ever (empty prevSessions) stamps from an inProgress carrier body.model', () => {
    const entry = makeEntry([userMsg('hi')], { inProgress: true, bodyModel: 'claude-fable-5', response: undefined });
    const sessions = mergeMainAgentSessions([], entry, { skipTransientFilter: true });
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].model, 'claude-fable-5');
  });

  it('post-clear checkpoint session stamps from the checkpoint entry', () => {
    const prev = mergeMainAgentSessions([], makeEntry(
      [userMsg('old'), asstMsg('old reply'), userMsg('old2'), asstMsg('old reply 2'), userMsg('old3'), asstMsg('old reply 3')],
      { bodyModel: 'claude-fable-5' }), { skipTransientFilter: true });
    const cp = makeEntry([clearMsg(), userMsg('fresh')], { _isCheckpoint: true, bodyModel: 'claude-opus-4-8', response: undefined, inProgress: true });
    const sessions = mergeMainAgentSessions(prev, cp, { skipTransientFilter: true });
    assert.equal(sessions.length, 2);
    assert.equal(sessions[1].model, 'claude-opus-4-8');
    assert.equal(sessions[0].model, 'claude-fable-5', 'previous session stamp untouched');
  });

  it('same-session merge re-stamps latest-wins (body.model upgraded to response.body.model)', () => {
    const inflight = makeEntry([userMsg('q')], { inProgress: true, bodyModel: 'claude-fable-5', response: undefined });
    let sessions = mergeMainAgentSessions([], inflight, { skipTransientFilter: true });
    assert.equal(sessions[0].model, 'claude-fable-5');
    // Completion of the same turn: server-reported model is authoritative (proxy hot-switch).
    const completed = makeEntry([userMsg('q'), asstMsg('a')], { bodyModel: 'claude-fable-5', responseModel: 'claude-opus-4-8' });
    sessions = mergeMainAgentSessions(sessions, completed, { skipTransientFilter: true });
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].model, 'claude-opus-4-8');
  });

  it('a model-less entry keeps the existing stamp (no null-out)', () => {
    let sessions = mergeMainAgentSessions([], makeEntry([userMsg('q')], { bodyModel: 'claude-fable-5' }), { skipTransientFilter: true });
    sessions = mergeMainAgentSessions(sessions, makeEntry([userMsg('q'), asstMsg('a')], {}), { skipTransientFilter: true });
    assert.equal(sessions[0].model, 'claude-fable-5');
  });

  it('new-user session append stamps the new session independently', () => {
    let sessions = mergeMainAgentSessions([], makeEntry([userMsg('q')], { bodyModel: 'claude-fable-5', userId: 'user-1' }), { skipTransientFilter: true });
    sessions = mergeMainAgentSessions(sessions, makeEntry([userMsg('other')], { bodyModel: 'claude-opus-4-8', userId: 'user-2' }), { skipTransientFilter: true });
    assert.equal(sessions.length, 2);
    assert.equal(sessions[0].model, 'claude-fable-5');
    assert.equal(sessions[1].model, 'claude-opus-4-8');
  });

  it('sessions without any model stay model: null (fallback disabled downstream)', () => {
    const sessions = mergeMainAgentSessions([], makeEntry([userMsg('q')], {}), { skipTransientFilter: true });
    assert.equal(sessions[0].model, null);
  });
});

describe('applyInPlaceLastMsgReplace carries session.model', () => {
  const baseMessages = [userMsg('q'), asstMsg('a1')];

  function makeStampedSession(model) {
    return { userId: 'user-1', messages: baseMessages.slice(), response: { status: 200, body: {} }, entryTimestamp: 'T0', model };
  }

  it('refreshes the stamp from the completed entry (authoritative response model)', () => {
    const entry = makeEntry([userMsg('q'), asstMsg('a2')], {
      _inPlaceReplaceDetected: true, _isCheckpoint: true,
      bodyModel: 'claude-fable-5', responseModel: 'claude-opus-4-8',
    });
    const result = applyInPlaceLastMsgReplace([makeStampedSession('claude-fable-5')], entry, 'T1', false);
    assert.equal(result.applied, true);
    assert.equal(result.sessions[0].model, 'claude-opus-4-8');
  });

  it('preserves the previous stamp when the entry carries no model', () => {
    const entry = makeEntry([userMsg('q'), asstMsg('a2')], {
      _inPlaceReplaceDetected: true, _isCheckpoint: true,
    });
    const result = applyInPlaceLastMsgReplace([makeStampedSession('claude-fable-5')], entry, 'T1', false);
    assert.equal(result.applied, true);
    assert.equal(result.sessions[0].model, 'claude-fable-5',
      'the rebuilt session object must not drop the stamp (it bypasses the merge)');
  });
});
