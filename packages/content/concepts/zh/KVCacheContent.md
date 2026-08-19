# KV-Cache 缓存内容

## 什么是 Prompt Caching？

当你与 Claude 对话时，每次 API 请求都会发送完整的对话上下文（system prompt + 工具定义 + 历史消息）。Anthropic 的 prompt caching 机制会将已经计算过的前缀内容缓存在服务端，后续请求如果前缀一致，则直接复用缓存结果，跳过重复计算，大幅降低延迟和费用。

cc-viewer 中将这一机制称为"KV-Cache"，对应的是 Anthropic API 层面的 prompt caching，而非 LLM 内部 transformer 注意力层的 key-value cache。

## 缓存的工作原理

Anthropic 的 prompt caching 按照固定顺序拼接缓存键：

```
Tools → System Prompt → Messages（到 cache breakpoint）
```

只要这个前缀与 TTL 窗口内的任意一次请求完全一致，API 就会命中缓存（返回 `cache_read_input_tokens`），而非重新计算（`cache_creation_input_tokens`）。

> **Claude Code 对 `cache_control` 属性并不强依赖，服务端会配合剔除部分这些属性，但依然能够很好的创建缓存，所以没有看到 `cache_control` 属性并不代表没有被缓存**
>
> 对于 Claude Code 这类特殊客户端，Anthropic 服务端并不完全依赖请求中的 `cache_control` 属性来决定缓存行为。服务端会对特定字段（如 system prompt、tools 定义）自动执行缓存策略，即使请求中未显式携带 `cache_control` 标记。因此，当你在请求体中没有看到该属性时不必疑惑——服务端已在幕后完成了缓存操作，只是未将此信息暴露给客户端。这是 Claude Code 与 Anthropic API 之间的一种默契。

## "当前 KV-Cache 缓存内容"是什么？

cc-viewer 中显示的"当前 KV-Cache 缓存内容"，是从最近一次 MainAgent 请求中提取的、位于缓存边界（cache breakpoint）之前的内容。具体包括：

- **System Prompt**：Claude Code 的系统指令，包含核心 agent 指令、工具使用规范、CLAUDE.md 项目指令、环境信息等
- **Tools**：当前可用的工具定义列表（如 Read、Write、Bash、Agent、MCP 工具等）
- **Messages**：对话历史中被缓存的部分（通常是较早的消息，直到最后一个 `cache_control` 标记处）

## 为什么要查看缓存内容？

1. **理解上下文**：了解 Claude 当前"记住"了哪些内容，帮助你判断它的行为是否符合预期
2. **费用优化**：缓存命中时费用远低于重新计算。查看缓存内容可以帮助你理解为什么某些请求触发了缓存重建（cache rebuild）
3. **调试对话**：当 Claude 的回答不符合预期时，检查缓存内容可以确认 system prompt 和历史消息是否正确
4. **上下文质量监控**：在调试、修改配置或调整 prompt 的过程中，KV-Cache-Text 提供了一个集中的视角，帮助你快速确认核心上下文是否出现劣化或被意外内容污染——无需逐条翻阅原始报文

## 多级缓存策略

Claude Code 对应的 KV-Cache 并非只有一份。服务端会为 Tools 和 System Prompt 单独生成不同的缓存，与 Messages 部分的缓存相互独立。这样设计的好处是：当 messages 堆栈出现错乱（如上下文截断、消息修改等）需要重建时，不会连带 Tools 和 System Prompt 的缓存一起失效，避免全部重新计算。

这是现阶段服务端的一个优化策略——因为 Tools 定义和 System Prompt 在正常使用过程中都相对稳定，很少变化，单独缓存它们可以最大限度地减少不必要的重建开销。所以你在观察 Cache 的时候会发现，除了 Tools 重建需要全部重新刷新缓存以外，System Prompt 和 Messages 的破坏都仍然有可以继承的缓存可用。

## 缓存的生命周期

- **创建**：首次请求或缓存失效后，API 会创建新缓存（`cache_creation_input_tokens`）
- **命中**：后续请求前缀一致时复用缓存（`cache_read_input_tokens`）
- **过期**：缓存有 5 分钟的 TTL（存活时间），超时后自动失效
- **重建**：当 system prompt、工具列表、模型或消息内容发生变化时，缓存键不匹配，触发对应级别的缓存重建
