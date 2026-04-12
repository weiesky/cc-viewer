# CC-Viewer 插件系统

[English](./plugins.md)

CC-Viewer 提供了一套轻量级插件机制，允许在特定生命周期节点注入自定义逻辑。这对企业内部部署尤其有用——例如将二维码的局域网 URL 替换为企业内部代理地址。

## 快速开始

### 第 1 步：创建插件目录

```bash
mkdir -p ~/.claude/cc-viewer/plugins
```

### 第 2 步：编写插件文件

在插件目录下创建一个 `.js` 或 `.mjs` 文件，每个文件就是一个插件：

```javascript
// ~/.claude/cc-viewer/plugins/my-plugin.js
export default {
  name: 'my-plugin',
  hooks: {
    async localUrl({ url, ip, port, token }) {
      // 修改二维码中的 URL
      return { url: `https://my-proxy.com/${token}` };
    },
  },
};
```

### 第 3 步：重启 cc-viewer

插件放入目录后重启即生效，**无需 `npm install`**。

---

## 插件文件格式

一个插件是一个 ES Module，默认导出一个包含 `name` 和 `hooks` 的对象：

```javascript
export default {
  name: 'plugin-name',       // 插件名称，用于日志输出和禁用
  hooks: {
    // 在这里定义 hook 函数
  },
};
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | `string` | 否 | 插件标识符。省略时默认使用文件名。用于 `disabledPlugins` 匹配。 |
| `hooks` | `object` | 是 | hook 名称到异步函数的映射。 |

---

## 如何编写 Hook 函数

### 核心规则

1. **所有 hook 函数都应该是 `async`**（或返回 Promise）
2. **Waterfall 类型**的 hook 接收一个上下文对象，必须返回修改后的值
3. **Parallel 类型**的 hook 接收一个上下文对象，返回值会被忽略
4. **不需要的 hook 可以不写**——只实现你需要的即可

### Hook 一览表

| Hook 名称 | 类型 | 参数 | 返回值 | 触发时机 |
|-----------|------|------|--------|---------|
| `httpsOptions` | waterfall | `{}` | `{ pfx, passphrase }` 或 `{ cert, key }` | 服务器创建前 |
| `localUrl` | waterfall | `{ url, ip, port, token }` | `{ url }` | 客户端请求局域网地址时 |
| `serverStarted` | parallel | `{ port, host, url, ip, token, protocol, httpServer }` | 忽略 | 服务器启动成功后 |
| `serverStopping` | parallel | `{}` | 忽略 | 服务器关闭前 |
| `onNewEntry` | parallel | `entry` (JSONL 日志条目对象) | 忽略 | 检测到新的 JSONL 日志条目时 |

---

## Hook 详解

### `httpsOptions` — 提供 HTTPS 证书

**类型：Waterfall（串行管道）**

服务器启动时触发，用于获取 HTTPS 证书选项。如果返回的对象包含 `pfx` 或 `cert`，服务器将以 HTTPS 模式启动；否则回退到 HTTP。

**参数说明：**

| 参数 | 类型 | 说明 |
|------|------|------|
| （空对象） | `object` | 初始空对象，插件可以向其中添加 TLS 选项 |

**返回值：** 返回 `{ pfx, passphrase }` 或 `{ cert, key }`，传给 `https.createServer()`。

```javascript
hooks: {
  async httpsOptions() {
    // 示例 1：从内网包加载 PFX 证书
    const { getDevPfxBuffer, getDevPassphrase } = await import('@al/xxx');
    return { pfx: await getDevPfxBuffer(), passphrase: await getDevPassphrase() };
  },
}
```

```javascript
hooks: {
  async httpsOptions() {
    // 示例 2：从文件加载 PEM 证书
    const { readFileSync } = await import('node:fs');
    return {
      cert: readFileSync('/path/to/cert.pem'),
      key: readFileSync('/path/to/key.pem'),
    };
  },
}
```

### `localUrl` — 修改局域网访问地址

**类型：Waterfall（串行管道）**

当客户端请求 `/api/local-url` 时触发，用于生成二维码中的访问地址。这是最常用的企业场景 hook。

**参数说明：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `url` | `string` | 默认生成的完整 URL，如 `http://192.168.1.100:7008?token=abc123` |
| `ip` | `string` | 检测到的局域网 IP 地址 |
| `port` | `number` | 服务器实际监听的端口号 |
| `token` | `string` | 局域网访问令牌 |

**返回值：** 返回一个对象 `{ url }`，其中 `url` 是修改后的地址。

