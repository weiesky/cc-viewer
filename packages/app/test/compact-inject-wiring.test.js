/**
 * compact-inject-wiring.test.js — source-anchor contract for the context-compaction inject path.
 *
 * No unit test of chat-queue/sdk-manager can see the server.js WS wiring itself; this pins the
 * structural seams the feature depends on:
 *   - cli.js wires sdkManager.getTurnGate into server (both SDK boot paths);
 *   - server.js has a `compact-inject` WS branch that validates reqId + the `/compact` prefix,
 *     consults the per-scope guard, uses the SDK turn-gate (idle) / PTY injectCommand, replies
 *     directed (compact-inject-done) and broadcasts context-compaction-injected on success;
 *   - chatQueue.initChatQueue is wired with the target-scoped probes (isStreamingFor /
 *     isTurnActiveFor / getPtyKindFor / getQueueSnapshot).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_SRC = readFileSync(join(ROOT, 'server', 'server.js'), 'utf8');
const CLI_SRC = readFileSync(join(ROOT, 'cli.js'), 'utf8');

describe('cli.js wires getTurnGate into server', () => {
  it('registers setSdkGetTurnGate on BOTH SDK boot paths', () => {
    const matches = CLI_SRC.match(/serverMod\.setSdkGetTurnGate\(sdkManager\.getTurnGate\)/g) || [];
    assert.equal(matches.length, 2, 'expected setSdkGetTurnGate on both initSdkSession boot paths');
  });
});

describe('server.js compact-inject WS branch', () => {
  it('has a compact-inject branch with reqId + /compact-prefix + length validation', () => {
    assert.match(SERVER_SRC, /msg\.type === 'compact-inject'/, 'compact-inject branch exists');
    assert.match(SERVER_SRC, /reqId.*\[A-Za-z0-9_-\]/, 'reqId charset validated');
    assert.match(SERVER_SRC, /\/\^\\\/compact\(/, '/compact prefix enforced');
    assert.match(SERVER_SRC, /text\.length > 20000/, 'length capped');
  });

  it('consults the per-scope guard and dedupes', () => {
    assert.match(SERVER_SRC, /createCompactInjectGuard\(\)/, 'guard instantiated');
    assert.match(SERVER_SRC, /compactInjectGuard\.tryBegin\(scopeKey\)/, 'tryBegin consulted');
    assert.match(SERVER_SRC, /duplicate: true/, 'duplicate short-circuits without sending');
    assert.match(SERVER_SRC, /compactInjectGuard\.commit\(scopeKey\)/, 'commit on success');
    assert.match(SERVER_SRC, /compactInjectGuard\.release\(scopeKey\)/, 'release on failure/busy');
  });

  it('SDK path uses the turn-gate (idle) and acks on send acceptance (not on turn settle)', () => {
    assert.match(SERVER_SRC, /_sdkGetTurnGate\(anchor\)/, 'turn-gate consulted');
    // Non-force requests are rejected as busy (force skips the idle gate; see the force test case).
    assert.match(SERVER_SRC, /if \(!isForce && !gate\.idle\)/, 'busy gate returns before send (non-force)');
    // ack-on-acceptance: sendUserMessage's promise resolves on turn SETTLE, so the ack must NOT
    // be chained behind it. finishOk fires synchronously; the rejection is only observed via
    // .catch (an early `not-delivered` rolls the ack back), never awaited.
    assert.match(SERVER_SRC, /_sdkSendUserMessage\(text,/, 'sendUserMessage called');
    assert.match(SERVER_SRC, /p\.catch\(\(err\) =>/, 'rejection observed via .catch, not awaited');
    assert.match(SERVER_SRC, /err\.code === 'not-delivered'/, 'early routing failure rolls back the optimistic ack');
    assert.doesNotMatch(SERVER_SRC, /\.then\(\(\) => finishOk/, 'ack must not wait for turn settle');
  });

  it('PTY path routes through chatQueue.injectCommand', () => {
    assert.match(SERVER_SRC, /chatQueue\.injectCommand\(text,/, 'injectCommand used for PTY');
  });

  it('960K force path: SDK skips idle gate via forceSendUserMessage; PTY uses enqueue+sendNow', () => {
    // Frontend force frame parsing
    assert.match(SERVER_SRC, /isForce = msg\.force === true/, 'force flag parsed');
    // SDK: force skips the idle gate (busy rejection applies only to non-force)
    assert.match(SERVER_SRC, /!isForce && !gate\.idle/, 'idle gate skipped for force');
    // SDK: force goes through forceSendUserMessage (enqueue + send-now interrupt), still keeping the guard rollback
    assert.match(SERVER_SRC, /_sdkForceSendUserMessage\(text,/, 'SDK force uses forceSendUserMessage');
    // PTY: force goes through enqueue + sendNow (ESC interrupt + poll + bracketed paste), never a blind write
    assert.match(SERVER_SRC, /chatQueue\.enqueue\(text,/, 'PTY force enqueues');
    assert.match(SERVER_SRC, /chatQueue\.sendNow\(item\.id,/, 'PTY force sendNow interrupts');
  });

  it('cli.js wires forceSendUserMessage on BOTH SDK boot paths', () => {
    const matches = CLI_SRC.match(/serverMod\.setSdkForceSendUserMessage\(sdkManager\.forceSendUserMessage\)/g) || [];
    assert.equal(matches.length, 2, 'expected setSdkForceSendUserMessage on both SDK boot paths');
  });

  it('replies directed (compact-inject-done) and broadcasts context-compaction-injected on success', () => {
    assert.match(SERVER_SRC, /type: 'compact-inject-done'/, 'directed ack frame');
    assert.match(SERVER_SRC, /type: 'context-compaction-injected'/, 'success broadcast frame');
    // broadcast carries the RESOLVED identity (project + instanceKey), not the raw request
    assert.match(SERVER_SRC, /project: resolvedProject/, 'broadcast uses resolved project');
    assert.match(SERVER_SRC, /instanceKey: resolvedInstance/, 'broadcast uses resolved instanceKey');
  });
});

describe('server.js initChatQueue target-scoped probes', () => {
  it('wires isStreamingFor / isTurnActiveFor / getPtyKindFor / getQueueSnapshot', () => {
    const idx = SERVER_SRC.indexOf('chatQueue.initChatQueue({');
    assert.ok(idx >= 0, 'initChatQueue wiring present');
    // Window sized generously — the deps object grows as probes are added (a fixed small
    // window silently truncates and drops trailing keys from the check).
    const window = SERVER_SRC.slice(idx, idx + 4000);
    for (const key of ['isStreamingFor', 'isTurnActiveFor', 'getPtyKindFor', 'getQueueSnapshot', 'hasLivePtyFor']) {
      assert.ok(window.includes(key), `initChatQueue carries ${key}`);
    }
  });
});
