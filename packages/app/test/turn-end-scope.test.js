/**
 * turn_end per-workscope routing (server.js, 2026-10).
 *
 * Verifies the scope the debounced turn_end resolves to rides its pending
 * timer entry, the rising-edge cancel only clears the SAME scope's timers,
 * and broadcastTurnEnd(cwd) routes to that workspace's scope — without
 * instantiating the HTTP server (source-anchor + __testing seams only).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SERVER_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../server/server.js'), 'utf8');

describe('turn_end scope routing (source anchors)', () => {
  it('the pending timer entry carries its resolved scopeKey', () => {
    assert.ok(
      /_pendingTurnEndTimers\.set\(sid, \{ timer, ts: t, scopeKey: scopeKeyOf\(sc\.project, sc\.instance\) \}\)/.test(SERVER_SRC),
      'scheduleTurnEndBroadcast stores the scope on the timer entry',
    );
  });

  it('rising-edge cancel only clears the SAME scope timers (per-workspace fix)', () => {
    assert.ok(
      /function _cancelPendingTurnEndForScope\(scopeKey\) \{[\s\S]*?entry\.scopeKey \|\| BOUND_SCOPE\) !== scopeKey\) continue;/.test(SERVER_SRC),
      '_onStreamingActivated cancels per scope, not all',
    );
    assert.ok(
      /function _onStreamingActivated\(scopeKey = BOUND_SCOPE\) \{\s*_cancelPendingTurnEndForScope\(scopeKey\);/.test(SERVER_SRC),
      '_onStreamingActivated is scope-keyed',
    );
  });

  it('_emitTurnEnd routes the frame through filterClientsByScope with project/instance in the payload', () => {
    assert.ok(
      /sendEventToClients\(target, 'turn_end', \{ sessionId: sid, ts: t, project: sc\.project \|\| \(_projectName \|\| ''\), instance: sc\.instance \|\| null \}\)/.test(SERVER_SRC),
      'turn_end payload carries additive project/instance',
    );
  });

  it('broadcastTurnEnd(cwd) resolves the scope from the session cwd (SDK path)', () => {
    assert.ok(
      /export function broadcastTurnEnd\(sessionId = null, ts = Date\.now\(\), transcriptPath = null, cwd = null\) \{[\s\S]*?projectKeyForCwd\(cwd\)/.test(SERVER_SRC),
      'broadcastTurnEnd threads cwd → scope',
    );
  });

  it('the hook-payload scope resolver prefers sid→PTY, then cwd, then bound', () => {
    const body = /function _resolveScopeForHookPayload\(payload\) \{[\s\S]*?resolvePtyForSession\(sid\)[\s\S]*?projectKeyForCwd\(cwd\)[\s\S]*?return \{ project: '', instance: null \};/.test(SERVER_SRC);
    assert.ok(body, '_resolveScopeForHookPayload precedence sid → cwd → bound');
  });
});

describe('turn_active per-scope state machine (source anchors)', () => {
  it('_setTurnActive is scope-keyed via turnStateFor(scopeKeyOf(...))', () => {
    assert.ok(
      /function _setTurnActive\(active, sessionId, scope = null\) \{[\s\S]*?const key = scopeKeyOf\(sc\.project, sc\.instance\);[\s\S]*?const bucket = turnStateFor\(key\);/.test(SERVER_SRC),
      'turn bucket resolved per scope',
    );
  });

  it('the turn heartbeat iterates activeTurnScopes and broadcasts each scope own tag', () => {
    assert.ok(
      /const scopes = activeTurnScopes\(\);[\s\S]*?for \(const key of scopes\) \{\s*_broadcastTurnActive\(true, _turnSessionIdByScope\.get\(key\) \|\| null, parseScopeKey\(key\)\);/.test(SERVER_SRC),
      'per-scope heartbeat with per-scope session tag',
    );
  });

  it('UserPromptSubmit gating reads the scope session tag (_turnSessionIdByScope)', () => {
    assert.ok(
      /isTurnStartTaskEvent\(payload, _turnSessionIdByScope\.get\(key\) \|\| null\)/.test(SERVER_SRC),
      'per-scope session tag gates turn start',
    );
  });
});
