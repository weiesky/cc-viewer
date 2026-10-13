/**
 * viewChannelState factory + journal + cacheKey contract.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createChannelState, appendJournal, cacheKeyForScope, REACT_SLICE_KEYS, clearChannelTimers } from '../src/utils/viewChannelState.js';

describe('createChannelState', () => {
  it('produces the full shape with an empty react slice matching REACT_SLICE_KEYS', () => {
    const vm = createChannelState();
    assert.ok(vm && typeof vm === 'object');
    for (const k of REACT_SLICE_KEYS) assert.ok(k in vm.react, `react.${k} present`);
    assert.deepEqual(vm.journal, []);
    assert.equal(vm.journalDropped, false);
    assert.equal(vm.committed, false);
    assert.equal(vm.v3AssemblerInst, null, 'per-channel v3 assembler starts empty');
  });

  it('two channels never share a react slice or journal', () => {
    const a = createChannelState();
    const b = createChannelState();
    a.react.isStreaming = true;
    a.journal.push({ timestamp: 't1' });
    assert.equal(b.react.isStreaming, false);
    assert.equal(b.journal.length, 0);
  });
});

describe('appendJournal', () => {
  it('appends entries up to the cap', () => {
    const vm = createChannelState();
    appendJournal(vm, { timestamp: 't1' }, 3);
    appendJournal(vm, { timestamp: 't2' }, 3);
    assert.equal(vm.journal.length, 2);
    assert.equal(vm.journalDropped, false);
  });

  it('past the cap the journal drops wholesale (journalDropped) — never a partial replay', () => {
    const vm = createChannelState();
    for (let i = 0; i < 3; i++) appendJournal(vm, { timestamp: `t${i}` }, 3);
    appendJournal(vm, { timestamp: 'overflow' }, 3);
    assert.equal(vm.journalDropped, true);
    assert.equal(vm.journal.length, 0, 'journal cleared on drop');
    appendJournal(vm, { timestamp: 'later' }, 3);
    assert.equal(vm.journal.length, 0, 'stays dropped');
  });
});

describe('cacheKeyForScope', () => {
  it('matches the AppBase view-cache key space (bare project / project\x00instance)', () => {
    assert.equal(cacheKeyForScope({ project: 'alpha' }), 'alpha');
    assert.equal(cacheKeyForScope({ project: 'alpha', instance: 'ccv-aa' }), 'alpha\x00ccv-aa');
    assert.equal(cacheKeyForScope({}), null);
    assert.equal(cacheKeyForScope(null), null);
  });
});

describe('clearChannelTimers', () => {
  it('cancels every armed timer and nulls the slots', () => {
    const vm = createChannelState();
    const cleared = [];
    vm.turnStaleTimer = 1; vm.streamingOffTimer = 2; vm.clearOptimisticTimer = 3; vm.streamingRaf = 4;
    clearChannelTimers(vm, { clearTimeout: (id) => cleared.push(id), cancelAnimationFrame: (id) => cleared.push(`raf${id}`) });
    assert.deepEqual(cleared.sort(), [1, 2, 3, 'raf4'].sort());
    assert.equal(vm.turnStaleTimer, null);
    assert.equal(vm.streamingRaf, null);
  });
});
