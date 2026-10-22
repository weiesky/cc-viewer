# 服务插件与面板插件

> English: [plugin-services.md](./plugin-services.md)

cc-viewer 支持两类插件形态：

| 形态 | 文件形式 | 运行于 | 能力 |
|---|---|---|---|
| **Hook 插件** | 单个 `.js`/`.mjs` 文件 | 主进程 | 10 个 hook（`beforeRequest`、`serverStarted`、`onPermRequest` 等）——行为不变 |
| **服务插件** | 含 `plugin.json` 的目录 | 主进程 **+ 独立子进程** | 包含 hook 插件全部能力，**另加**：挂载在同一端口下的独立 HTTP/WS 服务、Web UI 中的 React 面板、以及支持热装载的 `activate`/`deactivate`/`onError` 完整生命周期 |

本文档讲服务插件。Hook 插件基础见 [plugins.zh.md](./plugins.zh.md)。

---

## 1. 目录结构

```
~/.claude/cc-viewer/plugins/
  legacy-hook.js                ← hook 插件（不变）
  hello-service/                ← 服务插件
    plugin.json                 ← manifest（必需）
    main.mjs                    ← 主进程模块：hooks + 生命周期（可选）
    service.mjs                 ← 子进程入口：独立 HTTP 服务（可选）
    panel/
      index.js                  ← 面板 bundle：远程 React 组件（可选）
      index.css                 ← 面板样式（可选）
```

三部分均可选、可自由组合：只做服务、只做面板、只做 hooks+生命周期都可以。

## 2. plugin.json（v1）

