/**
 * viewScope singleton + withViewParams same-name instance fallback (2026-10-07).
 *
 * Pins the centralized "middleware" that fixes the BOUND same-basename view: the App
 * layer mirrors the current view scope into a module singleton, and withViewParams
 * falls back to its instance when the caller passes none — so every view-scoped READ
 * (files / skills / git / expert / search) disambiguates two same-basename live
 * projects instead of 400ing "ambiguous project name".
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// apiUrl.js reads `window.location.search` at module top-level for the LAN token — stub a
// minimal window BEFORE importing it (node has no DOM).
globalThis.window = { location: { search: '' } };

const { setViewScope, resolveViewScope, _resetViewScopeForTests } = await import('../src/utils/viewScope.js');
const { withViewParams } = await import('../src/utils/apiUrl.js');

beforeEach(() => _resetViewScopeForTests());

describe('resolveViewScope', () => {
  it('an attached parallel view uses its OWN viewedInstance', () => {
    setViewScope({ projectName: 'proj', viewedProject: 'proj', viewedInstance: 'ccv-aaa', boundInstance: 'ccv-bbb' });
    assert.deepEqual(resolveViewScope(), { project: 'proj', instance: 'ccv-aaa' });
  });

  it('a same-name BOUND view falls back to boundInstance (viewed name === bound name)', () => {
    setViewScope({ projectName: 'proj', viewedProject: null, viewedInstance: null, boundInstance: 'ccv-bbb' });
    assert.deepEqual(resolveViewScope(), { project: 'proj', instance: 'ccv-bbb' });
  });

  it('a same-name bound view with NO resolvable boundInstance → instance null (legacy whole-name)', () => {
    setViewScope({ projectName: 'proj', viewedProject: null, viewedInstance: null, boundInstance: null });
    assert.deepEqual(resolveViewScope(), { project: 'proj', instance: null });
  });

  it('boundInstance is NOT used when viewed name differs from bound name (non-bound view)', () => {
    // viewedProject is a DIFFERENT project while viewedInstance is somehow null → no bound leak.
    setViewScope({ projectName: 'boundproj', viewedProject: 'other', viewedInstance: null, boundInstance: 'ccv-bbb' });
    assert.deepEqual(resolveViewScope(), { project: 'other', instance: null });
  });

  it('project resolves to viewedProject else bound projectName', () => {
    setViewScope({ projectName: 'bound', viewedProject: 'parallel', viewedInstance: null });
    assert.equal(resolveViewScope().project, 'parallel');
    setViewScope({ viewedProject: null });
    assert.equal(resolveViewScope().project, 'bound');
  });
});

describe('withViewParams same-name fallback', () => {
  it('an explicitly-passed instance always wins over the singleton', () => {
    setViewScope({ projectName: 'proj', viewedInstance: 'ccv-scope' });
    const out = withViewParams('/api/files', { project: 'proj', instance: 'ccv-explicit' });
    assert.ok(out.includes('instance=ccv-explicit'));
    assert.ok(!out.includes('ccv-scope'));
  });

  it('falls back to the singleton instance when the caller passes none', () => {
    setViewScope({ projectName: 'proj', viewedProject: null, viewedInstance: null, boundInstance: 'ccv-bbb' });
    const out = withViewParams('/api/files', { project: 'proj' });
    assert.ok(out.includes('project=proj'));
    assert.ok(out.includes('instance=ccv-bbb'));
  });

  it('no instance anywhere → path carries no instance (byte-identical to before)', () => {
    // empty singleton → resolveViewScope().instance === null
    const out = withViewParams('/api/files', { project: 'proj' });
    assert.equal(out, '/api/files?project=proj');
  });

  it('appends instance with the correct separator when the path already has a query', () => {
    setViewScope({ projectName: 'proj', boundInstance: 'ccv-bbb', viewedProject: null, viewedInstance: null });
    const out = withViewParams('/api/files?path=', { project: 'proj' });
    assert.ok(out.includes('&instance=ccv-bbb'));
  });
});
