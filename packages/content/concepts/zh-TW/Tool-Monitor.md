# Monitor

啟動一個後台監視器，從長時間執行的腳本中即時推送事件。每一行標準輸出都會成為一則通知——繼續工作，事件會即時出現在對話中。

## 使用時機

- 在部署執行期間，持續追蹤日誌檔案中的錯誤、警告或崩潰特徵
- 每隔 30 秒輪詢遠端 API、PR 或 CI 流水線，取得最新狀態事件
- 即時監視檔案系統目錄或建置輸出的變更
- 在多次迭代中等待特定條件（例如訓練步驟里程碑或佇列清空）
- **不適用於**簡單的「等待完成」場景——請改用帶 `run_in_background` 的 `Bash`，它會在程序退出時發送一次完成通知

## 啟用方式

- 預設關閉（伺服器端功能旗標）。
- 在 Amazon Bedrock、Google Cloud 與 Microsoft Foundry 上不可用。
- 當 `DISABLE_TELEMETRY` 或 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` 被設定時關閉。
- WebSocket 來源需要 Claude Code 2.1.195+。

## 參數

- `command`（字串，必填）：要執行的 shell 命令或腳本。寫入標準輸出的每一行都會成為獨立的通知事件。程序退出後監視器結束。
- `description`（字串，必填）：在每則通知中顯示的簡短可讀標籤。請盡量具體——「deploy.log 中的錯誤」比「監視日誌」更清楚。此標籤用於識別觸發通知的監視器。
- `timeout_ms`（數字，預設 `300000`，最大 `3600000`）：終止時限（毫秒）。超過此時長後程序將被強制終止。當 `persistent: true` 時此參數無效。
- `persistent`（布林值，預設 `false`）：設為 `true` 時，監視器在整個工作階段期間持續執行，不受逾時限制。可透過 `TaskStop` 明確停止。

## 範例

### 範例 1：追蹤日誌檔案中的錯誤和崩潰

此範例涵蓋所有終止狀態：成功標記、回溯資訊、常見錯誤關鍵詞、OOM 終止以及意外程序退出。

```bash
tail -F /var/log/deploy.log | grep -E --line-buffered \
  "deployed|Traceback|Error|FAILED|assert|Killed|OOM"
```

每個管道中都必須使用 `grep --line-buffered`。若不使用，作業系統會以 4 KB 區塊為單位緩衝輸出，事件可能延遲數分鐘。交替匹配模式同時涵蓋成功路徑（`deployed`）和失敗路徑（`Traceback`、`Error`、`FAILED`、`Killed`、`OOM`）。只監視成功標記的監視器在崩潰時會保持靜默——靜默與「仍在執行」無法區分。

### 範例 2：每 30 秒輪詢一次遠端 API

```bash
while true; do
  curl -sf "https://api.example.com/status" || true
  sleep 30
done | grep --line-buffered -E "completed|failed|error"
```

`|| true` 防止偶發的網路故障中斷迴圈。遠端 API 建議採用 30 秒以上的輪詢間隔，以避免觸發頻率限制。調整 grep 模式，同時擷取成功和失敗回應，避免 API 端錯誤被靜默掩蓋。

## 注意事項

- **管道中必須始終使用 `grep --line-buffered`。** 若不使用，管道緩衝會將事件延遲數分鐘，因為作業系統會累積輸出直到填滿 4 KB 區塊。`--line-buffered` 強制在每行後刷新緩衝。
- **篩選器必須同時涵蓋成功和失敗特徵。** 只監視成功標記的監視器在崩潰、掛起或意外退出時會保持靜默。擴大匹配範圍：在成功關鍵詞之外，還應包含 `Error`、`Traceback`、`FAILED`、`Killed`、`OOM` 等終止狀態標記。
- **遠端 API 的輪詢間隔不少於 30 秒。** 對外部服務進行高頻輪詢可能觸發頻率限制或封鎖。對於本地檔案系統或程序檢查，0.5–1 秒的間隔是合適的。
- **對於工作階段級長期監視，使用 `persistent: true`。** 預設 `timeout_ms` 為 300 000 毫秒（5 分鐘），逾時後程序會被終止。若希望監視器持續執行直至手動停止，請設定 `persistent: true`，並在完成後呼叫 `TaskStop`。
- **事件過多時自動停止。** 每行標準輸出都是一則對話訊息。如果篩選器太寬鬆、產生過多事件，監視器會被自動停止。請使用更精確的 `grep` 模式重新啟動。200 毫秒內到達的多行會合併為一則通知。
