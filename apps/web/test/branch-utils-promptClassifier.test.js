/**
 * Branch top-up for src/utils/promptClassifier.js
 *
 * test/prompt-classifier-gap.test.js 已覆盖 parseToolInfoFromBuffer 的所有分支。
 * 但 isPlanApprovalPrompt / pickPlanApproveOptionNumber / isDangerousOperationPrompt 在
 * test/permission-detect.test.js 里是 INLINED 副本(不 import 真模块),所以真实模块的
 * L10-28 / L53-71 分支在单跑口径下未计入。本文件 import 真模块,逐条打这两个函数的分支:
 *   - 短路 ||/&& 各臂、三元/默认值(o.text||'')、Array.isArray + length 守卫
 *   - text 路径 vs options 兜底路径
 *   - dangerous: isPlanApprovalPrompt 早退、regex 命中、options allow+deny 兜底
 *
 * 模块为干净 import,直接静态 import 即可(邻近 gap 测试同样做法)。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPlanApprovalPrompt,
  pickPlanApproveOptionNumber,
  isDangerousOperationPrompt,
} from '../src/utils/promptClassifier.js';

describe('isPlanApprovalPrompt — 入口守卫分支', () => {
  it('prompt 为 falsy 时返回 false(!prompt 臂)', () => {
    assert.equal(isPlanApprovalPrompt(null), false);
    assert.equal(isPlanApprovalPrompt(undefined), false);
  });

  it('prompt 存在但无 question 时返回 false(!prompt.question 臂)', () => {
    assert.equal(isPlanApprovalPrompt({}), false);
    assert.equal(isPlanApprovalPrompt({ question: '' }), false);
  });
});

describe('isPlanApprovalPrompt — 文本判定路径 (L13)', () => {
  it('含 plan + approv → true', () => {
    assert.equal(isPlanApprovalPrompt({ question: 'Approve this plan?' }), true);
  });

  it('含 plan + proceed → true(命中第二个 || 臂)', () => {
    assert.equal(isPlanApprovalPrompt({ question: 'This is a plan, shall we proceed?' }), true);
  });

  it('含 plan + accept → true(命中第三个 || 臂)', () => {
    assert.equal(isPlanApprovalPrompt({ question: 'Plan ready — accept it?' }), true);
  });

  it('含 plan 但无 approv/proceed/accept → 文本路径不命中(走到后续)', () => {
    // 无 options,后续兜底也不命中 → false
    assert.equal(isPlanApprovalPrompt({ question: 'Here is the plan to review' }), false);
  });

  it('无 plan 关键字 → 文本路径首臂短路为 false', () => {
    assert.equal(isPlanApprovalPrompt({ question: 'Do you approve and proceed and accept?' }), false);
  });
});

describe('isPlanApprovalPrompt — options 兜底路径 (L20-26)', () => {
  it('3 选项 approve/edits/reject 全齐 → true', () => {
    const prompt = {
      question: 'Would you like to proceed with this?', // 注意:proceed 但无 plan,文本路径不命中
      options: [
        { text: 'Yes, approve' },
        { text: 'Approve with edits' },
        { text: 'No, reject and keep planning' },
      ],
    };
    // 文本路径:无 "plan" → 不命中;走 options 兜底
    assert.equal(isPlanApprovalPrompt(prompt), true);
  });

  it('options 不是数组 → 跳过兜底(Array.isArray 守卫 false 臂)', () => {
    assert.equal(isPlanApprovalPrompt({ question: 'pick one', options: 'not-array' }), false);
  });

  it('options 长度不为 3 → 跳过兜底(length===3 守卫 false 臂)', () => {
    const prompt = {
      question: 'pick one',
      options: [{ text: 'Approve' }, { text: 'Reject' }],
    };
    assert.equal(isPlanApprovalPrompt(prompt), false);
  });

  it('选项缺 text 时用 "" 默认值,不抛 (o.text||"") 默认臂', () => {
    const prompt = {
      question: 'pick',
      options: [{}, {}, {}], // 三个全无 text
    };
    // 全空 → hasApprove/hasEdit/hasReject 全 false → false
    assert.equal(isPlanApprovalPrompt(prompt), false);
  });

  it('有 approve 但缺 edit → 不满足全齐(hasEdit false 臂)', () => {
    const prompt = {
      question: 'pick',
      options: [
        { text: 'approve' },
        { text: 'something else' },
        { text: 'reject' },
      ],
    };
    assert.equal(isPlanApprovalPrompt(prompt), false);
  });

  it('有 approve+edit 但缺 reject → 不满足全齐(hasReject false 臂)', () => {
    const prompt = {
      question: 'pick',
      options: [
        { text: 'approve' },
        { text: 'edit it' },
        { text: 'something else' },
      ],
    };
    assert.equal(isPlanApprovalPrompt(prompt), false);
  });

  it('reject 通过 "no," 同义词命中(hasReject 备用臂)', () => {
    const prompt = {
      question: 'pick',
      options: [
        { text: 'approve plan' },
        { text: 'modify it' }, // 命中 /modify/
        { text: 'no, keep planning' }, // 命中 /no,/ 与 keep planning
      ],
    };
    assert.equal(isPlanApprovalPrompt(prompt), true);
  });
});

describe('pickPlanApproveOptionNumber — 守卫与回退分支', () => {
  it('options 非数组 → 返回 1', () => {
    assert.equal(pickPlanApproveOptionNumber(null), 1);
    assert.equal(pickPlanApproveOptionNumber(undefined), 1);
    assert.equal(pickPlanApproveOptionNumber('x'), 1);
  });

  it('options 空数组 → 返回 1', () => {
    assert.equal(pickPlanApproveOptionNumber([]), 1);
  });

  it('找到明确 approve 选项 → 返回其 number', () => {
    const opts = [
      { number: 1, text: 'No, reject' },
      { number: 2, text: 'Yes, approve' },
    ];
    assert.equal(pickPlanApproveOptionNumber(opts), 2);
  });

  it('approve 文本含 feedback/edit 关键字 → 被排除(否定臂),回退首项', () => {
    const opts = [
      { number: 3, text: 'first option' },
      { number: 4, text: 'Yes, but let me type feedback' }, // 命中 yes 但也命中 type/feedback → 排除
    ];
    // 无合格 approve → 回退首项 number=3
    assert.equal(pickPlanApproveOptionNumber(opts), 3);
  });

  it('元素为 null 时 (o&&o.text)||"" 默认臂不抛', () => {
    const opts = [null, { number: 5, text: 'approve' }];
    assert.equal(pickPlanApproveOptionNumber(opts), 5);
  });

  it('approve 选项的 number 非 number 类型 → 回退首项分支', () => {
    const opts = [
      { number: 7, text: 'plain first' },
      { text: 'approve', number: 'NaN-ish' }, // approve 命中但 number 非数字
    ];
    // approve.number 非 number → 不走 L47,落到首项 number=7
    assert.equal(pickPlanApproveOptionNumber(opts), 7);
  });

  it('无 approve 且首项 number 非数字 → 最终回退 1', () => {
    const opts = [
      { text: 'foo' },          // 首项无 number
      { text: 'bar reject' },
    ];
    assert.equal(pickPlanApproveOptionNumber(opts), 1);
  });
});

describe('isDangerousOperationPrompt — 入口与早退分支', () => {
  it('prompt 为 falsy → false(!prompt 臂)', () => {
    assert.equal(isDangerousOperationPrompt(null), false);
    assert.equal(isDangerousOperationPrompt(undefined), false);
  });

  it('无 question → false(!prompt.question 臂)', () => {
    assert.equal(isDangerousOperationPrompt({}), false);
    assert.equal(isDangerousOperationPrompt({ question: '' }), false);
  });

  it('是 plan approval 时早退返回 false (L55 早退臂)', () => {
    const prompt = { question: 'Do you want to approve this plan?' };
    // 同时也会被 dangerous regex(do you want to ...)考虑,但 plan 早退优先
    assert.equal(isDangerousOperationPrompt(prompt), false);
  });
});

describe('isDangerousOperationPrompt — 正则命中路径 (L60)', () => {
  it('"do you want to make this edit" → true', () => {
    assert.equal(isDangerousOperationPrompt({ question: 'Do you want to make this edit?' }), true);
  });

  it('"allow X to Y" 模式 → true', () => {
    assert.equal(isDangerousOperationPrompt({ question: 'Allow Claude to run this command?' }), true);
  });

  it('"wants to execute" → true', () => {
    assert.equal(isDangerousOperationPrompt({ question: 'Claude wants to execute a script' }), true);
  });

  it('"may Claude read..." → true', () => {
    assert.equal(isDangerousOperationPrompt({ question: 'May Claude read this file?' }), true);
  });

  it('"grant access" → true', () => {
    assert.equal(isDangerousOperationPrompt({ question: 'Please grant access to the folder' }), true);
  });

  it('"permit" → true', () => {
    assert.equal(isDangerousOperationPrompt({ question: 'Do you permit this?' }), true);
  });
});

describe('isDangerousOperationPrompt — options 兜底路径 (L64-68)', () => {
  it('options allow + deny 同在 → true', () => {
    const prompt = {
      question: 'Some neutral prompt text', // regex 不命中
      options: [
        { text: 'Allow this' },
        { text: 'Deny it' },
      ],
    };
    assert.equal(isDangerousOperationPrompt(prompt), true);
  });

  it('options 通过 yes/no 同义词命中 → true', () => {
    const prompt = {
      question: 'neutral text',
      options: [
        { text: 'Yes please' },
        { text: 'No' },
      ],
    };
    assert.equal(isDangerousOperationPrompt(prompt), true);
  });

  it('无 options → 跳过兜底(prompt.options falsy 臂)', () => {
    assert.equal(isDangerousOperationPrompt({ question: 'neutral text only' }), false);
  });

  it('options 长度 < 2 → 跳过兜底(length>=2 守卫 false 臂)', () => {
    const prompt = { question: 'neutral text', options: [{ text: 'Allow' }] };
    assert.equal(isDangerousOperationPrompt(prompt), false);
  });

  it('选项缺 text 用 "" 默认值,不抛 (o.text||"") 默认臂', () => {
    const prompt = { question: 'neutral text', options: [{}, {}] };
    assert.equal(isDangerousOperationPrompt(prompt), false);
  });

  it('有 allow 但无 deny → 不命中(hasDeny false 臂)', () => {
    const prompt = {
      question: 'neutral text',
      options: [{ text: 'Allow this' }, { text: 'Maybe later' }],
    };
    assert.equal(isDangerousOperationPrompt(prompt), false);
  });

  it('有 deny 但无 allow → 不命中(hasAllow false 臂)', () => {
    const prompt = {
      question: 'neutral text',
      options: [{ text: 'Cancel it' }, { text: 'Deny request' }],
    };
    assert.equal(isDangerousOperationPrompt(prompt), false);
  });

  it('全不命中(无 regex、无 options 关键字)→ false 兜底', () => {
    assert.equal(isDangerousOperationPrompt({ question: 'Just a friendly hello' }), false);
  });
});
