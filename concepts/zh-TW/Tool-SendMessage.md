# SendMessage

在一個運作中的團隊內將訊息從一位成員傳給另一位，或同時向每位隊友廣播。這是隊友唯一能聽到的頻道——寫入一般文字輸出的內容對他們不可見。

## 使用時機

- 在團隊協作中，把任務指派或子問題移交給具名的隊友。
- 向另一位代理請求狀態、中間發現或程式碼審閱。
- 透過 `*` 向整個團隊廣播決定、共同限制或關閉通知。
- 回覆協議 prompt，例如團隊領導的關閉請求或計畫核准請求。
- 在委派任務結束時完成回報，讓領導可以把項目標記為完成。

## 啟用方式

- 受與 `ListAgents` 相同的跨工作階段傳訊條件門控（伺服器端功能旗標，預設關閉）。
- 隊友另需啟用實驗性 agent teams。

## 參數

- `to`（string，必填）：目標隊友在團隊中註冊的 `name`，或 `*` 表示一次向所有隊友廣播。
- `message`（string 或 object，必填）：一般通訊用純文字，或如 `shutdown_response`、`plan_approval_response` 等協議回應的結構化物件。
- `summary`（string，選填）：5–10 字的預覽，顯示在團隊活動記錄中供純文字訊息使用。長字串訊息必填；`message` 為協議物件時忽略。

## 範例

### 範例 1：直接移交任務

```
SendMessage(
  to="db-lead",
  message="Please audit prisma/schema.prisma and list any model missing createdAt/updatedAt timestamps. Reply when done.",
  summary="Audit schema for missing timestamps"
)
```

### 範例 2：廣播共同限制

```
SendMessage(
  to="*",
  message="Reminder: do not touch files under legacy/ — that subtree is frozen until the migration PR lands.",
  summary="Freeze legacy/ during migration"
)
```

### 範例 3：協議回應

使用結構化訊息回應領導的關閉請求：

```
SendMessage(
  to="leader",
  message={ "type": "shutdown_response", "ready": true, "final_report": "All assigned diff chunks committed on branch refactor-crew/db-lead." }
)
```

### 範例 4：計畫核准回應

```
SendMessage(
  to="leader",
  message={ "type": "plan_approval_response", "approved": true, "notes": "LGTM, but please split step 4 into migration + backfill." }
)
```

## 注意事項

- 你一般的助理文字輸出不會傳送給隊友。若你想讓另一位代理看到某些內容，必須透過 `SendMessage` 傳遞。這是團隊工作流程中最常見的錯誤。
- 廣播（`to: "*"`）代價高昂——它會喚醒每位隊友並耗用他們的上下文。請保留給真的影響所有人的公告。偏好定向傳送。
- 訊息要精簡、具行動導向。提供收件人需要的檔案路徑、限制與期望的回覆格式；記得他們與你沒有共享記憶。
- 協議訊息物件（`shutdown_response`、`plan_approval_response`）具有固定形式。不要把協議欄位混入純文字訊息，或反之。
- 訊息是非同步的。收件人會在下一輪收到你的訊息；在他們回覆之前不要假設他們已讀或採取行動。
- 寫得好的 `summary` 能讓團隊活動記錄在領導眼中易於掃讀——請把它當 commit subject line 對待。
