import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  BUILTIN_EXPERT_KEYS,
  naturalExpertKeys,
  orderedExpertKeys,
  buildExpertList,
  visibleExpertKeys,
  reorderKeys,
  countVisible,
  canHideOne,
} from '../src/utils/ultraplanExperts.js';

const custom = (id) => ({ id, title: 'T-' + id, content: 'C-' + id });

describe('naturalExpertKeys', () => {
  it('builtins first, then customs in array order', () => {
    assert.deepEqual(
      naturalExpertKeys([custom('a'), custom('b')]),
      ['codeExpert', 'researchExpert', 'custom:a', 'custom:b'],
    );
  });
  it('handles empty / non-array / malformed custom list', () => {
    assert.deepEqual(naturalExpertKeys([]), [...BUILTIN_EXPERT_KEYS]);
    assert.deepEqual(naturalExpertKeys(undefined), [...BUILTIN_EXPERT_KEYS]);
    assert.deepEqual(naturalExpertKeys([null, { id: 'x' }, {}]), ['codeExpert', 'researchExpert', 'custom:x']);
  });
});

describe('orderedExpertKeys', () => {
  it('empty order → natural order', () => {
    assert.deepEqual(
      orderedExpertKeys([custom('a')], []),
      ['codeExpert', 'researchExpert', 'custom:a'],
    );
  });
  it('applies a saved order', () => {
    assert.deepEqual(
      orderedExpertKeys([custom('a')], ['custom:a', 'researchExpert', 'codeExpert']),
      ['custom:a', 'researchExpert', 'codeExpert'],
    );
  });
  it('appends keys missing from the saved order (new experts) at the end', () => {
    assert.deepEqual(
      orderedExpertKeys([custom('a'), custom('b')], ['researchExpert', 'codeExpert']),
      ['researchExpert', 'codeExpert', 'custom:a', 'custom:b'],
    );
  });
  it('drops stale keys (deleted custom / unknown) from the saved order', () => {
    assert.deepEqual(
      orderedExpertKeys([custom('a')], ['custom:gone', 'custom:a', 'codeExpert', 'bogus']),
      ['custom:a', 'codeExpert', 'researchExpert'],
    );
  });
  it('dedups repeated keys in the saved order', () => {
    assert.deepEqual(
      orderedExpertKeys([], ['codeExpert', 'codeExpert', 'researchExpert']),
      ['codeExpert', 'researchExpert'],
    );
  });
});

describe('buildExpertList', () => {
  it('marks kind, associates custom item, flags hidden', () => {
    const list = buildExpertList([custom('a')], ['custom:a', 'codeExpert', 'researchExpert'], ['researchExpert']);
    assert.equal(list.length, 3);
    assert.deepEqual(list[0], { key: 'custom:a', kind: 'custom', item: custom('a'), hidden: false });
    assert.deepEqual(list[1], { key: 'codeExpert', kind: 'builtin', item: null, hidden: false });
    assert.equal(list[2].key, 'researchExpert');
    assert.equal(list[2].hidden, true);
  });
  it('hidden referencing a deleted custom key is simply ignored (not present)', () => {
    const list = buildExpertList([], [], ['custom:gone']);
    assert.deepEqual(list.map(d => d.key), ['codeExpert', 'researchExpert']);
    assert.ok(list.every(d => d.hidden === false));
  });
});

describe('visibleExpertKeys', () => {
  it('filters hidden, preserves order', () => {
    assert.deepEqual(
      visibleExpertKeys([custom('a'), custom('b')], ['custom:b', 'codeExpert', 'researchExpert', 'custom:a'], ['codeExpert']),
      ['custom:b', 'researchExpert', 'custom:a'],
    );
  });
  it('all hidden → empty', () => {
    assert.deepEqual(
      visibleExpertKeys([], [], ['codeExpert', 'researchExpert']),
      [],
    );
  });
  it('defaults (no order/hidden) → all visible in natural order', () => {
    assert.deepEqual(
      visibleExpertKeys([custom('a')], undefined, undefined),
      ['codeExpert', 'researchExpert', 'custom:a'],
    );
  });
});

describe('reorderKeys', () => {
  const KS = ['A', 'B', 'C', 'D'];
  it('moves an item downward (drop target index shifts by -1)', () => {
    assert.deepEqual(reorderKeys(KS, 0, 3), ['B', 'C', 'A', 'D']); // A 落到原 D 之前
    assert.deepEqual(reorderKeys(KS, 0, 4), ['B', 'C', 'D', 'A']); // 落到末尾
  });
  it('moves an item upward (no shift)', () => {
    assert.deepEqual(reorderKeys(KS, 2, 0), ['C', 'A', 'B', 'D']);
    assert.deepEqual(reorderKeys(KS, 3, 1), ['A', 'D', 'B', 'C']);
  });
  it('from === to or adjacent no-op returns unchanged copy', () => {
    assert.deepEqual(reorderKeys(KS, 1, 1), KS);
    assert.deepEqual(reorderKeys(KS, 1, 2), KS); // 向下挪到紧邻下一行 = 原位
  });
  it('does not mutate the input', () => {
    const input = ['A', 'B', 'C'];
    reorderKeys(input, 0, 2);
    assert.deepEqual(input, ['A', 'B', 'C']);
  });
  it('guards null / out-of-range / non-array', () => {
    assert.deepEqual(reorderKeys(KS, null, 2), KS);
    assert.deepEqual(reorderKeys(KS, 9, 0), KS);
    assert.deepEqual(reorderKeys(undefined, 0, 1), []);
  });
});

describe('countVisible / canHideOne', () => {
  const mk = (hidden) => hidden.map((h, i) => ({ key: 'k' + i, hidden: h }));
  it('countVisible counts non-hidden rows', () => {
    assert.equal(countVisible(mk([false, true, false])), 2);
    assert.equal(countVisible(mk([true, true])), 0);
    assert.equal(countVisible([]), 0);
    assert.equal(countVisible(undefined), 0);
  });
  it('canHideOne is true only when >1 visible (so hiding one leaves ≥1)', () => {
    assert.equal(canHideOne(mk([false, false])), true);
    assert.equal(canHideOne(mk([false, true])), false); // only 1 visible → cannot hide more
    assert.equal(canHideOne(mk([true, true])), false);
  });
});
