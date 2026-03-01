# Glob

## 定義

快速的檔案名稱模式匹配工具，支援任意規模的程式碼庫。回傳按修改時間排序的匹配檔案路徑。

## 參數

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `pattern` | string | 是 | glob 模式（如 `**/*.js`、`src/**/*.ts`） |
| `path` | string | 否 | 搜尋目錄，預設為當前工作目錄。不要傳 "undefined" 或 "null" |

## 使用場景

**適合使用：**
- 按檔案名稱模式查找檔案
- 查找特定類型的所有檔案（如所有 `.tsx` 檔案）
- 查找特定類別定義（如 `class Foo`）時先定位檔案
- 可以在單條訊息中並行發起多個 Glob 呼叫

**不適合使用：**
- 搜尋檔案內容——應使用 Grep
- 需要多輪搜尋的開放式探索——應使用 Task（Explore 類型）

## 注意事項

- 支援標準 glob 語法：`*` 匹配單層，`**` 匹配多層，`{}` 匹配多選
- 結果按修改時間排序
- 比 Bash 的 `find` 命令更推薦使用

## 在 cc-viewer 中的意義

Glob 呼叫在請求日誌中表現為 `tool_use` / `tool_result` content block 對。`tool_result` 包含匹配的檔案路徑列表。

## 原文

<textarea readonly>- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead
- You can call multiple tools in a single response. It is always better to speculatively perform multiple searches in parallel if they are potentially useful.</textarea>
