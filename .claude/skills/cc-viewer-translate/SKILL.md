---
name: cc-viewer-translate
description: Translate text via cc-viewer's built-in translation API endpoint (POST /api/translate). Use when translating UI strings, user content, or any text between the 18 supported languages. Supports single text or batch array input, auto-detects target language from user preferences or OS locale.
---

# cc-viewer Translate API

## Endpoint

```
POST http://localhost:{port}/api/translate
Content-Type: application/json
```

Port defaults to `7008` (range 7008–7099).

## Request Body

| Field  | Type               | Required | Default                          | Description          |
|--------|--------------------|----------|----------------------------------|----------------------|
| `text` | `string \| string[]` | Yes      | —                                | Text(s) to translate |
| `from` | `string`           | No       | `"en"`                           | Source language code  |
| `to`   | `string`           | No       | User pref → OS locale → `"en"`  | Target language code  |

## Response

```json
{
  "text": "translated text or array",
  "from": "en",
  "to": "zh"
}
```

When `text` input is an array, the response `text` is also an array.

## Supported Language Codes

`zh`, `zh-TW`, `en`, `ko`, `de`, `es`, `fr`, `it`, `da`, `ja`, `pl`, `ru`, `ar`, `no`, `pt-BR`, `th`, `tr`, `uk`

## Error Codes

| Status | Meaning                        |
|--------|--------------------------------|
| 400    | Missing `text` field           |
| 501    | No API key available           |
| 502    | Upstream Claude API call failed |
| 500    | Internal server error          |

## How It Works

- Uses the Claude API (`claude-haiku-4-20250514`) for translation
- API key is obtained from `ANTHROPIC_API_KEY` env var or intercepted from Claude Code requests
- Base URL respects `ANTHROPIC_BASE_URL` env var
- If `from === to`, returns the original text without calling the API

## Examples

Single text:
```bash
curl -X POST http://localhost:7008/api/translate \
  -H 'Content-Type: application/json' \
  -d '{"text": "Hello world", "to": "zh"}'
```

Array of texts:
```bash
curl -X POST http://localhost:7008/api/translate \
  -H 'Content-Type: application/json' \
  -d '{"text": ["Hello", "Goodbye"], "to": "ja"}'
```

Auto-detect target language (uses user preference or OS locale):
```bash
curl -X POST http://localhost:7008/api/translate \
  -H 'Content-Type: application/json' \
  -d '{"text": "Hello world"}'
```
