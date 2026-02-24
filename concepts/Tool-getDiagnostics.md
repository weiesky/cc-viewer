# getDiagnostics (mcp__ide__getDiagnostics)

## 定义

从 VS Code 获取语言诊断信息，包括语法错误、类型错误、lint 警告等。

## 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `uri` | string | 否 | 文件 URI。不提供则获取所有文件的诊断信息 |

## 使用场景

**适合使用：**
- 检查代码的语法、类型、lint 等语义问题
- 编辑代码后验证是否引入了新错误
- 替代 Bash 命令来检查代码质量

**不适合使用：**
- 运行测试——应使用 Bash
- 检查运行时错误——应使用 Bash 执行代码

## 注意事项

- 这是一个 MCP（Model Context Protocol）工具，由 IDE 集成提供
- 仅在 VS Code / IDE 环境中可用
- 优先使用此工具而非 Bash 命令来检查代码问题

## 在 cc-viewer 中的意义

getDiagnostics 是 MCP 工具，在请求日志的 `tools` 数组中以 `mcp__ide__getDiagnostics` 名称出现。其调用和返回遵循标准的 `tool_use` / `tool_result` 模式。MCP 工具的增减会导致 tools 数组变化，可能触发缓存重建。
