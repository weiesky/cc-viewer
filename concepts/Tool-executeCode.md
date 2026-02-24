# executeCode (mcp__ide__executeCode)

## 定义

在当前 notebook 文件的 Jupyter kernel 中执行 Python 代码。

## 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `code` | string | 是 | 要执行的 Python 代码 |

## 使用场景

**适合使用：**
- 在 Jupyter notebook 环境中执行代码
- 测试代码片段
- 数据分析和计算

**不适合使用：**
- 非 Jupyter 环境的代码执行——应使用 Bash
- 修改文件——应使用 Edit 或 Write

## 注意事项

- 这是一个 MCP（Model Context Protocol）工具，由 IDE 集成提供
- 代码在当前 Jupyter kernel 中执行，状态在调用间持久化
- 除非用户明确要求，应避免声明变量或修改 kernel 状态
- kernel 重启后状态会丢失

## 在 cc-viewer 中的意义

executeCode 是 MCP 工具，在请求日志的 `tools` 数组中以 `mcp__ide__executeCode` 名称出现。其调用和返回遵循标准的 `tool_use` / `tool_result` 模式。MCP 工具的增减会导致 tools 数组变化，可能触发缓存重建。
