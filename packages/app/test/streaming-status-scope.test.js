/**
 * streaming_status 多项目过滤契约（2026-10）—— server.js:2588 把
 * streamingState（全局单例、仅跟踪绑定项目主进程）的广播从「全量 clients」
 * 改为「只发 viewing 绑定项目的客户端」（跨项目 spinner 串扰修复）。
 *
 * server.js 的定时器无法直接实例化测试；本文件锁两件事：
 *   1. 过滤语义：view-router.filterClientsByViewProject 对「绑定项目事件」
 *      在 stamped/unstamped 混合客户端集合上的路由正确性（直接调纯函数）；
 *   2. 源码锚点：server.js 的 streaming_status 广播确实经 _filterClientsByViewProject
 *      且以绑定项目为目标（house 先例：sse-connection-gen.test.js 的源码契约范式）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { filterClientsByViewProject } from '../server/lib/v2/view-router.js';

const SERVER_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../server/server.js'), 'utf8');

const client = (view) => ({ _ccvViewProject: view });

describe('streaming_status 绑定项目过滤语义', () => {
  it('只保留 viewing 绑定项目的客户端；foreign 视图客户端被剔除', () => {
    const clients = [client('boundProj'), client('projA'), client('sage')];
    const out = filterClientsByViewProject(clients, 'boundProj', 'boundProj');
    assert.deepEqual(out.map((c) => c._ccvViewProject), ['boundProj'], '只有绑定项目 viewer 收到 spinner');
  });

  it('unstamped（旧单项目）客户端默认 viewing 绑定项目，继续收到（legacy parity）', () => {
    const legacy = { /* no stamp */ };
    const out = filterClientsByViewProject([legacy, client('projA')], 'boundProj', 'boundProj');
    assert.deepEqual(out, [legacy], 'unstamped 默认绑定项目；foreign 被剔除');
  });

  it('无 foreign 时走 fast-path 返回原数组引用（单项目零开销）', () => {
    const clients = [client('boundProj'), {}];
    const out = filterClientsByViewProject(clients, 'boundProj', 'boundProj');
    assert.equal(out, clients, 'fast-path 同引用');
  });

  it('绑定项目为空（workspace 未启动）时不过滤（现状 parity）', () => {
    const clients = [client('projA')];
    const out = filterClientsByViewProject(clients, '', '');
    assert.equal(out.length, 1, '空项目名不丢客户端（view-router:28 if(!project) return clientList 的 bound 变体）');
  });
});

describe('server.js streaming_status 源码锚点', () => {
  it('streaming_status 逐 scope 发送：bound 经 _filterClientsByViewProject、并行经 filterClientsByScope', () => {
    // Per-workspace (2026-10): the timer is _streamingTickOnce per scope — the
    // bound scope keeps the legacy project filter (byte-identical), a parallel
    // scope rides filterClientsByScope (project+instance).
    const tickOnce = /function _streamingTickOnce\(scopeKey\) \{[\s\S]*?sendEventToClients\(target, 'streaming_status',/;
    assert.ok(tickOnce.test(SERVER_SRC), 'streaming_status 由 _streamingTickOnce 逐 scope 发送');
    const boundFilter = /const target = sc\.project\s*\?\s*filterClientsByScope\(clients, sc\.project, sc\.instance, _projectName \|\| ''\)\s*:\s*_filterClientsByViewProject\(clients, _projectName \|\| ''\);/;
    assert.ok(boundFilter.test(SERVER_SRC), 'bound scope 走 _filterClientsByViewProject、并行 scope 走 filterClientsByScope');
    const timerIter = /_streamingTickOnce\(BOUND_SCOPE\);[\s\S]*?activeStreamingScopes\(\)[\s\S]*?_lastCliActiveByScope\.keys\(\)[\s\S]*?_streamingTickOnce\(key\)/;
    assert.ok(timerIter.test(SERVER_SRC), '定时器先 bound,再遍历活跃 scope ∪ 已记录 last-active 的 scope(覆盖 falling edge)');
  });

  it('_filterClientsByViewProject 是 filterClientsByViewProject 的绑定项目柯里化', () => {
    const re = /function _filterClientsByViewProject\(clientList, project\) \{\s*return filterClientsByViewProject\(clientList, project, _projectName \|\| ''\);/;
    assert.ok(re.test(SERVER_SRC), '_filterClientsByViewProject 绑定 _projectName');
  });

  it('legacy parity: bound scope 发送仍经 target 路由到 streaming_status', () => {
    // 只锚「经 target 发送到 streaming_status」这一行为事实；不钉 payload 形状——
    // additive 的 project/instance 是兼容策略（older clients ignore extra keys），
    // 不是字节契约，逐字钉死会与上方注释自相矛盾且对恢复零附加键的未来重构误伤。
    const payload = /sendEventToClients\(target, 'streaming_status',/;
    assert.ok(payload.test(SERVER_SRC), 'streaming_status 经 target 路由发送');
  });
});
