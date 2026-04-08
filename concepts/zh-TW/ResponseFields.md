# Response Body 欄位說明

Claude API `/v1/messages` 回應主體的欄位說明。

## 頂層欄位

| 欄位 | 型別 | 說明 |
|------|------|------|
| **model** | string | 實際使用的模型名稱，如 `claude-opus-4-6` |
| **id** | string | 本次回應的唯一識別碼，如 `msg_01Tgsr2QeH8AVXGoP2wAXRvU` |
| **type** | string | 固定為 `"message"` |
| **role** | string | 固定為 `"assistant"` |
| **content** | array | 模型輸出的內容區塊陣列，包含文字、工具呼叫、思考過程等 |
| **stop_reason** | string | 停止原因：`"end_turn"`（正常結束）、`"tool_use"`（需要執行工具）、`"max_tokens"`（達到 token 上限） |
| **stop_sequence** | string/null | 觸發停止的序列，通常為 `null` |
| **usage** | object | Token 用量統計（詳見下方） |

## content 區塊型別

| 型別 | 說明 |
|------|------|
| **text** | 模型的文字回覆，含 `text` 欄位 |
| **tool_use** | 工具呼叫請求，含 `name`（工具名稱）、`input`（參數）、`id`（呼叫 ID，用於匹配 tool_result） |
| **thinking** | 擴展思考內容（僅在開啟 thinking 模式時出現），含 `thinking` 欄位 |

## usage 欄位詳解

| 欄位 | 說明 |
|------|------|
| **input_tokens** | 未命中快取的輸入 token 數（需要全價計費） |
| **cache_creation_input_tokens** | 本次新建立快取的 token 數（快取寫入，計費高於一般輸入） |
| **cache_read_input_tokens** | 命中快取的 token 數（快取讀取，計費遠低於一般輸入） |
| **output_tokens** | 模型輸出的 token 數 |
| **service_tier** | 服務等級，如 `"standard"` |
| **inference_geo** | 推論地域，如 `"not_available"` 表示未提供地域資訊 |

## cache_creation 子欄位

| 欄位 | 說明 |
|------|------|
| **ephemeral_5m_input_tokens** | 5 分鐘 TTL 的短期快取建立 token 數 |
| **ephemeral_1h_input_tokens** | 1 小時 TTL 的長期快取建立 token 數 |

> **關於快取計費**：`cache_read_input_tokens` 的單價遠低於 `input_tokens`，而 `cache_creation_input_tokens` 的單價略高於一般輸入。因此，在持續對話中保持高快取命中率可以顯著降低費用。透過 cc-viewer 的「命中率」指標可以直觀監控這一比例。

## stop_reason 含義

- **end_turn**：模型正常完成回覆
- **tool_use**：模型需要呼叫工具，content 中會包含 `tool_use` 區塊。下一輪請求需要在 messages 中追加 `tool_result` 才能繼續對話
- **max_tokens**：達到 `max_tokens` 限制被截斷，回覆可能不完整
