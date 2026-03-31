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
| **模型** | ❌ | 代理支持的模型列表，用逗号分隔（如 `model-a, model-b`） |
| **当前模型** | ❌ | 从模型列表中选择当前使用的模型，请求中的 `model` 字段会被替换 |

## 工作原理

切换代理后，`interceptor.js` 会在每次 API 请求发出前执行以下操作：

1. **URL 重写** — 将请求的 origin 替换为代理的 Base URL
2. **认证替换** — 将请求头中的 `x-api-key` 或 `Authorization` 替换为代理的 API Key
3. **模型替换** — 如果指定了当前模型，将请求体中的 `model` 字段替换

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
      "models": ["model-a", "model-b"],
      "activeModel": "model-a"
    }
  ]
}
```

- `active` — 当前使用的 profile ID，设为 `"max"` 表示直连（不走代理）
- `profiles` — profile 列表，`id: "max"` 为内置直连模式，不可删除
- 修改文件后约 1.5 秒自动生效（通过 `fs.watchFile` 监听），无需重启
