import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createStreamAssembler } from '../server/lib/interceptor-core.js';

describe('createStreamAssembler', () => {
  it('hasMessage=false until message_start', () => {
    const asm = createStreamAssembler();
    assert.equal(asm.hasMessage(), false);
    assert.equal(asm.snapshot(), null);
    asm.feed({ type: 'message_start', message: { id: 'm_1', role: 'assistant', model: 'opus', usage: {} } });
    assert.equal(asm.hasMessage(), true);
    const snap = asm.snapshot();
    assert.equal(snap.id, 'm_1');
    assert.deepEqual(snap.content, []);
  });

  it('accumulates text_delta across chunks', () => {
    const asm = createStreamAssembler();
    asm.feed({ type: 'message_start', message: { id: 'm', role: 'assistant' } });
    asm.feed({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    asm.feed({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } });
    asm.feed({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' world' } });
    asm.feed({ type: 'content_block_stop', index: 0 });
    const snap = asm.snapshot();
    assert.equal(snap.content[0].text, 'Hello world');
  });

  it('accumulates thinking_delta and signature', () => {
    const asm = createStreamAssembler();
    asm.feed({ type: 'message_start', message: { id: 'm', role: 'assistant' } });
    asm.feed({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } });
    asm.feed({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Step 1. ' } });
    asm.feed({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Step 2.' } });
    asm.feed({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-xyz' } });
    asm.feed({ type: 'content_block_stop', index: 0 });
    const snap = asm.snapshot();
    assert.equal(snap.content[0].type, 'thinking');
    assert.equal(snap.content[0].thinking, 'Step 1. Step 2.');
    assert.equal(snap.content[0].signature, 'sig-xyz');
  });

  it('exposes _inputJsonPartial on partial tool_use before stop', () => {
    const asm = createStreamAssembler();
    asm.feed({ type: 'message_start', message: { id: 'm', role: 'assistant' } });
    asm.feed({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_1', name: 'Bash' } });
    asm.feed({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"command":"l' } });
    asm.feed({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 's -la"}' } });
    // Before stop: _inputJsonPartial should be exposed, input undefined
    const mid = asm.snapshot();
    assert.equal(mid.content[0].input, undefined);
    assert.equal(mid.content[0]._inputJsonPartial, '{"command":"ls -la"}');
    // After stop: parsed input
    asm.feed({ type: 'content_block_stop', index: 0 });
    const final = asm.snapshot();
    assert.deepEqual(final.content[0].input, { command: 'ls -la' });
    assert.equal(final.content[0]._inputJsonPartial, undefined);
  });

  it('falls back to raw string when partial JSON is unparsable on stop', () => {
    const asm = createStreamAssembler();
    asm.feed({ type: 'message_start', message: { id: 'm', role: 'assistant' } });
    asm.feed({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu', name: 'X' } });
    asm.feed({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'not-json' } });
    asm.feed({ type: 'content_block_stop', index: 0 });
    assert.equal(asm.snapshot().content[0].input, 'not-json');
  });

  it('handles interleaved thinking → text blocks in order', () => {
    const asm = createStreamAssembler();
    asm.feed({ type: 'message_start', message: { id: 'm', role: 'assistant' } });
    asm.feed({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } });
    asm.feed({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'reasoning' } });
    asm.feed({ type: 'content_block_stop', index: 0 });
    asm.feed({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } });
    asm.feed({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'answer' } });
    const snap = asm.snapshot();
    assert.equal(snap.content.length, 2);
    assert.equal(snap.content[0].type, 'thinking');
    assert.equal(snap.content[1].type, 'text');
    assert.equal(snap.content[1].text, 'answer');
  });

  it('snapshot is deep-cloned — subsequent feeds do not mutate past snapshots', () => {
    const asm = createStreamAssembler();
    asm.feed({ type: 'message_start', message: { id: 'm', role: 'assistant' } });
    asm.feed({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    asm.feed({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'first' } });
    const snap1 = asm.snapshot();
    asm.feed({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '-more' } });
    // snap1 block object should not have "-more" appended (separate clone)
    assert.equal(snap1.content[0].text, 'first');
    const snap2 = asm.snapshot();
    assert.equal(snap2.content[0].text, 'first-more');
  });

  it('message_delta updates stop_reason and usage', () => {
    const asm = createStreamAssembler();
    asm.feed({ type: 'message_start', message: { id: 'm', role: 'assistant', usage: { input_tokens: 10 } } });
    asm.feed({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 42 } });
    const snap = asm.snapshot();
    assert.equal(snap.stop_reason, 'end_turn');
    assert.equal(snap.usage.input_tokens, 10);
    assert.equal(snap.usage.output_tokens, 42);
  });

  it('ignores malformed events safely', () => {
    const asm = createStreamAssembler();
    asm.feed(null);
    asm.feed(undefined);
    asm.feed({});
    asm.feed({ type: 'unknown' });
    assert.equal(asm.hasMessage(), false);
  });
});
