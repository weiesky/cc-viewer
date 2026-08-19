# Request Body 欄位說明

Claude API `/v1/messages` 請求體的頂層欄位說明。

## 欄位列表

| 欄位 | 類型 | 說明 |
|------|------|------|
| **model** | string | 使用的模型名稱，如 `claude-opus-4-6`、`claude-sonnet-4-6` |
| **messages** | array | 對話訊息歷史。每條訊息包含 `role`（user/assistant）和 `content`（文字、圖片、tool_use、tool_result 等 block 陣列） |
| **system** | array | System prompt。包含 Claude Code 的核心指令、工具使用說明、環境資訊、CLAUDE.md 內容等。帶 `cache_control` 的區塊會被 prompt caching |
| **tools** | array | 可用工具定義列表。每個工具包含 `name`、`description` 和 `input_schema`（JSON Schema）。MainAgent 通常有 20+ 工具，SubAgent 只有少量 |
| **metadata** | object | 請求中繼資料，通常包含 `user_id` 用於識別使用者 |
| **max_tokens** | number | 模型單次回覆的最大 token 數，如 `16000`、`64000` |
| **thinking** | object | 擴展思考配置。`type: "enabled"` 開啟思考模式，`budget_tokens` 控制思考 token 上限 |
| **context_management** | object | 上下文管理配置。`truncation: "auto"` 允許 Claude Code 自動截斷過長的訊息歷史 |
| **output_config** | object | 輸出配置，如 `format` 設定 |
| **stream** | boolean | 是否啟用串流回應。Claude Code 始終使用 `true` |

## messages 結構

每條訊息的 `content` 是一個 block 陣列，常見類型：

- **text**: 普通文字內容
- **tool_use**: 模型呼叫工具（含 `name`、`input`）
- **tool_result**: 工具執行結果（含 `tool_use_id`、`content`）
- **image**: 圖片內容（base64 或 URL）
- **thinking**: 模型的思考過程（擴展思考模式）

## system 結構

system prompt 陣列中通常包含：

1. **核心 agent 指令**（"You are Claude Code..."）
2. **工具使用規範**
3. **CLAUDE.md 內容**（專案級指令）
4. **技能提示**（skills reminder）
5. **環境資訊**（OS、shell、git 狀態等）— 事實上 Claude Code 非常依賴 git。如果專案存在 git 儲存庫，Claude Code 能展現出對專案更好的理解能力，包括可以拉取遠端的變更和 commit 記錄來輔助分析

帶 `cache_control: { type: "ephemeral" }` 標記的區塊會被 Anthropic API 快取 5 分鐘，命中快取時以 `cache_read_input_tokens` 計費（遠低於 `input_tokens`）。

> **注意**：對於 Claude Code 這類特殊用戶端，Anthropic 伺服端實際上並不完全依賴請求中的 `cache_control` 屬性來決定快取行為。伺服端會對特定欄位（如 system prompt、tools 定義）自動執行快取策略，即使請求中未顯式攜帶 `cache_control` 標記。因此，當你在請求體中沒有看到該屬性時不必疑惑——伺服端已在幕後完成了快取操作，只是未將此資訊暴露給用戶端。這是 Claude Code 與 Anthropic API 之間的一種默契。
