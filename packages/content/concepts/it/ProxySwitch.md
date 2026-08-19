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
| **ANTHROPIC_MODEL** | ❌ | Primary model. Requests whose model belongs to the `fable` / `mythos` family are rewritten to this |
| **ANTHROPIC_DEFAULT_OPUS_MODEL** | ❌ | Extended: requests whose model contains `opus` are rewritten to this |
| **ANTHROPIC_DEFAULT_SONNET_MODEL** | ❌ | Extended: requests whose model contains `sonnet` are rewritten to this |
| **ANTHROPIC_DEFAULT_HAIKU_MODEL** | ❌ | Extended: requests whose model contains `haiku` are rewritten to this |
| **Effort Level** | ❌ | Injects `output_config.effort` (`low`/`medium`/`high`/`xhigh`/`max`) into the request body. Leave as "Default" to skip |

Model matching is a case-insensitive substring test on the request's `model` field, so any version (e.g. `claude-opus-4-8`, a future `claude-opus-5`) maps to the same family with no reconfiguration. An empty family field means that family is left unchanged; an unrecognized family is passed through untouched.

## How It Works

When a proxy is active, `server/interceptor.js` performs the following before each API request:

1. **URL Rewrite** — Replaces the request origin with the proxy's Base URL
2. **Auth Replace** — Replaces `x-api-key` or `Authorization` header with the proxy's API Key
3. **Model Replace** — Rewrites the request body `model` by family (opus/sonnet/haiku → the matching field; fable/mythos → `ANTHROPIC_MODEL`)
4. **Effort Inject** — If an effort level is set, injects `output_config.effort` (skipped for `count_tokens` / heartbeat requests)

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
- Legacy profiles using `models` / `activeModel` are auto-migrated to `ANTHROPIC_MODEL` on load
- Changes take effect within ~1.5 seconds (monitored via `fs.watchFile`), no restart needed
