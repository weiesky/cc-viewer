// Cancellation / lifetime semantics of the retry engine — the properties the
// original proxy-retry.test.js could not observe (its fetch mock resolved
// immediately, ignored the abort signal, and carried body:null, so loser
// aborts, client disconnects, and body drains were all invisible).
//
// The mock here is DEFERRED and SIGNAL-AWARE: each fetch call is exposed to
// the test, which resolves it manually; an abort on the passed signal rejects
// the pending call with an AbortError, exactly like undici. Responses carry an
// observable cancellable body.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { executeRequest } from '../packages/app/server/lib/proxy-retry.js';

const realFetch = globalThis.fetch;
let calls; // [{ url, opts, signal, resolve, settled }]

function installDeferredFetch() {
  calls = [];
  globalThis.fetch = (url, opts) => new Promise((resolve, reject) => {
    const call = { url, opts, signal: opts?.signal, settled: false };
    call.resolve = (r) => { if (!call.settled) { call.settled = true; resolve(r); } };
    const sig = opts?.signal;
    if (sig) {
      const onAbort = () => {
        if (!call.settled) {
          call.settled = true;
          const e = new Error('This operation was aborted');
          e.name = 'AbortError';
          reject(e);
        }
      };
      if (sig.aborted) { onAbort(); calls.push(call); return; }
      sig.addEventListener('abort', onAbort, { once: true });
    }
    calls.push(call);
  });
}

function makeResponse(status, { headers = {}, streamBody = true } = {}) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const r = {
    status,
    statusText: String(status),
    ok: status >= 200 && status < 300,
    headers: { get: (k) => h.get(String(k).toLowerCase()) ?? null, entries: () => h.entries() },
    bodyCancelled: false,
    text: async () => '',
    json: async () => ({}),
  };
  r.body = streamBody ? { cancel: async () => { r.bodyCancelled = true; } } : null;
  return r;
}

async function waitFor(cond, ms = 2000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('waitFor timeout');
    await new Promise(res => setTimeout(res, 5));
  }
}

beforeEach(installDeferredFetch);
afterEach(() => { globalThis.fetch = realFetch; });

describe('race mode: first success wins while losers are still in flight', () => {
  it('returns the winner without waiting for stragglers, and aborts them', async () => {
    const p = executeRequest({
      url: 'https://up.example/v1/messages',
      fetchOptions: { method: 'POST', headers: {}, body: '{"model":"m"}' },
      // connectTimeoutMs > 0 exercises the composed-signal path where the old
      // listener-bridge design lost the external abort after headers.
      retryConfig: { mode: 'race', maxConcurrent: 3, maxRetries: 2, connectTimeoutMs: 60000, retryIntervalMs: 1 },
      ctx: {},
    });
    await waitFor(() => calls.length === 3);
    const winner = makeResponse(200);
    calls[1].resolve(winner);
    const result = await p; // must NOT require calls[0]/calls[2] to settle first
    assert.equal(result.response, winner);
    assert.equal(result.succeeded, true);
    assert.equal(calls[0].signal.aborted, true, 'pending loser 0 must be aborted when the winner lands');
    assert.equal(calls[2].signal.aborted, true, 'pending loser 2 must be aborted when the winner lands');
  });

  it('discards the body of a second 200 that settles after the winner', async () => {
    const p = executeRequest({
      url: 'https://up.example/v1/messages',
      fetchOptions: { method: 'POST', headers: {}, body: '{}' },
      retryConfig: { mode: 'race', maxConcurrent: 2, maxRetries: 1, connectTimeoutMs: 0, retryIntervalMs: 1 },
      ctx: {},
    });
    await waitFor(() => calls.length === 2);
    const winner = makeResponse(200);
    const late = makeResponse(200);
    calls[0].resolve(winner);
    calls[1].resolve(late); // same tick: double-win candidate
    const result = await p;
    assert.equal(result.response, winner, 'the FIRST success must win');
    await waitFor(() => late.bodyCancelled);
    assert.equal(winner.bodyCancelled, false, 'the winner body must stay intact for piping');
  });
});

