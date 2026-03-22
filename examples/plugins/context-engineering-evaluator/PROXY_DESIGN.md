# cc-viewer 外部流量接入：设计与实现

## 问题

CC Insight 评测工具运行 `claude -p` 时，希望评测请求**实时出现在已运行的 cc-viewer Web UI 中**。

之前的方案 `ccv run -- claude -p` 会启动独立的 cc-viewer 实例（独立代理、独立日志），和终端 1 的 cc-viewer 互不相通，无法实时观测。

## 改造前架构

cc-viewer 启动后有两个 HTTP 服务跑在不同端口：

```
端口 7008 (server.js)              内部随机端口 (proxy.js)
┌─────────────────────┐            ┌─────────────────────┐
│ /api/*  → Web UI API │            │ /*  → API 代理       │
│ /      → index.html  │            │                     │
│ /v1/*  → 404 ❌      │            │ /v1/messages → 转发  │
└─────────────────────┘            └─────────────────────┘
                                          │
                                          ↓
                                   setupInterceptor()
                                   (patch fetch, 记录日志)
                                          │
                                          ↓
                                   https://api.anthropic.com
```

- `server.js`（端口 7008）：服务 Web UI 和内部 API，对 `/v1/*` 返回 404
- `proxy.js`（内部随机端口）：完整的 API 代理，但只有 ccv 自身启动的 Claude 子进程知道这个端口
- 外部进程无法通过端口 7008 代理 API 请求

## 改造后架构

在 `server.js` 的 `handleRequest` 中新增 `/v1/*` 路由，复用 `proxy.js` 的转发逻辑：

```
端口 7008 (server.js)
┌──────────────────────────────┐
│ /api/*      → Web UI API     │
│ /           → index.html     │
│ /v1/*       → API 代理 ✅    │  ← 新增
│   ├─ 记录日志 (interceptor)  │
│   └─ 转发到 api.anthropic.com│
└──────────────────────────────┘
```

## 数据流

```
终端 1: ccv (server.js 在 7008, Web UI 已打开)

终端 2: CCV_PROXY_URL=http://127.0.0.1:7008 node eval-cli.mjs --variants v1,v2
              │
              ↓
         eval-cli → judge.mjs → claude -p (ANTHROPIC_BASE_URL=http://127.0.0.1:7008)
              │
              ↓
         POST http://127.0.0.1:7008/v1/messages
              │
              ↓
         server.js 识别 /v1/ 路径，进入代理分支：
         1. 读取请求体
         2. 添加 x-cc-viewer-trace 头（标记为代理请求）
         3. 调用 fetch（已被 interceptor patch）
              │
              ↓
         interceptor 拦截 fetch 调用：
         1. 识别 x-cc-viewer-trace 头 → 强制记录
         2. 写入 request 到 JSONL 日志（LOG_FILE）
         3. 转发到 https://api.anthropic.com/v1/messages
         4. 接收响应，写入 response 到 JSONL 日志
              │
              ↓
         log-watcher 检测到日志变化（500ms 轮询）
              │
              ↓
         server.js 通过 SSE (/events) 推送到 Web UI
              │
              ↓
         终端 1 的 cc-viewer 页面实时显示评测请求 ✅
```

## 改动范围

### server.js（约 40 行新增）

在 `handleRequest` 的 CORS 处理后、认证检查前，新增 `/v1/*` 代理分支：

```javascript
if (url.startsWith('/v1/')) {
  // 1. 读取请求体
  // 2. 添加 x-cc-viewer-trace 头
  // 3. 获取上游 URL（从 settings 读取，避免循环引用）
  // 4. 调用被 patch 的 fetch → 自动记录日志
  // 5. 流式返回响应
}
```

关键实现细节：

- **上游 URL 获取**：不能用 `process.env.ANTHROPIC_BASE_URL`（可能指向自身），而是从 `~/.claude/settings.json` 读取，默认回退到 `https://api.anthropic.com`
- **fetch 已被 patch**：`server.js` import `interceptor.js` 时，`setupInterceptor()` 自动执行，`globalThis.fetch` 已被替换。在代理分支中直接调用 `fetch` 就会触发日志记录
- **x-cc-viewer-trace 头**：告诉 interceptor 强制记录此请求，不依赖 URL 模式匹配
- **流式响应**：使用 `Readable.fromWeb()` + `pipeline()` 处理 SSE 流式输出

### judge.mjs（简化）

去掉 `ccv run` 方式，改为通过 `CCV_PROXY_URL` 环境变量设置 `ANTHROPIC_BASE_URL`：

```javascript
const proxyUrl = process.env.CCV_PROXY_URL || undefined;
const env = proxyUrl
  ? { ...process.env, ANTHROPIC_BASE_URL: proxyUrl }
  : { ...process.env };

execFileAsync('claude', args, { env });
```

## 使用方式

```bash
# 终端 1：启动 cc-viewer
ccv

# 终端 2：运行评测，流量经过 cc-viewer
CCV_PROXY_URL=http://127.0.0.1:7008 node eval-cli.mjs --variants v1,v2

# 终端 2：不经过 cc-viewer（直接调用）
node eval-cli.mjs --variants v1,v2
```

## 为什么改动成本低

1. `proxy.js` 的转发逻辑（读 body → 加 header → fetch → 流式返回）已完整，直接复用模式
2. `interceptor.js` 的日志记录已完整（拦截 fetch → 记录 JSONL），不需要改
3. `log-watcher.js` 的文件监听已完整（500ms 轮询 → SSE 推送），不需要改
4. 只在 `server.js` 中加一个 `if (url.startsWith('/v1/'))` 分支
