# ListAgents

列出你可以傳送 `SendMessage` 的 agent：你啟動的行程內 SubAgent、這台機器上的其他本地 Claude 工作階段、你的雲端工作階段（當此工作階段具備雲端存取時），以及——當 Remote Control 已連線時——你帳號的其他工作階段。每一列以種類標示。

## 使用時機

- 在傳送訊息之前，你需要同儕工作階段或 SubAgent 的確切名稱。
- 你想查看目前哪些工作階段可從此處連線。

## 啟用方式

- 需要 Claude Code 2.1.224+ 與跨工作階段傳訊（伺服器端功能旗標，預設關閉）。
- 跨工作階段傳訊在 Amazon Bedrock、Claude Platform on AWS、Google Cloud Agent Platform 與 Microsoft Foundry 上不可用。
- 當 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`、`DISABLE_TELEMETRY`、`DO_NOT_TRACK` 或 `DISABLE_GROWTHBOOK` 任一被設定時關閉。
- 以 `CLAUDE_CODE_HARBOR_KITE=1` 強制啟用。

## 參數

- `channel`（string，選填）：此建置中不可用；保持未設定。
- `q`（string，選填）：此建置中不可用；保持未設定。

## 範例

### 範例 1：列出可連線的 agent

```
ListAgents()
```

每一列印出一個名稱——該名稱就是位址。以 `SendMessage({to: "<name>", message: "..."})` 傳送，並完全照印出的名稱複製。僅當裸名稱有歧義時（兩列共用該名稱，或錯誤要求你消除歧義），才附加該列的 ` [ref]`。

## 注意事項

- 唯讀且並行安全。
- 雲端工作階段會收到你的訊息，但尚無法回傳訊息——請在其自己的逐字稿中閱讀其回答。
