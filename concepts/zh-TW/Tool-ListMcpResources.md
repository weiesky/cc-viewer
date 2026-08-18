# ListMcpResources

列出已連線 MCP 伺服器所公開的資源，可選擇性過濾至單一伺服器。

## 使用時機

- 在讀取之前，你需要先探索某個 MCP 伺服器提供哪些資源（檔案、記錄、文件）。
- 你想總覽每個已連線伺服器的所有資源。

## 參數

- `server`（string，選填）：要過濾資源的伺服器名稱。省略則列出所有已連線伺服器的資源。

## 範例

### 範例 1：列出全部

```
ListMcpResources()
```

### 範例 2：列出單一伺服器的資源

```
ListMcpResources(server="github")
```

## 注意事項

- 這是探索步驟：將感興趣的 URI 送入 `ReadMcpResource`（單一資源）或 `ReadMcpResourceDir`（目錄清單）。
- 伺服器會在工作階段期間連線與中斷連線；若剛新增伺服器，請重新列出。
