/**
 * cli-sdk-session-state-env.test.js
 *
 * Source-anchor contract: SDK mode must inject CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1
 * into the SDK child's env (cli.js childEnv literal), or the CLI never emits
 * session_state_changed messages (the emission point in the CLI binary is gated on
 * that env var) and the whole sdk-session-state relay goes dark.
 *
 * The injection point lives in cli.js's mode wiring, which sdk-manager's fake-query
 * tests cannot see (options.env is already resolved by then) — so this is a source
 * anchor test, per the sse-connection-gen.test.js precedent. If the childEnv block
 * is refactored, update this anchor deliberately, not mechanically.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CLI_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../cli.js'), 'utf8');

describe('SDK child env: CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS injection', () => {
  it('cli.js childEnv injects the session-state opt-in as a top-level key', () => {
    // The childEnv literal assigns it directly (not via settings merge) so user
    // settings cannot override it away.
    assert.match(CLI_SRC, /CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS:\s*'1'/, 'childEnv must set the env flag to 1');
  });

  it('the flag lands inside the SDK-mode childEnv block (next to ANTHROPIC_BASE_URL)', () => {
    // Anchor: same object literal as the loopback proxy injection.
    const childEnvIdx = CLI_SRC.indexOf('const childEnv = {');
    assert.ok(childEnvIdx > -1, 'childEnv block exists in cli.js');
    const flagIdx = CLI_SRC.indexOf('CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS', childEnvIdx);
    assert.ok(flagIdx > -1, 'flag is inside the childEnv block');
    const proxyIdx = CLI_SRC.indexOf('ANTHROPIC_BASE_URL: proxyBaseUrl', childEnvIdx);
    assert.ok(proxyIdx > -1 && proxyIdx < flagIdx + 2000, 'flag sits alongside the proxy injection (SDK-mode env assembly)');
  });
});
