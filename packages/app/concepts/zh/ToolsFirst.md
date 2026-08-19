# 为什么工具排在第一位？

在 cc-viewer 的 Context 面板中，**工具（Tools）被放在 System Prompt 和 Messages 之前**。这不是随意排列，而是为了**精确反映 Anthropic API 的实际 KV-Cache 前缀顺序**。

## KV-Cache 前缀序列

Anthropic API 在构建 KV-Cache 时，按以下**固定顺序**将上下文拼接为前缀序列：

```
┌─────────────────────────────────────────────────┐
│ 1. Tools (JSON Schema 定义)                      │  ← 缓存前缀的最前端
│ 2. System Prompt                                 │
│ 3. Messages (历史对话 + 当前 turn)               │  ← 缓存前缀的最后端
└─────────────────────────────────────────────────┘
```

这意味着 **Tools 比 System Prompt 更靠近缓存前缀的起始位置**。

## 为什么 Tools 的缓存权重比 System 还高？

在 KV-Cache 的前缀匹配机制中，**越靠前的内容越稳定**，对缓存命中的影响越大：

1. **前缀匹配是从头开始的**：KV-Cache 通过比较当前请求与上一次缓存的前缀序列来决定能复用多少。从第一个 token 开始逐一比较，一旦遇到不匹配就中断，后续全部失效。

2. **Tools 变化 = 全部缓存失效**：因为 Tools 在最前面，如果工具定义发生任何变化（哪怕只是增减一个 MCP tool），**整个缓存前缀从头开始就不匹配**，所有后续的 System Prompt 和 Messages 缓存全部作废。

3. **System 变化 = Messages 缓存失效**：System Prompt 在中间，它的变化只会导致后面的 Messages 缓存失效，但 Tools 部分的缓存仍然有效。

4. **Messages 变化 = 只影响末尾**：Messages 在最后，新消息的追加只会让最后一小段缓存失效，前面的 Tools 和 System 缓存不受影响。

## 实际影响

| 变化类型 | 缓存影响 | 典型场景 |
|----------|---------|---------|
| 工具增减 | **全部失效** | MCP server 连接/断开、IDE 插件启停 |
| System Prompt 变化 | Messages 缓存失效 | CLAUDE.md 修改、system reminder 注入 |
| 新增消息 | 仅末尾增量 | 正常对话流（最常见，也最省钱） |

这也是为什么 [CacheRebuild](CacheRebuild.md) 中 `tools_change` 导致的缓存重建成本往往最高 —— 它从最前面就打断了缓存前缀链。

## 为什么工具定义要排在思维之前？

从缓存机制的角度，Tools 排在最前面是技术事实。但从认知设计的角度，这个顺序同样合理 —— **工具是手脚，System Prompt 是大脑**。

一个人在行动之前，需要先感知自己有哪些肢体和工具可以使用。一个婴儿不是先理解世界的规则（System），再去学习如何伸手抓取；而是先感知到自己有手、有脚，然后在与环境的交互中逐渐理解规则。同样，LLM 在接收任务指令（System Prompt）之前，先知道自己能调用哪些工具（读文件、写代码、搜索、执行命令），才能在接收到指令时准确评估"我能做什么"和"我该怎么做"。

如果反过来 —— 先告诉模型"你的任务是重构这个模块"，再告诉它"你有 Read、Edit、Bash 这些工具"—— 模型在理解任务时就缺少了关键的能力边界信息，可能产生不切实际的计划或遗漏可用的手段。

**先知道手里有什么牌，再决定怎么打。** 这就是 Tools 优先于 System 的认知逻辑。

## MCP 工具为什么也在这个位置？

MCP（Model Context Protocol）工具与内置工具一样，被放在 Tools 区域的最前端。理解 MCP 在 context 中的位置，有助于评估它的实际收益和代价。

### MCP 的优势

- **能力扩展**：MCP 让模型接入外部服务（数据库查询、API 调用、IDE 操作、浏览器控制等），突破了内置工具的边界
- **生态开放**：任何人都可以实现 MCP server，模型无需重新训练就能获得新能力
- **按需加载**：可以根据任务场景选择性连接/断开 MCP server，灵活组合工具集

### MCP 的代价

- **缓存杀手**：每个 MCP tool 的 JSON Schema 定义都会被拼入 KV-Cache 前缀的最前端。增减一个 MCP tool = **整个缓存从头失效**。如果频繁连接/断开 MCP server，缓存命中率会大幅下降
- **前缀膨胀**：MCP tool 的 Schema 通常比内置工具更大（包含详细的参数描述、枚举值等）。大量 MCP tool 会显著增加 Tools 区域的 token 数，挤压留给 Messages 的 context 空间
- **延迟开销**：MCP tool 调用需要跨进程通信（JSON-RPC over stdio/SSE），比内置工具的函数调用慢一个数量级
- **稳定性风险**：MCP server 是外部进程，可能崩溃、超时、返回异常格式，需要额外的错误处理

### 实践建议

| 场景 | 建议 |
|------|------|
| 长对话、高频交互 | 尽量减少 MCP tool 数量，保护缓存前缀稳定性 |
| 短任务、一次性操作 | 可以自由使用 MCP tool，缓存影响有限 |
| MCP server 频繁增减 | 每次变动都会全量重建缓存，考虑固定 tool 集合 |
| Tool Schema 过大 | 精简 description 和 enum，减少前缀 token 占用 |

在 cc-viewer 的 Context 面板中，MCP 工具与内置工具并列显示在 Tools 区域，可以直观看到每个 tool 的 Schema 体积和对缓存前缀的贡献。
