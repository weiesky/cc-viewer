# Response Body 字段说明

Claude API `/v1/messages` 响应体的字段说明。

## 顶层字段

| 字段 | 类型 | 说明 |
|------|------|------|
| **model** | string | 实际使用的模型名称，如 `claude-opus-4-6` |
| **id** | string | 本次响应的唯一标识符，如 `msg_01Tgsr2QeH8AVXGoP2wAXRvU` |
| **type** | string | 固定为 `"message"` |
| **role** | string | 固定为 `"assistant"` |
| **content** | array | 模型输出的内容块数组，包含文本、工具调用、思考过程等 |
| **stop_reason** | string | 停止原因：`"end_turn"`（正常结束）、`"tool_use"`（需要执行工具）、`"max_tokens"`（达到 token 上限） |
| **stop_sequence** | string/null | 触发停止的序列，通常为 `null` |
| **usage** | object | Token 用量统计（详见下方） |

## content 块类型

| 类型 | 说明 |
|------|------|
| **text** | 模型的文本回复，含 `text` 字段 |
| **tool_use** | 工具调用请求，含 `name`（工具名）、`input`（参数）、`id`（调用 ID，用于匹配 tool_result） |
| **thinking** | 扩展思考内容（仅在开启 thinking 模式时出现），含 `thinking` 字段 |

## usage 字段详解

| 字段 | 说明 |
|------|------|
| **input_tokens** | 未命中缓存的输入 token 数（需要全价计费） |
| **cache_creation_input_tokens** | 本次新创建缓存的 token 数（缓存写入，计费高于普通输入） |
| **cache_read_input_tokens** | 命中缓存的 token 数（缓存读取，计费远低于普通输入） |
| **output_tokens** | 模型输出的 token 数 |
| **service_tier** | 服务等级，如 `"standard"` |
| **inference_geo** | 推理地域，如 `"not_available"` 表示未提供地域信息 |

## cache_creation 子字段

| 字段 | 说明 |
|------|------|
| **ephemeral_5m_input_tokens** | 5 分钟 TTL 的短期缓存创建 token 数 |
| **ephemeral_1h_input_tokens** | 1 小时 TTL 的长期缓存创建 token 数 |

> **关于缓存计费**：`cache_read_input_tokens` 的单价远低于 `input_tokens`，而 `cache_creation_input_tokens` 的单价略高于普通输入。因此，在持续对话中保持高缓存命中率可以显著降低费用。通过 cc-viewer 的"命中率"指标可以直观监控这一比例。

## stop_reason 含义

- **end_turn**：模型正常完成回复
- **tool_use**：模型需要调用工具，content 中会包含 `tool_use` 块。下一轮请求需要在 messages 中追加 `tool_result` 才能继续对话
- **max_tokens**：达到 `max_tokens` 限制被截断，回复可能不完整
