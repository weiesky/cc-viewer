# Request Body 字段说明

Claude API `/v1/messages` 请求体的顶层字段说明。

## 字段列表

| 字段 | 类型 | 说明 |
|------|------|------|
| **model** | string | 使用的模型名称，如 `claude-opus-4-6`、`claude-sonnet-4-6` |
| **messages** | array | 对话消息历史。每条消息包含 `role`（user/assistant）和 `content`（文本、图片、tool_use、tool_result 等 block 数组） |
| **system** | array | System prompt。包含 Claude Code 的核心指令、工具使用说明、环境信息、CLAUDE.md 内容等。带 `cache_control` 的块会被 prompt caching |
| **tools** | array | 可用工具定义列表。每个工具包含 `name`、`description` 和 `input_schema`（JSON Schema）。MainAgent 通常有 20+ 工具，SubAgent 只有少量 |
| **metadata** | object | 请求元数据，通常包含 `user_id` 用于标识用户 |
| **max_tokens** | number | 模型单次回复的最大 token 数，如 `16000`、`64000` |
| **thinking** | object | 扩展思考配置。`type: "enabled"` 开启思考模式，`budget_tokens` 控制思考 token 上限 |
| **context_management** | object | 上下文管理配置。`truncation: "auto"` 允许 Claude Code 自动截断过长的消息历史 |
| **output_config** | object | 输出配置，如 `format` 设置 |
| **stream** | boolean | 是否启用流式响应。Claude Code 始终使用 `true` |

## messages 结构

每条消息的 `content` 是一个 block 数组，常见类型：

- **text**: 普通文本内容
- **tool_use**: 模型调用工具（含 `name`、`input`）
- **tool_result**: 工具执行结果（含 `tool_use_id`、`content`）
- **image**: 图片内容（base64 或 URL）
- **thinking**: 模型的思考过程（扩展思考模式）

## system 结构

system prompt 数组中通常包含：

1. **核心 agent 指令**（"You are Claude Code..."）
2. **工具使用规范**
3. **CLAUDE.md 内容**（项目级指令）
4. **技能提示**（skills reminder）
5. **环境信息**（OS、shell、git 状态等）— 事实上 Claude Code 非常依赖 git。如果项目存在 git 仓库，Claude Code 能展现出对项目更好的理解能力，包括可以拉取远端的变更和 commit 记录来辅助分析

带 `cache_control: { type: "ephemeral" }` 标记的块会被 Anthropic API 缓存 5 分钟，命中缓存时以 `cache_read_input_tokens` 计费（远低于 `input_tokens`）。

> **注意**：对于 Claude Code 这类特殊客户端，Anthropic 服务端实际上并不完全依赖请求中的 `cache_control` 属性来决定缓存行为。服务端会对特定字段（如 system prompt、tools 定义）自动执行缓存策略，即使请求中未显式携带 `cache_control` 标记。因此，当你在请求体中没有看到该属性时不必疑惑——服务端已在幕后完成了缓存操作，只是未将此信息暴露给客户端。这是 Claude Code 与 Anthropic API 之间的一种默契。
