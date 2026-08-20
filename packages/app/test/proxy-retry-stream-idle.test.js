/**
 * server/lib/proxy/proxy-retry.js — streaming idle timeout (streamIdleTimeoutMs).
 *
 * Covers the hang point: when an upstream returns 200 + text/event-stream headers
 * but the body never produces a data chunk (hung upstream), the connect timeout
 * (cleared once headers arrive) cannot rescue the in-flight pipeline. The
 * streamIdleTimeoutMs watchdog must abort such a stalled stream so the client
 * socket + upstream socket are not pinned indefinitely.
 *
 * Mock strategy: globalThis.fetch returns a Response-like object whose body is a
 * real ReadableStream we control. We either stall it (no chunk) to trigger the
 * watchdog, or emit chunks on schedule to verify the watchdog resets per chunk
 * and does NOT fire on a healthy stream.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { executeRequest, DEFAULT_RETRY_CONFIG } from '../server/lib/proxy/proxy-retry.js';

/**
 * Build a fake streaming Response whose body is a real ReadableStream.
 * @param {(controller: ReadableStreamDefaultController) => void} emit controls chunk emission.
 */
function makeStreamResponse({ status = 200, contentType = 'text/event-stream', emit }) {
  const stream = new ReadableStream({
    start(controller) {
      if (emit) emit(controller);
    },
  });
  return new Response(stream, {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { 'content-type': contentType },
  });
}

let _originalFetch;
beforeEach(() => { _originalFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = _originalFetch; });

describe('proxy-retry streamIdleTimeoutMs hang guard', () => {
  it('hung stream (200 + no chunk) → watchdog aborts, response surfaces as stalled', async () => {
    // fetch resolves with 200 headers; body never emits. Without the watchdog
    // the response would sit in pipeline forever. The watchdog must abort it.
    globalThis.fetch = async () => makeStreamResponse({
      emit: () => { /* never enqueue — hung upstream */ },
    });

    const r = await executeRequest({
      url: 'https://example.com/v1/messages',
      fetchOptions: { method: 'POST', headers: {} },
      retryConfig: { ...DEFAULT_RETRY_CONFIG, mode: 'serial', streamIdleTimeoutMs: 50, maxRetries: 5 },
      ctx: {},
    });

    assert.equal(r.finalStatus, 200, 'headers already arrived → status stays 200');
    assert.equal(r.attempts, 1, 'streaming 200 is never retried');

    // The body must error within a bounded time (the watchdog), so proxy.js's
    // pipeline surfaces the stall instead of hanging forever. We read the body
    // via getReader: a healthy open stream would never reject; an aborted
    // (watchdog-fired) stream rejects with the idle-timeout error.
    const reader = r.response.body.getReader();
    let errored = false;
    let errName = '';
    const settled = await Promise.race([
      reader.read().then(
        () => reader.read(), // a chunk arrived — keep draining to catch the eventual error
      ).catch((e) => { errored = true; errName = e?.message || String(e); }),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 500)),
    ]);
    if (errored) {
      assert.match(errName, /idle timeout/i, `body should error with idle-timeout, got: ${errName}`);
    } else {
      // If no error within 500ms (well past the 50ms budget), the watchdog did NOT fire → hang regression.
      assert.fail('hung stream was not aborted by streamIdleTimeoutMs within 500ms (hang regression)');
    }
  });

  it('healthy stream (chunks arriving) → watchdog resets, does NOT abort', async () => {
    // Keep the total stream open longer than the idle budget while every gap
    // stays below it. A watchdog that fails to reset will abort this stream.
    globalThis.fetch = async () => {
      return makeStreamResponse({
        emit: (controller) => {
          let chunks = 0;
          const iv = setInterval(() => {
            controller.enqueue(new TextEncoder().encode('data: hi\n\n'));
            chunks++;
            if (chunks === 8) {
              clearInterval(iv);
              controller.close();
            }
          }, 10);
        },
      });
    };

    const r = await executeRequest({
      url: 'https://example.com/v1/messages',
      fetchOptions: { method: 'POST', headers: {} },
      retryConfig: { ...DEFAULT_RETRY_CONFIG, mode: 'serial', streamIdleTimeoutMs: 40, maxRetries: 5 },
      ctx: {},
    });

    assert.equal(r.finalStatus, 200);
    assert.equal(r.attempts, 1);
    assert.equal(r.response.headers.get('content-type'), 'text/event-stream');
    const body = await r.response.text();
    assert.equal(body, 'data: hi\n\n'.repeat(8));
  });
});
