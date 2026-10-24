import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildResponseThinkingIndex,
  buildSessionThinkingDisplay,
  filterDisplayedResponseThinking,
} from '../src/utils/responseThinking.js';
import { filterLrContent, hasVisibleLrContent } from '../src/components/chat/interactionOwnership.js';
import { applyBatchEntryTimestamps } from '../src/utils/sessionManager.js';
import { mergeMainAgentSessions } from '../src/utils/sessionMerge.js';
import { createV3Assembler } from '../src/utils/v3Assembler.js';

const thinking = (text, signature) => ({ type: 'thinking', thinking: text, ...(signature && { signature }) });
const redacted = (data) => ({ type: 'redacted_thinking', data });
const text = (value) => ({ type: 'text', text: value });
const tool = (id, input = {}) => ({ type: 'tool_use', id, name: 'Read', input });
const assistant = (content, generatedTs = 't1') => ({ role: 'assistant', content, _timestamp: 't2', _generatedTs: generatedTs });
const mainEntry = (timestamp, content, extra = {}) => ({
  timestamp,
  mainAgent: true,
  body: { messages: [] },
  response: { body: { content } },
  _seqEpoch: 'v2:sid',
  ...extra,
});
const sessionWith = (messages, extra = {}) => ({ messages, _seqEpoch: 'v2:sid', entryTimestamp: 't9', ...extra });

function legacyEntry(timestamp, messages, userId, content) {
  return {
    timestamp,
    mainAgent: true,
    body: { messages, metadata: { user_id: userId } },
    response: { body: { content } },
    _seqEpoch: null,
  };
}

function batchState() {
  return {
    timestamps: [], generatedTimestamps: [], prevMainAgentTs: null,
    prevUserId: null, prevEpoch: null, currentSessionId: null,
  };
}

function restore(session, entries) {
  return buildSessionThinkingDisplay(session, buildResponseThinkingIndex(entries));
}

