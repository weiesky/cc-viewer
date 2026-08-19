# Cache Rebuild（快取重建）

## 背景

Anthropic 的 prompt caching 機制會將請求中的 system → tools → messages（到 cache breakpoint）按順序拼接為快取鍵。當快取鍵與上一次請求完全一致時，API 回傳 `cache_read_input_tokens`（快取命中）；當快取鍵發生變化，API 會重新建立快取，回傳大量 `cache_creation_input_tokens`，即快取重建。

快取重建意味著額外的 token 計費（cache creation 的價格高於 cache read），因此識別重建原因對費用最佳化有直接價值。

## 快取重建原因分類

cc-viewer 透過對比前後兩個 MainAgent 請求的 body，精確判斷快取重建的原因：

| reason | 含義 | 判斷方式 |
|--------|------|----------|
| `ttl` | 快取過期 | 距上一個 MainAgent 請求超過 5 分鐘 |
| `system_change` | system prompt 變更 | `JSON.stringify(prev.system) !== JSON.stringify(curr.system)` |
| `tools_change` | 工具定義變更 | `JSON.stringify(prev.tools) !== JSON.stringify(curr.tools)` |
| `model_change` | 模型切換 | `prev.model !== curr.model` |
| `msg_truncated` | 訊息堆疊被截斷 | 當前請求的 messages 數量少於上一個請求，通常因上下文視窗溢出觸發截斷 |
| `msg_modified` | 歷史訊息修改 | 前綴訊息內容不一致（正常追加時前綴應完全相同） |
| `key_change` | 未知鍵變更 | 以上條件均不匹配時的 fallback |

## 判斷優先順序

1. 首先檢查時間間隔——超過 5 分鐘直接判定為 `ttl`，不再做 body 對比
2. 然後依次檢查 model、system、tools、messages
3. 一個請求可能同時命中多個原因（如模型切換 + system prompt 變更），此時 `reasons` 陣列包含所有匹配項，tooltip 換行顯示

## 常見場景

- **`ttl`**：使用者暫停操作超過 5 分鐘後繼續，快取自然過期
- **`system_change`**：Claude Code 更新了 system prompt（如載入新的 CLAUDE.md、project instructions 變化）
- **`tools_change`**：MCP server 連線/斷開導致可用工具列表變化
- **`model_change`**：使用者透過 `/model` 命令切換模型
- **`msg_truncated`**：對話過長觸發上下文視窗管理，Claude Code 截斷早期訊息
- **`msg_modified`**：Claude Code 對歷史訊息做了編輯（如 `/compact` 壓縮摘要替換原始訊息）
