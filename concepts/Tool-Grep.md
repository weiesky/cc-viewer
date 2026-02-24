# Grep

## 定义

基于 ripgrep 的强大内容搜索工具。支持正则表达式、文件类型过滤和多种输出模式。

## 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `pattern` | string | 是 | 正则表达式搜索模式 |
| `path` | string | 否 | 搜索路径（文件或目录），默认当前工作目录 |
| `glob` | string | 否 | 文件名过滤（如 `*.js`、`*.{ts,tsx}`） |
| `type` | string | 否 | 文件类型过滤（如 `js`、`py`、`rust`），比 glob 更高效 |
| `output_mode` | enum | 否 | 输出模式：`files_with_matches`（默认）、`content`、`count` |
| `-i` | boolean | 否 | 大小写不敏感搜索 |
| `-n` | boolean | 否 | 显示行号（仅 content 模式），默认 true |
| `-A` | number | 否 | 匹配后显示的行数 |
| `-B` | number | 否 | 匹配前显示的行数 |
| `-C` / `context` | number | 否 | 匹配前后显示的行数 |
| `head_limit` | number | 否 | 限制输出条目数，默认 0（无限） |
| `offset` | number | 否 | 跳过前 N 条结果 |
| `multiline` | boolean | 否 | 启用多行匹配模式，默认 false |

## 使用场景

**适合使用：**
- 在代码库中搜索特定字符串或模式
- 查找函数/变量的使用位置
- 按文件类型过滤搜索结果
- 统计匹配数量

**不适合使用：**
- 按文件名查找文件——应使用 Glob
- 需要多轮搜索的开放式探索——应使用 Task（Explore 类型）

## 注意事项

- 使用 ripgrep 语法（非 grep），花括号等特殊字符需要转义
- `files_with_matches` 模式只返回文件路径，最高效
- `content` 模式返回匹配行内容，支持上下文行
- 多行匹配需要设置 `multiline: true`
- 始终优先使用 Grep 工具而非 Bash 中的 `grep` 或 `rg` 命令

## 在 cc-viewer 中的意义

Grep 调用在请求日志中表现为 `tool_use` / `tool_result` content block 对。`tool_result` 包含搜索结果。
