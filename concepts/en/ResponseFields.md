# Response Body Field Reference

Field reference for the Claude API `/v1/messages` response body.

## Top-Level Fields

| Field | Type | Description |
|-------|------|-------------|
| **model** | string | The model name actually used, e.g. `claude-opus-4-6` |
| **id** | string | Unique identifier for this response, e.g. `msg_01Tgsr2QeH8AVXGoP2wAXRvU` |
| **type** | string | Always `"message"` |
| **role** | string | Always `"assistant"` |
| **content** | array | Array of content blocks output by the model, containing text, tool calls, thinking process, etc. |
| **stop_reason** | string | Reason for stopping: `"end_turn"` (normal completion), `"tool_use"` (tool execution needed), `"max_tokens"` (token limit reached) |
| **stop_sequence** | string/null | The sequence that triggered the stop, usually `null` |
| **usage** | object | Token usage statistics (see below) |

## content Block Types

| Type | Description |
|------|-------------|
| **text** | The model's text reply, contains a `text` field |
| **tool_use** | Tool call request, contains `name` (tool name), `input` (parameters), `id` (call ID, used to match tool_result) |
| **thinking** | Extended thinking content (only appears when thinking mode is enabled), contains a `thinking` field |

## usage Field Details

| Field | Description |
|-------|-------------|
| **input_tokens** | Number of input tokens that did not hit the cache (billed at full price) |
| **cache_creation_input_tokens** | Number of tokens for newly created cache entries (cache write, billed higher than normal input) |
| **cache_read_input_tokens** | Number of tokens that hit the cache (cache read, billed much lower than normal input) |
| **output_tokens** | Number of tokens output by the model |
| **service_tier** | Service tier, e.g. `"standard"` |
| **inference_geo** | Inference geography, e.g. `"not_available"` means no geography info is provided |

## cache_creation Sub-Fields

| Field | Description |
|-------|-------------|
| **ephemeral_5m_input_tokens** | Number of tokens for short-term cache creation with a 5-minute TTL |
| **ephemeral_1h_input_tokens** | Number of tokens for long-term cache creation with a 1-hour TTL |

> **About cache billing**: The unit price of `cache_read_input_tokens` is much lower than `input_tokens`, while the unit price of `cache_creation_input_tokens` is slightly higher than normal input. Therefore, maintaining a high cache hit rate in ongoing conversations can significantly reduce costs. You can visually monitor this ratio through the "Hit Rate" metric in cc-viewer.

## stop_reason Meanings

- **end_turn**: The model completed its reply normally
- **tool_use**: The model needs to call a tool; the content will include a `tool_use` block. The next request must append a `tool_result` in the messages to continue the conversation
- **max_tokens**: The reply was truncated due to reaching the `max_tokens` limit and may be incomplete
