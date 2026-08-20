/**
 * Unit tests for src/utils/identityHeal.js — the late-identity healing helpers
 * behind the post-refresh fallback-label fix (frozen "MainAgent" model info and
 * "Teammate: X" labels). Element cases follow refresh-cached-item-prop.test.js
 * (plain React.createElement arrays, no DOM). identityHeal transitively imports
 * requestType → contentFilter → teammateDetector with extensionless Vite-style
 * specifiers, so the _shims loader + dynamic import are required.
 */
import './_shims/register.mjs';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';

let refreshResolvedModelInfo, healUnresolvedTeammateEntries, needsFullReqRescan, formatTeammateLabel;

before(async () => {
  const heal = await import('../src/utils/identityHeal.js');
  refreshResolvedModelInfo = heal.refreshResolvedModelInfo;
  healUnresolvedTeammateEntries = heal.healUnresolvedTeammateEntries;
  needsFullReqRescan = heal.needsFullReqRescan;
  ({ formatTeammateLabel } = await import('@ccv/core/requestType'));
});

const INFO = { name: 'claude-fable-5', svg: '<svg/>' };
const mk = (props) => React.createElement('ChatMessage', props);

describe('refreshResolvedModelInfo', () => {
  it('clones only rows transitioning null -> resolved; keeps other references', () => {
    const frozen = mk({ role: 'assistant', modelInfo: null, timestamp: 't1' });
    const resolved = mk({ role: 'assistant', modelInfo: INFO, timestamp: 't2' });
    const noProp = mk({ role: 'assistant', timestamp: 't3' });
    const noTs = mk({ role: 'user', modelInfo: null });
    const out = refreshResolvedModelInfo([frozen, resolved, noProp, noTs], () => INFO);
    assert.notEqual(out[0], frozen);
    assert.equal(out[0].props.modelInfo, INFO);
    assert.equal(out[1], resolved);
    assert.equal(out[2], noProp, 'undefined modelInfo (never receives the prop) must be skipped');
    assert.equal(out[3], noTs, 'rows without timestamp must be skipped');
  });

  it('returns the SAME array reference when nothing heals', () => {
    const items = [mk({ role: 'assistant', modelInfo: null, timestamp: 't1' })];
    assert.equal(refreshResolvedModelInfo(items, () => null), items);
  });

  it('session-fallback rows (_fromSession marker) stay heal-eligible and upgrade to the precise model', () => {
    const fallback = { ...INFO, _fromSession: true };
    const row = mk({ role: 'assistant', modelInfo: fallback, timestamp: 't1' });
    // While the producer is still unresolvable: no clone, marker persists.
    const same = refreshResolvedModelInfo([row], () => null);
    assert.equal(same[0], row, 'unresolvable marker row must not clone');
    // Producer becomes resolvable: upgraded to the precise (canonical, unmarked) ref exactly once.
    const healed = refreshResolvedModelInfo([row], () => INFO);
    assert.notEqual(healed[0], row);
    assert.equal(healed[0].props.modelInfo, INFO);
    assert.equal(healed[0].props.modelInfo._fromSession, undefined, 'upgrade drops the marker');
    // Idempotence: the upgraded row is no longer eligible — next pass is same-ref (no churn).
    const again = refreshResolvedModelInfo(healed, () => INFO);
    assert.equal(again, healed, 'post-upgrade pass must return the SAME array reference');
  });

  it('precise (unmarked) modelInfo rows are never touched even when a resolver is available', () => {
    const row = mk({ role: 'assistant', modelInfo: INFO, timestamp: 't1' });
    const out = refreshResolvedModelInfo([row], () => ({ name: 'other' }));
    assert.equal(out[0], row);
  });

  it('never "heals" to a marked value (guards against passing the wrapped session resolver)', () => {
    const fallback = { ...INFO, _fromSession: true };
    const row = mk({ role: 'assistant', modelInfo: fallback, timestamp: 't1' });
    // A mistakenly-wrapped resolver returns the fallback itself — must be a same-ref no-op
    // (otherwise the clone keeps the marker and every pass clones again, forever).
    const items = [row];
    const out = refreshResolvedModelInfo(items, () => fallback);
    assert.equal(out, items, 'wrapped-resolver output must not count as a heal');
    // Null rows are protected the same way.
    const nullRow = mk({ role: 'assistant', modelInfo: null, timestamp: 't2' });
    const out2 = refreshResolvedModelInfo([nullRow], () => fallback);
    assert.equal(out2[0], nullRow);
  });

  it('maps element role to resolver role (assistant vs user)', () => {
    const seen = [];
    const resolver = (ts, role) => { seen.push(role); return INFO; };
    refreshResolvedModelInfo([
      mk({ role: 'assistant', modelInfo: null, timestamp: 'a' }),
      mk({ role: 'teammate-message', modelInfo: null, timestamp: 'b' }),
      mk({ role: 'user', modelInfo: null, timestamp: 'c' }),
    ], resolver);
    assert.deepEqual(seen, ['assistant', 'user', 'user']);
  });

  it('freeze-repro two-tick sequence: bake null, heal, then write-back is idempotent', () => {
    // Tick 1: first post-refresh build — resolver cannot resolve yet.
    const tick1 = refreshResolvedModelInfo(
      [mk({ role: 'assistant', modelInfo: null, timestamp: 't1' })],
      () => null,
    );
    // Tick 2: request scan healed; FULL HIT runs the heal pass.
    const tick2 = refreshResolvedModelInfo(tick1, () => INFO);
    assert.notEqual(tick2, tick1);
    assert.equal(tick2[0].props.modelInfo, INFO);
    // Tick 3: healed array was written back to the cache; next FULL HIT
    // must be a no-op returning the same reference.
    assert.equal(refreshResolvedModelInfo(tick2, () => INFO), tick2);
  });
});

