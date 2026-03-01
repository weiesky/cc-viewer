# TaskGet

## 定義

透過任務 ID 取得任務的完整詳情。

## 參數

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `taskId` | string | 是 | 要取得的任務 ID |

## 回傳內容

- `subject` — 任務標題
- `description` — 詳細需求和上下文
- `status` — 狀態：`pending`、`in_progress` 或 `completed`
- `blocks` — 被此任務阻塞的任務列表
- `blockedBy` — 阻塞此任務的前置任務列表

## 使用場景

**適合使用：**
- 開始工作前取得任務的完整描述和上下文
- 了解任務的依賴關係
- 被分配任務後取得完整需求

## 注意事項

- 取得任務後應檢查 `blockedBy` 列表是否為空再開始工作
- 使用 TaskList 查看所有任務的摘要資訊

## 在 cc-viewer 中的意義

TaskGet 是內部任務管理操作，不產生獨立的 API 請求。

## 原文

<textarea readonly>Use this tool to retrieve a task by its ID from the task list.

## When to Use This Tool

- When you need the full description and context before starting work on a task
- To understand task dependencies (what it blocks, what blocks it)
- After being assigned a task, to get complete requirements

## Output

Returns full task details:
- **subject**: Task title
- **description**: Detailed requirements and context
- **status**: 'pending', 'in_progress', or 'completed'
- **blocks**: Tasks waiting on this one to complete
- **blockedBy**: Tasks that must complete before this one can start

## Tips

- After fetching a task, verify its blockedBy list is empty before beginning work.
- Use TaskList to see all tasks in summary form.
</textarea>