describe('responseThinking association and restoration', () => {
  it('restores signed Kimi thinking in response order without replacing enriched tool inputs', () => {
    const originalTool = tool('tool-1', { file_path: '/tmp/example', offset: 20 });
    const message = assistant([text('answer'), originalTool]);
    const responseContent = [thinking('reason', 'sig-1'), text('answer'), tool('tool-1', {})];
    const before = JSON.stringify(message);
    const result = restore(sessionWith([message]), [mainEntry('t1', responseContent)]);
    assert.deepEqual(result.contents[0].map((block) => block.type), ['thinking', 'text', 'tool_use']);
    assert.equal(result.contents[0][0], responseContent[0]);
    assert.equal(result.contents[0][1], message.content[0]);
    assert.equal(result.contents[0][2], originalTool);
    assert.equal(result.contents[0][2].input.offset, 20);
    assert.equal(JSON.stringify(message), before);
    assert.equal(result.displayedResponses.has(responseContent), true);
  });

  it('requires anchors even when the timestamp matches', () => {
    const message = assistant([text('new compacted answer')]);
    const result = restore(sessionWith([message]), [mainEntry('t1', [thinking('old turn'), text('old answer')])]);
    assert.equal(result.contents[0], message.content);
    assert.equal(result.restoredCount, 0);
  });

  it('does not restore across epochs or legacy session time bounds', () => {
    const message = assistant([text('answer')]);
    assert.equal(restore(sessionWith([message], { _seqEpoch: 'v2:other' }), [mainEntry('t1', [thinking('no'), text('answer')])]).restoredCount, 0);
    assert.equal(restore(sessionWith([message], { _seqEpoch: null, entryTimestamp: 't0' }), [mainEntry('t1', [thinking('no'), text('answer')], { _seqEpoch: null })]).restoredCount, 0);
  });

  it('rejects duplicate timestamps and duplicate message targets', () => {
    const message = assistant([text('answer')]);
    const response = [thinking('first'), text('answer')];
    assert.equal(restore(sessionWith([message]), [mainEntry('t1', response), mainEntry('t1', [thinking('retry'), text('answer')])]).restoredCount, 0);
    assert.equal(restore(sessionWith([message, { ...assistant([text('answer')]) }]), [mainEntry('t1', response)]).restoredCount, 0);
  });

  it('does not attach a future response to an older un-stamped assistant', () => {
    const old = assistant([text('Done.')], null);
    old._timestamp = 't2';
    const session = sessionWith([old], { body: { content: [thinking('latest'), text('Done.')] } }, { entryTimestamp: 't3' });
    session.response = { body: { content: [thinking('latest'), text('Done.')] } };
    const entries = [
      mainEntry('t1', [text('Done.')]),
      mainEntry('t3', [thinking('latest'), text('Done.')]),
    ];
    const result = restore(session, entries);
    assert.equal(result.restoredCount, 0);
    assert.equal(result.contents[0], old.content);
    assert.equal(result.displayedResponses.size, 0);
    assert.equal(filterDisplayedResponseThinking(session.response.body.content, session.response.body.content, result.displayedResponses).length, 2);
  });

  it('does not restore across overlapping epoch-less session windows', () => {
    const state = batchState();
    const first = legacyEntry('00:01', [{ role: 'user', content: 'A' }, assistant([text('same')], null)], 'A', [text('same')]);
    applyBatchEntryTimestamps(state, first);
    const sessions = mergeMainAgentSessions([], first);
    const next = legacyEntry('00:10', first.body.messages, 'A', [text('same')]);
    applyBatchEntryTimestamps(state, next);
    const merged = mergeMainAgentSessions(sessions, next);
    const other = mainEntry('00:05', [thinking('other session'), text('same')], { _seqEpoch: null });
    other._sessionId = 'session-B';
    first._sessionId = 'session-A';
    assert.equal(buildSessionThinkingDisplay(merged[0], buildResponseThinkingIndex([other])).restoredCount, 0);
    assert.equal(buildSessionThinkingDisplay(merged[0], buildResponseThinkingIndex([first, other])).restoredCount, 0);
  });

  it('resolves a v2 producer from an epoch-less merged session', () => {
    const message = assistant([text('v2 answer')], 't1');
    message._timestamp = 't2';
    const producer = mainEntry('t1', [thinking('v2 thought'), text('v2 answer')]);
    const carrier = mainEntry('t2', [text('next')], { body: { messages: [{ role: 'user', content: 'legacy' }, message] } });
    const result = restore(sessionWith([message], null, { _seqEpoch: null }), [producer, carrier]);
    assert.equal(result.contents[0][0].thinking, 'v2 thought');
  });

  it('restores cold-loaded v3 history from its next carrier', () => {
    const assembler = createV3Assembler();
    assembler.addConvLines('sid', 'main', [
      { t: 'snapshot', seq: 1, msgs: [{ role: 'user', content: 'first' }] },
      { t: 'append', seq: 2, msgs: [{ role: 'assistant', content: [text('cold answer')] }] },
      { t: 'append', seq: 3, msgs: [{ role: 'user', content: 'next' }] },
    ]);
    assembler.addRespLines('sid', [
      { seq: 1, body: { content: [thinking('cold thought'), text('cold answer')] } },
      { seq: 3, body: { content: [text('next')] } },
    ]);
    const first = assembler.buildEntry({ sessionId: 'sid', conv: 'main', seq: 1, timestamp: 't1', mainAgent: true });
    const carrier = assembler.buildEntry({ sessionId: 'sid', conv: 'main', seq: 2, timestamp: 't2', mainAgent: true });
    const latest = assembler.buildEntry({ sessionId: 'sid', conv: 'main', seq: 3, timestamp: 't3', mainAgent: true });
    first._sessionId = 'session-live';
    carrier._sessionId = 'session-live';
    const requests = [first, carrier, latest];
    const state = batchState();
    let sessions = [];
    for (const entry of requests) {
      applyBatchEntryTimestamps(state, entry);
      sessions = mergeMainAgentSessions(sessions, entry);
    }
    const session = sessions[0];
    const coldMessage = session.messages.find((message) => message.role === 'assistant');
    assert.ok(coldMessage);
    const result = restore(session, requests);
    assert.equal(result.contents[session.messages.indexOf(coldMessage)][0].thinking, 'cold thought');
  });

  it('recovers a stale producer timestamp from its actual carrier entry', () => {
    const previous = assistant([text('previous answer')], 't3');
    previous._timestamp = 't5';
    previous._generatedEpoch = 'v2:sid';
    previous._generatedSessionId = 'session-live';
    const message = assistant([text('from cold tail')], 't3');
    message._timestamp = 't6';
    const entry = mainEntry('t6', [thinking('next response'), text('next')], {
      body: { messages: [{ role: 'user', content: 'old' }, previous, { role: 'user', content: 'next' }, message] },
    });
    entry._sessionId = 'session-live';
    entry._prevMsgCount = 0;
    const requests = [
      mainEntry('t5', [thinking('correct thought'), text('from cold tail')], { _sessionId: 'session-live' }),
      entry,
    ];
    const result = buildSessionThinkingDisplay(
      sessionWith([message]),
      buildResponseThinkingIndex(requests),
    );
    assert.equal(result.contents[0][0].thinking, 'correct thought');
  });

  it('stamps producer provenance from the live carrier without mutating history', () => {
    const previous = [
      { role: 'user', content: 'old', _timestamp: 't0' },
      { role: 'assistant', content: [text('previous answer')], _timestamp: 't1', _generatedTs: 't0' },
    ];
    const messages = [...previous, { role: 'user', content: 'next' }, assistant([text('cold answer')], null)];
    messages[3]._timestamp = 't6';
    messages[3]._generatedTs = null;
    const entry = mainEntry('t6', [thinking('new'), text('new')], { body: { messages, metadata: { user_id: 'u1' } } });
    entry._sessionId = 'session-live';
    entry._prevMsgCount = previous.length;
    const previousEntry = mainEntry('t5', [thinking('correct thought'), text('cold answer')]);
    const result = buildSessionThinkingDisplay(sessionWith(messages), buildResponseThinkingIndex([previousEntry, entry]));
    assert.equal(result.contents[3][0].thinking, 'correct thought');
    assert.equal(messages[3]._generatedTs, null);
    assert.equal(result.contents[3][1], messages[3].content[0]);
  });

  it('stamps the previous main request as producer after cold ingest', () => {
    const messages = [
      { role: 'user', content: 'hello', _timestamp: 't1' },
      assistant([text('cold answer')], 't3'),
    ];
    messages[1]._timestamp = 't6';
    const previous = mainEntry('t5', [thinking('correct thought'), text('cold answer')]);
    const carrier = mainEntry('t6', [thinking('next'), text('next')], { body: { messages } });
    carrier._prevMsgCount = 0;
    const result = buildSessionThinkingDisplay(sessionWith(messages), buildResponseThinkingIndex([previous, carrier]));
    assert.equal(result.contents[1][0].thinking, 'correct thought');
  });

  it('does not let a placeholder or another session replace producer evidence', () => {
    const message = assistant([text('owned answer')], null);
    message._timestamp = 't3';
    const producer = mainEntry('t1', [thinking('owned thought'), text('owned answer')]);
    const carrier = mainEntry('t2', [text('next')], { body: { messages: [{ role: 'user', content: 'next' }, message] } });
    const placeholder = { ...carrier, timestamp: 't3', inProgress: true, response: undefined };
    const other = mainEntry('t2', [thinking('other'), text('owned answer')], { _sessionId: 'other-session' });
    const result = restore(sessionWith([message]), [producer, carrier, placeholder, other]);
    assert.equal(result.contents[0][0].thinking, 'owned thought');
  });

  it('uses producer evidence from a carrier excluded from session merge', () => {
    const message = assistant([text('blocked answer')], null);
    message._timestamp = 't2';
    const producer = mainEntry('t1', [thinking('blocked thought'), text('blocked answer')]);
    const carrier = mainEntry('t2', [thinking('next'), text('next')], {
      body: { messages: [{ role: 'user', content: 'next' }, message] },
      _staleReorder: true,
    });
    const result = restore(sessionWith([message]), [producer, carrier]);
    assert.equal(result.contents[0][0].thinking, 'blocked thought');
  });

  it('associates a late producer with an existing cold carrier', () => {
    const message = assistant([text('late answer')], null);
    message._timestamp = 't2';
    const carrier = mainEntry('t2', [text('next')], { body: { messages: [{ role: 'user', content: 'next' }, message] } });
    const producer = mainEntry('t1', [thinking('late thought'), text('late answer')]);
    assert.equal(restore(sessionWith([message]), [carrier]).restoredCount, 0);
    const result = restore(sessionWith([message]), [carrier, producer]);
    assert.equal(result.contents[0][0].thinking, 'late thought');
  });

  it('uses a unique full-anchor fallback only when generatedTs is absent', () => {
    const message = assistant([tool('tool-unique')], null);
    const result = restore(sessionWith([message]), [mainEntry('t1', [thinking('fallback'), tool('tool-unique')])]);
    assert.equal(result.contents[0][0].thinking, 'fallback');
    const duplicate = restore(sessionWith([message]), [
      mainEntry('t1', [thinking('one'), tool('tool-unique')]),
      mainEntry('t2', [thinking('two'), tool('tool-unique')]),
    ]);
    assert.equal(duplicate.restoredCount, 0);
  });

  it('restores a thinking-only response only to a unique empty assistant target', () => {
    const message = assistant([]);
    const result = restore(sessionWith([message]), [mainEntry('t1', [thinking('only thought')])]);
    assert.deepEqual(result.contents[0], [thinking('only thought')]);
    const nonempty = assistant([text('answer')]);
    assert.equal(restore(sessionWith([nonempty]), [mainEntry('t1', [thinking('wrong'), text('different')])]).restoredCount, 0);
  });

  it('preserves consecutive and interleaved thinking order', () => {
    const message = assistant([text('answer'), tool('tool-1')]);
    const responseContent = [thinking('first'), thinking('second'), text('answer'), thinking('third'), tool('tool-1')];
    const result = restore(sessionWith([message]), [mainEntry('t1', responseContent)]);
    assert.deepEqual(result.contents[0].map((block) => block.type === 'thinking' ? block.thinking : block.type), [
      'first', 'second', 'text', 'third', 'tool_use',
    ]);
  });

  it('deduplicates by signature and preserves unsigned duplicate counts', () => {
    const signed = thinking('same text', 'sig-stable');
    const message = assistant([signed, text('answer')]);
    const responseContent = [{ ...signed }, text('answer')];
    const result = restore(sessionWith([message]), [mainEntry('t1', responseContent)]);
    assert.equal(result.contents[0], message.content);
    assert.equal(result.restoredCount, 1);

    const unsignedMessage = assistant([thinking('repeat'), text('answer')]);
    const unsignedResponse = [thinking('repeat'), thinking('repeat'), text('answer')];
    const unsigned = restore(sessionWith([unsignedMessage]), [mainEntry('t1', unsignedResponse)]);
    assert.equal(unsigned.contents[0].filter((block) => block.type === 'thinking').length, 2);
    assert.equal(unsigned.contents[0][0], unsignedMessage.content[0]);
    assert.equal(unsigned.contents[0][1], unsignedResponse[1]);
  });

  it('keeps existing redacted blocks without inventing a visible redacted renderer', () => {
    const hidden = redacted('opaque');
    const message = assistant([hidden, text('answer')]);
    const responseContent = [thinking('shown'), hidden, text('answer')];
    const result = restore(sessionWith([message]), [mainEntry('t1', responseContent)]);
    assert.deepEqual(result.contents[0].map((block) => block.type), ['thinking', 'redacted_thinking', 'text']);
    assert.equal(result.contents[0][0].thinking, 'shown');
    assert.equal(result.contents[0][1], hidden);
    assert.equal(result.contents[0][2], message.content[1]);
    assert.equal(result.contents[0].filter((block) => block.type === 'redacted_thinking').length, 1);
  });

  it('skips in-progress, synthetic, non-main and malformed responses safely', () => {
    const message = assistant([text('answer')]);
    const entries = [
      mainEntry('t1', [thinking('live'), text('answer')], { inProgress: true }),
      mainEntry('t1', [thinking('native'), text('answer')], { _syntheticV2: true }),
      mainEntry('t1', [thinking('sub'), text('answer')], { mainAgent: false }),
      mainEntry('t1', [thinking('bad'), { type: 'image', source: {} }, text('answer')]),
    ];
    assert.equal(restore(sessionWith([message]), entries).restoredCount, 0);
    assert.equal(restore(sessionWith([message]), [mainEntry('t1', null)]).restoredCount, 0);
    assert.equal(restore(sessionWith([{ role: 'assistant', content: 'answer', _generatedTs: 't1' }]), []).restoredCount, 0);
  });

  it('does not synthesize thinking for a response that has none', () => {
    const message = assistant([text('answer')]);
    const result = restore(sessionWith([message]), [mainEntry('t1', [text('answer')])]);
    assert.equal(result.contents[0], message.content);
    assert.equal(result.displayedResponses.size, 0);
  });
});

