# ReadMcpResource

依 URI 讀取已連線 MCP（Model Context Protocol）伺服器所公開的單一資源。

## 使用時機

- MCP 伺服器公告了一個資源（檔案、記錄、文件），其內容你需要放入上下文。
- 你有具體的資源 URI——來自 `ListMcpResources`、伺服器說明文件或先前的工具結果。

## 啟用方式

- 一律啟用，但不暴露於模型的工具清單——供 thin-client / sidecar 使用。

## 參數

- `server`（string，必填）：MCP 伺服器名稱。
- `uri`（string，必填）：要讀取的資源 URI。

## 範例

### 範例 1：依 URI 讀取伺服器資源

```
ReadMcpResource(server="github", uri="file:///repo/docs/architecture.md")
```

回傳 `github` MCP 伺服器所提供的資源內容。

## 注意事項

- 若你不知道伺服器公開哪些資源，先用 `ListMcpResources`；目錄式清單請用 `ReadMcpResourceDir`。
- URI scheme 依伺服器而定（`file://`、`https://`、自訂 scheme）——檢查目標伺服器公告的內容。