```json
{
  "name": "hello-service",
  "version": "1.0.0",
  "main": "main.mjs",
  "service": {
    "entry": "service.mjs",
    "prefix": "/plugins/hello-service",
    "env": { "HELLO_MODE": "demo" }
  },
  "panel": {
    "entry": "panel/index.js",
    "css": "panel/index.css",
    "title": { "en": "Hello Service", "zh": "Hello 服务" },
    "icon": "appstore",
    "width": 1100,
    "desktopOnly": false
  },
  "config": {
    "defaults": { "greeting": "hi" }
  }
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | 是 | `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`；全局唯一；用于 URL 与 `disabledPlugins` |
| `version` | 否 | UI 展示；计入热更新指纹 |
| `main` | 否 | 默认按 `main.mjs → main.js → index.mjs → index.js` 探测 |
| `service.entry` | 有 service 时 | 必须解析在插件目录内（禁 `..`、禁符号链接逃逸） |
| `service.prefix` | 否 | 默认 `/plugins/<name>`；v1 **必须等于 `/plugins/<name>`**（自定义前缀会被拒绝——挂载表按 name 路由） |
| `service.env` | 否 | 子进程静态环境变量；拒绝 `CCV_*`/`CCVIEWER_*` 键 |
| `panel.entry` | 有 panel 时 | **子目录内**的 `.js` bundle（不支持 iframe 式 `.html` 面板） |
| `panel.css` | 否 | 与 `panel.entry` 同目录 |
| `panel.title` | 否 | 字符串或 `{lang: string}` 映射；缺省用 `name` |
| `panel.icon` | 否 | `api / dashboard / appstore / tool / database / chart / file / global` 之一 |
| `panel.width` | 否 | 桌面弹窗宽度，夹在 360–1600（默认 1100） |
| `panel.desktopOnly` | 否 | 移动端隐藏菜单项 |
| `config.defaults` | 否 | 静态默认配置，暴露为 `ctx.config` |

manifest 错误（JSON 坏、name/prefix 非法、路径逃逸）只会让该插件记 `loadError` 跳过，
不影响其他插件加载。

## 3. 主进程模块（main.mjs）

```js
export default {
  // 可选：与单文件插件完全一致的 hooks
  hooks: {
    async beforeRequest(ctx) { /* ... */ },
  },

  // 插件加载完成（服务插件还需子进程就绪并挂载）后调用。
  // main.mjs 保持轻量——重活放 service.mjs（loadPlugins 在 HTTP listen 前执行，无法超时）。
  async activate(ctx) {},

  // 卸载前调用：'reload' | 'disable' | 'delete' | 'serverStopping' | 'restart'。
  // 不要假设此时 service 还活着（可能已被 SIGTERM）。
  async deactivate(reason) {},

  // activate 失败、spawn 失败、子进程异常退出、健康检查失败时调用。
  async onError(err, info) {}, // info: { phase, exitCode?, signal?, pid? }
};
```

### PluginContext

```ts
interface PluginContext {
  name: string;
  version: string | null;
  pluginDir: string;
  dataDir: string;              // <log_dir>/plugin-data/<name>/（自动创建，0700）
  basePath: string;             // 设置 CCV_BASE_PATH 时为 '/ccv'，否则 ''
  server: {
    port: number; host: string; protocol: 'http' | 'https'; url: string;
    token: string;              // ACCESS_TOKEN（敏感）
    internalToken: string;      // INTERNAL_TOKEN（敏感）
    httpServer: import('node:http').Server;
    pty: object | null;         // 仅 CLI 模式
    interactions: object;       // 挂起的权限/提问解析器（同 serverStarted hook）
  };
  service: {                    // 仅服务插件——活对象：崩溃自动重启后原地更新，
    prefix: string;             // 你持有的引用不会失效
    port: number; pid: number;
    baseUrl: string;            // http://127.0.0.1:<port>
    secret: string;             // 代理注入的 x-ccv-plugin-secret
    status(): ServiceStatus;  // 'pending'|'starting'|'ready'|'restarting'|'crashed'|'stopping'|'stopped'|'blocked'|'error'
    restart(): Promise<{ ok: boolean, status: ServiceStatus }>;
  } | null;
  panel: { url: string; title: string } | null;
  config: Readonly<object>;     // manifest config.defaults（v1 无运行时写）
  logger: { debug/info/warn/error(...): void };
  events: {
    on(event: 'new_entry' | 'stream_chunk', cb): () => void; // deactivate 自动退订
  };
  signal: AbortSignal;          // deactivate/unload 时 abort
  isStopping(): boolean;
}
```

## 4. 子进程（service.mjs）

子进程是**独立 detached Node 进程**，运行你的 `service.entry`。它必须：

1. 在 `127.0.0.1:0` 创建 HTTP 服务（OS 分配随机端口，无端口竞争）；
2. 写锁文件（宿主 SDK 代劳）；
3. 用共享密钥应答 `GET /__ccv/health`（SDK 代劳）；
4. 响应 SIGTERM 优雅退出（SDK 代劳）。

通过 `CCV_PLUGIN_HOST` 这个 file URL 使用宿主 SDK：

```js
const { startPluginService, WebSocketServer } = await import(process.env.CCV_PLUGIN_HOST);

