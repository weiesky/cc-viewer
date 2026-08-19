# REPL

在工作階段內的持久性 Node.js vm context 中執行 JavaScript。支援頂層 `await`，且在一次呼叫中定義的變數/函式在後續呼叫中仍然可用。

## 使用時機

- 快速計算、資料轉換或 JSON 處理——用程式碼比 shell 單行指令更輕鬆。
- 多步驟腳本作業，其中間狀態需要在呼叫之間保留（計數器、累積結果）。
- 在寫入檔案之前，以互動方式探查 API 或函式庫的行為。

## 啟用方式

- 預設關閉——設定 `CLAUDE_CODE_REPL=true` 即可啟用。
- 在終端機（`cli`）與 claude.ai（`remote`）工作階段中，伺服器端功能旗標也可能將其啟用。
- 關閉時，REPL 會從模型的工具清單中隱藏。開啟時，`Read`、`Glob`、`Grep`、`Bash`、`PowerShell` 與 `NotebookEdit` 會被 REPL 簡寫取代。

## 參數

- `code`（string，必填）：要執行的 JavaScript 程式碼。支援頂層 await。狀態在呼叫之間持續保留。
- `description`（string，選填）：以主動語態清晰扼要描述此腳本的用途（5–10 字），例如 "Trace upgrade message to its GrowthBook flag"。
- `timeout`（number，選填）：逾時毫秒數。預設 30000；最大 600000。

## 範例

### 範例 1：計算並重用狀態

```
REPL(code="const counts = new Map(); ['a','b','a'].forEach(k => counts.set(k, (counts.get(k)||0)+1)); counts.get('a')")
```

回傳 `2`；`counts` 在同一工作階段的後續 REPL 呼叫中保持已定義。

### 範例 2：使用較長逾時的頂層 await

```
REPL(
  code="const res = await fetch('https://example.com/api'); await res.json()",
  description="Fetch example API and parse JSON",
  timeout=60000
)
```

## 注意事項

- 狀態屬於每個工作階段：重新啟動工作階段會清除所有定義。
- 這是 JavaScript（Node）環境——shell 命令、檔案系統密集型工作或非 JS 執行階段請使用 Bash。
- 長時間執行的程式碼應設定明確的 `timeout`；預設 30 秒會終止任何較慢的執行。
