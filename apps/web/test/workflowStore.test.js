/**
 * workflowStore 单元测试：发布订阅 + 权威完成快照锁定（忽略乱序尾随的 live 帧）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { publish, subscribe, getLatest, subscribeActive, getActiveWorkflows } = await import('../src/utils/workflowStore.js');

describe('workflowStore', () => {
  it('按 runId 与 taskId 双键分发', () => {
    const got = [];
    const off = subscribe('wf_k1', d => got.push(d.totalTokens));
    publish({ runId: 'wf_k1', taskId: 't1', data: { runId: 'wf_k1', taskId: 't1', totalTokens: 10, live: true } });
    assert.deepEqual(got, [10]);
    // 用 taskId 订阅也能收到同一次 publish 的缓存
    assert.equal(getLatest('t1').totalTokens, 10);
    off();
  });

  it('权威完成快照(live!==true)后，忽略尾随 live 帧', () => {
    const seen = [];
    const off = subscribe('wf_k2', d => seen.push([d.status, d.live === true]));
    publish({ runId: 'wf_k2', data: { runId: 'wf_k2', status: 'running', totalTokens: 5, live: true } });
    publish({ runId: 'wf_k2', data: { runId: 'wf_k2', status: 'completed', totalTokens: 9, live: false } });
    publish({ runId: 'wf_k2', data: { runId: 'wf_k2', status: 'running', totalTokens: 99, live: true } }); // 乱序尾随 → 应被忽略
    assert.deepEqual(seen, [['running', true], ['completed', false]]);
    assert.equal(getLatest('wf_k2').status, 'completed');
    off();
  });

  it('退订后不再收到', () => {
    let n = 0;
    const off = subscribe('wf_k3', () => n++);
    publish({ runId: 'wf_k3', data: { runId: 'wf_k3', live: true } });
    off();
    publish({ runId: 'wf_k3', data: { runId: 'wf_k3', live: true } });
    assert.equal(n, 1);
  });

  it('活跃集合：运行中加入，完成后移除', () => {
    const seen = [];
    const off = subscribeActive(list => seen.push(list.map(d => d.runId)));
    publish({ runId: 'wf_act1', data: { runId: 'wf_act1', status: 'running', live: true } });
    assert.ok(getActiveWorkflows().some(d => d.runId === 'wf_act1'));
    publish({ runId: 'wf_act1', data: { runId: 'wf_act1', status: 'completed', live: false } });
    assert.ok(!getActiveWorkflows().some(d => d.runId === 'wf_act1'));
    off();
    // 至少发生过「加入」和「移除」两次广播
    assert.ok(seen.length >= 2);
  });

  it('活跃集合：finishing 视为活跃', () => {
    publish({ runId: 'wf_act2', data: { runId: 'wf_act2', status: 'finishing', live: true } });
    assert.ok(getActiveWorkflows().some(d => d.runId === 'wf_act2'));
    publish({ runId: 'wf_act2', data: { runId: 'wf_act2', status: 'completed', live: false } });
    assert.ok(!getActiveWorkflows().some(d => d.runId === 'wf_act2'));
  });
});
