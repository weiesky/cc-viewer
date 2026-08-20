/**
 * Unit tests for src/utils/displayScaleHelper.js
 * 纯函数测试 — 无 DOM/React 依赖。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DISPLAY_SCALE_PRESETS, snapToPreset, stepPreset } from '../src/utils/displayScaleHelper.js';

describe('snapToPreset', () => {
  it('已经是预设值时原样返回', () => {
    for (const p of DISPLAY_SCALE_PRESETS) assert.equal(snapToPreset(p), p);
  });

  it('低于下限夹到 50', () => {
    assert.equal(snapToPreset(10), 50);
    assert.equal(snapToPreset(0), 50);
    assert.equal(snapToPreset(-100), 50);
  });

  it('高于上限夹到 200', () => {
    assert.equal(snapToPreset(500), 200);
    assert.equal(snapToPreset(201), 200);
  });

  it('吸附到最近档位', () => {
    assert.equal(snapToPreset(96), 100); // 96 距 90=6,距 100=4 → 100
    assert.equal(snapToPreset(92), 90);  // 92 距 90=2,距 100=8 → 90
    assert.equal(snapToPreset(160), 150); // 距 150=10,距 175=15 → 150
  });

  it('平局取较大档位', () => {
    assert.equal(snapToPreset(95), 100); // 距 90 与 100 都是 5 → 取 100
  });

  it('非法输入回退到 100', () => {
    assert.equal(snapToPreset(NaN), 100);
    assert.equal(snapToPreset('abc'), 100);
    assert.equal(snapToPreset(undefined), 100);
  });

  it('数字字符串可解析', () => {
    assert.equal(snapToPreset('125'), 125);
  });
});

describe('stepPreset', () => {
  it('向上前进一格', () => {
    assert.equal(stepPreset(100, +1), 110);
    assert.equal(stepPreset(50, +1), 67);
  });

  it('向下后退一格', () => {
    assert.equal(stepPreset(100, -1), 90);
    assert.equal(stepPreset(67, -1), 50);
  });

  it('上限处不越界', () => {
    assert.equal(stepPreset(200, +1), 200);
  });

  it('下限处不越界', () => {
    assert.equal(stepPreset(50, -1), 50);
  });

  it('非预设输入先吸附再移动', () => {
    assert.equal(stepPreset(96, +1), 110); // 96→100,再 +1 → 110
    assert.equal(stepPreset(96, -1), 90);  // 96→100,再 -1 → 90
  });
});
