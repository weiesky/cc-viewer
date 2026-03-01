# Grep

## 定義

基於 ripgrep 的強大內容搜尋工具。支援正規表示式、檔案類型過濾和多種輸出模式。

## 參數

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `pattern` | string | 是 | 正規表示式搜尋模式 |
| `path` | string | 否 | 搜尋路徑（檔案或目錄），預設當前工作目錄 |
| `glob` | string | 否 | 檔案名稱過濾（如 `*.js`、`*.{ts,tsx}`） |
| `type` | string | 否 | 檔案類型過濾（如 `js`、`py`、`rust`），比 glob 更高效 |
| `output_mode` | enum | 否 | 輸出模式：`files_with_matches`（預設）、`content`、`count` |
| `-i` | boolean | 否 | 大小寫不敏感搜尋 |
| `-n` | boolean | 否 | 顯示行號（僅 content 模式），預設 true |
| `-A` | number | 否 | 匹配後顯示的行數 |
| `-B` | number | 否 | 匹配前顯示的行數 |
| `-C` / `context` | number | 否 | 匹配前後顯示的行數 |
| `head_limit` | number | 否 | 限制輸出條目數，預設 0（無限） |
| `offset` | number | 否 | 跳過前 N 條結果 |
| `multiline` | boolean | 否 | 啟用多行匹配模式，預設 false |

## 使用場景

**適合使用：**
- 在程式碼庫中搜尋特定字串或模式
- 查找函式/變數的使用位置
- 按檔案類型過濾搜尋結果
- 統計匹配數量

**不適合使用：**
- 按檔案名稱查找檔案——應使用 Glob
- 需要多輪搜尋的開放式探索——應使用 Task（Explore 類型）

## 注意事項

- 使用 ripgrep 語法（非 grep），花括號等特殊字元需要跳脫
- `files_with_matches` 模式只回傳檔案路徑，最高效
- `content` 模式回傳匹配行內容，支援上下文行
- 多行匹配需要設定 `multiline: true`
- 始終優先使用 Grep 工具而非 Bash 中的 `grep` 或 `rg` 命令

## 在 cc-viewer 中的意義

Grep 呼叫在請求日誌中表現為 `tool_use` / `tool_result` content block 對。`tool_result` 包含搜尋結果。

## 原文

<textarea readonly>A powerful search tool built on ripgrep

  Usage:
  - ALWAYS use Grep for search tasks. NEVER invoke `grep` or `rg` as a Bash command. The Grep tool has been optimized for correct permissions and access.
  - Supports full regex syntax (e.g., "log.*Error", "function\s+\w+")
  - Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter (e.g., "js", "py", "rust")
  - Output modes: "content" shows matching lines, "files_with_matches" shows only file paths (default), "count" shows match counts
  - Use Agent tool for open-ended searches requiring multiple rounds
  - Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping (use `interface\{\}` to find `interface{}` in Go code)
  - Multiline matching: By default patterns match within single lines only. For cross-line patterns like `struct \{[\s\S]*?field`, use `multiline: true`
</textarea>
