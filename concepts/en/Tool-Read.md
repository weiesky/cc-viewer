# Read

## Definition

Reads file contents from the local filesystem. Supports text files, images, PDFs, and Jupyter notebooks.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file_path` | string | Yes | Absolute path of the file |
| `offset` | number | No | Starting line number (for reading large files in segments) |
| `limit` | number | No | Number of lines to read (for reading large files in segments) |
| `pages` | string | No | PDF page range (e.g., "1-5", "3", "10-20"), only applicable to PDFs |

## Use Cases

**Good for:**
- Reading code files, configuration files, and other text files
- Viewing image files (Claude is a multimodal model)
- Reading PDF documents
- Reading Jupyter notebooks (returns all cells with outputs)
- Reading multiple files in parallel to gather context

**Not good for:**
- Reading directories — use the `ls` command in Bash instead
- Open-ended codebase exploration — use Task (Explore type) instead

## Notes

- The path must be an absolute path, not a relative path
- Reads the first 2000 lines of a file by default
- Lines exceeding 2000 characters will be truncated
- Output uses `cat -n` format, with line numbers starting at 1
- Large PDFs (over 10 pages) must specify the `pages` parameter, max 20 pages per call
- Reading a non-existent file returns an error (does not crash)
- Multiple Read calls can be issued in parallel within a single message

## Significance in cc-viewer

Read calls appear in request logs as `tool_use` (invocation) and `tool_result` (returned content) content block pairs. The `tool_result` contains the actual file content, which can be used to analyze which files the model read.

## Original Text

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
