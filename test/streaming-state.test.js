import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { unwatchFile } from 'node:fs';
import { streamingState, resetStreamingState, PROFILE_PATH } from '../interceptor.js';

// interceptor.js 模块顶层 watchFile(PROFILE_PATH) 会阻止进程退出
after(() => { try { unwatchFile(PROFILE_PATH); } catch {} });

describe('streamingState', () => {
  it('initial state should be inactive', () => {
    // resetStreamingState to ensure clean state for this test
    resetStreamingState();
    assert.equal(streamingState.active, false);
    assert.equal(streamingState.requestId, null);
    assert.equal(streamingState.startTime, null);
    assert.equal(streamingState.model, null);
    assert.equal(streamingState.bytesReceived, 0);
    assert.equal(streamingState.chunksReceived, 0);
  });

  it('should reflect mutations to shared object', () => {
    streamingState.active = true;
    streamingState.requestId = 'req-123';
    streamingState.startTime = 1000;
    streamingState.model = 'claude-sonnet-4-6';
    streamingState.bytesReceived = 4096;
    streamingState.chunksReceived = 10;

    assert.equal(streamingState.active, true);
    assert.equal(streamingState.requestId, 'req-123');
    assert.equal(streamingState.startTime, 1000);
    assert.equal(streamingState.model, 'claude-sonnet-4-6');
    assert.equal(streamingState.bytesReceived, 4096);
    assert.equal(streamingState.chunksReceived, 10);
  });

  it('resetStreamingState should reset all fields', () => {
    // Set dirty state
    streamingState.active = true;
    streamingState.requestId = 'req-456';
    streamingState.startTime = Date.now();
    streamingState.model = 'claude-opus-4-6';
    streamingState.bytesReceived = 99999;
    streamingState.chunksReceived = 500;

    resetStreamingState();

    assert.equal(streamingState.active, false);
    assert.equal(streamingState.requestId, null);
    assert.equal(streamingState.startTime, null);
    assert.equal(streamingState.model, null);
    assert.equal(streamingState.bytesReceived, 0);
    assert.equal(streamingState.chunksReceived, 0);
  });

  it('resetStreamingState should be idempotent', () => {
    resetStreamingState();
    resetStreamingState();
    resetStreamingState();

    assert.equal(streamingState.active, false);
    assert.equal(streamingState.bytesReceived, 0);
  });

  it('streamingState object reference should be stable after reset', () => {
    const ref = streamingState;
    streamingState.active = true;
    resetStreamingState();
    // resetStreamingState mutates the same object, not replaces it
    assert.equal(ref, streamingState);
    assert.equal(ref.active, false);
  });
});
