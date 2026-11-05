# 反向代理公网 URL 部署（`CCV_BASE_URL`）

> English: [base-url.md](./base-url.md)

云平台通常把 cc-viewer 容器内端口（默认 `7008`）映射为带路径前缀的公网 URL，例如：

```
https://arca-sandbox-office.alipay.com/arca/api/v1/session/{token}/your/custom/path
wss://arca-sandbox-office.alipay.com/arca/api/v1/session/{token}/your/ws/path
```

把 `CCV_BASE_URL` 设为该公网 URL，cc-viewer 就会让整个应用——HTTP API、SSE、WebSocket、静态资源、分享/二维码链接——都正确挂在这个 URL 之下。无需重新构建，前端无需改动。

## 支持的写法

| 写法 | 例子 | 效果 |
|---|---|---|
| `host/path` | `arca-sandbox-office.alipay.com/arca/api/v1/session/{token}` | 路径前缀 + 公网 host |
| `/path` | `/arca/api/v1/session/{token}` | 仅路径前缀 |
| `scheme://host/path` | `https://arca-sandbox-office.alipay.com/arca/api/v1/session/{token}` | 前缀 + host + 固定协议 |
| `//host/path` | `//arca-sandbox-office.alipay.com/arca/api/v1/session/{token}` | 前缀 + host（协议相对写法；协议按规则自动检测） |

说明：

- `ws://`、`wss://` 作为别名接受，归一为 `http`/`https`（WebSocket URL 跟随页面协议自动派生）。
- `{token}` 段请**按字面书写**，不要 URL 编码。它是平台分配的会话路径段；cc-viewer 对字面形式与百分号编码形式（`%7Btoken%7D`）的请求都会匹配。
- 如果平台把该段替换成具体 session id，把 `CCV_BASE_URL` 设成替换后的实际前缀即可。

## 路径前缀影响哪些行为

`CCV_BASE_PATH` 已有的全部能力，`CCV_BASE_URL` 的路径部分全部继承：

- **HTTP 路由** —— 路由匹配前剥掉前缀，`/api/*` 与 `/events` 正常命中。
- **`<base href>` + `window.__CCV_BASE_PATH__` 注入** —— 每个 `index.html` 都带前缀，相对资源/API/WebSocket URL 都解析到前缀之下。
- **WebSocket upgrade** —— upgrade 路径同样剥前缀（`/ws/*`、插件 socket）。
- **插件** —— service 插件挂载点、cookie Path、`CCV_PLUGIN_PARENT_BASE_PATH` 都继承生效前缀。
- **启动输出与浏览器自动打开** —— `Local`/`Network` 行带前缀；带 host 时额外打印一行：
  ```
    ➜ External: https://arca-sandbox-office.alipay.com/arca/api/v1/session/{token}/?token=...
  ```
- **分享/二维码链接（`/api/local-url`）** —— 值带 host 时返回公网 URL（协议 + host + 前缀 + ccv 自己的 `?token=`）。仅 `/path` 形式没有公网 host 可打印，二维码链接保持内网 IP 形式——远程设备要扫得通，请带上 host。

## 生成链接的协议规则

1. `CCV_BASE_URL` 里显式写的 scheme（`https://...` → `https`；`http://...` → `http`）。
2. 否则用请求的 `X-Forwarded-Proto` 头（取首跳，只认 `http`/`https`）——`/api/local-url` 有请求上下文时生效。
3. 否则默认 `https`（带 host 的部署通常由代理终结 TLS）。

WebSocket 链接始终跟随页面协议（`https` → `wss`、`http` → `ws`），由前端按 `window.location` 构造，无需配置。

## Host 白名单

`CCV_BASE_URL` 带 host 时，该 hostname 会**始终并入** `Host` 头白名单（合并语义）——否则代理域名的所有请求都会被 `403 host-not-allowed` 拒绝。并集不影响显式设置的 `CCV_ALLOWED_HOSTS` 列表；`*` 仍然整体放行。

## 与 `CCV_BASE_PATH` 的优先级

