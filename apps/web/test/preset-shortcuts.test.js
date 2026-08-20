/**
 * src/utils/presetShortcuts.js 单元测试。
 *
 * 覆盖 buildPresetShortcutsPayload：
 *   - items → presetShortcuts 数组的逐项映射（teamName/description 必带）
 *   - builtinId / modified 为真值时才写入；否则省略
 *   - dismissed 为 Set 时展开为 dismissedBuiltinPresets 数组；undefined 时不写入 key
 *   - 空 items / 空 Set 的边界
 *
 * 依赖链干净（无 import），直接静态 import。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildPresetShortcutsPayload } from '../src/utils/presetShortcuts.js';

describe('buildPresetShortcutsPayload', () => {
  it('空 items + undefined dismissed → 只含空 presetShortcuts', () => {
    const payload = buildPresetShortcutsPayload([], undefined);
    assert.deepEqual(payload, { presetShortcuts: [] });
    assert.ok(!('dismissedBuiltinPresets' in payload));
  });

  it('普通 item 仅映射 teamName/description（无 builtinId/modified）', () => {
    const payload = buildPresetShortcutsPayload(
      [{ teamName: 'T1', description: 'D1' }],
      undefined,
    );
    assert.deepEqual(payload.presetShortcuts, [{ teamName: 'T1', description: 'D1' }]);
  });

  it('builtinId 真值时写入 payload', () => {
    const payload = buildPresetShortcutsPayload(
      [{ teamName: 'T', description: 'D', builtinId: 'codereview-5' }],
      undefined,
    );
    assert.deepEqual(payload.presetShortcuts[0], {
      teamName: 'T',
      description: 'D',
      builtinId: 'codereview-5',
    });
  });

  it('modified 真值时写入 modified:true（恒为布尔 true）', () => {
    const payload = buildPresetShortcutsPayload(
      [{ teamName: 'T', description: 'D', modified: 'yes' }],
      undefined,
    );
    assert.equal(payload.presetShortcuts[0].modified, true);
  });

  it('builtinId/modified 为假值时被省略', () => {
    const payload = buildPresetShortcutsPayload(
      [{ teamName: 'T', description: 'D', builtinId: '', modified: false }],
      undefined,
    );
    assert.deepEqual(payload.presetShortcuts[0], { teamName: 'T', description: 'D' });
    assert.ok(!('builtinId' in payload.presetShortcuts[0]));
    assert.ok(!('modified' in payload.presetShortcuts[0]));
  });

  it('dismissed 为 Set → 展开为数组写入 dismissedBuiltinPresets', () => {
    const payload = buildPresetShortcutsPayload(
      [{ teamName: 'T', description: 'D' }],
      new Set(['a', 'b']),
    );
    assert.deepEqual(payload.dismissedBuiltinPresets, ['a', 'b']);
  });

  it('dismissed 为空 Set → 写入 key 但值是空数组（Set 真值）', () => {
    const payload = buildPresetShortcutsPayload([], new Set());
    assert.ok('dismissedBuiltinPresets' in payload);
    assert.deepEqual(payload.dismissedBuiltinPresets, []);
  });

  it('多 item 逐项映射且保持顺序', () => {
    const payload = buildPresetShortcutsPayload(
      [
        { teamName: 'A', description: 'a', builtinId: 'x', modified: true },
        { teamName: 'B', description: 'b' },
      ],
      undefined,
    );
    assert.equal(payload.presetShortcuts.length, 2);
    assert.deepEqual(payload.presetShortcuts[0], {
      teamName: 'A',
      description: 'a',
      builtinId: 'x',
      modified: true,
    });
    assert.deepEqual(payload.presetShortcuts[1], { teamName: 'B', description: 'b' });
  });
});
