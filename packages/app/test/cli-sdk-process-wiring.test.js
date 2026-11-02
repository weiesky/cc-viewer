/**
 * cli-sdk-process-wiring.test.js
 *
 * Source-anchor contract (per the cli-sdk-error-frame.test.js precedent): cli.js must
 * (a) hoist the plugin-loader import for runWaterfallHook to a module-scope const (kept
 * awaited) instead of an inline dynamic import inside the initSdkSession deps block, and
 * (b) register the durable process wiring ONCE via setSdkProcessWiring so a workspace
 * stop→relaunch (which calls stopSession, clearing the mutable callbacks, then re-inits
 * without them) re-adopts the process callbacks instead of silently dropping every
 * sdk-* frame. No sdk-manager unit test can see this wiring — it captures the callback,
 * not the boot registration.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CLI_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../cli.js'), 'utf8');

describe('cli.js SDK process wiring (R6)', () => {
  it('hoists the plugin-loader import for runWaterfallHook (awaited, module scope)', () => {
    assert.match(CLI_SRC, /const \{ runWaterfallHook \} = await import\('\.\/server\/lib\/plugin-loader\.js'\)/,
      'runWaterfallHook must be hoisted to an awaited const');
    assert.doesNotMatch(CLI_SRC, /runWaterfallHook: \(await import/,
      'the deps block must not use an inline dynamic import');
    // And the hoisted const is what initSdkSession receives.
    assert.match(CLI_SRC, /runWaterfallHook,/, 'initSdkSession deps use the hoisted const');
  });

  it('registers the durable process wiring once via setSdkProcessWiring', () => {
    assert.match(CLI_SRC, /sdkManager\.setSdkProcessWiring\(\{/, 'setSdkProcessWiring is called');
    const idx = CLI_SRC.indexOf('setSdkProcessWiring({');
    const window = CLI_SRC.slice(idx, idx + 700);
    for (const key of ['onTurnEnd', 'onQueryError', 'broadcastWs', 'runWaterfallHook']) {
      assert.ok(window.includes(key), `process wiring carries ${key}`);
    }
  });

  it('wires the manual retry turn into server.js', () => {
    assert.match(CLI_SRC, /serverMod\.setSdkRetryTurn\(sdkManager\.retryInterruptedTurn\)/,
      'setSdkRetryTurn is registered from sdkManager.retryInterruptedTurn');
  });
});
