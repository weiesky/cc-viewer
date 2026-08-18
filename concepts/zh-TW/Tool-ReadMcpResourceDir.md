# ReadMcpResourceDir

依 URI 列出已連線 MCP 伺服器所公開之目錄式資源的條目。

## 使用時機

- MCP 伺服器以階層方式組織資源，而你需要列舉該階層的某一層。
- 你想在用 `ReadMcpResource` 讀取個別資源之前先瀏覽。

## 啟用方式

- 一律啟用，但不暴露於模型的工具清單——供 thin-client / sidecar 使用。

## 參數

- `server`（string，必填）：MCP 伺服器名稱。
- `uri`（string，必填）：要列出的目錄資源 URI。

## 範例

### 範例 1：列出資源目錄

```
ReadMcpResourceDir(server="filesystem", uri="file:///project/src/")
```

回傳伺服器在該目錄 URI 下公開的子條目。

## 注意事項

- 只有將資源建模為目錄的伺服器支援此功能；平坦的伺服器會回傳錯誤或空清單——退回使用 `ListMcpResources`。
- 搭配 `ReadMcpResource` 深入看起來相關的條目。
