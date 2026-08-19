# 為什麼 Tools 排在最前面？

在 cc-viewer 的 Context 面板中，**Tools 顯示在 System Prompt 和 Messages 之前**。這個排列順序精確地反映了 **Anthropic API 的 KV-Cache 前綴序列**。

## KV-Cache 前綴序列

當 Anthropic 的 API 建構 KV-Cache 時，會以這個**固定順序**將上下文串接為前綴：

```
┌─────────────────────────────────────────────────┐
│ 1. Tools (JSON Schema definitions)               │  ← Start of cache prefix
│ 2. System Prompt                                 │
│ 3. Messages (conversation history + current turn)│  ← End of cache prefix
└─────────────────────────────────────────────────┘
```

這意味著 **Tools 位於 cache 前綴的最開頭，排在 System Prompt 之前**。

## 為什麼 Tools 的 Cache 權重高於 System？

在 KV-Cache 前綴比對中，**越靠前的內容越關鍵** — 任何變動都會使其後的所有內容失效：

1. **前綴比對從頭開始**：KV-Cache 從起始位置逐 token 將當前請求與快取前綴進行比對。一旦發現不匹配，後續所有內容都會立即失效。

2. **Tools 變動 = 整個 cache 失效**：由於 Tools 排在最前面，任何工具定義的變更（即使只是新增或移除一個 MCP tool）都會**從最開頭破壞前綴**，使所有已快取的 System Prompt 和 Messages 失效。

3. **System 變動 = Messages cache 失效**：System Prompt 位於中間，因此其變更只會使後續的 Messages 部分失效。

4. **Messages 變動 = 只影響尾部**：Messages 排在最後，因此新增訊息只會使末尾的一小段失效 — Tools 和 System 的 cache 仍保持完整。

## 實際影響

| 變動類型 | Cache 影響 | 典型情境 |
|----------|-----------|---------|
| Tool 新增/移除 | **完全失效** | MCP server 連線/斷線、IDE 插件切換 |
| System Prompt 變更 | Messages cache 遺失 | CLAUDE.md 編輯、system reminder 注入 |
| 新增訊息 | 僅尾部遞增 | 正常對話流程（最常見、成本最低） |

這就是為什麼 [CacheRebuild](CacheRebuild.md) 中的 `tools_change` 往往是成本最高的重建原因 — 它從最前端破壞了前綴鏈。

## 為什麼工具定義要排在「大腦」之前？

從快取機制的角度，Tools 排在最前面是技術事實。但從認知設計的角度，這個順序同樣合理 —— **工具是手腳，System Prompt 是大腦**。

一個人在行動之前，需要先感知自己有哪些肢體和工具可以使用。一個嬰兒不是先理解世界的規則（System），再去學習如何伸手抓取；而是先感知到自己有手、有腳，然後在與環境的互動中逐漸理解規則。同樣，LLM 在接收任務指令（System Prompt）之前，先知道自己能呼叫哪些工具（讀檔案、寫程式碼、搜尋、執行命令），才能在接收到指令時準確評估「我能做什麼」和「我該怎麼做」。

如果反過來 —— 先告訴模型「你的任務是重構這個模組」，再告訴它「你有 Read、Edit、Bash 這些工具」—— 模型在理解任務時就缺少了關鍵的能力邊界資訊，可能產生不切實際的計畫或遺漏可用的手段。

**先知道手裡有什麼牌，再決定怎麼打。** 這就是 Tools 優先於 System 的認知邏輯。

## MCP 工具為什麼也在這個位置？

MCP（Model Context Protocol）工具與內建工具一樣，被放在 Tools 區域的最前端。理解 MCP 在 context 中的位置，有助於評估它的實際收益和代價。

### MCP 的優勢

- **能力擴展**：MCP 讓模型接入外部服務（資料庫查詢、API 呼叫、IDE 操作、瀏覽器控制等），突破了內建工具的邊界
- **生態開放**：任何人都可以實現 MCP server，模型無需重新訓練就能獲得新能力
- **按需載入**：可以根據任務場景選擇性連接/斷開 MCP server，靈活組合工具集

### MCP 的代價

- **快取殺手**：每個 MCP tool 的 JSON Schema 定義都會被拼入 KV-Cache 前綴的最前端。增減一個 MCP tool = **整個快取從頭失效**。如果頻繁連接/斷開 MCP server，快取命中率會大幅下降
- **前綴膨脹**：MCP tool 的 Schema 通常比內建工具更大（包含詳細的參數描述、列舉值等）。大量 MCP tool 會顯著增加 Tools 區域的 token 數，擠壓留給 Messages 的 context 空間
- **延遲開銷**：MCP tool 呼叫需要跨行程通訊（JSON-RPC over stdio/SSE），比內建工具的函式呼叫慢一個數量級
- **穩定性風險**：MCP server 是外部行程，可能當機、逾時、回傳異常格式，需要額外的錯誤處理

### 實踐建議

| 場景 | 建議 |
|------|------|
| 長對話、高頻互動 | 盡量減少 MCP tool 數量，保護快取前綴穩定性 |
| 短任務、一次性操作 | 可以自由使用 MCP tool，快取影響有限 |
| MCP server 頻繁增減 | 每次變動都會全量重建快取，考慮固定 tool 集合 |
| Tool Schema 過大 | 精簡 description 和 enum，減少前綴 token 佔用 |

在 cc-viewer 的 Context 面板中，MCP 工具與內建工具並列顯示在 Tools 區域，可以直觀看到每個 tool 的 Schema 體積和對快取前綴的貢獻。
