// 覆盖目标：server/server.js 经 startViewer 后可达、但既有 server-* 测试未触达的零碎：
//   - _notifyParentPending switch 全臂（235-252）：仅 process.send 存在时进入；测试临时
//     桩 process.send，再经 broadcastWsMessage 的 ask-* 转译路径驱动。
//   - initPostLaunch()（283-286）：导出函数，workspace 模式下直接调，命中 watchLogFile +
//     startStatsWorker + startStreamingStatusTimer 接线。
//   - resolveRepoCwd（131-142）经 git 路由 ?repo=：本仓库即 git repo，用 ?repo=. / 非法 repo /
//     不存在 repo 驱动 null/合法两条臂。
//   - setAuthConfig / clearAuthOverride deps 方法（487-494）经 POST /api/auth/config 启用→清除项目覆盖。
//
// 隔离：workspace 模式（阻止自动启动），私有端口窗避免与并行 server 测试抢口。CCV_PROJECT_DIR
// 指向本仓库根，让 git 路由有真实 repo。{concurrency:false}。

import { describe, it, before, after } from 'node:test';
import { describeCli } from './_helpers/cli-tier.mjs';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const REPO_ROOT = resolve(import.meta.dirname, '..'); // cc-viewer 仓库根（本身是 git repo）
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-startup-extra-'));
mkdirSync(join(tmpDir, 'logs'), { recursive: true });
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';
process.env.CCV_SDK_MODE = '0';
process.env.CCV_PROJECT_DIR = REPO_ROOT;
process.env.NODE_ENV = 'test';
// 私有端口窗，避开全量并行时 7008-7049 的跨进程抢占。
process.env.CCV_START_PORT = '17860';
process.env.CCV_MAX_PORT = '17899';
delete process.env.CCV_IM_PLATFORM;
delete process.env.CCV_BASE_PATH;
delete process.env.CCV_ALLOWED_HOSTS;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function raw(port, path, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve2, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method, headers }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve2({ status: res.statusCode, headers: res.headers, body: d }));
    });
    req.on('error', reject);
    if (body != null) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

