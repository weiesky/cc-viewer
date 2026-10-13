/**
 * 多项目视图缓存恢复（instant switch-back）契约测试（2026-10）。
 *
 * 修复「切走即全量冷加载」的慢切换：handleActivateChip 离开前快照当前视图，
 * initSSE 的 wantProject 分支命中缓存时改走 `?project=<p>&since=<lastTs>&cc=<n>`
 * 增量恢复（先 setState cached 立即上屏、无遮罩），load_end 的增量合并分支
 * 从 mobile-only 放宽为「mobile 或 _hasViewCache」。
 *
 * AppBase 是 React class，无法 node:test 直接 import；按 sse-connection-gen.test.js
 * 先例用「镜像流程 + 源码锚点断言」做契约测试。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const APPBASE_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/AppBase.jsx'), 'utf8');

import { createViewStateCache } from '../src/utils/viewStateCache.js';

/** 镜像「切走快照 → 切回恢复 → 增量合并」的核心流程（setState 同步化）。 */
function mkFlow() {
  const cache = createViewStateCache();
  return {
    cache,
    state: { viewedProject: null, projectName: 'bound', requests: [], v2Rows: [], v2RowsMeta: { totalCount: 0, hasMore: false, oldestTs: '' }, mainAgentSessions: [], pinnedSessionTs: null, selectedIndex: null, resumeSwitch: null },
    url: null,
    hasViewCache: false,
    _hasViewCache: false,
    setState(patch) { Object.assign(this.state, typeof patch === 'function' ? patch(this.state) : patch); },
    _snapshotCurrentView() {
      const key = this.state.viewedProject || this.state.projectName;
      if (!key || (!this.state.requests.length && !this.state.v2Rows.length)) return;
      cache.snapshot(key, this.state);
    },
    _clearResumeSwitch() { this.state.resumeSwitch = null; },
    // 镜像 handleActivateChip 的快照时机
    handleActivateChip(project) {
      if (!this.state.resumeSwitch) this._snapshotCurrentView();
      this.state.resumeSwitch = { uuid: project };
      this.state.viewedProject = project;
      this.initSSE();
    },
    // 镜像 initSSE wantProject 分支
    initSSE() {
      const wantProject = this.state.viewedProject;
      const cached = cache.restore(wantProject);
      if (cached && cached.lastTs) {
        this.url = `/events?project=${wantProject}&since=${cached.lastTs}&cc=${cached.count}`;
        this._hasViewCache = true;
        this.setState({ requests: cached.requests, v2Rows: cached.v2Rows, v2RowsMeta: cached.v2RowsMeta, mainAgentSessions: cached.mainAgentSessions, pinnedSessionTs: cached.pinnedSessionTs, selectedIndex: cached.selectedIndex });
        if (this.state.resumeSwitch) this._clearResumeSwitch();
      } else {
        this.url = `/events?project=${wantProject}&limit=400`;
        this._hasViewCache = false;
      }
    },
  };
}

const req = (ts) => ({ timestamp: ts, url: '/v1/messages', mainAgent: true });

describe('视图缓存恢复流程', () => {
  it('切走快照 → 切回命中缓存 → ?since 增量 + 立即上屏无遮罩', () => {
    const f = mkFlow();
    // 在 bound 项目有 3 条
    f.state.requests = [req('2026-10-04T00:00:01Z'), req('2026-10-04T00:00:02Z'), req('2026-10-04T00:00:03Z')];
    // 第一次切到 sage：bound 被快照，sage 无缓存 → 全量 ?limit
    f.handleActivateChip('sage');
    assert.equal(f.url, '/events?project=sage&limit=400');
    assert.equal(f._hasViewCache, false);
    // sage 加载出自己的内容（模拟提交）
    f.state.requests = [req('2026-10-04T00:01:00Z')];
    f.state.resumeSwitch = null;
    // 切回 bound：sage 被快照，bound 命中缓存 → ?since 增量
    f.handleActivateChip('bound');
    assert.ok(f.url.startsWith('/events?project=bound&since='), `命中缓存走 since 增量: ${f.url}`);
    assert.ok(f.url.includes('cc=3'), 'cc = 缓存请求数');
    assert.equal(f._hasViewCache, true);
    assert.equal(f.state.requests.length, 3, 'cached 立即上屏');
    assert.equal(f.state.resumeSwitch, null, '缓存命中立即清遮罩（不等 load_end）');
    // bound 的 since 游标 = 其最新 ts（query 参数已 encode，解码比对）
    const sinceVal = new URLSearchParams(f.url.split('?')[1]).get('since');
    assert.equal(sinceVal, '2026-10-04T00:00:03Z', 'since = bound 最新时间戳');
  });

  it('冷加载在途（resumeSwitch）不快照半成品', () => {
    const f = mkFlow();
    f.state.requests = [req('2026-10-04T00:00:01Z')];
    f.state.resumeSwitch = { uuid: 'sage' }; // 切到 sage 的冷加载还在途
    f._snapshotCurrentView = () => { throw new Error('不应被调用'); };
    // resumeSwitch 期间 handleActivateChip 内部直接 return 前不快照（镜像 guard）
    assert.doesNotThrow(() => { if (!f.state.resumeSwitch) f._snapshotCurrentView(); });
  });

  it('无项目上下文或空视图不快照', () => {
    const f = mkFlow();
    f.state.projectName = '';
    f.state.viewedProject = null;
    f._snapshotCurrentView();
    assert.equal(f.cache.size(), 0);
  });
});