| `CCV_BASE_URL` | `CCV_BASE_PATH` | 生效前缀 | 告警 |
|---|---|---|---|
| 未设 | 未设 | （无） | — |
| 未设 | `/p/` | `/p/` | 非法值照旧告警 |
| 合法 | 未设 | URL 的 path（仅 host 时为空） | — |
| 合法 | 已设 | URL 的 path | 提示 `CCV_BASE_URL 优先` |
| 非法 | 已设 | `/p/`（回退） | 提示「非法，已回退」 |
| 非法 | 未设 | （无） | 提示「非法，已回退」 |

「已设」指归一化后非空的 `CCV_BASE_PATH`：`CCV_BASE_PATH=/`（或归一化为空的非法值）视为未设，不产生优先级告警。

`CCV_BASE_PATH` 完全向后兼容（仅一处刻意微调：无尾斜杠的裸前缀现在按前缀根返回，而不再落到 SPA fallback）；`CCV_BASE_URL` 只是在此基础上增加 host/scheme 写法与对外链接生成。

## 反向代理要求

前缀由 cc-viewer **自己**剥离，代理应**原样转发**路径（代理提前剥掉前缀也能正常路由，但注入的 `<base href>` 以浏览器侧前缀为准——原样转发行为最可预期）：

```nginx
# HTTPS —— location 的值含 '{'，必须加引号（否则 nginx 解析配置直接失败）。
# exact-match 块让无尾斜杠的裸前缀也能到达 ccv；ccv 会按前缀根返回应用。
location = "/arca/api/v1/session/{token}" {
    proxy_pass http://127.0.0.1:7008;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
location "/arca/api/v1/session/{token}/" {
    proxy_pass http://127.0.0.1:7008;          # 不带 URI 部分——路径原样转发
    proxy_set_header Host $http_host;          # 必须：Host 参与白名单与 Origin 校验
                                               #（$http_host 保留非默认端口；默认 443/80 用 $host 亦可）
    proxy_set_header X-Forwarded-Proto $scheme;

    # WebSocket upgrade（终端 socket 长连且可能空闲——调大读超时）
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;

    # SSE（/events、日志流）：关闭响应缓冲，否则事件会积在代理缓冲区里成批到达
    proxy_buffering off;
}
```

HTTP 与 WebSocket 流量共用这一段配置即可。如果平台把会话 token 注入路径（`{token}` 段），无需额外 rewrite。

## 安全说明

- 平台的 `{token}` **路径段与 cc-viewer 自己的 `?token=` 访问令牌无关**。cc-viewer 对每个请求仍强制自身鉴权（token 链接或密码登录）与 Origin/Host 校验；External/二维码链接照旧在 query 里携带 ccv 的 token。
- 自动加白只在你显式设置 `CCV_BASE_URL` 时发生——等同于你自己设置 `CCV_ALLOWED_HOSTS` 的信任声明。
- 密码登录在前缀下可用（登录页会向带前缀的端点提交）。

## 从源码构建

无需任何构建期变量。发布的前端产物使用相对资源路径，配合运行时注入的 `<base href>`，同一份产物在根路径或任意前缀下都能工作。`CCV_BASE_URL` 部署时**不要**在构建期设置 `CCV_BASE_PATH`（那会把资源 URL 写死到固定前缀）。

## 故障排查

- **`403 host-not-allowed`** —— 代理改写了 `Host` 头。请保留原 Host（`proxy_set_header Host $http_host;`——`$http_host` 保留非默认端口，Origin 校验会对比端口），或把公网域名加进 `CCV_ALLOWED_HOSTS`。
- **API 请求返回 HTML（SPA 页面）** —— cc-viewer 收到的路径没有以配置的前缀开头。常见原因是 `CCV_BASE_URL` 少写/多写了一级路径段，或前缀被重复拼接。（代理在转发前剥掉前缀是可以容忍的——无前缀请求仍能正常路由——但注入的 `<base href>` 以浏览器侧前缀为准，建议还是原样转发。）
- **二维码/分享链接打不开** —— 生成的 URL 默认用 `https`；如果你的部署是纯 HTTP，请在 `CCV_BASE_URL` 里显式写 `http://`，或让代理发送 `X-Forwarded-Proto: http`。
- **无尾斜杠的链接** —— 已自动处理：裸前缀按前缀根返回应用（确保代理也转发裸前缀——见上方示例中的 `location = ...` 精确匹配块）。
