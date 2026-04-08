# Electron Proxy 403 排查报告

Electron 客户端的代理转发导致 Anthropic API 返回 403 "Request not allowed"。

## 决定性测试结果（2026-04-08）

| 测试 | 端口 | 来源终端 | 结果 |
|------|------|---------|------|
| Web 代理 (fetch) | 55526 | 普通终端 | **200 ✓** |
| Web 代理 (fetch) | 55526 | Electron shell | **200 ✓** |
| Electron 代理 (fetch) | 56317 | 普通终端 | **403 ✗** |
| Electron 代理 (https.request) | 56317 | 普通终端 | **403 ✗** |
| 最小代理 (零 cc-viewer 代码) | 19999 | 普通终端 | **403 ✗** |
| 直连 (`command claude -p "hi"`) | 无 | 任意终端 | **200 ✓** |

## 核心矛盾
**同一个 proxy.js 代码，web 进程的代理能用，Electron tab-worker 进程的代理不能用。** 从外部普通终端调用两个代理端口，结果不同。

## 已排除
- OAuth token 有效（auth status 确认，直连正常）
- Claude Code 版本不是问题（2.1.94 通过 web 代理正常）
- Request body 完全正常（导出确认 model/messages/system 格式标准）
- Request headers 与 web 版一致（authorization token 相同）
- 代码差异不是问题（Electron 和 web 用完全相同的 proxy.js）
- patched fetch 不是问题（换 https.request 绕过 fetch 仍 403）
- Electron 环境本身不是问题（从 Electron shell 通过 web 代理正常）
- 项目配置无异常（.claude/settings 只有 permissions）
- 环境变量差异小（31 vs 36 个，无 proxy 相关变量）

## 下次排查方向（按优先级）

### 1. getOriginalBaseUrl() 返回不同值
`proxy.js:55` 每次请求调 `getOriginalBaseUrl()`。检查 cwd/.claude/settings、~/.claude/settings、process.env.ANTHROPIC_BASE_URL。如果 Electron tab-worker 中它返回了代理自身 URL 而非 api.anthropic.com → 循环或错误转发。**验证：加 console.error 打印返回值。**

### 2. tab-worker 未设 CCV_PROXY_MODE
interceptor.js:696 因 CCV_PROXY_MODE 未设而自动执行 setupInterceptor()。interceptor.js:701 因此尝试 import server.js。可能产生副作用。**验证：在 tab-worker import proxy.js 前设 `process.env.CCV_PROXY_MODE='1'`。**

### 3. proxy-env.js undici GlobalDispatcher
如果 Electron 进程有隐藏 proxy env vars → 所有 fetch 被路由到系统代理。**验证：打印 http_proxy/HTTPS_PROXY 等。**

### 4. 最小代理为什么也 403
纯 Node.js https.request 代理（无 cc-viewer 代码）在普通终端也 403。但 cc-viewer 的 web 代理（用 fetch）正常。差异可能在 fetch (undici) vs https.request 的 HTTP 行为：HTTP/2 支持、header 规范化、连接复用等。

## 快速开始下次排查
1. 在 proxy.js 的 `getOriginalBaseUrl()` 返回前加 `console.error('[PROXY] baseUrl:', result)`
2. 在 proxy.js 的 `const fullUrl` 后加 `console.error('[PROXY] forwarding:', fullUrl)`
3. 重新打包 Electron
4. 打开 Electron tab，从 DevTools Application > Tab Worker 或 Electron 启动终端查看日志
5. 对比 web 代理和 Electron 代理的 fullUrl 输出
