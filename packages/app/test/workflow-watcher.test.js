/**
 * workflow-watcher 单元测试
 *
 * 注入假 fs.watch（__setWatchImplForTests），手动触发扫描（__triggerScanForTests），
 * 验证 journal 签名变化时向 SSE clients 广播 workflow_update。规避真实 fs 事件时序。
 */
import { describe, it, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TMP = mkdtempSync(join(tmpdir(), 'ccv-wfw-'));

const { armWorkflowWatch, unwatchAllWorkflows, __setWatchImplForTests, __triggerScanForTests } =
  await import('../server/lib/workflow-watcher.js');

function fakeWatch() {
  return { close() {}, on() {} };
}

function makeClients() {
  const writes = [];
  const client = { write: (p) => { writes.push(p); return true; }, writes };
  return { clients: [client], writes };
}

function parseEvents(writes) {
  return writes
    .filter(w => w.startsWith('event: workflow_update'))
    .map(w => {
      const m = w.match(/data: (.*)\n\n$/s);
      return m ? JSON.parse(m[1]) : null;
    })
    .filter(Boolean);
}

__setWatchImplForTests(fakeWatch);

after(() => {
  unwatchAllWorkflows();
  __setWatchImplForTests(null);
  rmSync(TMP, { recursive: true, force: true });
});

afterEach(() => unwatchAllWorkflows());

function journal(runId, taskId, extra = {}) {
  return JSON.stringify({ runId, taskId, workflowName: 'w', status: 'running', phases: [], workflowProgress: [], ...extra });
}

describe('workflow-watcher', () => {
  it('arm 建立基线（不广播现存），变更后广播 workflow_update', () => {
    const wfDir = join(TMP, 's1', 'workflows');
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(join(wfDir, 'wf_a.json'), journal('wf_a', 'wtA'));

    const { clients, writes } = makeClients();
    armWorkflowWatch({ workflowsDir: wfDir, sessionId: 's1', clients });

    // 基线后立刻扫描：无变化 → 不广播
    __triggerScanForTests(wfDir);
    assert.equal(parseEvents(writes).length, 0);

    // 覆写（内容变长 → 签名变化）→ 广播
    writeFileSync(join(wfDir, 'wf_a.json'), journal('wf_a', 'wtA', { summary: 'now bigger content payload' }));
    __triggerScanForTests(wfDir);
    const evs = parseEvents(writes);
    assert.equal(evs.length, 1);
    assert.equal(evs[0].runId, 'wf_a');
    assert.equal(evs[0].sessionId, 's1');
    assert.equal(evs[0].data.workflowName, 'w');
  });

  it('新出现的 journal 文件被广播', () => {
    const wfDir = join(TMP, 's2', 'workflows');
    mkdirSync(wfDir, { recursive: true });

    const { clients, writes } = makeClients();
    armWorkflowWatch({ workflowsDir: wfDir, sessionId: 's2', clients });

    writeFileSync(join(wfDir, 'wf_b.json'), journal('wf_b', 'wtB'));
    __triggerScanForTests(wfDir);
    const evs = parseEvents(writes);
    assert.equal(evs.length, 1);
    assert.equal(evs[0].runId, 'wf_b');
  });

  it('同目录重复 arm 只刷新 clients 引用', () => {
    const wfDir = join(TMP, 's3', 'workflows');
    mkdirSync(wfDir, { recursive: true });

    const first = makeClients();
    armWorkflowWatch({ workflowsDir: wfDir, sessionId: 's3', clients: first.clients });
    const second = makeClients();
    armWorkflowWatch({ workflowsDir: wfDir, sessionId: 's3', clients: second.clients });

    writeFileSync(join(wfDir, 'wf_c.json'), journal('wf_c', 'wtC'));
    __triggerScanForTests(wfDir);
    // 广播应只走最新的 clients
    assert.equal(parseEvents(second.writes).length, 1);
    assert.equal(parseEvents(first.writes).length, 0);
  });

  it('目录不存在时不抛错', () => {
    const wfDir = join(TMP, 'nope', 'workflows');
    const { clients } = makeClients();
    assert.doesNotThrow(() => armWorkflowWatch({ workflowsDir: wfDir, sessionId: 'sx', clients }));
  });

  it('缺参数 → 返回 null', () => {
    assert.equal(armWorkflowWatch({}), null);
    assert.equal(armWorkflowWatch({ workflowsDir: '/x' }), null);
  });
});
