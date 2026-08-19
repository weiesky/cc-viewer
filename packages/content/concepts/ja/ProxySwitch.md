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
| **ANTHROPIC_MODEL** | ❌ | プライマリモデル。`fable` / `mythos` ファミリーに属するモデルのリクエストはこの値に書き換えられます |
| **ANTHROPIC_DEFAULT_OPUS_MODEL** | ❌ | 拡張：`model` に `opus` を含むリクエストはこの値に書き換えられます |
| **ANTHROPIC_DEFAULT_SONNET_MODEL** | ❌ | 拡張：`model` に `sonnet` を含むリクエストはこの値に書き換えられます |
| **ANTHROPIC_DEFAULT_HAIKU_MODEL** | ❌ | 拡張：`model` に `haiku` を含むリクエストはこの値に書き換えられます |
| **強度レベル** | ❌ | リクエストボディに `output_config.effort`（`low`/`medium`/`high`/`xhigh`/`max`）を注入します。「デフォルト」のままにするとスキップされます |

モデルのマッチングはリクエストの `model` フィールドに対する大文字小文字を区別しない部分文字列判定なので、任意のバージョン（例：`claude-opus-4-8`、将来の `claude-opus-5`）が再設定なしで同じファミリーにマッピングされます。ファミリーのフィールドが空の場合、そのファミリーは変更されません。認識できないファミリーはそのまま透過されます。

## How It Works

When a proxy is active, `server/interceptor.js` performs the following before each API request:

1. **URL Rewrite** — Replaces the request origin with the proxy's Base URL
2. **Auth Replace** — Replaces `x-api-key` or `Authorization` header with the proxy's API Key
3. **Model Replace** — リクエストボディの `model` をファミリー単位で書き換えます（opus/sonnet/haiku → 対応するフィールド、fable/mythos → `ANTHROPIC_MODEL`）
4. **Effort Inject** — 強度レベルが設定されている場合、`output_config.effort` を注入します（`count_tokens` / ハートビートリクエストはスキップ）

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
- 旧形式の `models` / `activeModel` を使用する profile は、読み込み時に自動的に `ANTHROPIC_MODEL` へ移行されます
- Changes take effect within ~1.5 seconds (monitored via `fs.watchFile`), no restart needed
