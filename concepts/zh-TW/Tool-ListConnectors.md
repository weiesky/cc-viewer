# ListConnectors

列出為使用者的 claude.ai 組織安裝的 MCP connector，可選擇性以關鍵字過濾。

## 使用時機

- 在建議新的 connector 之前，你需要知道已安裝哪些。
- 使用者詢問他們的組織有哪些整合。

## 啟用方式

- 僅在第一方 API 的遠端（claude.ai）工作階段中可用。

## 參數

- `keywords`（string 陣列，選填）：過濾清單——最多 8 個項目，每個 1–64 個字元。省略則列出全部。

## 範例

### 範例 1：列出所有已安裝的 connector

```
ListConnectors()
```

### 範例 2：以關鍵字過濾

```
ListConnectors(keywords=["github"])
```

## 注意事項

- 搭配 `SearchMcpRegistry`（探索）與 `SuggestConnectors`（詳情）完成完整的尋找並啟用流程。
