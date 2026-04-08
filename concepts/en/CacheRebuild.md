# Cache Rebuild

## Background

Anthropic's prompt caching mechanism concatenates system → tools → messages (up to the cache breakpoint) in order to form the cache key. When the cache key matches the previous request exactly, the API returns `cache_read_input_tokens` (cache hit); when the cache key changes, the API recreates the cache and returns a large number of `cache_creation_input_tokens`, i.e., a cache rebuild.

Cache rebuilds mean additional token charges (cache creation is priced higher than cache read), so identifying rebuild causes has direct value for cost optimization.

## Cache Rebuild Reason Categories

cc-viewer compares the bodies of two consecutive MainAgent requests to precisely determine the cause of a cache rebuild:

| reason | Meaning | Detection Method |
|--------|---------|------------------|
| `ttl` | Cache expired | More than 5 minutes since the last MainAgent request |
| `system_change` | System prompt changed | `JSON.stringify(prev.system) !== JSON.stringify(curr.system)` |
| `tools_change` | Tool definitions changed | `JSON.stringify(prev.tools) !== JSON.stringify(curr.tools)` |
| `model_change` | Model switched | `prev.model !== curr.model` |
| `msg_truncated` | Message stack truncated | Current request has fewer messages than the previous one, usually triggered by context window overflow |
| `msg_modified` | Historical messages modified | Prefix message content is inconsistent (prefix should be identical during normal appending) |
| `key_change` | Unknown key change | Fallback when none of the above conditions match |

## Detection Priority

1. First check the time interval — if more than 5 minutes, immediately classify as `ttl` without body comparison
2. Then check model, system, tools, and messages in sequence
3. A single request may match multiple reasons (e.g., model switch + system prompt change), in which case the `reasons` array contains all matches and the tooltip displays them on separate lines

## Common Scenarios

- **`ttl`**: The user paused for more than 5 minutes before continuing, and the cache naturally expired
- **`system_change`**: Claude Code updated the system prompt (e.g., loaded new CLAUDE.md, project instructions changed)
- **`tools_change`**: MCP server connection/disconnection caused changes to the available tool list
- **`model_change`**: The user switched models via the `/model` command
- **`msg_truncated`**: A long conversation triggered context window management, and Claude Code truncated earlier messages
- **`msg_modified`**: Claude Code edited historical messages (e.g., `/compact` replaced original messages with a compressed summary)
