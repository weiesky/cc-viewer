/**
 * Unit tests for src/utils/askPortalMatcher.js — shouldPortalAskForm()
 *
 * 纯逻辑、无依赖，直接静态 import。
 *
 * 决策三态（activeAskId）：
 *   1. toolu_xxx        → strict：activeAskId === toolId 命中（与 lastPendingAskId 无关）
 *   2. '__ask__'        → owner 通配：仅当 lastPendingAskId === toolId 才命中
 *   3. 'ask_<ts>_<rnd>' → server fallback，同 owner 通配语义
 *   其它/null/不匹配     → false
 *
 * 覆盖：null 早退、strict 命中（含数字↔字符串 String() 归一）、strict 不命中、
 *       __ask__ owner 命中/未命中、ask_* fallback owner 命中/未命中、
 *       非法 activeAskId 不命中、owner 通配下 lastPendingAskId 必须等于 toolId（防双份 portal bug）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldPortalAskForm, isPlaceholderAskId } from '../src/utils/askPortalMatcher.js';

describe('shouldPortalAskForm — null / undefined 早退', () => {
  it('activeAskId === null → false', () => {
    assert.equal(shouldPortalAskForm(null, 'toolu_1', 'toolu_1'), false);
  });
  it('activeAskId === undefined → false', () => {
    assert.equal(shouldPortalAskForm(undefined, 'toolu_1', 'toolu_1'), false);
  });
});

describe('shouldPortalAskForm — strict（真实 tool_use_id）', () => {
  it('activeAskId === toolId 命中（lastPendingAskId 无关，传 null 也命中）', () => {
    assert.equal(shouldPortalAskForm('toolu_abc', 'toolu_abc', null), true);
  });
  it('activeAskId !== toolId 不命中', () => {
    assert.equal(shouldPortalAskForm('toolu_abc', 'toolu_xyz', null), false);
  });
  it('数字与字符串经 String() 归一后相等 → 命中', () => {
    assert.equal(shouldPortalAskForm(123, '123', null), true);
  });
  it('两端都是数字且相等 → 命中', () => {
    assert.equal(shouldPortalAskForm(7, 7, null), true);
  });
  it('toolId 为 null 而 activeAskId 是真实 id → 不命中（"null" !== "toolu_x"）', () => {
    assert.equal(shouldPortalAskForm('toolu_x', null, null), false);
  });
});

describe('shouldPortalAskForm — __ask__ LEGACY 占位（owner 通配）', () => {
  it('lastPendingAskId === toolId → 命中', () => {
    assert.equal(shouldPortalAskForm('__ask__', 'toolu_owner', 'toolu_owner'), true);
  });
  it('lastPendingAskId !== toolId → 不命中（非 owner 不应被通配）', () => {
    assert.equal(shouldPortalAskForm('__ask__', 'toolu_other', 'toolu_owner'), false);
  });
  it('lastPendingAskId === null（非 owner）→ 不命中', () => {
    assert.equal(shouldPortalAskForm('__ask__', 'toolu_x', null), false);
  });
});

describe('shouldPortalAskForm — ask_* server fallback（owner 通配）', () => {
  it('ask_<ts>_<rnd> 且 lastPendingAskId === toolId → 命中', () => {
    assert.equal(shouldPortalAskForm('ask_1700000000000_x9', 'toolu_owner', 'toolu_owner'), true);
  });
  it('ask_* 但 lastPendingAskId !== toolId → 不命中', () => {
    assert.equal(shouldPortalAskForm('ask_1700000000000_x9', 'toolu_b', 'toolu_a'), false);
  });
  it('裸 "ask_" 前缀也算 fallback（startsWith 判定）', () => {
    assert.equal(shouldPortalAskForm('ask_', 'toolu_owner', 'toolu_owner'), true);
  });
});

describe('shouldPortalAskForm — 非法 / 不匹配 activeAskId', () => {
  it('既非 strict 命中、又非 __ask__/ask_ 前缀 → false', () => {
    assert.equal(shouldPortalAskForm('weird_id', 'toolu_owner', 'toolu_owner'), false);
  });
  it('数字 activeAskId 不等于 toolId 且非字符串前缀 → false（startsWith 仅对 string 生效）', () => {
    assert.equal(shouldPortalAskForm(999, 'toolu_owner', 'toolu_owner'), false);
  });
  it('owner 通配前缀命中但 lastPendingAskId 不等（防历史所有真实 toolId 被通配）', () => {
    // 这是 owner 锁定存在的原因：否则会重现双份 portal bug
    assert.equal(shouldPortalAskForm('__ask__', 'toolu_historical', 'toolu_current'), false);
    assert.equal(shouldPortalAskForm('ask_1_2', 'toolu_historical', 'toolu_current'), false);
  });
});

describe('isPlaceholderAskId — placeholder id taxonomy', () => {
  it('true for legacy __ask__ and ask_* server fallback ids', () => {
    assert.equal(isPlaceholderAskId('__ask__'), true);
    assert.equal(isPlaceholderAskId('ask_1700000000000_x9'), true);
    assert.equal(isPlaceholderAskId('ask_'), true);
  });
  it('false for real tool ids, null/undefined, non-strings, and arbitrary strings', () => {
    assert.equal(isPlaceholderAskId('toolu_abc'), false);
    assert.equal(isPlaceholderAskId(null), false);
    assert.equal(isPlaceholderAskId(undefined), false);
    assert.equal(isPlaceholderAskId(123), false);
    assert.equal(isPlaceholderAskId('question'), false);
  });
});
