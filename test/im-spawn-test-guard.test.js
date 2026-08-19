/**
 * L4 铁闸单测 — im-process-manager.spawnImProcess 在测试环境拒绝拉起真实 IM worker。
 *
 * 背景(2026-06-06 数据事故):整链 server 测试触发真实 spawnImProcess,detached worker
 * 脱离测试生命周期常驻,其子链(buildChildEnv 按设计剥离 CCV_*)以真实 ~/.claude/cc-viewer
 * 为 LOG_DIR,与用户真实环境互相破坏,三次整树删除用户 40GB 历史日志。
 * 铁闸语义:NODE_TEST_CONTEXT 存在 && 未注入 spawnImpl && 未显式 CCV_TEST_ALLOW_IM_SPAWN=1
 * → 拒绝 spawn,返回 { pid: undefined, blockedByTestGuard: true }。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { spawnImProcess } = await import('../packages/app/server/lib/im/im-process-manager.js');

describe('spawnImProcess L4 测试隔离铁闸', () => {
  it('测试环境 + 无注入 + 无显式放行 → 拒绝真实 spawn(blockedByTestGuard)', () => {
    assert.ok(process.env.NODE_TEST_CONTEXT, '前提:node:test 进程必带 NODE_TEST_CONTEXT');
    const saved = process.env.CCV_TEST_ALLOW_IM_SPAWN;
    delete process.env.CCV_TEST_ALLOW_IM_SPAWN;
    try {
      const r = spawnImProcess('dingtalk');
      assert.equal(r.blockedByTestGuard, true, '必须被铁闸拦截');
      assert.equal(r.pid, undefined, '绝不允许产生真实 pid');
      assert.ok(typeof r.dir === 'string' && r.dir.length > 0, '仍返回 dir 形状供调用方容错');
    } finally {
      if (saved !== undefined) process.env.CCV_TEST_ALLOW_IM_SPAWN = saved;
    }
  });

  it('注入 spawnImpl 的纯单测不受影响(假 spawn 正常走通)', () => {
    const calls = [];
    const fakeSpawn = (bin, args, opts) => {
      calls.push({ bin, args, detached: opts.detached });
      return { pid: 4242, unref() {} };
    };
    const r = spawnImProcess('dingtalk', { spawnImpl: fakeSpawn });
    assert.equal(r.pid, 4242);
    assert.equal(r.blockedByTestGuard, undefined);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].args.includes('--im'), '假 spawn 收到 --im 参数');
  });

  it('显式 CCV_TEST_ALLOW_IM_SPAWN=1 放行(集成测试逃生门,仍用假 spawn 验证只验放行逻辑)', () => {
    const saved = process.env.CCV_TEST_ALLOW_IM_SPAWN;
    process.env.CCV_TEST_ALLOW_IM_SPAWN = '1';
    try {
      const r = spawnImProcess('dingtalk', { spawnImpl: () => ({ pid: 777, unref() {} }) });
      assert.equal(r.pid, 777);
      assert.equal(r.blockedByTestGuard, undefined);
    } finally {
      if (saved === undefined) delete process.env.CCV_TEST_ALLOW_IM_SPAWN;
      else process.env.CCV_TEST_ALLOW_IM_SPAWN = saved;
    }
  });
});
