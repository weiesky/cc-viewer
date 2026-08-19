# Hot-Switch Proxy

## Overview

Hot-Switch Proxy lets you dynamically redirect API requests to a different endpoint without restarting Claude Code. This is useful when using third-party API proxy services.

> ⚠️ Do not use this feature if you are a Claude Max subscriber.

## Fields

| Field | Required | Description |
|-------|----------|-------------|
| **Name** | ✅ | Display name for this proxy, used to identify it |
| **Base URL** | ✅ | Base URL of the API service (e.g. `https://api.example.com`). The original request origin will be replaced |
| **API Key** | ✅ | API key for the proxy service, replaces the original authentication |
| **ANTHROPIC_MODEL** | ❌ | 主模型。凡屬於 `fable` / `mythos` 家族的模型請求都會被改寫為此值 |
| **ANTHROPIC_DEFAULT_OPUS_MODEL** | ❌ | 擴充：`model` 包含 `opus` 的請求會被改寫為此值 |
| **ANTHROPIC_DEFAULT_SONNET_MODEL** | ❌ | 擴充：`model` 包含 `sonnet` 的請求會被改寫為此值 |
| **ANTHROPIC_DEFAULT_HAIKU_MODEL** | ❌ | 擴充：`model` 包含 `haiku` 的請求會被改寫為此值 |
| **強度等級** | ❌ | 向請求體注入 `output_config.effort`（`low`/`medium`/`high`/`xhigh`/`max`），保持「預設」則跳過 |

模型比對是對請求 `model` 欄位的大小寫無關子字串判斷，因此任意版本（如 `claude-opus-4-8`、未來的 `claude-opus-5`）都會映射到同一家族，無需重新設定。家族欄位留空表示該家族保持不變；無法辨識的家族會原樣透傳。

## How It Works

When a proxy is active, `server/interceptor.js` performs the following before each API request:

1. **URL Rewrite** — Replaces the request origin with the proxy's Base URL
2. **Auth Replace** — Replaces `x-api-key` or `Authorization` header with the proxy's API Key
3. **Model Replace** — 依家族改寫請求體的 `model` 欄位（opus/sonnet/haiku → 對應欄位；fable/mythos → `ANTHROPIC_MODEL`）
4. **Effort Inject** — 若設定了強度等級，則注入 `output_config.effort`（`count_tokens` / 心跳請求會跳過）

## Config File

Configuration is stored at `~/.claude/cc-viewer/profile.json`. Click the folder icon in the title to open the directory:

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

- `active` — ID of the current profile. Set to `"max"` for direct connection (no proxy)
- `profiles` — Profile list. `id: "max"` is built-in and cannot be deleted
- 使用舊版 `models` / `activeModel` 的 profile 在載入時會自動遷移為 `ANTHROPIC_MODEL`
- Changes take effect within ~1.5 seconds (monitored via `fs.watchFile`), no restart needed
