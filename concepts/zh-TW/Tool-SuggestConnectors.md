# SuggestConnectors

解析 `SearchMcpRegistry` 回傳之 `directoryUuid` 值的完整 connector 內容，讓使用者可被提供具體的 connector 以供啟用。

## 使用時機

- 在 `SearchMcpRegistry` 回傳候選 connector 之後，取得其完整詳情以供呈現。

## 參數

- `uuids`（string 陣列，必填）：要解析的 `directoryUuid` 或 `server_id` 值。1–32 個項目，每個 1–64 個字元。

## 範例

### 範例 1：解析兩個登錄檔命中項目

```
SuggestConnectors(uuids=["d290f1ee-6c54-4b01-90e6-d701748f0851", "a1b2c3d4-0000-4000-8000-abcdefabcdef"])
```

## 注意事項

- 絕對不要猜測 UUID——只解析來自 `SearchMcpRegistry` 回傳的識別碼。
- 此工具本身不連線任何東西；啟用 connector 是在頻帶外進行。
- 僅在第一方 API 的遠端（claude.ai）工作階段中可用。
