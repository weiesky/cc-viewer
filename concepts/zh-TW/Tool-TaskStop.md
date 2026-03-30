# TaskStop

## 定義

停止一個正在執行的後台任務。

## 參數

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `task_id` | string | 否 | 要停止的後台任務 ID |
| `shell_id` | string | 否 | 已棄用，使用 `task_id` 代替 |

## 使用場景

**適合使用：**
- 終止不再需要的長時間執行任務
- 取消錯誤啟動的後台任務

## 注意事項

- 回傳成功或失敗狀態
- `shell_id` 參數已棄用，應使用 `task_id`

## 原文

<textarea readonly>
- Stops a running background task by its ID
- Takes a task_id parameter identifying the task to stop
- Returns a success or failure status
- Use this tool when you need to terminate a long-running task
</textarea>
