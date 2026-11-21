/**
 * v2-writer retireInstance (2026-11) — SDK forceNew's routing freeze for a departed
 * generation.
 *
 * forceNewSdkSession swaps a cwd's SDK session for a fresh generation (new random
 * instanceKey). The OLD generation's child may still be draining (trailing completion /
 * heartbeat). retireInstance(oldKey) marks it retired so its late traffic writes into its
 * OWN old dir (history stays consistent) but never moves `_currentSid` /
 * `_currentSidByInstance` / `_onSessionResolved` — otherwise the fresh generation's bound
 * cold-load (getLiveLogSource → currentSessionDir) would flip back to the old conversation.
 *
 * Isolated CCV_LOG_DIR; fake entries via the V2Writer directly.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { V2Writer } from '../server/lib/v2/v2-writer.js';
import { resolveSessionDirName } from '../server/lib/v2/session-select.js';

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ccv-v2retire-')); });
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

const SID_OLD = 'a9883ab8-0ab7-459a-bcfd-4c8950a14384';
const SID_NEW = 'b1177cd9-1cd8-46da-9e01-5d9e61b25595';
const uid = (sid) => JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: sid });
const textMsg = (role, text) => ({ role, content: [{ type: 'text', text }] });

function mkMainEntry(sid, instKey, over = {}) {
  return {
    timestamp: '2026-11-21T00:00:00.000Z',
    url: 'https://api.anthropic.com/v1/messages?beta=true',
    method: 'POST',
    requestId: over.requestId || `req_${Math.random().toString(36).slice(2, 8)}`,
    mainAgent: true,
    _ccvInstance: instKey,
    body: {
      model: 'claude-fable-5',
      metadata: { user_id: uid(sid) },
      tools: [{ name: 'Bash' }],
      system: [{ type: 'text', text: 'You are Claude Code' }],
      messages: [textMsg('user', 'hello')],
    },
    ...over,
  };
}

describe('V2Writer.retireInstance (SDK forceNew)', () => {
  it('a retired instance\'s late main request still writes its own dir but never moves _currentSid', async () => {
    const w = new V2Writer({ logDir: dir, project: 'proj', enabled: true });
    const resolved = [];
    w.setOnSessionResolved((sid, project, inst) => resolved.push({ sid, inst }));

    const oldKey = 'ccv-' + 'a'.repeat(32);
    // The OLD generation runs a main turn → owns SID_OLD and the pointers.
    const h1 = w.ingestRequest(mkMainEntry(SID_OLD, oldKey), [textMsg('user', 'hello')]);
    w.ingestCompletion(h1, { timestamp: 't', response: { status: 200, body: { usage: {}, content: [] } } });
    await w.flush();
    assert.equal(w.currentSessionId(), SID_OLD, 'old generation owns the current pointer');
    assert.ok(resolved.some((r) => r.inst === oldKey), 'old generation resolved');

    // forceNew retires the old key. Because the retired instance's sid was the current pointer,
    // retirement clears it (so the fresh generation's bound cold-load can't flip back).
    w.retireInstance(oldKey);
    assert.equal(w.currentSessionId(), null, 'retirement clears _currentSid when it pointed at the retired sid');

    // A LATE main request from the draining old child (same old sid) must NOT move _currentSid
    // or fire _onSessionResolved, but it STILL writes into its own old dir (history consistent).
    const before = w.currentSessionId();
    const hLate = w.ingestRequest(mkMainEntry(SID_OLD, oldKey), [textMsg('user', 'trailing')]);
    assert.ok(hLate, 'the late request still resolves to a handle (writes its own dir)');
    w.ingestCompletion(hLate, { timestamp: 't2', response: { status: 200, body: { usage: {}, content: [] } } });
    await w.flush();
    assert.equal(w.currentSessionId(), before, '_currentSid NOT re-poisoned by the retired generation');
    const oldKeyFires = resolved.filter((r) => r.inst === oldKey).length;
    assert.equal(oldKeyFires, 1, 'no NEW _onSessionResolved fire for the retired instance after retirement');
    // The old dir really did get the trailing write: the journal now holds TWO req lines
    // (the pre-retire one + the late one), both routed into the OLD dir.
    const oldDir = join(dir, 'proj', 'sessions', resolveSessionDirName(join(dir, 'proj'), SID_OLD));
    const reqLines = readFileSync(join(oldDir, 'journal.jsonl'), 'utf8').trim().split('\n')
      .map((l) => JSON.parse(l)).filter((l) => l.ph === 'req');
    assert.equal(reqLines.length, 2, 'late write landed in the OLD dir (history consistent)');
  });

  it('retireInstance clears the per-instance pointer and drops metadata-less traffic', async () => {
    const w = new V2Writer({ logDir: dir, project: 'proj', enabled: true });
    const oldKey = 'ccv-' + 'b'.repeat(32);
    const h1 = w.ingestRequest(mkMainEntry(SID_OLD, oldKey), [textMsg('user', 'hello')]);
    w.ingestCompletion(h1, { timestamp: 't', response: { status: 200, body: { usage: {}, content: [] } } });
    await w.flush();

    w.retireInstance(oldKey);
    // A metadata-less heartbeat from the retired instance is dropped (null handle), not routed
    // to its old sid nor held for a later flush into the new generation's dir.
    const hb = { timestamp: 't', url: 'https://api/eval/sdk-x', method: 'POST', isHeartbeat: true, requestId: 'hb1', _ccvInstance: oldKey, body: {} };
    assert.equal(w.ingestRequest(hb, null), null, 'retired metadata-less traffic is dropped');
  });

  it('a NON-retired instance is unaffected (normal routing preserved)', async () => {
    const w = new V2Writer({ logDir: dir, project: 'proj', enabled: true });
    const resolved = [];
    w.setOnSessionResolved((sid, project, inst) => resolved.push({ sid, inst }));
    const liveKey = 'ccv-' + 'c'.repeat(32);
    w.retireInstance('ccv-' + 'd'.repeat(32)); // retire some OTHER key
    const h = w.ingestRequest(mkMainEntry(SID_NEW, liveKey), [textMsg('user', 'hi')]);
    w.ingestCompletion(h, { timestamp: 't', response: { status: 200, body: { usage: {}, content: [] } } });
    await w.flush();
    assert.equal(w.currentSessionId(), SID_NEW, 'non-retired instance sets the current pointer');
    assert.ok(resolved.some((r) => r.inst === liveKey), 'non-retired instance fires _onSessionResolved');
  });

  it('retireInstance ignores malformed keys', () => {
    const w = new V2Writer({ logDir: dir, project: 'proj', enabled: true });
    assert.doesNotThrow(() => w.retireInstance('not-a-key'));
    assert.doesNotThrow(() => w.retireInstance(null));
    assert.doesNotThrow(() => w.retireInstance('ccv-XYZ')); // bad hex/case
  });

  it('resetSessions() clears the retired set', async () => {
    const w = new V2Writer({ logDir: dir, project: 'proj', enabled: true });
    const oldKey = 'ccv-' + 'e'.repeat(32);
    w.retireInstance(oldKey);
    w.resetSessions();
    // After a full reset the key is no longer retired: a fresh request with it routes normally.
    const resolved = [];
    w.setOnSessionResolved((sid, project, inst) => resolved.push({ sid, inst }));
    const h = w.ingestRequest(mkMainEntry(SID_NEW, oldKey), [textMsg('user', 'hi')]);
    w.ingestCompletion(h, { timestamp: 't', response: { status: 200, body: { usage: {}, content: [] } } });
    await w.flush();
    assert.equal(w.currentSessionId(), SID_NEW, 'post-reset the key routes normally again');
  });
});
