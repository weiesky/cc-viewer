import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sdkToJSONLEntry, buildStreamingStatus } from '../lib/sdk-adapter.js';

describe('sdkToJSONLEntry', () => {
  it('produces a valid JSONL entry with all fields', () => {
    const assistantMsg = {
      message: {
        id: 'msg_123',
        role: 'assistant',
        model: 'claude-opus-4-6',
        content: [{ type: 'text', text: 'Hello' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    };
    const messages = [{ role: 'user', content: 'Hi' }];
    const entry = sdkToJSONLEntry(assistantMsg, messages, 'claude-opus-4-6', 'my-project', {
      timestamp: '2026-01-01T00:00:00.000Z',
    });

    assert.equal(entry.timestamp, '2026-01-01T00:00:00.000Z');
    assert.equal(entry.project, 'my-project');
    assert.equal(entry.method, 'POST');
    assert.equal(entry.mainAgent, true);
    assert.equal(entry.isStream, false);
    assert.equal(entry.body.model, 'claude-opus-4-6');
    assert.deepEqual(entry.body.messages, messages);
    assert.equal(entry.response.status, 200);
    assert.equal(entry.response.body, assistantMsg.message);
    assert.equal(entry.inProgress, undefined);
  });

  it('uses fallback project name when not provided', () => {
    const entry = sdkToJSONLEntry({ message: null }, [], null, null);
    assert.equal(entry.project, 'sdk');
  });

  it('uses fallback model from respBody when model param is null', () => {
    const entry = sdkToJSONLEntry(
      { message: { model: 'claude-sonnet-4-6', content: [] } },
      [], null, 'proj',
    );
    assert.equal(entry.body.model, 'claude-sonnet-4-6');
  });

  it('uses default model when no model is available', () => {
    const entry = sdkToJSONLEntry({ message: null }, [], null, 'proj');
    assert.equal(entry.body.model, 'claude-opus-4-6');
  });

  it('uses custom tools from opts.tools', () => {
    const tools = [{ name: 'Read' }, { name: 'Write' }];
    const entry = sdkToJSONLEntry({ message: null }, [], 'model', 'proj', { tools });
    assert.deepEqual(entry.body.tools, tools);
  });

  it('uses stub tools when opts.tools is not provided', () => {
    const entry = sdkToJSONLEntry({ message: null }, [], 'model', 'proj');
    assert.ok(Array.isArray(entry.body.tools));
    assert.ok(entry.body.tools.length > 0);
    assert.ok(entry.body.tools.some(t => t.name === 'Bash'));
  });

  it('sets inProgress and requestId for streaming entries', () => {
    const entry = sdkToJSONLEntry({ message: null }, [], 'model', 'proj', {
      inProgress: true,
      requestId: 'req_42',
    });
    assert.equal(entry.inProgress, true);
    assert.equal(entry.requestId, 'req_42');
    assert.equal(entry.response, null);
  });

  it('generates a requestId when inProgress but no requestId given', () => {
    const entry = sdkToJSONLEntry({ message: null }, [], 'model', 'proj', {
      inProgress: true,
    });
    assert.equal(entry.inProgress, true);
    assert.ok(entry.requestId.startsWith('sdk_'));
  });

  it('generates a timestamp when not provided', () => {
    const before = new Date().toISOString();
    const entry = sdkToJSONLEntry({ message: null }, [], 'model', 'proj');
    const after = new Date().toISOString();
    assert.ok(entry.timestamp >= before);
    assert.ok(entry.timestamp <= after);
  });
});

describe('buildStreamingStatus', () => {
  it('returns active status with model and startTime', () => {
    const status = buildStreamingStatus(true, { model: 'claude-opus-4-6', startTime: 1000 });
    assert.equal(status.active, true);
    assert.equal(status.model, 'claude-opus-4-6');
    assert.equal(status.startTime, 1000);
    assert.equal(status.bytesReceived, 0);
    assert.equal(status.chunksReceived, 0);
  });

  it('defaults model to null and startTime to Date.now()', () => {
    const before = Date.now();
    const status = buildStreamingStatus(true);
    assert.equal(status.active, true);
    assert.equal(status.model, null);
    assert.ok(status.startTime >= before);
  });

  it('returns inactive status when active is false', () => {
    const status = buildStreamingStatus(false);
    assert.deepEqual(status, { active: false });
  });

  it('ignores meta when active is false', () => {
    const status = buildStreamingStatus(false, { model: 'x', startTime: 999 });
    assert.deepEqual(status, { active: false });
  });
});
