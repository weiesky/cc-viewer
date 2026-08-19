# 代理热切换

## 功能说明

代理热切换允许你在不重启 Claude Code 的情况下，动态切换 API 请求的目标地址和认证信息。适用于使用第三方 API 代理服务的场景。

> ⚠️ 如果你是 Claude 官方 Max 订阅用户，请勿使用该功能。

## 字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| **名称** | ✅ | 代理的显示名称，方便区分不同代理 |
| **地址 (Base URL)** | ✅ | API 服务的基础地址（如 `https://api.example.com`），原始请求的 origin 会被替换为此地址 |
| **API Key** | ✅ | 代理服务的 API 密钥，会替换原始请求中的认证信息 |
| **ANTHROPIC_MODEL** | ❌ | 主模型。凡属于 `fable` / `mythos` 家族的模型请求都会被改写为此值 |
| **ANTHROPIC_DEFAULT_OPUS_MODEL** | ❌ | 扩展：`model` 包含 `opus` 的请求会被改写为此值 |
| **ANTHROPIC_DEFAULT_SONNET_MODEL** | ❌ | 扩展：`model` 包含 `sonnet` 的请求会被改写为此值 |
| **ANTHROPIC_DEFAULT_HAIKU_MODEL** | ❌ | 扩展：`model` 包含 `haiku` 的请求会被改写为此值 |
| **强度等级** | ❌ | 向请求体注入 `output_config.effort`（`low`/`medium`/`high`/`xhigh`/`max`），保持"默认"则跳过 |

模型匹配是对请求 `model` 字段的大小写无关子串判断，因此任意版本（如 `claude-opus-4-8`、未来的 `claude-opus-5`）都会映射到同一家族，无需重新配置。家族字段留空表示该家族保持不变；无法识别的家族会原样透传。

## 工作原理

切换代理后，`server/interceptor.js` 会在每次 API 请求发出前执行以下操作：

1. **URL 重写** — 将请求的 origin 替换为代理的 Base URL
2. **认证替换** — 将请求头中的 `x-api-key` 或 `Authorization` 替换为代理的 API Key
3. **模型替换** — 按家族改写请求体的 `model` 字段（opus/sonnet/haiku → 对应字段；fable/mythos → `ANTHROPIC_MODEL`）
4. **强度注入** — 若设置了强度等级，则注入 `output_config.effort`（`count_tokens` / 心跳请求会跳过）

## 配置文件

配置存储在 `~/.claude/cc-viewer/profile.json`，你可以点击标题旁的文件夹图标直接打开目录编辑：

```json
{
  "active": "my-proxy",
  "profiles": [
    { "id": "max", "name": "Max" },
    {
      "id": "my-proxy",
      "name": "My Proxy",
      "baseURL": "https://api.example.com",
      "apiKey": "sk-xxx",
      "ANTHROPIC_MODEL": "model-primary",
      "ANTHROPIC_DEFAULT_OPUS_MODEL": "model-opus",
      "ANTHROPIC_DEFAULT_SONNET_MODEL": "model-sonnet",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL": "model-haiku",
      "effort": "max"
    }
  ]
}
```

- `active` — 当前使用的 profile ID，设为 `"max"` 表示直连（不走代理）
- `profiles` — profile 列表，`id: "max"` 为内置直连模式，不可删除
- 使用旧版 `models` / `activeModel` 的 profile 在加载时会自动迁移为 `ANTHROPIC_MODEL`
- 修改文件后约 1.5 秒自动生效（通过 `fs.watchFile` 监听），无需重启

## 按角色分源（高级）

当主 Agent 使用某个代理 profile 时，弹窗顶部会出现「角色分工」分配区，可让**子 Agent（SubAgent）**和 **Teammate** 分别指向与主 Agent 不同的源——典型用法是主 Agent 跑贵模型、子 Agent 跑便宜模型。

- 每个角色可选：**跟随主 Agent**（默认）/ **Default（内置直连）** / 任一 profile
- **count_tokens、心跳等 utility 请求永远跟随本进程主角色的源**（主进程内 = 主 Agent；Teammate 进程内 = Teammate 自己的分配）——第三方代理常不支持这些端点
- 子 Agent 角色只作用于带 `cc_is_subagent=true` 标记的请求（Claude Code ≥ 2.1.181）；更早版本的子代理请求与压缩/标题等轻量请求一样留在主 Agent 源
- Teammate 两种形态都支持：独立进程（`--agent-name` 识别，切换后约 1.5 秒经文件监听热生效）与同进程团队 agent（Claude Code 2.1.x 原生 agent teams，经 system prompt 团队标记识别，随 leader 进程热生效）
- 当主 Agent 切回 **Default 且端点为官方 api.anthropic.com** 时，分配区自动隐藏，已配置的角色分配**保留但不生效**（休眠），主 Agent 再次切到代理时原样恢复；Default 背后是自定义端点（如 env 里配了第三方地址）时分配区仍然可见且生效
- 角色分配按 workspace 隔离，存储在各项目的 `active-profile.json`（`{ activeId, roles }`）

说明：ccv 代理模式（`ccv run` / `ccv` CLI / Electron 标签页）同样按角色分流——proxy 在缓冲请求体后按角色选上游并交给重试引擎，统计按实际角色 profile 归属；唯一例外是代理模式下的**独立进程 teammate**，其官方端点休眠判定不生效（它看到的端点是本地代理地址）。
