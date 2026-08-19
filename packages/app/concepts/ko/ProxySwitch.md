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
| **ANTHROPIC_MODEL** | ❌ | 기본 모델. `fable` / `mythos` 계열에 속하는 모델 요청은 이 값으로 재작성됩니다 |
| **ANTHROPIC_DEFAULT_OPUS_MODEL** | ❌ | 확장: `model`에 `opus`가 포함된 요청은 이 값으로 재작성됩니다 |
| **ANTHROPIC_DEFAULT_SONNET_MODEL** | ❌ | 확장: `model`에 `sonnet`이 포함된 요청은 이 값으로 재작성됩니다 |
| **ANTHROPIC_DEFAULT_HAIKU_MODEL** | ❌ | 확장: `model`에 `haiku`가 포함된 요청은 이 값으로 재작성됩니다 |
| **강도 레벨** | ❌ | 요청 본문에 `output_config.effort`(`low`/`medium`/`high`/`xhigh`/`max`)를 주입합니다. "기본값"으로 두면 건너뜁니다 |

모델 매칭은 요청의 `model` 필드에 대한 대소문자 구분 없는 부분 문자열 판정이므로, 어떤 버전(예: `claude-opus-4-8`, 향후 `claude-opus-5`)이든 재설정 없이 동일한 계열로 매핑됩니다. 계열 필드를 비워 두면 해당 계열은 변경되지 않으며, 인식할 수 없는 계열은 그대로 통과됩니다.

## How It Works

When a proxy is active, `server/interceptor.js` performs the following before each API request:

1. **URL Rewrite** — Replaces the request origin with the proxy's Base URL
2. **Auth Replace** — Replaces `x-api-key` or `Authorization` header with the proxy's API Key
3. **Model Replace** — 요청 본문의 `model`을 계열 단위로 재작성합니다(opus/sonnet/haiku → 해당 필드, fable/mythos → `ANTHROPIC_MODEL`)
4. **Effort Inject** — 강도 레벨이 설정되어 있으면 `output_config.effort`를 주입합니다(`count_tokens` / 하트비트 요청은 건너뜀)

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
- 레거시 `models` / `activeModel`을 사용하는 profile은 로드 시 자동으로 `ANTHROPIC_MODEL`로 마이그레이션됩니다
- Changes take effect within ~1.5 seconds (monitored via `fs.watchFile`), no restart needed