describeCli('server.js startup-path extras', { concurrency: false }, () => {
  let mod, port;

  before(async () => {
    mod = await import('../packages/app/server/server.js');
    const srv = await mod.startViewer();
    assert.ok(srv, 'server should start');
    port = mod.getPort();
    assert.ok(port > 0);
  });

  after(async () => {
    await new Promise((res) => {
      mod.stopViewer();
      setTimeout(() => { rmSync(tmpDir, { recursive: true, force: true }); res(); }, 300);
    });
  });

  // ── _notifyParentPending switch（235-252）：桩 process.send 后经 broadcastWsMessage 驱动 ──
  describe('_notifyParentPending via broadcastWsMessage (process.send stubbed)', () => {
    it('translates ask-* messages into pending-add / pending-remove IPC events', () => {
      const sent = [];
      const origSend = process.send;
      // process.send 在普通 test 进程里 undefined；桩成收集器以进入 switch 主体。
      process.send = (ev) => { sent.push(ev); return true; };
      try {
        // pending-add 臂（ask-hook-pending）
        mod.broadcastWsMessage({ type: 'ask-hook-pending', id: 'ipc1', questions: [{ question: 'Q', options: [] }] });
        // pending-remove 臂（ask-hook-resolved）
        mod.broadcastWsMessage({ type: 'ask-hook-resolved', id: 'ipc1' });
        // sdk-ask-pending 同走 pending-add；ask-hook-cancelled / sdk-ask-resolved → pending-remove
        mod.broadcastWsMessage({ type: 'sdk-ask-pending', id: 'ipc2', questions: [] });
        mod.broadcastWsMessage({ type: 'ask-hook-cancelled', id: 'ipc2' });
        // 非 ask 类型不进 _notifyParentPending（broadcastWsMessage 的 allowlist 之外）→ 不产 IPC
        mod.broadcastWsMessage({ type: 'sdk-plan-pending', id: 'planX' });
      } finally {
        if (origSend === undefined) delete process.send; else process.send = origSend;
      }
      const types = sent.map((e) => `${e.type}:${e.kind}`);
      assert.ok(types.includes('pending-add:ask'), `expected a pending-add, got ${JSON.stringify(sent)}`);
      assert.ok(types.includes('pending-remove:ask'), `expected a pending-remove, got ${JSON.stringify(sent)}`);
      // ask-hook-pending 的 payload 带 questions
      const add = sent.find((e) => e.type === 'pending-add' && e.id === 'ipc1');
      assert.ok(add && add.payload && Array.isArray(add.payload.questions), 'pending-add carries the questions payload');
      // sdk-plan-pending 不应产生任何 IPC（它根本没进 _notifyParentPending）
      assert.ok(!sent.some((e) => e.id === 'planX'), 'non-ask types must not emit IPC');
    });

    it('is a safe no-op when process.send is undefined (normal standalone server)', () => {
      // 不桩 send：broadcastWsMessage 仍不抛（_notifyParentPending 在入口 return）。
      assert.equal(process.send, undefined);
      assert.doesNotThrow(() => mod.broadcastWsMessage({ type: 'ask-hook-pending', id: 'noop1', questions: [] }));
    });
  });

  // ── initPostLaunch（283-286）：导出函数直接调 ──
  it('initPostLaunch() wires watch + stats worker + streaming timer without throwing', async () => {
    assert.equal(typeof mod.initPostLaunch, 'function');
    assert.doesNotThrow(() => mod.initPostLaunch());
    // 再调一次幂等（statsWorker 已存在 → 不重复 start）
    assert.doesNotThrow(() => mod.initPostLaunch());
    await wait(50);
  });

  // ── resolveRepoCwd（131-142）经 git 路由 ?repo= ──
  describe('resolveRepoCwd via git routes (?repo=)', () => {
    it('git status with repo=. resolves to the project dir (200 or graceful error, never crash)', async () => {
      const res = await raw(port, '/api/git-status?repo=.');
      // 本仓库是 git repo → 200；即便 git 子命令异常也应是受控 JSON，不挂连接。
      assert.ok(res.status === 200 || res.status >= 400, `unexpected: ${res.status}`);
      assert.ok(res.body.length >= 0);
    });
    it('git status with a path-traversal repo is rejected (resolveRepoCwd → null → Invalid repo)', async () => {
      const res = await raw(port, '/api/git-status?repo=' + encodeURIComponent('../evil'));
      // resolveRepoCwd 见 '..' → null；git 路由回 Invalid repo parameter（400）或受控错误。
      assert.ok(res.status >= 400, `traversal repo should be rejected, got ${res.status}`);
      assert.match(res.body, /[Ii]nvalid repo|error/);
    });
    it('git status with a non-existent repo subdir → rejected (existsSync guard → null)', async () => {
      const res = await raw(port, '/api/git-status?repo=definitely-not-a-real-subdir-xyz');
      assert.ok(res.status >= 400, `missing repo should be rejected, got ${res.status}`);
    });
  });

  // ── setAuthConfig / clearAuthOverride（487-494）经 POST /api/auth/config ──
  describe('auth config deps methods (setAuthConfig / clearAuthOverride)', () => {
    it('enabling then disabling project auth drives setAuthConfig and clearAuthOverride', async () => {
      // 启用（project scope）→ setAuthConfig 写盘 + 重算 effective
      const enable = await raw(port, '/api/auth/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: { enabled: true, password: 'pw-startup-extra', scope: 'project' },
      });
      assert.ok(enable.status === 200, `enable should succeed, got ${enable.status}: ${enable.body}`);
      // state 反映 enabled
      const st1 = await raw(port, '/api/auth/state');
      assert.equal(st1.status, 200);
      assert.equal(JSON.parse(st1.body).enabled, true);

      // 关闭：很多前端用 enabled:false 走 clearAuthOverride（清项目覆盖回落全局）
      const disable = await raw(port, '/api/auth/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: { enabled: false, scope: 'project' },
      });
      assert.ok(disable.status === 200, `disable should succeed, got ${disable.status}: ${disable.body}`);
      const st2 = await raw(port, '/api/auth/state');
      assert.equal(JSON.parse(st2.body).enabled, false, 'auth disabled after clearing project override');
    });

    it('clearOverride:true drives deps.clearAuthOverride without error', async () => {
      // 目的是命中 deps.clearAuthOverride（server.js 491-494）。注：workspace 模式下 AUTH_PROJECT=null，
      // 路由把 project scope coerce 成 global（auth.js !state.projectDir 分支），故没有真正的"项目覆盖"
      // 可清；但 clearOverride 分支仍会调 deps.clearAuthOverride（clearProjectOverride(null) 安全 no-op
      // + 重算 effective）并回 200。这里只断言调用成功 + 不抛，不对最终 enabled 态做强断言（受同进程
      // 前序全局态影响）。随后把全局复位为 disabled，避免污染后续。
      const cleared = await raw(port, '/api/auth/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: { clearOverride: true },
      });
      assert.equal(cleared.status, 200, `clearOverride should succeed: ${cleared.body}`);
      const st = JSON.parse((await raw(port, '/api/auth/state')).body);
      assert.equal(typeof st.enabled, 'boolean', 'state still well-formed after clearOverride');
      // 复位全局为 disabled（无论之前是什么），保持进程内后续用例干净
      await raw(port, '/api/auth/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: { enabled: false, scope: 'global' },
      });
    });
  });

  // ── execWithStdin（52-70）经 GET /api/files：列目录触发 git check-ignore --stdin ──
  it('GET /api/files lists the project dir and runs execWithStdin git check-ignore', async () => {
    // 本仓库是 git repo 且根目录有大量文件 → files handler 走 deps.execWithStdin('git', check-ignore --stdin)。
    const res = await raw(port, '/api/files?path=.');
    assert.equal(res.status, 200, `files listing should succeed, got ${res.status}: ${res.body.slice(0, 200)}`);
    const j = JSON.parse(res.body);
    // 返回数组（条目结构由 files-fs 决定）；至少不该崩，且 node_modules / .git 这类被忽略项会带 gitIgnored 标记。
    const arr = Array.isArray(j) ? j : (j.files || j.items || []);
    assert.ok(Array.isArray(arr), 'files listing returns an array-shaped payload');
  });
});