describe('client disconnect propagation', () => {
  it('serial: an abort mid-retry stops the loop promptly and stops launching attempts', async () => {
    const client = new AbortController();
    const p = executeRequest({
      url: 'https://up.example/v1/messages',
      fetchOptions: { method: 'POST', headers: {}, body: '{}' },
      retryConfig: { mode: 'serial', maxRetries: 0, retryIntervalMs: 3600000, connectTimeoutMs: 0 },
      ctx: { signal: client.signal },
    });
    await waitFor(() => calls.length === 1);
    calls[0].resolve(makeResponse(503)); // retryable → engine enters the (huge) wait
    await new Promise(res => setTimeout(res, 20));
    client.abort(); // must interrupt the 1h sleep, not park until it elapses
    const result = await p;
    assert.equal(result.attempts, 1, 'no further attempts after the client left');
    assert.equal(calls.length, 1);
  });

  it('race: abort while attempts are pending aborts every upstream attempt', async () => {
    const client = new AbortController();
    const p = executeRequest({
      url: 'https://up.example/v1/messages',
      fetchOptions: { method: 'POST', headers: {}, body: '{}' },
      retryConfig: { mode: 'race', maxConcurrent: 3, maxRetries: 0, connectTimeoutMs: 0, retryIntervalMs: 1 },
      ctx: { signal: client.signal },
    });
    await waitFor(() => calls.length === 3);
    client.abort();
    const result = await p;
    assert.equal(result.succeeded, false);
    for (const c of calls) assert.equal(c.signal.aborted, true, 'every pending attempt must be aborted');
  });

  it('stagger: abort tears down in-flight attempts and returns promptly', async () => {
    const client = new AbortController();
    const p = executeRequest({
      url: 'https://up.example/v1/messages',
      fetchOptions: { method: 'POST', headers: {}, body: '{}' },
      retryConfig: { mode: 'stagger', maxConcurrent: 2, maxRetries: 0, connectTimeoutMs: 0, retryIntervalMs: 1 },
      ctx: { signal: client.signal },
    });
    await waitFor(() => calls.length >= 1);
    client.abort();
    const result = await p;
    assert.equal(result.succeeded, false);
    assert.ok(calls.every(c => c.settled), 'no attempt may stay pending after client abort');
  });
});

describe('off mode backward compatibility', () => {
  it('issues exactly one fetch with NO signal (no new timeout failure mode)', async () => {
    const p = executeRequest({
      url: 'https://up.example/v1/messages',
      fetchOptions: { method: 'POST', headers: {}, body: '{}' },
      // Explicit large connectTimeoutMs: off mode must IGNORE it — the legacy
      // pass-through path had no time-to-headers bound at all.
      retryConfig: { mode: 'off', connectTimeoutMs: 10000 },
      ctx: {},
    });
    await waitFor(() => calls.length === 1);
    assert.equal(calls[0].signal, undefined, 'off mode without a client signal must fetch signal-less');
    calls[0].resolve(makeResponse(503));
    const result = await p;
    assert.equal(result.attempts, 1, 'off mode never retries');
    assert.equal(result.finalStatus, 503);
  });

  it('still aborts the upstream when the client disconnects', async () => {
    const client = new AbortController();
    const p = executeRequest({
      url: 'https://up.example/v1/messages',
      fetchOptions: { method: 'POST', headers: {}, body: '{}' },
      retryConfig: { mode: 'off' },
      ctx: { signal: client.signal },
    });
    await waitFor(() => calls.length === 1);
    client.abort();
    const result = await p;
    assert.equal(result.finalStatus, 0, 'aborted attempt surfaces as network error');
    assert.equal(calls[0].signal.aborted, true);
  });
});

describe('stagger double-win latch', () => {
  it('keeps the first winner when two 200s settle back-to-back', async () => {
    const p = executeRequest({
      url: 'https://up.example/v1/messages',
      fetchOptions: { method: 'POST', headers: {}, body: '{}' },
      retryConfig: { mode: 'stagger', maxConcurrent: 2, maxRetries: 0, connectTimeoutMs: 0, retryIntervalMs: 1 },
      ctx: {},
    });
    await waitFor(() => calls.length === 2);
    const first = makeResponse(200);
    const second = makeResponse(200);
    calls[0].resolve(first);
    calls[1].resolve(second);
    const result = await p;
    assert.equal(result.response, first, 'resolved must not be overwritten by the second 200');
    await waitFor(() => second.bodyCancelled);
    assert.equal(first.bodyCancelled, false);
  });
});

describe('failed-attempt body hygiene', () => {
  it('race: non-winner failure bodies are drained; the returned fallback keeps its body', async () => {
    const p = executeRequest({
      url: 'https://up.example/v1/messages',
      fetchOptions: { method: 'POST', headers: {}, body: '{}' },
      retryConfig: { mode: 'race', maxConcurrent: 2, maxRetries: 1, connectTimeoutMs: 0, retryIntervalMs: 1 },
      ctx: {},
    });
    await waitFor(() => calls.length === 2);
    const fail1 = makeResponse(503);
    const fail2 = makeResponse(529);
    calls[0].resolve(fail1);
    calls[1].resolve(fail2);
    const result = await p;
    assert.equal(result.succeeded, false);
    assert.equal(result.response, fail2, 'last real failure is returned to the client');
    assert.equal(fail1.bodyCancelled, true, 'replaced failure body must be drained');
    assert.equal(fail2.bodyCancelled, false, 'returned fallback body must stay intact');
  });
});
