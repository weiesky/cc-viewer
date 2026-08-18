# TaskList

以摘要形式回傳目前團隊（或工作階段）中的每個任務。用它瀏覽未完成工作、決定接下來做什麼，並避免重複建立。

## 使用時機

- 工作階段一開始，查看已被追蹤的事項。
- 呼叫 `TaskCreate` 前，確認工作尚未被記錄。
- 作為隊友或子代理，決定下一個要認領的任務時。
- 快速確認整個團隊間的相依關係。
- 在長時間工作階段中定期執行，以與可能已認領、完成或新增任務的隊友重新同步。

`TaskList` 為唯讀且廉價；需要概觀時儘管呼叫。

## 啟用方式

- 在大多數模型上預設可用。
- 在 Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 及之後的系列（v2.1.233+）上不可用，除非透過 `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`、`--allowedTools` 或 `--tools` 選擇啟用。
- 當 `CLAUDE_CODE_ENABLE_TASKS=false` 時，整個任務系統會被停用。

## 參數

`TaskList` 不接受任何參數。它永遠回傳作用中情境的完整任務集合。

## 回應形式

清單中的每個任務皆為摘要，非完整紀錄。預期大約包含：

- `id` — 與 `TaskGet` / `TaskUpdate` 搭配使用的穩定識別碼。
- `subject` — 簡短的祈使句標題。
- `status` — `pending`、`in_progress`、`completed`、`deleted` 之一。
- `owner` — 代理或隊友的 handle，未被認領時為空。
- `blockedBy` — 必須先完成的任務 ID 陣列。

若需要特定任務的完整描述、驗收條件或 metadata，請接著用 `TaskGet`。

## 範例

### 範例 1

快速狀態檢查。

```
TaskList()
```

掃描輸出，找出任何 `in_progress` 但沒有 `owner` 的（停滯工作），以及任何 `pending` 且 `blockedBy` 為空的（可接手）。

### 範例 2

隊友挑下一個任務。

```
TaskList()
# Filter to: status == pending AND blockedBy is empty AND owner is empty.
# Among those, prefer the lower ID (tasks are typically numbered in
# creation order, so lower IDs are older and usually higher priority).
TaskGet(taskId: "<chosen id>")
TaskUpdate(taskId: "<chosen id>", status: "in_progress", owner: "<your handle>")
```

## 注意事項

- 隊友挑選原則：當多個 `pending` 任務皆未受阻且無 owner，優先選 ID 最小者。這樣能維持 FIFO，並避免兩位代理搶同一件高能見度任務。
- 尊重 `blockedBy`：不要開始其阻擋者仍處於 `pending` 或 `in_progress` 的任務。先處理阻擋者，或與其 owner 協調。
- `TaskList` 是任務的唯一發現機制。沒有搜尋；若清單很長，請結構化掃描（先依 status，再依 owner）。
- 已刪除的任務可能仍以狀態 `deleted` 出現於清單中，用於追溯。規劃時忽略它們。
- 清單反映團隊的即時狀態，所以在兩次呼叫之間隊友可能新增或認領任務。若已過一段時間，認領前請重新列出。
