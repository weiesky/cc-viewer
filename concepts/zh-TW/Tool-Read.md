# Read

## 定義

從本機檔案系統讀取檔案內容。支援文字檔案、圖片、PDF 和 Jupyter notebook。

## 參數

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `file_path` | string | 是 | 檔案的絕對路徑 |
| `offset` | number | 否 | 起始行號（用於大檔案分段讀取） |
| `limit` | number | 否 | 讀取行數（用於大檔案分段讀取） |
| `pages` | string | 否 | PDF 頁碼範圍（如 "1-5"、"3"、"10-20"），僅適用於 PDF |

## 使用場景

**適合使用：**
- 讀取程式碼檔案、設定檔等文字檔案
- 查看圖片檔案（Claude 是多模態模型）
- 讀取 PDF 文件
- 讀取 Jupyter notebook（回傳所有儲存格及輸出）
- 並行讀取多個檔案以取得上下文

**不適合使用：**
- 讀取目錄——應使用 Bash 的 `ls` 命令
- 開放式程式碼庫探索——應使用 Task（Explore 類型）

## 注意事項

- 路徑必須是絕對路徑，不能是相對路徑
- 預設讀取檔案前 2000 行
- 超過 2000 字元的行會被截斷
- 輸出使用 `cat -n` 格式，行號從 1 開始
- 大型 PDF（超過 10 頁）必須指定 `pages` 參數，每次最多 20 頁
- 讀取不存在的檔案會回傳錯誤（不會當機）
- 可以在單條訊息中並行呼叫多個 Read

## 在 cc-viewer 中的意義

Read 呼叫在請求日誌中表現為 `tool_use`（呼叫）和 `tool_result`（回傳內容）content block 對。`tool_result` 中包含檔案的實際內容，可用於分析模型讀取了哪些檔案。

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
