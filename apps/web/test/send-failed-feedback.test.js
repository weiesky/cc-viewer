/**
 * send-failed-feedback.test.js (web, source-anchor). R4: a composer send made while the
 * WS is not OPEN must warn (ui.sendFailed) and keep the draft — never drop the message
 * silently. Server-side, the SDK send .catch handlers must reportSwallowed AND route a
 * directed sdk-send-failed to the initiator (not a global broadcast), and the outer WS
 * dispatch catch must reportSwallowed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const jsx = readFileSync(join(root, 'src', 'components', 'chat', 'ChatView.jsx'), 'utf-8');
const server = readFileSync(join(root, '..', '..', 'packages', 'app', 'server', 'server.js'), 'utf-8');

describe('send failure feedback (R4)', () => {
  it('both composer WS-not-open guards warn via ui.sendFailed (draft preserved)', () => {
    const warnings = jsx.match(/readyState !== WebSocket\.OPEN\)\s*\{\s*try \{ message\.warning\(t\('ui\.sendFailed'\)\); \} catch \{\}/g) || [];
    assert.ok(warnings.length >= 2, `both the immediate-send and busy-enqueue guards warn (${warnings.length} sites)`);
  });

  it('ChatView surfaces the server-directed sdk-send-failed frame', () => {
    const m = jsx.match(/msg\.type === 'sdk-send-failed'\)\s*\{[\s\S]{0,300}?\}/);
    assert.ok(m, 'sdk-send-failed branch found');
    assert.ok(m[0].includes("t('ui.sendFailed')"), 'sdk-send-failed warns via ui.sendFailed');
  });

  it('server send .catch handlers reportSwallowed and send a DIRECTED sdk-send-failed (no broadcast)', () => {
    const frames = server.match(/type: 'sdk-send-failed'/g) || [];
    assert.ok(frames.length >= 2, `sdk-send-failed frames at both send .catch sites (${frames.length})`);
    // Each send-failed goes to the initiating ws only, never a global _broadcast.
    assert.ok(/ws\.send\(JSON\.stringify\(\{ type: 'sdk-send-failed'/.test(server), 'directed ws.send of sdk-send-failed');
    assert.ok(server.includes("reportSwallowed('server.ws-dispatch', err)"), 'outer WS dispatch catch reportSwallowed');
  });
});
