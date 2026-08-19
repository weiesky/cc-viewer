# KV-Cache Content

## What is Prompt Caching?

When you chat with Claude, each API request sends the full conversation context (system prompt + tool definitions + historical messages). Anthropic's prompt caching mechanism caches previously computed prefix content on the server side. If the prefix of a subsequent request matches, the cached result is reused directly, skipping redundant computation and significantly reducing latency and cost.

In cc-viewer, this mechanism is referred to as "KV-Cache", corresponding to Anthropic's API-level prompt caching — not the key-value cache within the transformer attention layers of the LLM itself.

## How Caching Works

Anthropic's prompt caching concatenates the cache key in a fixed order:

```
Tools → System Prompt → Messages (up to cache breakpoint)
```

As long as this prefix exactly matches any request within the TTL window, the API returns a cache hit (`cache_read_input_tokens`) rather than recomputing (`cache_creation_input_tokens`).

> **Claude Code does not strongly depend on the `cache_control` attribute. The server will strip some of these attributes accordingly, yet caching still works well. So not seeing `cache_control` does not mean the content is not cached.**
>
> For special clients like Claude Code, Anthropic's server does not fully rely on the `cache_control` attribute in requests to determine caching behavior. The server automatically applies caching policies to specific fields (such as system prompt and tool definitions), even when the request does not explicitly include `cache_control` markers. Therefore, when you don't see this attribute in the request body, don't be puzzled — the server has already performed the caching operation behind the scenes, it simply hasn't exposed this information to the client. This is a tacit understanding between Claude Code and the Anthropic API.

## What is "Current KV-Cache Content"?

The "Current KV-Cache Content" displayed in cc-viewer is extracted from the most recent MainAgent request — specifically the content before the cache boundary (cache breakpoint). It includes:

- **System Prompt**: Claude Code's system instructions, including core agent directives, tool usage specifications, CLAUDE.md project instructions, environment information, etc.
- **Tools**: The current list of available tool definitions (such as Read, Write, Bash, Agent, MCP tools, etc.)
- **Messages**: The portion of conversation history that is cached (typically earlier messages, up to the last `cache_control` marker)

## Why View Cache Content?

1. **Understand Context**: See what Claude currently "remembers" to help you judge whether its behavior matches expectations
2. **Cost Optimization**: Cache hits cost far less than recomputation. Viewing cache content helps you understand why certain requests triggered a cache rebuild
3. **Debug Conversations**: When Claude's responses don't match expectations, checking cache content confirms whether the system prompt and historical messages are correct
4. **Context Quality Monitoring**: During debugging, configuration changes, or prompt adjustments, KV-Cache-Text provides a centralized view to quickly confirm whether core context has degraded or been unexpectedly polluted — without manually reviewing raw messages

## Multi-Level Caching Strategy

The KV-Cache corresponding to Claude Code is not a single cache. The server generates separate caches for Tools and System Prompt, independent from the Messages cache. The benefit of this design is: when the messages stack becomes corrupted (e.g., context truncation, message modification) and needs rebuilding, it won't invalidate the Tools and System Prompt caches along with it, avoiding a full recomputation.

This is a current server-side optimization strategy — because Tool definitions and the System Prompt remain relatively stable during normal use and rarely change. Caching them separately minimizes unnecessary rebuild overhead. So when you observe the cache, you'll notice that apart from Tools rebuilds which require a full cache refresh, disruptions to the System Prompt and Messages still have inheritable caches available.

## Cache Lifecycle

- **Creation**: On first request or after cache expiration, the API creates a new cache (`cache_creation_input_tokens`)
- **Hit**: Subsequent requests with matching prefixes reuse the cache (`cache_read_input_tokens`)
- **Expiration**: Cache has a 5-minute TTL (time-to-live) and automatically expires after timeout
- **Rebuild**: When system prompt, tool list, model, or message content changes, the cache key no longer matches, triggering a rebuild at the corresponding level
