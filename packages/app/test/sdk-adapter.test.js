import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sdkApprovalCloseType } from '../server/lib/sdk-adapter.js';

// sdk-adapter 的展示合成函数(sdkToJSONLEntry/buildStreamingStatus)已随
// 「SDK 模式走 wire 通路」改造下线 — SDK 子进程经 CCV 回环代理访问 API,
// 报文捕获/落盘/流式状态与 PTY 模式共用同一数据通路,不再需要合成 entry。
// 仅保留审批关闭类型映射 sdkApprovalCloseType(server.js 在用)。
describe('sdkApprovalCloseType', () => {
  // interruptTurn() 排空 pending approvals 后，server.js 用该映射告诉所有 client 关掉对应 modal。
  // 映射错 = 关错弹窗 / 走错 client handler，故逐 kind 锁定。
  it("maps 'ask' → ask-hook-cancelled", () => {
    assert.equal(sdkApprovalCloseType('ask'), 'ask-hook-cancelled');
  });

  it("maps 'plan' → sdk-plan-resolved", () => {
    assert.equal(sdkApprovalCloseType('plan'), 'sdk-plan-resolved');
  });

  it("maps 'perm' → perm-hook-resolved", () => {
    assert.equal(sdkApprovalCloseType('perm'), 'perm-hook-resolved');
  });

  it('falls back to perm-hook-resolved for null (interruptTurn returns kind=null when unset)', () => {
    assert.equal(sdkApprovalCloseType(null), 'perm-hook-resolved');
  });

  it('falls back to perm-hook-resolved for unknown / undefined kinds', () => {
    assert.equal(sdkApprovalCloseType(undefined), 'perm-hook-resolved');
    assert.equal(sdkApprovalCloseType('bogus'), 'perm-hook-resolved');
  });
});
