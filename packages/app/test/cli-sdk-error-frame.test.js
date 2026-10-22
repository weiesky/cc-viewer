/**
 * cli-sdk-error-frame.test.js
 *
 * Source-anchor contract: cli.js's onQueryError wiring must spread the routing meta
 * (cwd/sessionId/instanceKey, filled by the sdk-manager session closure) into the
 * sdk-error WS frame. Dropping `...(meta || {})` leaves the frame untagged, which
 * broadcastWsMessage delivers to EVERY connected workspace — the persistent dialogue
 * error row then renders in whichever conversation is open (cross-workspace
 * misattribution), and no sdk-manager unit test can see it (they capture the callback,
 * not this wiring).
 *
 * Source-anchor test per the cli-sdk-session-state-env.test.js precedent: if the
 * initSdkSession deps block is refactored, update this anchor deliberately.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CLI_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../cli.js'), 'utf8');

describe('sdk-error frame wiring (cli.js onQueryError)', () => {
  // Anchor inside the broadcastWsMessage frame literal itself (not the arrow head),
  // so a frame that stops carrying the message/meta fails even if the signature stays.
  function frameWindow() {
    const idx = CLI_SRC.indexOf("onQueryError:");
    assert.ok(idx > -1, 'onQueryError wiring exists in cli.js');
    const m = CLI_SRC.slice(idx).match(/broadcastWsMessage\(\{[\s\S]*?\}\)\s*\}/);
    assert.ok(m, 'broadcastWsMessage frame literal found after onQueryError');
    return m[0];
  }

  it('forwards the sdk-error frame through broadcastWsMessage with the message', () => {
    const w = frameWindow();
    assert.match(w, /type:\s*'sdk-error'/, 'frame type is sdk-error');
    assert.match(w, /\bmessage\b/, 'frame carries the error message');
  });

  it('spreads the routing meta (cwd/sessionId/instanceKey) into the frame', () => {
    const w = frameWindow();
    // Without the meta spread the frame is untagged and broadcasts to every workspace.
    assert.match(w, /\.\.\.\(meta \|\| \{\}\)/, 'frame must spread the meta routing envelope');
    assert.match(CLI_SRC, /onQueryError:\s*\(message,\s*meta\)/, 'callback accepts the meta second arg');
  });
});
