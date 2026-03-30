# Cache Rebuild（缓存重建）

## 背景

Anthropic 的 prompt caching 机制会将请求中的 system → tools → messages（到 cache breakpoint）按顺序拼接为缓存键。当缓存键与上一次请求完全一致时，API 返回 `cache_read_input_tokens`（缓存命中）；当缓存键发生变化，API 会重新创建缓存，返回大量 `cache_creation_input_tokens`，即缓存重建。

缓存重建意味着额外的 token 计费（cache creation 的价格高于 cache read），因此识别重建原因对费用优化有直接价值。

## 缓存重建原因分类

cc-viewer 通过对比前后两个 MainAgent 请求的 body，精确判断缓存重建的原因：

| reason | 含义 | 判断方式 |
|--------|------|----------|
| `ttl` | 缓存过期 | 距上一个 MainAgent 请求超过 5 分钟 |
| `system_change` | system prompt 变更 | `JSON.stringify(prev.system) !== JSON.stringify(curr.system)` |
| `tools_change` | 工具定义变更 | `JSON.stringify(prev.tools) !== JSON.stringify(curr.tools)` |
| `model_change` | 模型切换 | `prev.model !== curr.model` |
| `msg_truncated` | 消息栈被截断 | 当前请求的 messages 数量少于上一个请求，通常因上下文窗口溢出触发截断 |
| `msg_modified` | 历史消息修改 | 前缀消息内容不一致（正常追加时前缀应完全相同） |
| `key_change` | 未知键变更 | 以上条件均不匹配时的 fallback |

## 判断优先级

1. 首先检查时间间隔——超过 5 分钟直接判定为 `ttl`，不再做 body 对比
2. 然后依次检查 model、system、tools、messages
3. 一个请求可能同时命中多个原因（如模型切换 + system prompt 变更），此时 `reasons` 数组包含所有匹配项，tooltip 换行显示

## 常见场景

- **`ttl`**：用户暂停操作超过 5 分钟后继续，缓存自然过期
- **`system_change`**：Claude Code 更新了 system prompt（如加载新的 CLAUDE.md、project instructions 变化）
- **`tools_change`**：MCP server 连接/断开导致可用工具列表变化
- **`model_change`**：用户通过 `/model` 命令切换模型
- **`msg_truncated`**：对话过长触发上下文窗口管理，Claude Code 截断早期消息
- **`msg_modified`**：Claude Code 对历史消息做了编辑（如 `/compact` 压缩摘要替换原始消息）
