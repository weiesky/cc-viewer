/**
 * 连接代际守卫契约测试 —— 多项目 SSE 串扰止血（2026-10，per-workspace channels 改版）。
 *
 * 背景：旧实现是单条 EventSource，initSSE() 过去不关闭旧连接就覆盖引用，旧连接
 * 保持服务端项目作用域继续收 live feed，handler 绑在同一组件 this 上把旧项目的
 * entry 写进新项目正在渲染的共享 state（串扰）。修复 = ①每次重连先 close 旧连接
 * ②代际 gen 自增，所有 listener 首行 stale() 早退。
 *
 * 2026-10 重构后这套语义由 utils/sseChannels.js 的 channel manager 承载：每个
 * scope 一条常驻连接、每 channel 独立 gen / stale()，AppBase 只负责把帧按 channel
 * 分发（_bindChannelEvents 全用 stale() 包裹）。本测试因此直接实例化**真实**的
 * createChannelManager（可 node:test 直接 import）验证代际契约，再用源码锚点钉住
 * AppBase 侧的分发接线不漂移。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createChannelManager } from '../src/utils/sseChannels.js';

const APPBASE_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/AppBase.jsx'), 'utf8');
const MANAGER_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/utils/sseChannels.js'), 'utf8');

/** Fake EventSource factory that records every socket + its listeners. */
function mkHost() {
  const instances = [];
  const frames = []; // frames delivered through the manager's guards
  const timers = new Map();
  let tid = 1;
  const factory = (url) => {
    const es = {
      url,
      closed: false,
      listeners: {},
      onmessage: null,
      onopen: null,
      onerror: null,
      addEventListener(name, fn) { (es.listeners[name] ||= []).push(fn); },
      close() { this.closed = true; },
    };
    instances.push(es);
    return es;
  };
  const manager = createChannelManager({
    openEventSource: factory,
    setTimeout: (fn, ms) => { const id = tid++; timers.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    backoff: () => 0,
    handlers: {
      onFrame: (ch, name, event) => frames.push({ key: ch.key, name, data: event.data }),
      onBind: (ch, es, stale) => {
        for (const name of ['turn_active', 'load_end']) {
          es.addEventListener(name, (event) => { if (stale()) return; frames.push({ key: ch.key, name, data: event.data }); });
        }
      },
    },
  });
  const fireAll = () => { for (const id of [...timers.keys()]) { const t = timers.get(id); timers.delete(id); t.fn(); } };
  return { manager, instances, frames, fireAll };
}

describe('channel 代际守卫（真实 manager）', () => {
  it('reconnect 先关闭旧 socket 再建新连接（gen 自增）', () => {
    const h = mkHost();
    h.manager.ensure('bound', { url: '/events?limit=400' });
    const g0 = h.manager.genOf('bound');
    assert.equal(h.instances.length, 1);
    h.manager.reconnect('bound');
    h.fireAll();
    assert.equal(h.instances[0].closed, true, '旧 socket 被关闭');
    assert.equal(h.instances.length, 2, '新 socket 已建立');
    assert.ok(h.manager.genOf('bound') > g0, 'gen 自增');
  });

  it('superseded 连接的迟到帧被 gen 守卫丢弃（onmessage 与命名帧都算）', () => {
    const h = mkHost();
    h.manager.ensure('bound', { url: '/events' });
    const connA = h.instances[0];
    connA.onmessage({ data: 'A1' });
    connA.listeners['turn_active'][0]({ data: 'A-turn' });
    assert.deepEqual(h.frames.map(f => f.data), ['A1', 'A-turn'], '当前连接的帧正常投递');

    h.manager.reconnect('bound'); // supersede A
    h.fireAll();
    const connB = h.instances[1];
    connA.onmessage({ data: 'A2' });                  // A 的迟到数据帧
    connA.listeners['load_end'][0]({ data: 'A-end' }); // A 的迟到命名帧
    connB.onmessage({ data: 'B1' });                  // B 的正常帧
    assert.deepEqual(h.frames.map(f => f.data), ['A1', 'A-turn', 'B1'],
      'A 的迟到帧全部被丢弃，只有 B 写入');
  });

  it('channel 隔离：一个 channel 重连不影响另一个 channel 的 gen/帧', () => {
    const h = mkHost();
    h.manager.ensure('bound', { url: '/e1' });
    h.manager.ensure('project:alpha', { url: '/e2' });
    const gAlpha = h.manager.genOf('project:alpha');
    h.manager.reconnect('bound');
    h.fireAll();
    assert.equal(h.manager.genOf('project:alpha'), gAlpha, 'alpha 的 gen 不动');
    const alphaES = h.instances[1];
    alphaES.onmessage({ data: 'alpha-live' });
    assert.deepEqual(h.frames.map(f => f.data), ['alpha-live'], 'alpha 的帧照常投递');
  });
});

describe('AppBase.jsx 源码锚点（防未来重构漂移）', () => {
  it('onmessage / onopen 代际守卫在 manager 内（单点）', () => {
    assert.ok(MANAGER_SRC.includes('const stale = () => gen !== ch.gen || ch.closed;'), '缺少 stale() 守卫定义');
    assert.ok(/es\.onmessage = \(event\) => \{\s*if \(stale\(\)\) return;/.test(MANAGER_SRC), 'onmessage 缺 stale 守卫');
    assert.ok(/es\.onopen = \(\) => \{\s*if \(stale\(\)\) return;/.test(MANAGER_SRC), 'onopen 缺 stale 守卫');
  });

  it('AppBase 的命名帧绑定全部经 stale() 守卫 + 心跳续期', () => {
    const re = /_bindChannelEvents\(channel, es, stale\) \{[\s\S]{0,400}?es\.addEventListener\(name, \(event\) => \{[\s\S]{0,140}?if \(stale\(\)\) return;[\s\S]{0,140}?this\._touchChannel\(channel\);[\s\S]{0,140}?this\._onChannelFrame\(channel, name, event\);/;
    assert.ok(re.test(APPBASE_SRC), '命名帧绑定缺 stale() 守卫 / 心跳续期 / channel 分发');
  });

  it('帧处理器表覆盖全部命名帧，且每个名字都有对应的 channel-aware 方法', () => {
    const tableMatch = APPBASE_SRC.match(/const CHANNEL_FRAME_HANDLERS = \{([\s\S]*?)\n\};/);
    assert.ok(tableMatch, '缺少 CHANNEL_FRAME_HANDLERS 表');
    const entries = [...tableMatch[1].matchAll(/'([\w-]+)':\s*'(\w+)'/g)].map((m) => [m[1], m[2]]);
    // 必须挂 stale 守卫的命名帧（串扰写视图态的全部入口）。
    const mustGuard = [
      'stream-progress', 'migrate_prompt', 'update_major_available', 'resume_bypassed',
      'load_start', 'load_chunk', 'sid-not-found', 'load_end', 'full_reload',
      'workspace_started', 'workspace_stopped', 'context_window', 'kv_cache_content',
      'workflow_update', 'task_update', 'proxy_profile', 'retry_config', 'ping',
      'server_config', 'v2_requests', 'v2_requests_delta', 'v3_conv', 'v3_resp',
      'session_pin', 'scheduled_tasks', 'turn_end', 'turn_active', 'im_log_update', 'streaming_status',
    ];
    const names = entries.map(([n]) => n);
    for (const name of mustGuard) {
      assert.ok(names.includes(name), `帧处理器表缺 '${name}'`);
    }
    for (const [name, method] of entries) {
      const def = new RegExp(`\\n  ${method}\\((?:channel(?:, event)?)?\\) \\{`);
      assert.ok(def.test(APPBASE_SRC), `帧 '${name}' 的方法 ${method}(channel, event) 未定义`);
    }
  });

  it('data: 帧也按 channel 分发（rendered 走管线，tap 入 journal）', () => {
    const re = /_onChannelMessage\(channel, event\) \{[\s\S]{0,400}?this\._deliverChannelEntry\(channel, entry\);/;
    assert.ok(re.test(APPBASE_SRC), 'data: 帧未经 _deliverChannelEntry 按 channel 分发');
    const re2 = /_deliverChannelEntry\(channel, entry\) \{[\s\S]{0,300}?this\._isRenderedChannel\(channel\)\) this\._ingestLiveEntry\(entry\);[\s\S]{0,120}?appendJournal\(channel\.vm, entry\);/;
    assert.ok(re2.test(APPBASE_SRC), '_deliverChannelEntry 未区分 rendered(管线) / tap(journal)');
  });
});
