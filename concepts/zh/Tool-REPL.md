# REPL

在会话内的持久化 Node.js vm 上下文中执行 JavaScript。支持顶层 `await`，一次调用中定义的变量/函数在后续调用中仍然可用。

## 何时使用

- 用代码比 shell 单行命令更容易的快速计算、数据转换或 JSON 处理。
- 中间状态需要在调用之间保持的多步脚本（计数器、累计结果）。
- 在写入文件之前，交互式地探测某个 API 或库的行为。

## 启用方式

- 默认关闭——设置 `CLAUDE_CODE_REPL=true` 启用。
- 在终端（`cli`）和 claude.ai（`remote`）会话中，服务端功能开关也可能启用它。
- 关闭时，REPL 不在模型的工具列表中。开启时，`Read`、`Glob`、`Grep`、`Bash`、`PowerShell` 和 `NotebookEdit` 被替换为 REPL 简写形式。

## 参数

- `code` (string, 必填)：要执行的 JavaScript 代码。支持顶层 await。状态在调用之间保持。
- `description` (string, 可选)：对这个脚本做什么的清晰、简洁描述，用主动语态（5–10 个词），例如 "Trace upgrade message to its GrowthBook flag"。
- `timeout` (number, 可选)：超时时间（毫秒）。默认 30000；最大 600000。

## 示例

### 示例 1：计算并复用状态

```
REPL(code="const counts = new Map(); ['a','b','a'].forEach(k => counts.set(k, (counts.get(k)||0)+1)); counts.get('a')")
```

返回 `2`；`counts` 在同一会话后续的 REPL 调用中仍然有定义。

### 示例 2：带更长超时的顶层 await

```
REPL(
  code="const res = await fetch('https://example.com/api'); await res.json()",
  description="Fetch example API and parse JSON",
  timeout=60000
)
```

## 注意事项

- 状态按会话隔离：重启会话会清除所有定义。
- 这是 JavaScript（Node）环境——shell 命令、文件系统密集操作或非 JS 运行时请用 Bash。
- 长时间运行的代码应显式设置 `timeout`；默认 30 秒会杀掉任何更慢的代码。
