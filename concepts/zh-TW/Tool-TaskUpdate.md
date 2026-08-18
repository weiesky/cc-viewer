# TaskUpdate

修改既有任務——其狀態、內容、擁有關係、metadata 或相依邊。這是任務推進其生命週期以及在 Claude Code、隊友與子代理之間交接工作的方式。

## 使用時機

- 在進行工作時，推進任務通過狀態流程。
- 透過把自己（或另一位代理）設為 `owner` 來認領任務。
- 在了解問題後改善 `subject` 或 `description`。
- 以 `addBlocks` / `addBlockedBy` 記錄新發現的相依關係。
- 附加結構化 `metadata`，例如外部工單 ID 或優先度提示。

## 啟用方式

- 在大多數模型上預設可用。
- 在 Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 及之後的系列（v2.1.233+）上不可用，除非透過 `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`、`--allowedTools` 或 `--tools` 選擇啟用。
- 當 `CLAUDE_CODE_ENABLE_TASKS=false` 時，整個任務系統會被停用。

## 參數

- `taskId`（string，必填）：要修改的任務。從 `TaskList` 或 `TaskCreate` 取得。
- `status`（string，選填）：`pending`、`in_progress`、`completed`、`deleted` 之一。
- `subject`（string，選填）：用來替換的祈使句標題。
- `description`（string，選填）：用來替換的詳細描述。
- `activeForm`（string，選填）：用來替換的現在進行式 spinner 文字。
- `owner`（string，選填）：承擔此任務的代理或隊友 handle。
- `metadata`（object，選填）：要合併到任務的 metadata 鍵。將某鍵設為 `null` 可刪除它。
- `addBlocks`（string 陣列，選填）：此任務所阻擋的任務 ID。
- `addBlockedBy`（string 陣列，選填）：必須在此任務之前完成的任務 ID。

## 狀態流程

生命週期有意設計為線性：`pending` → `in_progress` → `completed`。`deleted` 為終結狀態，用於撤回永不會進行的任務。

- 真正開始動工時才將狀態設為 `in_progress`，不要提前。對同一個 owner，一次只應有一個 `in_progress` 的任務。
- 只有在工作完全完成——驗收條件滿足、測試通過、產出已寫入——才設為 `completed`。若出現阻擋，保持 `in_progress` 並新增一個任務描述需解決的問題。
- 在測試失敗、實作不完整，或仍有未解錯誤時，絕不要把任務標為 `completed`。
- 對已取消或重複的任務使用 `deleted`；不要把任務挪用於不相關的工作。

## 範例

### 範例 1

認領一個任務並開始。

```
TaskUpdate(
  taskId: "t_01HXYZ...",
  status: "in_progress",
  owner: "main-agent"
)
```

### 範例 2

完成工作並記錄後續的相依關係。

```
TaskUpdate(
  taskId: "t_01HXYZ...",
  status: "completed"
)

TaskUpdate(
  taskId: "t_01FOLLOWUP...",
  addBlockedBy: ["t_01HXYZ..."]
)
```

## 注意事項

- `metadata` 逐鍵合併；將鍵設為 `null` 會移除。若不確定目前內容，先呼叫 `TaskGet`。
- `addBlocks` 與 `addBlockedBy` 為追加邊，不會移除既有的邊。破壞性地編輯相依圖需要專屬流程——改寫相依前請與團隊 owner 確認。
- 變更 `subject` 時，請同步更新 `activeForm`，讓 spinner 文字讀起來自然。
- 不要把任務標為 `completed` 來讓它噤聲。若使用者取消了工作，請使用 `deleted`，並在 `description` 簡述原因。
- 更新前用 `TaskGet` 讀取最新狀態——隊友可能在你上次讀取到這次寫入之間改動了它。