```javascript
hooks: {
  async localUrl({ url, ip, port, token }) {
    // 示例 1：替换为企业代理地址
    return { url: `https://dev.company.com/proxy/${token}` };
  },
}
```

```javascript
hooks: {
  async localUrl({ url, ip, port, token }) {
    // 示例 2：只替换协议和域名，保留 token
    return { url: `https://my-domain.com:${port}?token=${token}` };
  },
}
```

```javascript
hooks: {
  async localUrl({ url, ip, port, token }) {
    // 示例 3：不修改，直接透传（用于日志记录）
    console.error(`[audit] localUrl requested: ${url}`);
    return { url };
  },
}
```

### `serverStarted` — 服务器启动通知

**类型：Parallel（并行通知）**

服务器成功绑定端口后触发。适合用于发送通知、注册服务发现等。

```javascript
hooks: {
  async serverStarted({ port, host, url, ip, token, protocol, httpServer }) {
    console.error(`[my-plugin] 服务器运行在 ${url}`);

    // 示例：通知企业监控系统
    fetch('https://monitor.company.com/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service: 'cc-viewer', port, host, url }),
    }).catch(() => {});
  },
}
```

### `serverStopping` — 服务器关闭通知

**类型：Parallel（并行通知）**

服务器即将关闭时触发。适合用于清理资源、注销服务等。

```javascript
hooks: {
  async serverStopping() {
    console.error('[my-plugin] 服务器即将关闭');
  },
}
```

### `onNewEntry` — 新日志条目通知

**类型：Parallel（并行通知）**

每当 cc-viewer 检测到新的 JSONL 日志条目时触发。适合用于将日志数据转发到外部 HTTP 服务、数据分析平台或自定义存储。

**参数说明：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `entry` | `object` | 完整的 JSONL 日志条目对象，包含请求/响应信息、token 用量等 |
| `entry.pid` | `number \| null` | Claude 进程 PID。CLI 模式下为 PTY 子进程 PID；非 CLI 模式（hook 注入）下为当前进程 PID。PTY 未启动或已退出时可能为 `null` |

```javascript
hooks: {
  async onNewEntry(entry) {
    // 示例 1：转发到远程日志收集服务
    fetch('https://logs.company.com/api/collect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    }).catch(() => {});
  },
}
```

```javascript
hooks: {
  async onNewEntry(entry) {
    // 示例 2：仅转发 MainAgent 请求
    if (entry.mainAgent) {
      fetch('https://analytics.company.com/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      }).catch(() => {});
    }
  },
}
```

---

## Hook 执行机制

### Waterfall（串行管道）

多个插件按**文件名字母序**依次执行。前一个插件的返回值会合并到上下文中传给下一个插件：

```
初始值 → plugin-A → plugin-B → plugin-C → 最终值
```

- 如果插件返回 `null` 或 `undefined`，上下文保持不变，继续传给下一个
- 返回值会与当前上下文做浅合并（`{ ...value, ...result }`）

### Parallel（并行通知）

所有插件**同时执行**，返回值忽略。用于通知和副作用操作。

---

## 错误隔离

每个 hook 调用都包裹了 `try/catch`。如果插件抛出异常：

- 错误会输出到 stderr：`[CC Viewer] Plugin "name" hook "hookName" error: message`
- **不会影响**其他插件和宿主程序的正常运行
- 对于 waterfall hook，当前值会原样传给下一个插件

---

## 控制插件执行顺序

插件按文件名字母序排列后加载。使用数字前缀控制顺序：

```
~/.claude/cc-viewer/plugins/
├── 00-audit-log.js        # 最先执行
├── 50-enterprise-proxy.js # 中间执行
└── 99-cleanup.js          # 最后执行
```

---

## 禁用插件

在 `~/.claude/cc-viewer/preferences.json` 中添加 `disabledPlugins` 数组：

```json
{
  "disabledPlugins": ["enterprise-proxy", "my-plugin"]
}
```

数组中的值匹配插件的 `name` 字段。被禁用的插件在加载时会被跳过。

---

## 完整示例：企业代理插件

```javascript
// ~/.claude/cc-viewer/plugins/enterprise-proxy.js
export default {
  name: 'enterprise-proxy',
  hooks: {
    async localUrl({ url, ip, port, token }) {
      // 将局域网 URL 替换为企业内部代理地址
      return { url: `https://dev.company.com/proxy/${token}` };
    },

    async serverStarted({ port, host }) {
      // 向内部监控系统注册服务
      fetch('https://monitor.company.com/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service: 'cc-viewer', port, host }),
      }).catch(() => {});
    },

    async serverStopping() {
      // 清理工作
    },

    async onNewEntry(entry) {
      // 将日志转发到数据分析平台
      fetch('https://analytics.company.com/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      }).catch(() => {});
    },
  },
};
```

---

## 注意事项

- 插件在服务器启动时加载一次。新增或删除插件文件后需要重启 cc-viewer。
- 如果插件目录不存在，加载器静默返回，零性能开销。
- 插件使用 ESM 格式（`export default`），支持 `.js` 和 `.mjs` 后缀。
- 插件目录路径：`~/.claude/cc-viewer/plugins/`，企业 IT 可预置此目录。
