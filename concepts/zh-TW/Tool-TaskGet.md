# TaskGet

依 ID 擷取單一任務的完整紀錄，包括描述、目前狀態、owner、metadata 與相依邊。當 `TaskList` 回傳的摘要不足以採取行動時使用。

## 使用時機

- 你從 `TaskList` 挑選了一個任務，開始前需要完整描述。
- 即將把任務標為 `completed` 時，想再次確認驗收條件。
- 你需要檢視此任務 `blocks` 了哪些任務或被哪些任務 `blockedBy`，以決定下一步。
- 你在調查歷史——誰擁有、附了什麼 metadata、何時變更了狀態。
- 隊友或先前工作階段提到了某個任務 ID，你需要上下文。

只需要高階瀏覽時請使用 `TaskList`；保留 `TaskGet` 給你打算細讀或修改的特定紀錄。

## 啟用方式

- 在大多數模型上預設可用。
- 在 Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 及之後的系列（v2.1.233+）上不可用，除非透過 `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`、`--allowedTools` 或 `--tools` 選擇啟用。
- 當 `CLAUDE_CODE_ENABLE_TASKS=false` 時，整個任務系統會被停用。

## 參數

- `taskId`（string，必填）：由 `TaskCreate` 或 `TaskList` 回傳的任務識別碼。ID 在任務生命週期中維持不變。

## 範例

### 範例 1

查閱你剛在清單中看到的任務。

```
TaskGet(taskId: "t_01HXYZ...")
```

典型回應欄位：`id`、`subject`、`description`、`activeForm`、`status`、`owner`、`blocks`、`blockedBy`、`metadata`、`createdAt`、`updatedAt`。

### 範例 2

開始前先解相依。

```
TaskGet(taskId: "t_01HXYZ...")
# Inspect blockedBy — if any referenced task is still pending
# or in_progress, work on the blocker first.
```

## 注意事項

- `TaskGet` 為唯讀，可安全地重複呼叫；不會改變狀態或擁有者。
- 若 `blockedBy` 非空且包含未 `completed` 的任務，不要開始此任務——先處理阻擋者（或與其 owner 協調）。
- `description` 欄位可能很長。動工前完整閱讀；草讀會漏掉驗收條件。
- 未知或已刪除的 `taskId` 會傳回錯誤。重新執行 `TaskList` 以取得目前 ID。
- 若你即將編輯某個任務，先呼叫 `TaskGet` 以避免覆寫隊友剛改過的欄位。
