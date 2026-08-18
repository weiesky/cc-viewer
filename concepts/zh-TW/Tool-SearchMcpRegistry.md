# SearchMcpRegistry

以關鍵字搜尋 MCP connector 登錄檔，探索可能有助於完成任務的 connector。

## 使用時機

- 任務可受惠於外部服務（資料庫、issue tracker、SaaS API），而你想檢查是否存在對應的 MCP connector。
- 使用者指名某個產品並要求連線——搜尋登錄檔以尋找相符的 connector。

## 參數

- `keywords`（string 陣列，必填）：描述使用者意圖或指名產品的關鍵字片語。1–8 個項目，每個 1–64 個字元。

## 範例

### 範例 1：為指名產品尋找 connector

```
SearchMcpRegistry(keywords=["linear", "issue tracker"])
```

回傳 connector 與關鍵字相符的登錄檔條目。用 `SuggestConnectors` 解析完整的 connector 詳情。

## 注意事項

- 唯讀且並行安全；結果大小有上限。
- 僅在第一方 API 的遠端（claude.ai）工作階段中可用。
- 搜尋不會安裝任何東西——純粹是探索。