await startPluginService({
  onRequest(req, res) {
    // 到达这里的请求已通过 x-ccv-plugin-secret 校验
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  },
  onUpgrade(req, socket, head) {       // 可选，WebSocket
    const wss = new WebSocketServer({ noServer: true });
    wss.on('connection', ws => ws.on('message', m => ws.send('echo:' + m)));
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  },
});
```

SDK 还导出 `config`（插件配置）、`plugin`（name/version/dir/dataDir）、
`parent`（port/basePath/url）以及 `callParent(path, init)`（回调主服务 API）。

**依赖边界**：子进程 cwd 是插件目录，裸 import 只能解析 Node 内置模块与这个 SDK。
不能 `import 'express'`（或任何第三方包），除非把它 vendor 进插件目录。`ws` 由 SDK
转出口——不要自己 `import 'ws'`。

## 5. 同端口挂载（代理语义）

| 路径 | 归属 | 鉴权 |
|---|---|---|
| `/plugins/<name>/*` | 代理到子进程（前缀剥离，query 保留，`token` 移除） | 主服务 `decideAuth` |
| `/plugins/<name>` | 308 → `/plugins/<name>/` | 主服务 `decideAuth` |
| `/plugin-panels/<name>/*` | 主进程直出面板上构建产物目录 | 免（静态资源） |
| `/api/plugin-panels` | 面板清单 | 读鉴权 |

可以依赖的代理细节：

- 端到端流式：请求/响应体管道直通（SSE 可用；代理不缓冲、不压缩、headers 到达后无响应超时）。
- 头处理：重写 `host`；注入 `x-forwarded-host/proto/prefix/for` 与 `x-ccv-plugin-secret`（覆盖客户端伪造）；剥离 `cookie`/`authorization` 与 hop-by-hop 头。
- 同源重定向的 `Location` 自动补插件前缀；`Set-Cookie` 改写 `Path=<前缀>/` 并去 `Domain`；名为 `ccv_auth` 的 cookie 一律丢弃。
- WebSocket 按原始字节隧道转发（permessage-deflate 等由你的客户端与服务直接协商）。
- 失败语义：未知插件 404；已禁用 404；崩溃/启动中 503。
- CORS：插件 API 面向同源面板；不承诺跨源（主服务统一应答所有 `OPTIONS`）。

## 6. 面板（远程 React 组件）

面板是**热挂载进主应用 UI 的 React 组件**——桌面端 antd 弹窗，移动端全屏抽屉。不是 iframe。

```jsx
// src/Panel.jsx（构建成 panel/index.js——见 §7）
export default function Panel(props) {
  const { name, version, theme, lang, isMobile, project, instance, status,
          basePath, assetBaseUrl, apiUrl, pluginApiUrl, pluginWsUrl, onClose } = props;
  // 用主应用的 antd 渲染（主题自动跟随）
}
window.CCV.registerPanel('hello-service', Panel); // 顶层同步调用
```

契约要点：

- `registerPanel(name, Component)` 必须在 bundle 执行期间**同步**调用（主应用用它与注入的 `<script data-ccv-load>` 配对；异步注册会被拒绝）。
- 共享依赖：你的 bundle 必须把 `react`、`react-dom`、`antd`（含深路径）解析到 `window.CCV.deps`——构建模板已替你做好。打进第二份 React 会让 hooks 崩溃；打进第二份 antd 会丢失主应用主题。
- `pluginApiUrl(path)` / `pluginWsUrl(path)` 构造指向你服务的已鉴权 URL（token/cookie 已处理）；`apiUrl(path)` 指向主服务 API；`assetBaseUrl` 作为静态资源前缀。
- 副作用只放 effect 并写 cleanup——每次打开 bundle 都会重新执行，模块级定时器/监听器会逐次累积。
- 样式：类名加前缀（`ccv-<name>-*`）；禁裸元素选择器、禁 `!important`、禁覆盖全局 `.ant-*`；主题用主应用 CSS 变量（`var(--bg-base)`、`var(--text-primary)` 等），自动跟随 `data-theme`。
- 面板指纹变化时（清单里的 `entryUrl` 带指纹）重新加载——重新构建 + 重载插件即可拿到新 bundle。已打开的面板不热替换，关闭再打开生效。
- **安全**：面板与主页面同权（DOM、cookie、任意 API 调用）。面板即可信代码——安装带面板的插件等同于安装软件。只安装你信任的插件。

## 7. 构建面板

用 `docs/plugin-templates/panel/` 模板：

```bash
cp -r docs/plugin-templates/panel /path/to/your/plugin-dir
cd /path/to/your/plugin-dir
cp plugin.json.example plugin.json   # 编辑 name/title
pnpm install
node build.mjs                       # 产出 panel/index.js（import 了 css 时还有 .css）
```

构建脚本打成单文件 IIFE，并把 react/react-dom/antd 的 import 改写到 `window.CCV.deps`。
限制：禁动态 `import()`、禁 code splitting、禁顶层 await；React 18 / antd 5 主版本需与主应用对齐。

## 8. 热装载语义

`POST /api/plugins/reload`（或「重载」按钮）执行：

1. 对已装载插件执行 `deactivate('reload')`，同时对所有服务子进程发 SIGTERM（两者
   `Promise.allSettled` 并行），超时升级 SIGKILL；销毁代理连接；
2. 重新扫描 + 重新 import（指纹 cache-bust——未变更的 main 复用旧模块）；
3. spawn → 健康检查 → 注册挂载 → `activate(ctx)`。

- 改 `service.mjs`：reload 后完整生效（子进程整体重启）。
- 改 `main.mjs`：生效（指纹 bust import）。
- 改 `main.mjs` 引用的 **helper**：**不生效**。main 虽以带 query 的 URL 重新 import，但其
  静态 import 的 helper 仍按无 query 的 URL 命中 Node ESM 缓存——改 helper 或 touch
  `main.mjs` 都不会刷新，需重启 cc-viewer 进程。
- 改面板 bundle：下次打开面板生效（URL 带指纹）。
- 单插件失败隔离：一个插件坏掉只它自己下线（`loadError`），其余插件不受影响。

## 9. 管理 API

| 端点 | 说明 |
|---|---|
| `GET /api/plugins` | 列表，含 `type`/`serviceStatus`（运行状态、lastError） |
| `POST /api/plugins/reload` | 全部热装载（单飞） |
| `POST /api/plugins/restart?name=<name>` | 重启单个服务子进程 |
| `DELETE /api/plugins?file=<f>` | 删除单文件插件 |
| `DELETE /api/plugins?dir=<name>` | 卸载并递归删除目录插件 |
| `POST /api/plugins/upload` | 仅单文件上传（目录插件：复制目录 + 重载） |
| `POST /api/plugins/install-from-url` | 仅单文件安装 |
| `GET /api/plugin-panels` | Web UI 的面板清单 |

## 10. 安全模型

- 服务插件在你机器上运行**独立子进程**；hook 插件与面板 bundle 以主进程/主页面全权限执行。这里的隔离是为了崩溃隔离与热装载，**不是安全沙箱**。只安装可信代码。
- 任何持有 ACCESS_TOKEN 的客户端（包括扫码接入的手机）都可以读取插件面——请把 token 视作完整管理员凭据。**写接口现已加 admin + 同源双闸**：reload/restart/upload/install/delete（以及会直接返回 token 的 `GET /api/local-url`）要求调用方是 loopback 或已认证的远程管理员，且浏览器上下文同源。不带 `Origin` 的 CLI/原生客户端照常可用；跨站页面一律 403。
- **反向代理部署要点**：保留原始 `Host` 头（不要改写），并建议设置 `X-Forwarded-Proto` 为外部实际 scheme。WebSocket upgrade 与写接口会用浏览器 `Origin` 对照 `Host` 校验；代理改写 `Host`/`Origin` 或丢 scheme 会导致这些请求被拒。
- 面板静态文件在网络接口上公开可读（静态免鉴权）——bundle 内不要放密钥；你的 API 仍然需要鉴权。
- 子进程只监听 loopback 且要求每次 spawn 的密钥，主服务代理是唯一实际调用方。

## 11. 环境差异

- **Electron**：每个 server 进程（管理 server + 每个标签页 worker）都会运行一份已启用服务插件。有外部副作用的插件（绑定端口、单例资源）会每个标签页跑一份——请据此设计。IM worker 进程不会激活服务插件。
- **Windows**：进程组 kill 用 `taskkill /T /F`；锁与配置按 server PID 命名，多个 cc-viewer 实例互不冲突。
- **CCV_BASE_PATH**：代理在转发前剥离；你的服务看到的永远是无前缀路径。`x-forwarded-prefix` 携带 `<basePath><插件前缀>`。
