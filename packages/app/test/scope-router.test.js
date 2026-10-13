/**
 * Scope keys (server/lib/scope-router.js).
 *
 * Verifies: scopeKeyOf/parseScopeKey round-trip incl. the NUL-composite; the ''
 * bound sentinel; and normalizeProducerScope/scopeKeyForProducer collapsing the
 * bound project (any instance) to the legacy singleton bucket.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { BOUND_SCOPE, scopeKeyOf, parseScopeKey, normalizeProducerScope, scopeKeyForProducer } from '../server/lib/scope-router.js';

describe('scopeKeyOf', () => {
  it('no project → the bound sentinel', () => {
    assert.equal(scopeKeyOf(null, null), '');
    assert.equal(scopeKeyOf(undefined, undefined), '');
    assert.equal(scopeKeyOf('', 'ccv-aa'), '', 'instance without a project cannot escape the bound bucket');
  });

  it('project alone → project', () => {
    assert.equal(scopeKeyOf('alpha', null), 'alpha');
  });

  it('project + instance → NUL-composite', () => {
    assert.equal(scopeKeyOf('alpha', 'ccv-aa'), 'alpha\x00ccv-aa');
  });

  it('round-trips through parseScopeKey', () => {
    assert.deepEqual(parseScopeKey(scopeKeyOf('alpha', 'ccv-aa')), { project: 'alpha', instance: 'ccv-aa' });
    assert.deepEqual(parseScopeKey(scopeKeyOf('alpha', null)), { project: 'alpha', instance: null });
    assert.deepEqual(parseScopeKey(''), { project: '', instance: null });
    assert.deepEqual(parseScopeKey(null), { project: '', instance: null });
  });
});

describe('normalizeProducerScope', () => {
  it('the bound project collapses to the sentinel, instance dropped', () => {
    assert.deepEqual(normalizeProducerScope({ project: 'alpha', instance: 'ccv-aa' }, 'alpha'), { project: '', instance: null });
    assert.deepEqual(normalizeProducerScope({ project: '', instance: null }, 'alpha'), { project: '', instance: null });
    assert.deepEqual(normalizeProducerScope({}, 'alpha'), { project: '', instance: null });
  });

  it('a foreign project keeps its name and instance', () => {
    assert.deepEqual(normalizeProducerScope({ project: 'beta', instance: 'ccv-aa' }, 'alpha'), { project: 'beta', instance: 'ccv-aa' });
    assert.deepEqual(normalizeProducerScope({ project: 'beta', instance: null }, 'alpha'), { project: 'beta', instance: null });
  });

  it('scopeKeyForProducer is normalize + key in one step', () => {
    assert.equal(scopeKeyForProducer({ project: 'alpha', instance: 'ccv-aa' }, 'alpha'), BOUND_SCOPE);
    assert.equal(scopeKeyForProducer({ project: 'beta', instance: 'ccv-aa' }, 'alpha'), 'beta\x00ccv-aa');
    assert.equal(scopeKeyForProducer({ project: 'beta', instance: null }, 'alpha'), 'beta');
  });
});
