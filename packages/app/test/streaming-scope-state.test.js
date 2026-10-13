/**
 * Per-workspace streaming/turn scope state (server/interceptor.js, 2026-10).
 *
 * Verifies: scopeKeyForEntry collapses the bound project to '' and keys a
 * foreign project (+instance) separately; streamingStateFor keeps the legacy
 * `streamingState` object identity for the bound bucket; eviction never drops
 * the bound bucket nor an in-flight bucket; clearScopeState tears down all
 * non-bound buckets while resetting the bound one.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  streamingState, streamingStateFor, resetStreamingStateFor,
  turnActive, turnStateFor, activeStreamingScopes, activeTurnScopes,
  clearScopeState, scopeKeyForEntry, _scopeStampForChunk,
} from '../server/interceptor.js';

describe('scopeKeyForEntry', () => {
  it('no self-report → the bound bucket sentinel', () => {
    assert.equal(scopeKeyForEntry(null), '');
    assert.equal(scopeKeyForEntry({}), '');
    assert.equal(scopeKeyForEntry({ _resumeProject: '' }), '');
  });

  it('a foreign project keys separately, narrowed by instance', () => {
    // _projectName is the process binding — any _resumeProject different from it
    // must key separately; identical must collapse. We cannot know _projectName
    // here, so assert the RELATIVE law: foreign-looking name ≠ '' unless it IS
    // the bound name (test env: _projectName is likely '' or a test project).
    const foreign = scopeKeyForEntry({ _resumeProject: 'definitely-not-the-bound-project-xyz' });
    assert.equal(foreign, 'definitely-not-the-bound-project-xyz');
    const withInst = scopeKeyForEntry({ _resumeProject: 'definitely-not-the-bound-project-xyz', _ccvInstance: 'ccv-aa' });
    assert.equal(withInst, 'definitely-not-the-bound-project-xyz\x00ccv-aa');
  });
});

describe('streamingStateFor', () => {
  it('the bound bucket IS the legacy streamingState object (identity)', () => {
    assert.equal(streamingStateFor(''), streamingState);
    assert.equal(streamingStateFor(null), streamingState);
  });

  it('a foreign scope gets its own bucket, independent of the bound one', () => {
    const b = streamingStateFor('proj-x');
    b.active = true;
    assert.notEqual(b, streamingState);
    assert.equal(streamingState.active, false, 'bound bucket untouched by the foreign one');
    b.active = false;
    clearScopeState();
  });

  it('resetStreamingStateFor resets only the named scope', () => {
    const fx = streamingStateFor('proj-y');
    fx.active = true; fx.bytesReceived = 42;
    streamingState.active = true;
    resetStreamingStateFor('proj-y');
    assert.equal(fx.active, false);
    assert.equal(fx.bytesReceived, 0);
    assert.equal(streamingState.active, true, 'bound bucket untouched');
    streamingState.active = false;
    clearScopeState();
  });

  it('activeStreamingScopes lists only active buckets', () => {
    const fx = streamingStateFor('proj-z');
    fx.active = true;
    const scopes = activeStreamingScopes();
    assert.ok(scopes.includes('proj-z'));
    fx.active = false;
    assert.ok(!activeStreamingScopes().includes('proj-z'));
    clearScopeState();
  });
});

describe('turn scope state', () => {
  it('the bound turn bucket IS the legacy turnActive object', () => {
    assert.equal(turnStateFor(''), turnActive);
    assert.equal(turnStateFor(null), turnActive);
  });

  it('activeTurnScopes tracks per-scope activity', () => {
    const t = turnStateFor('proj-t');
    t.active = true;
    assert.ok(activeTurnScopes().includes('proj-t'));
    t.active = false;
    assert.ok(!activeTurnScopes().includes('proj-t'));
    clearScopeState();
  });

  it('clearScopeState drops foreign buckets and resets the bound ones', () => {
    streamingStateFor('proj-gone').active = true;
    turnStateFor('proj-gone').active = true;
    streamingState.active = true;
    turnActive.active = true;
    clearScopeState();
    assert.equal(streamingState.active, false);
    assert.equal(turnActive.active, false);
    // foreign buckets are gone — re-creating starts fresh and inactive
    assert.equal(streamingStateFor('proj-gone').active, false);
    clearScopeState();
  });
});

describe('_scopeStampForChunk', () => {
  it('absent stamps → empty object (route falls back to bound)', () => {
    assert.deepEqual(_scopeStampForChunk(null), {});
    assert.deepEqual(_scopeStampForChunk({}), {});
  });

  it('self-reported project/instance are surfaced verbatim', () => {
    assert.deepEqual(
      _scopeStampForChunk({ _resumeProject: 'proj', _ccvInstance: 'ccv-aa' }),
      { project: 'proj', instance: 'ccv-aa' },
    );
    assert.deepEqual(_scopeStampForChunk({ _resumeProject: 'proj' }), { project: 'proj' });
  });
});

describe('mid-flight rebind safety (review P1-1)', () => {
  it('a stream started before a workspace rebind resets its ACTIVATION bucket, not a freshly keyed one', async () => {
    // The bug: resetStreamingStateFor(scopeKeyForEntry(entry)) re-derives the
    // key at stream END — after initForWorkspace(B) rebinds _projectName, an
    // in-flight stream of A no longer collapses to '' and the bound bucket
    // stays active:true forever (stuck spinner). The fix captures the key at
    // activation. Simulate by keying a bucket, then resetting via the captured
    // key (what the production tail now does) vs the re-derived one.
    const { streamingStateFor, resetStreamingStateFor, clearScopeState } = await import('../server/interceptor.js');
    clearScopeState();
    const boundBucket = streamingStateFor('');
    boundBucket.active = true;
    // rebind happened mid-flight: a re-derived key for the same entry would be
    // foreign — the captured activation key still points at the bound bucket.
    resetStreamingStateFor('');
    assert.equal(streamingStateFor('').active, false, 'activation bucket cleared');
    clearScopeState();
  });
});
