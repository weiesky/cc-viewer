import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeV2Entries } from '../src/v2-transcript-normalizer.js';
import { extractQueuedPromptWireMessage, extractQueuedPromptTranscriptLine, queuedPromptDisplayText } from '../src/queued-prompt.js';

const wrap = (prompt) => `The user sent a new message while you were working:\n${prompt}\n\nIMPORTANT: After completing your current task, you MUST address the user's message above. Do not ignore it.`;
const attachment = (extra = {}) => ({
  type: 'attachment', uuid: 'attachment-1', parentUuid: 'tool-result-1', sessionId: 'sid-1',
  timestamp: '2026-10-01T00:00:00.000Z', entrypoint: 'cli',
  attachment: { type: 'queued_command', commandMode: 'prompt', prompt: 'adjust course', origin: { kind: 'human' }, timestamp: '2026-10-01T00:00:00.000Z' },
  ...extra,
});

describe('captured real queue formats', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/queued-prompt-real-formats.json', import.meta.url), 'utf8'));

  it('keeps a queued attachment outside model messages and restores the wire envelope independently', () => {
    const entry = normalizeV2Entries(fixture.transcript)[0];
    assert.equal(entry.body.messages.length, 2);
    assert.equal(entry.body.messages.some((m) => m.content === 'Please adjust the approach.'), false);
    assert.deepEqual(entry._ccvQueuedPrompts.map((p) => [p.content, p.afterIndex, p._ccvSourceId]), [['Please adjust the approach.', 1, 'queued-fixture']]);
    assert.deepEqual(extractQueuedPromptWireMessage(fixture.wire), { content: 'Please adjust the approach.', source: 'wire' });
    assert.equal(fixture.wire.role, 'system');
  });
});
describe('queued prompt wire display parser', () => {
  it('extracts only the user text from the exact system envelope', () => {
    const original = { role: 'system', content: wrap('Use the other approach\nwith details') };
    assert.deepEqual(extractQueuedPromptWireMessage(original), { content: 'Use the other approach\nwith details', source: 'wire' });
    assert.equal(original.role, 'system');
    assert.equal(original.content, wrap('Use the other approach\nwith details'));
  });

  it('supports a single text content block without altering it', () => {
    const content = [{ type: 'text', text: wrap('hello') }];
    assert.equal(extractQueuedPromptWireMessage({ role: 'system', content }).content, 'hello');
    assert.equal(content[0].text, wrap('hello'));
  });

  it('rejects malformed, ordinary, or multi-block system messages', () => {
    assert.equal(extractQueuedPromptWireMessage({ role: 'system', content: 'The user sent a new message while you were working:\nunterminated' }), null);
    assert.equal(extractQueuedPromptWireMessage({ role: 'system', content: 'ordinary system text' }), null);
    assert.equal(extractQueuedPromptWireMessage({ role: 'user', content: wrap('quoted') }), null);
    assert.equal(extractQueuedPromptWireMessage({ role: 'system', content: [{ type: 'text', text: wrap('a') }, { type: 'text', text: 'b' }] }), null);
  });
});

describe('queued prompt display text', () => {
  it('normalizes SDK text blocks without mutating the original content', () => {
    const content = [
      { type: 'text', text: '[Request interrupted by user]\nfirst' },
      { type: 'tool_result', content: 'not a prompt' },
      { type: 'text', text: 'second' },
    ];
    assert.equal(queuedPromptDisplayText(content), 'first\n\nsecond');
    assert.deepEqual(content[0], { type: 'text', text: '[Request interrupted by user]\nfirst' });
    assert.equal(queuedPromptDisplayText('plain text'), 'plain text');
    assert.equal(queuedPromptDisplayText(null), '');
    assert.equal(queuedPromptDisplayText([{ type: 'tool_result', content: 'done' }]), '');
  });
});

describe('queued prompt transcript parser', () => {
  it('accepts a confirmed human queued_command and preserves identity', () => {
    assert.deepEqual(extractQueuedPromptTranscriptLine(attachment()), {
      content: 'adjust course', source: 'queued_command', sourceId: 'attachment-1', parentUuid: 'tool-result-1', sessionId: 'sid-1', submittedTimestamp: '2026-10-01T00:00:00.000Z',
    });
  });

  it('accepts SDK content blocks without origin metadata', () => {
    const prompt = [{ type: 'text', text: 'SDK inserted prompt' }];
    const line = attachment({ entrypoint: 'sdk-ts', attachment: { type: 'queued_command', commandMode: 'prompt', prompt } });
    assert.equal(extractQueuedPromptTranscriptLine(line).content, prompt);
  });

  it('rejects task, peer, sidechain, and unconfirmed records', () => {
    assert.equal(extractQueuedPromptTranscriptLine(attachment({ attachment: { type: 'queued_command', commandMode: 'task-notification', prompt: '<task-notification>x</task-notification>' } })), null);
    assert.equal(extractQueuedPromptTranscriptLine(attachment({ attachment: { type: 'queued_command', commandMode: 'prompt', prompt: 'peer', origin: { kind: 'peer' } } })), null);
    assert.equal(extractQueuedPromptTranscriptLine(attachment({ isSidechain: true })), null);
    assert.equal(extractQueuedPromptTranscriptLine({ type: 'queue-operation', operation: 'enqueue', content: 'not yet consumed' }), null);
    assert.equal(extractQueuedPromptTranscriptLine({ type: 'queue-operation', operation: 'remove' }), null);
    assert.equal(extractQueuedPromptTranscriptLine({ type: 'queue-operation', operation: 'dequeue' }), null);
  });

  it('does not treat popAll as proof of consumption', () => {
    const line = { type: 'queue-operation', operation: 'popAll', sessionId: 'sid-1', timestamp: '2026-10-01T00:00:00.000Z', content: 'continue differently' };
    assert.equal(extractQueuedPromptTranscriptLine(line, 17), null);
    assert.equal(extractQueuedPromptTranscriptLine({ ...line, content: '/theme' }), null);
  });
});
