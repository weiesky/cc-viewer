---
name: cc-viewer-jsonl
description: JSONL log file management rules for cc-viewer. Use when working on cc-viewer's log file creation, rotation, resume, cleanup, or file watching logic. Covers interceptor.js and server.js log lifecycle. Also covers the detailed record schema including request body, response body, stream assembly, and cache-related fields.
---

# CC-Viewer JSONL Log Management

> **Important:** If any JSONL-related rules are changed in `interceptor.js` or `server.js`, update this skill file accordingly to keep it in sync.

## File Location & Naming

- Base directory: `~/.claude/cc-viewer/`
- Project directory: `~/.claude/cc-viewer/{projectName}/`
- File pattern: `{projectName}_{YYYYMMDD_HHMMSS}.jsonl`
- Project name: `basename(cwd)`, special chars → `_`
- File name retains project name for portability when moved independently

## Record Format

Records separated by `\n---\n` (not standard JSONL line-delimited). Each record is a pretty-printed JSON object (`JSON.stringify(entry, null, 2)`).

### Top-Level Schema

```json
{
  "timestamp": "2026-02-23T07:42:24.243Z",
  "project": "cc-viewer",
  "url": "https://api.anthropic.com/v1/messages?beta=true",
  "method": "POST",
  "headers": {
    "anthropic-beta": "interleaved-thinking-2025-05-14,prompt-caching-scope-2026-01-05",
    "anthropic-version": "2023-06-01",
    "authorization": "Bearer sk-...",
    "content-type": "application/json",
    "user-agent": "..."
  },
  "body": { /* request body — see below */ },
  "response": {
    "status": 200,
    "statusText": "OK",
    "headers": { /* response headers */ },
    "body": { /* assembled message — see below */ }
  },
  "duration": 1234,
  "isStream": true,
  "isHeartbeat": false,
  "mainAgent": true
}
```

### `body` — Request Body

The full Claude API request body, parsed from `options.body`:

```json
{
  "model": "claude-opus-4-6",
  "max_tokens": 16384,
  "stream": true,
  "system": [
    { "type": "text", "text": "..." },
    { "type": "text", "text": "...", "cache_control": { "type": "ephemeral" } },
    { "type": "text", "text": "...", "cache_control": { "type": "ephemeral" } }
  ],
  "messages": [
    {
      "role": "user",
      "content": [{ "type": "text", "text": "..." }]
    },
    {
      "role": "assistant",
      "content": [
        { "type": "thinking", "thinking": "..." },
        { "type": "text", "text": "..." },
        { "type": "tool_use", "id": "tooluse_xxx", "name": "Edit", "input": {...} }
      ]
    },
    {
      "role": "user",
      "content": [
        { "type": "tool_result", "tool_use_id": "tooluse_xxx", "content": "..." }
      ]
    }
  ],
  "tools": [ /* tool definitions */ ]
}
```

Key points:
- `system` is an array of text blocks; `cache_control` may appear on any block
- `messages[].content` blocks may carry `cache_control: { "type": "ephemeral" }` — Claude Code places it on the last 2 messages (倒数第二条 assistant + 最后一条 user)
- `body.stream` determines whether the response is SSE stream or direct JSON

### `response.body` — Response Body

#### Stream responses (`isStream: true`)

The interceptor captures the full SSE stream, then assembles it into a single message object via `assembleStreamMessage()`. The assembled result replaces `response.body`:

```json
{
  "id": "msg_xxx",
  "type": "message",
  "role": "assistant",
  "model": "claude-opus-4-6",
  "content": [
    { "type": "thinking", "thinking": "..." },
    { "type": "text", "text": "..." },
    { "type": "tool_use", "id": "tooluse_xxx", "name": "Bash", "input": { "command": "..." } }
  ],
  "stop_reason": "tool_use",
  "usage": {
    "cache_creation": {
      "ephemeral_1h_input_tokens": 0,
      "ephemeral_5m_input_tokens": 29213
    },
    "cache_creation_input_tokens": 29213,
    "cache_read_input_tokens": 823,
    "input_tokens": 8,
    "output_tokens": 213,
    "service_tier": "standard"
  }
}
```

Stream assembly logic (`assembleStreamMessage` in interceptor.js):
1. Parse SSE blocks → extract `data:` lines → JSON parse each event
2. `message_start` → initialize message object with `usage` from event
3. `content_block_start` → create content block (text/thinking/tool_use)
4. `content_block_delta` → append text/thinking/input_json deltas
5. `content_block_stop` → finalize block (parse accumulated tool_use input JSON)
6. `message_delta` → merge `stop_reason`, `usage` into message
7. Final `message.content` = assembled content blocks array

#### Non-stream responses (`isStream: false`)

Response body is the raw parsed JSON from `response.text()`.

### Computed Fields

- `isStream`: `body.stream === true`
- `isHeartbeat`: URL matches `/\/api\/eval\/sdk-/`
- `mainAgent`: true when ALL of:
  1. `body.system` exists
  2. `body.tools` is array with >10 tools
  3. Tools include `Task`, `Edit`, `Bash`
  4. System text contains `"You are Claude Code"`
  5. System text does NOT match SubAgent patterns (`command execution specialist`, `file search specialist`, `planning specialist`, `general-purpose agent`)

### Cache-Related Fields in `response.body.usage`

| Field | Description |
|---|---|
| `cache_read_input_tokens` | Tokens read from cache (billed at 10% of input price) |
| `cache_creation_input_tokens` | Tokens written to cache (billed at 125% of input price) |
| `cache_creation.ephemeral_5m_input_tokens` | 5-minute TTL cache creation breakdown |
| `cache_creation.ephemeral_1h_input_tokens` | 1-hour TTL cache creation breakdown |
| `input_tokens` | Non-cached input tokens |
| `output_tokens` | Output tokens |
| `service_tier` | Service tier used (`standard`, etc.) |

## Lifecycle

### 1. Startup

1. Generate new file path with current timestamp
2. Clean up `_temp.jsonl` residuals (rename to `.jsonl` or merge+delete)
3. Check for recent log: find latest file for same project → prompt resume (no time limit)

### 2. Resume Flow

- Recent log found → write to `_temp.jsonl` while waiting for user choice
- User chooses "continue" → append temp content to old file, use old file
- User chooses "new" → rename temp to permanent, use new file

### 3. Writing

- Stream requests: intercept SSE stream via `ReadableStream` proxy, assemble on stream end, then `appendFileSync`
- Non-stream requests: clone response, read text, parse JSON, then `appendFileSync`
- Entry format: `JSON.stringify(entry, null, 2) + '\n---\n'`
- Parsing: `content.split('\n---\n').filter(trim).map(JSON.parse)`

### 4. Rotation

- Trigger: every MainAgent request checks file size
- Threshold: 200MB (`MAX_LOG_SIZE`)
- Action: generate new file path, switch `LOG_FILE`; old file untouched

### 5. Server File Watching

- `server.js` watches `LOG_FILE` with `fs.watchFile`
- Detects rotation: if `LOG_FILE` changed, start watching new file
- Parses new entries, pushes via SSE to browser clients
- Supports `full_reload` event for initial batch load

## Key Rules

- No automatic deletion or retention policy
- Resume prompt: always shown when same-project log exists (no time limit)
- Temp files always cleaned on startup and process exit
- MainAgent detection: see Computed Fields above
- Multi-instance: ports 7008-7099
- URL filter: only intercept requests to URLs containing `anthropic`, `claude`, or custom API host; exclude `/messages/count_tokens`
- API key caching: first seen `x-api-key` header is cached in `_cachedApiKey` for translation API reuse
