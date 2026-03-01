# Write

## 定义

将内容写入本地文件系统。如果文件已存在则覆盖。

## 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file_path` | string | 是 | 文件的绝对路径（必须是绝对路径） |
| `content` | string | 是 | 要写入的内容 |

## 使用场景

**适合使用：**
- 创建新文件
- 需要完全重写文件内容时

**不适合使用：**
- 修改文件中的局部内容——应使用 Edit
- 不应主动创建文档文件（*.md）或 README，除非用户明确要求

## 注意事项

- 如果目标文件已存在，必须先通过 Read 读取，否则会失败
- 会覆盖已有文件的全部内容
- 优先使用 Edit 编辑现有文件，Write 仅用于创建新文件或完全重写

## 在 cc-viewer 中的意义

Write 调用在请求日志中表现为 `tool_use` content block，其 `input.content` 包含写入的完整内容。

## 原文

<textarea readonly>Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.
- Prefer the Edit tool for modifying existing files — it only sends the diff. Only use this tool to create new files or for complete rewrites.
- NEVER create documentation files (*.md) or README files unless explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.</textarea>
