# Request Body Fields

Field descriptions for the top-level fields in the Claude API `/v1/messages` request body.

## Field List

| Field | Type | Description |
|-------|------|-------------|
| **model** | string | The model name to use, e.g. `claude-opus-4-6`, `claude-sonnet-4-6` |
| **messages** | array | Conversation message history. Each message contains `role` (user/assistant) and `content` (an array of blocks such as text, image, tool_use, tool_result, etc.) |
| **system** | array | System prompt. Contains Claude Code's core instructions, tool usage guidelines, environment information, CLAUDE.md contents, etc. Blocks with `cache_control` are subject to prompt caching |
| **tools** | array | List of available tool definitions. Each tool contains `name`, `description`, and `input_schema` (JSON Schema). MainAgent typically has 20+ tools, while SubAgent has only a few |
| **metadata** | object | Request metadata, usually containing `user_id` to identify the user |
| **max_tokens** | number | Maximum number of tokens for a single model response, e.g. `16000`, `64000` |
| **thinking** | object | Extended thinking configuration. `type: "enabled"` activates thinking mode, `budget_tokens` controls the thinking token limit |
| **context_management** | object | Context management configuration. `truncation: "auto"` allows Claude Code to automatically truncate overly long message histories |
| **output_config** | object | Output configuration, such as `format` settings |
| **stream** | boolean | Whether to enable streaming responses. Claude Code always uses `true` |

## messages Structure

The `content` of each message is an array of blocks. Common types include:

- **text**: Plain text content
- **tool_use**: Model tool invocation (contains `name`, `input`)
- **tool_result**: Tool execution result (contains `tool_use_id`, `content`)
- **image**: Image content (base64 or URL)
- **thinking**: Model's thinking process (extended thinking mode)

## system Structure

The system prompt array typically contains:

1. **Core agent instructions** ("You are Claude Code...")
2. **Tool usage guidelines**
3. **CLAUDE.md contents** (project-level instructions)
4. **Skills reminders** (skills reminder)
5. **Environment information** (OS, shell, git status, etc.) — In fact, Claude Code relies heavily on git. If a project has a git repository, Claude Code demonstrates a better understanding of the project, including the ability to pull remote changes and commit history to assist with analysis

Blocks marked with `cache_control: { type: "ephemeral" }` are cached by the Anthropic API for 5 minutes. When cache hits occur, they are billed as `cache_read_input_tokens` (significantly cheaper than `input_tokens`).

> **Note**: For special clients like Claude Code, the Anthropic server does not rely entirely on the `cache_control` attribute in the request to determine caching behavior. The server automatically applies caching strategies to specific fields (such as system prompt and tools definitions), even when the request does not explicitly include `cache_control` markers. Therefore, don't be puzzled when you don't see this attribute in the request body — the server has already performed caching behind the scenes, it simply doesn't expose this information to the client. This is a tacit understanding between Claude Code and the Anthropic API.