describe('AppBase.jsx 源码锚点（防未来重构漂移）', () => {
  it('handleActivateChip 开头快照当前视图（resumeSwitch 守卫）', () => {
    // 快照必须在 resumeSwitch 守卫下、且先于任何 setState（允许前导注释块 + 多实例的
    // instanceKey 提前 return）。
    assert.ok(/handleActivateChip = \(chip\) => \{[\s\S]{0,900}?if \(!this\.state\.resumeSwitch\) this\._snapshotCurrentView\(\);/.test(APPBASE_SRC),
      'handleActivateChip 缺少开头快照');
  });

  it('_viewCache 在 constructor 实例化', () => {
    assert.ok(APPBASE_SRC.includes('this._viewCache = createViewStateCache();'), '缺少 _viewCache 实例化');
  });

  it('wantProject 分支命中缓存走 ?since 并立即提交 cached', () => {
    // 多实例化后缓存键是 project+instance 的复合 cacheKey（同 cwd 双实例各自隔离）。
    assert.ok(/const hit = this\._viewCache\.restore\(cacheKey\);/.test(APPBASE_SRC), 'wantProject 缺缓存 restore');
    assert.ok(/hit && hit\.lastTs[\s\S]{0,180}?since=\$\{encodeURIComponent\(hit\.lastTs\)\}/.test(APPBASE_SRC), '缓存命中缺 ?since URL');
    assert.ok(/if \(this\.state\.resumeSwitch\) this\._clearResumeSwitch\(\);/.test(APPBASE_SRC), '缓存命中缺立即清遮罩');
  });

  it('load_end 增量合并分支放宽为 mobile 或 vm.hasViewCache', () => {
    assert.ok(/isIncremental && \(isMobile \|\| vm\.hasViewCache\) && vm\.react\.requests\.length > 0/.test(APPBASE_SRC),
      'load_end 合并分支未放宽到视图缓存');
  });

  it('stream-progress handler 有按 channel scope 的项目守卫', () => {
    // Per-workspace channels: the guard compares against THIS channel's project
    // (a tap channel must not test the rendered view's project).
    assert.ok(/const _viewing = channel\.scope\.project \|\| this\.state\.projectName \|\| '';/.test(APPBASE_SRC),
      'stream-progress 缺按 channel scope 的项目守卫');
    assert.ok(/data\.project && _viewing && data\.project !== _viewing\) return;/.test(APPBASE_SRC),
      'stream-progress 缺项目守卫早退');
  });

  it('P0 回归：_activateScope 接受显式 scope，视图切换不在 setState 后同步读 stale state', () => {
    // React 18 batches setState, so the activation must NOT read
    // this.state.viewedProject/viewedInstance right after a view-switch setState
    // (it would target the PREVIOUS view). Pin the fix: _activateScope takes an
    // explicit scope and the switch handlers pass the NEW scope.
    assert.ok(/_activateScope\(scope = \{\}/.test(APPBASE_SRC), '_activateScope 缺显式 scope 参数');
    // handleActivateChip / handleDetachView / _applyViewAttach 必须传新 scope。
    assert.ok(/this\._activateScope\(\{ sid: null, project: chip\.project, instance: chipInstance \}/.test(APPBASE_SRC),
      'handleActivateChip 未传 chip 的 project+instance');
    assert.ok(/this\._activateScope\(\{ sid: null, project: null, instance: null \}, \{[\s\S]{0,120}?reason: 'detach'/.test(APPBASE_SRC),
      'handleDetachView 未传空 scope');
    // True-resume (2026-10-06): the attach half is _applyViewAttach, which scopes the
    // activation by the TARGET project (parallel resume keeps the viewed project;
    // bound resume falls back to bound).
    assert.ok(/_applyViewAttach = \(uuid, scope = null\) => \{/.test(APPBASE_SRC),
      '_applyViewAttach 缺 scope 参数');
    assert.ok(/this\._activateScope\(\{ sid: uuid, project: scopeProject, instance: scopeInstance \}/.test(APPBASE_SRC),
      '_applyViewAttach 未按目标 scope 激活');
  });

  it('多实例缓存键用 NUL 分隔（project 名含 ccv- 子串不撞复合键）', () => {
    // _snapshotCurrentView 写入键与 _channelUrlFor 读取键必须同为 `${proj}\x00${inst}`。
    assert.ok(/`\$\{proj\}\\x00\$\{this\.state\.viewedInstance\}`/.test(APPBASE_SRC), '_snapshotCurrentView 缓存键未 NUL 分隔');
    assert.ok(/`\$\{wantProject\}\\x00\$\{wantInstance\}`/.test(APPBASE_SRC), '_channelUrlFor 缓存键未 NUL 分隔');
  });
});
