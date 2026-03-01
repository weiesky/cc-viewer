# Edit

## 定义

通过精确的字符串替换来编辑文件。将文件中的 `old_string` 替换为 `new_string`。

## 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file_path` | string | 是 | 要修改的文件的绝对路径 |
| `old_string` | string | 是 | 要替换的原始文本 |
| `new_string` | string | 是 | 替换后的新文本（必须与 old_string 不同） |
| `replace_all` | boolean | 否 | 是否替换所有匹配项，默认 `false` |

## 使用场景

**适合使用：**
- 修改现有文件中的特定代码段
- 修复 bug、更新逻辑
- 重命名变量（配合 `replace_all: true`）
- 任何需要精确修改文件内容的场景

**不适合使用：**
- 创建新文件——应使用 Write
- 大规模重写——可能需要 Write 覆盖整个文件

## 注意事项

- 使用前必须先通过 Read 读取过该文件，否则会报错
- `old_string` 在文件中必须是唯一的，否则编辑失败。如果不唯一，需要提供更多上下文使其唯一，或使用 `replace_all`
- 编辑文本时必须保持原始缩进（tab/空格），不要包含 Read 输出中的行号前缀
- 优先编辑现有文件，而非创建新文件
- `new_string` 必须与 `old_string` 不同

## 在 cc-viewer 中的意义

Edit 调用在请求日志中表现为 `tool_use` content block，其 `input` 包含 `old_string` 和 `new_string`，可用于追踪模型对文件做了哪些修改。

## 原文

<textarea readonly>Performs exact string replacements in files.

Usage:
- You must use your `Read` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file. 
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if `old_string` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use `replace_all` to change every instance of `old_string`.
- Use `replace_all` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.</textarea>
