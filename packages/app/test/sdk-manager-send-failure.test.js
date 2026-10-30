// R4 — a composer send that never reaches the SDK must not fail silently. _sendUserMessage
// rejects code:'not-delivered' on a pre-push failure (teardown raced / closed queue) so
// server.js can route a directed sdk-send-failed to the initiator; a CONSTRUCTION failure
// is excluded from that rejection because it already fired _notifyQueryError (a second
// rejection would double-report the same failure to the user).
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let sdk;
let tmpDir;

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ccv-sdk-sendfail-'));
  process.env.CCV_LOG_DIR = tmpDir;
  process.env.CLAUDE_CONFIG_DIR = tmpDir;
  sdk = await import('../server/lib/sdk-manager.js');
});

afterEach(() => {
  sdk.stopSession();
});

function makeDeps(extra = {}) {
  const errors = [];
  const deps = {
    broadcastWs: () => {},
    onTurnEnd: () => {},
    onQueryError: (m, meta) => errors.push({ m, meta }),
    ...extra,
  };
  return { deps, errors };
}

describe('sdk-manager — send failure feedback (R4)', () => {
  it('construction failure notifies via onQueryError and does NOT reject not-delivered (no double-report)', async () => {
    const { deps, errors } = makeDeps();
    sdk.__setQueryForTests(() => { throw new Error('construction boom'); });
    sdk.initSdkSession(tmpDir, 'proj', deps);
    // A construction failure surfaces via the query-error toast, not a rejection — so the
    // returned promise must settle (not reject with not-delivered).
    await assert.doesNotReject(sdk.sendUserMessage('hello'));
    assert.ok(errors.length > 0, 'construction failure is reported via onQueryError');
  });

  it('unavailable SDK rejects the synchronous guard (unchanged contract)', async () => {
    const { deps } = makeDeps();
    sdk.initSdkSession(tmpDir, 'proj', deps);
    sdk.__setQueryForTests(null); // no query factory at all
    await assert.rejects(sdk.sendUserMessage('hi'), /Agent SDK not available/);
  });
});
