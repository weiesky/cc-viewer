/**
 * 补 server/routes/ultra-agents.js 的 catch 分支（line 12-15，既有 ultra-agents-api.test.js
 * 只走 200 成功路径，缺 listUltraAgents() 抛错时的 500 internal_error 回退）。
 *
 * 手法：用 Node 24 module.registerHooks 把依赖模块 ../lib/ultra-agents-api.js 的 source
 * 替换成「listUltraAgents 直接抛错」的实现，然后 import 路由模块（它在 import 期绑定
 * 这个被改写的依赖）→ 调用 handler 即进 catch。纯内存改写，不 spawn 子进程、不改磁盘。
 *
 * console.error 在 catch 里会打一行；用例内临时替换 console.error 静音并断言它被调用，
 * after 还原，避免污染 --test 输出。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const API_URL = new URL('../server/lib/ultra-agents-api.js', import.meta.url).href;

// 改写依赖模块：导出会抛的 listUltraAgents（+ 其它导出占位，避免别处 import 报缺失）。
const THROWING_SRC = `
export function listUltraAgents() { throw new Error('boom-ultra'); }
export function validateAgentId() { return false; }
export function isValidTextField() { return false; }
export function isNonEmptyString() { return false; }
`;

let hookRegistered = false;
function installHook() {
  if (hookRegistered) return;
  hookRegistered = true;
  registerHooks({
    load(url, context, nextLoad) {
      if (url === API_URL) {
        return { format: 'module', shortCircuit: true, source: THROWING_SRC };
      }
      return nextLoad(url, context);
    },
  });
}

const fakeRes = () => {
  const res = { statusCode: null, body: '', headers: null };
  res.writeHead = (code, headers) => { res.statusCode = code; res.headers = headers; };
  res.end = (chunk) => { res.body = chunk || ''; };
  return res;
};

describe('GET /api/ultra-agents — listUltraAgents 抛错走 500', () => {
  let handler;

  before(async () => {
    installHook();
    // 带 query 串 cache-bust，确保拿到「绑定到被改写依赖」的全新路由模块实例。
    const mod = await import('../server/routes/ultra-agents.js?throwcase=1');
    handler = mod.ultraAgentsRoutes[0].handler;
  });

  it('listUltraAgents 抛错时返回 500 与 { error: "internal_error" }（不泄漏堆栈）', async () => {
    const origErr = console.error;
    const errCalls = [];
    console.error = (...a) => { errCalls.push(a); };
    try {
      const res = fakeRes();
      await handler({}, res);
      assert.equal(res.statusCode, 500);
      assert.deepEqual(res.headers, { 'Content-Type': 'application/json' });
      const data = JSON.parse(res.body);
      assert.deepEqual(data, { error: 'internal_error' });
      // 错误信息不能出现在响应体里
      assert.ok(!res.body.includes('boom-ultra'), 'response body 不应泄漏原始 error message');
      // catch 内 console.error 被调用一次，带 [api/ultra-agents] 前缀
      assert.equal(errCalls.length, 1, 'catch 应打一条 console.error');
      assert.equal(errCalls[0][0], '[api/ultra-agents]');
    } finally {
      console.error = origErr;
    }
  });
});
