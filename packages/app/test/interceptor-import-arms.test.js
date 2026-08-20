/**
 * interceptor.js — import-time（模块求值期）分支覆盖（T10 续）。
 *
 * 这些是模块顶层只跑一次的代码，必须在独立进程里用受控 env 触发：
 *   - getBaseUrlHost()：ANTHROPIC_BASE_URL 为非法 URL → new URL() 抛错 → catch → return null（440-441）
 *
 * 独立测试文件 = 独立进程（node --test 默认每文件一进程），env 在 import 前设好即生效。
 * interceptor.js 在保护清单：只测不改。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

// 关键：在 import interceptor 之前把 ANTHROPIC_BASE_URL 设成非法 URL，
// 让模块顶层 const CUSTOM_API_HOST = getBaseUrlHost() 走 new URL() 抛错 → catch → null 分支。
process.env.CCV_PROXY_MODE = '1';        // 跳过顶层 setupInterceptor 自执行
process.env.CCV_SYNC_WRITES = '1';
delete process.env.CCV_WORKSPACE_MODE;
process.env.ANTHROPIC_BASE_URL = 'http://[not a valid url';  // new URL() 必抛

let mod;
before(async () => {
  mod = await import('../server/interceptor.js');
});
after(() => {
  delete process.env.ANTHROPIC_BASE_URL;
  setTimeout(() => process.exit(0), 30).unref(); // 顶层 watchFile 阻止退出
});

describe('getBaseUrlHost：非法 ANTHROPIC_BASE_URL 安全降级', () => {
  it('模块加载不因非法 base url 抛出（catch → CUSTOM_API_HOST=null）', () => {
    // 能成功 import 且 v2 writer 就绪即证明 getBaseUrlHost 的 catch 吞掉了 URL 解析异常。
    // 1.7.0：v1 单文件日志已下线，LOG_FILE 恒为 ''（deprecated 占位导出）。
    assert.ok(mod, 'interceptor 模块应正常加载');
    assert.equal(mod.LOG_FILE, '', '1.7.0 起 LOG_FILE 恒为空串（v1 写路径已退役）');
    assert.ok(mod._v2Writer && mod._v2Writer.enabled, 'v2 writer 应正常初始化（非法 base url 不阻断初始化）');
  });
});
