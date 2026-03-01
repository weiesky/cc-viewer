# TaskUpdate

## 定義

更新任務列表中某個任務的狀態、內容或依賴關係。

## 參數

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `taskId` | string | 是 | 要更新的任務 ID |
| `status` | enum | 否 | 新狀態：`pending` / `in_progress` / `completed` / `deleted` |
| `subject` | string | 否 | 新標題 |
| `description` | string | 否 | 新描述 |
| `activeForm` | string | 否 | 進行中時顯示的現在進行式文字 |
| `owner` | string | 否 | 新的任務負責人（agent 名稱） |
| `metadata` | object | 否 | 要合併的中繼資料（設為 null 可刪除鍵） |
| `addBlocks` | string[] | 否 | 被此任務阻塞的任務 ID 列表 |
| `addBlockedBy` | string[] | 否 | 阻塞此任務的前置任務 ID 列表 |

## 狀態流轉

```
pending → in_progress → completed
```

`deleted` 可從任何狀態轉入，永久移除任務。

## 使用場景

**適合使用：**
- 開始工作時標記任務為 `in_progress`
- 完成工作後標記任務為 `completed`
- 設定任務間的依賴關係
- 需求變更時更新任務內容

**重要規則：**
- 只有在完全完成任務時才標記為 `completed`
- 遇到錯誤或阻塞時保持 `in_progress`
- 測試失敗、實作不完整、遇到未解決錯誤時不得標記為 `completed`

## 注意事項

- 更新前應先透過 TaskGet 取得任務最新狀態，避免過期資料
- 完成任務後呼叫 TaskList 查找下一個可用任務

## 在 cc-viewer 中的意義

TaskUpdate 是內部任務管理操作，不產生獨立的 API 請求。

## 原文

<textarea readonly>Use this tool to update a task in the task list.

## When to Use This Tool

**Mark tasks as resolved:**
- When you have completed the work described in a task
- When a task is no longer needed or has been superseded
- IMPORTANT: Always mark your assigned tasks as resolved when you finish them
- After resolving, call TaskList to find your next task

- ONLY mark a task as completed when you have FULLY accomplished it
- If you encounter errors, blockers, or cannot finish, keep the task as in_progress
- When blocked, create a new task describing what needs to be resolved
- Never mark a task as completed if:
  - Tests are failing
  - Implementation is partial
  - You encountered unresolved errors
  - You couldn't find necessary files or dependencies

**Delete tasks:**
- When a task is no longer relevant or was created in error
- Setting status to `deleted` permanently removes the task

**Update task details:**
- When requirements change or become clearer
- When establishing dependencies between tasks

## Fields You Can Update

- **status**: The task status (see Status Workflow below)
- **subject**: Change the task title (imperative form, e.g., "Run tests")
- **description**: Change the task description
- **activeForm**: Present continuous form shown in spinner when in_progress (e.g., "Running tests")
- **owner**: Change the task owner (agent name)
- **metadata**: Merge metadata keys into the task (set a key to null to delete it)
- **addBlocks**: Mark tasks that cannot start until this one completes
- **addBlockedBy**: Mark tasks that must complete before this one can start

## Status Workflow

Status progresses: `pending` → `in_progress` → `completed`

Use `deleted` to permanently remove a task.

## Staleness

Make sure to read a task's latest state using `TaskGet` before updating it.

## Examples

Mark task as in progress when starting work:
```json
{"taskId": "1", "status": "in_progress"}
```

Mark task as completed after finishing work:
```json
{"taskId": "1", "status": "completed"}
```

Delete a task:
```json
{"taskId": "1", "status": "deleted"}
```

Claim a task by setting owner:
```json
{"taskId": "1", "owner": "my-name"}
```

Set up task dependencies:
```json
{"taskId": "2", "addBlockedBy": ["1"]}
```
</textarea>
