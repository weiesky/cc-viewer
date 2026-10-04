/**
 * 连接代际（_sseGen）守卫契约测试 —— 多项目 SSE 串扰修复（2026-10）。
 *
 * 背景：initSSE() 过去不关闭旧 EventSource 就覆盖引用，旧连接保持服务端项目
 * 作用域继续收 live feed，handler 绑在同一组件 this 上把旧项目的 entry 写进
 * 新项目正在渲染的共享 state（串扰）。修复 = ①initSSE 顶部统一 close 旧连接
 * ②每次 initSSE _sseGen 自增，所有 listener 首行 stale() 早退。
 *
 * AppBase 是 React class（依赖 antd/CSS modules），无法 node:test 直接 import；
 * 按 cold-ingest-gate.test.js 先例，用「镜像状态机 + 源码锚点断言」做契约测试。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const APPBASE_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/AppBase.jsx'), 'utf8');

/** 镜像 AppBase 的连接代际状态机：initSSE 顶部 close 旧连接 + gen 自增；
 *  listener 捕获 gen，stale() 不等即丢。 */
function mkSseHost() {
  return {
    eventSource: null,
    _sseGen: 0,
    closeCalls: 0,
    writes: [], // 提交进“共享 state”的事件（泄漏即这里有脏数据）

    // 镜像 initSSE 顶部（close 旧连接 + gen 自增）
    initSSE() {
      if (this.eventSource) { this.closeCalls++; this.eventSource = null; }
      const gen = (this._sseGen = (this._sseGen || 0) + 1);
      const stale = () => gen !== this._sseGen;
      // 新连接：返回一个可派发事件的假 EventSource，listener 带 stale 守卫
      const listeners = {};
      this.eventSource = {
        gen,
        addEventListener(name, fn) { (listeners[name] ??= []).push(fn); },
        close() { /* idempotent */ },
        // 派发一个事件（模拟迟到的旧连接帧）
        emit(name, payload) {
          for (const fn of listeners[name] || []) {
            if (stale()) return; // ← gen 守卫：superseded 连接事件一律丢弃
            fn(payload);
          }
        },
      };
      // 注册一个会写共享 state 的 handler（镜像 onmessage → handleEventMessage）
      const onEntry = (entry) => { this.writes.push(entry); };
      this.eventSource.addEventListener('entry', onEntry);
      return this.eventSource;
    },
  };
}

describe('SSE 连接代际守卫（串扰止血）', () => {
  it('initSSE 先关闭旧连接再建新连接', () => {
    const h = mkSseHost();
    h.initSSE();
    assert.equal(h.closeCalls, 0, '首个连接无需关闭');
    h.initSSE();
    assert.equal(h.closeCalls, 1, '第二次 initSSE 关闭了上一个连接');
    h.initSSE();
    assert.equal(h.closeCalls, 2, '每次 initSSE 都关闭旧连接');
  });

  it('superseded 连接的迟到事件被 gen 守卫丢弃，不写共享 state', () => {
    const h = mkSseHost();
    const connA = h.initSSE(); // 项目 A 的连接
    connA.emit('entry', { project: 'A', n: 1 });
    assert.deepEqual(h.writes.map(w => w.n), [1], 'A 在自己是当前连接时正常写入');

    const connB = h.initSSE(); // 切到项目 B → A 被 supersede
    connA.emit('entry', { project: 'A', n: 2 }); // A 的迟到帧
    connB.emit('entry', { project: 'B', n: 3 }); // B 的正常帧
    assert.deepEqual(h.writes.map(w => w.n), [1, 3], 'A 的迟到帧被丢弃，只有 B 写入');
    assert.ok(!h.writes.some(w => w.project === 'A' && w.n === 2), 'A 的迟到帧绝不泄漏进 B 视图');
  });

  it('快速来回切换：中间代际的帧全部失效', () => {
    const h = mkSseHost();
    const c1 = h.initSSE();
    const c2 = h.initSSE();
    const c3 = h.initSSE(); // 当前连接
    c1.emit('entry', { n: 'c1' });
    c2.emit('entry', { n: 'c2' });
    c3.emit('entry', { n: 'c3' });
    assert.deepEqual(h.writes.map(w => w.n), ['c3']);
  });
});

describe('AppBase.jsx 源码锚点（防未来重构漂移）', () => {
  it('initSSE 顶部先 close 旧 eventSource 再 gen 自增', () => {
    const closeIdx = APPBASE_SRC.indexOf('if (this.eventSource) { try { this.eventSource.close();');
    const genIdx = APPBASE_SRC.indexOf('const gen = (this._sseGen = (this._sseGen || 0) + 1);');
    assert.ok(closeIdx > 0, '缺少 initSSE 顶部的旧连接 close');
    assert.ok(genIdx > closeIdx, 'gen 自增必须在 close 之后');
    assert.ok(APPBASE_SRC.includes('const stale = () => gen !== this._sseGen;'), '缺少 stale() 守卫定义');
  });

  it('所有主要 SSE listener 首行都有 stale() 守卫', () => {
    // 必须挂守卫的 listener（串扰写共享 state 的全部入口）
    const mustGuard = [
      'stream-progress', 'migrate_prompt', 'update_major_available', 'resume_bypassed',
      'load_start', 'load_chunk', 'sid-not-found', 'load_end', 'full_reload',
      'workspace_started', 'workspace_stopped', 'context_window', 'kv_cache_content',
      'workflow_update', 'task_update', 'proxy_profile', 'retry_config', 'ping',
      'server_config', 'v2_requests', 'v2_requests_delta', 'v3_conv', 'v3_resp',
      'session_pin', 'turn_end', 'im_log_update', 'streaming_status',
    ];
    for (const name of mustGuard) {
      // Guard lives in the listener head, allowing for a doc comment or the
      // arrow preamble in between (turn_end carries a 4-line comment).
      const re = new RegExp(`addEventListener\\('${name}'[\\s\\S]{0,400}?stale\\(\\)`);
      assert.ok(re.test(APPBASE_SRC), `listener '${name}' 缺少 stale() 守卫`);
    }
  });

  it('onmessage / onopen 也挂 stale() 守卫', () => {
    assert.ok(/onmessage = \(event\) => \{ if \(stale\(\)\) return;/.test(APPBASE_SRC), 'onmessage 缺 stale 守卫');
    assert.ok(/onopen = \(\) => \{\s*if \(stale\(\)\) return;/.test(APPBASE_SRC), 'onopen 缺 stale 守卫');
  });
});