describe('healUnresolvedTeammateEntries', () => {
  const mkEntry = (req, label) => ({
    timestamp: req.timestamp, label, isTeammate: true, requestIndex: 0,
    unresolved: true, req,
  });

  it('heals a bare fallback label once req.teammate is injected', () => {
    const req = { timestamp: 'x', body: { model: 'claude-sonnet-5' } };
    const entry = mkEntry(req, formatTeammateLabel(null, req.body.model));
    healUnresolvedTeammateEntries([entry]);
    assert.equal(entry.unresolved, true, 'stays healable while req.teammate absent');
    req.teammate = 'alice';
    healUnresolvedTeammateEntries([entry]);
    assert.equal(entry.label, formatTeammateLabel('alice', 'claude-sonnet-5'));
    assert.equal(entry.unresolved, false);
  });

  it('upgrades a raw-id label to the real name', () => {
    const req = { timestamp: 'x', body: { model: 'claude-sonnet-5' }, teammate: 'alice' };
    const entry = mkEntry(req, formatTeammateLabel('raw-id-77', req.body.model));
    healUnresolvedTeammateEntries([entry]);
    assert.equal(entry.label, formatTeammateLabel('alice', 'claude-sonnet-5'));
  });

  it('heals via the request OBJECT reference across rebuilt/shifted arrays', () => {
    // The entry keeps working even though the surrounding requests array was
    // rebuilt with a mid-array insertion (indices shifted) — no array lookup.
    const req = { timestamp: 'x', body: {} };
    const entry = mkEntry(req, formatTeammateLabel(null, undefined));
    entry.requestIndex = 5; // stale index on purpose
    req.teammate = 'bob';
    healUnresolvedTeammateEntries([entry]);
    assert.equal(entry.label, formatTeammateLabel('bob', undefined));
  });

  it('ignores non-teammate/already-resolved/malformed entries', () => {
    const resolved = { unresolved: false, req: { teammate: 'z' }, label: 'keep' };
    healUnresolvedTeammateEntries([resolved, null, { unresolved: true }]);
    assert.equal(resolved.label, 'keep');
  });
});

describe('needsFullReqRescan', () => {
  const a = { id: 'a' }, b = { id: 'b' }, inserted = { id: 'ins' };

  it('stays false on append-only growth and on a fresh cache', () => {
    assert.equal(needsFullReqRescan([a, b], 0, null), false);
    assert.equal(needsFullReqRescan([a, b, inserted], 2, b), false);
  });

  it('fires on mid-array insertion below the cursor', () => {
    // Scanned [a, b] (processedCount=2, lastScannedReq=b); "inserted" completed
    // late and entered the filtered array before b -> index 1 is no longer b.
    assert.equal(needsFullReqRescan([a, inserted, b], 2, b), true);
  });

  it('accepted residual: replacement below the cursor with unchanged tail does not fire', () => {
    assert.equal(needsFullReqRescan([inserted, b], 2, b), false);
  });
});

describe('isRelevantRequest rotation-sentinel exclusion', () => {
  it('a ccvRotationContext frame is never a renderable request', async () => {
    const { isRelevantRequest } = await import('../src/utils/helpers.js');
    assert.equal(isRelevantRequest({
      ccvRotationContext: 1, url: 'ccv://rotation-context',
      from: 'x.jsonl', teammateNames: [], timestamp: 't',
    }), false);
    // Ordinary completed requests are unaffected.
    assert.equal(isRelevantRequest({
      timestamp: 't', url: '/v1/messages',
      body: { system: 's', tools: [{ name: 'Bash' }] },
      response: { status: 200 },
    }), true);
  });
});
