// 覆盖目标：CCV_BASE_URL 的启动期行为——非 CLI 模式启动日志的 External 行与
// baseUrl 配置告警（server.js setLang 之后的校验块 + startedLocal/Network/External 打印）。
// 这些行只在 startViewer 的监听回调里打印一次，api-base-url.test.js 的在 before 里翻转 env
// 的结构无法覆盖，故独立文件在 import 前设好 env，并用 console.error/console.warn 拦截捕获输出。
// 端口私有窗 18510-18519（全仓唯一，与 api-base-url 的 18500-18509 不重叠）。

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── 必须在任何会拉起 findcc.js 的 import 之前设置 ──
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-base-url-startup-'));
mkdirSync(join(tmpDir, 'logs'), { recursive: true });
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';
process.env.NODE_ENV = 'test';
delete process.env.CCV_BASE_PATH;
delete process.env.CCV_ALLOWED_HOSTS;
delete process.env.CCV_USE_PASSWORD;
delete process.env.CCV_PASSWORD;
process.env.CCV_START_PORT = '18510';
process.env.CCV_MAX_PORT = '18519';
process.env.CCV_BASE_URL = 'https://arca-sandbox-office.alipay.com/arca/api/v1/session/{token}';

describe('CCV_BASE_URL startup output (non-CLI mode)', { concurrency: false }, () => {
  let mod, errorLines, warnLines;

  before(async () => {
    // console.error/warn 拦截：started* 行走 console.error，配置告警走 console.warn
    errorLines = [];
    warnLines = [];
    const origError = console.error;
    const origWarn = console.warn;
    console.error = (...args) => { errorLines.push(args.map(String).join(' ')); };
    console.warn = (...args) => { warnLines.push(args.map(String).join(' ')); };
    try {
      mod = await import('../server/server.js');
      const srv = await mod.startViewer();
      assert.ok(srv, 'server should start');
    } finally {
      console.error = origError;
      console.warn = origWarn;
    }
  });

  after(async () => {
    delete process.env.CCV_BASE_URL;
    await new Promise((resolve) => {
      mod.stopViewer();
      setTimeout(() => { rmSync(tmpDir, { recursive: true, force: true }); resolve(); }, 200);
    });
  });

  it('启动日志打印 External 行（公网 URL + ccv 自己的 ?token=）', () => {
    const external = errorLines.find((l) => l.includes('External:'));
    assert.ok(external, `expected an External line, got:\n${errorLines.join('\n')}`);
    assert.ok(external.includes('https://arca-sandbox-office.alipay.com/arca/api/v1/session/{token}/?token='),
      `External line must carry host+prefix+token, got: ${external}`);
    // token 必须是 ccv 的 ACCESS_TOKEN（getAccessToken 与打印同源）
    assert.ok(external.includes(`?token=${mod.getAccessToken()}`), 'External line must carry the real ACCESS_TOKEN');
  });

  it('Network 行的 {token} 前缀不被 ACCESS_TOKEN 二次替换（i18n 单趟插值回归锁）', () => {
    const network = errorLines.find((l) => l.includes('Network:'));
    assert.ok(network, 'expected a Network line');
    assert.ok(network.includes('/arca/api/v1/session/{token}/?token='),
      `Network line must keep the literal {token} prefix, got: ${network}`);
  });

  it('Local 行带前缀、无合法告警污染', () => {
    const local = errorLines.find((l) => l.includes('Local:'));
    assert.ok(local?.includes('/arca/api/v1/session/{token}/'), `Local line must carry prefix, got: ${local}`);
    assert.ok(!warnLines.some((l) => l.includes('CCV_BASE_URL')), `no warning expected for a valid value, got:\n${warnLines.join('\n')}`);
  });
});
