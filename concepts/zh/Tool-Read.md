# Read

## 定义

从本地文件系统读取文件内容。支持文本文件、图片、PDF 和 Jupyter notebook。

## 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file_path` | string | 是 | 文件的绝对路径 |
| `offset` | number | 否 | 起始行号（用于大文件分段读取） |
| `limit` | number | 否 | 读取行数（用于大文件分段读取） |
| `pages` | string | 否 | PDF 页码范围（如 "1-5"、"3"、"10-20"），仅适用于 PDF |

## 使用场景

**适合使用：**
- 读取代码文件、配置文件等文本文件
- 查看图片文件（Claude 是多模态模型）
- 读取 PDF 文档
- 读取 Jupyter notebook（返回所有单元格及输出）
- 并行读取多个文件以获取上下文

**不适合使用：**
- 读取目录——应使用 Bash 的 `ls` 命令
- 开放式代码库探索——应使用 Task（Explore 类型）

## 注意事项

- 路径必须是绝对路径，不能是相对路径
- 默认读取文件前 2000 行
- 超过 2000 字符的行会被截断
- 输出使用 `cat -n` 格式，行号从 1 开始
- 大型 PDF（超过 10 页）必须指定 `pages` 参数，每次最多 20 页
- 读取不存在的文件会返回错误（不会崩溃）
- 可以在单条消息中并行调用多个 Read

## 在 cc-viewer 中的意义

Read 调用在请求日志中表现为 `tool_use`（调用）和 `tool_result`（返回内容）content block 对。`tool_result` 中包含文件的实际内容，可用于分析模型读取了哪些文件。

## 原文

<textarea readonly>Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to 2000 lines starting from the beginning of the file
- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters
- Any lines longer than 2000 characters will be truncated
- Results are returned using cat -n format, with line numbers starting at 1
- This tool allows Claude Code to read images (eg PNG, JPG, etc). When reading an image file the contents are presented visually as Claude Code is a multimodal LLM.
- This tool can read PDF files (.pdf). For large PDFs (more than 10 pages), you MUST provide the pages parameter to read specific page ranges (e.g., pages: "1-5"). Reading a large PDF without the pages parameter will fail. Maximum 20 pages per request.
- This tool can read Jupyter notebooks (.ipynb files) and returns all cells with their outputs, combining code, text, and visualizations.
- This tool can only read files, not directories. To read a directory, use an ls command via the Bash tool.
- You can call multiple tools in a single response. It is always better to speculatively read multiple potentially useful files in parallel.
- You will regularly be asked to read screenshots. If the user provides a path to a screenshot, ALWAYS use this tool to view the file at the path. This tool will work with all temporary file paths.
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.</textarea>
