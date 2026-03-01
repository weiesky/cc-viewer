# executeCode (mcp__ide__executeCode)

## 定義

在當前 notebook 檔案的 Jupyter kernel 中執行 Python 程式碼。

## 參數

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `code` | string | 是 | 要執行的 Python 程式碼 |

## 使用場景

**適合使用：**
- 在 Jupyter notebook 環境中執行程式碼
- 測試程式碼片段
- 資料分析和計算

**不適合使用：**
- 非 Jupyter 環境的程式碼執行——應使用 Bash
- 修改檔案——應使用 Edit 或 Write

## 注意事項

- 這是一個 MCP（Model Context Protocol）工具，由 IDE 整合提供
- 程式碼在當前 Jupyter kernel 中執行，狀態在呼叫間持久化
- 除非使用者明確要求，應避免宣告變數或修改 kernel 狀態
- kernel 重啟後狀態會遺失

## 在 cc-viewer 中的意義

executeCode 是 MCP 工具，在請求日誌的 `tools` 陣列中以 `mcp__ide__executeCode` 名稱出現。其呼叫和回傳遵循標準的 `tool_use` / `tool_result` 模式。MCP 工具的增減會導致 tools 陣列變化，可能觸發快取重建。

## 原文

<textarea readonly>Execute python code in the Jupyter kernel for the current notebook file.
    
    All code will be executed in the current Jupyter kernel.
    
    Avoid declaring variables or modifying the state of the kernel unless the user
    explicitly asks for it.
    
    Any code executed will persist across calls to this tool, unless the kernel
    has been restarted.</textarea>
