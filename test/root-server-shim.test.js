/**
 * 根 server.js shim（5 行 `export * from './server/server.js'`）的执行覆盖。
 *
 * 既有 test/root-shim.test.js 用【静态 grep】比对 export 形状，从不真正 import 根
 * server.js，故 c8 对这 5 行报 0%。本文件【真 import】根 shim 跑出执行覆盖，并断言
 * re-export 形状与 server/server.js 完全一致（防止有人把 `export *` 改成漏导出的形式）。
 *
 * 安全性确认（已读 5 行源码 + 实测）：根 server.js 仅 `export *` 转发；
 * server/server.js 顶层不自启服务（startViewer 是函数，需显式调用），只注册
 * process 信号 handler（globalThis 守卫单次）并 import 几个 side-effect adapter。
 * 因此 import 不会拉起监听端口、不会阻塞事件循环；本套件不调用 startViewer。
 *
 * 进程卫生：本测试不 spawn 任何子进程；--test-force-exit 兜底 import 图里可能残留的
 * 句柄（信号 handler 不阻止退出）。不触网、不开端口。
 *
 * 隔离：import server/server.js 会读 preferences/config，预先把 CCV_LOG_DIR /
 * CLAUDE_CONFIG_DIR 指向临时目录，避免写到真实用户配置。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-root-server-shim-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

describe('root server.js shim re-export', () => {
  let rootMod;
  let realMod;

  before(async () => {
    // 真 import 根 shim → 执行 `export * from './server/server.js'`（覆盖那 5 行）。
    rootMod = await import('../packages/app/server.js');
    realMod = await import('../packages/app/server/server.js');
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('暴露 server/server.js 的全部命名导出（star re-export 不丢键）', () => {
    const rootKeys = Object.keys(rootMod).filter((k) => k !== 'default').sort();
    const realKeys = Object.keys(realMod).filter((k) => k !== 'default').sort();
    assert.ok(realKeys.length > 0, 'server/server.js 应有命名导出');
    assert.deepEqual(rootKeys, realKeys,
      `根 shim 必须 re-export 全部命名导出\n  root: ${rootKeys.join(',')}\n  real: ${realKeys.join(',')}`);
  });

  it('star re-export 是引用透传：根与真模块的同名导出指向同一绑定', () => {
    for (const k of Object.keys(realMod)) {
      if (k === 'default') continue;
      assert.equal(rootMod[k], realMod[k], `导出 ${k} 应是同一引用（不是拷贝/包装）`);
    }
  });

  it('关键运行时入口存在且为函数（startViewer / getPort / stopViewer）', () => {
    assert.equal(typeof rootMod.startViewer, 'function', 'startViewer 必须从根 shim 暴露');
    assert.equal(typeof rootMod.getPort, 'function', 'getPort 必须从根 shim 暴露');
    assert.equal(typeof rootMod.stopViewer, 'function', 'stopViewer 必须从根 shim 暴露');
  });

  it('import 根 shim 未自启服务：未调用 startViewer 时 getPort() 应为 0/未监听', () => {
    // server/server.js 顶层只注册信号 handler，不监听端口；getPort 在未 start 时返回 0。
    const port = rootMod.getPort();
    assert.equal(port, 0, '未显式 startViewer 前不应有监听端口');
  });
});
