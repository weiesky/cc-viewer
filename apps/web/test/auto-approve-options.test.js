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
  ASK_AUTO_ANSWER_OFF,
  ASK_AUTO_ANSWER_OPTIONS,
  askAutoAnswerValueLabel,
  askAutoAnswerSelectOptions,
  askAutoAnswerUiValue,
  askAutoAnswerPrefValue,
} from '../src/utils/autoApproveOptions.js';

// 测试用 t:回显 key,便于断言走了哪个 i18n 分支
const t = (key) => key;
// 带参数回显:锁定 {n} 占位透传
const tp = (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key);

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

describe('ask auto-answer (问答题自动托管) option set', () => {
  it('options: 0/10/20/30 minutes + OFF sentinel', () => {
    assert.equal(ASK_AUTO_ANSWER_OFF, -1);
    assert.deepEqual(ASK_AUTO_ANSWER_OPTIONS, [0, 10, 20, 30, ASK_AUTO_ANSWER_OFF]);
  });

  it('label mapping: OFF → off key, 0 → instant key, N → minutes key with {n}', () => {
    assert.equal(askAutoAnswerValueLabel(ASK_AUTO_ANSWER_OFF, t), 'ui.askAutoAnswer.off');
    assert.equal(askAutoAnswerValueLabel(null, t), 'ui.askAutoAnswer.off');
    assert.equal(askAutoAnswerValueLabel(undefined, t), 'ui.askAutoAnswer.off');
    assert.equal(askAutoAnswerValueLabel(0, t), 'ui.askAutoAnswer.instant');
    assert.equal(askAutoAnswerValueLabel(10, tp), 'ui.askAutoAnswer.minutes:{"n":10}');
  });

  it('select options carry all five tiers', () => {
    assert.deepEqual(askAutoAnswerSelectOptions(t).map(o => o.value), [0, 10, 20, 30, -1]);
  });

  it('pref → UI sentinel: number passes, everything else maps to OFF', () => {
    assert.equal(askAutoAnswerUiValue(10), 10);
    assert.equal(askAutoAnswerUiValue(0), 0);
    assert.equal(askAutoAnswerUiValue(null), -1);
    assert.equal(askAutoAnswerUiValue(undefined), -1);
    assert.equal(askAutoAnswerUiValue('10'), -1, 'dirty legacy values degrade to off');
    assert.equal(askAutoAnswerUiValue(NaN), -1, 'NaN must not render "NaN 分钟"');
    assert.equal(askAutoAnswerUiValue(Infinity), -1, 'Infinity must not render "Infinity 分钟"');
  });

  it('UI sentinel → pref: OFF persists null, finite numbers pass, everything else null', () => {
    assert.equal(askAutoAnswerPrefValue(-1), null);
    assert.equal(askAutoAnswerPrefValue(0), 0, '0 分钟 must persist as 0 (instant), never null');
    assert.equal(askAutoAnswerPrefValue(20), 20);
    // undefined would be dropped by JSON.stringify and leave the server value stale.
    assert.equal(askAutoAnswerPrefValue(undefined), null, 'non-finite/undefined must persist null, not be dropped');
    assert.equal(askAutoAnswerPrefValue(NaN), null);
  });

  it('round-trip: pref → UI → pref preserves the value domain', () => {
    for (const pref of [null, 0, 10, 20, 30]) {
      assert.equal(askAutoAnswerPrefValue(askAutoAnswerUiValue(pref)), pref);
    }
  });
});
