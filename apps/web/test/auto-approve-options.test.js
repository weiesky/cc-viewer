/**
 * src/utils/autoApproveOptions.js 单测 —— 自动审批档位唯一事实源
 *
 * 终端工具栏快捷设置菜单 / AppHeader 设置抽屉 / Mobile 设置四处 Select 共用此模块,
 * 这里锁定档位集合与文案映射,防止档位回归发散(权限无 30s、Plan 无 3s/5s 是产品决策)。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTO_APPROVE_INSTANT,
  PERM_AUTO_APPROVE_OPTIONS,
  PLAN_AUTO_APPROVE_OPTIONS,
  autoApproveValueLabel,
  autoApproveSelectOptions,
} from '../src/utils/autoApproveOptions.js';

// 测试用 t:回显 key,便于断言走了哪个 i18n 分支
const t = (key) => key;

describe('auto-approve option sets', () => {
  it('AUTO_APPROVE_INSTANT is -1', () => {
    assert.equal(AUTO_APPROVE_INSTANT, -1);
  });

  it('permission options: off/3/5/10/instant (no 30s)', () => {
    assert.deepEqual(PERM_AUTO_APPROVE_OPTIONS, [0, 3, 5, 10, AUTO_APPROVE_INSTANT]);
  });

  it('plan options: off/10/30/60/instant (no 3s/5s)', () => {
    assert.deepEqual(PLAN_AUTO_APPROVE_OPTIONS, [0, 10, 30, 60, AUTO_APPROVE_INSTANT]);
  });
});

describe('autoApproveValueLabel', () => {
  it('maps -1 to instant i18n key', () => {
    assert.equal(autoApproveValueLabel(AUTO_APPROVE_INSTANT, t), 'ui.permission.autoApprove.instant');
  });

  it('maps 0 and undefined to off i18n key', () => {
    assert.equal(autoApproveValueLabel(0, t), 'ui.permission.autoApprove.off');
    assert.equal(autoApproveValueLabel(undefined, t), 'ui.permission.autoApprove.off');
  });

  it('maps positive seconds to literal "Ns" (including legacy values outside the option sets)', () => {
    assert.equal(autoApproveValueLabel(10, t), '10s');
    assert.equal(autoApproveValueLabel(3, t), '3s'); // Plan 旧值,档位已剔除但显示要兼容
  });
});

describe('autoApproveSelectOptions', () => {
  it('builds antd Select options with value/label pairs', () => {
    assert.deepEqual(autoApproveSelectOptions(PLAN_AUTO_APPROVE_OPTIONS, t), [
      { value: 0, label: 'ui.permission.autoApprove.off' },
      { value: 10, label: '10s' },
      { value: 30, label: '30s' },
      { value: 60, label: '60s' },
      { value: AUTO_APPROVE_INSTANT, label: 'ui.permission.autoApprove.instant' },
    ]);
  });
});
