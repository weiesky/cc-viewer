# KV-Cache 快取內容

## 什麼是 Prompt Caching？

當你與 Claude 對話時，每次 API 請求都會發送完整的對話上下文（system prompt + 工具定義 + 歷史訊息）。Anthropic 的 prompt caching 機制會將已經計算過的前綴內容快取在伺服端，後續請求如果前綴一致，則直接複用快取結果，跳過重複計算，大幅降低延遲和費用。

cc-viewer 中將這一機制稱為「KV-Cache」，對應的是 Anthropic API 層面的 prompt caching，而非 LLM 內部 transformer 注意力層的 key-value cache。

## 快取的工作原理

Anthropic 的 prompt caching 按照固定順序拼接快取鍵：

```
Tools → System Prompt → Messages（到 cache breakpoint）
```

只要這個前綴與 TTL 視窗內的任意一次請求完全一致，API 就會命中快取（返回 `cache_read_input_tokens`），而非重新計算（`cache_creation_input_tokens`）。

> **Claude Code 對 `cache_control` 屬性並不強依賴，伺服端會配合剔除部分這些屬性，但依然能夠很好的建立快取，所以沒有看到 `cache_control` 屬性並不代表沒有被快取**
>
> 對於 Claude Code 這類特殊用戶端，Anthropic 伺服端並不完全依賴請求中的 `cache_control` 屬性來決定快取行為。伺服端會對特定欄位（如 system prompt、tools 定義）自動執行快取策略，即使請求中未顯式攜帶 `cache_control` 標記。因此，當你在請求體中沒有看到該屬性時不必疑惑——伺服端已在幕後完成了快取操作，只是未將此資訊暴露給用戶端。這是 Claude Code 與 Anthropic API 之間的一種默契。

## 「當前 KV-Cache 快取內容」是什麼？

cc-viewer 中顯示的「當前 KV-Cache 快取內容」，是從最近一次 MainAgent 請求中提取的、位於快取邊界（cache breakpoint）之前的內容。具體包括：

- **System Prompt**：Claude Code 的系統指令，包含核心 agent 指令、工具使用規範、CLAUDE.md 專案指令、環境資訊等
- **Tools**：當前可用的工具定義列表（如 Read、Write、Bash、Agent、MCP 工具等）
- **Messages**：對話歷史中被快取的部分（通常是較早的訊息，直到最後一個 `cache_control` 標記處）

## 為什麼要查看快取內容？

1. **理解上下文**：了解 Claude 當前「記住」了哪些內容，幫助你判斷它的行為是否符合預期
2. **費用優化**：快取命中時費用遠低於重新計算。查看快取內容可以幫助你理解為什麼某些請求觸發了快取重建（cache rebuild）
3. **除錯對話**：當 Claude 的回答不符合預期時，檢查快取內容可以確認 system prompt 和歷史訊息是否正確
4. **上下文品質監控**：在除錯、修改設定或調整 prompt 的過程中，KV-Cache-Text 提供了一個集中的視角，幫助你快速確認核心上下文是否出現劣化或被意外內容污染——無需逐條翻閱原始報文

## 多級快取策略

Claude Code 對應的 KV-Cache 並非只有一份。伺服端會為 Tools 和 System Prompt 單獨生成不同的快取，與 Messages 部分的快取相互獨立。這樣設計的好處是：當 messages 堆疊出現錯亂（如上下文截斷、訊息修改等）需要重建時，不會連帶 Tools 和 System Prompt 的快取一起失效，避免全部重新計算。

這是現階段伺服端的一個優化策略——因為 Tools 定義和 System Prompt 在正常使用過程中都相對穩定，很少變化，單獨快取它們可以最大限度地減少不必要的重建開銷。所以你在觀察 Cache 的時候會發現，除了 Tools 重建需要全部重新刷新快取以外，System Prompt 和 Messages 的破壞都仍然有可以繼承的快取可用。

## 快取的生命週期

- **建立**：首次請求或快取失效後，API 會建立新快取（`cache_creation_input_tokens`）
- **命中**：後續請求前綴一致時複用快取（`cache_read_input_tokens`）
- **過期**：快取有 5 分鐘的 TTL（存活時間），超時後自動失效
- **重建**：當 system prompt、工具列表、模型或訊息內容發生變化時，快取鍵不匹配，觸發對應級別的快取重建