describe('responseThinking cache and Last Response ownership', () => {
  it('reuses restored content, notices in-place block updates, and returns raw content after removal', () => {
    const cache = new WeakMap();
    const message = assistant([text('answer')]);
    const responseContent = [thinking('one'), text('answer')];
    const session = sessionWith([message]);
    const index = buildResponseThinkingIndex([mainEntry('t1', responseContent)]);
    const first = buildSessionThinkingDisplay(session, index, cache);
    const second = buildSessionThinkingDisplay(session, index, cache);
    assert.equal(second.contents[0], first.contents[0]);

    message.content[0] = text('answer');
    const changed = buildSessionThinkingDisplay(session, index, cache);
    assert.notEqual(changed.contents[0], first.contents[0]);
    assert.equal(changed.contents[0][0].thinking, 'one');
    const removed = buildSessionThinkingDisplay(session, buildResponseThinkingIndex([]), cache);
    assert.equal(removed.contents[0], message.content);
  });

  it('deduplicates only the exact response already mapped into a message', () => {
    const message = assistant([text('answer')]);
    const displayedResponse = [thinking('shared text', 'same-signature'), text('answer')];
    const latestResponse = [thinking('shared text', 'same-signature'), text('latest')];
    const displayed = restore(sessionWith([message]), [mainEntry('t1', displayedResponse)]).displayedResponses;
    assert.equal(filterDisplayedResponseThinking(displayedResponse, displayedResponse, displayed).length, 1);
    assert.equal(filterDisplayedResponseThinking(latestResponse, latestResponse, displayed), latestResponse);
  });

  it('keeps LR text and interaction ownership while ordinary tool blocks stay filtered', () => {
    const ask = { ...tool('ask-1'), name: 'AskUserQuestion', input: { questions: [] } };
    const message = assistant([text('answer')]);
    const responseContent = [thinking('reason'), text('answer')];
    const displayed = restore(sessionWith([message]), [mainEntry('t1', responseContent)]).displayedResponses;
    const filtered = filterLrContent(responseContent, new Set(), new Set());
    const lr = filterDisplayedResponseThinking(filtered, responseContent, displayed);
    assert.deepEqual(lr, [text('answer')]);
    assert.equal(hasVisibleLrContent(lr), true);
    assert.equal(filterDisplayedResponseThinking([thinking('pending'), ask], [thinking('pending'), ask], displayed).length, 2);
  });
});
