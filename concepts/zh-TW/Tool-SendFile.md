# SendFile

將一個或多個檔案傳送給另一個 Claude Code 工作階段——`ListAgents` 列出的同儕，或明確的工作階段位址。

## 使用時機

- 同儕工作階段需要你工作目錄中的檔案（報告、修補檔、fixture）以繼續其任務。
- 你在跨工作階段協調工作，想要交接產物而不只是文字（文字請用 `SendMessage`）。

## 參數

- `to`（string，必填）：收件人——來自 `ListAgents` 的同儕工作階段名稱，或明確的 `uds:<socket>` / `bridge:<session id>` 位址。
- `files`（string 陣列，必填）：要傳送的檔案路徑（絕對路徑或相對於 cwd）。即使是單一檔案也務必傳入陣列。1–16 個檔案，每個最多 30 MiB。
- `message`（string，選填）：隨檔案一併送達的簡短訊息。

## 範例

### 範例 1：將報告傳送給同儕工作階段

```
SendFile(
  to="teammate-a",
  files=["./dist/report.html"],
  message="The analysis you asked for"
)
```

## 注意事項

- 工作階段必須提供跨工作階段檔案傳輸；未提供時，驗證會以「Cross-session file transfer is not available in this session.」失敗。
- 傳輸到遠端機器可能需要額外核准。
- 讀取檔案內容是傳送的一部分——若權限規則停用檔案讀取則會被拒絕。
