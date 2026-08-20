/**
 * src/utils/builtinPresets.js 单元测试。
 *
 * 覆盖导出常量 BUILTIN_PRESETS：
 *   - 数组形态与当前条目内容（codereview-5）
 *   - 每个条目的字段契约（builtinId / teamName / description 均为 i18n key 字符串）
 *
 * 依赖链干净（纯数据，无 import），直接静态 import。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { BUILTIN_PRESETS } from '../src/utils/builtinPresets.js';

describe('BUILTIN_PRESETS', () => {
  it('是数组且当前仅含一个内置预置', () => {
    assert.ok(Array.isArray(BUILTIN_PRESETS));
    assert.equal(BUILTIN_PRESETS.length, 1);
  });

  it('codereview-5 条目内容与 i18n key 契约', () => {
    const p = BUILTIN_PRESETS[0];
    assert.deepEqual(p, {
      builtinId: 'codereview-5',
      teamName: 'ui.preset.codeReview5.name',
      description: 'ui.preset.codeReview5.desc',
    });
  });

  it('每个条目都具备 builtinId/teamName/description 三个字符串字段', () => {
    for (const p of BUILTIN_PRESETS) {
      assert.equal(typeof p.builtinId, 'string');
      assert.equal(typeof p.teamName, 'string');
      assert.equal(typeof p.description, 'string');
      assert.ok(p.builtinId.length > 0);
    }
  });

  it('builtinId 在数组内唯一', () => {
    const ids = BUILTIN_PRESETS.map(p => p.builtinId);
    assert.equal(new Set(ids).size, ids.length);
  });
});
