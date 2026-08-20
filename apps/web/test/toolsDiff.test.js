/**
 * Unit tests for src/utils/toolsDiff.js (computeToolsDiff)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeToolsDiff } from '../src/utils/toolsDiff.js';

const tool = (name) => ({ name, description: 'x', input_schema: { type: 'object' } });

describe('computeToolsDiff', () => {
  it('no baseline (prevTools null/undefined/non-array) → no diff', () => {
    for (const prev of [null, undefined, 'nope', 42]) {
      const d = computeToolsDiff(prev, [tool('Bash'), tool('Read')]);
      assert.equal(d.hasPrev, false);
      assert.equal(d.changed, false);
      assert.deepEqual(d.addedNames, []);
      assert.deepEqual(d.removedNames, []);
      assert.equal(d.addedCount, 0);
      assert.equal(d.removedCount, 0);
      assert.equal(d.isAdded('Bash'), false, 'no baseline → nothing is "added"');
    }
  });

  it('identical sets → changed false', () => {
    const d = computeToolsDiff([tool('Bash'), tool('Read')], [tool('Read'), tool('Bash')]);
    assert.equal(d.hasPrev, true);
    assert.equal(d.changed, false);
    assert.deepEqual(d.addedNames, []);
    assert.deepEqual(d.removedNames, []);
  });

  it('detects added and removed tools by name', () => {
    const prev = [tool('Bash'), tool('Read'), tool('ToolSearch')];
    const cur = [tool('Bash'), tool('ToolSearch'), tool('WebFetch'), tool('WebSearch')];
    const d = computeToolsDiff(prev, cur);
    assert.equal(d.changed, true);
    assert.deepEqual(d.addedNames.sort(), ['WebFetch', 'WebSearch']);
    assert.deepEqual(d.removedNames, ['Read']);
    assert.equal(d.addedCount, 2);
    assert.equal(d.removedCount, 1);
    assert.equal(d.isAdded('WebFetch'), true);
    assert.equal(d.isAdded('Bash'), false, 'carried-over tool is not "added"');
    assert.equal(d.isAdded('Read'), false, 'removed tool is not in current → not "added"');
  });

  it('tools without a name are ignored on both sides', () => {
    const prev = [tool('Bash'), { description: 'no name' }, { name: '' }, null];
    const cur = [tool('Bash'), tool('Read'), { name: null }];
    const d = computeToolsDiff(prev, cur);
    assert.deepEqual(d.addedNames, ['Read']);
    assert.deepEqual(d.removedNames, []);
    assert.equal(d.isAdded(undefined), false);
    assert.equal(d.isAdded(''), false);
  });

  it('duplicate names counted once on both sides (unified口径)', () => {
    // prev 有两个同名 Read，cur 移除全部 Read 并新增两个同名 WebFetch
    const prev = [tool('Bash'), tool('Read'), tool('Read')];
    const cur = [tool('Bash'), tool('WebFetch'), tool('WebFetch')];
    const d = computeToolsDiff(prev, cur);
    assert.deepEqual(d.removedNames, ['Read'], 'duplicate removed name counted once');
    assert.deepEqual(d.addedNames, ['WebFetch'], 'duplicate added name counted once');
    assert.equal(d.addedCount, 1);
    assert.equal(d.removedCount, 1);
  });

  it('curTools null/undefined → everything in prev is removed', () => {
    const d = computeToolsDiff([tool('Bash'), tool('Read')], null);
    assert.deepEqual(d.removedNames.sort(), ['Bash', 'Read']);
    assert.deepEqual(d.addedNames, []);
    assert.equal(d.changed, true);
  });
});
