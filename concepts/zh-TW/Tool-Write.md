# Write

## 定義

將內容寫入本機檔案系統。如果檔案已存在則覆寫。

## 參數

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `file_path` | string | 是 | 檔案的絕對路徑（必須是絕對路徑） |
| `content` | string | 是 | 要寫入的內容 |

## 使用場景

**適合使用：**
- 建立新檔案
- 需要完全重寫檔案內容時

**不適合使用：**
- 修改檔案中的局部內容——應使用 Edit
- 不應主動建立文件檔案（*.md）或 README，除非使用者明確要求

## 注意事項

- 如果目標檔案已存在，必須先透過 Read 讀取，否則會失敗
- 會覆寫已有檔案的全部內容
- 優先使用 Edit 編輯現有檔案，Write 僅用於建立新檔案或完全重寫

## 在 cc-viewer 中的意義

Write 呼叫在請求日誌中表現為 `tool_use` content block，其 `input.content` 包含寫入的完整內容。

## 原文

<textarea readonly>Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.
- Prefer the Edit tool for modifying existing files — it only sends the diff. Only use this tool to create new files or for complete rewrites.
- NEVER create documentation files (*.md) or README files unless explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.</textarea>
