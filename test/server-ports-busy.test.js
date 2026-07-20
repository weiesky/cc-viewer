// 覆盖目标：server/server.js startViewer 的「端口区间耗尽」分支（835-839）——
// tryListen(port) 在 port > MAX_PORT 时打印 server.portsBusy 并 resolve(null)。既有 lifecycle 测试只覆盖
// EADDRINUSE 单步前进（落到下一个端口成功），从不让区间真正耗尽，故 836-839 始终未覆盖。
//
// 做法：把端口窗钉成单端口（START===MAX），先用一个真 net listener 占住该端口（监听 127.0.0.1），
// 再 startViewer → probe connect 成功 → tryListen(port+1) → port+1 > MAX_PORT → 命中 835-839 → resolve(null)。
// 独立进程（server.js 模块单例 + 该路径只在首个 startViewer 走一次）。
// 端口私有窗 17965（单端口，在 lifecycle 17920-17959 之上，避开全部 server-* 窗口）。
// 进程卫生：squatter listener 在 finally 里 close；startViewer 返回 null 时无 server 需停。

import { describe, it, before, after } from 'node:test';
import { describeCli } from './_helpers/cli-tier.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmBestEffort } from './_helpers/rm-sync.mjs';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-ports-busy-'));
mkdirSync(join(tmpDir, 'logs'), { recursive: true });

const BUSY_PORT = 17965;
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_CLI_MODE = '1';
process.env.CCV_WORKSPACE_MODE = '0';
process.env.CCV_SDK_MODE = '0';
process.env.NODE_ENV = 'test';
// 单端口窗：START===MAX===BUSY_PORT，耗尽即 port+1 > MAX。
process.env.CCV_START_PORT = String(BUSY_PORT);
process.env.CCV_MAX_PORT = String(BUSY_PORT);
delete process.env.CCV_IM_PLATFORM;
delete process.env.CCV_BASE_PATH;
delete process.env.CCV_ALLOWED_HOSTS;
delete process.env.CCV_USE_PASSWORD;
delete process.env.CCV_PASSWORD;

describeCli('server.js startViewer exhausts the port range (portsBusy)', { concurrency: false }, () => {
  let squatter, mod;

  before(async () => {
    // 占住唯一端口：监听 127.0.0.1:BUSY_PORT，让 startViewer 的 probe connect 命中。
    squatter = createServer(() => {});
    await new Promise((resolve, reject) => {
      squatter.once('error', reject);
      squatter.listen(BUSY_PORT, '127.0.0.1', resolve);
    });
  });

  after(async () => {
    await new Promise((resolve) => { try { squatter.close(() => resolve()); } catch { resolve(); } });
    try { await mod?.stopViewer(); } finally { await rmBestEffort(tmpDir); }
  });

  // ── 835-839：唯一端口被占 → probe connect 成功 → tryListen(port+1) → >MAX → resolve(null) ──
  it('startViewer resolves null when every port in the range is occupied', async () => {
    mod = await import('../server/server.js');
    const srv = await mod.startViewer();
    assert.equal(srv, null, 'startViewer must resolve null when the port range is exhausted');
  });
});
